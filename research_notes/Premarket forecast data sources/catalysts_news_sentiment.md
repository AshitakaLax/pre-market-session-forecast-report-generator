# Scheduled catalysts, overnight news and sentiment sources for a 4:15–4:25am ET pre-market forecast

Scope: machine-readable sources that can fill `next_day_catalysts` (time_utc, event, impact), `key_headlines` and `fed_watch_summary`, and that can supply known-future covariates to Chronos-2 (e.g., a CPI/FOMC/NFP dummy per session) for TQQQ/QQQ, SPY/UPRO, SOXL and TNA. Research date: 2026-11-24. "Probed" means I sent a live HTTP request from this research environment on 2026-11-24 and looked at the response. Pricing comes from vendor pages fetched the same day unless marked unverified.

## Q1. Official primary calendars (BLS, BEA, Census, Fed/FOMC, Treasury, ISM, exchange holidays, OPEX and rebalances): are there machine-readable feeds?

### Takeaway
Official free feeds exist and are good enough to build the whole US macro, Fed and Treasury event skeleton days or weeks ahead:
- BLS: ICS feed.
- BEA: ICS feed through December 2027.
- Federal Reserve: RSS feeds, plus an HTML FOMC calendar that is easy to parse.
- Treasury: an XML tentative auction schedule, plus the Fiscal Data API.
- SEC: EDGAR JSON and Atom feeds.

None of them carries consensus estimates. Watch for two traps. BLS blocks unidentified scripts. Fiscal Data's v1 `upcoming_auctions` API looks stale after the October 2026 schema change. Census and ISM have no usable machine-readable calendar.

