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

## Accuracy and limitations

Chronos-2 is zero-shot in this implementation; it has not been fine-tuned or calibrated specifically for TQQQ. A strong benchmark result on general time-series datasets does not establish financial-market predictive ability.

Run the rolling-origin benchmark and compare against the historical block-bootstrap baseline:

~~~bash
cd chronos_service
python walk_forward.py --symbol TQQQ --origins 48 --spacing 21 --device cpu --simulations 5000
~~~

Do not enable position sizing based solely on a visually plausible forecast. Review out-of-sample pinball loss, interval coverage, Brier scores and regime-specific results first.

See [CHRONOS_DEPLOYMENT.md](CHRONOS_DEPLOYMENT.md) for the complete deployment, data-source and validation instructions.
