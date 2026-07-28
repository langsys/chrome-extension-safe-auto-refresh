// Values shared between the service worker and the popup.
// Kept in one module so the two sides can never disagree about limits or
// message names.

/** Shortest interval we allow, in seconds. Below this we're just hammering sites. */
export const MIN_INTERVAL = 2;

/** Longest interval we allow, in seconds (24 hours). */
export const MAX_INTERVAL = 86400;

/** Used when the user has never set a default. */
export const FALLBACK_DEFAULT_INTERVAL = 60;

/**
 * Chrome's alarms API has a 30s minimum period. Jobs at or above this run on
 * alarms (survive service-worker death for free); jobs below it run on
 * setInterval, backed by a keepalive alarm so a dead worker is revived quickly.
 */
export const ALARM_MIN_INTERVAL = 30;

export const ALARM_PREFIX = 'refresh:';
export const KEEPALIVE_ALARM = 'keepalive';

export const MSG = {
  GET_STATE: 'GET_STATE',
  START: 'START',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  CANCEL: 'CANCEL',
  CANCEL_ALL: 'CANCEL_ALL',
  REFRESH_LABEL: 'REFRESH_LABEL',
  SET_DEFAULT_INTERVAL: 'SET_DEFAULT_INTERVAL',
};

export const BADGE = {
  running: { text: '↻', color: '#1a7f37' }, // ↻ green
  paused: { text: '‖', color: '#6e7781' }, // ‖ grey
};

/** Clamp + integer-ise a user-supplied interval. Returns null if unusable. */
export function normalizeInterval(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  if (n < MIN_INTERVAL || n > MAX_INTERVAL) return null;
  return n;
}

/** "90" -> "1m 30s", "45" -> "45s", "3600" -> "1h" */
export function formatInterval(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
}
