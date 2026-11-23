import { useCallback, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { ForecastView } from './components/ForecastView';
import { PromptOptimizerView } from './components/PromptOptimizerView';
import { RawJsonView } from './components/RawJsonView';
import { ScheduleHistoryView } from './components/ScheduleHistoryView';
import type {
  CalibrationMode,
  ForecastRecord,
  RunWindow,
  ScheduleConfig,
} from './types/forecast';

type NavTab = 'forecast' | 'optimizer' | 'schedule' | 'json';

interface EasternClock {
  dateEt: string;
  timeEt: string;
  weekday: string;
  isTradingDay: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('forecast');
  const [symbol, setSymbol] = useState<string>('TQQQ');
  const [calibrationMode, setCalibrationMode] = useState<CalibrationMode>('leveraged_scaled');
  const [runWindow, setRunWindow] = useState<RunWindow>('pre_market');

  const [forecasts, setForecasts] = useState<ForecastRecord[]>([]);
  const [activeRecord, setActiveRecord] = useState<ForecastRecord | null>(null);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [easternClock, setEasternClock] = useState<EasternClock | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fetchInitialData = useCallback(async () => {
    try {
      const [fRes, sRes] = await Promise.all([
        fetch('/api/forecasts'),
        fetch('/api/schedule'),
      ]);
      if (fRes.ok) {
        const fData = (await fRes.json()) as { forecasts: ForecastRecord[] };
        const list = fData.forecasts ?? [];
        setForecasts(list);
        if (list.length > 0) {
          setActiveRecord((prev) => prev ?? list[0]);
        }
      }
      if (sRes.ok) {
        const sData = (await sRes.json()) as {
          schedule: ScheduleConfig;
          eastern_clock: EasternClock;
        };
        setSchedule(sData.schedule);
        setEasternClock(sData.eastern_clock);
      }
    } catch {
      // Ignore transient load error
    }
  }, []);

  useEffect(() => {
    void fetchInitialData();
    const timer = setInterval(() => {
      void fetch('/api/schedule')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.schedule) setSchedule(d.schedule);
          if (d?.eastern_clock) setEasternClock(d.eastern_clock);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchInitialData]);

  const handleRunForecast = async () => {
    if (isRunning) return;
    setActiveTab('forecast');
    setIsRunning(true);
    setErrorMessage(null);
    setProgressMessage(`Initializing live grounded pipeline for ${symbol}...`);

    try {
      const response = await fetch('/api/forecasts/run?stream=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          symbol,
          calibrationMode,
          runWindow,
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          let eventType = 'message';
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataLine = line.slice(6).trim();
            }
          }
          if (!dataLine) continue;
          const parsed = JSON.parse(dataLine);

          if (eventType === 'progress') {
            setProgressMessage(parsed.message ?? 'Processing...');
          } else if (eventType === 'result' && parsed.forecast) {
            const record = parsed.forecast as ForecastRecord;
            setActiveRecord(record);
            setForecasts((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
          } else if (eventType === 'error') {
            throw new Error(parsed.error || 'Forecast pipeline error.');
          }
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to execute forecast pipeline.'
      );
    } finally {
      setIsRunning(false);
      setProgressMessage(null);
    }
  };

  const handleSaveSchedule = async (next: ScheduleConfig) => {
    const res = await fetch('/api/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        schedule: ScheduleConfig;
        eastern_clock: EasternClock;
      };
      setSchedule(data.schedule);
      setEasternClock(data.eastern_clock);
    }
  };

  const handleDeleteForecast = async (id: string) => {
    const res = await fetch(`/api/forecasts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setForecasts((prev) => {
        const next = prev.filter((r) => r.id !== id);
        if (activeRecord?.id === id) {
          setActiveRecord(next[0] ?? null);
        }
        return next;
      });
    }
  };

  const handleVerifyForecast = async (id: string) => {
    setVerifyingId(id);
    try {
      const res = await fetch(`/api/forecasts/${id}/verify`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed.');
      }
      const updated = data.forecast as ForecastRecord;
      setForecasts((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (activeRecord?.id === id) {
        setActiveRecord(updated);
      }
    } finally {
      setVerifyingId(null);
    }
  };

  const handleSelectForecast = (record: ForecastRecord) => {
    setActiveRecord(record);
    setSymbol(record.payload.symbol);
    setCalibrationMode(record.calibration_mode);
    setRunWindow(record.run_window);
    setActiveTab('forecast');
  };

  const navItems: Array<{ key: NavTab; label: string }> = [
    { key: 'forecast', label: 'Forecast' },
    { key: 'optimizer', label: 'Prompt Optimizer' },
    { key: 'schedule', label: 'Schedule & History' },
    { key: 'json', label: 'Raw JSON' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single Wordmark */}
          <a
            href="#forecast"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('forecast');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Meridian Quant
          </a>

          {/* Zone 2: 4 Clean Single-Line Navigation Links */}
          <nav aria-label="Primary" className="flex items-center gap-6 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              disabled={isRunning}
              onClick={handleRunForecast}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {isRunning ? 'Running...' : 'Run Forecast'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'forecast' && (
          <ForecastView
            activeRecord={activeRecord}
            symbol={symbol}
            onSymbolChange={setSymbol}
            calibrationMode={calibrationMode}
            onCalibrationModeChange={setCalibrationMode}
            runWindow={runWindow}
            onRunWindowChange={setRunWindow}
            isRunning={isRunning}
            progressMessage={progressMessage}
            errorMessage={errorMessage}
            onRunForecast={handleRunForecast}
            onOpenOptimizer={() => setActiveTab('optimizer')}
          />
        )}

        {activeTab === 'optimizer' && (
          <PromptOptimizerView
            symbol={symbol}
            onSymbolChange={setSymbol}
            calibrationMode={calibrationMode}
            onCalibrationModeChange={setCalibrationMode}
            runWindow={runWindow}
            onRunWindowChange={setRunWindow}
            onRunForecast={handleRunForecast}
          />
        )}

        {activeTab === 'schedule' && (
          <ScheduleHistoryView
            forecasts={forecasts}
            activeRecordId={activeRecord?.id ?? null}
            onSelectForecast={handleSelectForecast}
            onDeleteForecast={handleDeleteForecast}
            onVerifyForecast={handleVerifyForecast}
            verifyingId={verifyingId}
            schedule={schedule}
            easternClock={easternClock}
            onSaveSchedule={handleSaveSchedule}
          />
        )}

        {activeTab === 'json' && (
          <RawJsonView activeRecord={activeRecord} onRunForecast={handleRunForecast} />
        )}
      </main>
    </div>
  );
}
