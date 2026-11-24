# Overnight, Pre-Market and Cross-Asset Price Feeds for a 4:15–4:25am ET Automated Forecast (as of Nov 24, 2026)

Scope note: researched Nov 24, 2026. Several vendor pricing pages (databento.com/pricing, interactivebrokers.com market-data pricing, tiingo.com blog, barchart.com OnDemand) were JavaScript-rendered or returned HTTP 403 to the fetch tool. Figures for those come from vendor docs pages, search-engine snippets or third-party pages, and are flagged. Times are US Eastern unless stated. "Non-pro" means non-professional subscriber.

## Q1. Which vendors/APIs give real-time or near-real-time CME Globex equity index futures (NQ/MNQ/ES/MES/RTY) at 4:20am ET, and at what cost, licensing, API style and reliability?

### Takeaway
Real-time CME data is cheap at the exchange level (CME's 2026 non-pro top-of-book fee is $1.55 per exchange per month, or $4.65 for all four CME Group exchanges). The main costs come from the vendor's own fees and from licensing rules on API ("non-display") use. For an individual's 4:20am pull, the realistic choices are:
- **Broker APIs:** Schwab Trader API (free with an account) or IBKR (small subscription).
- **Massive (formerly Polygon.io):** 10-minute-delayed futures at $29–$79/month, or real-time at $199/month.
- **Databento:** live CME with personal use bundled into its Standard plan, plus a 24-hour intraday replay that makes it easy to compute the true overnight change.

Tradovate's API route is expensive for data, because of the CME non-display license. Alpaca, Twelve Data, Finnhub and EODHD do not offer CME futures (the first three explicitly do not; for EODHD it is unconfirmed). yfinance gives futures 10 minutes delayed for free, but it is unofficial and often rate-limited.

### Cited Findings

**CME exchange fees (the floor under every vendor)**
- CME Group fee list, effective January 1, 2026. Fees are assessed per exchange (CME, CBOT, NYMEX, COMEX):
  - Non-Professional Top of Book: $1.55 per device per month; bundle for all four exchanges $4.65.
  - Non-Professional Depth of Market: $12.10 per exchange; bundle $36.50.
  - Professional real-time display device: $134.50 per exchange.
  - E-mini professional device: $73 (CME).
  - Delayed display device: $0.
  - "User Non-Display Category A" license: $457, where "Fee applies for a Licensee who qualifies; is a single natural user".
  - Footnote 10: non-display "Fees apply to all Applications accessing Real Time or Delayed Information".
  - Source: [CME Group Fee List (Databento-hosted copy, eff. Jan 1 2026)](https://api.databento.com/static/licensing/cme/cme-market-data-fee-list.pdf). The June 2026 CME fee list shows the same $1.55 and $4.65 non-pro top-of-book figures per a search snippet: [CME June 2026 fee list](https://www.cmegroup.com/market-data/files/june-2026-market-data-fee-list.pdf).
  - Caution: one search summary quoted "$1.60 / $5.90" as CME non-pro fees. In the PDF those numbers belong to the separate "GME" information set, not CME/CBOT/NYMEX/COMEX.
- CME's own website quotes are "delayed by at least 10 minutes" — [CME delayed quotes](https://www.cmegroup.com/market-data/delayed-quotes/interest-rates.html). CME publishes a licensed-distributor list — [CME licensed distributors](https://www.cmegroup.com/market-data/licensed-distributors.html).

**CME session structure (defines the "true overnight change")**
- Since Oct 26, 2020, equity index daily settlement is determined at 4:00pm ET / 3:00pm CT, using "a 30-second volume weighted average price of the futures trades... leading up to 4pm ET" — [CME settlement time FAQ](https://cmegroup.com/education/articles-and-reports/faq-daily-settlement-price-determination-time-change.html); [CME equity index daily & final settlement](https://www.cmegroup.com/education/courses/introduction-to-equity-index-products/understanding-equity-index-daily-and-final-settlement.html)
- E-mini Nasdaq-100 trades Sunday 6:00pm to Friday 5:00pm ET, with a daily maintenance break 5–6pm ET — [Schwab E-mini Nasdaq page](https://www.schwab.com/futures/nasdaq-100-emini). Sources conflict here: MarketsWiki lists a 4:15–4:30pm ET halt, which appears outdated — [MarketsWiki](https://marketswiki.com/wiki/CME_Group_NASDAQ-100).

**Databento**
- Live data comes with a Standard, Plus or Unlimited plan.
- CME "Personal" license: "Included with Standard plan (up to 2 devices)".
- CME commercial license: $973 per exchange, plus $2,170 distribution, plus $35.40 per personal user or $119.80 per commercial user.
- License fees are passed through without markup, but a 2.9% Stripe fee applies. You can terminate at any time.
- Source: [Databento live data guide](https://databento.com/docs/portal/live-data)
- Plan prices are unverified: the pricing page did not render for the fetch tool.
  - Search snippets report the CME Standard plan at $199/month with live data and license fees included, Plus at $1,750/month and Unlimited at $4,500/month (Plus and Unlimited on annual contracts).
  - Databento's April 2025 announcement said new CME plans start "at just $179/month" with up to 15 years of history — [Databento on X](https://x.com/DatabentoHQ/status/1912476824677785699); [NexusFi Databento overview](https://nexusfi.com/a/data/databento-futures-market-data)
  - An older (2023-era) announcement opened live CME to all users "starting at $32.65/month" on usage-based pricing — [Databento roadmap](https://roadmap.databento.com/announcements/real-time-cme-data-is-now-open-to-all-users-starting-at-3265month). The plan-based pricing appears to supersede this.
- Live API protocol and features:
  - It is a raw TCP socket protocol, not WebSocket, with official Python (`databento`), C++ and Rust clients.
  - Intraday replay covers the last 24 hours through a `start` parameter; `start=0` gives the full replay window.
  - Limits: 10 simultaneous sessions per dataset on Standard (50 on Plus/Unlimited), and 5 connections per second per IP.
  - Parent symbology is supported (e.g., `ES.FUT` with `stype_in="parent"`), as is continuous symbology.
  - Source: [Databento Live API reference](https://databento.com/docs/api-reference-live)

**Massive (formerly Polygon.io)**
- Rebrand confirmed: "Polygon.io is now Massive," effective October 30, 2025. Existing API keys keep working, and api.polygon.io runs in parallel with api.massive.com — [Massive blog](https://massive.com/blog/polygon-is-now-massive). Some third-party guides misdate the rename to 2026 — [apicostcalc](https://apicostcalc.com/blog/polygon-massive-rebrand-api-pricing.html).
- Futures plans (CME, CBOT, NYMEX, COMEX), from [Massive futures](https://massive.com/futures):

  | Plan | Price | Delay | Contents |
  |---|---|---|---|
  | Basic | $0 | not stated | 5 API calls/min, 2 years of history, minute aggregates, historical and reference data |
  | Starter | $29/mo | 10 minutes | WebSocket, unlimited calls, minute and second aggregates, snapshot, flat files |
  | Developer | $79/mo | 10 minutes | Starter plus trades and top-of-book quotes, 5 years of history |
  | Advanced | $199/mo | real-time | 7+ years of history |

  - Annual billing saves 20%.
  - Pricing links to "Non-pros only".
  - Depth of book and options on futures are "Coming soon".
- Massive Stocks Advanced is $199/month (real-time, WebSocket), marked "Individual use only" — [Massive pricing](https://massive.com/pricing?product=futures)

**Interactive Brokers**
- IBKR's market data pricing page returned 403. Search snippets show a "US Securities Snapshot and Futures Value Bundle" at USD 10.00/month (waivable with commissions) and a non-pro "US Futures Value PLUS Bundle" at USD 5.00/month — [IBKR market data pricing](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php). I could not confirm IBKR's exact CME-only L1 line item.
- IBKR's non-professional definition: an individual not registered with financial regulators, not acting as an investment adviser and not employed by a financial institution in a registration-exempt role — [IBKR non-pro FAQ](https://www.interactivebrokers.com/support/faq/content/1136177958)

**Schwab Trader API (successor to the TD Ameritrade API)**
- The community `schwab-py` client documents these streams: LEVELONE_FUTURES (41 fields including bid/ask/last, mark, open interest, trading hours), CHART_FUTURES (minute OHLCV bars) and level-one equity quotes. FUTURES_BOOK and FOREX_BOOK failed with "unavailable service" errors — [schwab-py streaming docs](https://schwab-py.readthedocs.io/en/latest/streaming.html)
- A community library example subscribes with contract-month symbols such as `/ESF24` — [market-quant gitbook Schwab streaming](https://market-quant.gitbook.io/home/api-reference/data-providers/charles-schwab-api/streaming)
- Conflicting report: a NinjaTrader forum user said only stock symbols worked through NinjaTrader's Schwab beta connection. That is NT's integration, not the raw API, and may be outdated — [NinjaTrader forum](https://forum.ninjatrader.com/forum/ninjatrader-8/platform-technical-support-aa/1334818-schwab-beta-api?p=1335360)

**Tradovate / NinjaTrader**
- The API add-on is $25/month. It requires a live, funded brokerage account with at least $1,000; prop and evaluation accounts are excluded — [CrossTrade blog](https://crosstrade.io/blog/tradovate-api-add-on-fee-cme-license-webhook/); [Tradovate community: API Access](https://community.tradovate.com/t/api-access/12819)
- Streaming market data through the API requires the user to hold a CME non-display license. Reported costs:
  - $290/month (older thread) — [Tradovate community](https://community.tradovate.com/t/is-cme-sub-vendor-requirement-for-api-access-is-290-per-month/6215)
  - $390 + $25 + roughly $12, about $427/month in total, from a competitor's 2026 blog — [PickMyTrade](https://blog.pickmytrade.trade/tradovate-automation-without-cme-license-what-it-costs.md)
  - These are consistent with CME's 2026 "User Non-Display Category A" fee of $457 (CME fee list above).

**Alpaca**
- Alpaca does not offer futures data; futures are listed as "Coming soon" — [Alpaca data](https://alpaca.markets/data)

**Twelve Data**
- Its catalog lists stocks, forex, crypto, ETFs, mutual funds, bonds, commodities and indices. Futures are not listed.
- Plans: Basic free (800 calls/day), Grow from $29, Pro $99, Ultra $329.
- WebSocket streaming averages about 170ms latency.
- Source: [Twelve Data llms.txt](https://twelvedata.com/llms.txt)

**Finnhub**
- No evidence of futures coverage was found. US market data plans are listed at $49.99/$129.99/$199.99 per month — [Finnhub pricing](https://www.finnhub.io/pricing-stock-api-market-data)

**Financial Modeling Prep (FMP)**
- The commodities "quote" endpoint (`/stable/quote?symbol=GCUSD`) is described as "live". No page confirmed ESUSD/NQUSD symbols or their delay — [FMP commodities quote docs](https://site.financialmodelingprep.com/developer/docs/stable/commodities-quote)

**EODHD**
- WebSocket channels cover US equities, forex and crypto. REST "live" quotes are 15–20 minutes delayed. No futures WebSocket was found — [EODHD WebSockets](https://eodhd.com/financial-apis/new-real-time-data-api-websockets); [EODHD llms.txt](https://eodhd.com/llms.txt)

**Barchart OnDemand**
- Barchart markets futures APIs (delayed and end-of-day) covering "over 30 exchanges" — [Barchart futures API blog](https://www.barchart.com/solutions/blog/api-for-futures-data); [Barchart futures delayed data API](https://www.barchart.com/ondemand/futures-delayed-data-api) (page content not retrievable)
- Barchart's exchange delay table lists CFE at 10 minutes and Cboe indices at 15 minutes — [Barchart exchange delays](https://www.barchart.com/solutions/legal/exchange-agreement)

**yfinance / Yahoo**
- Yahoo lists ICE Data Services as its provider, with these delays: CME 10 min, CBOT 10 min, NYMEX 30 min, COMEX 30 min, ICE Futures US 30 min, Cboe Indices 15 min — [Yahoo exchanges & data providers](https://help.yahoo.com/kb/finance-for-web/sln2310.html)
- Persistent `YFRateLimitError` / HTTP 429 problems since late 2024–2025:
  - Single-ticker calls failing on versions 0.2.57–0.2.59 — [yfinance #2480](https://github.com/ranaroussi/yfinance/issues/2480); [#2422](https://github.com/ranaroussi/yfinance/issues/2422)
  - The crumb itself set to the string "Too Many Requests" — [#2441](https://github.com/ranaroussi/yfinance/issues/2441)
  - A user cut off after about 950 tickers at 1-minute granularity, starting November 2024 — [#2128](https://github.com/ranaroussi/yfinance/issues/2128)
  - IP blocks after bursts — [discussion #2431](https://github.com/ranaroussi/yfinance/discussions/2431)
- Yahoo does not publish its rate limits — [Massive vs yfinance (competitor marketing)](https://massive.com/compare/massive-vs-yfinance.md)

### Inferences
- **The 4:20am ET "true overnight change" can be defined cleanly.** CME's daily settlement is a 4:00pm ET VWAP, aligned with the ETF cash close. So NQ (price at about 4:20am) / (prior 4:00pm settlement) − 1 is the natural overnight return, and the settle can come from end-of-day data.
  - Databento's 24-hour intraday replay lets a job that connects at 4:15am replay from the prior 4:00pm settlement window and 6:00pm reopen to now in one session, without storing state overnight.
  - Yahoo NQ=F 1-minute bars, which are 10 minutes delayed, could approximate this for free. I did not verify that Yahoo serves overnight futures minute bars through yfinance.
- **A 10-minute delay is usually harmless at 4:20am.** A 4:20am snapshot from a 10-minute-delayed feed reflects about 4:10am Globex prices. At that hour NQ usually moves little minute to minute (Asia is closed and Europe is about an hour into its session). That makes Massive's $29 Starter (10-minute delayed) or yfinance adequate for a daily-horizon forecast, unless a news shock hits between 4:10 and 4:20.
- **"Non-display" licensing is the hidden risk for an automated pipeline.** CME's fee list charges User Non-Display Category A at $457 for applications that consume real-time data. A forecast model that ingests real-time futures automatically is arguably non-display use. Databento's "personal" license and Massive's "non-pro" tiers appear to package this for individuals, while Tradovate makes the user buy it directly. Using delayed data (device fee $0) avoids real-time display fees. Whether delayed non-display use still carries a fee is not clear from the fee list (footnote 10 says fees apply to applications accessing "Real Time or Delayed" information). See Gaps.
- **MNQ/MES carry no extra data cost.** MNQ/MES and NQ/ES are on the same exchange (CME), so one CME entitlement covers both. For a price signal, the full-size contract is the reference.
- **RTY (TNA) and ZN/ZT.** RTY is on CME. ZN/ZT are on CBOT, which needs the bundle ($4.65 non-pro) or a separate CBOT entitlement if real-time Treasuries are wanted.

### Gaps
- Databento's current plan prices could not be read from the primary pricing page (JS-rendered). The $199 Standard figure is from search snippets and third parties. I could not confirm whether usage-based live CME access still exists.
- IBKR's exact CME L1 non-pro line item and pass-through fee were not readable (403). IBKR API specifics were not verified in this session: whether TWS or IB Gateway must be running and logged in at 4am, daily restarts, and the `ib_async`/`ib_insync` libraries.
- I did not confirm from official Schwab docs that the individual Trader API account is entitled to real-time CME LEVELONE_FUTURES at no cost, or how Schwab classifies API use (pro or non-pro, display or non-display).
- Not researched for lack of budget: Alpha Vantage futures coverage (none found), and CME DataMine / CME Market Data Platform. DataMine is generally historical and end-of-day rather than live retail; that is background knowledge, unverified.
- Barchart OnDemand pricing and its retail/personal licensing could not be retrieved.
- I found no authoritative statement on whether CME charges non-display fees for delayed data consumed by an individual's personal research application.

## Q2. Which sources provide pre-market (4:00am+) and overnight (8pm–4am ET) ETF trades and quotes for TQQQ/QQQ/SPY/SOXX/IWM, and how reliable and liquid is overnight data?

### Takeaway
Until December 6, 2026, overnight US equity trading (8pm–4am ET) happens only on ATSs, mainly Blue Ocean ATS (about 90% share). Its data comes from:
- Blue Ocean-sourced feeds: Databento's Blue Ocean dataset, Alpaca's BOATS/overnight feeds, Tiingo, and Yahoo's displayed "BOATS Real Time Price".
- Broker venues: IBKR's own overnight session.

On December 6, 2026, Nasdaq, NYSE Arca, Cboe EDGX and MEMX launch overnight sessions (9pm–4am) on a 23/5 SIP. Standard SIP feeds should then carry exchange overnight prints. This is scheduled, not yet confirmed live. Overnight volume is small (about 0.9% of US share volume) but concentrated in the most popular names. QQQ and TQQQ are among Blue Ocean's most-traded symbols, so overnight prints exist, but spreads are wider and prices noisier than in the 4am+ pre-market.

### Cited Findings

**Venues, hours and the Dec 6, 2026 transition** (from [Databento blog, Nov 16, 2026](https://databento.com/blog/us-equities-overnight-trading))
- **Blue Ocean ATS** has run the Blue Ocean Session from 8pm to 4am ET, Sunday to Thursday, since 2021, with about 90% of overnight volume in early 2026.
- **Other venues:** Bruce ATS (PEAK6) and MOON ATS (OTC Markets) share most of the rest. IBKR runs its own venue, IBKR Eos.
- **Overnight volume:** about 0.9% of US share volume in August 2026, up 359% year on year. The ten busiest stocks accounted for 43% of overnight volume.
- **SEC approvals:**
  - Nasdaq overnight session: Apr 10, 2026
  - NYSE Arca: May 21, 2026
  - Cboe EDGX: May 29, 2026
  - 23-hour SIP schedule: Jun 26, 2026
  - MEMX: Sep 9, 2026
- **Go-live:** SIPs, exchanges and FINRA trade reporting go live on the 23/5 schedule on Dec 6, 2026, with a nightly 8–9pm ET pause and an overnight session of 9pm–4am. Jan 24, 2027 is the backstop date for 24X.
- **Nasdaq's new structure:** a Day Session (4am–8pm) plus a Night Session (9pm–4am).
- **Databento's coverage:** its Blue Ocean dataset has real-time and historical full order book from August 2025, covering the 8–9pm hour that exchanges and the SIP will not.

**Blue Ocean's own statements**
- Blue Ocean's FAQ also gives Dec 6, 2026 as the exchange launch date — [Blue Ocean FAQ](https://blueocean-tech.io/faq/)
- Blue Ocean says it will keep running from 8pm, while Nasdaq's session opens at 9pm — [Blue Ocean, Aug 1 2026](https://blueocean-tech.io/2026/08/01/23-5-exchange-trading-overnight-market/)
- Reliability: Blue Ocean's service-alerts page lists a halt of all trading on the ATS for "network connectivity issues", with trading resuming 2:30am ET on Oct 21, 2026. The page's dates are inconsistent, so verify before citing — [Blue Ocean service status](https://www.blueocean-tech.io/blue-ocean-ats-service-status/)
- Blue Ocean has also joined the Pyth Network as a publisher of overnight US equity data — [Pyth blog](https://www.pyth.network/blog/blue-ocean-ats-joins-pyth-network-institutional-overnight-hours-us-equity-data) (details not read)

**Interactive Brokers**
- Overnight trading in US stocks and ETFs runs 8:00pm–3:50am ET, Sunday to Friday, with a 10-minute break from 3:50 to 4:00am.
- "All clients with US Stock trading permission have access to US Overnight Trading and free overnight market data."
- More than 10,000 stocks and ETFs are eligible. Trades executed between 8pm and midnight carry the next trade date.
- Source: [IBKR overnight trading](https://www.interactivebrokers.com/en/trading/us-overnight-trading.php)

**Alpaca**
- Sessions: overnight 8pm–4am (evening before the trade date), pre-market 4:00–9:30am, after-hours 4–8pm.
- The overnight feed comes through a Blue Ocean partnership "for a monthly fee" (contact sales). Indicative trades are delayed 15 minutes, and historical requests need `feed=boats`.
- Eligibility is shown by the `overnight_tradable` flag. Only limit orders are allowed overnight.
- NMS exchanges join on Dec 6, 2026 with an 8–9pm pause.
- Source: [Alpaca 24/5 docs](https://docs.alpaca.markets/docs/245-trading)
- Another Alpaca docs page maps the free plan to `feed=overnight` (latest bars, indicative quotes, 15-minute-delayed trades) and Algo Trader Plus to `feed=boats` — [Alpaca 24/5 trading API docs](https://docs.alpaca.markets/docs/245-trading-for-trading-api)
- Alpaca staff advise using `feed=sip` from 4:00 to 20:00 and `feed=boats` from 20:00 to 04:00. One forum post reported the boats/overnight endpoints returning "insufficient subscription" — [Alpaca forum](https://forum.alpaca.markets/t/overnight-data-access-not-working/17723)
- Plans:
  - Basic (free): IEX real-time only, 30 WebSocket symbols, historical restricted to older than the latest 15 minutes, 200 calls/min.
  - Algo Trader Plus ($99/month): all US exchanges (CTA and UTP feeds), unlimited WebSocket symbols, 10,000 calls/min.
  - Source: [Alpaca market data API](https://docs.alpaca.markets/docs/about-market-data-api)

**Tiingo**
- A Tiingo blog is titled "Blue Ocean ATS Data on Tiingo: Real-Time Overnight Stock Prices, Now for Everyone" — [Tiingo blog](https://www.tiingo.com/blog/blue-ocean-ats-overnight-stock-data/). The page returned 403, so details are unverified. A search snippet of Tiingo's mid-2026 post repeats the June 26, 2026 SIP approval and the Dec 6 go-live.
- IEX real-time top-of-book is streamed over WebSocket at `wss://api.tiingo.com/iex` — [Tiingo IEX realtime docs](https://api.tiingo.com/docs/iex/realtime)
- Power plan: $30/month for individuals, $50/month for internal commercial use. Source is a competitor's comparison dated Oct 23, 2026 — [Massive vs Tiingo](https://massive.com/compare/massive-vs-tiingo)

**EODHD**
- The US WebSocket carries pre- and post-market data from 4am to 8pm ET, on paid plans only — [EODHD WebSockets](https://eodhd.com/financial-apis/new-real-time-data-api-websockets)

**Yahoo Finance**
- Nasdaq-listed quotes are real-time — [Yahoo data providers](https://help.yahoo.com/kb/finance-for-web/sln2310.html)
- Yahoo's TQQQ quote page shows a "NasdaqGM - BOATS Real Time Price USD" label, meaning Yahoo displays Blue Ocean overnight prices — [Yahoo TQQQ](https://finance.yahoo.com/quote/TQQQ/performance/)

**Liquidity and quality of overnight prints**
- "The vast majority of nocturnal volume occurs on the Blue Ocean ATS". About 80% of that volume is from Asia-Pacific, and realized spreads there are narrower than at regular-hours wholesalers — [Eaton et al. paper](https://haslam.utk.edu/wp-content/uploads/2024/11/Eaton-Paper.pdf)
- NYSE reports volume-weighted spreads of about 28 bps overnight versus 20 bps in core hours for frequently traded stocks — [NYSE "Night moves"](https://www.nyse.com/data-insights/night-moves-what-trades-and-when-in--the-overnight-market). This conflicts with the Eaton paper's spread finding.
- BMLL singled out TQQQ (and AMD): their decline in execution prices from the open to the close of the overnight session was more pronounced than their price movement during the regular session — [BMLL](https://www.bmlltech.com/news/market-insight/there-is-a-clear-trend-towards-24-7-equity-trading-but-how-much-liquidity-is-available-for-participants-during-overnight-trading)
- Blue Ocean's October 2025 newsletter lists QQQ and TQQQ among its top-15 traded symbols. It is hosted by a third party — [Blue Ocean Oct 2025 newsletter](https://www.urbanacorp.com/ndgcnt/uploads/2025/11/October-2025-Blue-Ocean-Newsletter.pdf)

### Inferences
- **4:00–4:30am pre-market:** the current yfinance 1-minute TQQQ bars from 4:00am are sparse, because pre-market at 4am is thin. For better 4am data, use a full-SIP source (Alpaca Algo Trader Plus, Massive Stocks, Databento US Equities) or IBKR. Free IEX-only feeds such as Alpaca Basic and Tiingo IEX capture only IEX's small share of pre-market volume.
- **The overnight 8pm–4am window is a useful extra covariate,** for example the TQQQ/QQQ Blue Ocean VWAP or last price at 3:50–4:00am versus the 4pm close. It is noisier than NQ futures, so it should complement NQ rather than replace it.
  - QQQ overnight should track NQ closely, because QQQ is a Nasdaq-100 ETF. Large divergences between NQ-implied and QQQ-overnight moves are more likely to be liquidity noise than signal.
  - TQQQ overnight prints add little beyond 3 × QQQ, given leverage and wider spreads.
- **After Dec 6, 2026, Nasdaq's 4am "Day Session" start is unchanged,** so the existing 4:00–4:30am bar pull keeps working. Exchange overnight prints (9pm–4am) should start appearing on standard SIP-based APIs, making them cheaper to get than Blue Ocean-specific feeds.
- **There is a dead zone from 3:50 to 4:00am.** IBKR's overnight session pauses then, and Blue Ocean ends at 4:00am. The 4:00am pre-market open therefore restarts price discovery. "Last overnight print" and "first pre-market print" can differ.

### Gaps
- No hard numbers were found isolating QQQ/TQQQ/SPY/SOXX/IWM overnight volume or quoted spreads. Blue Ocean or BMLL ticker-level stats would be needed.
- Tiingo's overnight product terms (plan, real-time or delayed, endpoints, price) could not be read (403).
- Whether yfinance (as opposed to Yahoo's web page) returns 8pm–4am BOATS bars was not verified.
- Alpaca's Blue Ocean feed price is "contact sales" and was not found. The free-plan `feed=overnight` availability conflicts between docs pages and a forum report.
- Whether the Dec 6, 2026 launch has slipped could not be confirmed (it was 12 days away at research time).
- Robinhood 24-Hour Market and Schwab 24/5 data access through APIs was not researched. Neither offers an official retail market data API for overnight prints that I could find; this is unverified.

## Q3. Which sources provide Asian/European index closes and opens, FX, Treasury yields, crude, gold and crypto by 4:20am ET, ideally free?

### Takeaway
For free:
- **Yahoo/yfinance** covers almost everything by 4:20am ET, with exchange delays:
  - Asian closes (Nikkei, Hang Seng, KOSPI, TAIEX) are final well before 4:20am in US winter.
  - The European open (09:00 CET is about 3:00am ET most of the year) is visible with a 15-minute delay.
  - FX and crypto are real-time.
  - NYMEX/COMEX (crude, gold) and ICE (dollar index) are 30 minutes delayed.
- **Treasury yields:** FRED's DGS2/DGS10 lag by about one business day, so at 4:20am they miss the prior session. Treasury.gov's par yield curve (3:30pm quotes, posted by about 6pm ET) is the better free end-of-day source. Treasury futures (ZN/ZT) give the live overnight rate signal.
- **Crypto:** Coinbase's public API is a free, reliable real-time BTC source.

### Cited Findings

**Yahoo delays by market** (data provider ICE Data Services) — [Yahoo exchanges & data providers](https://help.yahoo.com/kb/finance-for-web/sln2310.html)

| Market | Delay |
|---|---|
| Tokyo Stock Exchange / Nikkei indices | 20 min / 30 min |
| Hong Kong (HKEX) | 15 min |
| Korea Exchange | 20 min |
| Taiwan (TWSE) | 20 min |
| Shanghai | 30 min |
| XETRA / Deutsche Börse | 15 min |
| Euronext | 15 min |
| London Stock Exchange | 20 min |
| FX | real-time |
| Cryptocurrencies | real-time (Coinbase and CoinMarketCap) |
| NYMEX | 30 min |
| COMEX | 30 min |
| ICE Futures US | 30 min |
| CBOT | 10 min |
| Cboe Indices | 15 min |

**Asian closing times**
- Tokyo Stock Exchange closes at 15:30 JST (previously 15:00) since Nov 5, 2024, with a new closing auction — [nippon.com](https://nippon.com/en/news/yjj2024110500956); [JPX press release](https://www.jpx.co.jp/english/corporate/news/news-releases/1030/uorii50000002f2a-att/pressrelease_extension_of_trading_hours_en.pdf)
- HKEX continuous trading ends at 16:00 HKT. The closing auction has an order-input period of 16:01–16:06 and a random close between 16:08 and 16:10 — [IFEC HK closing auction](https://ifec.org.hk/web/en/financial-products/investment/stock/stock-trading/closing-auction-session.html)

**European futures**
- Eurex FESX/FDAX trade about 21 hours a day, roughly 01:15–22:00 CET (broker blog; verify against Eurex) — [NinjaTrader EU guide](https://ninjatrader.com/eu/en-de/futures/blogs/exchange-listed-futures-europe-guide/)
- Eurex extended FESX, FDAX and FDXM into Asian hours in December 2018 — [Eurex trading hour extension](https://eurex.com/ex-en/support/initiatives/archive/trading-hour-extension)

**Treasury yields**
- FRED DGS2 (H.15) on Nov 24, 2026 showed the latest observation as Nov 20, 2026 (4.63%), with "Updated: Nov 23, 2026 3:34 PM CST" — [FRED DGS2](https://fred.stlouisfed.org/series/DGS2). DGS10 shows similar afternoon update stamps (about 3:16pm CT) — [FRED DGS10](https://fred.stlouisfed.org/series/DGS10)
- Treasury's daily par yield curve uses "indicative, bid-side market price quotations... obtained by the Federal Reserve Bank of New York at or near 3:30 PM each trading day". Rates "are usually available... by 6:00 PM Eastern Time each trading day", but may be delayed — [Treasury yield curve methodology](https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/treasury-yield-curve-methodology); [Treasury interest rate statistics](https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics); [Daily Treasury Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve)

**Cboe volatility indices**
- Cboe Global Trading Hours for SPX/VIX options run 8:15pm–9:25am ET, with order acceptance from 8:00pm — [Cboe hours](https://certification.cboe.com/about/hours/us-options)
- The VIX methodology says index values are calculated and disseminated according to trading session (RTH, GTH or both), about four times a minute — [Cboe VIX methodology](https://cdn.cboe.com/resources/indices/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf)

**Crypto**
- The Coinbase Exchange REST endpoints `GET /products/{id}/candles`, `/ticker`, `/stats` and `/trades` are public. Public endpoints are throttled by IP at about 10 requests/second (bursts of 15). Exceeding the limit returns 429, and candles may have gaps where there were no ticks — [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles); [Coinbase rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits); [CCXT public method list](https://docs.ccxt.com/docs/exchanges/coinbaseexchange/implicit-api). An older Coinbase Pro FAQ gave 3 requests/second, which appears superseded.

**Paid alternatives for FX, indices and crypto**
- Twelve Data covers 1,300+ FX pairs and crypto across 180+ exchanges; the free plan allows 800 calls/day — [Twelve Data llms.txt](https://twelvedata.com/llms.txt)
- Tiingo has a forex API — [Tiingo forex](https://api.tiingo.com/products/forex-api)
- EODHD streams forex and crypto over WebSocket — [EODHD WebSockets](https://eodhd.com/financial-apis/new-real-time-data-api-websockets)

### Inferences
- **Time conversions.** Japan, Hong Kong, Korea and Taiwan do not observe daylight saving time.

  | Close | During EST (Nov–Mar) | During EDT (Mar–Nov) |
  |---|---|---|
  | TSE 15:30 JST | 1:30am ET | 2:30am ET |
  | HKEX ~16:10 HKT | ~3:10am ET | ~4:10am ET |

  - In summer, the Hang Seng close (with Yahoo's 15-minute delay) may not be final by 4:20am ET. The pipeline should check the timestamp or wait for the official close.
  - KOSPI (15:30 KST) closes at about 1:30am EST / 2:30am EDT. TAIEX (13:30 Taiwan time) closes at about 12:30am EST / 1:30am EDT. Both closing times are from background knowledge and need verification (see Gaps).
- **European open timing.** Xetra/Euro Stoxx cash opens at 09:00 CET/CEST, which is 3:00am ET when both regions are on the same daylight-saving regime (background knowledge; verify).
  - During the roughly 3 "mismatch" weeks a year (US on EDT while Europe is still on CET: mid-March and late October to early November), it opens at 4:00am ET.
  - With Yahoo's 15-minute XETRA delay, a 4:20am snapshot would show only about 5 minutes of European trading.
  - Eurex FESX/FDAX futures, which trade overnight from about 01:15 CET, are the more robust "Europe" signal at 4:20am in every week.
- **Treasury yields.**
  - FRED DGS2/DGS10 at 4:20am ET on day T typically hold only the close from two sessions earlier (T−2). For example, on Tue Nov 24 the latest is Fri Nov 20, so Monday's move is missing. Do not use FRED as the "latest yield" covariate.
  - Treasury.gov's par yield CSV/XML (posted by about 6pm ET) gives the T−1 3:30pm curve, including the 2-year.
  - For the overnight move, use CBOT ZN/ZT futures (Yahoo `ZN=F`/`ZT=F`, 10-minute delay).
  - ^TNX is a Cboe index with a 15-minute delay on Yahoo. Whether it updates overnight was not verified.
- **Current covariates with long delays.** CL=F (NYMEX) and DX-Y.NYB (ICE Futures US) carry 30-minute delays on Yahoo, so a 4:20am pull shows prices from about 3:50am. That is acceptable for daily covariates, but it should be logged as an "as-of" timestamp.
  - USD/JPY (`JPY=X`) and Bitcoin (`BTC-USD`) are real-time on Yahoo.
  - Coinbase's public API is a free, documented, non-scraped backup for BTC.
- **VIX overnight.** Because Cboe disseminates VIX values during GTH, a ^VIX quote at 4:20am may reflect an overnight GTH calculation rather than the prior close. VXN likely has no GTH calculation (unverified).

### Gaps
- KRX (KOSPI) and TWSE (TAIEX) closing times, and the Xetra 09:00 CET open, were not verified against exchange sources in this session (background knowledge only).
- The exact Cboe GTH window for disseminating the VIX index (as opposed to VIX options trading) was not confirmed, nor whether VXN or ^TNX update overnight.
- Free official APIs for Nikkei/Hang Seng/KOSPI/TAIEX/DAX/Euro Stoxx were not researched (for example, exchange end-of-day files, stooq, investing.com). Licensing for redistributing index values (STOXX, Nikkei, Deutsche Börse) was not researched.
- The H.15 official publication time (as opposed to FRED's update stamp) was not confirmed from the Federal Reserve release calendar.

## Q4. What is the specific delay on free feeds, and does it matter for a 4:30am deadline?

### Takeaway
Free delays range from 0 to 30 minutes:
- FX, crypto and Nasdaq-listed equities: real-time.
- CME/CBOT futures: 10 minutes.
- Cboe indices, HKEX and XETRA: 15 minutes.
- Tokyo, Korea and Taiwan: 20 minutes (Nikkei indices 30 minutes).
- NYMEX/COMEX/ICE: 30 minutes.

For a forecast finalized at 4:25–4:30am and traded from 5:00am, these delays mostly do not matter: Asian closes are final and overnight futures trends are set. The exceptions are the European open (only a few minutes of data in DST-mismatch weeks), the Hang Seng close in US summer, and news shocks after about 4:00am. The bigger operational risk on free feeds is reliability (Yahoo rate limits and breakage), not latency.

### Cited Findings
- Yahoo delays: CME 10 min, CBOT 10 min, NYMEX 30 min, COMEX 30 min, ICE Futures US 30 min, Cboe Indices 15 min, NYSE Indices 15 min, Nasdaq real-time, Tokyo 20 min / Nikkei indices 30 min, HKEX 15 min, Korea 20 min, TWSE 20 min, Shanghai 30 min, XETRA 15 min, Euronext 15 min, LSE 20 min, FX real-time, crypto real-time — [Yahoo data providers](https://help.yahoo.com/kb/finance-for-web/sln2310.html)
- Barchart and Google list CME Group exchanges at 10 minutes and Cboe indices at 15 minutes — [Barchart exchange delays](https://www.barchart.com/solutions/legal/exchange-agreement); [Google Finance disclaimer](https://www.google.co.nz/googlefinance/disclaimer)
- CME's own website quotes are delayed by at least 10 minutes — [CME delayed quotes](https://www.cmegroup.com/market-data/delayed-quotes/interest-rates.html)
- Delayed CME display costs $0 per device — [CME fee list 2026](https://api.databento.com/static/licensing/cme/cme-market-data-fee-list.pdf)
- Massive's paid Futures Starter and Developer are 10 minutes delayed — [Massive futures](https://massive.com/futures)
- Alpaca's overnight indicative trades are 15 minutes delayed — [Alpaca 24/5](https://docs.alpaca.markets/docs/245-trading)
- EODHD REST live quotes are 15–20 minutes delayed — [EODHD llms.txt](https://eodhd.com/llms.txt)
- yfinance limits: 1-minute history is available only for about the last 7 days, and intraday intervals for about 60 days (secondary guides) — [yfinance overview](https://quochuydev.github.io/tech-research/researching/yfinance-overview.html); [IBKR Campus yfinance guide](https://www.interactivebrokers.com/campus/ibkr-quant-news/yfinance-library-a-complete-guide/)
- Breakage history: Yahoo has changed the encryption keys on its scraped pages several times, breaking yfinance repeatedly — [yfinance fork notes](https://github.com/asafravid/yfinance). Rate-limit errors are documented in [#2480](https://github.com/ranaroussi/yfinance/issues/2480), [#2441](https://github.com/ranaroussi/yfinance/issues/2441), [#2128](https://github.com/ranaroussi/yfinance/issues/2128) and [#2431](https://github.com/ranaroussi/yfinance/discussions/2431).

### Inferences
- **What a 4:20am ET pull actually sees:**

  | Series | Effective as-of |
  |---|---|
  | NQ=F / ES=F / RTY=F, ZN=F / ZT=F | ~4:10am |
  | CL=F, GC=F, DX-Y.NYB | ~3:50am |
  | ^VIX | ~4:05am, if disseminated in GTH |
  | ^N225, ^HSI, ^KS11, ^TWII | final close, except the HSI caveat in summer |
  | ^GDAXI / ^STOXX50E | ~4:05am (about 1h05m of trading in normal weeks; about 5 min in DST-mismatch weeks) |
  | JPY=X, BTC-USD | real-time |

  For daily-to-252-day return distributions these lags are immaterial. For the "gap risk" output, the 10–30 minute lag could miss a late shock.
- **Pin delayed data to the bar timestamp, not the wall clock.** Using each data point's own timestamp avoids look-ahead mismatches when the model is backtested on historical "as-of 4:20am" snapshots.
- **Reliability matters more than delay.** Yahoo's undocumented, IP-based throttling means a 4:15am job should:
  - make a small number of batched requests;
  - retry with backoff;
  - cache the prior session's closes the evening before;
  - have a fallback source for at least NQ and the ETF.
  This is an engineering recommendation, not a sourced finding.

### Gaps
- I found no official Yahoo statement of API rate limits, and no confirmation of whether yfinance's `curl_cffi`-based releases fixed the 2025 throttling durably.
- I did not verify whether Yahoo's delays differ for chart/minute-bar endpoints versus quote endpoints.

## Q5. Recommended stack for three budget tiers (free, retail under about $100/month, professional)

### Takeaway
- **Free:** keep yfinance, but use it correctly: NQ=F/ES=F/RTY=F minute bars to compute settle-to-4:20am change, plus Asian/European indices, JPY=X, BTC-USD and ZN=F/ZT=F. Add Treasury.gov par yields instead of FRED, Coinbase for BTC, and Alpaca Basic (IEX) or Schwab Trader API as a backup for ETF pre-market.
- **Retail (<$100/month):** a broker API gives real-time CME and overnight ETF data for little or nothing:
  - Schwab Trader API (free with an account), or IBKR (roughly $5–10/month bundles plus free overnight equity data).
  - Or Massive Futures Starter ($29, 10-minute delayed, official API), optionally with Tiingo Power ($30) for IEX and Blue Ocean equity data.
- **Professional:** Databento (CME GLBX.MDP3 live with 24-hour replay, plus Blue Ocean and US Equities) or Massive Advanced (futures $199 + stocks $199). Mind commercial and non-display licensing if the output is redistributed.

### Cited Findings
- **Free tier components**
  - Yahoo covers futures, indices, FX and crypto at the delays above — [Yahoo data providers](https://help.yahoo.com/kb/finance-for-web/sln2310.html)
  - Treasury par yields are posted by about 6pm ET — [Treasury methodology](https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/treasury-yield-curve-methodology)
  - Coinbase public REST is about 10 requests/second per IP — [Coinbase rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits)
  - Alpaca Basic is free, with IEX real-time and 30 WebSocket symbols — [Alpaca market data](https://docs.alpaca.markets/docs/about-market-data-api)
  - Massive Futures Basic is $0 with 5 calls/min and minute aggregates — [Massive futures](https://massive.com/futures)
  - IBKR overnight data is free for clients with stock permission — [IBKR overnight](https://www.interactivebrokers.com/en/trading/us-overnight-trading.php)
- **Retail tier components**
  - Massive Futures Starter $29, Developer $79 (both 10-minute delayed), Advanced $199 (real-time) — [Massive futures](https://massive.com/futures)
  - Tiingo Power $30/month for individuals — [Massive vs Tiingo](https://massive.com/compare/massive-vs-tiingo)
  - IBKR bundles: USD 10 (waivable) and USD 5 — [IBKR market data pricing](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php) (snippet)
  - CME non-pro top-of-book: $1.55 per exchange, $4.65 all four — [CME fee list](https://api.databento.com/static/licensing/cme/cme-market-data-fee-list.pdf)
  - Schwab streaming supports LEVELONE_FUTURES and CHART_FUTURES — [schwab-py](https://schwab-py.readthedocs.io/en/latest/streaming.html)
  - Twelve Data Grow from $29 (no futures) — [Twelve Data](https://twelvedata.com/llms.txt)
  - Alpaca Algo Trader Plus at $99 (full SIP, no futures) would consume the whole budget — [Alpaca](https://docs.alpaca.markets/docs/about-market-data-api)
- **Professional tier components**
  - Databento: CME personal license included with Standard (up to 2 devices); commercial per-exchange and distribution fees listed — [Databento live data](https://databento.com/docs/portal/live-data). Live TCP API with 24-hour intraday replay and Python/C++/Rust clients — [Databento Live API](https://databento.com/docs/api-reference-live). Blue Ocean dataset from Aug 2025 — [Databento blog](https://databento.com/blog/us-equities-overnight-trading)
  - Massive Futures Advanced $199 real-time and Stocks Advanced $199, both individual or non-pro use — [Massive futures](https://massive.com/futures); [Massive pricing](https://massive.com/pricing?product=futures)
  - Tradovate's API costs $25 plus a CME non-display license of roughly $390–457, which makes it uneconomic for data alone — [CrossTrade](https://crosstrade.io/blog/tradovate-api-add-on-fee-cme-license-webhook/); [CME fee list](https://api.databento.com/static/licensing/cme/cme-market-data-fee-list.pdf)

### Inferences
**Free stack (about $0)**
- Futures:
  - Pull NQ=F/ES=F/RTY=F 1-minute bars (to be verified for 24-hour coverage) and the prior 4:00pm settle.
  - Compute `overnight_ret = ln(P_4:10 / Settle_4:00pm)`, plus a 6pm-reopen-to-4:10 leg and a 4:00–4:10am realized-vol estimate.
  - Record `as_of` timestamps.
- Cross-asset:
  - Indices: ^N225, ^HSI, ^KS11, ^TWII (final), plus ^GDAXI and ^STOXX50E (open, 15-minute delayed).
  - FX and crypto: JPY=X and BTC-USD (real-time).
  - Rates, dollar, commodities: ZN=F and ZT=F (10 minutes); DX-Y.NYB, CL=F and GC=F (30 minutes).
  - Treasury.gov par yield CSV for the T−1 2-year/10-year (keep FRED only for history).
  - Coinbase public API as the BTC fallback.
- ETF: the existing yfinance 4:00–4:30am 1-minute bars, with Alpaca Basic (IEX) or Schwab as a fallback.
- Risks: yfinance rate limits and breakage, and the terms of use for an unofficial scrape (Yahoo data is for personal use; not verified in this session).

**Retail stack (about $0–$60/month)**
- **Option A, broker-based (cheapest real-time):**
  - A Schwab account gives Trader API LEVELONE_FUTURES for /NQ, /ES, /RTY, /ZN, /ZT, /CL and /GC, plus level-one equities for the ETFs. OAuth tokens must be refreshed, so a 4am cron needs token upkeep.
  - Or IBKR, with a CME non-pro bundle (about $5–10, sometimes waived) and free overnight equity data for an 8pm–3:50am QQQ/TQQQ covariate. This needs IB Gateway running.
- **Option B, vendor API (no brokerage dependency):** Massive Futures Starter ($29), plus Tiingo Power ($30) for IEX pre-market, Blue Ocean overnight (verify) and FX/crypto. Keep yfinance and Treasury.gov for Asian/European indices and yields. Total about $59/month.
- **Option C, simplest legally clean real-time CME:** Databento Standard at about $199/month. This exceeds $100, so it belongs in the professional tier, unless Databento still offers a usage-based personal live tier near the old "$32.65/month" price (unverified).

**Professional stack (about $200–$600+/month)**
- Futures: Databento CME GLBX.MDP3 live, connecting at 4:15am with `start` at the prior 4:00pm to replay the full overnight session in one pull. It provides tick-accurate settle, the 6pm reopen, overnight high/low/volume and the 4:20am mid.
- Overnight equities: Databento Blue Ocean, plus US Equities after Dec 6 for SIP overnight data.
- Alternatively, Massive Futures Advanced plus Stocks Advanced ($398/month).
- Non-US data: a professional index/FX vendor (ICE, LSEG, Bloomberg) for Asian/European indices and Eurex futures (not researched).
- Licensing: if forecasts or prices are shown to other people, move from personal/non-pro to commercial licenses. Databento's CME commercial license is $973 per exchange plus $2,170 distribution plus per-user fees.

**Modeling note for Chronos-2.** The overnight futures change (settle to 4:10/4:20am) is known for the forecast day before the open, so it can be fed as a known covariate for the first step of the 1-day horizon. For backtesting, the same "as-of 4:20am" quantity must be reconstructed historically. That requires intraday futures history, which yfinance's 7-day 1-minute limit cannot supply. Databento or Massive history (2–15 years) fills this, and is a strong argument for at least one paid source even if live pulls stay free.

### Gaps
- Schwab's market-data entitlements and fees for API futures streaming are unconfirmed (no official doc retrieved).
- IBKR's exact CME line items and whether they are waived are unconfirmed (403).
- Tiingo's overnight product price and terms are unconfirmed.
- Databento's current plan prices are unconfirmed.
- Yahoo's terms of service for automated personal use were not reviewed.
- Pro-tier vendors for Asian/European index data (ICE, LSEG, Bloomberg) and Eurex/STOXX licensing costs were not researched.
- I did not test whether Massive Futures Basic ($0) returns same-day overnight minute aggregates, or only data delayed to the prior day.
