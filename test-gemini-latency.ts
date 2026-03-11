import { performance } from 'perf_hooks';
import * as dotenv from 'dotenv';
import { callGemini } from './lib/gemini';

dotenv.config({ path: '.env.local' });

async function measureGeminiTranslationLatency() {
    console.log('Sending request to Gemini...');
    const start = performance.now();

    // We want specifically translation
    const systemInstruction = "Translate the following Gujarati text into English. Output only the English translation, nothing else.";
    const userText = "આ કાર્ય આવતીકાલ સાંજ સુધીમાં પૂર્ણ કરવાનું છે.";

    try {
        const responseText = await callGemini(systemInstruction, userText);
        const end = performance.now();

        console.log(`Latency: ${(end - start).toFixed(2)} ms`);
        console.log(`Response: ${responseText}`);
    } catch (e) {
        console.error("Gemini call failed", e);
    }
}

measureGeminiTranslationLatency();
