# CarrierEdge

**The Owner-Operator Operating System** — a private, zero-infrastructure, browser-native toolkit that turns every load, fuel stop, repair, and invoice into actionable intelligence for independent truckers and small fleets.

> Your data never leaves your device unless you explicitly choose to share it.

---

## What is CarrierEdge?

CarrierEdge is a complete, offline-first dashboard for running a trucking business as an owner-operator. It combines:

- **P&L Tracker** — Every load and expense, RPM math, broker attribution, category breakdowns, CSV export
- **Factoring Decision Engine** — Personalized advance offers, SIF calculator, All-In cost modeling, non-recourse education, live rate tables for Triumph, OTR Capital, and others
- **FMCSA Safety & Authority** — Real SAFER lookups with full BASICs scorecard and bond verification
- **Fuel Strategy** — Card comparator, route tax awareness, diesel price integration (EIA)
- **Fleet Tracker** — Manual positions + status + future live GPS (Samsara/Motive)
- **Edge Workflow** — Invoice queue, chargebacks, DSO tracking per broker
- **Load Operations** — True cost-basis accept/reject + rate negotiation support
- **Compliance (IFTA)** — State mileage + fuel logs → quarterly worksheet
- **Finance & Business Hubs** — Cash flow, tax prep, broker scorecards, lightweight CRM
- **Credit Intelligence** — Internal payment history + external authority checks
- **AI Advisor** — Claude-powered answers grounded in your actual numbers (via optional local proxy)
- **Market Transparency** — Lane benchmarks and cost comparisons

Four distinct UI personalities (Terminal, Command, Field, Intelligence) let you choose how the same powerful engine feels on any given day.

---

## Core Principles

- **You own your data** — Everything lives in your browser's localStorage. No accounts, no cloud, no surprise telemetry.
- **Works offline forever** — Once loaded, the entire application runs without an internet connection.
- **Optional live intelligence** — Paste your own free/paid API keys (FMCSA, EIA, Anthropic, DAT, Samsara, etc.) only when you want fresher data or AI assistance.
- **Domain depth over generic tools** — Built by and for people who actually move freight, not accountants who have never sat in a truck.

---

## Current Status (v1.0 Baseline)

This repository was initialized from the heavily evolved single-file prototype `carrieredge-pl_55.html` (May 2026, 7,965 lines).

**Phase 1 goal**: Turn the proven prototype into a shippable, documented, maintainable v1.0 that another owner-operator can download, trust with real financial data, and use for a full quarterly close without friction.

See [CHANGELOG.md](./CHANGELOG.md) for the detailed history of the 55+ iterative versions that led here.

---

## Quick Start

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).
2. Explore with the rich demo data for "Williams Freight LLC" (Marcus J. Williams, 2 trucks, TX-based dry van).
3. Start replacing demo data with your own in the **P&L Tracker**.
4. Add your DOT number in **Settings** → let the FMCSA integration show your real safety record.
5. (Optional) Add free EIA and FMCSA keys in Settings for live diesel prices and authority lookups.
6. Export everything regularly via **Settings → Data Backup & Restore** — the card shows your live record counts and last backup age.

**Data safety note**: Your information never leaves this machine. Make periodic full exports.

---

## Project Structure (Current)

```
/CarrierEdge
├── index.html                 # Primary application (v1.0 baseline)
├── carrieredge-pl_55.html     # Historical snapshot — do not edit
├── README.md
├── CHANGELOG.md
├── .gitignore
├── releases/                  # Versioned single-file builds (future)
├── docs/
│   └── guide.html             # Comprehensive user guide (to be versioned)
└── scripts/                   # Build helpers, local proxies (future)
```

---

## AI Features

The AI advisor panels call Anthropic directly from the browser using your API key (stored in localStorage, never sent anywhere else). All four AI call sites share a single `callAI()` helper with a 25-second timeout, consistent error handling, and proper API-error parsing.

To enable: add your Anthropic API key in **Settings → API Keys**. Get a free key at [console.anthropic.com](https://console.anthropic.com).

---

## Roadmap (High Level)

See the full plan in the session notes for details. In short:

- **Phase 1 (now)**: Stabilization — proper releases, data durability, AI repair, quality pass, documentation
- **Phase 2**: Explicit architecture decision (stay single-file/PWA vs Tauri desktop app vs light backend)
- **Phase 3+**: Depth (real PDFs, better mobile/field experience, telematics, historical benchmarking)

---

## Contributing

This project is currently maintained by one owner-operator for owner-operators. Feedback, real-world usage reports, and suggestions for the most painful missing pieces are extremely welcome.

If you run a small fleet or are an owner-operator and this tool saves you money or time, I want to hear about it.

---

## License & Philosophy

Free for personal and commercial use by carriers. The goal is better decisions and better cash flow for the people actually moving freight — not another SaaS tax on small businesses.

Your data is yours. Always.

---

**Built with respect for the people who keep this country moving.**