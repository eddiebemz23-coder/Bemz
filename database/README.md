# Bemz Africa Marketplace

A production marketplace for Ugandan and Kenyan sellers and buyers: phone-number accounts with SMS
one-time codes, UGX/KES prices stored in integer minor units, delivery priced by district → zone,
MTN Mobile Money / Airtel Money / card collection, cash on delivery, seller stalls with KYC, and an
admin console for moderation, shipping zones, disputes and payouts.

- **Frontend** Next.js 14 App Router + Tailwind CSS (server components read the service layer directly; mutations go through the REST API)
- **Backend** Next.js API route handlers — no separate Express server
- **Database** PostgreSQL + Prisma
- **Auth** NextAuth.js (credentials + phone OTP)
- **Images** Cloudinary (signed uploads; KYC documents in a private folder)
- **Payments** MTN MoMo Open API, Airtel Money (UG + KE), Stripe cards

All money in this codebase is **minor units** (UGX/KES cents, US cents). `src/lib/money.ts` converts
at the edges; nothing else rounds or multiplies.

---

## 1. Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20+ | `engines` in `package.json` |
| PostgreSQL | 14+ (16 recommended) | Docker file provided, or use your own server |
| Docker | optional | only needed for `npm run db:up` |
| Cloudinary account | optional | without it, uploads return a clear 503 |
| MoMo / Airtel / Stripe keys | optional | without them the sandbox rails stand in (see §3) |

## 2. Install and run locally

```bash
git clone <your-fork> bemz && cd bemz
npm install                      # postinstall runs `prisma generate`
cp .env.example .env
```

### 2a. Database

**Option A — Docker (recommended, zero configuration):**

```bash
npm run db:up                    # postgres:16-alpine, user bemz / db bemz_marketplace on :5432
```

The default `.env.example` connection strings already match that container.

**Option B — an existing PostgreSQL server** (e.g. a local PostgreSQL 18 install). The app connects
as role `bemz` with the dev password from the compose file, so create both first — either as
superuser:

```sql
CREATE ROLE bemz LOGIN PASSWORD 'bemz_dev_password' CREATEDB;
CREATE DATABASE bemz_marketplace OWNER bemz;
```

or from a shell:

```bash
psql -U postgres -c "CREATE ROLE bemz LOGIN PASSWORD 'bemz_dev_password' CREATEDB"
psql -U postgres -c "CREATE DATABASE bemz_marketplace OWNER bemz"
```

Then point `DATABASE_URL`/`DIRECT_URL` in `.env` at it. If you already have a role named `bemz` and
authentication fails, that is a password mismatch, not a code problem —
`ALTER ROLE bemz WITH PASSWORD 'bemz_dev_password';` or change the URL, your choice. Never commit
the result.

### 2b. Migrate, seed, run

```bash
npm run db:migrate               # prisma migrate dev — applies prisma/migrations, creates any pending delta
npm run db:seed                  # prisma db seed — idempotent, safe to re-run
npm run dev                      # http://localhost:3000
```

Optional, only if you want the ranked full-text search path (the storefront already works — search
uses `ILIKE` by default):

```bash
npm run db:search                # psql -f prisma/sql/search_vector.sql  (pg_trgm + unaccent + GIN index)
```

That file creates an extension, a trigger and a GIN index. Prisma cannot express any of those, and a
managed Postgres role often lacks `CREATE EXTENSION`, so it is a manual add-on, not part of migrate.

Sanity check before touching the UI: <http://localhost:3000/api/health> reports database reachability
and which payment rails, SMS and uploads are configured.

### 2c. `.env` — only two keys are mandatory

`DATABASE_URL` and `NEXTAUTH_SECRET` (≥16 chars, `openssl rand -base64 32`). Every optional
credential may be left blank: `src/lib/env.ts` reads an empty string as *unset* and switches that
feature off instead of failing to boot. See `.env.example` for the annotated list — it is generated
from the schema, so nothing in it is decorative.

## 3. What works with no third-party accounts

This is what makes the whole flow testable offline. All of it is disabled by `NODE_ENV=production`.

