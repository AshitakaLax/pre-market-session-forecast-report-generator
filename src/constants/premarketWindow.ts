/**
 * Opening pre-market window summarised in the snapshot (`premarket_window_*`).
 *
 * The window must be fully elapsed when the report is generated. Scheduled runs
 * start at 04:05 ET, so the window is the first five minutes of the session
 * (bars stamped 04:00..04:04). `PREMARKET_WINDOW_END_ET` is exclusive.
 * Keep in sync with PREMARKET_WINDOW_* in chronos_service/app.py.
 */
export const PREMARKET_WINDOW_START_ET = '04:00';
export const PREMARKET_WINDOW_END_ET = '04:05';
