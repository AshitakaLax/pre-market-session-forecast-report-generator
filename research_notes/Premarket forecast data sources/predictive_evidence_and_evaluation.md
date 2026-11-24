# Predictive evidence for overnight and pre-market inputs, leveraged-ETF effects, Chronos-2 covariate use, and how to evaluate the gain

Scope note: these notes cover next-regular-session (and short-horizon) forecasting for QQQ/SPY and their 3x versions (TQQQ/UPRO), with inputs limited to what exists by about 4:25am ET. Repo context comes from reading `chronos_service/app.py` and `chronos_service/walk_forward.py` (read-only). The app forecasts the ETF's own close-to-close log returns with Chronos-2. All market covariates are past-only and observed at the prior daily close. Only the 8 sin/cos calendar features are passed as known-future covariates. The 4:00–4:30am pre-market snapshot is displayed but not fed to the model. The walk-forward scores pinball loss at q10/q50/q90, 80% coverage and the Brier score for P(return>0) against a 5-session block-bootstrap baseline. Research date: 2026-11-24.

## 1. Overnight vs. intraday returns: overnight drift, overnight–intraday reversal/momentum, gap fills, and whether the 4pm→4:20am futures move predicts the regular session

### Takeaway
The best-known overnight anomaly, the "overnight drift" at the European open (2–3am ET), was large in 1998–2020 and has averaged close to zero in 2021–2025. Its authors document this themselves, so any feature that bets on a positive overnight mean is likely stale. No peer-reviewed study found tests whether the 4pm→4:20am futures move predicts QQQ/SPY open-to-close returns. The related evidence on mean effects is weak and points in mixed directions: futures overnight-to-intraday reversal on one side, continuation from the first half-hour (which includes the overnight move) into the last half-hour on the other. The overnight move matters mainly for a mechanical reason. It is already part of the close-to-close return being forecast.

