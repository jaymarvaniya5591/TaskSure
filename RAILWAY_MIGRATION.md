# Moving Boldo AI from Vercel to Railway

This guide is written for you — no technical background needed. Follow each step in order.

---

## Why are we doing this?

Vercel "wakes up" your app fresh every time someone uses it (called a "cold start"). This causes 2–5 second delays. Railway keeps your app running 24/7, like a machine that's always on — no delays.

---

## Part A: Things Claude will do for you (code changes)

Before you do anything on Railway, make sure Claude has made the following code changes and pushed them to GitHub:

- [ ] `next.config.mjs` — updated to produce a Railway-compatible build
- [ ] `app/api/webhook/whatsapp/route.ts` — background task handling fixed for Railway
- [ ] `app/api/auth/verify-link/route.ts` — same fix as above
- [ ] `railway.json` — new file that tells Railway how to start your app

Only move to Part B after these are pushed to GitHub.

---

## Part B: Set up Railway (you do this)

### Step 1 — Create your Railway account

1. Go to **https://railway.app**
2. Click **"Login"** → choose **"Login with GitHub"**
3. After logging in, Railway will ask you to upgrade. Choose the **Hobby Plan** ($5/month + small usage fees — much cheaper than Vercel for your usage).

---

### Step 2 — Create a new project and connect your GitHub repo

1. In the Railway dashboard, click the big **"+ New Project"** button.
2. Click **"Deploy from GitHub repo"**.
3. Railway will ask for GitHub permissions — click **"Configure GitHub App"** and grant access to your repo (e.g., `TaskSure` or whatever your repo is named).
4. Select your repo and click **"Deploy Now"**.
5. Your first deployment will **fail** — that's totally expected. It's missing your secret settings (environment variables). Continue to Step 3.

---

### Step 3 — Copy your secret settings (Environment Variables)

This is the most important step. Your app has secret keys (WhatsApp tokens, Supabase keys, etc.) that need to be copied from Vercel to Railway.

**From Vercel:**
1. Go to **https://vercel.com** → open your project → click **"Settings"** (top menu).
2. Click **"Environment Variables"** in the left sidebar.
3. Look for a small **copy icon** at the top-right of the list. Click it to copy all variables.

**To Railway:**
1. Go back to Railway → click on your newly created service (the box that appeared after connecting GitHub).
2. Click the **"Variables"** tab.
3. Click **"RAW Editor"** (it's a button, usually top-right of the variables section).
4. Paste everything you copied from Vercel.
5. **Add two more variables manually:**
   - Name: `NODE_ENV`
   - Value: `production`
   - Name: `HOSTNAME`
   - Value: `0.0.0.0`
6. Click **"Update"** — Railway will automatically redeploy with the correct settings.

> Your app should now deploy successfully. Check the "Deployments" tab — wait for a green checkmark.

---

### Step 4 — Add your custom domain (boldoai.in)

1. In the Railway dashboard, click on your service → click the **"Settings"** tab.
2. Scroll down to **"Networking"** → click **"+ Custom Domain"**.
3. Type `boldoai.in` and press Enter. (You should also add `www.boldoai.in` if you use both, as they are separate domains in Railway).
4. Railway will show you a **CNAME record** to add (looks like: `boldoai.in → xyz.up.railway.app`).

**At your domain provider (GoDaddy / Cloudflare / Namecheap):**
1. Log in and go to DNS settings for `boldoai.in`.
2. **Delete** any existing `A` or `CNAME` records that point to Vercel (usually pointing to `cname.vercel-dns.com` or similar).
3. **Add** the new CNAME record Railway gave you.
4. Wait 5–30 minutes for it to update worldwide (called DNS propagation).

---

### Step 5 — Verify everything works

Do these checks after the domain is live:

- [ ] Open `https://boldoai.in` in your browser — does it load quickly (under 1 second)?
- [ ] Log in — does the login/signup flow work?
- [ ] Send a WhatsApp message to your bot — does it respond?
- [ ] Check Railway's **"Logs"** tab for your service — no red errors.

---

### Step 6 — Clean up (optional but saves money)

Once Railway is working:

1. **Cancel your keep-warm cron job** — if you set up cron-job.org or UptimeRobot to ping `/api/keep-warm` every 5 minutes, you can delete/pause those. Railway never sleeps, so keep-warm is no longer needed.

2. **Pause or delete your Vercel project** — once you've confirmed Railway works for 1–2 days, you can safely delete the Vercel project to avoid any accidental charges.

---

## Common Questions

**Q: Will my WhatsApp bot stop working during the switch?**
A: There will be a short window (a few minutes) when DNS is switching over. During this time, WhatsApp messages may not be processed. Best to do the DNS switch during off-peak hours (late night).

**Q: My custom domain didn't change — do I need to update WhatsApp/Meta settings?**
A: No. Since your domain (`boldoai.in`) stays the same, Meta's webhook URL stays the same. No changes needed there.

**Q: Do I need to update Supabase?**
A: Probably not, since your domain isn't changing. But double-check:
- Go to your Supabase project → **Authentication** → **URL Configuration**
- Make sure "Site URL" is set to `https://boldoai.in`
- Make sure `https://boldoai.in/**` is in the list of allowed Redirect URLs

---

## Summary of Costs

| | Vercel | Railway |
|---|---|---|
| Plan | Pro/Hobby | Hobby ($5/month) |
| Cold starts | Yes (2–5 sec) | None |
| Background tasks | Cut off at 60 sec | Unlimited |
| Keep-warm cron needed | Yes | No |

