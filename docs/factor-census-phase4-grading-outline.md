# Factor census grading — applied to `factor-census-phase4-merged.csv`

**Applied:** 2026-09-16 PT · **By:** Dex · **Listing file:** `docs/factor-census-phase4-merged.csv` (same Rex/Scout 300-row listing; grade columns appended)

## Framework (locked)

Hard gate before any grade: published/partner-verified fee schedule + sourced fee cells. Fail → **Incomplete** (searchable, cannot win All-In/best). Never invent fees. Never rank on CPA / listing / stars / affiliate.

### v1 (what the new columns encode)
- `transparency_gate` pass/fail
- `all_in_eligible` Y only if gate pass
- `grade_status`: `Incomplete` | `Transparency-pass`
- `nr_flag` / `exit_flag`: Unknown until Scout fee pass fills them
- `grade_v2_score`: blank until 7-weight model has fee coverage

### v2 weights (deferred — column reserved)
30% all-in cost · 20% transparency · 15% exit freedom · 15% NR quality · 10% cash-today · 5% lien hygiene · 5% optional-cost honesty

## Counts after this pass

| grade_status | n |
|---|---:|
| Incomplete | 297 |
| Transparency-pass | 3 |
| CE Verified Partner (label only) | 6 |

Transparency-pass ids: dat-outgo, ifxi, infinite-capital-funding

Backup before grade columns: `factor-census-phase4-merged.csv.bak-pre-grade`
