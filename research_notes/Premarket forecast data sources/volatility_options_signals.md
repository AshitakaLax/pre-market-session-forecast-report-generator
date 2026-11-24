# Volatility and options-derived signals available to a 4:15-4:25am ET pre-market forecast (QQQ/TQQQ, SPY/UPRO, SOXX/SOXL, IWM/TNA)

Research date: 2026-11-24 (Tuesday). Freshness labels used below:
- **FRESH@4:20** means a value computed from markets trading overnight is available at about 4:20am ET on the forecast day.
- **STALE (T-1 close)** means the latest value is from the prior session's close (about 4:15pm ET on T-1).
- **STALE (T-2)** means even the T-1 close is not yet published at 4:20am.

Some findings below are "empirical check (this session)". These are direct API calls I made on 2026-11-24 between about 14:45 and 14:55 UTC (9:45-9:55am ET). EST is in force (UTC-5), so 08:15 UTC = 3:15am ET.

## 1. Which Cboe volatility products trade or update overnight (GTH), and which sources expose the extended-hours values?

### Takeaway
At 4:20am ET these are live: the VIX index itself (disseminated from 3:15am ET), SPX/XSP/VIX/RUT index options (GTH, 8:15pm-9:25am ET) and VIX futures (CFE extended hours). VIX1D, VIX9D, VIX3M, VIX6M, VVIX, SKEW, VXN and RVX are RTH-only, so they are stale at the T-1 close. Equity and ETF options, QQQ/SPY/IWM included, now have a pre-market session, but it starts at 7:30am ET, too late for a 4:30am report. The free yfinance source the app already uses does carry GTH VIX at 1-minute resolution with a delay of about 15 minutes. The app currently discards it because it keeps only the last complete daily bar.

