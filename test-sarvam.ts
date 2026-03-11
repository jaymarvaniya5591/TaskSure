import { readFileSync } from 'fs';

async function testSarvamTranslate() {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
        console.error('No API key found in env. Exiting.');
        return;
    }

    const payload = {
        input: ['આ કાર્ય આવતીકાલ સાંજ સુધીમાં પૂર્ણ કરવાનું છે.'], // Gujarati: this task is to be completed by tomorrow evening
        source_language_code: 'unknown',
        target_language_code: 'en-IN',
        speaker_gender: 'Male',
        mode: 'formal',
        model: 'sarvam-translate:v1'
    };

    console.log('Sending request to Sarvam Translate...');
    const response = await fetch('https://api.sarvam.ai/translate', {
        method: 'POST',
        headers: {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    console.log('Status:', response.status);
    const data = await response.text();
    console.log('Response:', data);
}

testSarvamTranslate();
