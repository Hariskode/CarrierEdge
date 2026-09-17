# CarrierEdge week-1 specs (Dex → Rex)
Status: DRAFT for founder approve. No cloud agent / no deploy until activation spec is approved.
Repo truth: `/Users/hkpro/CarrierEdge` (worker.js gates `/app` + `/app.html`; live may lag deploy).
Date: 2026-09-16 PT

---

## 1) Activation spec — Lemon Squeezy → stranger reaches `/app` without Haris

### Problem (today)
- Worker gate: no `ce_session` → `/app` and `/app.html` redirect to `/login`.
- Accounts: KV `user:{email}` created only via owner `/admin` (or owner bypass secrets).
- Lemon Squeezy license validate/activate lives **client-side** in Settings → Membership (`activateLicense()` → `api.lemonsqueezy.com/v1/licenses/*`, stored as `ce_license` in CEDB).
- Catch-22: stranger pays on LS, gets a key, but cannot reach Membership without a KV login Haris creates by hand.
- Worker has **no** `/api/webhooks/lemonsqueezy` (or any LS server path).

### Pick: **KV account via Lemon Squeezy webhook** (not license-key-as-login)
License key stays a **receipt / Membership badge** only. Worker auth source of truth remains email+password in `CE_AUTH` KV (PBKDF2 100k, JWT `ce_session`). Webhook is what removes the founder from the loop.

Why not license-key-as-login: would rewire the whole gate, admin, and session model; webhook→KV reuses what already works.

### Events (listen + verify signature)
| LS event | Action |
|----------|--------|
| `subscription_created` / `order_created` (product = CarrierEdge) | Upsert `user:{email}` with `role:subscriber`, `subExpiry` from LS period end, `lsCustomerId`, `lsSubscriptionId`; if new user → set one-time `setPasswordToken` (TTL ≤24h) |
| `subscription_payment_success` / `subscription_updated` | Refresh `subExpiry` / status |
| `subscription_cancelled` / `subscription_expired` / `subscription_payment_failed` (policy TBD) | Mark expired or grace; login already redirects `?error=expired` when `subExpiry` past |
| `license_key_created` (if used) | Store `lsLicenseKey` on user record for Membership display — **does not** grant session alone |

Endpoint: `POST /api/webhooks/lemonsqueezy` — **public** (exempt from session 401). Verify `X-Signature` with `LEMONSQUEEZY_WEBHOOK_SECRET` Worker secret. Never log full payloads with PII to client.

### Login UX
1. Checkout → LS confirmation email (existing) + CarrierEdge set-password link: `/set-password?token=…` (new public page).
2. Buyer sets password → Worker hashes PBKDF2 100k → clears token → sets `ce_session` → redirect `/app`.
3. Later visits: `/login` email+password as today → `/app.html`.
4. **Fallback (webhook miss / existing buyers):** public `/activate` — paste LS license key + email → Worker validates license **server-side** (LS API with secret) → upserts KV user → same set-password or immediate session if password already exists. This replaces “Haris adds them in admin” for support.
5. Settings → Membership: show status from KV/`ce_license`; keep Activate Key as sync to LS instance id, not as the gate.

### Factoring CTA redirect (must ship with activation or before)
See §2 — unpaid must never land on `/login` from public factoring pages.

### Out of scope this week
- Changing PBKDF2, removing admin, Stripe, new modules, cloud agent implementation until founder yes on this spec.

### Done when
- Paid LS buyer (new email) can reach `/app` with zero founder action.
- Replay/miss path works via `/activate`.
- Founder yes recorded before any cloud agent / wrangler deploy.

---

## 2) CTA fix note — factoring-index must not dump unpaid on `/login`

### Bug
`factoring-index.html` is public (`Free · No Signup`) but every product CTA href is `app.html`:

| ~Line | Text | href today |
|------|------|------------|
| 296 | Upgrade to CarrierEdge Full Suite → | `app.html` |
| 503 | Try CarrierEdge Free → | `app.html` |
| 545 | Upgrade to CarrierEdge | `app.html` |
| 557 / 631 / 845 / 962 | Try CarrierEdge… | `app.html` |

Worker: no session on `/app.html` → **302 `/login`**. Unpaid users from the factoring wedge hit a brick wall.

### Fix (minimal)
- Point all of the above to **`/pricing`** (LS checkout / trial) — primary.
- Optional secondary: one CTA to a **public demo** if we keep a ungated demo URL; do **not** invent a new module. Prefer `/pricing` until demo is explicit.
- Do **not** link public CTAs to `/login` or `/app` / `app.html`.
- Mirror check: `index.html` footer “App” → `./app.html` has the same dump; change to `/pricing` or remove from public footer.

### Done when
- From `factoring-index.html`, unpaid click path never shows `/login`.

---

## 3) First-run onboarding sketch — 3 loads → RPM vs floor → factoring all-in

### Today
- Overlay `#onboarding-overlay`, flag `ce_onboarded` in CEDB.
- Steps: business name/freight → DOT/MC/state/trucks → review. Skip allowed.
- Field nav already has **More** drawer (Credit, Workflow, Compliance, Factoring, Repair, Fuel, IFTA, Settings).

### Target first-run (replace/repurpose wizard; no new modules)
1. **3 loads** — guided entry of three loads in existing Loads/P&L (pickup, delivery, miles, rate). Progress “1/3…3/3”.
2. **RPM vs floor** — show computed RPM vs Settings Target RPM / market floor (`mktFloor` already used in factoring negotiation). One clear go/no-go call on those loads.
3. **Factoring all-in** — open existing Factoring all-in / advance cost on one of those loads (fee + days + net). CTA: “This is what the money actually costs.”

Then set `ce_onboarded` and land on Home/Loads.

### Nav during first-run
- Primary: Home / Loads / (Factoring only when step 3) — keep Field bottom bar.
- Everything else stays behind **More** (already true for Factoring etc.; ensure first-run does not dump users into Market Sonar / News / full suite chrome).
- Skip: allowed but soft-nudge once; still sets `ce_onboarded` if they dismiss (same as today) — product call for founder: skip = soft or hard gate after step 1.

### Done when
- New paid user who finishes onboarding has entered 3 loads, seen RPM vs floor, and seen factoring all-in once — without touring every module.

---

## 4) Hard rules Dex will not violate

1. **No live daemons** on the founder MacBook (no local long-running servers for CarrierEdge).
2. **Deploy only via** `npx wrangler deploy` from `/Users/hkpro/CarrierEdge` — and only after founder yes.
3. **Bump `sw.js` cache** on every `app.html` / `sw.js` change (currently `carrieredge-v9` → next `carrieredge-v10`, etc.).
4. **Keep `run_worker_first = true`** in `wrangler.toml` `[assets]` — required for auth gating.
5. **PBKDF2 ≤ 100k iterations** (worker.js uses `iterations:100000`; 150k → Worker `NotSupportedError` / 1101).
6. **Never commit secrets** — Worker secrets (`OWNER_*`, `SESSION_SECRET`, future `LEMONSQUEEZY_*`) stay in Cloudflare only; `.env` is gitignored. Do not paste secrets into prompts, PRs, or chat specs.
7. **No new modules** until 50 paying users (priority #5).
8. **No Cursor cloud agent / no deploy** for activation work until founder approves this activation spec.

---

## Ask of founder (via Rex)
Approve §1 pick (webhook→KV + `/activate` fallback) and §2/§3 direction. On yes, Dex will hand a clean cloud-agent prompt (still no ship without explicit deploy yes).
