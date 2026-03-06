import { NextResponse } from 'next/server';
import { decryptRequest, encryptResponse, signChallenge } from '@/lib/whatsapp-flows/crypto';

export async function POST(req: Request) {
    try {
        const rawBody = await req.text();
        let body: Record<string, unknown> = {};

        try {
            body = JSON.parse(rawBody);
        } catch {
            console.log('Failed to parse body as JSON. Raw body:', rawBody);
        }

        console.log('--- WhatsApp Flows Endpoint POST ---');
        console.log('Body:', body);

        // 1. Handle "Sign public key" challenge (Meta Setup UI 2024+)
        // Meta sends a POST with either a pure 'challenge' in JSON, or similar payload.
        // If we detect a challenge, sign it using the private key and return.
        if (body && typeof body === 'object' && 'challenge' in body) {
            console.log('Received challenge for public key signing. Signing...');
            const signature = signChallenge(body.challenge as string);
            console.log('Returning signature:', signature);
            // Might just need to return the signature or { signature }
            return NextResponse.json({ signature }, { status: 200 });
        }

        // Also try to handle plain text challenge if Meta sends raw string
        if (rawBody && !rawBody.startsWith('{') && rawBody.length > 5) {
            console.log('Received possible raw string challenge. Signing...');
            try {
                const signature = signChallenge(rawBody.trim());
                // Try returning as plain text too? Or JSON? We will adapt based on logs if it fails.
                return new NextResponse(signature, { status: 200 });
            } catch (e) {
                console.error('Error signing plain text challenge:', e);
            }
        }

        // 2. Handle actual Encrypted Flow Data Exchange
        if (body.encrypted_flow_data && body.encrypted_aes_key && body.initial_vector) {
            console.log('Received encrypted flow data exchange.');

            const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(
                body.encrypted_aes_key as string,
                body.encrypted_flow_data as string,
                body.initial_vector as string
            );

            console.log('Decrypted Flow Payload:', decryptedBody);

            // Handle ping
            if (decryptedBody.action === 'ping') {
                const responseData = {
                    data: {
                        status: 'active'
                    }
                };

                const encryptedResponse = encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
                return new NextResponse(encryptedResponse, { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }

            // Handle other actions (data_exchange, INIT, etc.)
            const responseData = {
                screen: 'WELCOME_SCREEN',
                data: {}
            };

            const encryptedResponse = encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
            return new NextResponse(encryptedResponse, { status: 200, headers: { 'Content-Type': 'text/plain' } });
        }

        return NextResponse.json({ error: 'Unrecognized request payload' }, { status: 400 });

    } catch (error) {
        console.error('WhatsApp Flow Endpoint Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
