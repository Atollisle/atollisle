# Atoll Isle — Maldives Local Island Guide

A tourist-facing app for Maldives local islands, a self-serve Business Portal for guesthouses/cafés/dive shops/etc., and a Super Admin dashboard — backed by a real API so data is genuinely shared across every device, the same way SeaFare relies on its own server rather than anything stored in a single browser.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The tourist app + Business Portal (one static page) |
| `superadmin.html` | The Super Admin dashboard (separate static page) |
| `server.js` | The backend API both of the above call |
| `package.json` | Backend dependencies (`express`, `cors`, `pg`) |
| `manifest.json` / `sw.js` | Makes `index.html` installable to a phone home screen |

## Why a backend, and what changed

The first few passes of this app used Claude's built-in `window.storage`, which only works while you're previewing the app inside a Claude conversation — it doesn't exist once you download the file and host it yourself. That was fine for a single-device demo, but it silently breaks the moment two different tourists, or a business owner and the Super Admin, need to see the *same* data from different devices — which is exactly what you're asking for now. So this version replaces that layer with `server.js`, a small Express API backed by Postgres, and both `index.html` and `superadmin.html` now talk to it over `fetch`. Device-only preferences (chosen island, language, the $2 tourist unlock) stay in the browser's own `localStorage`, which is the normal, correct choice for a real external site.

## Deploying: GitHub + Render + Neon

This is the exact path for your stack. Total time, first time through: 20–30 minutes.

### 1. Create the Neon database

1. In your Neon project (new or existing — the same account you use for SeaFare is fine, this can be a second project or a second database in the same project), create a new project called something like `atoll-isle`.
2. Once it's created, open **Connection Details** and copy the connection string — it looks like `postgres://user:password@ep-xxxx.neon.tech/dbname?sslmode=require`. You'll paste this into Render in step 3.
3. Nothing else to do here — `server.js` creates its own table (`app_state`) the first time it starts up, so there's no schema to run by hand.

### 2. Push this folder to GitHub

1. Create a new GitHub repo (e.g. `atoll-isle`).
2. Add all the files from this folder — `index.html`, `superadmin.html`, `server.js`, `package.json`, `manifest.json`, `sw.js`, this `README.md`.
3. Commit and push to `main`.

### 3. Deploy the backend on Render

1. In Render, **New → Web Service**, connect the GitHub repo you just pushed.
2. Runtime: **Node**. Build command: `npm install`. Start command: `npm start`.
3. Under **Environment**, add these variables:
   - `DATABASE_URL` → the Neon connection string from step 1
   - `ADMIN_PASSCODE` → a real passcode for the Super Admin dashboard (not the placeholder in the code)
   - `GOOGLE_PLACES_API_KEY` → optional, only if you want Google-sourced listings; leave unset otherwise
4. Deploy. Render gives you a URL like `https://atoll-isle-api.onrender.com` — that's your API's home. Confirm it's alive by visiting `https://atoll-isle-api.onrender.com/api/health` in a browser; it should return `{"ok":true}`.
   - Note: on Render's free tier the service sleeps after inactivity and takes a few seconds to wake up on the next request — the first tourist to open the app after a quiet spell will see a short delay before listings load. Fine for testing; worth a paid instance before you're relying on it for real bookings.

### 4. Point the two frontend files at your live API

Before pushing (or as a follow-up commit), edit one line in **both** `index.html` and `superadmin.html` — search for `API_BASE` near the top of the `<script>` tag:

```js
const API_BASE = "http://localhost:8787";
```

Change it to your Render URL:

```js
const API_BASE = "https://atoll-isle-api.onrender.com";
```

Commit and push that change.

### 5. Serve the frontend from GitHub Pages

1. In the repo's **Settings → Pages**, set the source to the `main` branch, root folder.
2. GitHub gives you a URL like `https://yourusername.github.io/atoll-isle/`. That's the tourist app.
3. The Super Admin dashboard lives at the same domain: `https://yourusername.github.io/atoll-isle/superadmin.html` — don't link to this from the tourist-facing app; keep the URL only with whoever needs it.

### 6. Test end to end

1. Open the GitHub Pages URL, pick an island, confirm listings load (this proves the frontend can reach Render, and Render can reach Neon).
2. Open the Business Portal tab, create a test account, add a listing, confirm it shows up in Explore.
3. Open `superadmin.html`, enter your `ADMIN_PASSCODE`, confirm you can see that test listing and business account.

If any step fails, the browser's dev console (Network tab) will show whether the request is reaching Render at all, or reaching it and getting an error back — that tells you whether the problem is `API_BASE`, CORS, or the Neon connection.

## How it works

