import crypto from 'crypto';

// Reformat private key if it was stored with literal \n
const getPrivateKey = () => {
    const key = process.env.WHATSAPP_FLOWS_PRIVATE_KEY;
    if (!key) throw new Error('Missing WHATSAPP_FLOWS_PRIVATE_KEY environment variable');
    return key.replace(/\\n/g, '\n');
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
    const privateKey = getPrivateKey();

    // 1. Decrypt the AES key using RSA private key
    const decryptedAesKey = crypto.privateDecrypt(
        {
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        Buffer.from(encryptedAesKey, 'base64')
    );

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
export function encryptResponse(responseData: any, aesKeyBuffer: Buffer, initialVectorBuffer: Buffer): string {
    // Flip the IV bits as per WhatsApp Flows spec
    const flippedIV = Buffer.alloc(12);
    for (let i = 0; i < initialVectorBuffer.length; i++) {
        flippedIV[i] = ~initialVectorBuffer[i];
    }

    const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flippedIV);

    const responseDataString = JSON.stringify(responseData);

    let encryptedData = cipher.update(responseDataString, 'utf8');
    encryptedData = Buffer.concat([encryptedData, cipher.final()]);

    const authTag = cipher.getAuthTag();

    const finalEncryptedBuffer = Buffer.concat([encryptedData, authTag]);

    return finalEncryptedBuffer.toString('base64');
}