### Cited Findings
**BLS (CPI, PPI, Employment Situation/NFP, JOLTS, ECI, Productivity, weekly-claims context)**
- BLS publishes an iCalendar subscription at `https://www.bls.gov/schedule/news_release/bls.ics` (also `webcal://`). The page says "All times on calendar are Eastern Time". Entries show 08:30 AM for releases such as the Employment Situation and CPI, and 10:00 AM for JOLTS. The calendar "is updated as needed with additional news releases, usually at least a week before their scheduled publication date." The page showed "Last Modified Date: November 03, 2026". No RSS calendar feed is listed. — [BLS release calendar](https://www.bls.gov/schedule/); [BLS iCal help](https://www.bls.gov/help/hlpical.htm)
- Probe: a plain scripted GET of `bls.ics` from this environment returned HTTP 403 "Access Denied" (BLS bot protection). I did not try to get around this block. — [bls.ics](https://www.bls.gov/schedule/news_release/bls.ics) (probed)
- Weekly initial jobless claims are a Department of Labor (ETA) release, not a BLS one. I did not confirm whether `bls.ics` lists them. — gap, see below

**BEA (GDP, Personal Income and Outlays/PCE, trade)**
- BEA has an online-calendar subscription page. It links to `https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics`. — [BEA iCalendar page](https://www.bea.gov/news/schedule/icalendar)
- Probe: the ICS downloaded (HTTP 200, 169 VEVENTs). Event times are in UTC (e.g., `DTSTART:...T133000Z`, which is 8:30 ET in winter), each with `DURATION:PT30M`. Events run through December 2027 (e.g., "Personal Income and Outlays, November 2027", DTSTART 2027-12-22 13:30Z). DTSTAMP is 2025-09-23, so the file may not reflect later reschedules unless it is regenerated. — [BEA ICS](https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics) (probed)

**Census (advance retail sales, durable goods, housing starts, new home sales)**
- Census provides an HTML "calendar list view" of economic indicators (probe: HTTP 200). — [Census economic indicator calendar](https://www.census.gov/economic-indicators/calendar-listview.html) (probed)
- Probe: the only XML linked from that page, `econcards/assets/xml/indicator.xml`, is an RSS file whose lastBuildDate is 29 Apr 2021. It is stale and unusable as a calendar. — [Census indicator.xml](https://www.census.gov/economic-indicators/econcards/assets/xml/indicator.xml) (probed)

**Federal Reserve (FOMC, minutes, speeches)**
- Board RSS feeds include:
  - All press releases: `feeds/press_all.xml`
  - Monetary policy press releases: `feeds/press_monetary.xml` (statements, implementation notes)
  - Speeches: `feeds/speeches.xml`
  - Testimony: `feeds/testimony.xml`
  - Per-governor feeds (Powell, Jefferson, Bowman, Barr, Cook, Waller)
  - Board meetings: `feeds/boardmeetings.xml`
  - H.15: `feeds/h15.xml`

  No FOMC-calendar or ICS feed is offered. — [Fed RSS feeds](https://www.federalreserve.gov/feeds/feeds.htm). Probe: `press_all.xml` and `speeches.xml` both returned HTTP 200 text/xml. — (probed)
- The FOMC calendar page (HTML) lists:
  - 2026 meetings, including "October 27-28" (minutes released November 18, 2026) and "December 8-9*". The asterisk marks a Summary of Economic Projections meeting.
  - 2027 meetings: Jan 26-27, Mar 16-17, Apr 27-28, Jun 8-9, Jul 27-28, Sep 14-15, Oct 26-27, and Nov 16-17 (labelled "Monetary Policy Strategy Meeting").
  - A note that "each meeting date is tentative until confirmed at the meeting immediately preceding it".
  - "Last Update: November 18, 2026".

  — [FOMC calendars](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) (probed)
- Speech RSS items are published after the speech. The forward-looking Board calendar is an HTML page, and its event list did not appear in the static HTML I fetched (likely rendered by script). — [Fed calendar](https://www.federalreserve.gov/newsevents/calendar.htm) (probed). Regional Fed presidents' speeches are on each Reserve Bank's own site. I did not survey those.

**US Treasury (auctions, quarterly refunding)**
- Probe: `https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml` returned an XML `AuctionCalendar` named `Nov26_Refunding_Auction_Calendar_Official_v2`, covering 2026-11-04 to 2027-05-01. Each security has an announcement date, auction date, settlement date and maturity, e.g., the 10-Year Note auction on 2026-11-10. This is the best free forward auction calendar. — [Treasury tentative auction schedule XML](https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml) (probed)
- Fiscal Data's Upcoming Auctions, Auctions, FRN and TIPS/CPI datasets had field-name changes. "New APIs have been created for each of the four impacted datasets … The new APIs … include data beginning with October 1, 2026 … the old APIs will continue to be available until spring 2027." — [Fiscal Data: Treasury Auctions Data Updates](https://fiscaldata.treasury.gov/featured-content/treasury-auctions-data-updates-enhancements/)
- Probe: the old endpoint `v1/accounting/od/upcoming_auctions` responds with no API key. Its newest `record_date` was 2026-10-16 and its latest auction date 2026-10-29. That looks stale as of 2026-11-24, so use the new API or the XML above. `v1/accounting/od/auctions_query` also responds, with a newest auction of 2026-10-22, and has `offering_amt` and `high_yield` fields. — [Fiscal Data API](https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions) (probed)
- TreasuryDirect also lists upcoming auctions as HTML. — [TreasuryDirect upcoming auctions](https://www.treasurydirect.gov/auctions/upcoming)

**ISM (manufacturing and services PMIs at 10:00am ET)**
- Probe: the ISM Report On Business calendar page returned only about 922 bytes to a script (a bot wall). I found no ICS or API. — [ISM ROB calendar](https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/) (probed)

**Exchange holidays and half-days**
- NYSE 2026: closed Thanksgiving, Nov 26, 2026. Early close at 1:00 p.m. (1:15 p.m. for eligible options) on Fri Nov 27, 2026 and Thu Dec 24, 2026. 2027: early close Fri Nov 26, 2027. NYSE has published 2026–2028 calendars. — [NYSE hours and calendars](https://www.nyse.com/markets/hours-calendars); [NYSE Group 2026/2027/2028 holiday press release](https://www.businesswire.com/news/home/20251223981478/en/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar)

**OPEX, quad witching and index rebalances**
- The Nasdaq-100 annual reconstitution takes effect after the close on the third Friday of December. Nasdaq says it is "strategically scheduled to coincide with the quadruple witching day". Quarterly reweights happen after the close on the third Friday of March, June, September and December. The 2025 changes were announced Dec 12, 2025 and took effect before the open on Mon Dec 22, 2025. — [Nasdaq: 2025 NDX reconstitution highlights](https://www.nasdaq.com/articles/global-indexes/2025-nasdaq-100-reconstitution-and-performance-highlights); [Nasdaq press release Dec 2025](https://www.nasdaq.com/press-release/annual-changes-nasdaq-100-indexr-2025-12-13)
- Nasdaq has published a "methodology update" item. It implies the December reconstitution is no longer the only entry point for new constituents. I did not confirm the details. — [Nasdaq newsroom: NDX methodology update](https://www.nasdaq.com/newsroom/nasdaq100-index-methodology-update-why-now)

**Research on why scheduled macro and FOMC days matter as covariates**
- Savor & Wilson (2013, JFQA) used scheduled CPI, PPI, employment and FOMC days from 1958–2009. Average excess return was 11.4 bp on announcement days versus 1.1 bp on other days, so more than 60% of the cumulative annual equity premium was earned on announcement days. — [IDEAS/JFQA](https://ideas.repec.org/a/cup/jfinqa/v48y2013i02p343-375_00.html); [Wharton draft](https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Draft20111128p_edited.pdf)
- Two later papers push back:
  - Knox, Londono, Samadi & Vissing-Jorgensen use options-implied premia. FOMC, CPI and NFP days account for a "much smaller proportion" of expected returns. — [NBER w31923](https://www.nber.org/system/files/working_papers/w31923/w31923.pdf)
  - Ernst, Gilbert & Hrdlicka argue the effect disappears once day-of-month effects are controlled for. — summary via [search of NBER/AEA listings](https://www.aeaweb.org/conference/2022/preliminary/paper/ktNibY2Y). I did not read the full text.
- Lucca & Moench (2015, JF) documented a pre-FOMC drift, with large positive equity returns in the 24h before announcements, concentrated in 1980–2011. — [NY Fed Staff Report 512](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr512.pdf)
- Kurov, Wolfe & Gilbert (2021, Finance Research Letters) find the drift "largely vanished" after 2015. — [Skidmore working paper PDF](https://www.skidmore.edu/economics/documents/KurovWolfeGilbert-TheDisappearingPre-FOMC-Announce-Drift-200914.pdf); [IDEAS](https://ideas.repec.org/a/eee/finlet/v40y2021ics1544612320315956.html)

### Inferences
- A free "skeleton calendar" can be built offline once a week:
  - BEA ICS and BLS ICS (fetched through a calendar subscription or with a properly identified client)
  - The FOMC HTML page
  - Treasury's tentative auction XML
  - NYSE holidays
  - Computed third Fridays for OPEX, quad witching and NDX/S&P rebalances

  Then each morning at about 4:15am ET only today's and tomorrow's rows need checking. This removes any 4:20am dependency on official sites.
- Official calendars give time and event but no consensus. Impact must come from a static mapping (CPI/NFP/FOMC = high; PCE/GDP/retail sales/ISM/JOLTS = medium–high; claims = medium; auctions = low, or medium for 10y/30y refunding) or from a vendor field (see Q2).
- Given the mixed evidence on announcement premia and the disappearing pre-FOMC drift, the model should treat scheduled-event covariates mainly as variance and gap-risk regressors, i.e., widen the distribution on event days, rather than as directional drift signals. Chronos-2's known-future covariate input suits binary event dummies such as `is_cpi_day`, `is_fomc_day`, `is_nfp_day`, `is_opex`, `is_quad_witch`, `is_half_day` and `megacap_earnings_amc_prev`.

### Gaps
- I could not test BLS ICS access with a declared User-Agent. It is unknown whether BLS allows scripted ICS pulls if the client identifies itself.
- I did not verify the DOL weekly claims schedule feed or the "new" Fiscal Data upcoming-auctions endpoint path. The old v1 is stale; the new path was not found in the docs I read.
- No machine-readable ISM calendar was found. The ISM release time (10:00am ET, first business day) comes from general knowledge, not a fetched source.
- The S&P 500 quarterly rebalance timing and the official December 2026 NDX reconstitution date were not confirmed. Dec 18, 2026 is the third Friday by calendar calculation.
- Treasury quarterly refunding announcement dates were not fetched separately. The XML calendar name shows the Nov 2026 refunding cycle.

## Q2. Aggregated economic calendar APIs with consensus/prior (Trading Economics, Finnhub, FMP, EODHD, Benzinga, Investing.com/ForexFactory, Econoday, Alpha Vantage, Nasdaq Data Link)

### Takeaway
For under about $30/month, FMP Starter gives an economic release calendar API with estimates and priors (personal-use pricing). The free ForexFactory JSON gives forecast, previous and a Low/Medium/High impact flag for this week. It works but is unofficial.

Trading Economics has the best-known institutional consensus but no published API rate card. Finnhub's economic calendar is premium. Alpha Vantage has no forward economic calendar, only indicator time series.

### Cited Findings
- **FMP (Financial Modeling Prep)**:
  - Plans and prices (monthly / annual billing): Basic $0 (250 calls/day); Starter $29/mo or $19/mo annual (300 calls/min); Premium $69 or $49 (750 calls/min); Ultimate $139 or $99 (3,000 calls/min). The pricing page has separate "Personal Use" and "Commercial Use" toggles.
  - "Economic Data Releases Calendar" is not included in Basic. Starter allows "a range up to 1 year, … historical values up to 1 year". Premium has "Full Coverage" for Economics.
  - Trailing 30-day bandwidth caps: Free 500MB, Starter 20GB, Premium 50GB, Ultimate 150GB.
  - "Displaying or redistributing data sourced from FMP requires a specific Data Display and Licensing Agreement."

  — [FMP pricing](https://site.financialmodelingprep.com/pricing-plans) (fetched)
- **ForexFactory / FairEconomy JSON** (`https://nfs.faireconomy.media/ff_calendar_thisweek.json`):
  - Probe returned HTTP 200 JSON with fields `title, country, date (ISO with ET offset), impact (Low/Medium/High/Holiday), forecast, previous`. Example: "CB Consumer Confidence", USD, 2026-11-24T10:00-05:00, impact Medium, forecast 92.4, previous 91.7.
  - It also lists Fed speakers, e.g., "FOMC Member Williams Speaks".
  - It covers this week only, has no "actual" field, and is an undocumented, unofficial feed (ToS not reviewed).

  — [FF this-week JSON](https://nfs.faireconomy.media/ff_calendar_thisweek.json) (probed)
- **Trading Economics**:
  - The API pricing page shows only terms: "trial users are limited to 100000 data points and 100 requests". Trial fee non-refundable; no refunds for unused days.
  - A web Professional plan is $399/month. API plans "give you direct access to our calendar, indicators and financial markets streaming", but API prices are not published.
  - Aggregators describe API pricing as custom quotes.
  - TE also documents an iCalendar export of its calendar.

  — [TE API pricing](https://tradingeconomics.com/api/pricing.aspx) (fetched); [TE analytics pricing](https://tradingeconomics.com/analytics/pricing.aspx); [APIs.io TE plans](https://apis.io/plans/tradingeconomics/tradingeconomics-plans-pricing/); [TE iCalendar docs](https://docs.tradingeconomics.com/economic_calendar/icalendar)
- **Finnhub**:
  - The free tier is 60 calls/min. `/calendar/economic` is labelled "Premium Access Required" according to third-party write-ups.
  - One third-party site quotes All-In-One at $3,500/month. That is unverified, because the official pricing page is script-rendered and showed no prices to my fetch.

  — [Finnhub pricing](https://finnhub.io/pricing); [financecalendar.com comparison](https://www.financecalendar.com/?p=2927) (third-party)
- **EODHD**:
  - Plans: Free $0; EOD Historical $19.99/mo; EOD+Intraday $29.99/mo; Fundamentals $59.99/mo; ALL-IN-ONE $99.99/mo ($999.90/yr). A 30%-off campaign runs until Dec 1.
  - A "Corporate Events Calendar & News API" (earnings, IPOs, splits, news) is offered from $19.99/mo.
  - I did not confirm whether its economic events endpoint includes consensus.

  — [EODHD pricing](https://eodhd.com/pricing) (fetched); [EODHD calendar & news API](https://eodhd.com/lp/calendar-and-news-api)
- **Alpha Vantage**: its documentation lists Economic Indicators (Real GDP, Treasury Yield, Federal Funds Rate, CPI, Inflation, Retail Sales, Durable Goods, Unemployment, Nonfarm Payroll) as historical series. I saw no forward economic calendar with consensus. — [Alpha Vantage documentation](https://www.alphavantage.co/documentation/) (fetched)
- **Benzinga**:
  - Benzinga's API docs use token-authenticated v2 calendar endpoints (e.g., `/api/v2/calendar/ratings`). Its catalog includes economic, earnings and other calendars.
  - Public API prices are not published.
  - Benzinga Pro, a terminal and not an API, is listed at Basic $37/mo and Streamlined $147/mo.
  - Benzinga news is also resold through Massive at $99/month per dataset.

  — [Benzinga APIs](https://www.benzinga.com/apis/); [Benzinga docs](https://docs.benzinga.com/introduction); [Benzinga Pro pricing](https://www.benzinga.com/pro/pricing/); [Massive pricing](https://massive.com/pricing) (fetched)

### Inferences
- The cheapest robust combination is FMP Starter (personal) for estimate and previous values, cross-checked against the free ForexFactory JSON for impact tags. The official ICS calendars should be the authority on time.
- At 4:20am the consensus for that day's 8:30 releases is already fixed. Consensus usually settles the prior week. Timeliness therefore matters less than correctness here, and a once-nightly pull at about 4:00am is sufficient.
- Investing.com and ForexFactory scraping carries ToS risk. For an individual's personal research the risk is lower, but the app must tolerate the feed vanishing, so build in a fallback to the official ICS plus a static impact map.

### Gaps
- Not verified: Econoday pricing and API access, Nasdaq Data Link economic-calendar products, Trading Economics API price, Finnhub tier prices, Benzinga API individual pricing.
- I found no independent study comparing consensus accuracy across vendors (TE, FMP, Benzinga, Bloomberg/Reuters surveys).
- I did not check whether FMP's economic calendar `estimate` field is a true survey median or vendor-derived.

## Q3. Earnings calendars and after-hours/pre-market results for NDX and SPX heavyweights (timing BMO/AMC, EPS/revenue estimates, surprises); SEC EDGAR 8-K timing

### Takeaway
For timing and consensus EPS, the free (unofficial) Nasdaq.com calendar JSON already gives `time-pre-market` / `time-after-hours` flags, consensus EPS and analyst counts. FMP, Finnhub and Alpha Vantage add API-grade calendars with estimates.

For actual results after the close, the authoritative and fastest free source is EDGAR. The SEC says the submissions JSON updates in under a second, and there is a live Atom feed of current 8-Ks. One caveat: submissions begun after 5:30pm ET get the next business day's filing date and, per the SEC status page, are not disseminated until 6:00am. That is after the 4:20am cutoff, so a late 8-K needs a press-release or newswire fallback.

### Cited Findings
- **Nasdaq.com earnings calendar API** (`api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD`):
  - Probe returned HTTP 200 JSON with `time` (time-pre-market / time-after-hours / time-not-supplied), symbol, marketCap, fiscalQuarterEnding, `epsForecast` (consensus), `noOfEsts`, lastYearRptDt and lastYearEPS. Example for 2026-11-24: DELL after-hours, EPS forecast $6.55, 8 estimates; ADI pre-market $3.89.
  - No revenue estimate. This is an undocumented website backend with ToS and scraping risk.

  — [Nasdaq earnings calendar JSON](https://api.nasdaq.com/api/calendar/earnings?date=2026-11-24) (probed)
- **FMP earnings**:
  - Earnings Calendar on Basic: limited to roughly 87 large symbols (AAPL, TSLA, AMZN "and 84 more"), 1-month history.
  - Starter: US exchanges, 1-year history. Premium: US/UK/Canada, 5 years. Ultimate: global.
  - Earnings Surprises Bulk is not in Starter.

  — [FMP pricing](https://site.financialmodelingprep.com/pricing-plans) (fetched)
- **Alpha Vantage**: `EARNINGS_CALENDAR` returns "a list of company earnings expected in the next 3, 6, or 12 months" (horizon parameter), optionally per symbol, as CSV. There are separate `EARNINGS_ESTIMATES` (with analyst count and revision history) and `EARNINGS_CALL_TRANSCRIPT` endpoints. The free tier is 25 requests/day. — [Alpha Vantage documentation](https://www.alphavantage.co/documentation/); [AV premium](https://www.alphavantage.co/premium/) (fetched)
- **Finnhub**: third-party summaries describe a free earnings calendar (about 1 month window) and free company news. Not verified on the official page. — [Finnhub pricing](https://finnhub.io/pricing); [IBKR Campus Finnhub overview](https://www.interactivebrokers.com/campus/ibkr-quant-news/exploring-the-finnhub-io-api/)
- **EDGAR APIs**:
  - `data.sec.gov/submissions/CIK##########.json` and XBRL `companyfacts`; no API key.
  - "The JSON structures are updated throughout the day, in real time, as submissions are disseminated". Typical submissions-API delay is under 1 second, and under 1 minute for XBRL.
  - Bulk ZIPs are republished nightly at about 3:00am ET. No CORS.

  — [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) (fetched)
- **EDGAR fair access**: no more than 10 requests per second per user across machines. A declared User-Agent with company or name plus contact email is required. Undeclared tools may be throttled or blocked. — [SEC: Accessing EDGAR Data](https://www.sec.gov/os/accessing-edgar-data); [SEC developer resources](https://www.sec.gov/developer)
- **EDGAR current-filings Atom feed**: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=10&output=atom` returned live entries. Each entry shows item codes such as "Item 2.03 … Item 9.01", which lets the client filter for Item 2.02 (Results of Operations). — [EDGAR getcurrent Atom](https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=10&output=atom) (probed)
- **EDGAR hours**: filings are accepted 6:00am–10:00pm ET on business days. A live submission begun by 5:30pm ET gets that day's filing date. Most submissions begun after 5:30pm get the next business day's date and, per the SEC status page, are "not disseminated until" 6:00am ET the next business day. The exceptions that keep the same date up to 10pm are Section 16, 13D/G, 462(b) and Form 144; Form 8-K is not among them. — [SEC: Determine the status of my filing](https://www.sec.gov/page/edgar-how-do-i-determine-status-my-filing); [SEC Form 144 EDGAR hours rule](https://www.sec.gov/rules/2023/02/extending-form-144-edgar-filing-hours); [Gibson Dunn 2025 filing calendar](https://gibsondunn.com/wp-content/uploads/2024/09/SEC-Filing-Deadline-Calendar-2025.pdf)
- **Research on earnings spillover to the index**: Ogneva, Xia & Ye, "What moves the market? Individual firms' earnings announcements as drivers of index returns", uses index futures with narrow intraday and overnight windows (12,917 announcement windows, 100 firms). They argue the large market reactions are not purely mechanical weight effects. I could not read the effect sizes. — [ACFR conference paper PDF](https://acfr.aut.ac.nz/__data/assets/pdf_file/0012/686748/2b-Jingjing-Xia.pdf)
- **Index concentration**: a July 2026 report says the "Magnificent Seven" are about one-third of S&P 500 weight. — [BNN Bloomberg, Jul 29 2026](https://www.bnnbloomberg.ca/business/company-news/2026/07/29/magnificent-7-results-set-to-test-broadening-us-stock-market/)

### Inferences
- **Pipeline for TQQQ.** At about 4:15am:
  1. Pull today's and yesterday's Nasdaq/FMP earnings rows filtered to NDX top-15 weights (NVDA, MSFT, AAPL, AMZN, GOOGL, META, AVGO, TSLA, etc.).
  2. For each AMC reporter from yesterday, query the EDGAR submissions JSON for an 8-K with Item 2.02 and grab Exhibit 99.1 for EPS and revenue.
  3. Compute the surprise against the vendor consensus.

  Megacaps usually file the 8-K around their 4:00–4:30pm press release, well before the 5:30pm cutoff (inference; I did not check individual filers).
- Reporter-timing covariates (e.g., `ndx_weight_reporting_amc_prev_day`) are a reasonable known-future input for overnight gap-risk calibration.
- For SOXL, add NVDA, AVGO, AMD, MU and other semis. For TNA, no single name matters; macro and rates dominate.

### Gaps
- Zacks, Earnings Whispers and Benzinga earnings APIs: pricing and terms not verified.
- Revenue consensus availability by vendor at each price tier was not verified (FMP and Finnhub docs not fully read).
- How quickly vendors (FMP, Finnhub) post "actual" EPS after an AMC release was not measured.

## Q4. Market-implied Fed policy expectations: CME FedWatch API, compute-your-own from ZQ/SOFR futures, Atlanta Fed tracker, Kalshi/Polymarket

### Takeaway
The CME FedWatch API is now a cheap official option, reportedly $25/month for End-of-Day data with history back to 2015 (intraday tier price on request). EOD data from the prior session is adequate at 4:20am.

Free alternatives that work by script:
- Kalshi's public, unauthenticated market-data API (`KXFEDDECISION-*` events) and Polymarket's Gamma API. Both were verified live.
- Self-computing probabilities from 30-day fed funds futures (ZQ) using CME's published methodology. This needs a futures price source.

### Cited Findings
- **CME FedWatch API product**:
  - Third-party mirrors of CME's product page describe an End-of-Day tier at $25 per month "for macro research and daily reporting". Intraday is "Contact sales".
  - Access needs a registered OAuth API ID that is entitled via CME Customer Center or GAM. There is "extended history dating back to 2015".
  - The CME page itself returned 403/503 to my fetches, so the $25 figure is from search snippets of the CME page and not directly seen.

  — [CME FedWatch API](https://www.cmegroup.com/market-data/market-data-api/fedwatch-api.html); [CME FedWatch data catalog](https://www.cmegroup.com/market-data/browse-data/catalog/fedwatch-data.html); [CME Data Services portal: ordering APIs](https://www.cmegroup.com/tools-information/webhelp/data-services-portal/Content/Ordering-CME-Group-Market-Data-APIs.html)
- **FedWatch methodology**:
  - Implied rate = 100 − ZQ futures price. The futures settle on the monthly average EFFR.
  - Probabilities come from a binary tree that starts from a month with no FOMC meeting. They assume 25 bp increments, with fractional moves split between adjacent outcomes. Successive meetings chain onto the tree.

  — [CME: Understanding FedWatch methodology](https://www.cmegroup.com/articles/2023/understanding-the-cme-group-fedwatch-tool-methodology.html); [CME probability tree calculator](https://www.cmegroup.com/education/fed-funds-futures-probability-tree-calculator.html); [CME FedWatch user guide](https://cmegroup.com/tools-information/quikstrike/cme-fedwatch-tool-user-guide.html)
- **Kalshi**:
  - Probe of `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXFEDDECISION&status=open` with no authentication returned HTTP 200 JSON.
  - Markets are per-meeting outcome strips: "Hike >25bps / Hike 25bps / Hike 0bps / Cut 25bps / Cut >25bps". Fields include `yes_bid_dollars`, `last_price_dollars` and `close_time`, e.g., KXFEDDECISION-28JAN-H0 last $0.59.
  - Event tickers follow `KXFEDDECISION-YYMON`, e.g., KXFEDDECISION-26OCT.

  — [Kalshi markets API](https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXFEDDECISION&status=open&limit=5) (probed); [Kalshi KXFEDDECISION market page](https://kalshi.com/markets/kxfeddecision/fed-meeting/KXFEDDECISION-26SEP)
- **Research on Kalshi**: a 2026 Fed FEDS paper and an NBER working paper, as reported by Fortune, examine Kalshi Fed markets as forecasters. I did not read the findings. — [Fed FEDS 2026-010](https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf); [Fortune, Jan 28 2026](https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/)
- **Polymarket**: probe of `https://gamma-api.polymarket.com/events?tag_slug=fed&closed=false` with no authentication returned live Fed markets with `outcomePrices`, e.g., "How many Fed rate cuts in 2026?". — [Polymarket Gamma API](https://gamma-api.polymarket.com/events?limit=3&closed=false&tag_slug=fed) (probed)
- **Atlanta Fed Market Probability Tracker**: the page exists, but its content did not render to my fetch, so I could not verify instruments, update time or downloads. — [Atlanta Fed MPT](https://www.atlantafed.org/cenfis/market-probability-tracker)

### Inferences
- **Recommended free path.** Each morning:
  1. Find the next FOMC date from the Fed HTML.
  2. Pull Kalshi `KXFEDDECISION-<next meeting>` mid-prices.
  3. Normalise across outcomes to probabilities.
  4. Write `fed_watch_summary`, e.g., "Next FOMC Dec 8-9 (SEP). Kalshi implies P(hold)=x%, P(cut 25)=y%", with a source URL and timestamp.

  Kalshi and Polymarket trade overnight, so they reflect news that arrives after the US close. CME EOD does not.
- **Low-cost official path.** CME FedWatch API EOD at $25/month gives the de facto industry benchmark numbers that the user will see quoted in the news.
- **DIY path.** Compute from ZQ settlement prices. This needs CME futures data, which is a licensed real-time feed or delayed settlements. Use CME's tree method, plus SOFR futures for longer horizons.
- Prediction markets carry liquidity and bias caveats. Show them as a cross-check, not as ground truth.

### Gaps
- I could not directly view CME's FedWatch API price, licensing for non-professional use, or the EOD publication time.
- Kalshi and Polymarket API terms of use for automated personal use were not reviewed.
- I did not find a free official API serving ZQ settlement prices.

## Q5. Overnight news and headline feeds (Benzinga, Finnhub, Alpha Vantage NEWS_SENTIMENT, Massive/Polygon, Tiingo, Marketaux, NewsAPI, GDELT, Reuters/Bloomberg, RSS; Fed/White House/USTR for tariff and geopolitical shocks)

### Takeaway
Feeds that give tickers plus sentiment in one call:
- **Massive (ex-Polygon) `/v2/reference/news`**: in all Stocks plans including Free. Gives per-ticker `insights` with sentiment and `sentiment_reasoning`, but recency is "Updated hourly".
- **Marketaux**: free 100 requests/day, $29/mo Basic. Gives entity metadata.
- **Alpha Vantage NEWS_SENTIMENT**: now a premium function, from $49.99/mo, and "powered by data from the GDELT Project".

Feeds to avoid:
- NewsAPI's free plan has a 24-hour delay and is limited to development use, so it is useless at 4:20am. Paid starts at $449/mo.
- For policy shocks the official RSS feeds (Fed, USTR) are free and immediate. The White House feed URL I tried returned 404, and the CNBC RSS blocked scripts.

### Cited Findings
- **Massive News**:
  - The endpoint returns recent articles "along with summaries, source details, and sentiment analysis … extracting associated tickers, assigning sentiment".
  - Example `insights: [{ticker, sentiment: "positive", sentiment_reasoning: ...}]`.
  - Plan access: "Included in all Stocks plans" (Basic Free, Starter $29/mo, Developer $79/mo, Advanced $199/mo). Plan recency is "Updated hourly" on all tiers.
  - Benzinga real-time news is a $99/month partner add-on. Massive plans are marked "Individual use only".

  — [Massive News API docs](https://massive.com/docs/rest/stocks/news) (fetched); [Massive pricing](https://massive.com/pricing) (fetched)
- **Marketaux**: Free $0 (100 requests/day, 3 articles per request); Basic $29/mo (2,500/day, 20 articles); Standard $49/mo (10,000/day, 50 articles); Pro $99/mo (25,000/day, 100 articles). It advertises "Instant news access", 5,000+ sources and 200,000+ entities. — [Marketaux pricing](https://www.marketaux.com/pricing) (fetched)
- **Alpha Vantage NEWS_SENTIMENT**:
  - Filters: `tickers`, `topics` (earnings, ipo, M&A, technology, fiscal/monetary policy, etc.), `time_from`, `limit=1000`.
  - Docs: "this is a premium API function" and "Powered by data from the GDELT Project".
  - Premium plans run $49.99/mo (75 req/min) to $249.99/mo (1,200 req/min), with "No daily limits". The free tier is 25 requests/day.
  - Alpha Vantage asks users to subscribe to premium "for your personal use"; commercial use goes through sales.

  — [Alpha Vantage documentation](https://www.alphavantage.co/documentation/); [Alpha Vantage premium](https://www.alphavantage.co/premium/) (both fetched)
- **Alpha Vantage sentiment scale**: an older write-up says article sentiment ranges roughly −0.35 to +0.35. — [Wealth-Lab blog (2022)](https://wealth-lab.com/blog/news-sentiment) (third-party, dated)
- **NewsAPI**:
  - Developer plan: $0, but "Articles have a 24 hour delay", 100 requests/day, and it "cannot be used in a staging or production environment (including internally)".
  - Business: $449/mo with real-time articles. Advanced: $1,749/mo.
  - No full article text on any plan.

  — [NewsAPI pricing](https://newsapi.org/pricing) (fetched)
- **FMP news**: General News and Stock News are included from Starter (1-year history). Press Releases are not included in Starter. — [FMP pricing](https://site.financialmodelingprep.com/pricing-plans) (fetched)
- **GDELT DOC 2.0 API**: searches "a rolling window of the last 3 months of coverage". Timeline modes report volume by day, hour or 15 minutes. My API probe timed out from this environment. — [GDELT DOC 2.0 announcement](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) (fetched); [GDELT API endpoint](https://api.gdeltproject.org/api/v2/doc/doc?query=nasdaq&mode=artlist&format=json) (probe timed out)
- **Official policy and shock RSS**:
  - Fed `press_all.xml` / `press_monetary.xml` returned HTTP 200 XML. — [Fed RSS feeds](https://www.federalreserve.gov/feeds/feeds.htm) (probed)
  - USTR `https://ustr.gov/rss.xml` returned HTTP 200 `application/rss+xml`; relevant to tariff headlines. — [USTR RSS](https://ustr.gov/rss.xml) (probed)
  - `https://www.whitehouse.gov/feed/` returned 404. — (probed)
  - CNBC's legacy RSS URL returned 403 to a script. — (probed)
- **Finnhub**: company news is free (1 year) according to third-party summaries. Market news free status is unverified. — [Finnhub pricing](https://finnhub.io/pricing); [IBKR Campus](https://www.interactivebrokers.com/campus/ibkr-quant-news/exploring-the-finnhub-io-api/)
- **News sentiment and return prediction**: Lopez-Lira & Tang have an LLM label each headline good, bad or neutral for the firm. The scores "significantly predict out-of-sample daily stock returns, subsuming traditional methods". Predictability is stronger for small stocks and bad news. Basic models (GPT-1/2, BERT) failed. — [arXiv 2304.07619 v5](https://arxiv.org/abs/2304.07619v5)

### Inferences
- **Free 4:20am headline stack**:
  - Fed, USTR and Treasury RSS for official shocks.
  - Marketaux free (100 req/day is enough for a few ticker-batched calls).
  - Massive free News, filtered to `published_utc` > yesterday 16:00 ET, accepting about 1h recency.
  - EDGAR 8-K Atom for company events.
- **Under-$100 stack**: Marketaux Basic ($29) or Alpha Vantage Premium ($49.99) for ticker-tagged and sentiment-scored overnight news. Add Massive Benzinga add-on ($99) only if near-real-time professional newswire matters.
- **Professional**: Reuters, Bloomberg, Dow Jones Newswires and Benzinga Pro or Newsfeed. These are enterprise-licensed and not retail-API friendly; prices not verified.
- Index ETFs need macro and geopolitical headlines more than single-stock ones. Query by topics (monetary policy, tariffs, China, Taiwan, semiconductors, export controls) and by the top NDX weights, then dedupe by story.

### Gaps
- Tiingo News pricing and latency could not be read (the page is script-rendered).
- WSJ and FT RSS availability and terms were not tested.
- The current White House feed URL was not found.
- I measured no vendor latency for overnight (00:00–04:20 ET) news.
- Benzinga Newsfeed standalone API pricing is unpublished.
- Reuters and Bloomberg costs were not researched beyond their professional-only status.

## Q6. Sentiment indicators (AAII, CNN Fear & Greed, NAAIM, CFTC COT, Stocktwits/Reddit, put/call briefly): machine-readability, timing and predictive value

### Takeaway
All the classic sentiment gauges are weekly or slower and, at best, weakly predictive at a 1-day horizon. They suit regime and context features, not next-day signals:
- AAII: weekly, Wednesday-dated.
- NAAIM: weekly, Wednesday close.
- CFTC COT: Tuesday positions, released later that week.

Machine-readability varies:
- CFTC has a clean free Socrata JSON API.
- AAII and NAAIM are HTML pages; downloads are partly member-only.
- CNN Fear & Greed has no official API, and its unofficial JSON endpoint blocked my script with HTTP 418.
- Reddit's free API is 100 queries/min per OAuth client for non-commercial use.
- Stocktwits API access status is unclear.

### Cited Findings
- **AAII**: the sentiment results page (HTML) lists weekly Bullish/Neutral/Bearish with "Reported Date" on Wednesdays, e.g., Nov 18: 33.3% / 24.4% / 42.2%. — [AAII sentiment results](https://www.aaii.com/sentimentsurvey/sent_results) (probed)
- **AAII predictive value**:
  - CXO Advisory (Jul 1987–Jul 2025): net bull-bear sentiment vs S&P 500 26-week forward returns correlates at −0.11 (R² 0.01), near zero in the second half of the sample. — [CXO Advisory](https://www.cxoadvisory.com/?p=22546)
  - AAII's own analysis: high neutral readings and low optimism were followed by above-average returns, with hindsight-bias caveats. — [AAII Journal](https://www.aaii.com/journal/article/is-the-aaii-sentiment-survey-a-contrarian-indicator); [AAII: analyzing without hindsight (PDF)](https://www.aaii.com/files/journal/pdf/analyzing-the-aaii-sentiment-survey-without-hindsight.pdf)
  - A 2026 AEA paper notes survey sentiment measures show "weak to no return predictability, particularly over short horizons". — [AEA 2026 program](https://benny.aeaweb.org/conference/2026/program/paper/6Z8QBKFb)
- **NAAIM**: "NAAIM member firms who are active money managers are asked each Wednesday to provide a number which represents their overall equity exposure at the market close." The page is HTML. — [NAAIM Exposure Index](https://naaim.org/programs/naaim-exposure-index/) (probed)
- **CFTC COT**: the Socrata API `publicreporting.cftc.gov/resource/6dca-aqww.json` (legacy futures-only) returned JSON with `report_date_as_yyyy_mm_dd` 2026-11-17 and fields such as `noncomm_positions_long_all` and `open_interest_all`. It is free and needs no key. — [CFTC Public Reporting API](https://publicreporting.cftc.gov/resource/6dca-aqww.json) (probed)
- **CNN Fear & Greed**: the unofficial endpoint `production.dataviz.cnn.io/index/fearandgreed/graphdata` returned HTTP 418 to a script. There is no official API. — (probed)
- **Reddit Data API**: the free tier is 100 queries/min per OAuth client id (10/min without OAuth). Commercial use requires a separate agreement. — [Data365 summary of Reddit API limits 2026](https://data365.co/blog/reddit-api-limits); [Reddit 2023 API update thread (mirror)](https://reddit.rtrace.io/r/redditdev/comments/13wsiks/api_update_enterprise_level_tier_for_large_scale/jmr7eu0/?context=3)
- **Stocktwits**: partner and firehose documentation exists. Stocktwits sentiment is distributed through partners such as Alpaca. I could not confirm open self-serve developer registration. — [Stocktwits firestream docs](https://firestream-portal.stocktwits.com/documentation/stream); [Alpaca x Stocktwits](https://alpaca.markets/blog/provide-real-time-social-sentiment-to-customers-with-alpacas-stocktwits-integration/)

### Inferences
- Use AAII, NAAIM and COT (e.g., positioning in E-mini Nasdaq-100 and Russell 2000 futures) as slow-moving regime or context fields in the report, not as next-day drivers. Their evidence for 1-day prediction is weak.
- Put/call and VIX-type gauges (covered elsewhere) are daily, and are the better short-horizon sentiment inputs.
- Social sentiment (Reddit/Stocktwits) is noisy for index ETFs. It is optional and lowest priority.

### Gaps
- CFTC COT release day and time (usually Friday 3:30pm ET) were not fetched from cftc.gov in this session.
- The AAII historical spreadsheet (member access) and NAAIM release day were not verified.
- I found no rigorous study of CNN Fear & Greed's predictive value.
- No 1-day-horizon study for NAAIM or COT on NDX was found.

## Q7. Turning headlines into catalyst impact levels without hallucination (LLM or rules engine)

### Takeaway
Ground every catalyst and headline in a fetched record with a URL, a timestamp and a source ID. Let rules assign impact for scheduled events. Restrict the LLM to classifying and summarising supplied text into a fixed JSON schema, with mandatory citation IDs, and drop any output that cannot be traced to an input record.

### Cited Findings
- LLM headline classification (good/bad/neutral) has documented out-of-sample predictive value for daily returns, and larger models do better. This supports using an LLM as a classifier over given headlines rather than as a generator. — [Lopez-Lira & Tang, arXiv 2304.07619](https://arxiv.org/abs/2304.07619v5)
- Vendor sentiment fields already exist and can serve as a cross-check:
  - Massive `insights.sentiment` and `sentiment_reasoning` — [Massive news docs](https://massive.com/docs/rest/stocks/news)
  - Alpha Vantage NEWS_SENTIMENT scores — [Alpha Vantage docs](https://www.alphavantage.co/documentation/)
  - ForexFactory `impact` Low/Medium/High for scheduled macro events — [FF JSON](https://nfs.faireconomy.media/ff_calendar_thisweek.json)

### Inferences
- **Scheduled events: deterministic rules, no LLM.** Map event type to impact:
  - High: CPI, core PCE, NFP, the FOMC decision, and the FOMC decision/SEP/press-conference days.
  - Medium: PPI, retail sales, ISM, JOLTS, GDP advance, Powell speeches, 10y/30y auctions, and AMC/BMO earnings of a top-10 NDX weight.
  - Low: other Fed speakers, other auctions, regional surveys.
  - Upgrade one level when the event lands on OPEX or quad-witching or a half-day, or when ForexFactory or a vendor flags it High.
  - Store `time_utc` from the official ICS (BEA already gives UTC; convert BLS ET with DST awareness).
- **Headlines**:
  1. Fetch the window from 16:00 ET the prior day to 04:15 ET.
  2. Dedupe by URL and by a title similarity hash.
  3. Keep the top N by source tier and ticker relevance (NDX weights, semis, macro keywords).
  4. Pass only those records, with IDs, to the LLM using a JSON schema: `{id, summary<=25 words, tickers[], direction, impact, rationale_quote}`.
  5. Reject outputs whose `id` is not in the input, or whose `rationale_quote` is not a substring of the source text.
  6. Never let the LLM invent times, numbers or consensus values; those come only from structured feeds.
  7. Mark empty fields explicitly (e.g., "no qualifying headlines") rather than letting the model fill them.
- Log source and fetch timestamp for each item so the 4:30am report can show freshness. Flag items more than 2h old, e.g., Massive's hourly recency.

### Gaps
- I did not fetch a formal benchmark of LLM hallucination rates in financial news summarisation. The practices above are design recommendations (inference), not sourced results.

## Q8. Recommended stack by budget tier, with a 4:20am ET timeliness check

### Takeaway
- **Free tier**: covers calendar and Fed expectations well. Official ICS/XML/RSS feeds, Nasdaq earnings JSON, the EDGAR APIs, Kalshi/Polymarket, the ForexFactory JSON, Marketaux free, Massive free news and CFTC API.
- **Under about $100/month**: adds licensed consensus estimates and sentiment-tagged news. FMP Starter ($29) or Premium ($69), plus Marketaux Basic ($29) or Alpha Vantage Premium ($49.99), plus optionally CME FedWatch EOD ($25, unverified).
- **Professional**: adds real-time newswires and institutional consensus. Trading Economics API, Benzinga Newsfeed, Bloomberg/Reuters and the CME FedWatch intraday tier, all quote-based.

### Cited Findings
- **Free components and their 4:20am status**:
  - BEA ICS (through Dec 2027): weekly pull. — [BEA ICS](https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics)
  - BLS ICS (scripted access blocked to unidentified clients): weekly pull. — [BLS schedule](https://www.bls.gov/schedule/)
  - FOMC HTML: static. — [FOMC calendars](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
  - Treasury tentative auction XML: per refunding cycle. — [Treasury XML](https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml)
  - NYSE holidays: annual. — [NYSE](https://www.nyse.com/markets/hours-calendars)
  - Nasdaq earnings JSON: daily, unofficial. — [Nasdaq API](https://api.nasdaq.com/api/calendar/earnings?date=2026-11-24)
  - EDGAR submissions (under 1 second) and 8-K Atom: real-time, with the 5:30pm cutoff caveat. — [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces); [SEC filing status](https://www.sec.gov/page/edgar-how-do-i-determine-status-my-filing)
  - Kalshi and Polymarket Fed markets: 24/7 pricing. — [Kalshi API](https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXFEDDECISION&status=open&limit=5); [Polymarket Gamma](https://gamma-api.polymarket.com/events?limit=3&closed=false&tag_slug=fed)
  - Fed and USTR RSS: real-time. — [Fed feeds](https://www.federalreserve.gov/feeds/feeds.htm); [USTR RSS](https://ustr.gov/rss.xml)
  - Marketaux free (100 req/day). — [Marketaux](https://www.marketaux.com/pricing)
  - Massive free news (hourly recency). — [Massive docs](https://massive.com/docs/rest/stocks/news)
  - CFTC COT API: weekly. — [CFTC API](https://publicreporting.cftc.gov/resource/6dca-aqww.json)
- **Paid prices verified on vendor pages (2026-11-24)**:
  - FMP Starter $29/mo ($19 annual); Premium $69 ($49 annual); Ultimate $139 ($99 annual). — [FMP](https://site.financialmodelingprep.com/pricing-plans)
  - Marketaux Basic $29 / Standard $49 / Pro $99. — [Marketaux](https://www.marketaux.com/pricing)
  - Alpha Vantage $49.99–$249.99/mo. — [AV](https://www.alphavantage.co/premium/)
  - EODHD ALL-IN-ONE $99.99/mo; Calendar & News from $19.99/mo. — [EODHD](https://eodhd.com/pricing)
  - Massive Stocks Starter $29, Developer $79, Advanced $199 (individual use); Benzinga add-on $99. — [Massive](https://massive.com/pricing)
  - NewsAPI Business $449/mo. — [NewsAPI](https://newsapi.org/pricing)

### Inferences
**Proposed 4:00–4:25am ET schedule:**
- **04:00**: refresh the cached calendars. ICS/XML/FOMC refresh weekly, but re-validate today and tomorrow. Pull FMP or ForexFactory consensus for today's 8:30/10:00 releases. Compute OPEX, quad-witch and half-day flags.
- **04:05**: earnings. Nasdaq/FMP rows for today BMO and yesterday AMC, filtered to index heavyweights. EDGAR 8-K Item 2.02 lookups for yesterday's AMC names. Surprise = actual − consensus.
- **04:10**: Fed expectations. Kalshi (free) and/or CME FedWatch EOD. Next FOMC date, probabilities, and change versus yesterday.
- **04:12**: headlines. Fed/USTR/Treasury RSS, Marketaux, Massive and Alpha Vantage, for the window 16:00 ET the prior day to now. Then dedupe and classify under the grounding rules in Q7.
- **04:15**: build the Chronos-2 known-future covariates for the forecast horizon (event dummies for the next N sessions from the skeleton calendar), then run the forecast. Report done by 04:30.

**Tier choice:**
- **Best value for this app (about $60–80/month)**: FMP Starter ($29, personal) for economic and earnings calendars with estimates; Marketaux Basic ($29) or Massive free news for headlines; Kalshi free plus CME FedWatch EOD ($25, if verified) for Fed expectations. Everything else free and official.
- **Professional tier**: Bloomberg or Refinitiv terminal feeds (ECO calendar with survey medians, real-time news), Benzinga Newsfeed or Dow Jones, CME FedWatch intraday and CME futures data, plus Econoday or Trading Economics API. All are quote-based.

**Fallback rule**: if any paid feed fails at 4:15, degrade to the official skeleton calendar with the static impact map, and print an explicit "consensus unavailable" note rather than empty arrays.

### Gaps
- Prices could not be confirmed for: Finnhub tiers, Trading Economics API, Benzinga API, Econoday, Zacks, Earnings Whispers, Tiingo News, CME FedWatch (seen only via search snippets) and Bloomberg/Reuters.
- Terms of service for the unofficial feeds (Nasdaq API, ForexFactory/FairEconomy JSON, CNN) were not reviewed in detail. Treat them as at-risk dependencies.
