import { decryptRequest, encryptResponse, signChallenge } from './lib/whatsapp-flows/crypto';

// Replicating what the route.ts does but in a local script so we can see the exact error
async function test() {
    try {
        // 1. Let's make sure the private key is loading correctly
        const signature = signChallenge('test_challenge_string');
        console.log('Private key loaded and signed successfully. Signature length:', signature.length);

        console.log('All crypto functions initialized without throwing.');
    } catch (error) {
        console.error('Crypto error:', error);
    }
}

test();
