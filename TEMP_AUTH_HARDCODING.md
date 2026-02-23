# TEMPORARY AUTH HARDCODING — TEST MODE

> **This file documents all temporary hardcoded phone numbers used during the testing phase.**
> When ready to go live, remove these hardcodings and replace with actual dynamic phone numbers.

## Two Numbers Involved

| Number | Purpose | Where Used |
|---|---|---|
| **+91 9620131867** (Bot) | The Boldo AI WhatsApp bot number. Users message THIS number. | `wa.me` deep links in signup/login pages |
| **+91 9727731867** (Developer) | Developer's personal number. Auth links are sent HERE during testing. | `TEST_PHONE_OVERRIDE` in server-side code |

## Why This Exists

The WhatsApp Cloud API free tier only allows **reply-based** messaging (within 24-hour window). During testing, we hardcode the destination phone number for auth link delivery to ensure messages arrive at the developer's phone for verification.

## Files With Hardcoded Values

| File | What's Hardcoded | How to Fix |
|---|---|---|
| `lib/auth-links.ts` | `TEST_PHONE_OVERRIDE = '+919727731867'` | Remove the constant and usage; pass actual phone everywhere |
| `app/api/webhook/whatsapp/route.ts` | Uses `TEST_PHONE_OVERRIDE` for sending links | Replace `sendTo` with `senderPhone` directly |
| `app/api/auth/accept-join/route.ts` | Uses `TEST_PHONE_OVERRIDE` for sending approval notification | Replace `sendTo` with `joinReq.requester_phone` |
| `app/signup/page.tsx` | `WHATSAPP_BOT_NUMBER = "919620131867"` | This is the actual bot number — no change needed |
| `app/login/page.tsx` | `WHATSAPP_BOT_NUMBER = "919620131867"` | This is the actual bot number — no change needed |

## Steps to Remove Hardcoding

1. **Set the actual WhatsApp bot phone number** — replace `WHATSAPP_BOT_NUMBER` in login and signup pages with the real bot phone number
2. **Remove `TEST_PHONE_OVERRIDE`** from `lib/auth-links.ts`
3. **In `app/api/webhook/whatsapp/route.ts`** — replace all instances of `const sendTo = TEST_PHONE_OVERRIDE.replace(...)` with `const sendTo = senderPhone`
4. **In `app/api/auth/accept-join/route.ts`** — replace `TEST_PHONE_OVERRIDE` usage with `joinReq.requester_phone.replace(/\+/g, '')`
5. **Test** all flows with actual phone numbers

## Environment Variable

Also ensure `NEXT_PUBLIC_SITE_URL` is set in `.env.local` to the production URL (e.g., `https://boldoai.in`) so magic links point to the correct domain.
