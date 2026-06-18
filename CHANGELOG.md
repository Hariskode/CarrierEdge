# CarrierEdge Changelog

All notable changes to CarrierEdge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project aims for semantic versioning once v1.0 is declared.

---

## [Unreleased] — v1.0 Stabilization Phase ✓

### Phase 3 — Monetization (2026-06)

**Factoring Index — free standalone tool (`factoring-index.html`)**
- Self-contained single-file site with CarrierEdge branding — no login, no data stored
- Rate Benchmarks tab: full comparison table (Triumph, OTR, Porter, RTS, Thunder, Riviera) with contract terms, red flags, and volume-rate chart
- All-In Cost Engine tab: manual inputs → per-company true cost breakdown including all hidden fees, ranked by effective monthly cost
- Should I Factor? tab: manual cash flow inputs → verdict (factor/skip/selective), key metrics, and cash flow timeline
- Negotiation Script tab: situation inputs → power score, leverage points, phone or email script with target rate and annual savings figure
- Education tab: recourse vs non-recourse explainer, fee glossary, due-diligence question list, factor-vs-self-collect decision framework
- "Upgrade to CarrierEdge" CTAs throughout linking to `index.html`

**Member gate in CarrierEdge full suite (`index.html`)**
- `APP.isMember` flag; `checkMembership()` runs at startup, reads `ce_license` from CEDB
- `validateLicense(key)`: calls Lemon Squeezy `/v1/licenses/validate`; caches result 24h; falls back to cache on network error
- Membership card added to Settings: license key input, Activate button, status display, Subscribe link
- Soft gate overlays on three premium sections: Invoice Factoring Pipeline, CE Partner Offers, Negotiation Intelligence
- Gate is `position:absolute` with `backdrop-filter:blur` — section is visible but non-interactive; overlay shows feature description + upgrade CTA
- All-In Cost Engine and SIF remain free (no gate) — the full-suite versions use profile sync vs. manual inputs in the free tool

### Phase 2 — IndexedDB Migration (2026-06)

**Phase 1.1 — Import/Export + portable full backup**
- Backup & Restore card in Settings with Export / Import buttons and "Include API keys" toggle
- `exportBackup()`: serializes all 13 data keys into a `.carrieredge` JSON envelope with metadata
- `importBackup()`: validates file, shows record-count summary, restores all keys and reloads

**Phase 1.2 — AI integration repair**
- New `callAI(messages, options)` helper: single copy of headers, model, 25s timeout, structured error parsing
- All four AI call sites (main advisor, rate negotiation, terminal panel, intelligence sidebar) now route through `callAI`
- Eliminated missing timeout on the main AI chat and 4 copy-pasted Anthropic fetch patterns

**Phase 1.3 — Data durability + backup UI polish**
- Last-backup tracking via `ce_last_backup` in localStorage
- Dynamic backup card: live record counts (loads, expenses, trucks, invoices, IFTA trips)
- "BACKUP OVERDUE" badge + color-coded age label when no backup taken in >7 days
- `index.html` synced as primary app file; README updated to reflect completed phases

**Phase 1.4 — PWA manifest + service worker**
- `manifest.json`: name, icons, theme/background colors, standalone display, categories
- `sw.js`: cache-first shell caching for offline use; stale-while-revalidate keeps it fresh; external API calls never intercepted
- HTML head: theme-color, apple-mobile-web-app meta tags, manifest link
- App is now installable from Chrome/Edge and works offline

**Phase 1.5 — Quality pass**
- Fixed undefined CSS variables (`--card-bg`, `--text1`, `--accent`) introduced in Phase 1.1/1.3
- Consolidated two `DOMContentLoaded` listeners into one clean init sequence
- CHANGELOG updated to document Phase 1 completion

---

## [0.55] — 2026-05 (Prototype Baseline)

**Artifact**: `carrieredge-pl_55.html` (7,965 lines, 516 KB)

This version represents ~55 iterative snapshots developed as a single massive HTML file. It is the feature-complete but architecturally exhausted prototype that became the v1.0 baseline.

### Major capabilities present at baseline
- 16 distinct pages / 6 logical sections
- 182 JavaScript functions
- Rich 60-day demo dataset for "Williams Freight LLC"
- Full P&L CRUD + analytics + CSV export
- Sophisticated factoring offer engine + SIF + All-In calculators
- Real FMCSA SAFER integration (with key + demo fallback)
- Real EIA diesel price integration + auto-refresh
- Two Claude AI integration points (Repair Pricing + Intelligence layout)
- Four complete UI personalities (Terminal, Command, Field, Intelligence)
- Fleet Tracker with manual check-in + status + placeholder map
- Edge Workflow (invoices, chargebacks, DSO)
- Load Operations with cost-basis logic
- IFTA state log + quarterly worksheet generator
- Finance Hub, Business Hub, Credit Check, Market Hub
- Comprehensive Settings with 10+ optional API integrations documented
- Excellent visual design (Syne + JetBrains Mono, dark theme, cards, KPIs, tables)

### Known limitations at baseline (addressed in Phase 1+)
- Single 8k-line file past maintainability threshold
- No versioned releases or update story (55 full copies in Downloads)
- No structured Import/Export or backup UI
- AI features use deprecated direct-browser Anthropic calls (fragile)
- No PWA manifest or service worker
- Inconsistent depth across some pages
- No automated tests
- No proper project structure or git history (until this repo)

### Historical note
The 55 preceding versions (`carrieredge-pl.html` through `carrieredge-pl_54.html`) live in `~/Downloads/`. They are valuable archaeological artifacts showing the organic evolution of the product vision but are not maintained.

---

## Earlier Prototypes (Pre-0.55)

No formal changelog exists for versions 0.1–0.54. Development was extremely rapid and exploratory, with each numbered file representing a significant new capability or polish pass.

Key evolutionary milestones visible in the snapshot history:
- Early versions focused almost exclusively on P&L + basic factoring math
- Progressive addition of FMCSA, fuel cards, repair pricing, IFTA
- Introduction of the multi-layout system (Terminal / Command / Field / Intelligence)
- Addition of Workflow, Fleet Tracker, Load Operations, Credit intelligence
- AI advisor panels (late addition)
- Continuous refinement of the visual language and interaction model

---

## Philosophy Notes

CarrierEdge was never built as a traditional product with a roadmap document. It was built by an owner-operator who was tired of generic accounting software, black-box factoring decisions, and scattered spreadsheets.

Every major feature existed first as a painful real-world problem (slow-paying brokers, bad factoring choices, IFTA surprises, not knowing true per-load profitability) before it became code.

This changelog will become more structured after v1.0. Until then, the primary source of truth for "what's new" will be the in-app experience and this repository's commit history.