### Cited Findings
- Boyarchenko, Larsen & Whelan, "The Overnight Drift" (NY Fed Staff Report 917; published in *Review of Financial Studies* 36(9), 2023, pp. 3502–47). In 1998–2019, the largest positive S&P 500 E-mini returns accrued between 2am and 3am ET, around the European open, averaging about 3.6% annualized. The authors attribute this to dealer inventory risk: there is a strong negative relation between end-of-day order imbalance from sell-offs and the subsequent drift. Scheduled macro, monetary-policy and earnings announcements do not explain it. — [NY Fed SR917](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr917.pdf); [IDEAS listing](https://ideas.repec.org/p/fip/fednsr/87539.html); [Liberty Street 2021](https://libertystreeteconomics.newyorkfed.org/2021/05/the-overnight-drift-in-us-equity-returns)
- Post-publication decay (same authors, Liberty Street Economics, July 1, 2026):
  - In the original 1998–2020 sample (5,691 days), the 2–3am ET window produced about 3.7% per year, more than 60% of the E-mini's 5.9% annualized close-to-close return.
  - From January 2021 to December 2025 (1,245 days), the window averaged "close to zero". The same holds for NQ (Nasdaq-100) and YM futures.
  - The main reason given is a fall in the dispersion of closing order imbalances: the SD of end-of-day relative signed volume dropped from 6.5% to 2.9%.
  - The VIX mean changed little (20.4 to 19.4). The overnight share of E-mini volume rose only from 15% to 16%.
  - The NightShares overnight ETFs (NSPY/NIWM), launched June 2022, closed 14 months later.
  - [Liberty Street 2026: The Disappearing Overnight Drift](https://libertystreeteconomics.newyorkfed.org/2026/07/the-disappearing-overnight-drift/)
- Lou, Polk & Skouras, "A tug of war: overnight versus intraday expected returns" (*JFE* 134(1), 2019, 192–213). For firm-level returns:
  - Overnight returns continue into later overnight returns, and intraday returns continue into later intraday returns. Across the two periods there is an offsetting reversal that lasts for years.
  - Across 14 strategies, profits are earned entirely overnight or entirely intraday, usually with opposite signs.
  - The authors attribute this to different clienteles trading in the two periods.
  - This is cross-sectional stock evidence, not an index-timing result.
  - [LSE PDF](https://personal.lse.ac.uk/polk/research/TugOfWar.pdf); [EconPapers](https://econpapers.repec.org/RePEc:eee:jfinec:v:134:y:2019:i:1:p:192-213)
- Della Corte, Kosowski & Wang, "Market Closure and Short-Term Reversal":
  - Data: stocks from 1993 and futures from July 1982, both through 2014.
  - A close-to-open → open-to-close (CO–OC) reversal is the strongest of the four reversal strategies tested for U.S. stocks: 1.68% gross daily return, gross annualized Sharpe 24.16.
  - Futures results are "generally consistent, though much weaker".
  - Figures are gross with roughly 100% daily turnover, so costs would "dramatically reduce" them.
  - [CICF paper](https://www.cicfconf.org/sites/default/files/paper_357.pdf); [CXO summary](https://www.cxoadvisory.com/technical-trading/overnightintraday-return-reversal-trading/); companion paper ["Overnight-Intraday Reversal Everywhere"](https://assets.super.so/e46b77e7-ee08-445e-b43f-4ffd88ae0a0e/files/c953a0e6-e93e-4bf7-b839-45a90cedced4.pdf)
- Gao, Han, Li & Zhou, "Market intraday momentum" (*JFE* 129(2), 2018). On SPY 1993–2013, the first half-hour return (measured from the previous day's close, so it includes the overnight move) predicts the last half-hour return, and the effect is statistically and economically significant out of sample. — [EconPapers](https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414)
- Baltussen, Da, Lammers & Martens (*JFE* 142(1), 2021). Across 60+ futures (equity, bond, commodity, FX) from 1974 to 2020, the return over the rest of the day positively predicts the last 30 minutes. The effect is robust over time. They link it to gamma-hedging demand from option market makers and leveraged ETFs: hedging short gamma means trading in the direction of the price move. — [EconPapers](https://econpapers.repec.org/RePEc:eee:jfinec:v:142:y:2021:i:1:p:377-403); [Alpha Architect summary](https://alphaarchitect.com/hot-topic-does-gamma-hedging-actually-affect-stock-prices/)
- Informal replication: a QuantConnect backtest of the Gao et al. rule on SPY, IWM and IYR finds "lower returns over our testing period" and a Sharpe below the S&P 500. This is a tutorial, not peer-reviewed. — [QuantConnect](https://www.quantconnect.com/research/15348/intraday-etf-momentum/)
- Gap-fill statistics (practitioner blog, not peer-reviewed; samples are small and definitions inconsistent):
  - About 15–20% of SPY/QQQ sessions open with a ≥1% gap; for QQQ, about 17% of days since 1999.
  - About half of ≥1% gaps fill intraday.
  - QQQ fills about 45% of 1–1.99% gaps the same day, versus 30–33% of gaps ≥2%.
  - SPY ≥1% gap-downs averaged +0.21% open-to-close. QQQ gap-ups averaged −0.5% (small sample).
  - On QQQ gap-up days, the average intraday high/low relative to the open was about +0.9%/−1.8%.
  - [SharePlanner, Apr 2025](https://www.shareplanner.com/blog/strategies-for-trading/fading-the-gap-how-large-overnight-moves-in-spy-and-qqq-play-out-during-the-trading-day.html)

### Inferences
- The European-open window (2–3am ET) ends before 4:20am. Whatever drift or reversal happens there is already inside the observed 4pm→4:20am futures move by forecast time. It is realized information, not a forecastable feature.
- For a close-to-close target, the 4pm→4:20am move is not a predictor of the remainder of the day. It is a partially realized component of the target. TQQQ's close-to-close return is about 3× QQQ's, so a +1% NQ move by 4:20am already implies roughly +3% of TQQQ's day (less basis and fees). That is a large, near-deterministic shift in the center of the 1-day distribution. The model currently ignores it, because all market covariates stop at the previous close.
- The evidence on whether the remainder of the session (4:20am→4pm) reverses or continues is conflicting and weak:
  - Reversal: Della Corte et al. for futures (weak and gross of costs); fade tendencies in practitioner gap statistics.
  - Continuation: Gao et al. and Baltussen et al. into the last half-hour.
  - Treat any directional coefficient as something to test, not something to assume.
- The intraday-momentum and gamma-hedging literature suggests days with large overnight moves have more late-day continuation, which would fatten both tails of the close-to-close distribution. This is a plausible width effect, not a mean effect.
- Pre-2021 overnight-drift estimates should not be used as priors for the mean (see decay finding).

### Gaps
- No peer-reviewed study found that directly tests whether the NQ/ES futures return from 4:00pm to about 4:20am ET predicts QQQ/SPY open-to-close or 4:20am→close returns, either out of sample or after 2020.
- No study found on overnight-to-intraday reversal specifically for QQQ/NQ in 2021–2026.
- The share of close-to-close variance realized between 4pm and 4:20am for QQQ was not found in any source. It should be measured on the user's own data, because it sets how much the 1-day interval can narrow.
- No rigorous peer-reviewed gap-fill statistics for QQQ/TQQQ were found; only a practitioner blog.

## 2. Pre-market activity: does 4:00–4:30am ET pre-market return and volume carry information, and how noisy is it at 4:30am versus 9:00am?

### Takeaway
After-hours and pre-open trading do produce real price discovery, and individual trades carry more information per trade than daytime trades. But prices are noisier when volume is thin, and the opening price only gains information above a critical volume threshold. At 4:00–4:25am, the ETF's own pre-market tape (especially TQQQ's) is thin. The far more liquid NQ/ES futures are the better source of the overnight price signal. The ETF tape is best used as a basis and liquidity check, not as the main input.

### Cited Findings
- Barclay & Hendershott, "Price Discovery and Trading After Hours" (*RFS* 16(4), 2003, 1041–1073):
  - "A high volume of liquidity trade facilitates price discovery," so prices are more efficient and more information is revealed per hour during the day.
  - Low after-hours volume nonetheless "generates significant, albeit inefficient, price discovery."
  - "Individual trades contain more information after hours than during the day."
  - Because information asymmetry falls over the day, price changes before the open are larger, reflect more private information, and are less noisy than after the close.
  - [EconPapers](https://econpapers.repec.org/RePEc:oup:rfinst:v:16:y:2003:i:4:p:1041-1073); [IDEAS](https://ideas.repec.org/a/oup/rfinst/v16y2003i4p1041-1073.html)
- Barclay & Hendershott (2008, *Journal of Empirical Finance*) on the Nasdaq pre-open: pre-open trading improves the efficiency of the opening price, but only above a critical volume threshold. — [IDEAS](https://ideas.repec.org/a/eee/empfin/v15y2008i5p839-849.html); [EconBiz](https://www.econbiz.de/Record/a-comparison-of-trading-and-non-trading-mechanisms-for-price-discovery/10005199000)
- Eaton, Shkilko & Werner, "Nocturnal Trading" (2025; broker data, 8pm–4am ET):
  - Overnight price discovery is substantial, especially for exchange-traded products.
  - Quoted spreads are wider overnight, but realized spreads are about the same or narrower.
  - [AFA paper](https://afajof.org/management/viewp.php?n=162176); [WFE 2026 summary](https://wfe-live.lon1.cdn.digitaloceanspaces.com/org_focus/storage/media/WFE%20-%20Extending%20Exchange%20Trading%20Hours%20wCover.pdf)
- A conference paper using 4:00–9:30am ET data finds price discovery moving earlier into the pre-market. It interprets part of the pattern as a liquidity-compensation effect in thin trading: the first trade after a quiet spell carries a premium. — [MFC paper](https://mfc3.eventsadmin.com/Papers/ViewContribution?cid=14387&h=34E9F3229E21B084DE4A06E94CD0FC5F)
- Mu (2025, *Journal of Futures Markets*): extended-hours index-option prices add information for the next regular session, while the 9:15–9:30 opening process adds little price discovery. — [Wiley](https://onlinelibrary.wiley.com/doi/10.1002/fut.70026)
- The overnight share of E-mini futures volume is about 15–16% (2021–2025 versus 1998–2020). Futures are the deep overnight venue. — [Liberty Street 2026](https://libertystreeteconomics.newyorkfed.org/2026/07/the-disappearing-overnight-drift/)
- Free intraday history from Yahoo via yfinance is limited:
  - 1-minute bars: about 7 days (within the last 30).
  - 2–90-minute bars: 60 days.
  - 1-hour bars: 730 days.
  - Yahoo does not publish these limits and can change them.
  - [yfinance wiki (Ticker)](https://github.com/ranaroussi/yfinance/wiki/Ticker); [yfinance issue](https://github.com/ranaroussi/yfinance/issues/2451)

### Inferences
- At 4:00–4:25am, TQQQ's pre-market price is mostly a lagged, noisier copy of 3×(NQ move) plus a liquidity premium or discount. Barclay & Hendershott's volume threshold and the thin-trading premium suggest using NQ=F/ES=F (and the VIX's overnight value) as the overnight price input. A useful ETF-side feature is the gap between TQQQ's pre-market price and 3× the futures-implied fair value, as an indicator of illiquidity or dislocation, rather than the raw pre-market return.
- The 4:00–4:30am window is the noisiest part of the pre-open, because asymmetric-information trades cluster closer to the open. A 9:00am pre-market print would be more informative but is outside the 4:30am deadline. The practical way to quantify the 4:30am vs. 9:00am difference is empirical: on archived data, regress the 9:29am (or open) price on the 4:20am price and compare the R² of futures-based vs. ETF-based 4:20am signals.
- Pre-market volume at 4am is probably more useful as a regime or news flag than as a price signal: unusual 4am volume suggests overnight news, so widen the distribution. This needs testing, and the history is hard to obtain (see below).
- History is the binding constraint. Feeding any 4:20am feature into a model that learns from history needs the same 4:20am value for every past session. Free Yahoo data gives at most about 2 years of hourly bars, about 500 sessions, and only roughly aligned to 4:00am or 5:00am. The user must either start archiving 4:20am snapshots daily now, or buy historical intraday futures data.

### Gaps
- No study found that measures the predictive content of the 4:00–4:30am ET window specifically, as opposed to the whole pre-market, for QQQ/SPY or leveraged ETFs.
- No study found comparing the informativeness of 4:30am vs. 9:00am pre-market prices for index ETFs.
- No source found on the size of TQQQ's pre-market premium or discount to futures-implied value at 4am.
- Historical intraday futures data vendors and their costs were not researched here.

## 3. Volatility forecasting: implied vs. historical vol, VIX1D/VIX9D, HAR-RV, leverage effects, variance risk premium, macro-announcement and FOMC days

### Takeaway
Volatility and distribution width are where the documented, repeatable forecasting gains are:
- Implied volatility adds out-of-sample information to HAR-type realized-vol models.
- VIX1D in particular improves 1-day-ahead forecasts once its risk premium is removed.
- Overnight market-level volatility and negative-return (leverage) terms help.

Event-day mean effects (pre-FOMC drift) have decayed. Scheduled-event calendars are still valid known-future covariates.

### Cited Findings
- Albers (2025), "A New Star Is Born: Does the VIX1D Render Common Volatility Forecasting Models for the US Equity Market Obsolete?" (*Journal of Futures Markets* 45(11), 2092–2108):
  - VIX1D overestimates next-day S&P 500 volatility, which reflects a risk premium.
  - After a simple risk-premium adjustment, it forecasts next-day volatility more precisely than HAR and HAR-VIX1D models.
  - It appears to capture 0DTE option information.
  - [IDEAS](https://ideas.repec.org/a/wly/jfutmk/v45y2025i11p2092-2108.html)
- Zhang, Ruan & Zhang (2023, *Finance Research Letters*). Added to HAR-RV, VIX1D has considerably better 1-day-ahead predictive power than the 30-day VIX, but its predictive power decays faster with horizon. — [XJTLU record](https://scholar.xjtlu.edu.cn/en/publications/do-short-term-market-swings-improve-realized-volatility-forecasts/) (DOI 10.1016/j.frl.2023.104629)
- Cboe: VIX1D uses SPX options with 0 and 1 days to expiry. It "is calculated during regular trading hours only." At the start of the day it is "nearly fully weighted to the current day's expiring SPX options strip." It launched April 24, 2023. — [Cboe insight](https://www.cboe.com/insights/posts/what-the-vix-and-vix-1-d-indices-attempt-to-measure-and-how-they-differ); [VIX1D methodology](https://cdn.cboe.com/resources/indices/governance/Volatility_Index_Methodology_Cboe_1-Day_Volatility_Index.pdf)
- Cboe began disseminating the VIX overnight in April 2016, starting at 2:15am CT (3:15am ET) during extended trading hours. A live VIX value therefore exists by 4:20am ET. — [Hedgeweek](https://www.hedgeweek.com/cboe-start-overnight-dissemination-cboe-volatility-index-vix-15-april/); [Cboe VIX methodology (RTH/GTH by index)](https://cdn.cboe.com/resources/indices/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf)
- Busch, Christensen & Nielsen (*Journal of Econometrics* 160(1), 2011) extend Corsi's HAR with implied volatility (FX, stocks, bonds). Out of sample, implied vol is important for forecasting future realized-vol components. Jumps are partly predictable, and options appear to price future jumps. — [EconPapers](https://econpapers.repec.org/RePEc:eee:econom:v:160:y:2011:i:1:p:48-57); [CREATES WP](https://repec.econ.au.dk/repec/creates/rp/07/rp07_09.pdf)
- Kambouroudis, McMillan & Tsakou extend HAR with implied vol, a leverage effect, overnight returns and vol-of-vol. Implied vol is important, and overnight returns improve accuracy for most major indices. — [Stirling repository](https://www.stir.ac.uk/research/hub/file/1738768)
- Lyócsa & Todorova (2020, *International Journal of Forecasting*), on S&P 500 constituents: a stock's own overnight squared return performs poorly, but market-level non-trading-period volatility (proxied by S&P E-mini futures) significantly improves fit and forecast accuracy. — [EconPapers](https://econpapers.repec.org/RePEc:eee:intfor:v:36:y:2020:i:2:p:628-645)
- Corsi & Renò (2012) add negative-return (leverage) terms to HAR and improve S&P 500 volatility forecasts. Regime-switching HAR variants (THAR, STHAR) also beat linear HAR in a 2025 comparison. — [arXiv 2510.03236 (secondary)](https://arxiv.org/html/2510.03236v1)
- Bollerslev, Tauchen & Zhou (*RFS* 22(11), 2009): the variance risk premium (implied minus realized variance) explains a nontrivial share of post-1990 market returns. Predictability is strongest at the quarterly horizon, not daily. — [EconPapers](https://econpapers.repec.org/RePEc:oup:rfinst:v:22:y:2009:i:11:p:4463-4492)
- Savor & Wilson (*JFQA* 48(2), 2013), U.S. stocks 1958–2009:
  - Excess returns average 11.4bp on scheduled CPI/PPI/employment/FOMC days versus 1.1bp on other days.
  - Volatility is similar on the two kinds of day, so the Sharpe ratio is about ten times higher on announcement days.
  - [IDEAS](https://ideas.repec.org/a/cup/jfinqa/v48y2013i02p343-375_00.html); [Wharton draft](https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Draft20111128p_edited.pdf)
  - Ernst, Gilbert & Hrdlicka (preliminary) argue this is partly a selection effect. — [AEA 2022 paper](https://aeaweb.org/conference/2022/preliminary/paper/ktNibY2Y)
- Lucca & Moench (*JF* 70(1), 2015): from 1994 to 2011, the S&P 500 rose on average 49bp in the 24 hours before scheduled FOMC announcements. — [NY Fed SR512](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr512.pdf); [EconPapers](https://econpapers.repec.org/RePEc:bla:jfinan:v:70:y:2015:i:1:p:329-371)
- Kurov, Wolfe & Gilbert ("The Disappearing Pre-FOMC Announcement Drift", *Finance Research Letters* 2021): the drift essentially disappeared after 2015, both for meetings with and without press conferences. Ben Dor & Rosa (2019) reportedly find no change, so this is contested. — [Skidmore PDF](https://www.skidmore.edu/economics/documents/KurovWolfeGilbert-TheDisappearingPre-FOMC-Announce-Drift-200914.pdf); [IDEAS](https://ideas.repec.org/a/eee/finlet/v40y2021ics1544612320315956.html)

### Inferences
- The highest-value additions for the 1-day width (p05–p95, expected move, ES) are, in rough order:
  1. The overnight futures move and overnight futures realized range or volatility up to 4:20am (the Lyócsa–Todorova market-level overnight-vol result).
  2. The 4:20am overnight VIX value. VIX is disseminated from 3:15am ET; VXN's overnight availability is unverified.
  3. The prior close's VIX1D, risk-premium adjusted. At the 4:15pm close it is weighted toward the next day's expiries, so it is effectively a next-session vol forecast.
  4. HAR-style realized-vol components (daily, weekly, monthly) and negative-return terms.
- The app currently computes only a 20-day rolling SD and VIX/VXN levels. It has no VIX1D, no HAR components and no overnight vol.
- VIX1D is RTH-only, so at 4:25am only the previous 4:15pm value exists, and it cannot reflect overnight news. The overnight VIX update is the fresher implied-vol signal.
- VIX1D only exists from April 2023 (about 3.5 years), which is too short for a long Chronos-2 context. It must be handled as a short-history covariate. The app's 75% historical-coverage filter would drop it. Options: backfill with a proxy, such as a HAR fit or a VIX9D/VIX blend, or use it in a separate recalibration layer.
- Use scheduled-event dates (FOMC, CPI, NFP; mega-cap earnings dates for the Nasdaq-100) as known-future categorical covariates. They are deterministic and Chronos-2 explicitly supports this. The evidence for a mean effect (Savor–Wilson; pre-FOMC drift) is old or decayed, so expect any gain to show up in width, if at all, and test it rather than assume it.
- The variance risk premium predicts at quarterly horizons. It is at most relevant to the 63-day horizon, not the 1-day forecast.

### Gaps
- No source found on whether VXN is disseminated overnight (GTH) or whether Yahoo serves overnight VIX values. Needs a direct check, because Yahoo may show only RTH values.
- No peer-reviewed study found quantifying the incremental value of VIX9D or straddle-implied moves (0DTE/1DTE ATM straddle at the prior close) over VIX1D for next-day QQQ/NDX realized vol. Albers and Zhang et al. are S&P 500 results.
- No source found on realized-vol uplift on CPI/FOMC days in 2022–2026, or on the index-level effect of Nasdaq-100 mega-cap earnings on overnight gaps.
- The exact VIX1D risk-premium correction formula in Albers (2025) was not visible in the abstract.

## 4. Cross-asset and flow signals: overnight Asia/Europe, Treasuries, USD/JPY, oil, Bitcoin, intraday momentum, leveraged-ETF rebalancing

### Takeaway
Cross-market mean predictability runs mainly from the US to other markets, not the reverse. Lagged non-US returns have little predictive power for US returns, and Bitcoin's mean-return links to US tech are weak and unstable. By 4:20am, overseas sessions are largely already priced into NQ/ES futures. Their main value is as inputs to overnight volatility and regime estimates, not as separate return predictors. Leveraged-ETF rebalancing is mechanically pro-cyclical, but well-identified studies find its effect on late-day returns and volatility is economically small once fund flows are accounted for.

### Cited Findings
- Rapach, Strauss & Zhou (*JF* 2013): lagged U.S. returns significantly predict returns in many non-US industrialized countries. Lagged non-US returns show limited ability to predict U.S. returns. — [CFA Institute digest](https://rpc.cfainstitute.org/research/cfa-digest/2013/11/international-stock-return-predictability-what-is-the-role-of-the-united-states-digest-summary)
- The European-open drift in US futures is attributed to dealer inventory management, not to information flowing from overseas, and it has since vanished (see Section 1). — [NY Fed SR917](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr917.pdf); [Liberty Street 2026](https://libertystreeteconomics.newyorkfed.org/2026/07/the-disappearing-overnight-drift/)
- Bitcoin:
  - Bouri, Gupta, Lau & Roubaud (2019, daily data 2011–2019): Granger causality in mean between Bitcoin and US tech indices is generally insignificant. There is some evidence in quantiles and variance, and US stocks drive Bitcoin rather than the reverse. — [IDEAS](https://ideas.repec.org/p/pre/wpaper/201971.html)
  - Bouri et al. (2023, *Financial Innovation*): Bitcoin relates inversely to S&P 500 and sector realized volatility, in sample and out of sample. This is a volatility result, not next-day returns. — [Springer](https://link.springer.com/10.1186/s40854-023-00464-8)
  - A 2013–2024 VAR/Granger thesis reports two-way crypto–S&P/Nasdaq causality that stopped from 2018 onward. — [TalTech thesis](https://digikogu.taltech.ee/en/Download/057d03bb-50cb-4785-80fa-9dddeafc6d10)
- Intraday momentum (first half-hour, including the overnight move, predicts the last half-hour), robust 1974–2020, and linked to option-dealer and LETF gamma hedging. — [Gao et al. 2018](https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414); [Baltussen et al. 2021](https://econpapers.repec.org/RePEc:eee:jfinec:v:142:y:2021:i:1:p:377-403)
- Cheng & Madhavan (2009, *Journal of Investment Management* 7(4)): leveraged and inverse ETF rebalancing is always in the same direction as the index's daily move, and aggregate LETF rebalancing demand puts price pressure on end-of-day index returns. — [JOIM](https://joim.com/dynamics-leveraged-inverse-exchange-traded-funds)
- A Federal Reserve FEDS note (2013-48) on LETFs as "portfolio insurers" cites an estimate that a 1% S&P 500 move produces LETF rebalancing demand that raises an average large-cap stock's price by 6.9bp and its daily volatility by 22.7bp. The search summary did not make clear which paper the estimate originally comes from. — [FEDS 2013-48](https://www.federalreserve.gov/pubs/feds/2013/201348/)
- Ivanov & Lenkey (*Journal of Financial Markets* 41, 2018; US equity LETFs 2006–2014): investor capital flows substantially offset rebalancing demand, even under severe stress. Controlling for flows and risk factors, rebalancing has an "economically insignificant" effect on late-day returns and volatility. — [IDEAS](https://ideas.repec.org/a/eee/finmar/v41y2018icp36-56.html); [Fed FEDS 2014](https://www.federalreserve.gov/econres/feds/are-concerns-about-leveraged-etfs-overblown.htm)
- Lenkey (2024 survey, *Quantitative Finance and Economics*): many studies report significant rebalancing–late-day links, but most have serious methodological problems and the economic effects appear small. — [AIMS Press](https://www.aimspress.com/article/id/676a38d5ba35de0ad141c3c3)
- Zhao (arXiv 2608.03703, Aug 2026), "Preying on Leveraged ETFs", Korean market 2026: speculators front-run LETF closing rebalances, so stocks tracked by LETFs gave back about three quarters of their reaction to pre-open US news by the next close and kept oscillating for days. The estimated effect is that SK Hynix's annualized volatility rose from 100.0% to 136.7% over nine weeks. This covers single-stock Korean LETFs, not TQQQ. — [arXiv](https://arxiv.org/abs/2608.03703)

### Inferences
- For a 4:25am forecast, overnight Asian and European index moves, USD/JPY, oil and Bitcoin should be judged on whether they add information beyond the 4:20am NQ/ES futures move and the overnight VIX. Their price information is mostly already in the futures. Plausible incremental uses:
  - Cross-asset overnight realized volatility, as a regime or width input.
  - Stress flags such as a large overnight USD/JPY move (a carry-unwind indicator).
  - Treat both as hypotheses for ablation, not established predictors.
- The app currently uses close-to-close DXY, WTI and 10y yield at the prior US close, and the futures daily return. These carry little documented next-day mean information. Their main role in Chronos-2 is as additional context, which can hurt; see Section 7 on "noisy context".
- The Zhao (2026) result suggests a mechanism that could matter on extreme days: closing-flow front-running with next-day reversal when LETF assets are large relative to the underlying. For QQQ this is likely small relative to Nasdaq-100 liquidity, consistent with Ivanov & Lenkey, but it is a reason to let tail width depend on large prior-day moves.

### Gaps
- No out-of-sample studies found for Treasury-yield, USD/JPY or oil overnight moves predicting next-session US index returns or volatility after 2015.
- An Erasmus University paper reportedly found European and Asian overnight price patterns help forecast US opening gaps, but its out-of-sample results and exact citation could not be verified.
- No estimate found of current TQQQ/SQQQ rebalancing notional relative to QQQ/NQ closing volume (2024–2026).

## 5. How leveraged ETFs (daily 3x reset, volatility decay, end-of-day rebalancing) change the forecasting problem

### Takeaway
A 3x daily-reset ETF's 1-day return is almost exactly 3× the underlying's daily return (less fees and financing), so the 1-day forecast should be built on QQQ or NQ and mapped to TQQQ. Multi-day horizons are path-dependent. The compounded LETF return depends on the underlying's realized variance (volatility drag), so 5–252-day TQQQ distributions should be simulated from underlying daily paths rather than taken from TQQQ's own history.

### Cited Findings
- Daily-reset LETF returns can diverge significantly from the leverage multiple times the index return over holding periods longer than one day (Cheng & Madhavan 2009; Jarrow 2010; Avellaneda & Zhang 2009). — [FEDS 2013-48](https://www.federalreserve.gov/pubs/feds/2013/201348/); [JOIM](https://joim.com/dynamics-leveraged-inverse-exchange-traded-funds)
- Avellaneda & Zhang derive a path-dependence formula for LETF value. Underperformance relative to the multiple grows with realized volatility, because daily rebalancing in volatile markets causes larger drag. — [Avellaneda & Zhang (NYU)](https://math.nyu.edu/~avellane/LeveragedETF20090515.pdf)
- Rebalancing direction always follows the day's move, whether the fund is leveraged long or inverse. — [JOIM](https://joim.com/dynamics-leveraged-inverse-exchange-traded-funds)
- Flows offset rebalancing, and the late-day price impact is economically small. — [Ivanov & Lenkey 2018](https://ideas.repec.org/a/eee/finmar/v41y2018icp36-56.html); [Lenkey 2024](https://www.aimspress.com/article/id/676a38d5ba35de0ad141c3c3)

### Inferences
- Avellaneda–Zhang, ignoring financing: L_T/L_0 ≈ (S_T/S_0)^β · exp(−(β²−β)/2 · ∫σ²dt). For β=3 the drag term is 3σ²·T. At 25% annualized QQQ volatility this is about 0.1875, roughly −19% per year in log terms, before fees and financing. At 40% volatility it is about −48% per year. So TQQQ's 63- and 252-day distributions depend mostly on the forecast path of QQQ variance, not on TQQQ's mean. A 5-session block bootstrap of TQQQ's own standardized returns captures this only if TQQQ's history covers the relevant volatility regimes. TQQQ has existed only since 2010.
- Recommended structure (to be checked by ablation):
  1. Forecast QQQ (or NQ) daily log returns. QQQ history runs from 1999, roughly 6,700 sessions versus about 4,200 for TQQQ, which better fills Chronos-2's long context.
  2. Map daily simple returns to TQQQ via r_TQQQ ≈ 3·r_QQQ − (fees + 2·financing)/252.
  3. Compound simulated daily paths for multi-day horizons.
  This makes volatility decay explicit and lets SOXL, TNA and the others share the same machinery.
- Rebalancing demand per dollar of LETF assets scales with (β²−β): 6 for 3x long and 12 for −3x inverse. SQQQ therefore creates twice TQQQ's rebalancing demand per dollar, though flows offset much of it (Ivanov & Lenkey).
- On a 4:20am gap, TQQQ's 1-day gap risk is about 3× QQQ's gap, and a TQQQ return below −33.3% would require a −11.1% QQQ day. Gap-risk metrics should come from the underlying's overnight distribution × 3.

### Gaps
- No source fetched gives TQQQ's actual tracking error versus 3×QQQ daily, or its current swap-financing costs. These should be measured from the user's own data.
- No study found that compares forecasting LETF distributions directly versus via the underlying.

## 6. Direction predictability: realistic hit rates and Brier scores; is the edge in width rather than mean?

### Takeaway
Next-day direction for index ETFs is close to unpredictable. Credible out-of-sample hit rates sit within a few points of the base rate, and a preregistered 2025–2026 test on NQ/ES found that even a replicated daily rank signal did not beat always-long. Theory (Christoffersen–Diebold) and the evidence in Section 3 put the reliable edge in volatility. Any sign predictability that exists comes mostly through volatility dynamics combined with a positive mean. So the probability of a positive return should be expected to stay near 50–55%, and the Brier score will barely move.

### Cited Findings
- Christoffersen & Diebold (*Management Science* 52(8), 2006):
  - Little or no conditional-mean dependence is fully consistent with significant sign dependence driven by volatility dependence, as long as the expected return is nonzero.
  - Sign dependence is hard to detect with sign autocorrelations, runs tests or market-timing tests.
  - It is less likely at very high (e.g., daily) and very low frequencies than at intermediate horizons.
  - Sign dependence does not imply inefficiency.
  - [NBER w10009](https://www.nber.org/papers/w10009); [EconPapers](https://econpapers.repec.org/RePEc:inm:ormnsc:v:52:y:2006:i:8:p:1273-1287)
- Upadhyay (arXiv 2611.12141, Nov 2026), preregistered daily test on NQ/ES:
  - The blind sample was 349 NQ sessions and 332 ES sessions (2025-01-02 to 2026-05-08), with a hold-out of 119 NQ sessions (to 2026-10-29).
  - Kronos-small's daily rank signal replicated on blind NQ (IC +0.116, one-sided p=0.015). But trading it earned +$4,682, versus +$13,587 for always-long and a random-direction 95th percentile of $16,219, so it failed.
  - On the NQ hold-out the signal vanished (IC −0.008). TiRex's faded signal flipped sign.
  - [arXiv](https://arxiv.org/abs/2611.12141)
- Hit rates in academic theses are typically near chance. An LSTM on the S&P 500, FTSE 100 and other indices beat random guessing by up to 5 points, and some above-50% models were simply overfit to predicting "up". — [LUT thesis](https://lutpub.lut.fi/bitstream/10024/162699/1/Progradu_Harkonen_Emilia.pdf)
- A 2025 paper argues that 50% is the wrong yardstick for index direction, because upward drift lets "always up" beat 50%. Models should be compared against the majority-class rate. — [Journal of Intelligent Systems 2025](https://www.degruyterbrill.com/document/doi/10.1515/jisys-2025-0027/pdf)

### Inferences
- Brier-score improvements over climatology will be tiny, and detecting them takes a long sample. My own derivation: let the true P(up) be 0.5+e_t with SD σ_e, and compare the forecast p_t = 0.5+e_t against a constant 0.5. The expected per-day Brier gain is σ_e², the per-day SD of the gain is about σ_e, so the t-statistic is about √n·σ_e. Reaching t≈2 needs:
  - σ_e=0.02 (probabilities mostly between 0.48 and 0.52): n≈10,000 sessions, about 40 years.
  - σ_e=0.05: n≈1,600 sessions, about 6.3 years.
- For hit rates: detecting 52% vs. 50% at 5% two-sided with 80% power needs n≈(1.96+0.84)²·0.25/0.02²≈4,900 sessions, about 19.5 years.
- The Brier baseline in walk_forward.py should be the trailing climatological frequency of up-days, not 0.5 and not just the bootstrap.
- P(TQQQ>0) moves mechanically with the 4:20am futures move, because part of the day is already realized. A +1% NQ move by 4:20am pushes P(TQQQ close-to-close > 0) well above 50%, even with no predictability of the rest of the day. This is the one place where a large, legitimate Brier gain is plausible. It is a partial-observation effect, not alpha, and should be reported that way.

### Gaps
- No peer-reviewed, post-2015 study found reporting out-of-sample Brier scores or log scores for next-day SPY/QQQ direction.
- No study found reporting how much the 4:20am futures move raises P(sign of close-to-close return) accuracy. This is directly measurable on the user's data.

## 7. Chronos-2: covariate interface, group attention, context and quantiles; TSFM evidence on financial returns; look-ahead risk and aligning a 4:20am snapshot

### Takeaway
Chronos-2 natively supports past-only and known-future covariates, real or categorical, through group attention. It has an 8,192-step context, a prediction length up to 1,024, and 21 output quantiles (0.01–0.99). It was trained on no financial data, and its covariate and multivariate pretraining data are entirely synthetic. Independent 2025–2026 studies find that zero-shot TSFMs, including Chronos-2, do not beat no-change or random-walk baselines on returns. Their apparent volatility skill is largely reproduced by EWMA/HAR or removed by recalibration. The 4:20am overnight information is "known" for the first forecast step only. It must enter either as a known-future covariate for step 1, with a matching historical series computed at the same clock time, or through an explicit decomposition of the target into the part already realized by 4:20am and the remainder.

### Cited Findings
- Chronos-2 architecture and covariates (Ansari et al., arXiv 2510.15821, Oct 2025):
  - Input format: historical inputs stack the target(s) and covariates at each time step. Future inputs hold known-future covariate values. Future entries for targets and past-only covariates are set to missing and handled via a binary mask, with missing values zero-filled after masking. Predictions for covariate dimensions are discarded, and the loss is on targets only.
  - Categorical covariates use target encoding for univariate targets and ordinal encoding for multivariate targets.
  - Group attention mixes information across series with the same group ID at each patch index, without positional embeddings. In covariate mode, the target, past-only covariates and known covariates of one task share a group ID.
  - Context: pretraining used a 2,048 maximum, and long-context post-training extended it to 8,192.
  - Output: 21 quantiles {0.01, 0.05, 0.1, …, 0.9, 0.95, 0.99}, trained with pinball loss.
  - Scaling: each dimension is standardized by its historical mean and SD, then passed through sinh⁻¹. Future values use the historical μ and σ.
  - Training data: real univariate data (Electricity, M4, Solar, Taxi, Weatherbench, Buildings900K, cloud) plus synthetic data. All multivariate and covariate training data is synthetic, and no financial data is mentioned.
  - Results: Chronos-2's largest in-context-learning gains are on the 42-task covariate subset of fev-bench, but there is no finance case study. Gains from multivariate ICL are "modest".
  - [arXiv HTML](https://arxiv.org/html/2510.15821v1); [abstract](https://arxiv.org/abs/2510.15821)
- Model card: 120M parameters, encoder-only (T5-inspired), maximum context 8,192, maximum prediction length 1,024. Supports past-only and known-future real and categorical covariates and cross-learning. Usage is `Chronos2Pipeline.from_pretrained("amazon/chronos-2")` and `predict_df(context_df, future_df=..., prediction_length=..., quantile_levels=..., id_column=..., timestamp_column=..., target=...)`, where `future_df` holds future covariate values. — [Hugging Face amazon/chronos-2](https://huggingface.co/amazon/chronos-2)
- Upadhyay (arXiv 2611.12141, Nov 2026), preregistered; 1-minute NQ/ES at 5–120-minute horizons; Chronos-Bolt, Chronos-2, TimesFM 2.5, Moirai 2.0, TiRex and Kronos:
  - 0 of 160 model × representation × horizon × market cells beat no-change. Hansen SPA p=1.000. The retrospective hold-out gave 0 of 120.
  - Input representations (log returns, volatility-standardized returns, volume clock) changed forecast magnitude but not accuracy.
  - The one TSFM that beat HAR for 5-minute volatility did not beat the EWMA its own input contained.
  - On planted sign-persistence signals, Chronos-2 detected 0/11 at NQ 5m with δ=0.2 and 0/11 at δ=0.3, versus 10–11/11 for an oracle and 9–11/11 for ridge regression.
  - Below δ≈0.1, even the oracle rarely detects the signal with about 2,000 origins.
  - [arXiv](https://arxiv.org/abs/2611.12141)
- Brini (arXiv 2607.05291, 2026), realized volatility for 50 assets (40 US equities, 5 FX, 5 futures including E-mini S&P 500); horizons 1, 5 and 22 days; QLIKE loss; 9 zero-shot TSFMs (Chronos-2 not evaluated) versus HAR-family models:
  - Pooled QLIKE favors several TSFMs, but this is driven by a few high-volatility assets.
  - On asset-averaged QLIKE ratios to Log-HAR, only TTM wins at every horizon (0.982, 0.986, 0.987), an edge of about 1.3–1.8%.
  - Mincer–Zarnowitz efficiency at h=1 is rejected for 88% of assets for TTM versus 2% for Log-HAR.
  - An equal-weight TTM + Log-HAR combination enters the 10% model confidence set for 98–100% of assets.
  - Pretraining contamination cannot be ruled out.
  - [arXiv](https://arxiv.org/html/2607.05291v1)
- Rahimikia, Ni & Wang (arXiv 2511.18578, v2 Nov 2026), large-scale global daily excess returns: "Off-the-shelf TSFMs generally perform poorly". Finance-native pretraining helps some specifications, but TSFMs do not consistently beat strong benchmarks. — [arXiv](https://arxiv.org/abs/2511.18578)
- Noguer i Alonso & Franklin (arXiv 2606.27100, June 2026), five US stocks (AAPL, AMZN, GOOG, JPM, META), comparing TimeGPT, TimesFM-2.5, Moirai-2.0, Chronos and Chronos-2 against from-scratch nets and a random walk: pretrained models win 8 of 10 tasks, but gains over the random walk are "small and sparse". One-sided DM rejects only for Chronos on AMZN and Moirai-2.0 on GOOG. — [arXiv](https://arxiv.org/abs/2606.27100)
- Das, Goyal & Yadav (arXiv 2605.21504, May 2026), Chronos-2 with monthly rolling evaluation 2000–2025: multivariate inputs beat univariate for Magnificent-7 equities and Treasury rates (RMSE/MAPE). Mixing equities and rates in one panel reduced accuracy, which the authors attribute to "noisy context". — [arXiv](https://arxiv.org/abs/2605.21504)
- Kronos is a finance-native foundation model pretrained on more than 12 billion K-line records. In Upadhyay's tests its zero-shot and fine-tuned variants still did not beat no-change. — [Kronos arXiv](https://arxiv.org/abs/2508.02739); [Upadhyay](https://arxiv.org/abs/2611.12141)

### Inferences
- Current app: all 20+ market covariates are past-only at the prior close. Only calendar sin/cos features are known-future. Chronos-2 therefore sees no information after the prior close.
- Ways to inject the 4:20am snapshot without look-ahead:
  - **(A) Known-future covariate for step 1.** Define x_t = log(NQ at 4:20am ET on day t ÷ NQ at 4:00pm ET on day t−1) and pass it for history (every past session, same clock time) and as the step-1 future value. Steps 2 and later are unknown and must be missing. The paper's masking design supports missing future entries, but whether `predict_quantiles` / `predict_df` accept NaN in `future_covariates` should be verified in the installed `chronos-forecasting` version. If not, run a separate 1-step call with the overnight covariate, and keep the 64-step call for longer horizons.
  - **(B) Explicit decomposition (more robust).** Forecast only the remaining return R_rem = log(close_t / P_4:20am,t) with Chronos-2. For history, use the target series built at the same 4:20am stamp. Then add the observed partial return deterministically (×3 for TQQQ, plus basis noise). This does not rely on Chronos-2 learning the near-1:1 (3:1) mapping in context, which is doubtful given its failure to pick up planted signals that ridge regression found (Upadhyay).
  - **(C) Recalibration layer.** Keep Chronos-2 as is and post-adjust its 1-day quantiles with a small, separately validated model, e.g. location shift = 3 × overnight move and scale = f(overnight VIX change, overnight futures range). This matches Brini's finding that recalibration and HAR combinations do the heavy lifting.
- Look-ahead and alignment rules:
  1. Every historical covariate value must be computable at 4:20am ET on that date, using the same vendor and the same clock time. Never pair a daily bar's close, high, low or volume for day t with the forecast for day t.
  2. Check the Yahoo NQ=F/ES=F daily-bar convention. Futures daily bars typically span 6pm(t−1) to 5pm(t), so the "close" for t is after the 4pm ETF close. That is legitimate for forecasting t+1, but the series must not include a partial bar for the forecast date. The app's reindex to the target index appears to drop it. The walk-forward should apply the same truncation at each origin.
  3. Holidays and early closes: the overnight window before a Monday or after a holiday spans more calendar time. Add a known-future "hours since last close" covariate.
  4. Daylight-saving shifts between US, European and Asian sessions move the clock relationship of overseas opens to 4:20am ET.
  5. Survivorship and revision issues with Yahoo adjusted closes (dividends, splits) should be pinned: store the snapshot used at each origin.
- Covariate parsimony: the evidence argues for fewer, high-signal covariates. Das et al. found mixed panels hurt ("noisy context"), and Chronos-2's covariate skill comes from synthetic pretraining, not finance. The app's `confidence_score = len(covariates)/22` rewards more covariates, which the evidence does not support. Use ablation instead (Section 8).
- Because Chronos-2 standardizes each dimension by its historical μ and σ and applies sinh⁻¹, the 8,192-session context mixes very different volatility regimes (e.g., 2000–2002, 2008, 2020, 2022). A shorter context, or volatility-standardized targets (returns ÷ EWMA σ, with σ restored afterwards), should be tested. Upadhyay warns that standardization can "inject" an EWMA and create apparent skill, so always compare against that EWMA itself.

### Gaps
- No study found that evaluates Chronos-2 with known-future covariates on daily index-ETF returns or 1-day return distributions (CRPS or coverage), against GARCH/HAR-t baselines.
- No source found confirming that Chronos-2's Python API accepts NaN or partially missing known-future covariates.
- Chronos-2's patch size and how a 1-step known-future value is represented inside a patch (which affects how much one step's covariate influences the first output) were not stated in the parts of the paper read.
- No source found on Yahoo's exact timestamping of futures daily bars.

## 8. Evaluation: proper scoring rules, calibration tests, forecast-comparison tests, ablation design, sample sizes

### Takeaway
Judge a new data source by paired, out-of-sample differences in strictly proper scores, computed on the same origins with and without the source:
- CRPS, approximated from all 21 quantiles, as the primary score.
- Pinball loss per quantile for tail diagnostics.
- The Brier score versus climatology for P(>0).

Test the differences with HAC Diebold–Mariano / Giacomini–White tests (fixed-smoothing variants for small samples). Check calibration with PIT histograms and Kupiec/Christoffersen tests at p01/p05/p95/p99. Control for multiple ablations with SPA or MCS. Include an EWMA/HAR-scaled baseline, not only the block bootstrap. Expect 1-day volatility gains to be detectable in a few years of data, mean or direction gains to need decades, and 63- or 252-day horizons to be essentially untestable given overlapping windows.

### Cited Findings
- Strictly proper scoring rules (Gneiting & Raftery, *JASA* 102(477), 2007): the expected score is optimized only by the true distribution. The paper also covers quantile and interval scores for interval estimation. — [DTIC tech report](https://apps.dtic.mil/sti/html/tr/ADA459827/index.html)
- Gneiting, Balabdaoui & Raftery (*JRSSB* 2007), "Probabilistic forecasts, calibration and sharpness": the goal is to maximize sharpness subject to calibration, and PIT histograms are the standard diagnostic. — [UW PDF](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jrssb.pdf)
- Christoffersen (*International Economic Review* 39(4), 1998):
  - Kupiec's unconditional-coverage likelihood-ratio test (χ²(1)) only counts exceptions.
  - Christoffersen adds an independence test (first-order Markov, χ²(1)) and a joint conditional-coverage test (χ²(2)).
  - Intervals that ignore variance dynamics can pass unconditional coverage yet fail conditional coverage.
  - [IDEAS](https://ideas.repec.org/a/ier/iecrev/v39y1998i4p841-62.html); [NY Fed EPR (Lopez 1998, VaR evaluation)](https://www.newyorkfed.org/research/epr/98v04n3/9810lope.pdf)
- These coverage tests have low power in simulations (per Christoffersen 2004 and Berkowitz et al. 2011). — [Candelon et al. (HAL)](https://halshs.archives-ouvertes.fr/halshs-00618467/file/IF2011.pdf)
- Diebold–Mariano and Giacomini–White tests:
  - DM can be badly size-distorted in small samples. Fixed-smoothing asymptotics (Coroneo & Iacone) give correctly sized tests with few out-of-sample points. — [Coroneo & Iacone (JAE)](https://eprints.whiterose.ac.uk/155897/15/jae.2756.pdf)
  - DM power falls as loss differentials become more autocorrelated. DM is an average test and loses power when superiority holds only in part of the sample (the case Giacomini–Rossi fluctuation tests address). — [arXiv 2405.11954](https://arxiv.org/html/2405.11954v1)
  - The Giacomini–White conditional predictive ability test covers point, interval, probability and density forecasts. — [Econometrica 2006](https://econometricsociety.org/publications/econometrica/2006/11/01/tests-conditional-predictive-ability)
  - In McCracken's simulations it can be correctly sized but typically has low power. — [St. Louis Fed WP 2020-050](https://s3.amazonaws.com/real.stlouisfed.org/wp/2020/2020-050.pdf)
- Amisano & Giacomini (*JBES* 25, 2007): an out-of-sample weighted likelihood-ratio (log-score) test for comparing density forecasts. Weights can emphasize the tails. It is valid for nested or non-nested and parametric or nonparametric forecasters. — [EconPapers](https://econpapers.repec.org/RePEc:bes:jnlbes:v:25:y:2007:p:177-190)
- Multiplicity and detection limits in practice:
  - Upadhyay preregistered the analysis plan and smallest meaningful improvement (loss ratio ≤0.995 with CI upper bound <1), used a Hansen SPA test across models, and reported planted-signal power curves. — [arXiv 2611.12141](https://arxiv.org/abs/2611.12141)
  - Brini used the model confidence set and pairwise DM win rates, and found TSFM vs. Log-HAR differences of about 1–2% in QLIKE, with both often inside the MCS. — [arXiv 2607.05291](https://arxiv.org/html/2607.05291v1)

### Inferences
- **Gaps in the current walk_forward.py.**
  - It scores only q10, q50 and q90, so improvements at p01, p05, p95 and p99 (which drive ES, gap risk and the expected move) go unmeasured. Approximate CRPS as 2 × the mean pinball loss over all 21 levels, using the standard identity CRPS = 2∫₀¹ QS_τ dτ. Report per-quantile pinball separately for tails.
  - Add Kupiec and Christoffersen tests at 1%, 5%, 95% and 99%, PIT histograms, and the width of the central 90% interval (sharpness).
  - For P(>0), report the Brier score and Brier skill against trailing climatology, plus a reliability diagram.
- **Baselines.** The baseline should include:
  - The current historical block bootstrap.
  - EWMA-σ (or HAR-RV) × Student-t, the control that killed apparent TSFM volatility skill in Upadhyay.
  - The current Chronos-2 configuration.
  For the overnight-input question specifically, add a "partial-information naive" baseline: unconditional remainder-of-day distribution plus the observed 3 × overnight move. This shows how much of any gain is pure arithmetic rather than model skill.
- **Ablation design.**
  - Use one fixed set of origins and identical code paths. Toggle a single source at a time: overnight futures move, overnight futures range, overnight VIX, VIX1D, event flags, cross-asset block, TQQQ pre-market tape.
  - Also run leave-one-out from the full set.
  - Compute paired daily loss differentials d_t = L_base − L_new. Use DM with Newey–West HAC (lag ≥ h−1 for h-day horizons), or fixed-smoothing DM for short samples. Use GW with instruments such as the VIX regime to see when a source helps.
  - Correct for multiplicity with SPA or MCS. Fix the list of sources and metrics before looking at results.
- **Overlapping horizons.** Daily origins with 5/21/63/252-day horizons overlap heavily. The effective number of independent observations is about N/h. With about 15 years (about 3,800 sessions), that is only about 15 independent 252-day outcomes and about 60 independent 63-day outcomes, too few to separate models. Focus formal tests on the 1-day horizon, and secondarily on 5 days. Treat 63- and 252-day results as descriptive only.
- **Rough sample-size guide** (my calculations, not sourced):
  - 1-day direction: thousands of sessions (Section 6).
  - 1-day volatility and quantile width: much less, because vol is persistent and inputs such as the overnight move or VIX shift interval width substantially. Gains of 1–2% in QLIKE or CRPS are typical of the literature and may need several years to separate (Brini).
  - The partial-information effect of the 4:20am futures move should be large and detectable within a year, because it removes realized variance from the 1-day target.
- **New-source history.** For a source whose history must be built from archived 4:20am snapshots (only about 500 sessions from Yahoo hourly bars), a backtest will be underpowered. Pair a pre-specified prospective forward test (log every 4:25am forecast with and without the source) with the historical backtest, and accumulate evidence over time.

### Gaps
- No source fetched gives formal power calculations for DM tests on CRPS or pinball differentials for daily equity-return quantile forecasts. The sample-size numbers above are my own calculations.
- No source checked on expected-shortfall backtests (e.g., Acerbi–Székely, or elicitability of joint VaR and ES scores such as Fissler–Ziegel). These would be needed to evaluate the app's expected-shortfall output with a proper score.
