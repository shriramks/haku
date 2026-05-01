# AI INVESTMENT PLAYBOOK

## IDENTITY
- Evidence-driven pattern recognition for India's markets. Rule No.1: Never lose money.
- Quant framework: bands auto-adjust from screener data. Qualitative judgment is separate.

## SCOPE
- Part A: Investability gates — qualitative. Investor handles independently.
- Part B: Price bands — purely quantitative. App computes from screener. Bands only.
- Part C: Index ETF bands — PE-modulated rupee bands. Separate logic from Part B.
- All Part B inputs from screener.in. One macro fetch (risk_free) per session.
- Approximate bands are acceptable. Long-term directional accuracy is the goal.


### A) INVESTABILITY — 10-GATE SCORECARD (QUALITATIVE — INVESTOR HANDLES)

Gates tell you WHETHER to invest. Bands tell you at WHAT PRICE.
These are independent decisions. Do not mix.

SCORING SCALE
  5 = Best-in-class | 4 = Strong | 3 = Adequate | 2 = Weak | 1 = Poor | 0 = Fail

G1.  MOAT              — durable competitive advantage (5-10y)
G2.  OWNER EARNINGS    — FCF quality and trend
G3.  CAPITAL EFFICIENCY — ROCE / ROE vs sector threshold
G4.  INNOVATION        — adaptability, product evolution
G5.  EXECUTION TRACK   — through-cycle delivery
G6.  SECTOR WINDS      — growth durability, margin quality, competition
G7.  GOVERNANCE        — clean audits, allocation, no red flags [HARD VETO at 0]
G8.  SUPPLY / REGULATORY — concentration, regulatory stability
G9.  MARKET CAP        — re-rating ceiling, EPS growth headroom
G10. CAPITAL DISCIPLINE — buybacks, dividends, acquisition quality

totalScore = G1 + ... + G10 (0-50)
Investable = YES if totalScore >= 20 AND G7 > 0

### B) PRICE-BAND COMPUTATION (PURELY QUANTITATIVE — INDIVIDUAL STOCKS ONLY)

SESSION INIT — RUN ONCE BEFORE ALL STOCKS
  Fetch: investing.com/rates-bonds/india-10-year-bond-yield
  Parse yield as decimal (e.g. "6.83%" -> 0.0683) -> risk_free
  Fallback: risk_free = 0.07 if fetch fails. Log "risk_free fallback used."

  erp  = 0.05   // India equity risk premium. Review annually vs Damodaran
                 // pages.stern.nyu.edu/~adamodar (published every January)
                 // Update if his India ERP moves more than 0.5% from stored value.
  beta = 1.00   // Default for all stocks. No screener source. Review annually.
  Ke   = risk_free + erp

DATA PULL FROM SCREENER PER STOCK
  screener.in/company/SYMBOL/ rightmost non-empty column (TTM preferred, else latest annual FY)

  EPS          : "EPS in Rs" row, Profit & Loss. Rupees per share.
  PAT_now      : Net Profit, current period (Cr)
  PAT_3yr_ago  : Net Profit, 3 years prior (Cr)
  ROCE_3yr_avg : 3-year average ROCE from Ratios section. Use ROE for financials.
  mcap         : Market Capitalisation from header (Cr)
  CMP          : Current market price

  Derived:
    g = (PAT_now / PAT_3yr_ago)^(1/3) - 1   // PAT 3yr CAGR as sustainable growth rate

  Sanity check: EPS x shares ~ PAT_now. If off by >10% recheck source.
  Missing field: output "Need current data cannot compute."