- **Tourist app** (`index.html`): boarding-screen island picker — searchable, grouped by atoll (20 atolls, ~165 unique island names) — with a small illustrative atoll map, category-filtered listings that pop up full detail on tap, an events tab, and the $2 Pro unlock (contact details + full events calendar) — all in 8 languages, boarding-screen and app-chrome only. Desktop layout (≥860px) switches to a wider grid with the tabs moved to the top.
- **Island selection is always a search popup, never a dropdown**: every place an island needs picking — the boarding screen, the event form, the add-listing form, the claim-a-listing sheet, and both island pickers in Super Admin — opens the same themed search popup, grouped by atoll with live filtering as you type. One honest limitation: a few island names repeat across different atolls in the real Maldives (e.g. "Meedhoo" exists in three atolls) — the popup shows the atoll next to each result so you can tell them apart when choosing, but a business's stored `island` field is still just the plain name, so two same-named islands in different atolls currently share one listings page. Worth a proper island+atoll compound key if that turns out to matter for real data.
- **Business Portal** (English-only, inside `index.html`): real accounts — sign up with email + password rather than just typing an email. Free accounts list 1 business; **Business Pro** lists up to 10, runs for 30 days, and must be renewed (renewing early adds 30 days to the current expiry rather than resetting it — same rule as SeaFare's Pro periods). I set a placeholder price of $10/30 days since none was given — it's the single `BIZ_PRO_PRICE` constant, a one-line change.
- **Public (Google-sourced) listings**: some businesses can carry `source: "google"` instead of `"owner"` — these represent places found publicly on Google rather than self-listed, spanning six categories (Guesthouses, Hotels & Resorts, Cafés & Restaurants, Excursions & Dive, Shops & Rentals, and a catch-all Attractions & Activities for anything that doesn't fit the other five). Tourists see these free, filtered by island and category, exactly like owner-listed businesses — the only thing Pro unlocks is the contact details. The Super Admin dashboard can **sync one island at a time or all islands in one pass**; either calls Google's Places API and adds any new listings it finds. Needs `GOOGLE_PLACES_API_KEY` set on the server (Google Cloud project with the Places API enabled and billing turned on — that setup is on you, I can't provision it). Without a key, sync simply does nothing; nothing breaks.
- **Claiming a public listing**: a business owner in the Portal can tap **"Claim an existing public listing"** to search unclaimed Google-sourced listings on their island and take ownership of one directly, instead of creating a brand-new listing that would just get flagged as a duplicate afterward. (Claimed listings keep their Google-sourced description for now — there's no edit screen yet, so to change the details an owner would remove the claimed listing and add a fresh one.)
- **Duplicate detection**: as a backstop for owners who add a new listing instead of claiming, the server automatically raises a flag when a new owner listing's name matches an existing Google-sourced listing on the same island. The Super Admin dashboard's **Duplicate Flags** tab shows these with one click to *remove the public listing* or *dismiss* the flag.
- **Super Admin dashboard** (`superadmin.html`): a passcode gate (`ADMIN_PASSCODE` — change it from the default before you deploy), then three tabs — Duplicate Flags, all Businesses (filter by island/source, verify or delete any listing, trigger a Google sync), and Business Accounts (see every account's plan and expiry, and manually grant or extend 30 days of Pro — the same manual-grant pattern SeaFare's Super Admin already uses, since there's no live billing yet).
- **Logo & theme**: a coral atoll-ring-and-dhoni-sail mark, used as the in-app logo and browser favicon on both apps.

## Running it locally (optional, for testing before you deploy)

```
npm install
DATABASE_URL="your-neon-connection-string" ADMIN_PASSCODE=pick-a-real-passcode node server.js
```

Then open `index.html` directly in a browser (its `API_BASE` will need to point at `http://localhost:8787` for this to work, which is the default already in the code).

## Before you launch this for real

1. **Payment.** Both the $2 tourist unlock and the Business Pro subscription are demo checkouts — no card is charged, and nothing auto-renews or auto-expires beyond the date math. Wire in Stripe (Checkout for the one-time $2, Billing for the recurring 30-day plan) before taking real money.
2. **Storage shape.** Postgres is real now, but everything still lives as one JSONB blob (table `app_state`, one row) rather than normalized tables — fine for this scale, but if the app grows the way SeaFare did, split `businesses`, `events`, `bizUsers` etc. into their own tables. `dbRead()`/`dbWrite()` are the only two functions that touch storage, so that's a contained change.
3. **Google Places costs money.** The Places API is metered by Google — check current pricing before syncing many islands/categories repeatedly, and consider caching longer than you'd think (the sync is manual/admin-triggered here specifically so you control when it runs and what it costs).
4. **Admin passcode.** `ADMIN_PASSCODE` gates the whole Super Admin dashboard with a single shared secret — fine to get started, but if more than one person needs admin access, or you want an audit trail of who removed what, that needs real per-admin accounts, not a shared passcode.

## Icons

`manifest.json` references `icon-192.png` and `icon-512.png`, which aren't included — drop in your own logo at those two sizes so the home-screen icon looks right after install.
