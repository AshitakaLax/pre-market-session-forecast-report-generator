import type { CalibrationMode, RunWindow } from '../types/forecast';

export interface DiagnosticFinding {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'moderate';
  original_issue: string;
  accuracy_impact: string;
  upgraded_fix: string;
}

export interface FinancialSourceEntry {
  id: string;
  category: 'Equities & Futures' | 'Volatility & Options' | 'Macro & Rates' | 'Catalysts & Filings';
  name: string;
  domain: string;
  metrics_extracted: string;
  accuracy_rationale: string;
  tier: 'Tier 1 Primary' | 'Tier 2 Market Data';
}

export const DIAGNOSTIC_FINDINGS: DiagnosticFinding[] = [
  {
    id: 'leverage-bin-mismatch',
    title: '01. Leveraged ETF Bin Scaling (TQQQ vs. 1x SPY Schema)',
    severity: 'critical',
    original_issue:
      'Input targets TQQQ (3x daily Nasdaq-100 ETF), while the schema example defaults to SPY and fixes 1D bins at ±2.5%, 5D at ±5.0%, and 252D at ±25.0%.',
    accuracy_impact:
      'TQQQ realizes ~3.5%–4.5% daily standard deviation in normal regimes. Fixing 1D bounds at ±2.5% forces 30%–45% of probability mass into underflow/overflow tails, destroying quantile resolution and expected shortfall precision.',
    upgraded_fix:
      'Model the underlying QQQ/NDX distribution first, scale 1D bins by 3x (±7.5% at 1.5% width; 5D ±15%; 21D ±30%), and subtract multi-day compounding volatility drag (-0.5 × L(L-1) × σ² × t).',
  },
  {
    id: 'premarket-vs-eod',
    title: '02. 04:30 ET Post-Open Pre-Market Window vs. EOD Pipeline Conflict',
    severity: 'critical',
    original_issue:
      'The prompt instructs an "end-of-day (EOD) pipeline" fetching "today\'s official close" — which fails before cash open and ignores the 04:00–04:30 ET pre-market opening tape.',
    accuracy_impact:
      'At 04:30 ET (30 minutes before a 05:00 ET trading start), the first 30 minutes of live pre-market price discovery (04:00–04:30 ET) reveal gap persistence, early liquidity, and European overlap confirmation.',
    upgraded_fix:
      'Trigger at 04:30 ET and anchor Step 1 to Previous Regular Close + 04:00–04:30 ET Opening Range/Move/Volume + Overnight NQ=F Futures + Overnight US 2Y/10Y Yield Delta to forecast the rest of the day.',
  },
  {
    id: 'vxn-microstructure',
    title: '03. Cboe VXN & Mega-Cap Weighting Over Broad S&P VIX',
    severity: 'high',
    original_issue:
      'Step 1 retrieves broad Cboe VIX and generic market headlines rather than Nasdaq-100 specific volatility and top-7 constituent concentration.',
    accuracy_impact:
      'TQQQ tracks NDX, where NVDA, AAPL, MSFT, AMZN, META, AVGO, and TSLA represent ~45% of index weight. VXN diverges sharply from VIX during tech earnings and rate shocks.',
    upgraded_fix:
      'Mandate Cboe VXN alongside VIX/VIX9D/VIX3M term structure, NQ=F overnight gap, and overnight news/earnings checks across the top 7 NDX constituents.',
  },
  {
    id: 'arithmetic-drift',
    title: '04. Deterministic Step 5 Math Audit vs. In-Context LLM Arithmetic',
    severity: 'high',
    original_issue:
      'Relying on an LLM alone to sum 10 probabilities + 2 tails to 1.0000, keep CDF monotonic, and match discrete mean/std/ES(5%) across 5 horizons produces rounding drift.',
    accuracy_impact:
      'Inconsistent CDFs and miscalculated Expected Shortfall corrupt downstream Kelly fraction sizing and break automated JSON consumers.',
    upgraded_fix:
      'Separate Pass 1 (grounded web retrieval) from Pass 2 (strict JSON schema synthesis at fixed seed=42), followed by deterministic TypeScript integer-basis-point reconciliation of sums, CDFs, moments, and Kelly caps.',
  },
  {
    id: 'source-tiering',
    title: '05. Primary Institutional Source Tiering & Conflict Resolution',
    severity: 'moderate',
    original_issue:
      'Broad source examples mix primary exchanges with secondary commentary blogs without a strict authority hierarchy.',
    accuracy_impact:
      'Secondary articles frequently cite delayed quotes or outdated FedWatch odds, introducing stale priors into Step 2 regime classification.',
    upgraded_fix:
      'Enforce explicit source priority: Exchange/Government primary feeds (Nasdaq, Cboe, CME FedWatch, US Treasury, BLS/BEA, SEC EDGAR) override financial media summaries.',
  },
  {
    id: 'brier-calibration',
    title: '06. Repeatability via Fixed Seed & Out-of-Sample Brier Scoring',
    severity: 'moderate',
    original_issue:
      'Running an unlogged prompt daily provides no feedback loop to detect systematic overconfidence or tail miscalibration.',
    accuracy_impact:
      'Without verifying T+1 and T+5 realized closes against predicted p25–p75 and p05–p95 bands, bias compounds unchecked.',
    upgraded_fix:
      'Persist every daily run with its grounded URLs and run automated T+1 realized outcome verification to compute Brier Scores and empirical coverage rates.',
  },
];