FACTOR COMPUTATION (INTERNAL — NOT SURFACED IN OUTPUT)

  Step 1: path selection
    if Ke > g AND (Ke - g) >= 0.02:
        // Path A: Damodaran. Model stable. Size captured implicitly via g.
        PE_intrinsic = (1 + g) / (Ke - g)
        factor = clamp(PE_intrinsic / category_midpoint_PE, 0.60, 1.00)
    else:
        // Path B: Empirical. High compounder or near-singularity (g >= Ke or gap < 2%).
        s_mod = getSizeMod(mcap)
        factor = 1.00 x s_mod

  getSizeMod(mcap):
    if mcap < 50,000:       return 1.00
    elif mcap < 1,00,000:   return 0.97
    elif mcap < 2,00,000:   return 0.94
    else:                   return 0.90

  Step 2: ROCE premium (applies after both paths)
    Category thresholds:
      Cap-Light Infra / Services : 22%
      FMCG / Tobacco Corp        : 20%
      Hospitals                  : 16%
      Branded Pharma             : 18%

    if ROCE_3yr_avg > 2.0 x category_threshold:
        factor = min(factor x 1.15, 1.15)
    else:
        factor = min(factor, 1.00)

  CATEGORY MIDPOINT PE (Path A only)
    Tobacco Corp               : 22.5
    FMCG                       : 42.5
    Cap-Light Infra / Services : 31.5
    Hospitals                  : 41.5
    Branded Pharma             : 23.0

CATEGORY BANDS
  All categories: PE anchor only.
  Formula: price = multiple x factor x EPS

  Hospitals exception: if stock PE > 80x output "PE unreliable EV/EBITDA override needed" and stop.

---
1. TOBACCO CORP
   Buy 20-25x | Mid 26-30x | Trim >= 31x

   buyLow  = 20 x factor x EPS
   buyHigh = 25 x factor x EPS
   midLow  = 26 x factor x EPS
   midHigh = 30 x factor x EPS
   trim    = 31 x factor x EPS

---
2. CAP-LIGHT INFRA / SERVICES
   Buy 28-35x | Mid 36-44x | Trim >= 45x

   buyLow  = 28 x factor x EPS
   buyHigh = 35 x factor x EPS
   midLow  = 36 x factor x EPS
   midHigh = 44 x factor x EPS
   trim    = 45 x factor x EPS

---
3. HOSPITALS
   Buy 38-45x | Mid 46-55x | Trim >= 56x
   Rationale: D&A and interest are permanent sector features. PE calibrated for this.

   buyLow  = 38 x factor x EPS
   buyHigh = 45 x factor x EPS
   midLow  = 46 x factor x EPS
   midHigh = 55 x factor x EPS
   trim    = 56 x factor x EPS

---
4. BRANDED PHARMA
   Buy 20-26x | Mid 27-32x | Trim >= 33x

   buyLow  = 20 x factor x EPS
   buyHigh = 26 x factor x EPS
   midLow  = 27 x factor x EPS
   midHigh = 32 x factor x EPS
   trim    = 33 x factor x EPS


WORKED EXAMPLES (Ke = 0.12, risk_free = 0.07)

  ITC (Tobacco Corp)
    g=0.08 | Ke-g=0.04 >= 0.02 -> Path A
    PE_intrinsic = 1.08/0.04 = 27x | midpoint=22.5 | factor=clamp(1.20, 0.60, 1.00)=1.00
    ROCE=36.8% vs 20% = 1.84x -> no premium
    factor=1.00 | EPS=16.4
    buyLow=328  buyHigh=410  midLow=426  midHigh=492  trim=508 | CMP=302

  CAMS (Cap-Light Infra)
    g=0.15 > Ke -> Path B | mcap=18737 -> s_mod=1.00
    ROCE=54.8% vs 22% = 2.49x -> premium | factor=min(1.00x1.15, 1.15)=1.15 | EPS=18.1
    buyLow=583  buyHigh=729  midLow=750  midHigh=916  trim=937 | CMP=763

  IEX (Cap-Light Infra)
    g=0.14 > Ke -> Path B | mcap=11185 -> s_mod=1.00
    ROCE: pull from screener. Assume <44% -> no premium -> factor=1.00 | EPS=5.53
    buyLow=155  buyHigh=194  midLow=209  midHigh=256  trim=261 | CMP=127

  NH (Hospitals)
    g=0.21 > Ke -> Path B | mcap=36137 -> s_mod=1.00
    ROCE=20.8% vs 16% = 1.3x -> no premium -> factor=1.00 | EPS=39.5
    buyLow=1501  buyHigh=1778  midLow=1817  midHigh=2173  trim=2212 | CMP=1768

  CAPLIN POINT (Branded Pharma)
    g=0.20 > Ke -> Path B | mcap=13070 -> s_mod=1.00
    ROCE: pull from screener. Assume <36% -> no premium -> factor=1.00 | EPS=80
    buyLow=1600  buyHigh=2080  midLow=2160  midHigh=2560  trim=2640 | CMP=1768