| Surface | Behaviour when unconfigured |
| --- | --- |
| MTN MoMo, Airtel Money, Stripe | `src/lib/payments/sandbox.ts` records the charge as `SUCCEEDED` with reference `SIM-<externalId>`, so checkout completes |
| SMS / WhatsApp (Africa's Talking) | logged as `[sms:simulated] -> <phone>: <body>`, notification row stored `SENT` with `simulated:<id>` |
| Login & COD OTP | `requestOtp` returns `devCode` outside production and the form prints *"Development mode — the code is …"* |
| Cloudinary uploads | signing returns a 503 with an actionable message rather than a fake URL |
| Catalog and KYC photos | shipped in `public/images` so a fresh clone looks like a trading store; replace with supplier photos before launch |

## 4. Demo accounts (`npm run db:seed`)

| Who | Phone | Password | Signs in at |
| --- | --- | --- | --- |
| Platform admin | `+256 700 000 001` | `BemzAdmin!2026` | `/login` → `/admin` |
| Seller — Kampala (Electro Hub Kampala, `electro-hub-kampala`) | `+256 700 000 002` | `BemzDemo!2026` | `/login` → `/seller` |
| Seller — Nairobi (Mitumba Fashion, `mitumba-fashion-nbo`) | `+254 700 000 003` | `BemzDemo!2026` | `/login` → `/seller` |
| Buyer (Brian Kato, one Kampala address on file) | `+256 700 000 009` | none — OTP only | `/login` with the dev code |

Seeded stalls are already `ACTIVE` with approved KYC and live listings, so a buyer can purchase
immediately, and the catalog carries reviews and buyer questions written by eight seeded accounts.
The email addresses are plausible but unmonitored — the seeded accounts authenticate by phone.

## 5. npm scripts

| Command | Does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` | start the Postgres container |
| `npm run db:generate` | regenerate the Prisma client |
| `npm run db:migrate` | `migrate dev` — local: apply + author new migrations |
| `npm run db:deploy` | `migrate deploy` — apply committed migrations only, never prompts (use in CI/production) |
| `npm run db:seed` | seed geography, categories, demo accounts and listings |
| `npm run db:search` | apply the optional tsvector/pg_trgm search SQL |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | **drops the database**, re-migrates, re-seeds |

## 6. Payment rails and webhooks

A rail turns on only when its credentials are present (`availablePaymentProviders` in
`src/lib/env.ts`): MTN needs `API_USER` + `API_SECRET` + `SUBSCRIPTION_KEY`; Airtel needs a client ID
for either country; Stripe needs `STRIPE_SECRET_KEY`; cash on delivery is the `COD_ENABLED` flag.

Every rail reports to the same handler family, and each URL is verified against that rail's own
secret:

```text
POST /api/webhooks/payments/mtn-momo
POST /api/webhooks/payments/airtel-ug
POST /api/webhooks/payments/airtel-ke
POST /api/webhooks/payments/stripe
```

Configure them as:

- `MTN_MOMO_CALLBACK_BASE_URL` = `https://<domain>/api/webhooks` — the **directory**, not a full
  endpoint. Airtel's per-transaction notification URL is built by appending `/airtel-ug` or
  `/airtel-ke` to it. MTN takes no per-transaction URL; register
  `https://<domain>/api/webhooks/payments/mtn-momo` as the callback host in the MoMo developer portal.
- Stripe: create the webhook on that endpoint and copy its signing secret into
  `STRIPE_WEBHOOK_SECRET`.

Three behaviours worth knowing when a callback "does nothing": the body is read as raw **text**
(signatures are computed over the exact bytes, so re-serialising JSON breaks verification); an
event referencing an unknown payment is recorded and answered `200`, because a `4xx` makes an
operator retry for hours; a bad signature gets `401` and is never applied. Payloads over 100 KB are
rejected outright.

## 7. Scheduled sweep

Reserved stock is released by an idempotent housekeeping job. Without it, an abandoned checkout pins
inventory and an unpaid order sits on the seller's dashboard forever.

```bash
curl -X POST https://<domain>/api/ops/expire-orders \
  -H "Authorization: Bearer <OPS_SWEEP_TOKEN>"
```

It also expires payments whose PIN window closed. Route is `POST` only — a browser or GET cron will
get 405. Without `OPS_SWEEP_TOKEN` only a signed-in admin session can trigger it (the admin dashboard
has a button for it). Run every 5–15 minutes; see §8 for the GitHub Actions form Vercel needs.

## 8. Deploying to Vercel + Neon (or Supabase)

### 8a. Hosted PostgreSQL

The app needs **two** connection strings, because `prisma/schema.prisma` declares
`directUrl = env("DIRECT_URL")` so that DDL never goes through a transaction pooler —
`prisma migrate deploy` cannot run `ALTER TABLE` inside one.

**Neon (free tier)**

1. Create a project, then on its **Connection details** page copy both forms of the URI:
   - the one whose host ends in `-pooler` (e.g. `ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb`)
     with `?pgbouncer=true&pool_mode=transaction&connect_timeout=15` → `DATABASE_URL`
   - the direct branch endpoint (same host without `-pooler`) → `DIRECT_URL`
2. Keep `sslmode=require` and `?schema=public` on both. Neon calls its default database `neondb`;
   the app does not care what the database is named.
3. To load the demo catalog once, run `npm run db:seed` from your machine against the direct URL.

**Supabase (free tier)**

1. **Database → Connection strings**: the **pooled** URI (port `6543`,
   `?pgbouncer=true&connection_limit=1`) becomes `DATABASE_URL`, the **direct session** URI (port
   `5432`) becomes `DIRECT_URL`.
2. Add Vercel's ranges under **Settings → Network**, or stay on the pooled default.
3. For the ranked search path run `prisma/sql/search_vector.sql` in the Supabase **SQL editor** —
   the `postgres` role there has `CREATE EXTENSION`, the app role usually does not. On Neon, run it in
   the **SQL Editor** the same way.

### 8b. Migrations are already committed

`prisma/migrations/` contains `0_init` plus `20261030203202_marketplace_delta` (the `ReviewVote`
table, the `PayoutProvider` enum, the KYC identity columns, the payout/review `AdminAction` values),
so `npx prisma migrate deploy` builds the entire schema on an empty database with nothing left to
generate. When you change `schema.prisma` later, author the next migration locally
(`npm run db:migrate -- --name my_change`), commit the folder it writes, and the deploy picks it up:
`migrate deploy` never invents a migration, so an uncommitted schema change simply does not exist in
production.

### 8c. Vercel project

1. Import the repository. Framework is detected as Next.js. Set **Build Command** to
   `npx prisma generate && npx prisma migrate deploy && npm run build` — `postinstall` already
   generates the client, but naming it in the build command makes the order explicit and fails the
   deploy loudly if a migration cannot apply. Output directory stays `.next`.
2. **Settings → Environment Variables** (Production *and* Preview):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | pooled URL (Neon `-pooler` host / Supabase port 6543), `?schema=public` |
   | `DIRECT_URL` | direct session URL — required, migrations run through it |
   | `NEXTAUTH_SECRET` | fresh `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | `https://<vercel-domain>` |
   | `NEXT_PUBLIC_APP_URL` | `https://<vercel-domain>` |
   | `NODE_ENV` | leave unset — Vercel sets `production` for builds |
   | `MTN_MOMO_CALLBACK_BASE_URL` | `https://<vercel-domain>/api/webhooks` |
   | rail credentials | `MTN_MOMO_*`, `AIRTEL_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLOUDINARY_*`, `AFRICASTALKING_*` |
   | `COD_ENABLED`, `PLATFORM_COMMISSION_DEFAULT_BPS`, `SELLER_PAYOUT_MIN_MINOR`, `SELLER_SETTLEMENT_DELAY_DAYS` | your economics |
   | `OPS_SWEEP_TOKEN` | ≥16 random chars |

   Anything whose value must not reach a browser must **not** start with `NEXT_PUBLIC_` — those are
   inlined into the bundle at build time. `NEXT_PUBLIC_APP_URL` is baked into the build, so a new
   domain needs a rebuild, not just a variable edit.
3. Migrations at deploy time: Vercel has no database-level hook that runs for you, so pick one —
   - build command `npx prisma migrate deploy && next build`, or
   - GitHub Actions on push to `main` running `npx prisma migrate deploy` with `DIRECT_URL`.

   Never add `db:seed` to a deploy: it upserts demo stalls, demo reviews and demo accounts.
4. Register the four webhook URLs (§6) with each provider once the domain is live, then check
   `GET /api/health` — it lists which rails are actually configured.
5. Cron. **Vercel Cron only issues `GET`**, and the sweep is `POST`-only, so use a scheduled
   workflow instead:

   ```yaml
   # .github/workflows/bemz-sweep.yml  (committed)
   name: Release expired reservations
   on:
     schedule:
       - cron: "*/10 * * * *"
     workflow_dispatch:
   jobs:
     sweep:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl -fsS -X POST "${{ vars.BEMZ_APP_URL }}/api/ops/expire-orders" \
               -H "Authorization: Bearer ${{ secrets.BEMZ_OPS_SWEEP_TOKEN }}"
   ```

   Define both on the GitHub repo: **Settings → Secrets and variables → Actions → New repository
   secret** `BEMZ_OPS_SWEEP_TOKEN` (same value as the `OPS_SWEEP_TOKEN` env var) and **Variables**
   `BEMZ_APP_URL` = `https://<vercel-domain>`. The action checks out no code, so it needs neither the
   database nor `node_modules`. `workflow_dispatch` lets you run it by hand from the Actions tab. If you would rather use native Vercel Cron, the route needs a `GET` export added; that is a
   deliberate code change, not a configuration.
6. HTTPS is assumed everywhere: `next.config.mjs` adds HSTS only when `NODE_ENV=production`, and
   providers reject non-TLS callback URLs.

### 8d. Scaling caveat

`src/lib/rate-limit.ts` is a fixed-window counter held in each process's memory, which is *not*
correct across multiple serverless instances — an attacker simply hits a cold one. It is adequate for
the demo; before real traffic, set `RATE_LIMIT_REDIS_URL` and swap `consume` for an atomic
`INCR`/`EXPIRE` as its header comment describes.

## 9. End-to-end test checklist

Run through once with no credentials at all — every step below works in the local sandbox. Buy in
UGX (Kampala) and repeat one order in KES (Nairobi) to exercise currency handling.

### 9a. Register

- [ ] `/register` → name, `+256…`/`+254…` phone, password, tick terms. Check *Sell on Bemz*
      (`/register?role=seller`) to open a stall in the same request.
- [ ] OTP appears on screen ("Development mode — the code is …"). Wrong code is refused; five
      attempts lock the code out; resend is throttled by `OTP_RESEND_COOLDOWN_SECONDS`.
- [ ] Signed in → `/account` shows the verified phone and the market's currency.
- [ ] `/login` with `+256 700 000 009` and **no password** (OTP-only buyer) succeeds.
- [ ] A suspended or banned account cannot sign in (test later in §9f).

### 9b. Add product

- [ ] Seller signs in (`+256 700 000 002`). `/seller` opens; a buyer who visits `/seller` is walked
      to `/seller/open`.
- [ ] New stall: `/seller/open` → district, fulfilment, dispatch SLA → status `PENDING`.
- [ ] KYC: `/seller/shop` uploads a national ID (a real file needs Cloudinary; without credentials
      expect the honest 503, which is the correct result). A `PENDING` stall goes live **only** when
      a reviewer approves — never on submission.
- [ ] Admin: `/admin/queues?tab=kyc` → open the case → documents open through freshly signed
      five-minute URLs → **Approve**. The stall flips to `ACTIVE`, the seller gets an in-app
      notification, and the audit trail records `KYC_APPROVE` with the reason.
- [ ] `/seller/products/new` → title, price in UGX/KES, variants with stock, category (a KYC-gated
      category such as phones is greyed out until documents are approved), photo, **Publish**.
- [ ] Status is `ACTIVE` immediately for an approved stall in an ungated category; otherwise
      `PENDING_REVIEW`. A `DRAFT` that is later PATCHed to `ACTIVE` is pushed back into the queue —
      moderation cannot be skipped by editing.
- [ ] `/admin/queues` → approve or reject the listing; rejection stores a reason the seller reads.
- [ ] The listing appears on `/shop/<slug>`, `/search`, and `/product/<shopSlug>/<productSlug>`. A
      `PENDING_REVIEW` item is readable by its link but never buyable.

### 9c. Add to cart

- [ ] Guest: product page → quantity/variant → *Add to cart*; the header badge and `/cart` agree.
- [ ] Sign in mid-session → the guest basket merges into the account cart (no duplicate lines).
- [ ] A line above `maxQuantityPerOrder`, or a shop on vacation mode, shows as blocked, not silent.
- [ ] Coupon field: a valid code reduces the subtotal; an expired or wrong-currency code explains why.

### 9d. Pay

- [ ] `/checkout` → pick or create a delivery address (district + subcounty + landmark).
- [ ] Shipping line matches the zone the district belongs to (`/admin/zones`): base fee, free-over
      threshold, ETA band. A district with no zone blocks the order with a clear reason.
- [ ] Order is split per shop — two stalls produce two orders under one group reference.
- [ ] **Cash on delivery:** place order → `/checkout/<groupId>` → confirm each order with the OTP
      printed on the page → status `AWAITING_CONFIRMATION`. Nothing is charged now.
- [ ] **MTN MoMo:** enter the payer number, confirm. Sandbox answers `SUCCEEDED` with `SIM-…`; with
      live credentials the handset gets the PIN prompt, the order stays pending until
      `/api/webhooks/payments/mtn-momo` lands.
- [ ] **Airtel / Stripe:** same rail, same receipt page. After a card payment the browser must return
      to `/checkout/<groupId>`, not a 404.
- [ ] The receipt polls payment status without a refresh; leave it open through a sandbox prompt.
- [ ] Abandon a checkout on purpose, then run the sweep (§7) → stock is released and the order is
      `EXPIRED`/`CANCELLED`, not stuck holding inventory.

### 9e. Order

- [ ] Buyer: `/orders` lists the group and each order; `/orders/<id>` shows items, totals, tracking
      number and the status timeline.
- [ ] Seller: `/seller/orders` → **Confirm** → **Packed** → **Out for delivery** → **Delivered**.
      `PACKED` may also jump straight to `Delivered` (a seller who hand-carries it), but no other
      shortcut exists — going backwards, or acting on another shop's order, is refused. Cancelling
      stays possible for the seller until `PACKED`, which is the point where stock is committed.
- [ ] Buyer: a delivered order allows a review with star rating; the review appears once published
      (`/admin/queues?tab=reviews`).
- [ ] Refund path: a paid, undelivered order can be refunded; the payment row records `REFUNDED` and
      the audit trail records `ORDER_REFUND`.

### 9f. Money out (the part usually left broken)

- [ ] Wait out `SELLER_SETTLEMENT_DELAY_DAYS` (or set it to `0` and re-seed for the test) so
      delivered sales become withdrawable.
- [ ] `/seller/payouts`: the balance shown is a **period**, never an amount the seller types — pick
      the window and request it. Below `SELLER_PAYOUT_MIN_MINOR` the button correctly has nothing to
      send. Cash on delivery never enters a payout.
- [ ] `/admin/payouts`: the queue shows amount, rail, account and `kycBlocked`. An unverified stall is
      refused approval by the server, not just greyed out.
- [ ] **Approve**, then book the unique `providerReference` and mark **Sent**. Only then do
      `Shop.totalSalesCount` / `totalSalesMinor` move — they count settled payouts, which is why the
      admin labels say "payouts settled".
- [ ] Fail or reverse one payout deliberately and confirm the seller sees the reason.
- [ ] `/admin/audit` now holds a row for every decision above, each with its reason, before/after
      snapshot and the actor who made it.

### 9g. Guard rails worth probing

- [ ] `GET /api/health` — database `ok`, and each rail's configured state.
- [ ] Buyer tries `/seller` or `/admin` → redirected / 404, never a dashboard with empty data.
- [ ] Seller PATCHes another shop's product → 403. Admin routes with a seller session → 403.
- [ ] Webhook with a broken signature → 401 and no state change.
- [ ] Two browsers ordering the last unit at once → one succeeds, the other is told stock ran out.

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Invalid environment configuration: - databaseUrl: DATABASE_URL is required` | No `.env`, or the file is not where Next starts. `cp .env.example .env`. |
| `Authentication failed for user bemz` when migrating/seed/building | Role password does not match `DATABASE_URL`. `ALTER ROLE bemz WITH PASSWORD 'bemz_dev_password';` or edit the URL. `next build` prerenders `/`, so it fails here too — that is the same DB, not a page bug. |
| `P3009` / stuck migration | A migration failed half-applied: `npx prisma migrate resolve --rolled-back <name>` then re-run. |
| Uploads always fail with 503 | `CLOUDINARY_*` unset, or `CLOUDINARY_UPLOAD_PRESET` names a preset that is not `upload_type=signed`. |
| Payment "succeeds" instantly | Expected: no credentials + non-production = sandbox. It writes `SIM-…` references. In production the same request throws `503 … not configured`. |
| OTP never arrives | Expected without Africa's Talking; read `devCode` from the form, or query the `Notification` table for `simulated:%` rows. |
| Provider callbacks never reach the app | `MTN_MOMO_CALLBACK_BASE_URL` set to a full endpoint instead of `/api/webhooks`, the URL is not HTTPS, or the portal's registered host is stale. |
| Payout balance is empty despite sales | The settlement delay has not elapsed, or the orders are not `DELIVERED`, or the sale was cash on delivery. |

## 11. Before go-live

1. Replace `public/images/products` and `public/images/kyc` with real supplier and specimen
   photography, or drop the demo rows entirely (`prisma/seed.ts` is the only writer).
2. Rotate `NEXTAUTH_SECRET` per environment; never share one between staging and production.
3. Set `SELLER_SETTLEMENT_DELAY_DAYS`, `PLATFORM_COMMISSION_DEFAULT_BPS` and
   `SELLER_PAYOUT_MIN_MINOR` to the business decision, not the seed default (that
   `SELLER_PAYOUT_MIN_MINOR=10000000` is UGX 100,000, since amounts are minor units).
4. Move rate limiting to Redis (§8d) before multiple instances.
5. Payout disbursement stays manual by design: the platform holds collection credentials only, so
   finance pays from the operator portal and books the reference here. If you later add a payout API,
   `markPayoutSent` is the single place that must stay idempotent on `providerReference`.