export const FINANCIAL_SOURCE_MATRIX: FinancialSourceEntry[] = [
  {
    id: 'cme-nq',
    category: 'Equities & Futures',
    name: 'CME Group E-mini Nasdaq-100 (NQ=F)',
    domain: 'cmegroup.com / finance.yahoo.com',
    metrics_extracted: 'Overnight futures change %, Globex volume, fair-value basis',
    accuracy_rationale:
      'Primary price-discovery venue from 18:00 ET through 09:30 ET cash open; directly governs TQQQ pre-market opening gap.',
    tier: 'Tier 1 Primary',
  },
  {
    id: 'nasdaq-official',
    category: 'Equities & Futures',
    name: 'Nasdaq Pre-Market & Constituent Feed',
    domain: 'nasdaq.com',
    metrics_extracted: 'TQQQ / QQQ pre-market last, bid/ask, pre-market volume, top-7 NDX movers',
    accuracy_rationale:
      'Official listing exchange data prevents stale previous-close carryovers and surfaces mega-cap pre-market earnings gaps.',
    tier: 'Tier 1 Primary',
  },
  {
    id: 'cboe-vxn',
    category: 'Volatility & Options',
    name: 'Cboe Volatility Suite (VXN, VIX9D, VIX, VIX3M)',
    domain: 'cboe.com',
    metrics_extracted: 'NDX 30D implied vol (VXN), 9D/30D/90D contango/backwardation ratio',
    accuracy_rationale:
      'VXN prices Nasdaq-100 options directly; VIX9D/VIX3M inversion signals immediate event-driven tail risk.',
    tier: 'Tier 1 Primary',
  },
  {
    id: 'barchart-iv',
    category: 'Volatility & Options',
    name: 'Barchart / Market Chameleon Options Analytics',
    domain: 'barchart.com / marketchameleon.com',
    metrics_extracted: 'TQQQ & QQQ IV Rank, 20D historical vol, Put/Call volume & OI skew',
    accuracy_rationale:
      'Directly measures implied-vs-realized volatility spread and dealer hedging skew bias.',
    tier: 'Tier 2 Market Data',
  },
  {
    id: 'treasury-curve',
    category: 'Macro & Rates',
    name: 'U.S. Department of the Treasury Daily Par Curve',
    domain: 'home.treasury.gov',
    metrics_extracted: '2Y, 10Y, 30Y Treasury yields & 2s10s curve slope',
    accuracy_rationale:
      'Long-duration Nasdaq-100 cash flows exhibit high negative beta to sudden 2Y/10Y yield spikes.',
    tier: 'Tier 1 Primary',
  },
  {
    id: 'cme-fedwatch',
    category: 'Macro & Rates',
    name: 'CME FedWatch Tool',
    domain: 'cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
    metrics_extracted: 'Implied FOMC rate cut/hold/hike probabilities across next 3 meetings',
    accuracy_rationale:
      'Market-priced Fed Funds futures probabilities outperform media commentary on rate expectations.',
    tier: 'Tier 1 Primary',
  },
  {
    id: 'bls-bea',
    category: 'Catalysts & Filings',
    name: 'BLS / BEA / Federal Reserve Release Calendars',
    domain: 'bls.gov / bea.gov / federalreserve.gov',
    metrics_extracted: 'Exact 08:30 ET / 14:00 ET release timestamps (CPI, PPI, NFP, PCE, FOMC)',
    accuracy_rationale:
      '08:30 ET macro prints trigger 2x–4x volatility expansion on TQQQ; exact timestamping prevents false low-vol priors.',
    tier: 'Tier 1 Primary',
  },
  {
    id: 'sec-edgar',
    category: 'Catalysts & Filings',
    name: 'SEC EDGAR 8-K & Earnings Transcripts',
    domain: 'sec.gov / earningswhispers.com',
    metrics_extracted: 'After-hours/pre-market 8-K guidance & mega-cap tech earnings dates',
    accuracy_rationale:
      'Eliminates surprise gap risk when NVDA, AAPL, MSFT, AMZN, META, or AVGO report within 1D–5D.',
    tier: 'Tier 1 Primary',
  },
];

