require('dotenv').config({ path: '.env.local' });
const { sendJoinRequestApprovedTemplate } = require('./lib/whatsapp');

// Assuming the requester is the original delta owner who wasn't receiving the message
// We can test the exact number
const testNumber = '919035451160';

console.log(`Testing sendJoinRequestApprovedTemplate with number: ${testNumber}`);

(async () => {
    try {
        await sendJoinRequestApprovedTemplate(testNumber);
        console.log('Template test executed. Check response.');
    } catch (err) {
        console.error('Test failed:', err);
    }
})();
