import crypto from 'crypto';

import forge from 'node-forge';

// Reformat private key if it was stored with literal \n or lost its newlines in Vercel UI
const getPrivateKey = () => {
    let key = process.env.WHATSAPP_FLOWS_PRIVATE_KEY;
    if (!key) throw new Error('Missing WHATSAPP_FLOWS_PRIVATE_KEY environment variable');

    // 1. replace literal string "\n" with actual newlines
    key = key.replace(/\\n/g, '\n').trim();

    // 2. Re-construct the PEM format perfectly in case Vercel turned newlines into spaces
    const beginMatch = key.match(/-----BEGIN (.*?)KEY-----/);
    const endMatch = key.match(/-----END (.*?)KEY-----/);

    if (beginMatch && endMatch) {
        const beginTag = beginMatch[0];
        const endTag = endMatch[0];

        let body = key.substring(key.indexOf(beginTag) + beginTag.length, key.indexOf(endTag));
        // Remove ALL whitespace from the base64 body
        body = body.replace(/\s+/g, '');

        // Chunk body into 64-character lines
        const chunks = body.match(/.{1,64}/g) || [];
        key = `${beginTag}\n${chunks.join('\n')}\n${endTag}\n`;
    }

    return key;
};

/**
 * Signs a challenge string using the RSA private key.
 * This is used for the "Sign public key" verification step in Meta Business Manager.
 */
export function signChallenge(challenge: string): string {
    const privateKey = getPrivateKey();
    const sign = crypto.createSign('SHA256');
    sign.update(challenge);
    sign.end();
    return sign.sign(privateKey, 'base64');
}

/**
 * Decrypts the AES key, then uses the AES key to decrypt the flow data.
 * @param encryptedAesKey Base64 encoded encrypted AES key
 * @param encryptedFlowData Base64 encoded encrypted flow data
 * @param initialVector Base64 encoded initial vector
 */
export function decryptRequest(encryptedAesKey: string, encryptedFlowData: string, initialVector: string) {
    const privateKeyStr = getPrivateKey();

    // 1. Decrypt the AES key using node-forge (bypasses OpenSSL compatibility issues)
    const privateKey = forge.pki.privateKeyFromPem(privateKeyStr);

    // Decode the base64 encrypted AES key into a binary string for node-forge
    const encryptedAesKeyBytes = forge.util.decode64(encryptedAesKey);

    // Decrypt using RSA-OAEP with SHA-256 for both main hash and MGF1 hash
    const decryptedAesKeyBytes = privateKey.decrypt(encryptedAesKeyBytes, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: {
            md: forge.md.sha256.create() // Node natively sets MGF1 to match oaepHash
        }
    });

    // Convert the decrypted binary string back into a Node.js Buffer for the AES decryption step
    const decryptedAesKey = Buffer.from(decryptedAesKeyBytes, 'binary');

    // 2. Decrypt the Flow data using the decrypted AES key and IV
    const decipher = crypto.createDecipheriv(
        'aes-128-gcm',
        decryptedAesKey,
        Buffer.from(initialVector, 'base64')
    );

    // The auth tag is the last 16 bytes of the encrypted data
    const encryptedDataBuffer = Buffer.from(encryptedFlowData, 'base64');
    const authTag = encryptedDataBuffer.subarray(encryptedDataBuffer.length - 16);
    const dataToDecrypt = encryptedDataBuffer.subarray(0, encryptedDataBuffer.length - 16);

    decipher.setAuthTag(authTag);

    let decryptedData = decipher.update(dataToDecrypt, undefined, 'utf8');
    decryptedData += decipher.final('utf8');

    return {
        decryptedBody: JSON.parse(decryptedData),
        aesKeyBuffer: decryptedAesKey,
        initialVectorBuffer: Buffer.from(initialVector, 'base64'),
    };
}

/**
 * Encrypts the response data using the same AES key and IV.
 */
export function encryptResponse(responseData: Record<string, unknown>, aesKeyBuffer: Buffer, initialVectorBuffer: Buffer): string {
    // Flip the initialization vector exactly as per Meta's NodeJS example
    const flipped_iv = [];
    for (let i = 0; i < initialVectorBuffer.length; i++) {
        flipped_iv.push(~initialVectorBuffer[i]);
    }

    // Encrypt the response data
    const cipher = crypto.createCipheriv(
        'aes-128-gcm',
        aesKeyBuffer,
        Buffer.from(flipped_iv)
    );

    return Buffer.concat([
        cipher.update(JSON.stringify(responseData), 'utf-8'),
        cipher.final(),
        cipher.getAuthTag(),
    ]).toString('base64');
}