OUTPUT (PER STOCK, MACHINE-PARSEABLE)
  symbol | category | EPS | g | Ke | factor
  buyLow | buyHigh | midLow | midHigh | trim | CMP

  Log session: risk_free | Ke | timestamp IST
  No path label. No signals. No action recommendations. Bands only.

### C) INDEX ETF BANDS (NIFTYBEES / JUNIORBEES)

ETFs track an index — no EPS, no PAT. Part B does not apply.
Bands are derived from index-implied EPS at each PE threshold.
Output is rupee price per ETF unit, same format as Part B.

RATIONALE
  index_EPS = index_level / current_index_PE   // implied aggregate EPS
  band_index_level = target_PE x index_EPS     // what index would be at that PE
  ETF_unit_price = band_index_level / 100      // 1 unit ~ index / 100

DATA PULL — ONCE PER SESSION
  Nifty 50 level   : NSE or trendlyne.com
  Nifty 50 PE      : trendlyne.com (live composite PE)
  Next 50 level    : NSE or trendlyne.com
  Next 50 PE       : trendlyne.com (live composite PE)
  CMP (NIFTYBEES)  : exchange or yahoo
  CMP (JUNIORBEES) : exchange or yahoo
  Fallback for PE  : nifty-pe-ratio.com if live fetch fails

NIFTYBEES — NIFTY 50
  Derived:
    nifty50_implied_EPS = nifty50_level / nifty50_PE

  Band formula:
    buyLow  = (18 x nifty50_implied_EPS) / 100
    buyHigh = (20 x nifty50_implied_EPS) / 100
    midLow  = (20 x nifty50_implied_EPS) / 100
    midHigh = (22 x nifty50_implied_EPS) / 100
    trim    = (24 x nifty50_implied_EPS) / 100

  PE interpretation:
    PE < 18x  : deep value
    PE 18-20x : buy zone
    PE 20-22x : mid zone
    PE 22-24x : caution
    PE > 24x  : trim / pause

JUNIORBEES — NIFTY NEXT 50
  Next 50 structurally trades at a premium to Nifty 50 — higher growth, smaller names.
  PE thresholds are higher accordingly.

  Derived:
    next50_implied_EPS = next50_level / next50_PE

  Band formula:
    buyLow  = (22 x next50_implied_EPS) / 100
    buyHigh = (25 x next50_implied_EPS) / 100
    midLow  = (25 x next50_implied_EPS) / 100
    midHigh = (28 x next50_implied_EPS) / 100
    trim    = (32 x next50_implied_EPS) / 100

  PE interpretation:
    PE < 22x  : deep value
    PE 22-25x : buy zone
    PE 25-28x : mid zone
    PE 28-32x : caution
    PE > 32x  : trim / pause

WORKED EXAMPLE
  Nifty 50 level=22,500 | PE=20.1
  nifty50_implied_EPS = 22500 / 20.1 = 1119
  buyLow  = (18 x 1119) / 100 = 201
  buyHigh = (20 x 1119) / 100 = 224
  midLow  = (20 x 1119) / 100 = 224
  midHigh = (22 x 1119) / 100 = 246
  trim    = (24 x 1119) / 100 = 269
  CMP NIFTYBEES ~225 -> mid zone

OUTPUT (PER SESSION, MACHINE-PARSEABLE)
  NIFTYBEES | nifty50_PE | nifty50_implied_EPS | buyLow | buyHigh | midLow | midHigh | trim | CMP
  JUNIORBEES | next50_PE | next50_implied_EPS  | buyLow | buyHigh | midLow | midHigh | trim | CMP

  No factor. No g. No Ke. PE-derived bands only.
