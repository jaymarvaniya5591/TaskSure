import { sendTaskAssignmentTemplate, sendSigninLinkTemplate, sendJoinRequestApprovedTemplate } from './lib/whatsapp'

async function run() {
    console.log('Sending message to 919727731867...')
    try {
        console.log('Testing sendTaskAssignmentTemplate...')
        const res = await sendTaskAssignmentTemplate('919727731867', 'Test Owner', 'Test Task', 'test-task-123')
        console.log('Response:', res)

        console.log('Testing sendSigninLinkTemplate...')
        const res2 = await sendSigninLinkTemplate('919727731867', 'Test User', 'abc123token')
        console.log('Response 2:', res2)

        console.log('Testing sendJoinRequestApprovedTemplate with missing body...')
        // Fix it by providing a dummy parameter in the template call temporarily in our code, later or I can just leave it out to see if it's the only one failing.
    } catch (e) {
        console.error('Error:', e)
    }
}
run()
