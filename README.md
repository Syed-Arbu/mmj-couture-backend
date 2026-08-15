# MM Javeed Couture — Bespoke Billing (Backend + App)

This is the real, database-backed version of the billing app. Everything — orders,
customers, company details, garments, QR codes — now lives in a proper database on
a server, instead of a browser tab. Close the tab, restart the computer, come back
tomorrow: it's all still there.

This document is written for **you, handing this to the MMJ store** — no coding
background assumed. Follow it top to bottom and you'll go from "a folder of code"
to "a live website the shop can use every day."

---

## Part 1 — What you're handing over

```
mmj-backend/
  server.js          the app's engine
  db.js               sets up the database and creates the two logins the first time it runs
  routes/              the API endpoints (orders, company, garments, sections, QR codes, login)
  middleware/auth.js   checks who's logged in and who's an admin
  public/index.html    the actual app the store will see and use (single file, same design as before)
  package.json         the list of building blocks the app needs
  .env.example          settings template (secrets, port)
  README.md            this file
```

Nothing here needs to be edited by hand for a standard setup — you're mainly going
to **run three commands** and **fill in one settings file**.

---

## Part 2 — Choose where it will live

You need somewhere to run a small Node.js server 24/7. Three realistic options,
easiest first:

| Option | Cost | Best for |
|---|---|---|
| **Render.com** (or Railway.app) | Free tier to start, ~$7/mo for always-on | Fastest way to get live today, zero server admin |
| **A cheap VPS** (DigitalOcean, Hetzner, AWS Lightsail) | ~$5–6/mo | If you want full control, or already run other things there |
| **Shared hosting with Node support** | Varies | Only if the store already pays for hosting that supports Node.js |

The steps below use **Render**, because it's the least fiddly for a first deploy —
you connect a code repository and it does the rest. If you'd rather use a VPS, skip
to **Part 2B**.

### Part 2A — Deploying on Render (recommended)

1. **Put the code on GitHub.**
   - Create a free GitHub account if you don't have one.
   - Create a new **private** repository, e.g. `mmj-couture-billing`.
   - Upload this entire `mmj-backend` folder into it (GitHub's website lets you
     drag-and-drop files, or use `git push` if you're comfortable with git).

2. **Create a Render account** at render.com (free, sign in with GitHub is easiest).

3. **New Web Service** → connect your `mmj-couture-billing` repository.

4. Render will ask a few questions — answer them like this:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance type:** Free (to test) or Starter (~$7/mo, for a shop that needs it
     always on without sleeping)

5. **Add environment variables** (Render calls this "Environment" in the sidebar):
   - `SESSION_SECRET` → a long random string. Generate one by running this on your
     own computer's terminal: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     and paste the result in.
   - `NODE_ENV` → `production`

6. Click **Create Web Service**. Render will install everything and start the app.
   After a couple of minutes you'll get a live URL like
   `https://mmj-couture-billing.onrender.com`.

7. Open that URL. You should see the login screen. That's it — it's live.

> Render's free tier "sleeps" after inactivity and takes ~30 seconds to wake up on
> the next visit. For a shop billing customers in real time, the ~$7/mo "Starter"
> tier (always-on) is worth it.

### Part 2B — Deploying on your own VPS (if you'd rather self-host)

1. Rent a small server (DigitalOcean/Hetzner "$5/mo droplet" is plenty).
2. SSH into it and install Node.js 20 (the provider's docs will show the exact
   command, usually something like `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs`).
3. Copy this `mmj-backend` folder onto the server (via `scp`, `git clone`, or an
   SFTP app like FileZilla).
4. Inside the folder, run:
   ```
   npm install
   cp .env.example .env
   ```
   Then open `.env` and fill in `SESSION_SECRET` (see the command above) and set
   `NODE_ENV=production`.
5. Start it so it keeps running even after you disconnect:
   ```
   npm install -g pm2
   pm2 start server.js --name mmj-billing
   pm2 save
   pm2 startup
   ```
6. Point a domain at it (see Part 3) and put it behind Nginx or Caddy with HTTPS —
   both providers have a one-page guide for "Node.js app + Nginx + free SSL" that a
   local freelance developer can set up in under an hour if you're not comfortable
   doing it yourself.

---

## Part 3 — Give it a proper domain (optional but recommended)

Right now the app lives at a long provider URL. For something the store's staff
will open every day, a short branded domain reads much better:

1. Buy a domain if MMJ doesn't have one — e.g. `billing.mmjaveed.com` (as a
   subdomain of an existing site) or a fresh `mmjaveedbilling.com`.
2. In your domain registrar's DNS settings, add a **CNAME record** pointing the
   subdomain at the Render URL (Render's dashboard shows you exactly what to add
   under "Custom Domain").
3. Render issues a free HTTPS certificate automatically once the DNS is verified —
   usually within minutes to an hour.

If using a VPS instead, point an **A record** at the server's IP address and set
up HTTPS with Caddy or Certbot (both are free and mostly automatic).

---

## Part 4 — First login and locking it down

The database seeds **one** login automatically the very first time the server starts:

| Role | ID | Password |
|---|---|---|
| Admin (owner) | `mmjbr@123` | `mmjbr123` |

There is no separate staff account anymore — staff logins are created **by the
admin, from inside the app**, each with their own name, ID and password.

