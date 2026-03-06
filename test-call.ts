require('dotenv').config({ path: '.env.local' })
const { makeAutomatedCall, buildAcceptanceCallScript } = require('./lib/notifications/calling-service.ts') // Use ts extension since tsx handles it

async function testCall() {
    console.log('--- TESTING TWILIO CALL WITH CACHED SARVAM TTS (<0.2s LATENCY) ---')
    try {
        const script = buildAcceptanceCallScript('Ajaybhai', 'Complete the Q4 financial report')
        console.log('Script:', script)
        console.log('Sending call to +919727731867...')

        // Pass with the country code 91
        const result = await makeAutomatedCall('919727731867', script, 'en-IN')
        console.log('Result:', result)
    } catch (e) {
        console.error('Error during test:', e)
    }
}

testCall()
