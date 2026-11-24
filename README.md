# Meridian Quant — Chronos-2

Meridian Quant is a probabilistic market-forecasting application. Its numerical forecasting path uses Amazon Chronos-2 rather than a chat-completion LLM.

## Architecture

- **Node/React application:** UI, scheduling, persistence, deterministic probability audit.
- **Python inference service:** Amazon Chronos-2, historical-market feature construction, future trading-calendar covariates, quantile forecasts and scenario simulation.
- **Market data:** Yahoo Finance through yfinance for initial personal/research use. This is an unofficial adapter, not a licensed real-time feed.
- **Risk:** Kelly sizing stays at 0 and strategy allocation stays cash-defensive until instrument-specific walk-forward tests demonstrate acceptable out-of-sample calibration.

See [CHRONOS_DEPLOYMENT.md](CHRONOS_DEPLOYMENT.md) for Windows, Docker and Cloud Run setup.

## Local quick start

### Terminal 1 — Chronos-2 service (Windows PowerShell)

~~~powershell
cd chronos_service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
~~~

The first start downloads the public model weights from Hugging Face and loads them into memory.

### Terminal 2 — Node app

~~~powershell
$env:CHRONOS_SERVICE_URL = "http://127.0.0.1:8001"
npm install
npm run dev
~~~

Open the Vite URL shown in the terminal. The **Model & Data** tab shows whether the Python model service is reachable and loaded.

## Forecast method

- Direct daily 10th–90th percentile forecasts from Chronos-2 through its model-native horizon (normally 64 sessions).
- Deterministic calendar covariates for future Nasdaq trading sessions.
- Conservative historical standardized-innovation extension beyond the native horizon, rather than claiming Chronos-2 directly predicts a full trading year.
- Five-session circular block bootstrap to preserve short-run dependence in simulated paths.
- 10,000 paths by default, aggregated into the app's 1D, 5D, 21D, 63D and 252D distributions.
- Existing TypeScript probability/moment/CDF reconciliation audit.

## Forecast JSON contract

Every forecast record is validated before it is saved or published. If it fails, the run errors out (the scheduler records `Failed … failed JSON Schema validation: <path> <reason>`) and nothing invalid is written to `data/forecasts.json`.

- **Schema:** [`schemas/forecast-record.schema.json`](schemas/forecast-record.schema.json) (JSON Schema draft 2020-12). It describes payload `schema_version` `1.2.0` and mirrors `src/types/forecast.ts`. Objects are closed (`additionalProperties: false`), enums are explicit, probabilities are bounded to [0, 1], each horizon has exactly 10 bins with its `trading_days` fixed (1/5/21/63/252), and timestamps must be RFC 3339 with an offset.
- **Semantic rules** that JSON Schema cannot express are in [`server/forecastValidation.ts`](server/forecastValidation.ts): probability mass sums to 1, each CDF equals underflow plus cumulative bin mass, bins are contiguous, quantiles are ordered (p01 ≤ … ≤ p99), expected shortfall ≤ p05, strategy weights sum to 1, the audit covers every horizon exactly once and passed, and the snapshot and payload symbols match.
- **Example:** [`schemas/examples/forecast-record.example.json`](schemas/examples/forecast-record.example.json), regenerated with `npm run schema:example`.

~~~bash
npm test                                    # schema + semantic rule tests
npm run validate:forecasts                  # validate data/forecasts.json
npm run validate:forecasts -- path/to/record.json other.json
~~~

At runtime, `GET /api/schemas/forecast-record` serves the schema, and `POST /api/forecasts/validate` with a record as the body returns `{ valid, schema_id, issues[] }` (HTTP 422 when invalid). Python consumers can validate with `jsonschema` (see `chronos_service/test_forecast_schema.py`, which cross-checks the schema with a second implementation).

**Versions:** each record is validated against the schema for the `payload.schema_version` it declares. Earlier contracts are frozen under [`schemas/history/`](schemas/history/) (currently `1.1.0`), so stored records stay valid and can still be re-saved after verification. `1.2.0` added `snapshot.vix_overnight_level`, `snapshot.rvx_level` and `snapshot.input_observations`.

**Changing the contract:** copy the current schema to `schemas/history/forecast-record-<old version>.schema.json` unchanged, then update the schema, `src/types/forecast.ts` (including `FORECAST_SCHEMA_VERSION`), `SCHEMA_VERSION` in `chronos_service/app.py` and `tests/fixtures/sampleForecastRecord.ts` together. Bump `schema_version` and the schema `$id`, then run `npm run schema:example`.

## Pre-market inputs (snapshot only)

Both forecast paths (`chronos_service/market_inputs.py` and `server/marketInputs.ts`) fill these at run time:

| Field | Source | Notes |
| --- | --- | --- |
| `overnight_futures_change_pct` | Yahoo 1-minute NQ=F / ES=F / RTY=F (~10 min delayed) | Latest bar close vs. the 15:59 ET bar of the last completed session, whose close is the 4:00:00pm price (end of CME's settlement window). Early closes use the calendar's cash close in Python; the TypeScript path reports null instead of guessing. Null if the latest bar is over 60 minutes old. |
| `vix_overnight_level` | Yahoo 1-minute ^VIX with pre/post (~15 min delayed) | Latest print from 03:15 ET (Cboe's overnight session) until 09:30. Listed as missing only from 03:30 to 09:30 ET on weekdays. `vix_level` remains the prior close. |
| `vix9d_level`, `vix3m_level`, `rvx_level` | Cboe daily CSV `CLOSE` | Falls back to Yahoo ^VIX9D / ^VIX3M daily. RVX has no fallback because Yahoo no longer serves ^RVX. `rvx_level` is filled for Russell 2000 profiles (TNA). |
| `iv_rank_pct`, `symbol_iv_pct` | Cboe daily CSV `CLOSE` of the profile's index (VIX, VXN or RVX) | IV rank = (last − min) / (max − min) × 100 over the trailing 252 closes. |

Only the Cboe `CLOSE` column is read: VIX's `OPEN` is the 3:15am overnight print, and intraday `LOW` values can contain bad prints. `snapshot.input_observations` records each input's source, ticker and observation time: the bar timestamp for intraday inputs, the session date for daily closes. Inputs that could not be filled are listed in `missing_inputs`.

These inputs are **not** Chronos-2 covariates. No history exists at the same ~4:20am clock time (Yahoo keeps about 7 days of 1-minute data), so training on them would introduce look-ahead bias.

## Accuracy and limitations

Chronos-2 is zero-shot in this implementation; it has not been fine-tuned or calibrated specifically for TQQQ. A strong benchmark result on general time-series datasets does not establish financial-market predictive ability.

Run the rolling-origin benchmark and compare against the historical block-bootstrap baseline:

~~~bash
cd chronos_service
python walk_forward.py --symbol TQQQ --origins 48 --spacing 21 --device cpu --simulations 5000
~~~

Do not enable position sizing based solely on a visually plausible forecast. Review out-of-sample pinball loss, interval coverage, Brier scores and regime-specific results first.

See [CHRONOS_DEPLOYMENT.md](CHRONOS_DEPLOYMENT.md) for the complete deployment, data-source and validation instructions.
