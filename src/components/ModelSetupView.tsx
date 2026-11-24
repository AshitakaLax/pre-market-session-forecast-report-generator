import React, { useEffect, useState } from 'react';

interface HealthState {
  status?: string;
  forecasting_engine?: string;
  chronos?: {
    reachable?: boolean;
    model_loaded?: boolean;
    model_id?: string;
    device?: string;
    backend?: string;
    url?: string;
    mode?: 'public_hf_space' | 'private_service';
    data_provider?: string;
    error?: string;
    context_length?: number;
    simulations?: number;
    native_prediction_length?: number;
    direct_horizon_limit?: number;
  };
}

export const ModelSetupView: React.FC = () => {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const data = (await response.json()) as HealthState;
        if (active) {
          setHealth(data);
          setCheckedAt(new Date().toLocaleTimeString());
        }
      } catch {
        if (active) {
          setHealth({ status: 'unavailable' });
          setCheckedAt(new Date().toLocaleTimeString());
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const loaded = health?.chronos?.model_loaded === true;
  const isPublic = health?.chronos?.mode === 'public_hf_space';
  const statusClass = loaded
    ? 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200'
    : 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200';

  const statusLabel = loaded
    ? isPublic
      ? 'Connected (Public Chronos-2 Service)'
      : 'Connected (Private Chronos-2 Service)'
    : 'Chronos-2 unavailable';

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Forecast Model & Data Setup</h1>
            <p className="text-sm text-slate-600 mt-1">
              Numerical price-return forecasts automatically connect to a publicly hosted Amazon Chronos-2 service (or your private Chronos-2 service if configured).
            </p>
          </div>
          <span className={statusClass}>
            <span className={loaded ? 'h-2 w-2 rounded-full bg-emerald-500' : 'h-2 w-2 rounded-full bg-amber-500'} />
            {statusLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="border border-slate-200 rounded-md p-4">
            <div className="text-xs text-slate-500">Forecast model</div>
            <div className="font-semibold text-slate-900 mt-1">
              {health?.chronos?.model_id ?? 'amazon/chronos-2'}
            </div>
            <div className="text-xs text-slate-500 mt-1">120M parameter time-series foundation model</div>
          </div>
          <div className="border border-slate-200 rounded-md p-4">
            <div className="text-xs text-slate-500">Active endpoint</div>
            <div className="font-semibold text-slate-900 mt-1 text-xs font-mono truncate">
              {health?.chronos?.url ?? 'Not connected'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {isPublic ? 'Auto-connected public Hugging Face Space' : 'Private/local inference service'}
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-4">
            <div className="text-xs text-slate-500">Inference device</div>
            <div className="font-semibold text-slate-900 mt-1">{health?.chronos?.device ?? 'Not connected'}</div>
            <div className="text-xs text-slate-500 mt-1">
              Context limit: {health?.chronos?.context_length?.toLocaleString() ?? '512'} sessions
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-4">
            <div className="text-xs text-slate-500">Scenario simulation</div>
            <div className="font-semibold text-slate-900 mt-1">
              {health?.chronos?.simulations?.toLocaleString() ?? '10,000'} paths
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {health?.chronos?.direct_horizon_limit ?? 288}-session horizon limit
            </div>
          </div>
        </div>

        {health?.chronos?.error && (
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {health.chronos.error}
          </div>
        )}
        <p className="text-xs text-slate-500">
          {checkedAt ? 'Health checked at ' + checkedAt + '. ' : ''}
          {health?.chronos?.data_provider ?? 'Market data provider status unavailable.'}
        </p>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Forecast methodology</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="font-semibold text-slate-800">Automatic public Chronos-2 routing</h3>
            <p className="text-slate-600 mt-1">
              When no local or private <code className="font-mono text-xs">CHRONOS_SERVICE_URL</code> is active, the server automatically connects to the public <code className="font-mono text-xs">amazon/chronos-2</code> API (<code className="font-mono text-xs">equinai-chronos-2-api.hf.space</code>) with Yahoo Finance historical closes.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Probability construction</h3>
            <p className="text-slate-600 mt-1">
              Chronos-2 predictions at 1D–252D horizons are paired with 10,000 five-session circular block-bootstrap scenarios from standardized historical log-return residuals, then audited in TypeScript for exact bin sums and monotonic CDFs.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Price anchor</h3>
            <p className="text-slate-600 mt-1">
              Forecasts are anchored to the last completed regular-session close. Premarket quotes (including the 04:00–04:30 ET opening window) are shown separately and are not silently substituted for the daily close.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">Risk controls</h3>
            <p className="text-slate-600 mt-1">
              Kelly sizing is forced to 0% and strategy weights remain cash-defensive until a walk-forward backtest demonstrates acceptable out-of-sample calibration.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Optional: Self-host the full covariate Python service locally
        </h2>
        <p className="text-sm text-slate-600">
          No local setup is required to run forecasts. If you want full multi-covariate quantile inference (VIX/VXN/futures/calendar covariates up to 8,192 sessions), start the included Python service and the server will prefer it automatically.
        </p>
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">Python service</div>
          <pre className="rounded-md bg-slate-950 text-slate-100 p-4 text-xs overflow-x-auto whitespace-pre-wrap">{"cd chronos_service\npython -m venv .venv\n# Activate venv, then:\npip install -r requirements.txt\nuvicorn app:app --host 0.0.0.0 --port 8001"}</pre>
        </div>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
        <h2 className="font-semibold text-amber-950">Important data and validation limitations</h2>
        <p className="text-sm text-amber-900">
          Market data uses Yahoo Finance for personal research. It is unofficial, may be delayed or rate-limited, and is not a licensed institutional market-data feed. Public community Hugging Face Spaces also have shared compute limits and may occasionally sleep or throttle.
        </p>
        <p className="text-sm text-amber-900">
          Chronos-2 is zero-shot here: the scenario bands are model-based estimates, not validated trading probabilities. Run historical out-of-sample tests and verify realized closes before using forecasts for trading.
        </p>
      </section>
    </div>
  );
};
