// Service worker: owns all auto-refresh jobs.
//
// MV3 service workers are killed after ~30s idle, so nothing here may assume it
// has been alive since the user pressed Start. Every job is mirrored to
// chrome.storage.session and re-armed from that mirror on worker startup, which
// is what makes the popup's view of the world trustworthy.

import {
  ALARM_MIN_INTERVAL,
  ALARM_PREFIX,
  BADGE,
  FALLBACK_DEFAULT_INTERVAL,
  KEEPALIVE_ALARM,
  MAX_INTERVAL,
  MIN_INTERVAL,
  MSG,
  normalizeInterval,
} from './shared/constants.js';

/** tabId (number) -> { interval, state, startedAt, lastRunAt, title, favIconUrl } */
const jobs = new Map();

/** tabId (number) -> setInterval handle. Worker-local; rebuilt by rehydrate(). */
const timers = new Map();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function serializeJobs() {
  return Object.fromEntries(jobs);
}

async function persist() {
  await chrome.storage.session.set({ jobs: serializeJobs() });
}

async function getDefaultInterval() {
  const { defaultInterval } = await chrome.storage.local.get('defaultInterval');
  return normalizeInterval(defaultInterval) ?? FALLBACK_DEFAULT_INTERVAL;
}

/**
 * Rebuild in-memory state after a worker restart. Runs at module load, so every
 * entry point below awaits `ready` before touching `jobs`.
 */
async function rehydrate() {
  const { jobs: stored } = await chrome.storage.session.get('jobs');
  if (stored) {
    for (const [key, job] of Object.entries(stored)) {
      const id = Number(key);
      if (Number.isInteger(id) && job && typeof job.interval === 'number') {
        jobs.set(id, job);
      }
    }
  }

  for (const [tabId, job] of [...jobs.entries()]) {
    if (!(await tabExists(tabId))) {
      // Tab closed while the worker was asleep.
      jobs.delete(tabId);
      await disarm(tabId);
      continue;
    }
    if (job.state === 'running') await arm(tabId, job);
    await paintBadge(tabId, job);
  }

  await persist();
  await syncKeepalive();
}

const ready = rehydrate();

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

async function tabExists(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function arm(tabId, job) {
  await disarm(tabId);
  if (job.interval >= ALARM_MIN_INTERVAL) {
    const minutes = job.interval / 60;
    await chrome.alarms.create(ALARM_PREFIX + tabId, {
      delayInMinutes: minutes,
      periodInMinutes: minutes,
    });
  } else {
    // Below the alarms API floor. The reload calls themselves keep the worker
    // alive; the keepalive alarm revives it if it dies anyway.
    timers.set(
      tabId,
      setInterval(() => void fire(tabId), job.interval * 1000),
    );
  }
}

async function disarm(tabId) {
  const handle = timers.get(tabId);
  if (handle !== undefined) {
    clearInterval(handle);
    timers.delete(tabId);
  }
  await chrome.alarms.clear(ALARM_PREFIX + tabId);
}

/**
 * A sub-30s job depends on setInterval, which dies with the worker. This alarm
 * wakes the worker every 30s; module load then re-arms the interval. Without it
 * a fast job can silently stop — the exact bug this extension exists to fix.
 */
async function syncKeepalive() {
  const needed = [...jobs.values()].some(
    (job) => job.state === 'running' && job.interval < ALARM_MIN_INTERVAL,
  );
  if (needed) {
    if (!(await chrome.alarms.get(KEEPALIVE_ALARM))) {
      await chrome.alarms.create(KEEPALIVE_ALARM, {
        delayInMinutes: 0.5,
        periodInMinutes: 0.5,
      });
    }
  } else {
    await chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}

async function fire(tabId) {
  await ready;
  const job = jobs.get(tabId);
  if (!job || job.state !== 'running') {
    await disarm(tabId);
    return;
  }
  try {
    await chrome.tabs.reload(tabId);
    job.lastRunAt = Date.now();
    await persist();
  } catch {
    // Tab is gone (or refuses to reload) — stop rather than retry forever.
    await removeJob(tabId);
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function paintBadge(tabId, job) {
  try {
    if (!job) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const style = BADGE[job.state];
    await chrome.action.setBadgeText({ tabId, text: style.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: style.color });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    }
  } catch {
    // Tab closed between the state change and the paint. Nothing to clean up:
    // per-tab badges die with the tab.
  }
}

// ---------------------------------------------------------------------------
// Job mutations
// ---------------------------------------------------------------------------

function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 200);
}

/**
 * Favicons are rendered in the popup as <img src>. Only schemes that can
 * actually load there are kept, and anything script-bearing is dropped.
 */
function cleanIconUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  return '';
}

