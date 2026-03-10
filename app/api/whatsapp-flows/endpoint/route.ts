import { NextResponse } from 'next/server';
import { decryptRequest, encryptResponse, signChallenge } from '@/lib/whatsapp-flows/crypto';
import {
    handleInit,
    handleLoadTasks,
    handleLoadTask,
    handlePrepareAction,
    handleCommitAction,
} from '@/lib/whatsapp-flows/screens';
import { normalizePhone } from '@/lib/phone';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        const rawBody = await req.text();
        let body: Record<string, unknown> = {};

        try {
            body = JSON.parse(rawBody);
        } catch {
            console.log('[FlowEndpoint] Failed to parse body as JSON. Raw body:', rawBody);
        }

        // 1. Handle "Sign public key" challenge
        if (body && typeof body === 'object' && 'challenge' in body) {
            console.log('[FlowEndpoint] Signing challenge...');
            const signature = signChallenge(body.challenge as string);
            return NextResponse.json({ signature }, { status: 200 });
        }

        // Also handle plain text challenge
        if (rawBody && !rawBody.startsWith('{') && rawBody.length > 5) {
            try {
                const signature = signChallenge(rawBody.trim());
                return new NextResponse(signature, { status: 200 });
            } catch (e) {
                console.error('[FlowEndpoint] Error signing plain text challenge:', e);
            }
        }

        // 2. Handle encrypted flow data exchange
        if (body.encrypted_flow_data && body.encrypted_aes_key && body.initial_vector) {
            const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(
                body.encrypted_aes_key as string,
                body.encrypted_flow_data as string,
                body.initial_vector as string
            );

            console.log('[FlowEndpoint] Decrypted payload:', JSON.stringify(decryptedBody));

            // Health check ping
            if (decryptedBody.action === 'ping') {
                const responseData = { data: { status: 'active' } };
                const encrypted = encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
                return new NextResponse(encrypted, { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }

            // Resolve user phone from flow_token
            const rawPhone = decryptedBody.flow_token as string | undefined;
            const phone10 = rawPhone ? normalizePhone(rawPhone) : '';

            if (!phone10) {
                console.error('[FlowEndpoint] No flow_token/phone in payload');
                const encrypted = encryptResponse(
                    { screen: 'DASHBOARD', data: { summary: 'Session expired. Please type "list" again.', filter_options: [] } },
                    aesKeyBuffer, initialVectorBuffer
                );
                return new NextResponse(encrypted, { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }

            // Route by action + screen_action from payload
            const action = decryptedBody.action as string;
            const screenAction = (decryptedBody.data as Record<string, unknown>)?.screen_action as string
                ?? (decryptedBody as Record<string, unknown>)?.screen_action as string;

            console.log('[FlowEndpoint] action:', action, '| screen_action:', screenAction);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const flowData = (decryptedBody.data ?? decryptedBody) as Record<string, any>;

            let screenResponse: { screen: string; data: Record<string, unknown> };

            if (action === 'INIT') {
                // Flow just opened — send DASHBOARD
                screenResponse = await handleInit(phone10);

            } else if (action === 'data_exchange') {
                const sa = flowData.screen_action as string;

                switch (sa) {
                    case 'LOAD_TASKS':
                        screenResponse = await handleLoadTasks(phone10, flowData.view as string);
                        break;

                    case 'LOAD_TASK':
                        screenResponse = await handleLoadTask(phone10, flowData.task_id as string, flowData.view as string);
                        break;

                    case 'PREPARE_ACTION':
                        screenResponse = await handlePrepareAction(
                            phone10,
                            flowData.task_id as string,
                            flowData.selected_action as string,
                            flowData.view as string
                        );
                        break;

                    case 'COMMIT_ACTION':
                        screenResponse = await handleCommitAction(
                            phone10,
                            flowData.task_id as string,
                            flowData.action_type as string,
                            {
                                new_deadline_date: flowData.new_deadline_date as string | undefined,
                                new_deadline_time: flowData.new_deadline_time as string | undefined,
                                selectedEmployee: flowData.selected_employee as string | undefined,
                                employeeSearch: flowData.employee_search as string | undefined,
                                reject_reason: flowData.reject_reason as string | undefined,
                            },
                            flowData.view as string
                        );
                        break;

                    default:
                        console.error('[FlowEndpoint] Unknown screen_action:', sa);
                        screenResponse = await handleInit(phone10);
                }
            } else {
                // Fallback: re-send dashboard
                screenResponse = await handleInit(phone10);
            }

            console.log('[FlowEndpoint] Responding with screen:', screenResponse.screen);
            const encrypted = encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer);
            return new NextResponse(encrypted, { status: 200, headers: { 'Content-Type': 'text/plain' } });
        }

        return NextResponse.json({ error: 'Unrecognized request payload' }, { status: 400 });

    } catch (error) {
        console.error('[FlowEndpoint] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
