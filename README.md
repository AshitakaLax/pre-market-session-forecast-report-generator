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

- **Schema:** [`schemas/forecast-record.schema.json`](schemas/forecast-record.schema.json) (JSON Schema draft 2020-12). It describes payload `schema_version` `1.1.0` and mirrors `src/types/forecast.ts`. Objects are closed (`additionalProperties: false`), enums are explicit, probabilities are bounded to [0, 1], simple-return values (bin `min_pct`, mean, median, every quantile and expected shortfall) are bounded below by -100% because a long position cannot lose more than everything, each horizon has exactly 10 bins with its `trading_days` fixed (1/5/21/63/252), and timestamps must be RFC 3339 with an offset.
- **Semantic rules** that JSON Schema cannot express are in [`server/forecastValidation.ts`](server/forecastValidation.ts): probability mass sums to 1, each CDF equals underflow plus cumulative bin mass, bins are contiguous, no underflow mass sits at or below -100%, quantiles are ordered (p01 ≤ … ≤ p99), expected shortfall ≤ p05, strategy weights sum to 1, the audit covers every horizon exactly once and passed, and the snapshot and payload symbols match.
- **Example:** [`schemas/examples/forecast-record.example.json`](schemas/examples/forecast-record.example.json), regenerated with `npm run schema:example`.

~~~bash
npm test                                    # schema + semantic rule tests
npm run validate:forecasts                  # validate data/forecasts.json
npm run validate:forecasts -- path/to/record.json other.json
npm run reaudit:forecasts                   # recompute stored summaries after audit-math changes
~~~

At runtime, `GET /api/schemas/forecast-record` serves the schema, and `POST /api/forecasts/validate` with a record as the body returns `{ valid, schema_id, issues[] }` (HTTP 422 when invalid). Python consumers can validate with `jsonschema` (see `chronos_service/test_forecast_schema.py`, which cross-checks the schema with a second implementation).

**Changing the contract:** update the schema, `src/types/forecast.ts` and `tests/fixtures/sampleForecastRecord.ts` together. Bump `schema_version` and the schema `$id` whenever the payload shape changes, then run `npm run schema:example`. If a change to `server/mathAudit.ts` alters derived summaries, run `npm run reaudit:forecasts`. It rewrites only the moments, quantiles and expected shortfall of stored records, and it refuses to write if any bin probability would change.

## Accuracy and limitations

Chronos-2 is zero-shot in this implementation; it has not been fine-tuned or calibrated specifically for TQQQ. A strong benchmark result on general time-series datasets does not establish financial-market predictive ability.

Run the rolling-origin benchmark and compare against the historical block-bootstrap baseline:

~~~bash
cd chronos_service
python walk_forward.py --symbol TQQQ --origins 48 --spacing 21 --device cpu --simulations 5000
~~~

Do not enable position sizing based solely on a visually plausible forecast. Review out-of-sample pinball loss, interval coverage, Brier scores and regime-specific results first.

See [CHRONOS_DEPLOYMENT.md](CHRONOS_DEPLOYMENT.md) for the complete deployment, data-source and validation instructions.