async function removeJob(tabId) {
  jobs.delete(tabId);
  await disarm(tabId);
  await paintBadge(tabId, null);
  await persist();
  await syncKeepalive();
}

async function start({ tabId, interval, title, favIconUrl }) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return fail('Bad tab id');

  const seconds = normalizeInterval(interval);
  if (seconds === null) {
    return fail(`Interval must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} seconds`);
  }
  if (!(await tabExists(id))) return fail('That tab no longer exists');

  const now = Date.now();
  const job = {
    interval: seconds,
    state: 'running',
    startedAt: now,
    lastRunAt: now,
    title: cleanLabel(title),
    favIconUrl: cleanIconUrl(favIconUrl),
  };
  jobs.set(id, job);
  await arm(id, job);
  await paintBadge(id, job);
  await persist();
  await syncKeepalive();
  return state();
}

async function setJobState(tabId, next) {
  const id = Number(tabId);
  const job = jobs.get(id);
  if (!job) return fail('No job on that tab');

  job.state = next;
  job.lastRunAt = Date.now();
  if (next === 'running') await arm(id, job);
  else await disarm(id);

  await paintBadge(id, job);
  await persist();
  await syncKeepalive();
  return state();
}

async function cancelAll() {
  for (const tabId of [...jobs.keys()]) {
    jobs.delete(tabId);
    await disarm(tabId);
    await paintBadge(tabId, null);
  }
  await persist();
  await syncKeepalive();
  return state();
}

/**
 * Labels are captured at Start time and go stale when the tab navigates. The
 * popup re-sends them for whichever tab is active when it opens — the only tab
 * whose title we are allowed to read (activeTab).
 */
async function refreshLabel({ tabId, title, favIconUrl }) {
  const id = Number(tabId);
  const job = jobs.get(id);
  if (!job) return state();

  const label = cleanLabel(title);
  const icon = cleanIconUrl(favIconUrl);
  if (label) job.title = label;
  if (icon) job.favIconUrl = icon;
  await persist();
  return state();
}

async function setDefaultInterval(seconds) {
  const value = normalizeInterval(seconds);
  if (value === null) {
    return fail(`Interval must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} seconds`);
  }
  await chrome.storage.local.set({ defaultInterval: value });
  return state();
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function fail(error) {
  return { ok: false, error };
}

async function state() {
  return {
    ok: true,
    jobs: serializeJobs(),
    defaultInterval: await getDefaultInterval(),
  };
}

async function handle(message) {
  await ready;
  switch (message?.type) {
    case MSG.GET_STATE:
      return state();
    case MSG.START:
      return start(message);
    case MSG.PAUSE:
      return setJobState(message.tabId, 'paused');
    case MSG.RESUME:
      return setJobState(message.tabId, 'running');
    case MSG.CANCEL:
      await removeJob(Number(message.tabId));
      return state();
    case MSG.CANCEL_ALL:
      return cancelAll();
    case MSG.REFRESH_LABEL:
      return refreshLabel(message);
    case MSG.SET_DEFAULT_INTERVAL:
      return setDefaultInterval(message.seconds);
    default:
      return fail('Unknown message');
  }
}

/**
 * Accept messages only from documents served off our own extension origin.
 * There are no content scripts and no externally_connectable, so this is
 * belt-and-braces — but it is the check that would matter if either were ever
 * added. Note sender.tab is legitimately set when an extension page is opened
 * in a tab rather than as the action popup, so it is not a useful signal.
 */
function isOwnExtensionPage(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const origin = `chrome-extension://${chrome.runtime.id}`;
  if (sender.origin && sender.origin !== origin) return false;
  if (sender.url && !sender.url.startsWith(`${origin}/`)) return false;
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isOwnExtensionPage(sender)) return false;
  handle(message).then(sendResponse, (err) => sendResponse(fail(String(err?.message ?? err))));
  return true; // response is async
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Waking the worker is the entire job: module load re-armed the intervals.
    void ready;
    return;
  }
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
  if (Number.isInteger(tabId)) void fire(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await ready;
    if (jobs.has(tabId)) await removeJob(tabId);
  })();
});

chrome.runtime.onStartup.addListener(() => void ready);
