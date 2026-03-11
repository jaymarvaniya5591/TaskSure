import { performance } from 'perf_hooks';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function measureTranslationLatency() {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
        console.error('No API key found in env. Exiting.');
        return;
    }

    const payload = {
        input: 'આ કાર્ય આવતીકાલ સાંજ સુધીમાં પૂર્ણ કરવાનું છે.',
        source_language_code: 'gu-IN',
        target_language_code: 'en-IN',
        speaker_gender: 'Male',
        mode: 'formal',
        model: 'sarvam-translate:v1'
    };

    console.log('Sending request to Sarvam Translate...');
    const start = performance.now();

    const response = await fetch('https://api.sarvam.ai/translate', {
        method: 'POST',
        headers: {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const end = performance.now();
    console.log(`Status: ${response.status}`);
    const data = await response.text();
    console.log(`Latency: ${(end - start).toFixed(2)} ms`);
    console.log(`Response: ${data}`);
}

measureTranslationLatency();
