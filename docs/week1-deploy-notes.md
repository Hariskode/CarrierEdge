# Week-1 deploy notes (founder)

**Do not deploy until you say ship.** PR only from Dex.

## Cloudflare Worker secrets to set (names only — never commit values)

| Secret | Purpose |
|--------|---------|
| `LEMONSQUEEZY_WEBHOOK_SECRET` | HMAC signing secret from LS → Settings → Webhooks |
| `LEMONSQUEEZY_API_KEY` | Optional; improves server-side license validate |
| Existing | `OWNER_EMAIL`, `OWNER_PASS`, `SESSION_SECRET`, `FMCSA_KEY`, … |

## Lemon Squeezy webhook

- URL: `https://carrieredge.io/api/webhooks/lemonsqueezy`
- Events: `order_created`, `subscription_created`, `subscription_updated`, `subscription_payment_success`, `subscription_cancelled`, `subscription_expired`, `subscription_payment_failed`, `license_key_created` (as available)
- Buyer path without email send from Worker: after checkout, use **/activate** (email + license key) → **/set-password** → `/app`

## Hard rules

- `run_worker_first = true`
- PBKDF2 100k
- Bump `sw.js` on app/sw changes (this PR → `carrieredge-v10`)
- No secrets in git