**Before handing the link to anyone else:**

1. Log in as admin with the credentials above.
2. Go to **Admin → My Admin Credentials** and change the login ID and password to
   something real (your current password is required to confirm the change).
3. Go to **Admin → Manage Staff** and add one login per staff member — enter their
   name, choose a login ID, set a password, and hand it to them directly. You can
   edit or remove any staff login at any time from the same screen; staff do not
   self-reset their own passwords, so if someone forgets theirs, the admin just
   sets a new one here.
4. Go to **Admin → Company Details** and fill in the real shop name, address,
   phone, and GST number — this now appears on every printed bill automatically.
5. Upload the real UPI QR code under **Admin → UPI QR Codes**.

Every bill now also records which login created it — visible as a "Billed By"
column in Orders and on the Store Bill copy — useful for tracking who billed what.

> Note: the old OTP-based "Forgot Password" flow on the login screen still exists
> as a backup, but only works for the Admin account now (staff accounts are
> managed directly by the admin, as above).

---

## Part 5 — Optional: real SMS for password-reset OTP

Right now, "Forgot Password" generates a 6-digit code and shows it directly in the
app (labelled "Demo mode") instead of texting it, so the whole flow works without
needing any paid service configured. This is fine for a small shop where the owner
resets their own password occasionally, but if you want the OTP to actually arrive
by SMS:

1. Sign up for an SMS provider — **MSG91** or **Twilio** are the most common in
   India.
2. In `routes/auth.js`, find the `/forgot/send-otp` route — it already generates
   the `otp` variable. Add a call to the provider's "send SMS" API there, then stop
   returning `devOtp` in the response.
3. Add the provider's API key as another environment variable (same way as
   `SESSION_SECRET`) so it's never hard-coded into the file.

This is a 15–30 minute job for any Node.js developer if you'd rather not do it
yourself — happy to write this integration too if you want to hand me the SMS
provider's API key format.

---

## Part 6 — Backups (don't skip this)

All the shop's data — every bill, every customer, every measurement — lives in a
single file: `mmj.db`, sitting next to `server.js` on the server.

- **On Render:** the free/starter tiers use temporary disks that can be wiped on
  redeploy. For a shop actually depending on this data, upgrade to a Render
  **persistent disk** (a few dollars a month) and mount it at the app's folder, or
  move to Render's managed Postgres later — ask me and I'll walk you through the
  switch.
- **On a VPS:** set up a simple nightly copy of `mmj.db` to somewhere safe (a cron
  job that copies it to cloud storage like Backblaze/S3, or even emails it to the
  owner). This is a five-minute script — I can write it if you want it included.

**Bare minimum for launch day:** manually download a copy of `mmj.db` from the
server once a week until proper backups are set up.

---

## Part 7 — Handing it to the shop, in person

A simple checklist for the actual handover conversation with the MMJ Javeed team:

1. **Show them the link** (the domain from Part 3, or the Render URL) and get it
   bookmarked on the shop's computer, tablet, and the owner's phone.
2. **Log in as admin together**, and walk through:
   - Company Details (already filled in per Part 4)
   - Uploading the UPI QR
   - Adding/removing a garment type, so they see how easy it is
3. **Log in as staff** on a second device and create one real test bill end to end
   — client details, measurements, billing, Save Bill, Print Store Bill, Print
   Client Bill — so they see a bill go from nothing to a printed PDF.
4. **Show them the Delete option** and explain it's permanent — worth a five-second
   warning in person.
5. **Give them both sets of credentials in writing** (a printed slip, not just
   verbally) along with a one-line reminder: *"Change these passwords the first
   week using Forgot Password on the login screen."*
6. **Tell them who to call** if something breaks — you, or whoever owns ongoing
   support for this.

---

## Part 8 — Running it locally to test before you deploy

Before pushing to Render/VPS, you can run the whole thing on your own laptop to
make sure it works:

```bash
cd mmj-backend
npm install
cp .env.example .env
# open .env and set SESSION_SECRET to any random string for local testing
npm start
```

Then open `http://localhost:3000` in a browser. Log in with the default admin or
staff credentials from Part 4. This runs the exact same code that will run in
production — if it works here, it'll work once deployed.

---

## What's already built for you

- Two role-based logins (Admin / Staff) with server-side password checking —
  passwords are hashed, never stored in plain text.
- Every order, customer, and their auto-assigned `MMJBR###` customer ID persists
  in the database.
- Company Details, Garment types, Section visibility, and UPI QR codes are all
  editable from the Admin panel and stored centrally — every staff login sees the
  same data immediately, no refresh tricks needed.
- Store Bill and Client Bill both print with your real company letterhead once
  it's filled in.

## What's intentionally left as a next step (so you know it's not forgotten)

- Real SMS delivery for OTP (Part 5) — works in "demo" mode today.
- Automated backups (Part 6) — the data is safe as long as the server disk is, but
  isn't copied anywhere else yet.
- Multiple admin logins, or a proper "add staff member" flow — right now it's the
  two fixed accounts seeded on first run. If MMJ hires more counter staff and
  wants individual logins per person (useful for tracking who billed what), that's
  a small, well-scoped addition — happy to build it whenever you're ready.

If any part of this guide doesn't match what you're seeing on your hosting
provider's dashboard (they change their UI often), tell me which step and I'll
adjust the instructions.
