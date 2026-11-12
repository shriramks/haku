# Haku — Tax rules

Capital-gains constants and set-off rules the tax screens implement. Read this before any tax change.

### Equity capital gains (stocks + equity-oriented MFs)
- **STCG** (held < 365 days): taxed at 20%.
- **LTCG** (held ≥ 365 days): taxed at 12.5% on gains above the 1.25 L annual exemption (raised from 1 L by Budget 2024, effective FY 2024–25 onwards).
- **1.25 L exemption** applies only to equity LTCG — not to debt or gold.

### Debt MF capital gains
Finance Act 2023 split debt MF treatment by purchase date (effective April 1, 2023):
- **Units bought before April 1, 2023:** old rules — LTCG threshold 3 years (1095 days), 20% with indexation; STCG at slab. BUT Budget 2024 (Finance Act 2024, effective July 23, 2024) removed indexation across capital assets; the only carve-out was real estate. So for pre-April 2023 debt units sold on/after July 23, 2024, indexation benefit is likely gone too — gains at slab.
- **Units bought on/after April 1, 2023:** LTCG benefit removed entirely — all gains taxed at slab rate regardless of holding period.
- The 1.25 L LTCG exemption does **not** apply to debt MF gains.
- **Indexation in this app:** We do not compute indexed cost. Debt gains are shown at purchase cost with a note to verify with a CA. Indexation requires a CBDT CII table (maintained annually each June) and the slab-rate outcome is user-specific anyway — false precision is worse than a clear disclaimer.

### Gold capital gains
- **LTCG threshold:** 1095 days (3 years).
- **SGB held to maturity:** fully exempt from capital gains tax.
- **SGB/ETF sold before maturity:** normal gold LTCG rules apply.

### Foreign-listed holdings (stocks / ETFs with a non-INR quote currency)
- **LTCG threshold:** 730 days (24 months). Gains below that are short-term.
- **LTCG:** 12.5%, **no** 1.25 L exemption. **STCG:** slab rate.
- Gain is computed in INR: cost at the buy trade's stored `fx_rate`, proceeds at the sell trade's — so currency movement is part of the gain.
- Own buckets (`foreignLTCG`, `foreignSTCG`). Harvesting does not cover them.

### Loss set-off rules
Set-off follows the **term of the loss** (short-term vs long-term), not the asset class — this matches actual Indian tax law (s.70): equity vs debt only changes the *rate*, not who can absorb whose loss.
- **Short-term losses** (equity STCG, debt STCG) can be set off against **any** of the four buckets — equity STCG, equity LTCG, debt STCG, or debt LTCG — highest-rate-first (ties: debt LTCG, foreign LTCG, equity LTCG).
- **Long-term losses** (equity LTCG, debt LTCG) can only be set off against the two LTCG buckets (equity or debt) — never against a short-term gain. Foreign LTCG/STCG are two more buckets in the same model: foreign long-term is a long-term target and source, foreign short-term a short-term source and a target of any short-term loss. Carry-forward stays two types (short / long).
- "Debt" bucket = debt MF **and** gold ETF sold before maturity combined (`gatherBucketedGains`) — so gold ETF fully participates in the above, including crossing into equity via the short-term leg.
- **SGB held to maturity and physical gold are excluded from the bucketed model entirely** — no resolved bucket, no participation in set-off, reported separately. (SGB-to-maturity is tax-exempt anyway.)
- Harvesting analysis therefore applies only to equity positions; debt, gold ETF, SGB, and physical gold are reported separately.

### Surcharge and cess
- **Bracket is user-selected** on the Tax screen (never persisted), from total income including salary — Haku only sees gains and dividends, so it cannot derive it. `None` (≤ 50 L) 0%, `S10` (50 L – 1 Cr) 10%, `S15` (1 – 2 Cr) 15%, `S25` (> 2 Cr, new-regime maximum) 25%. The old-regime 37% above 5 Cr is not offered.
- **15% cap:** surcharge on equity LTCG/STCG, debt LTCG, foreign LTCG and dividends is `min(bracket, 15%)`. Slab-rate buckets (debt STCG, foreign STCG) take the full bracket rate. `surcharge = Σ line tax × (capped ? min(rate, 15%) : rate)`.
- **Cess** is 4% of `tax + surcharge`. `total = tax + surcharge + cess`; net payable = total − dividend TDS − advance tax paid.
- **Advance tax:** the 15/45/75/100% schedule applies to `total − dividend TDS`, so surcharge flows through `buildLiabilityAsOf` automatically.
- **Advance tax display:** total paid is pooled and fills quarters oldest-first up to each quarter's slice (`allocatePayments`); a past quarter is Paid or Underpaid, nothing in between. Interest (s.234C) is still computed per logged-payment timing (`computeInstalments`) and shown as one summed line.
- **Not handled:** marginal relief near 50 L / 1 Cr / 2 Cr (needs total income). Ignoring it overstates tax slightly — the safe side.
