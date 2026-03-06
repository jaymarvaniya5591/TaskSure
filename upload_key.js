const fs = require('fs');

async function uploadKey() {
    const token = 'EAATDvRZCfkQIBQ1VNBkQnZBE5Pg34v7nnEHh8jncD9RYaNnBUDV3QmWXqvgMt0ztLJjKFlHxo4PVwC2ZBD34amAZBmj8caWv3WUsAswZBiHfekl51sA4O7k0C5CKzdcs2FiiSQ6hlmxoSOcvzBeWyN4G5eboZBf89osqCvBkEne71zYKZAIOZA7WgKEmnsZBmzwZDZD';
    const phoneId = '1107163252468835';

    const publicKey = fs.readFileSync('flow_public.pem', 'utf8');

    const url = `https://graph.facebook.com/v20.0/${phoneId}/whatsapp_business_encryption`;

    const params = new URLSearchParams();
    params.append('business_public_key', publicKey);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const data = await response.json();
        console.log('Response Status:', response.status);
        console.log('Response Data:', data);
    } catch (error) {
        console.error('Fetch Error:', error);
    }
}

uploadKey();
