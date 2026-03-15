import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { buildReminderCallScript } from '../lib/notifications/calling-service';

async function main() {
    const ownerName = "Demo System";
    const taskSummary = "This is a sample task for testing the task acceptance reminder call.";
    
    // Use the reminder script like the user mentioned
    const message = buildReminderCallScript(taskSummary, ownerName);
    
    console.log("Sending message via production API:", message);
    
    const response = await fetch('https://boldoai.in/api/internal/test-call', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_PROCESSOR_SECRET!
        },
        body: JSON.stringify({
            phone: '+917781008884',
            message: message,
            language: 'hi-IN'
        })
    });
    
    if (!response.ok) {
        console.error("API Error:", response.status, await response.text());
        return;
    }
    
    const result = await response.json();
    console.log("Call Result:", result);
}

main().catch(console.error);
