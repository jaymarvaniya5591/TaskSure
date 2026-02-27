const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8');
const match = env.match(/GEMINI_API_KEY=(.*)/);
const apiKey = match ? match[1].trim() : '';

const prompt = `You are Boldo AI. Extract structured task data from the user's message.
Today is Friday, 2026-02-27 (IST).

The user wants to CREATE A TASK and assign it to someone.

You must extract THREE key components:
1. WHAT — the task to be done (compulsory)
2. WHO — the person who should do the task (extract their name as spoken)
3. WHEN — any deadline/timeframe mentioned

OUTPUT FORMAT (valid JSON):
{
  "intent": "task_create",
  "title": "a task title summarizing what needs to be done (max 120 chars). Include deadline info if mentioned. Do NOT include the assignee name in the title.",
  "description": "optional additional details, or null",
  "assignee_name": "the name of the person to assign the task to, EXACTLY as mentioned in the message (e.g. 'diksha', 'Ramesh', 'Priya ji'). Return null ONLY if truly no person name is mentioned.",
  "deadline": "ISO 8601 date-time if a deadline was mentioned (e.g. 2026-02-28T18:00:00+05:30), or null",
  "who_type": "person (if a person's name is mentioned as the one who should do the task) | bot (if the user expects the bot to do something like remind/send) | self (if the user wants to do it themselves) | unknown (if unclear who should do the task)",
  "when_type": "formal (both a specific date/day AND time are mentioned or derivable) | informal (vague time reference like 'after Rohit comes', 'soon', 'when possible', OR only time but no date, OR only date but no time) | none (no time reference at all)"
}

RULES:
- Extract the assignee name EXACTLY as it appears in the message (e.g. "Ramesh", "Priya", "diksha"). Do not modify or correct the name.
- If the who_type is "bot" or "self", set assignee_name to null.
- Convert relative dates to ISO 8601 based on today.
- For vague deadlines like "by Friday", "next week", "kal" — convert to an actual ISO date based on today's date. Set when_type to "formal" if you can derive both a date and time.
- "aaj" = today, "kal" = tomorrow, "parso" = day after tomorrow.
- If the action is a complex or conditional sentence (e.g., "that if someone comes before 12 o'clock, vacate the room"), the ENTIRE instruction should be extracted as the task title. Do not truncate or lose the conditional parts.
- If the user mentions a time/deadline, include it in the title (e.g., 'Send the file to person X by 3 PM tomorrow').
- If only a date/day is mentioned but no time, set deadline to end of day (23:59:00+05:30) for tasks, and set when_type to "informal".
- If only a time is mentioned but no date/day, set when_type to "informal".
- If no time reference at all, set when_type to "none" and deadline to null.
- Never lose information from the user's message. Condense for clarity but preserve all key details — who, what, when, where.
- Return null for any field you are not certain about. Do not guess. Do not infer. A null field triggers a clarification request, which is always better than a wrong value.`;

async function test() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [
                { role: 'user', parts: [{ text: prompt }] },
                { role: 'user', parts: [{ text: "[audio] Tell the tester that if someone comes before 12 o'clock tomorrow, they should vacate my meeting room by 10 o'clock." }] }
            ],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        })
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
}
test();