export function buildUpgradedPrompt(options: {
  symbol: string;
  runWindow: RunWindow;
  calibrationMode: CalibrationMode;
}): string {
  const sym = options.symbol.trim().toUpperCase() || 'TQQQ';
  const isLeveraged = ['TQQQ', 'SQQQ', 'UPRO', 'SPXU', 'SOXL', 'SOXS', 'TNA'].includes(sym);
  const leverage = isLeveraged ? 3 : ['QLD', 'QID', 'SSO'].includes(sym) ? 2 : 1;
  const underlying = ['TQQQ', 'SQQQ', 'QLD', 'QID', 'QQQ'].includes(sym)
    ? 'QQQ / NDX'
    : ['SOXL', 'SOXS'].includes(sym)
      ? 'SOXX'
      : ['TNA'].includes(sym)
        ? 'IWM'
        : 'SPY / SPX';

  const windowLabel =
    options.runWindow === 'pre_market'
      ? 'POST-OPEN PRE-MARKET (04:30–04:55 ET, incorporating 04:00–04:30 ET opening 30-min tape before 05:00 ET trading)'
      : options.runWindow === 'pre_bell'
        ? 'PRE-BELL MORNING (08:35–09:15 ET, post-08:30 macro prints, prior to 09:30 cash open)'
        : 'END-OF-DAY (16:15 ET, post-regular close)';

  const bin1d = options.calibrationMode === 'leveraged_scaled' ? 0.5 * leverage : 0.5;
  const bin5d = options.calibrationMode === 'leveraged_scaled' ? 1.0 * leverage : 1.0;
  const bin21d = options.calibrationMode === 'leveraged_scaled' ? 2.0 * leverage : 2.0;
  const bin63d = options.calibrationMode === 'leveraged_scaled' ? 3.0 * leverage : 3.0;
  const bin252d = options.calibrationMode === 'leveraged_scaled' ? 5.0 * leverage : 5.0;

  return `You are an autonomous quantitative market-regime and probabilistic forecasting engine running a 5-stage ${windowLabel} pipeline with live multi-source web retrieval.

CRITICAL EXECUTION DIRECTIVE: Do NOT ask clarifying questions, do NOT pause for missing placeholders, and do NOT fabricate unverified quotes. Resolve current system UTC and America/New_York timestamps automatically. Execute Steps 1 through 5 sequentially using primary institutional sources first, and emit ONLY the final valid JSON object produced in Step 5—no markdown prose, no code fences, and no trailing commas.

### INPUT CONTEXT
Target Symbol: ${sym}
Underlying Benchmark: ${underlying} (Daily Leverage Factor: ${leverage}x)
Execution Window: ${windowLabel}
Session Date & As-Of Timestamp: AUTO_LATEST_SESSION (ISO-8601 UTC + ET market calendar verification)
Base Reference Price: AUTO_FETCH_LATEST (Active 04:30+ ET Pre-Market quote, else Previous Official Regular Close)
Data Retrieval Mode: ACTIVE_WEB_RESEARCH (Tier-1 primary exchange, derivatives, Treasury, and regulatory sources)

---

### STEP 1: Tiered Multi-Source Web Retrieval & Cross-Verification
Execute targeted live searches across at least 5 authoritative domains in strict authority order (Primary Exchange/Government > Market Data Trackers > Financial News):
1. **Early Pre-Market Tape (04:00–04:30 ET), Cash Close & Overnight Futures (Nasdaq.com, CME Group, Yahoo Finance, MarketWatch):**
   - Fetch ${sym} previous official regular close, 04:00 AM ET pre-market open, 04:00–04:30 AM ET pre-market high/low/volume, latest ~04:30+ ET pre-market quote, and 5-day / 20-day return trend.
   - Fetch E-mini Nasdaq-100 futures (NQ=F) and S&P 500 futures (ES=F) overnight % change, evaluating whether the first 30 minutes (04:00–04:30 ET) confirmed or faded the overnight futures impulse, plus top NDX mega-cap pre-market movers (NVDA, AAPL, MSFT, AMZN, META, AVGO, TSLA).
2. **Volatility Term Structure & Options Skew (Cboe, Barchart, Market Chameleon):**
   - Fetch Cboe VXN (Nasdaq-100 30D IV), Cboe VIX, VIX9D, and VIX3M to evaluate short-term backwardation vs. contango.
   - Fetch ${sym} / ${underlying} 30-day IV, IV Rank, 20-day Realized Volatility, and Put/Call skew.
3. **Macro, Sovereign Rates & Fed Policy (U.S. Treasury, CME FedWatch, FRED):**
   - Fetch latest US 2Y and 10Y Treasury yields (noting overnight bp change), DXY (US Dollar Index), WTI crude, and CME FedWatch implied next-meeting probabilities.
4. **Scheduled Catalysts & Filings (BLS, BEA, Federal Reserve, SEC EDGAR, Econoday):**
   - Identify every scheduled macro print (08:30 ET CPI/PPI/PCE/NFP/Claims, 14:00 ET FOMC, Treasury auctions) and major ${underlying} constituent earnings over the next 24h, 5D, and 21D.
5. **Reconciliation Rule:** Primary exchange/government prints override secondary commentary. Log any unretrievable metric in \`missing_inputs\` without guessing.

### STEP 2: Quantitative Feature Extraction & Regime Classification
- Compute overnight implied gap (${sym} 04:30 ET pre-market vs. prior close, and 04:00–04:30 ET 30-minute trend continuation vs. fade relative to ${leverage}x NQ=F futures), 20D realized vs. implied volatility spread (\`implied_vs_realized_vol_spread_pct\`), and expected rest-of-day move (\`expected_1d_move_pct\`, anchored to ${leverage > 1 ? 'VXN × ' + leverage + ' / √252' : 'IV / √252'} and intraday catalyst risk).
- Classify \`regime\`, \`volatility_state\`, \`skew_bias\`, and \`overnight_gap_risk\`.

### STEP 3: Multi-Horizon Probability Distribution Synthesis
${
  options.runWindow === 'pre_market'
    ? `- **Rest-of-Day Conditioning (04:30 ET → Regular Close, prior to 05:00 ET entry):** Anchor \`tomorrow\` (1D) directly to the 04:30 ET base price, weighting the 04:00–04:30 ET opening range/volume impulse, gap-fill vs. continuation odds, and remaining 08:30 ET / regular-session catalysts.\n`
    : ''
}${
  leverage > 1
    ? `- **Leveraged Compounding Rule:** Model the underlying ${underlying} return distribution first, scale 1D return bins by ${leverage}x, and for 21D/63D/252D horizons apply daily volatility-drag adjustment (-0.5 × ${leverage} × (${leverage} - 1) × σ² × t) plus negative convexity under elevated/extreme volatility.`
    : ''
}
- **Horizon Bin Widths (${options.calibrationMode === 'leveraged_scaled' ? 'Volatility-Scaled for ' + leverage + 'x' : 'Fixed 1x Schema'}):**
  - \`tomorrow\` (1D): 10 bins of width \`${bin1d.toFixed(1)}%\` spanning \`[${(-5 * bin1d).toFixed(1)}%, +${(5 * bin1d).toFixed(1)}%]\`
  - \`next_week\` (5D): 10 bins of width \`${bin5d.toFixed(1)}%\` spanning \`[${(-5 * bin5d).toFixed(1)}%, +${(5 * bin5d).toFixed(1)}%]\`
  - \`next_month\` (21D): 10 bins of width \`${bin21d.toFixed(1)}%\` spanning \`[${(-5 * bin21d).toFixed(1)}%, +${(5 * bin21d).toFixed(1)}%]\`
  - \`next_quarter\` (63D): 10 bins of width \`${bin63d.toFixed(1)}%\` spanning \`[${(-5 * bin63d).toFixed(1)}%, +${(5 * bin63d).toFixed(1)}%]\`
  - \`next_year\` (252D): 10 bins of width \`${bin252d.toFixed(1)}%\` spanning \`[${(-5 * bin252d).toFixed(1)}%, +${(5 * bin252d).toFixed(1)}%]\`
- **Uncertainty Penalty:** If \`confidence_score < 0.75\` or core volatility inputs are missing, widen dispersion and increase \`underflow_prob\` / \`overflow_prob\` mass proportionally.

### STEP 4: Strategy Allocation & Fractional Kelly Sizing
- Assign normalized weights across \`momentum_trend\`, \`mean_reversion\`, \`volatility_harvesting\`, and \`cash_defensive\` summing strictly to \`1.00\`.
- Cap \`kelly_fraction_cap\` downward when \`overnight_gap_risk == "high"\`, VIX9D > VIX3M (backwardation), or \`confidence_score < 0.75\`.

### STEP 5: Mathematical Audit & Strict Schema Serialization
- Enforce \`underflow_prob + sum(bins[].prob) + overflow_prob == 1.0000\` (adjust central mode bin for exact 4-decimal parity).
- Enforce exact monotonic \`cdf\`, coherent \`p01 <= p05 <= p25 <= median_pct <= p75 <= p95 <= p99\`, exact \`prob_positive\`, and \`expected_shortfall_5pct\`.
- Emit ONLY raw valid JSON matching \`schema_version: "1.1.0"\` with \`"symbol": "${sym}"\`.`;
}