### Cited Findings
**VIX spot in GTH**
- The current Cboe VIX methodology (v6.0, last revised February 26, 2026) gives VIX dissemination as RTH "Between 09:31 a.m. ET and 4:15 p.m. ET" and GTH "Between 3:15 a.m and 9:25 a.m. ET". It is calculated and disseminated about four times a minute (every 15 seconds). — [Cboe VIX Methodology v6.0 (PDF)](https://cdn.cboe.com/api/global/us_indices/governance/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf)
- That methodology applies an index-level filtering algorithm with a 0.50 vol-point threshold in both RTH and GTH. If VIX cannot be calculated, the last value is republished. — [Cboe VIX Methodology v6.0 (PDF)](https://cdn.cboe.com/api/global/us_indices/governance/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf)
- Cboe's GTH brochure says "the VIX Index value is disseminated as early as 8:15 AM London time", which is 3:15am ET in winter, consistent with the methodology. — [Cboe Global Trading Hours brochure v1.6, 2020 (PDF)](https://cdn.cboe.com/resources/global-trading-hours.pdf)
- Cboe began overnight dissemination of VIX in April 2016. — [Cboe IR, Apr 13 2016](https://ir.cboe.com/news/news-details/2016/CBOE-to-Start-Overnight-Dissemination-of-CBOE-Volatility-Index-VIX-April-15-04-13-2016/default.aspx)
- **Conflicting source:** a 2021 Cboe CSMI notice said VIX and the related VIF, VIN, VWA and VWB values would be calculated and disseminated in a Curb session (3:31-4:00pm CT, from 9/27/21) and in an expanded GTH session (7:30pm-8:15am CT, from 11/21/21). — [Cboe CSMI notice C2021061502 (PDF)](https://cdn.cboe.com/resources/release_notes/2021/CSMI-Extended-Dissemination-Schedule.pdf)
  - This conflicts with the 2026 methodology's 3:15am ET GTH start and with the observed Yahoo data below. Treat 3:15am ET as the operative public start.

**VIX1D (RTH only)**
- The VIX1D methodology (v2.0, Feb 26, 2026) lists only an RTH session, "Between 9:31 a.m. and 4:15 p.m. ET". — [Cboe VIX1D Methodology (PDF)](https://cdn.cboe.com/resources/indices/governance/Volatility_Index_Methodology_Cboe_1-Day_Volatility_Index.pdf)
- Its time-to-expiry is measured in RTH business minutes (405 per day). — [Cboe VIX1D Methodology (PDF)](https://cdn.cboe.com/resources/indices/governance/Volatility_Index_Methodology_Cboe_1-Day_Volatility_Index.pdf)
- Cboe's explainer also says VIX1D is calculated during regular trading hours only. — [Cboe Insights: VIX vs VIX1D](https://www.cboe.com/insights/posts/what-the-vix-and-vix-1-d-indices-attempt-to-measure-and-how-they-differ)

**Empirical check (this session): Yahoo chart API, 1-minute bars with includePrePost=true** ([endpoint example](https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1m&range=5d&includePrePost=true))
- **^VIX:** the first bar on 2026-11-24 is 08:15 UTC (3:15am ET), with 382 bars by 14:35 UTC. Each of the prior 4 sessions has 775 one-minute bars starting at 03:15 ET.
- **Other volatility indices:** ^VIX9D, ^VIX1D, ^VIX3M, ^VIX6M, ^VVIX and ^VXD bars start at 14:31 UTC (9:31am ET) only. ^VXN and ^SKEW had zero intraday bars at 9:49am ET, and the ^VXN metadata says `hasPrePostMarketData: false`.
- **Not found:** ^RVX, ^VXSOX and VX=F (VIX futures) all return "No data found, symbol may be delisted".
- **Delay:** at 14:49 UTC the latest ^VIX bar was 14:35 UTC, so Yahoo index data is about 15 minutes delayed. A 4:20am pull returns roughly the 4:05am value.
- **Overnight VIX moves:** the VIX at 4:20am ET compared with the prior close (Cboe CSV) shows how large these moves are:

  | Date | VIX 4:20am | Prior close | Change |
  |---|---|---|---|
  | 11/18 | 23.84 | 25.46 | −1.62 |
  | 11/19 | 22.09 | 24.56 | −2.47 |
  | 11/20 | 28.95 | 28.44 | +0.51 |
  | 11/23 | 30.09 | 35.89 | −5.80 |
  | 11/24 | 27.40 | 26.62 | +0.78 |

  On 11/24 the VIX then rose to 32.38 at 8:08am ET.

**Index options in GTH**
- SPX GTH runs 8:15pm-9:25am ET, Monday to Friday (7:15pm-8:25am Chicago). A Curb session runs 4:15-5:00pm ET for SPX and XSP. The 24x5 model covers SPX, VIX and XSP options. — [Cboe SPX options page](https://www.cboe.com/tradable-products/sp-500/spx-options/)
- Cboe's October 2026 release describes near-24x5 trading of proprietary index options in GTH (8:15pm-9:25am ET) and Curb (4:15-5:00pm ET). The May 2026 release lists GTH products as SPX, VIX, XSP and RUT. — [Cboe IR, Oct 19 2026](https://ir.cboe.com/news/news-details/2026/Cboe-Launches-Extended-Trading-Sessions-for-Select-Single-Stock-and-ETF-Options/default.aspx); [Cboe IR, May 28 2026](https://ir.cboe.com/news/news-details/2026/Cboe-Receives-SEC-Approval-to-Offer-Extended-Trading-Hours-for-Select-Multi-Listed-Single-Stock-Options/default.aspx)
- Per a search summary of Cboe's SPX page, GTH volume recently exceeded 4% of total SPX options volume. I did not verify this on the page itself. — [Cboe SPX options page](https://www.cboe.com/tradable-products/sp-500/spx-options/)
- Cboe proprietary index options (SPX, VIX, XSP, RUT) "will quote and trade on the OPRA GTH system during GTH hours", a separate OPRA system from RTH. — [Cboe Equity Options ETH FAQ: Coordination with Third Parties](https://www.cboe.com/document/tech-spec/content/technical-specifications/equity-options-extended-trading-hours-faq/coordination-with-third-parties)
- **Broker access:** tastytrade announced full Cboe GTH support for SPX, VIX, XSP and RUT in August 2026. Interactive Brokers offers SPX GTH. — [Yahoo Finance / tastytrade release](https://finance.yahoo.com/markets/options/articles/tastytrade-launches-global-trading-hours-130000744.html); [IBKR Cboe SPX page](https://www.interactivebrokers.com/en/trading/cboe.php)

**Equity and ETF options pre-market session (new in 2026)**
- On October 19, 2026, Cboe Options (C1) launched extended sessions, Monday to Friday, at 7:30-9:25am ET and 4:00-4:15pm ET.
  - The 5 ETFs are GLD, IWM, QQQ, SPY and XLF. The 24 stocks are AAPL, AMD, AMZN, AVGO, BABA, BAC, F, GOOG, GOOGL, HOOD, INTC, META, MRVL, MSFT, MU, NFLX, NOK, NVDA, ORCL, PFE, PLTR, SNDK, TSLA and TSM.
  - TQQQ, SOXX and SOXL are not included.
  - Cboe also plans 23x5 equities (not options) on BZX from December 6, subject to industry readiness.
  - — [Cboe IR, Oct 19 2026](https://ir.cboe.com/news/news-details/2026/Cboe-Launches-Extended-Trading-Sessions-for-Select-Single-Stock-and-ETF-Options/default.aspx)
- Eligibility over the preceding six months requires at least 150,000 contracts in average daily options volume, at least $50B underlying market cap and at least 10M shares in average daily volume. The list is reviewed semi-annually. — [Cboe IR, May 28 2026](https://ir.cboe.com/news/news-details/2026/Cboe-Receives-SEC-Approval-to-Offer-Extended-Trading-Hours-for-Select-Multi-Listed-Single-Stock-Options/default.aspx)
- NYSE American launched similar pre-market option sessions the same day, with an initial list that includes SPY, IWM and GLD. — [TradingView / Finance Magnates](https://www.tradingview.com/news/financemagnates:97e0b3d90094b:0-cboe-and-nyse-roll-out-pre-market-trading-for-key-stock-options/)

**FRED publication lag**
- FRED VXNCLS (VXN daily close) showed its latest observation as 2026-11-23 (36.31), "Last updated: Nov 24, 2026, 8:37 AM CST", with the next release on Nov 25. — [FRED VXNCLS](https://fred.stlouisfed.org/series/VXNCLS)
- So at 4:20am ET on day T, FRED holds only the T-2 close: STALE (T-2).

### Inferences
- **Only fresh implied-vol number:** the GTH VIX at about 4:05-4:20am is the single freely available implied-volatility value computed from live overnight option prices.
- **Proposed covariate:** a natural known-at-forecast-time covariate is ΔVIX_overnight = VIX(≈4:15am) − VIX_close(T-1).
  - It is available on every historical day since VIX began GTH dissemination, so it can be backfilled from 1-minute data for 7 days on Yahoo, or from a paid intraday history source for longer.
  - The 11/23 example (−5.8 points overnight) shows that a model fed only the T-1 close would badly misstate the volatility state.
- **Proxy for VXN, RVX and the sector indices:** these have no GTH value, so the overnight VIX change, scaled by a rolling regression beta of ΔVXN on ΔVIX, is the practical free proxy for an overnight change in Nasdaq-100 implied vol.
- **Paid fresh alternative:** compute a 1-day implied move directly from SPXW or XSP GTH quotes, or RUT GTH quotes for IWM/TNA. This needs a broker or OPRA GTH feed.
- **Pre-market ETF options are too late:** the 7:30am ET start for QQQ/SPY/IWM options is after the 4:30am deadline. They could feed a later intraday update, but not this report.
- **History backfill issue:** Yahoo's 1-minute history depth is limited, at about 7 days in practice. Training Chronos-2 on a GTH VIX covariate needs a longer intraday archive, either a paid vendor or self-collection from now on.

### Gaps
- I could not confirm whether Cboe calculates VIX internally before 3:15am ET (for example from the 8:15pm GTH open) without disseminating it publicly. Sources conflict (the 2021 notice versus the 2026 methodology).
- I did not find a Cboe document listing session coverage for VIX9D, VIX3M, VIX6M, VVIX, SKEW, VXN or RVX. Their RTH-only status rests on the Yahoo observation and the CSV update times in section 2, not on a Cboe statement.
- I did not verify whether same-day (0DTE) SPXW expiries are quotable in the GTH session that precedes their expiry day, or how wide GTH spreads are at 4:20am.
- Direct access to cboe.com delayed-quote JSON (cdn.cboe.com/api/global/delayed_quotes/...) returned a Cloudflare 403 from this environment, so I could not test whether Cboe's own site exposes GTH VIX ticks.

## 2. Term-structure indices (VIX1D, VIX9D, VIX, VIX3M, VIX6M, VVIX, SKEW, VXN, RVX, semiconductors): sources and delay

### Takeaway
Cboe's free per-index CSV files are the best free source for T-1 closes of the whole family. They cover VIX, VIX9D, VIX1D, VIX3M, VIX6M, VIX1Y, VVIX, SKEW, VXN, RVX and VXD and are posted the same evening (about 5:31pm ET, or about 9:15pm ET for VIX and SKEW), so they are ready by 4:20am. Yahoo also carries most of them, but ^RVX is missing, which breaks the app's TNA profile. FRED is a day too late. There is no Cboe semiconductor volatility index I could find.

### Cited Findings
**Cboe historical data page**
- The page lists CSV downloads such as `https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv` ("Updated Daily", 1990-present), VVIX_History.csv, VIX9D_History.csv, OVX, GVZ, VXAPL, VXAZN and VXEEM.
- It states the data is "furnished without responsibility for accuracy" and that "accuracy is not guaranteed".
- — [Cboe VIX historical data page](https://www.cboe.com/tradable_products/vix/vix_historical_data/)

**Empirical check (this session): Cboe CSV files and Last-Modified headers**
- **Files that returned HTTP 200 with data through 11/23/2026:** VIX, VIX9D (from 2011), VIX1D (from 05/13/2022), VIX3M (from 2009), VIX6M (from 2008), VIX1Y (from 2007), VVIX (from 2006, close only), SKEW (from 1990, close only), VXN (from 2009 in this file), RVX (from 2009) and VXD. VOLQ returned 403. Files follow the pattern `https://cdn-api.cboe.com/api/global/us_indices/daily_prices/{SYMBOL}_History.csv`. The cdn.cboe.com host returned a Cloudflare redirect; the cdn-api.cboe.com host worked.
- **Last-Modified times (from the HTTP headers):**

  | File(s) | Last-Modified (GMT) | Eastern time |
  |---|---|---|
  | VIX9D, VIX1D, VIX3M, VVIX, VXN, RVX | Mon 23 Nov 22:31 | 5:31pm ET same day |
  | VIX | Tue 24 Nov 02:20 | 9:20pm ET on T-1 |
  | SKEW | Tue 24 Nov 02:11 | 9:11pm ET on T-1 |

  All files carry `cache-control: max-age=60, s-maxage=900`. All are therefore available well before 4:20am ET, as STALE (T-1 close).
- **Data-quality findings:**
  - The VIX CSV's 11/23 OPEN (31.38) matches Yahoo's 3:15am ET GTH bar (31.37). The daily OHLC therefore spans GTH plus RTH, so OPEN is not the 9:30 RTH open.
  - The same row has LOW = 15.39, while the close was 26.62. That is an opening-print spike also seen in Yahoo's 1-minute data at 9:32am ET.
  - The VXN 11/23 OPEN and HIGH (45.25) equal the prior close (45.25), consistent with VXN having no pre-RTH calculation.
  - Use CLOSE only, or filter OHLC, before feeding range-based features of the volatility indices.

**Yahoo tickers**
- ^VIX9D, ^VIX1D, ^VIX3M, ^VIX6M, ^VVIX, ^SKEW, ^VXN and ^VXD resolve on Yahoo, with exchange "WCB / Chicago Options". ^RVX and ^VXSOX return "No data found", for both daily (range=1mo) and 1-minute requests. — empirical check, [Yahoo chart endpoint](https://query1.finance.yahoo.com/v8/finance/chart/%5ERVX?interval=1d&range=1mo)
- **App impact:** the app's PROFILE_MAP maps TNA to "^RVX" and SOXL/SOXS to "^VXN". It hard-codes `vix9d_level`, `vix3m_level`, `iv_rank_pct` and `put_call_ratio` to None, and sets `symbol_iv_pct` = leverage × the index level. — local source: `/home/user/pre-market-session-forecast-report-generator/chronos_service/app.py` (PROFILE_MAP lines ~48-61; snapshot lines ~431-496)

**FRED**
- FRED releases the T-1 close of VXNCLS at about 8:37am CST on day T. — [FRED VXNCLS](https://fred.stlouisfed.org/series/VXNCLS)

### Inferences
- **What each index adds:**

  | Index | What it measures | Role in the forecast |
  |---|---|---|
  | VIX1D | Same- and next-day SPX implied vol | Most direct implied 1-day move for SPY. Stale at 4:20 (T-1 close, measured late in the session when its weight is on the next-day strip). |
  | VIX9D/VIX ratio | Very short end of the curve | Ratio > 1 (inversion) flags event or stress regimes. |
  | VIX/VIX3M | Slope | Ratio > 1 = backwardation, a stress regime (see section 3 on the evidence). |
  | VVIX | Volatility of VIX | Uncertainty about volatility itself, which bears on tail width. |
  | SKEW | Far-OTM put pricing (tail risk) | Mostly a slow-moving tail-risk input. |
  | VXN | NDX 30-day implied vol | Primary input for QQQ/TQQQ. |
  | RVX | Russell 2000 implied vol | Primary input for IWM/TNA. |

- **Fixes for the null fields:**
  - The cheapest fix for `vix9d_level` and `vix3m_level` is to read the Cboe CSVs, or yfinance ^VIX9D and ^VIX3M, using the T-1 close.
  - For TNA, switch from yfinance ^RVX to `RVX_History.csv` from Cboe.
  - IV rank can be computed for free from the Cboe VXN or RVX history as (VXN − min_252)/(max_252 − min_252), with IV percentile as the share of the past 252 days below today. That is an index-based proxy for QQQ IV rank.
- **SOXX/SOXL:** with no semiconductor volatility index, the best free proxy is VXN × a rolling beta (SOXX realized vol / QQQ realized vol), or SOXX's own option-chain IV (see section 4).

### Gaps
- I found no Cboe semiconductor volatility index (^VXSOX does not exist on Yahoo). There may be a Nasdaq or other vendor index; not verified.
- The Nasdaq VOLQ CSV returned 403; I did not verify whether VOLQ is still published.
- The posting times are a single-day observation (11/23 to 11/24). Cboe does not publish a guaranteed posting time, and holiday or late-posting behaviour is unknown.

## 3. VIX futures curve (contango/backwardation, overnight front-month change) as a regime signal: sources

### Takeaway
VX futures trade through the night on CFE, so the front-month level and the VX1/VX2 or VX1/VIX basis are FRESH@4:20. Yahoo does not carry them. Retail access is cheapest through Interactive Brokers (CFE L1 for non-professionals, about $4.50/month). Databento's CFE dataset, added in 2026, is the programmatic option. Cboe's own historical CSVs give settlements only (T-1). On the evidence, the term-structure slope predicts variance risk premia and longer-horizon returns better than the VIX level does. Backwardation is a rare, stress-regime state, less than 20% of days since 2010.

### Cited Findings
**Hours**
- CFE VX futures extended trading hours run from 5:00pm (previous day) to 8:30am CT, Monday to Friday (contract spec page dated June 13, 2025, per search summary). 4:20am ET = 3:20am CT, inside the session. — [Cboe VIX futures specifications](https://www.cboe.com/tradable-products/vix/vix-futures/specifications)
- VX "is closed daily from 3:15 to 3:30 PM and from 4:00 to 5:00 PM Chicago time", and is open "nearly 23 hours a day, 5 days a week" (2020 brochure). — [Cboe GTH brochure (PDF)](https://cdn.cboe.com/resources/global-trading-hours.pdf)
- Cboe publishes 2026 holiday modified-hours notices for CFE, for example Memorial Day. — [CFE Memorial Day 2026 notice (PDF)](https://cdn.cboe.com/resources/schedule_update/2026/CFE-Modified-Trading-Hours-for-the-Memorial-Day-Holiday.pdf)

**Sources**
- **Databento:** CFE data (dataset XCBF.PITCH, from Cboe Multicast PITCH) covers VX futures and options with full depth.
  - History starts November 4, 2018, and the dataset was added in April 2026.
  - Historical data is usage-based from $27/GB or included with a CFE subscription. Real-time data is included with any CFE plan.
  - Settlement prices arrive as statistics records.
  - — [Databento blog: Introducing CFE](https://databento.com/blog/introducing-cboe-futures-exchange-cfe); [Databento XCBF.PITCH docs](https://databento.com/docs/venues-and-datasets/xcbf-pitch)
- **IBKR:** CFE Enhanced Top of Book is listed at USD 4.50/month for non-professionals (USD 12.00 for professionals), and Depth of Book at USD 7.00 (USD 18.50 for professionals). — [IBKR market data pricing (IE site, via search snippet; page returned 403 to direct fetch)](https://www.interactivebrokers.ie/en/index.php?f=37645)
- **Cboe historical data and settlements:** Cboe publishes per-contract historical futures data (Trade Date, Futures, Open, High, Low, Close, Settle...) and VIX settlement-series files. — [Cboe CFE historical data](https://www.cboe.com/us/futures/market_statistics/historical_data/); [Macroption guide](https://macroption.com/vix-futures-historical-data); [Cboe VIX settlement series](https://www.cboe.com/us/futures/market_statistics/vix_settlement_series)
- **Cboe DataShop:** sells CFE Futures Trades tick data, with external redistribution prohibited. — [Cboe DataShop CFE futures trades](https://datashop.cboe.com/cfe-futures-trades)
- **VIX Central:** VIX Central data distributed via QuantConnect is a daily-frequency contango dataset covering the 12 nearest contracts since June 2010. — [QuantConnect VIX Central dataset](https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/vix-central)
- **Not the same "term structure":** Cboe's "Term Structure" web page is built from SPX option prices, not futures. — [Cboe VIX term structure page](https://www.cboe.com/tradable_products/vix/term_structure); [Macroption](https://macroption.com/vix-term-structure)
- **Yahoo:** Yahoo has no VX futures symbol (VX=F returns "No data found"). — empirical check, [Yahoo chart endpoint](https://query1.finance.yahoo.com/v8/finance/chart/VX%3DF?interval=1d&range=5d)

**Evidence**
- Johnson (2017, JFQA) finds that the second principal component of the VIX term structure (SLOPE) predicts excess returns of variance swaps, VIX futures and S&P 500 straddles. That predictability is incremental to other variance-risk-premium proxies.
  - The working paper reports that the VIX level alone has little predictive power for S&P 500 returns, while the term structure predicts returns at 1-month to 1-year holding periods.
  - — [Johnson, JFQA 2017 (IDEAS)](https://ideas.repec.org/a/cup/jfinqa/v52y2017i06p2461-2490_00.html); [Cambridge abstract](https://www.cambridge.org/core/journals/journal-of-financial-and-quantitative-analysis/article/abs/risk-premia-and-the-vix-term-structure/56572D1F060448571BD8F597C732D9C3); [working paper (PDF)](https://www.bauer.uh.edu/departments/finance/documents/seminars/Johnson_020712.pdf)
- Simon and Campasano (2006-2011 data) find that the VIX futures basis does not forecast spot VIX changes but does forecast VIX futures returns. One point of contango relates to a 0.79 decline in the futures over the next month. — [CXO Advisory summary](https://www.cxoadvisory.com/volatility-effects/timing-and-hedging-the-roll-return-for-vix-futures/)
- Cboe notes backwardation has occurred less than 20% of the time since 2010. — [Cboe Insights: Is VIX backwardation a sign of a down market?](https://www.cboe.com/insights/posts/inside-volatility-trading-is-vix-backwardation-necessarily-a-sign-of-a-future-down-market)

### Inferences
- **Fresh regime features:** VX1 − VIX(GTH), VX2 − VX1 and ΔVX1 since the T-1 settlement are all fresh at 4:20am, and capture the overnight repricing of 1-2 month SPX variance.
  - They are better suited as regime or state covariates (calm-contango versus stressed-backwardation) for the 5-252 day distributions than as point predictors of the 1-day mean.
  - The literature supports the slope as a risk-premium and medium-horizon signal, not a strong 1-day directional signal.
- **Free fallback:** VIX/VIX3M from the Cboe CSVs (T-1) is the free option-implied slope. It is highly correlated with futures-based slope measures but stale overnight.
- **Nasdaq-100 proxy:** VX futures are S&P 500 based. No liquid Nasdaq-100 volatility futures are noted here, so the VX curve is a proxy regime signal for QQQ/TQQQ.

### Gaps
- I did not obtain Databento's current CFE subscription price (the blog gives only usage-based historical pricing) or confirm the IBKR US-site fee.
- I did not verify VIX Central's live-page latency, or whether cboe.com's delayed futures quotes (believed about 15 minutes delayed) are scrape-friendly. Cloudflare blocked automated access to cdn.cboe.com JSON from this environment.
- The 2018 JRFM paper on the VIX futures term structure as a contrarian timing indicator for the S&P 500 was not retrieved, so its results are unverified.

## 4. Options-implied expected move, IV rank, skew, put/call ratio and dealer gamma (GEX): evidence and sources for QQQ/TQQQ/SPY/SOXX/IWM

### Takeaway
For QQQ, TQQQ, SOXX and IWM chains, every options-derived value available at 4:20am is STALE (T-1 close). Equity and ETF options do not trade before 7:30am ET, and only QQQ, SPY and IWM do even then. The only fresh options-implied information comes from SPX, XSP or RUT GTH options and the VIX/VX complex.

Evidence on value is uneven:
- **Strong:** implied vol is the best single predictor of near-term realized vol.
- **Moderate:** the variance risk premium predicts returns at about a quarterly horizon.
- **Mechanism-supported but mixed:** dealer or LETF gamma affects intraday momentum.
- **Weak for public aggregates:** the classic put/call result uses non-public, buyer-initiated volume.

Sources range from free (Massive Basic EOD, Yahoo chains, Cboe daily statistics) to about $29-99/month (Massive Starter/Developer, ThetaData, Market Chameleon, SpotGamma) and $199-720/month (ORATS, Massive Advanced, Databento OPRA, SqueezeMetrics).

### Cited Findings
**Evidence: implied vs realized vol**
- Blair, Poon and Taylor (2001, J. Econometrics) compared forecasts of S&P 100 volatility at 1-20 day horizons.
  - In-sample, VIX "supplies nearly all relevant information", and 5-minute realized returns add little.
  - Out-of-sample, VIX gives the most accurate forecasts at all horizons.
  - — [EconPapers](https://econpapers.repec.org/RePEc:eee:econom:v:105:y:2001:i:1:p:5-26)
- Bollerslev, Tauchen and Zhou (2009, RFS) find that the variance risk premium (model-free implied variance minus realized variance from intraday data) explains a nontrivial fraction of post-1990 market returns. Predictability is strongest at the quarterly horizon and beats P/E, the default spread and cay. — [SSRN 948309](https://papers.ssrn.com/abstract=948309); [EconPapers](https://econpapers.repec.org/RePEc:oup:rfinst:v:22:y:2009:i:11:p:4463-4492)

**Evidence: put/call ratios**
- Pan and Poteshman (2006, RFS) built a put/call ratio from buyer-initiated, open-position volume using proprietary Cboe data. Low-ratio stocks outperform high-ratio stocks the next day (more than 40 bp/day per a summary), which the authors attribute to informed trading. — [NBER w10925](https://www.nber.org/papers/w10925); [EconPapers](https://econpapers.repec.org/RePEc:oup:rfinst:v:19:y:2006:i:3:p:871-908); [OptionMetrics summary](https://optionmetrics.com/research/j-pan-and-a-m-poteshman-the-information-in-option-volume-for-stock-prices/)
- Cboe's Daily Market Statistics page publishes total, index, equity and SPX+SPXW put/call ratios and volumes. For example, 2026-11-05 shows total 1.06, index 1.07, equity 0.89 and SPX+SPXW 1.24. — [Cboe daily market statistics 2026-11-05](https://www.cboe.com/markets/us/options/market-statistics/daily?dt=2026-11-05)
- Cboe's downloadable historical archive stops in October 2019, and Cboe points to the daily page for current data. — [Cboe options historical data](https://ww2.cboe.com/us/options/market_statistics/historical_data)
- Cboe notes that early-exercise order flow distorts the equity put/call ratio. — [Cboe Insights: early exercise and equity P/C](https://www.cboe.com/insights/posts/how-early-exercise-order-flow-impacts-equity-option-put-call-ratios)

**Evidence: gamma and GEX**
- Baltussen, Da, Lammers and Martens (2021, JFE) find market intraday momentum (the rest-of-day return predicts the last-30-minute return) across more than 60 futures, 1974-2020.
  - They attribute it to hedging of short-gamma positions by option market makers and leveraged ETFs.
  - In S&P 500 index options, momentum appears when a proxy for net gamma exposure is negative and strengthens as it becomes more negative. There is no significant effect on positive-gamma days (per a secondary summary).
  - — [EconPapers](https://econpapers.repec.org/RePEc:eee:jfinec:v:142:y:2021:i:1:p:377-403); [working paper (PDF)](https://www3.nd.edu/~zda/intramom.pdf); [Alpha Architect summary](https://alphaarchitect.com/hot-topic-does-gamma-hedging-actually-affect-stock-prices/)
- Dim, Eraker and Vilkov ("0DTEs: Trading, Gamma Risk and Volatility Propagation", SSRN 4692190) reportedly find no evidence that higher 0DTE open-interest gamma raises index volatility. It is instead linked to lower intraday volatility, and 0DTEs carry the largest VRP. These are secondary summaries; I did not read the paper. — [Harbourfront Quant summary](https://harbourfrontquant.substack.com/p/impact-of-zero-dte-options-on-the); [Oxford talk listing](https://www.maths.ox.ac.uk/node/67396)
- A separate study (Adams et al.) also links 0DTE trading to lower S&P 500 volatility (secondary). — [Quantpedia](https://quantpedia.com/do-sp500-0dtes-options-increase-market-volatility/)

**Vendors: definitions**
- Market Chameleon defines IV percent rank as the percentile of the current IV30 against the past year of daily IV30. Its "implied move" is the ATM straddle price as a percentage of the stock price. — [Market Chameleon: Learn Volatility](https://marketchameleon.com/Learn/Volatility); [Implied vol movers](https://marketchameleon.com/volReports/TopImpliedVolMovers)

**Vendors: pricing (as published; verify before subscribing)**
- **ORATS:**
  - Delayed Data API from $199/month (15-minute delayed; includes IV Rank and its history)
  - Live $299/month (100k requests)
  - Live Intraday $599/month (1M requests)
  - A near-EOD bulk product is listed at $99/month.
  - — [ORATS data API](https://orats.com/data-api); [ORATS delayed API docs](https://orats.com/docs/delayed-data-api); [ORATS intraday API](https://orats.com/intraday-data-api); [ORATS near-EOD](https://orats.com/near-eod-data)
- **Tradier:**
  - The chain endpoint can include greeks and IV "courtesy of ORATS". Tradier's market-data overview lists greeks and IV as updated hourly.
  - Real-time data requires a Tradier brokerage, partner or advisor account.
  - A real-time ORATS add-on is quoted at $50/month on ORATS' page versus $99/month on Tradier's page (conflict).
  - — [Tradier get options chains](https://documentation.tradier.com/brokerage-api/markets/get-options-chains); [Tradier market data overview](https://documentation.tradier.com/brokerage-api/overview/market-data); [ORATS for Tradier](https://orats.com/tradier); [Tradier ORATS page](https://brokerage.tradier.com/platforms/orats)
- **Massive (formerly Polygon.io), individual plans:**

  | Plan | Price/month | Delay | Greeks/IV and OI | Other |
  |---|---|---|---|---|
  | Basic | $0 | End of day | No | 2 years history, 5 calls/min |
  | Starter | $29 | 15-minute delayed | Current only | Snapshots |
  | Developer | $79 | 15-minute delayed | Current only | Adds trades, 4 years history |
  | Advanced | $199 | Real-time | Current and historical | Adds quotes; non-professionals only |

  - Index-option greeks require the "I:SPX"-style ticker. Historical EOD greeks and IV go back to September 1, 2022.
  - — [Massive options pricing](https://massive.com/options); [Massive KB: greeks for index options](https://massive.com/knowledge-base/article/does-massive-support-greeks-for-index-option-contracts); [Massive greeks/IV docs](https://massive.com/docs/rest/options/analytics/greeks-iv.md)
- **ThetaData:**
  - Options plans: Value $40/month and Standard $80/month (official page), with Pro at $160 per a third party.
  - Individual-use only. Index-underlying data needs a separate subscription.
  - — [ThetaData subscribe](https://thetadata.net/subscribe); [FlashAlpha comparison (competitor)](https://flashalpha.com/articles/flashalpha-vs-thetadata-options-greeks-iv-api)
- **Databento OPRA:**
  - Usage-based live OPRA pricing was discontinued June 3, 2025, and a Standard plan was introduced at $199/month.
  - CBBO-1m history from 2013 and CBBO-1s from March 2023.
  - Subscriber status is determined by a questionnaire.
  - — [Databento new OPRA plans](https://databento.com/blog/introducing-new-opra-pricing-plans); [Databento OPRA.PILLAR docs](https://databento.com/docs/datasets/opra-pillar)
- **OPRA:** OPRA defines a Non-Professional Subscriber as one using options data for personal, non-business use. — [OPRA FAQ](https://opraplan.com/faqs)
- **Market Chameleon:** Premium is listed at $99/month with a free first week. — [Market Chameleon Premium](https://marketchameleon.com/Premium)
- **SpotGamma:**
  - The support page lists Essential at $99/month and Alpha at $299/month. An order form shows "Standard" at $89/month (conflict).
  - API access is reportedly Alpha-only, per a competitor (FlashAlpha).
  - A free daily SPX GEX chart exists.
  - — [SpotGamma support: cost](https://support.spotgamma.com/hc/en-us/articles/1500002666102-What-is-the-cost-of-a-SpotGamma-Subscription); [SpotGamma order form](https://spotgamma.com/standard-reg-monthly); [SpotGamma free SPX GEX](https://spotgamma.com/free-tools/spx-gamma-exposure); [FlashAlpha review (competitor)](https://flashalpha.com/articles/spotgamma-review-2026-pricing-features-alternatives)
- **SqueezeMetrics:** a data plan with DIX, GEX, downloads and API is listed at $720/month (secondary sources). — [NexusFi listing](https://nexusfi.com/d/data-providers/squeezemetrics-prior-analytics-llc); [FlashAlpha comparison (competitor)](https://flashalpha.com/articles/flashalpha-vs-squeezemetrics-gex-api)
- **Schwab:** the individual Trader API includes a market-data "chains" endpoint (`/marketdata/v1/chains`) that returns greeks (community sources). Cost was not confirmed. — [Schwab Trader API (individual)](https://developer.schwab.com/products/trader-api--individual); [Wealth-Lab forum](https://wealth-lab.com/Discussion/11228)

### Inferences
**Expected 1-day move**
- **At 4:20am:**
  - Use the T-1 close QQQ ATM straddle for the nearest expiry, or its IV, as the baseline.
  - Update it with the fresh overnight ΔVIX (GTH) times a VXN-on-VIX beta, or with the change in an SPX GTH 1-day straddle where a feed exists.
  - For a normal, zero-drift distribution the ATM straddle ≈ E|move| = σ_1d·S·√(2/π) ≈ 0.8·σ_1d·S. So σ_1d ≈ 1.25 × straddle/S, and σ_1d ≈ IV/√252 when working from IV.
- **On the T-1 close:** the expiring 0DTE straddle at 4pm is nearly worthless. Use the next-day (1DTE) expiry's straddle at the T-1 close, not the 0DTE.

**Implied vs realized spread**
- Compute VRP = IV² − RV² with VXN (or the QQQ chain's 30-day IV) against a 20-day Yang-Zhang or HAR realized vol of QQQ.
- BTZ evidence supports this as a medium-horizon (21-63 day) return covariate. Blair, Poon and Taylor support implied vol as the main input to the 1-5 day volatility forecast.

**Skew**
- A 25-delta put-minus-call IV skew for QQQ needs a chain with greeks (Massive Starter or higher, ThetaData, ORATS).
- SKEW (Cboe, T-1) is a free but slow S&P tail proxy.

**Put/call ratio**
- The usable free series is Cboe's daily total, index, equity and SPX ratios, which must be scraped and archived daily because the downloadable history ends in 2019.
- Expect weak next-day predictive power. The strong academic result relies on non-public, buyer-initiated open-position volume.
- A QQQ-specific put/call from chain volume (Massive or Yahoo) is computable from T-1 data.

**GEX**
- Any GEX value at 4:20am is based on T-1 open interest and T-1 prices, so it is a stale level, though spot moves overnight (from futures) can be applied to re-evaluate gamma at the new spot.
- The evidence supports GEX sign as a predictor of intraday path (momentum versus mean reversion) and realized-vol regime, not of next-day direction. 0DTE-specific gamma appears not to raise volatility.

**TQQQ options**
- TQQQ has a listed option chain, but it is far less liquid than QQQ's and is not in the new pre-market option session list. QQQ chain IV × 3 is the more robust input (see section 6).

### Gaps
- I could not retrieve Yahoo option chains (QQQ/TQQQ) during this session (HTTP 429 "Too Many Requests" on the crumb endpoint). I could not verify TQQQ open interest or volume, or compare TQQQ ATM IV with 3 × QQQ ATM IV empirically.
- Unusual Whales, MenthorQ, Barchart and Cboe LiveVol pricing and API terms were not researched (search budget). OCC daily volume reports were not verified.
- I did not verify when Cboe posts the daily put/call statistics after the close, or when OCC open interest for T-1 becomes available, which matters for GEX freshness.
- Whether Databento's OPRA dataset includes the separate OPRA GTH system (SPX overnight quotes) was not verified.
- I did not obtain IBKR's current US OPRA non-professional fee (the IBKR pages returned 403).
- No paper was found measuring the predictive value of the ATM-straddle expected move or IV rank for next-day leveraged-ETF returns specifically.

## 5. Realized-volatility estimators better than 20-day close-to-close, and the data they need

### Takeaway
Range-based estimators need only daily OHLC, which the app already pulls, and make better use of each day than close-to-close.
- Parkinson uses high/low.
- Garman-Klass uses OHLC.
- Rogers-Satchell is drift-robust.
- Yang-Zhang is drift-independent, handles opening jumps, and has minimum variance among comparable estimators.

HAR-RV (daily, weekly and monthly RV components) is the standard benchmark for forecasting realized vol and is best fed with intraday 5-minute RV. Implied vol nonetheless carries most of the forecasting information at 1-20 day horizons, so the realized estimators matter most for the implied-vs-realized spread and as a fallback.

### Cited Findings
- Yang and Zhang (2000, Journal of Business 73(3):477-492) give an OHLC estimator that is unbiased in the continuous limit, independent of drift, consistent with opening jumps, and has the smallest variance among estimators with those properties. — [EconPapers](https://econpapers.repec.org/RePEc:ucp:jnlbus:v:73:y:2000:i:3:p:477-91)
- Third-party descriptions say Yang-Zhang combines the close-to-open (overnight) variance, the open-to-close variance and the Rogers-Satchell intraday variance. Its reference list includes the 1980 Journal of Business extreme-value (Parkinson) paper and Garman-Klass (1980). — [Scilit record](https://www.scilit.net/publications/fd43bff42efe45103df37617c1b48361); [CityU record](https://scholars.cityu.edu.hk/en/publications/drift-independent-volatility-estimation-based-on-high-low-open-an/)
- Corsi (2009, J. Financial Econometrics) introduced HAR-RV, an AR-type model on realized volatility over daily, weekly and monthly horizons. It reproduces long-memory features and reports "remarkably good forecasting performance", and later literature treats it as the benchmark. — [SSRN 1365738](https://papers.ssrn.com/abstract=1365738); [EconPapers](https://econpapers.repec.org/RePEc:oup:jfinec:v:7:y:2009:i:2:p:174-196)
- Blair, Poon and Taylor (2001) find VIX dominates sums of squared 5-minute returns for 1-20 day S&P 100 volatility forecasts, and intraday returns add insignificant incremental information. — [EconPapers](https://econpapers.repec.org/RePEc:eee:econom:v:105:y:2001:i:1:p:5-26)

### Inferences
**Data each estimator needs**

| Estimator | Inputs | Notes |
|---|---|---|
| Parkinson, Garman-Klass, Rogers-Satchell, Yang-Zhang | Daily O, H, L, C for QQQ, SPY, SOXX, IWM and the LETFs | Free from yfinance. Use the underlying ETF's RTH OHLC, not the volatility indices' OHLC, which have spikes (section 2). |
| Yang-Zhang overnight term | Prior close to today's open | Directly relevant to gap risk. Estimate an overnight-variance share separately and feed it as a covariate. |
| HAR-RV | Intraday bars (5-minute RV) | Massive Starter or Developer gives minute aggregates for stocks/ETFs in the options plans listed; the stock-plan details were not verified. A daily-range version (HAR on Yang-Zhang or Parkinson daily variances) is a cheap substitute. |

**Fresh at 4:20am**
- Overnight realized vol of NQ or ES futures from 6:00pm to 4:20am ET bars, and the overnight futures gap, are fresh realized measures. They complement the GTH VIX. The futures data source is covered by other research.

**For leveraged ETFs**
- Compute realized vol on the underlying and scale by L. The LETF's own OHLC is affected by daily rebalancing and is noisier in pre-market.

### Gaps
- I did not retrieve the Parkinson (1980) and Garman-Klass (1980) primary sources, or the relative-efficiency numbers, directly.
- Not verified: Liu, Patton and Sheppard-type comparisons of RV estimators for ETFs, and whether HAR improves on implied vol for 1-day QQQ forecasts.

## 6. Leveraged-ETF-specific issues: volatility decay, TQQQ implied vol versus 3× VXN, options on TQQQ

### Takeaway
A daily-rebalanced 3× fund's 1-day return is about 3× the underlying, so the 1-day implied move for TQQQ is about 3× QQQ's. At multi-day horizons (5-252d), however, compounding creates path-dependent volatility drag. The app's 5-252 day distributions should be simulated from underlying paths, or the Chronos output adjusted with the drag term, not obtained by multiplying the underlying's horizon return by 3.

On options, Leung and Sircar's moneyness scaling says a TQQQ option's implied vol should be compared with QQQ IV at an L-scaled log-moneyness, not strike for strike. VXN × 3 is a reasonable at-the-money, 30-day proxy for TQQQ volatility, but it is a variance-swap-style index (it embeds skew), so it will usually sit above 3 × ATM IV.

### Cited Findings
- Cheng and Madhavan (2009, J. Investment Management) show that a leveraged or inverse ETF's gross return embeds a path-dependent option. They also show that daily re-leveraging "can exacerbate volatility towards the close". — [JOIM](https://joim.com/dynamics-leveraged-inverse-exchange-traded-funds); [PDF](https://joim.com/wp-content/uploads/emember/downloads/p0283.pdf)
- Baltussen et al. (2021) name leveraged ETFs, along with option market makers, as a source of short-gamma hedging demand that drives intraday momentum into the close. — [EconPapers](https://econpapers.repec.org/RePEc:eee:jfinec:v:142:y:2021:i:1:p:377-403)
- Leung and Sircar (2015, Applied Mathematical Finance) derive "moneyness scaling" linking leveraged-ETF and unleveraged-ETF implied vols, as a function of the leverage ratio. Their S&P 500 LETF empirics suggest possible price discrepancies across leverage ratios. — [EconPapers](https://econpapers.repec.org/RePEc:taf:apmtfi:v:22:y:2015:i:2:p:162-188); [Princeton record](https://collaborate.princeton.edu/en/publications/implied-volatility-of-leveraged-etf-options/)
- Leung, Lorig and Pascucci extend this to a log-moneyness scaling that is quadratic rather than linear. — [arXiv 1404.6792](https://arxiv.org/pdf/1404.6792)
- A 2025 arXiv paper argues that LETF performance depends fundamentally on return autocorrelation and dynamics, not only on volatility drag (secondary search summary). — [arXiv 2504.20116](https://web3.arxiv.org/pdf/2504.20116)
- The app currently sets `symbol_iv_pct` = leverage × (VXN, VIX or RVX). For SOXL it uses VXN, not a semiconductor measure. — local source `/home/user/pre-market-session-forecast-report-generator/chronos_service/app.py`

### Inferences
- **Drag term:** for a daily-rebalanced L× fund with underlying daily variance σ²:
  - E[log LETF return] ≈ L·μ − L²σ²/2 per unit time, while L × E[log underlying return] = L·μ − L·σ²/2. The extra drag relative to L × the underlying's log return is therefore (L²−L)/2·σ²·t.
  - For L = 3 and σ_QQQ = 30% annualized, the extra drag is (9−3)/2 × 0.09 = 0.27 in log terms per year, or about 2.25% over 21 trading days. At σ = 40% it is about 0.48 per year.
  - This is standard algebra consistent with Cheng-Madhavan's path-dependence result; verify with the app's own simulation.
  - The 21-, 63- and 252-day TQQQ quantiles are therefore very sensitive to the volatility input, which raises the value of good IV and term-structure covariates at long horizons. Use VIX3M/VIX6M or VXN term proxies for the 63/252-day bins, not the 30-day VXN alone.
- **TQQQ IV versus 3 × VXN:** prefer 3 × QQQ chain ATM IV, or VXN × 3 as a 30-day variance proxy. Treat any gap between TQQQ's own chain IV and 3 × QQQ IV as a liquidity or rebalancing-mispricing artifact rather than a signal, unless verified.
- **SOXL:** for SOXX, use SOXX chain IV × 3 if a chain source is available, otherwise VXN × β(SOXX/QQQ). VXN alone understates semiconductor volatility.
- **Rebalancing flow:** LETF rebalancing flow, which can be estimated from LETF AUM × L(L−1) × the day's return, is a known close-of-day gamma flow. It matters for intraday path but not for 4:20am information.

### Gaps
- I could not verify TQQQ option liquidity (OI, volume, spreads) or obtain a direct empirical comparison of TQQQ chain IV with 3 × QQQ IV, because Yahoo options was rate-limited and the vendor pages were not fetched.
- No vendor-specific evidence was found that TQQQ IV rank adds information beyond QQQ or VXN IV rank.

## 7. Recommended signals and sources by budget tier (free, retail under about $100/month, professional)

### Takeaway
Start for free:
- Add GTH VIX at about 4:05-4:20am (yfinance 1-minute, includePrePost) and the overnight ΔVIX.
- Pull T-1 VIX9D, VIX1D, VIX3M, VIX6M, VVIX, SKEW, VXN and RVX from Cboe's CSVs (fixing TNA's broken ^RVX).
- Compute VXN/RVX IV rank and percentile locally.
- Compute Yang-Zhang and HAR realized vol from OHLC, and form a real implied-vs-realized spread.

Retail spend buys the overnight VX curve (IBKR, CFE L1 about $4.50/month for non-professionals) and option-chain IV, skew and OI for QQQ/SOXX/IWM/TQQQ (Massive Starter $29 or Developer $79, ThetaData $40-80, or Market Chameleon/SpotGamma at about $89-99 for derived metrics). Professional spend ($199-720+/month) buys real-time SPX GTH chains (OPRA/Databento), ORATS IV-rank history, and API-grade GEX.

### Cited Findings
- **Free (Cboe and FRED):** Cboe CSVs (free, disclaimer on accuracy) and FRED (T-2 at 4:20am) — [Cboe historical data](https://www.cboe.com/tradable_products/vix/vix_historical_data/); [FRED VXNCLS](https://fred.stlouisfed.org/series/VXNCLS)
- **Free (Yahoo):** GTH VIX on Yahoo from 3:15am ET (empirical) — [Yahoo chart endpoint](https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1m&range=5d&includePrePost=true)
- **Free options data:** Massive Basic is free, end of day, with no greeks; Starter is $29 at a 15-minute delay with current greeks/IV/OI — [Massive options](https://massive.com/options)
- **Free put/call:** Cboe's daily put/call statistics (free web page; archive download ends in 2019) — [Cboe daily market statistics](https://www.cboe.com/markets/us/options/market-statistics/daily?dt=2026-11-05); [Cboe historical](https://ww2.cboe.com/us/options/market_statistics/historical_data)
- **Free GEX:** SpotGamma's free SPX GEX chart — [SpotGamma free tool](https://spotgamma.com/free-tools/spx-gamma-exposure)
- **Retail:** IBKR CFE L1 at $4.50/month for non-professionals — [IBKR pricing (IE)](https://www.interactivebrokers.ie/en/index.php?f=37645)
- **Retail:** ThetaData $40/$80, individual-only — [ThetaData](https://thetadata.net/subscribe)
- **Retail:** Market Chameleon $99 — [Market Chameleon](https://marketchameleon.com/Premium)
- **Retail:** SpotGamma $89-99 — [SpotGamma support](https://support.spotgamma.com/hc/en-us/articles/1500002666102-What-is-the-cost-of-a-SpotGamma-Subscription)
- **Retail:** ORATS near-EOD at $99 — [ORATS near-EOD](https://orats.com/near-eod-data)
- **Professional:** ORATS $199/$299/$599 — [ORATS](https://orats.com/data-api)
- **Professional:** Massive Advanced $199 (real-time, historical greeks) — [Massive](https://massive.com/options)
- **Professional:** Databento OPRA Standard $199 — [Databento](https://databento.com/blog/introducing-new-opra-pricing-plans)
- **Professional:** Databento CFE — [Databento CFE](https://databento.com/blog/introducing-cboe-futures-exchange-cfe)
- **Professional:** SpotGamma Alpha $299 — [SpotGamma support](https://support.spotgamma.com/hc/en-us/articles/1500002666102-What-is-the-cost-of-a-SpotGamma-Subscription)
- **Professional:** SqueezeMetrics $720 (secondary) — [NexusFi](https://nexusfi.com/d/data-providers/squeezemetrics-prior-analytics-llc)
- **Licensing:**
  - Massive and ThetaData retail plans are individual-use only.
  - Massive Advanced is limited to non-professionals.
  - OPRA's non-professional status requires personal, non-business use.
  - Databento assigns subscriber status by questionnaire.
  - Cboe DataShop CFE trade data prohibits external redistribution.
  - — [Massive](https://massive.com/options); [ThetaData commercial](https://thetadata.net/commercial-use); [OPRA FAQ](https://opraplan.com/faqs); [Databento](https://databento.com/blog/introducing-new-opra-pricing-plans); [Cboe DataShop](https://datashop.cboe.com/cfe-futures-trades)

### Inferences
**Master inventory (synthesis of the cited findings above; freshness at 4:20am ET)**

| Signal | What it measures | Forecasting evidence | Fresh at 4:20am? | Best sources (cost) |
|---|---|---|---|---|
| VIX spot (GTH) and ΔVIX overnight | 30-day SPX implied vol, repriced overnight from SPX GTH options | Implied vol dominates 1-20 day volatility forecasts (Blair, Poon and Taylor) | **FRESH** (3:15am+, about 15 minutes delayed on Yahoo) | yfinance/Yahoo 1-minute includePrePost (free); IBKR or tastytrade (real-time, broker) |
| VX futures VX1, VX2, basis, ΔVX1 | Market-priced forward 1-2 month variance; contango or backwardation regime | Slope predicts variance risk premia and 1-12 month returns (Johnson 2017); basis predicts VX returns (Simon-Campasano) | **FRESH** (CFE ETH) | IBKR CFE L1 ($4.50 non-professional); Databento XCBF (paid); Cboe settlements CSV (T-1, free); not on Yahoo |
| SPX/XSP/RUT GTH options straddle, IV, skew | Overnight-updated implied 1-day move for S&P (and Russell via RUT) | Same IV evidence | **FRESH** (8:15pm-9:25am GTH; liquidity thinner) | IBKR, tastytrade (broker data); OPRA GTH feed via a pro vendor (coverage unverified) |
| VIX1D | Same- and next-day SPX implied vol | Direct implied 1-day move for SPY | STALE (T-1, RTH only) | Cboe CSV (free, posted about 5:31pm ET); yfinance ^VIX1D |
| VIX9D, VIX3M, VIX6M, VIX1Y (ratios VIX9D/VIX, VIX/VIX3M) | Implied term structure (event, stress, slope) | Slope evidence (Johnson) | STALE (T-1) | Cboe CSVs (free); yfinance |
| VVIX | Volatility of VIX | Tail-width proxy (no specific study retrieved) | STALE (T-1) | Cboe CSV; yfinance ^VVIX |
| SKEW | S&P far-OTM tail pricing | Slow tail-risk proxy (no study retrieved) | STALE (T-1, posted about 9:11pm ET) | Cboe CSV; yfinance ^SKEW |
| VXN | NDX 30-day implied vol, primary for QQQ/TQQQ | IV evidence | STALE (T-1; FRED is T-2) | Cboe CSV (free); yfinance ^VXN |
| RVX | Russell 2000 implied vol, primary for IWM/TNA | IV evidence | STALE (T-1) | Cboe CSV only (yfinance ^RVX broken) |
| IV rank / IV percentile | Where IV sits in its 1-year range | Mainly regime context; no rigorous next-day evidence found | STALE (T-1) | Self-compute from Cboe VXN/RVX CSV (free); ORATS ($199+), Market Chameleon ($99) for chain-based |
| QQQ/SOXX/IWM/TQQQ ATM straddle (1DTE), 25-delta skew | Ticker-specific implied move and skew | IV evidence | STALE (T-1; ETF options pre-market from 7:30am only) | Massive Starter or Developer ($29/$79, 15-minute delayed snapshot is fine at the close); ThetaData ($40-80); Schwab or Tradier (brokerage); Massive Basic EOD (free, self-compute IV) |
| Implied minus realized spread (VRP) | Variance risk premium | Predicts about quarterly returns (Bollerslev, Tauchen and Zhou) | STALE IV (or fresh with GTH VIX) minus RV | Self-compute: VXN² − YZ/HAR RV² (free) |
| Put/call ratios (total, index, equity, SPX, QQQ) | Hedging or sentiment demand | Strong only for non-public buyer-initiated data (Pan-Poteshman); public aggregates weak | STALE (T-1) | Cboe daily statistics page (free, scrape and archive); chain volume from Massive or Yahoo |
| GEX / dealer gamma | Sign and size of hedging flows | Negative gamma leads to intraday momentum (Baltussen et al.); 0DTE gamma not volatility-increasing (Dim-Eraker-Vilkov) | STALE (T-1 OI), re-evaluated at the overnight spot | SpotGamma ($89-299; free SPX chart), SqueezeMetrics ($720), or self-compute from chain OI and greeks |
| Range-based and HAR realized vol | Realized variance, including the overnight share | HAR benchmark (Corsi); Yang-Zhang efficiency | STALE (T-1); overnight futures RV is FRESH | yfinance OHLC (free); intraday bars from Massive (paid) |

**Priority order for the user's 4:30am deadline:**
1. GTH VIX and ΔVIX as a known-future-style covariate for day T (free, fresh).
2. T-1 VIX9D/VIX/VIX3M ratios, VXN or RVX levels and their IV rank and percentile from the Cboe CSVs (fills `vix9d_level`, `vix3m_level` and `iv_rank_pct`; fixes the TNA source).
3. A real `implied_vs_realized` spread using Yang-Zhang realized vol.
4. The VX futures overnight curve via IBKR ($4.50/month).
5. Chain-based QQQ 1DTE straddle and 25-delta skew via Massive Starter ($29).
6. Cboe daily put/call archived nightly (fills `put_call_ratio`, with low expected value).

**Timing:** all T-1 inputs can be fetched after about 9:30pm ET the night before, cached, and rechecked at 4:15am. Only the GTH VIX, VX futures and (optionally) SPX GTH options need the 4:15-4:20am pull.

### Gaps
- Exact current pricing could not be verified first-hand for IBKR (US site, OPRA fee), Databento CFE subscription, Unusual Whales, MenthorQ, Barchart and Cboe LiveVol.
- Several prices above come from competitor (FlashAlpha) or forum pages and are flagged as such.
- Yahoo and yfinance terms of use for automated personal use were not reviewed. Yahoo intraday history depth (about 7 days at 1-minute) limits backfilling a GTH VIX feature, and a paid intraday VIX history source for training was not identified or priced.
