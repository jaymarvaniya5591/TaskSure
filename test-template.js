const url = `https://graph.facebook.com/v21.0/1107163252468835/messages`;
const accessToken = `EAATDvRZCfkQIBQ1VNBkQnZBE5Pg34v7nnEHh8jncD9RYaNnBUDV3QmWXqvgMt0ztLJjKFlHxo4PVwC2ZBD34amAZBmj8caWv3WUsAswZBiHfekl51sA4O7k0C5CKzdcs2FiiSQ6hlmxoSOcvzBeWyN4G5eboZBf89osqCvBkEne71zYKZAIOZA7WgKEmnsZBmzwZDZD`;

async function run() {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: '919035451160',
            type: 'template',
            template: {
                name: 'join_request_pending',
                language: { code: 'en' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: 'Test Requester' },
                            { type: 'text', text: '+919035451160' }
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'quick_reply',
                        index: '0',
                        parameters: [
                            { type: 'payload', payload: 'approve_join_request::test1234' }
                        ]
                    }
                ]
            }
        })
    });
    const text = await res.text();
    console.log(text);
}
run();
