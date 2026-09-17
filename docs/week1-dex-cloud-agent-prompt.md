# Cloud agent prompt — CarrierEdge week-1 (activation + CTA + onboarding)

**Repo:** https://github.com/Hariskode/CarrierEdge
**Working tree note:** Founder's Mac may have local uncommitted edits on `main` (`app.html`, `CHANGELOG.md`, `manifest.json`, deleted `.wranglerignore`). Prefer branch from `origin/main`; do not clobber unrelated local-only work you cannot see. Open a PR; **do not deploy** (`wrangler deploy` is founder-only after "ship").

**PR scope (same PR is intentional):** (A) Lemon Squeezy webhook → KV activation + `/activate` + `/set-password`, (B) public CTA href fixes, (C) first-run onboarding soft-skip. Monolithic `app.html` + `worker.js` — one PR is sane. Do **not** implement follow-on tickets listed at the bottom.

## Outcome
A stranger who pays on Lemon Squeezy can reach `/app` with **zero founder/admin action**. Public factoring/marketing CTAs never dump unpaid users on `/login`. A first-run user is guided through 3 loads → RPM vs floor → factoring all-in, with other nav behind More (soft skip).

## Problem (verify in repo; do not treat as gospel)
Today Worker gates `/app` and `/app.html` on `ce_session`. KV `user:{email}` is created only via owner `/admin`. Lemon Squeezy license validate/activate is **client-side** in Settings → Membership (`activateLicense` → `api.lemonsqueezy.com`), which is unreachable until already logged in. There is no Worker LS webhook. `factoring-index.html` CTAs href `app.html` → 302 `/login`. Onboarding wizard (`ce_onboarded`) is business-profile only, not loads/RPM/factoring.

**Founder-approved architecture pick:** **KV account via Lemon Squeezy webhook**. License key = Membership badge/receipt only, **not** the session gate. Reuse email+password + PBKDF2 100k + JWT `ce_session`.

## A) Activation (worker.js + minimal public pages)
### Webhook
- Add `POST /api/webhooks/lemonsqueezy` as a **public** route (must be exempt from the catch-all `/api/*` session 401 — route it **before** the gate).
- Verify Lemon Squeezy signature with Worker secret `LEMONSQUEEZY_WEBHOOK_SECRET` (document that founder must set the secret in Cloudflare; **do not commit secret values**).
- Handle at least: `subscription_created` / `order_created` → upsert `user:{email}` with `role:subscriber`, `subExpiry` from period end, LS customer/subscription ids; new users get a one-time `setPasswordToken` (TTL ≤24h, store hash of token not raw if practical).
- `subscription_payment_success` / `subscription_updated` → refresh `subExpiry`/status.
- `subscription_cancelled` / `subscription_expired` / relevant payment-failed → mark expired (existing login already supports `?error=expired` when past `subExpiry`).
- `license_key_created` (if present) → store license on user for Membership display; **does not** grant session alone.
- Filter to CarrierEdge product/variant if multiple products exist in the store.
- Idempotent upserts; safe on webhook retries.

### Set password
- Public `/set-password?token=…` page + Worker handler: validate token, set password with **PBKDF2 iterations exactly 100000** (never higher), clear token, set `ce_session`, redirect `/app`.
- How the buyer gets the link: document a practical path (e.g. include set-password URL in webhook processing notes / admin-visible field, or LS custom thank-you URL with token if feasible). Prefer a path that does not require founder emailing them. If email send from Worker is out of scope, implement token issuance + `/activate` path that can complete the loop without founder, and document the gap clearly in the PR.

### `/activate` fallback (required)
- Public page: email + Lemon Squeezy license key.
- Worker validates license **server-side** using Worker secret `LEMONSQUEEZY_API_KEY` (or equivalent — do not put LS API keys in `app.html`).
- Upsert KV user; if no password yet → issue set-password flow; if password exists → allow login (or set session after password confirm — pick the safer UX and document it).
- This replaces “Haris adds them in admin” for support/missed webhooks.

### Membership
- Keep Settings → Membership Activate Key as sync/badge to LS instance; it must **not** be the only way to unlock the app.
- Do not remove `/admin` in this PR.

## B) CTA fix (must be in this PR)
In `factoring-index.html`, change every product CTA that currently hrefs `app.html` to **`/pricing`**. **Never** `/login`, `/app`, or `app.html`.
In `index.html`, fix footer (or any) “App” link that points at `./app.html` the same way → `/pricing`.
Done when: unpaid click path from factoring index never lands on `/login`.

## C) First-run onboarding (same PR)
Repurpose existing `#onboarding-overlay` / `ce_onboarded` flow (do not add a new module).
1. Guide entry of **3 loads** in existing Loads/P&L UI.
2. Show **RPM vs floor** using existing Target RPM / `mktFloor` concepts.
3. Show **factoring all-in** on one of those loads using existing Factoring UI/math.
4. Then set `ce_onboarded` and land on Home/Loads.
**Soft skip** (founder-approved): user can dismiss; still set `ce_onboarded`.
Nav: keep Field-style primary chrome; other tools stay behind **More**.

## Hard rules (non-negotiable)
1. Do **not** start live daemons; no long-running local servers.
2. Do **not** run `wrangler deploy` — open a PR only.
3. On every change to `app.html` or `sw.js`, **bump** `sw.js` `CACHE` version.
4. Keep `run_worker_first = true` in `wrangler.toml`.
5. PBKDF2 **≤ 100000** iterations (keep 100000).
6. **Never commit secrets**.
7. **No new modules**.
8. `app.html` must remain `Cache-Control: private, no-store` for gated app responses.

## Acceptance checks
- [ ] New paid email can obtain a KV user without `/admin`
- [ ] `/activate` works as fallback without founder
- [ ] `/set-password` sets PBKDF2-100k password and issues `ce_session`
- [ ] Webhook route is public; other `/api/*` stay gated
- [ ] `factoring-index.html` + index App CTAs → `/pricing` only
- [ ] First-run: 3 loads → RPM vs floor → factoring all-in; soft skip; `ce_onboarded`
- [ ] `sw.js` cache bumped if app/sw touched; `run_worker_first` unchanged; no secrets in diff
- [ ] PR opened; **no deploy**

## Follow-on tickets — DO NOT implement in this PR
1. Displayed factoring rates mismatch — Porter / Riviera / Triumph / OTR / RTS / Thunder.
2. Scout best-factor v1: All-In $ sort; transparency gate; NR/exit flags; source-date; QuickPay column; SEO; anti rank-for-pay.
