# Chronos-2 deployment and validation

## Architecture

The TypeScript application calls a separate Python service that keeps Amazon Chronos-2 loaded in memory. The forecasting path does not call Gemini or another chat-completion API.

- chronos_service/app.py loads amazon/chronos-2 once at startup.
- The service downloads adjusted daily bars for the target, underlying proxy, broad-market proxy, volatility indices and futures where available.
- Chronos-2 forecasts daily target-symbol log-return quantiles using aligned past covariates and known future calendar covariates. The direct forecast is capped at the model-native horizon (normally 64 steps); the 252-session output is not presented as a 252-step Chronos prediction.
- Beyond the model-native horizon, a conservative historical standardized-innovation distribution is used, then contiguous five-session block-bootstrap innovations create dependent paths. Log returns are compounded to derive 1D, 5D, 21D, 63D and 252D distributions.
- The existing TypeScript math audit reconciles the ten fixed bins, CDF, moments and probability sums.
- Kelly allocation remains 0 until walk-forward validation is implemented and passes acceptance thresholds.

Chronos-2 documentation: https://huggingface.co/amazon/chronos-2  
Chronos package: https://github.com/amazon-science/chronos-forecasting

## Local development

Use Python 3.11.

### Windows PowerShell

~~~powershell
cd chronos_service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
~~~

In a second terminal, from the repository root:

~~~powershell
$env:CHRONOS_SERVICE_URL = "http://127.0.0.1:8001"
npm install
npm run dev
~~~

The first Python service startup downloads the model weights from Hugging Face. Leave the Python service running while using the Node app.

### Docker

Build the inference service:

~~~bash
docker build -t meridian-chronos ./chronos_service
docker run --rm -p 8001:8001 \
  -e CHRONOS_DEVICE=cpu \
  -e CHRONOS_SIMULATIONS=10000 \
  -e CHRONOS_BLOCK_LENGTH=5 \
  meridian-chronos
~~~

For production, allocate at least 4 GiB memory and 2–4 vCPUs to the CPU service; 8 GiB is a safer starting point for model download, warm-up and pandas/torch peak memory. Persist/cache the Hugging Face model directory where the hosting platform supports it.

## Connecting the TypeScript app

Set these variables in the Node app environment:

- CHRONOS_SERVICE_URL: base URL of the Python service.
- CHRONOS_API_TOKEN: optional shared bearer token. Set the same token as CHRONOS_API_TOKEN in the Python service. Use a strong secret in production.

The service listens on port 8001. Its /health endpoint reports whether model weights have finished loading.

## Model and data settings

- Model: amazon/chronos-2 (120M parameters; Apache 2.0 model license).
- Context length: up to 8,192 observations.
- Direct forecast length: capped at the model-native horizon (normally 64 trading sessions). The 252-session endpoint is extended using historical standardized innovations because Chronos-2 documents that longer autoregressive forecasts may degrade.
- Quantile levels requested: 0.1 through 0.9, the model's trained quantile grid. Tail estimates outside this range use historical standardized residuals.
- Simulation paths: 10,000 by default (CHRONOS_SIMULATIONS).
- Dependence: five-session circular moving-block bootstrap (CHRONOS_BLOCK_LENGTH).
- Known future inputs: calendar cyclic features are passed through Chronos-2's future_covariates interface.
- Verification date handling: premarket forecasts verify the same session; EOD forecasts verify the next session and exclude incomplete daily candles.
- Inference: CPU by default (CHRONOS_DEVICE=cpu); set cuda only when the Python runtime has a compatible CUDA-enabled PyTorch installation.

## Market data limitations

The initial market-data adapter uses yfinance, which accesses Yahoo Finance data through an unofficial community-maintained interface. It is intended for personal/research experimentation only. It can be delayed, rate-limited or unavailable; it is not an institutional-grade or licensed redistribution feed. Review Yahoo's applicable terms before deploying this for other users or commercial purposes.

For production-quality use, replace the adapter with a licensed provider and validate historical adjustments, survivorship, delisted symbols, extended-hours coverage and corporate actions. Do not mix adjusted daily closes with raw intraday values without an explicit adjustment policy.

The current adapter does not provide complete options chains/put-call positioning, FedWatch probabilities, or a verified economic-event calendar. Those fields remain null or explicitly unavailable rather than being fabricated.

## Accuracy validation requirements

Chronos-2 is used zero-shot. Strong benchmark results on general time-series datasets do not establish accuracy for leveraged ETFs or financial returns. The scenario engine uses a historical block bootstrap to preserve short-term dependence, but this is not a substitute for instrument-specific calibration.

Before enabling allocation recommendations, add and run a rolling-origin walk-forward evaluation on each symbol and horizon. At minimum report:

- Pinball loss at the 0.1/0.5/0.9 quantiles.
- CRPS or weighted interval score.
- 50%, 80% and 90% prediction-interval coverage and average width.
- Brier score and log loss for positive-return probabilities.
- Results split by volatility regime and market period.
- Baselines including zero-return, historical-volatility, AR/ETS and buy-and-hold.

Run the included rolling-origin benchmark before drawing conclusions:

~~~bash
cd chronos_service
python walk_forward.py --symbol TQQQ --origins 48 --spacing 21 --device cpu --simulations 5000
~~~

This evaluates one-year-ahead scenarios at monthly rolling origins and reports quantile pinball losses, 80% interval coverage and positive-return Brier scores. It also benchmarks against an unconditional five-session historical block-bootstrap baseline. Chronos-2 should only be preferred when it beats the baseline on a held-out period, not merely because it is more sophisticated. Repeat for other symbols. Use only data available at each historical forecast timestamp, include delisted instruments where applicable, and account for trading costs when evaluating any strategy. Do not tune on the final test period.

## Tests

From chronos_service:

~~~bash
python -m unittest test_scenarios.py
~~~

From the repository root:

~~~bash
npm run lint
npm run build
~~~

A running/loaded Chronos service is required for an end-to-end forecast.
