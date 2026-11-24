/**
 * Dead-man's-switch and alerting.
 *  - HEALTHCHECK_PING_URL (e.g. https://hc-ping.com/<uuid>): pinged after every day's
 *    validated save; `/fail` is pinged when the cutoff passes without one. Configure the
 *    Healthchecks.io schedule with a grace period that ends at 04:30 ET.
 *  - ALERT_WEBHOOK_URL: receives a JSON POST ({ text, ... }) on a missed deadline
 *    (Slack/Discord-compatible `text`).
 */

type Fetcher = typeof fetch;

async function safePost(fetcher: Fetcher, url: string, init?: RequestInit): Promise<boolean> {
  try {
    const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch (err) {
    console.warn(`Notification to ${new URL(url).host} failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function notifyValidated(
  dateEt: string,
  symbols: string[],
  fetcher: Fetcher = fetch,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const ping = env.HEALTHCHECK_PING_URL?.trim();
  if (ping) await safePost(fetcher, ping, { method: 'POST', body: `validated ${dateEt} ${symbols.join(',')}` });
}

export async function notifyMissedDeadline(
  dateEt: string,
  missing: string[],
  detail: string | null,
  fetcher: Fetcher = fetch,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const text = `Pre-market forecast MISSED for ${dateEt}: no validated record for ${missing.join(', ')}.${
    detail ? ` Last status: ${detail}` : ''
  }`;
  console.error(text);
  const ping = env.HEALTHCHECK_PING_URL?.trim();
  if (ping) await safePost(fetcher, `${ping.replace(/\/+$/, '')}/fail`, { method: 'POST', body: text });
  const hook = env.ALERT_WEBHOOK_URL?.trim();
  if (hook) {
    await safePost(fetcher, hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, date_et: dateEt, missing_symbols: missing }),
    });
  }
}
