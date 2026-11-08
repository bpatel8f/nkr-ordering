# NKR Convenience and Food — Pickup Ordering App (standalone)

A standalone rebuild of the ordering app for NKR Convenience and Food
(BP gas station, 101 W Gridley Rd, Gridley, IL 61744), ready to deploy to
Render. Customers browse the menu, build a cart, pick a pickup time, and
place an order to pay at the counter. The store manages orders in a
kitchen queue and edits the menu, prices, hours, and ordering status in
Store setup.

The Muse copy of this app cannot be exported as code, so this version was
rebuilt from its live data: `data/export.json` holds the 47 menu items and
store settings exported from the Muse app on 2026-11-08 (0 orders existed,
so there was no order history to migrate). The 19 owner food photos in
`public/images/` are the cropped photos the owner sent.

## Stack

- Node 20+ / TypeScript, Express
- Postgres on Render (managed, `render.yaml`); local SQLite fallback for
  testing only (see below)
- Vanilla JS frontend in `public/` — no frontend build step

## Run locally

```bash
npm install
npm run build
npm start          # serves on http://localhost:3000
# or, for development with auto-reload:
npm run dev
```

On first startup the server creates the tables and seeds the menu and
store settings from `data/export.json` (only if the menu is empty, so
re-running never wipes Store setup edits). To re-seed manually:
`npm run seed`. To only run migrations: `npm run migrate`.

Local testing uses SQLite (`./nkr.db`, created automatically) because no
Postgres server is installed on this machine. That SQLite path is for
local verification only — on Render, `DATABASE_URL` is always set and
Postgres is used. Do not deploy the SQLite file anywhere.

End-to-end test (24 checks: storefront, wing sort, PIN gate, order flow,
status flow, menu edit, validation) — start the server with a fresh DB
first, then run `node tests/e2e-test.mjs`.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | On Render (auto-set by `render.yaml`) | Postgres connection string. Unset locally → SQLite file. |
| `SQLITE_PATH` | No | Local SQLite file path (default `./nkr.db`). |
| `STORE_PIN` | Yes, on Render | PIN for the Orders and Store setup tabs. If unset, those tabs are open (local dev only) and the server logs a warning. No PIN is hardcoded anywhere. |
| `TWILIO_ACCOUNT_SID` | Only for SMS | Twilio account SID. |
| `TWILIO_AUTH_TOKEN` | Only for SMS | Twilio auth token. |
| `TWILIO_FROM_NUMBER` | Only for SMS | Your Twilio sending number, E.164 (e.g. `+15551234567`). |
| `TWILIO_ALERT_TO` | No | Comma-separated SMS recipients. Defaults to `+12174189581,+16036745740`. |
| `PORT` | No | Defaults to `3000`; Render sets it automatically. |

SMS alerts: when a new order is placed and all three Twilio variables are
set, the app texts both alert numbers with the order summary. When any of
them is missing, texting is disabled and orders still work normally.
No Twilio credentials are stored in this repo — the owner supplies them
later as environment variables. Note: on a Twilio trial account both
recipient numbers must be verified first, and US business texting needs
A2P 10DLC registration.

## Photos

Owner photos: 19 files in `public/images/` (all menu items except Garlic
Parmesan wings). Garlic Parmesan wings still uses a stock photo — the
image mapping in `src/images.ts` points it at a stock Unsplash photo URL
(`GARLIC_PARMESAN_STOCK_PHOTO`). Swap it for a local file in
`public/images/` as soon as the owner sends a Garlic Parmesan photo.

## Deploy to Render (steps still needed)

1. **Owner creates a Render account** at render.com with a card on file
   (~$13/month: $7 web service + $6 Postgres).
2. **Put this code in a Git repo** (GitHub/GitLab/Bitbucket) and connect it
   to Render, or upload it via Render's repo import. This folder is the
   whole app — no other files are needed.
3. **Deploy from the Blueprint:** Render dashboard → New → Blueprint →
   pick the repo. `render.yaml` creates the `nkr-ordering` web service and
   the `nkr-db` Postgres database and wires `DATABASE_URL` automatically.
4. **Set environment variables** in the service's Environment tab:
   `STORE_PIN` (pick a PIN only the store knows). Optionally the three
   Twilio variables to enable SMS alerts.
5. **Wait for the first deploy.** The server runs migrations and seeds the
   47 menu items and store settings automatically on first startup.
6. **Test end to end:** open the Render URL, place a test order, confirm
   it appears in the Orders tab (after entering the PIN), move it through
   New → Preparing → Ready → Picked up, and confirm the SMS arrives on
   both numbers if Twilio is configured. Delete the test order by marking
   it Cancelled if you don't want it in the queue.
7. **Optional custom domain:** buy a domain (~$10–15/year, e.g.
   `nkrgridley.com`), add it in Render → Settings → Custom Domain, and
   point its DNS at Render. Customers can then open the link in their
   phone browser and "Add to Home Screen" — it looks like an app icon,
   with no App Store download.
8. **After cutover:** disable the old Muse order-alert check
   (`nkr-new-order-alerts` cron) so it stops watching the Muse copy, and
   keep the Muse copy untouched as a backup until the new site is proven.

## API (for reference)

- `GET /api/storefront` — public: settings + menu items (with photo URLs)
- `POST /api/orders` — public: place an order `{customer_name, customer_phone?, pickup_time, notes?, items: [{item_id, qty}]}`
- `POST /api/store/login` — `{pin}` → httpOnly session cookie (12 h)
- `GET /api/store/orders`, `PATCH /api/store/orders/:id` — PIN required
- `GET/POST/PATCH/DELETE /api/store/menu` — PIN required
- `GET/PUT /api/store/settings` — PIN required
