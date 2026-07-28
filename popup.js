// Popup: a pure view over the service worker's state.
//
// It holds no scheduling logic of its own — every render comes from a fresh
// GET_STATE, which is why reopening the popup mid-run always tells the truth.

import {
  MAX_INTERVAL,
  MIN_INTERVAL,
  MSG,
  formatInterval,
  normalizeInterval,
} from './shared/constants.js';

const $ = (id) => document.getElementById(id);

/** The tab the popup was opened on. activeTab grants us its title/favicon. */
let activeTab = null;

/** Last known state from the worker: { jobs, defaultInterval }. */
let snapshot = { jobs: {}, defaultInterval: MIN_INTERVAL };

let countdownTimer = null;

// ---------------------------------------------------------------------------
// Worker conversation
// ---------------------------------------------------------------------------

async function send(message) {
  let response;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (err) {
    showError(`Background worker unreachable: ${err?.message ?? err}`);
    return null;
  }
  if (!response?.ok) {
    showError(response?.error ?? 'Something went wrong');
    return null;
  }
  showError(null);
  snapshot = response;
  return response;
}

function showError(text) {
  const el = $('error');
  el.textContent = text ?? '';
  el.hidden = !text;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function labelFor(tabId, job) {
  const title = job?.title?.trim();
  return title || `Tab #${tabId}`;
}

function paintAvatar(el, label, favIconUrl) {
  el.textContent = '';
  const letter = label.trim().charAt(0) || '?';
  if (!favIconUrl) {
    el.textContent = letter;
    return;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    el.textContent = letter;
  });
  img.src = favIconUrl;
  el.appendChild(img);
}

function secondsUntilNextRun(job) {
  const due = (job.lastRunAt ?? job.startedAt ?? 0) + job.interval * 1000;
  return Math.max(0, Math.round((due - Date.now()) / 1000));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const jobs = snapshot.jobs ?? {};
  const activeId = activeTab?.id;
  const activeJob = activeId === undefined ? undefined : jobs[activeId];

  renderActiveTab(activeId, activeJob);
  renderOthers(jobs, activeId);

  $('cancel-all-btn').hidden = Object.keys(jobs).length === 0;
  $('default-interval').value = String(snapshot.defaultInterval);

  startCountdown();
}

function renderActiveTab(activeId, job) {
  // On the active card a bare "Tab #873156630" is noise — the heading already
  // says which tab this is. Numeric fallbacks are only useful in the list of
  // other tabs, where they distinguish one row from another.
  const label = activeTab
    ? activeTab.title?.trim() || job?.title?.trim() || 'Current tab'
    : 'No active tab';
  $('active-title').textContent = label;
  $('active-title').title = label;
  paintAvatar($('active-avatar'), label, activeTab?.favIconUrl ?? job?.favIconUrl ?? '');

  const idle = $('idle-view');
  const running = $('active-view');

  if (!activeTab) {
    idle.hidden = true;
    running.hidden = true;
    return;
  }

  if (!job) {
    idle.hidden = false;
    running.hidden = true;
    if (!$('interval-input').value) {
      $('interval-input').value = String(snapshot.defaultInterval);
    }
    syncPresets();
    return;
  }

  idle.hidden = true;
  running.hidden = false;

  const status = $('active-status');
  const isRunning = job.state === 'running';
  status.textContent = isRunning
    ? `Refreshing every ${formatInterval(job.interval)}`
    : `Paused (every ${formatInterval(job.interval)})`;
  status.className = `status status--${job.state}`;
  $('toggle-btn').textContent = isRunning ? 'Pause' : 'Resume';
}

function renderOthers(jobs, activeId) {
  const entries = Object.entries(jobs).filter(([id]) => Number(id) !== activeId);
  const panel = $('others-panel');
  const list = $('others-list');

  panel.hidden = entries.length === 0;
  list.textContent = '';
  if (entries.length === 0) return;

  $('others-count').textContent = `(${entries.length})`;

  const template = $('job-row-template');
  for (const [idString, job] of entries) {
    const tabId = Number(idString);
    const row = template.content.firstElementChild.cloneNode(true);
    const label = labelFor(tabId, job);

    paintAvatar(row.querySelector('.avatar'), label, job.favIconUrl);
    row.querySelector('.job__title').textContent = label;
    row.querySelector('.job__focus').title = `Switch to ${label}`;
    row.querySelector('.job__meta').textContent =
      job.state === 'running'
        ? `every ${formatInterval(job.interval)}`
        : `paused · every ${formatInterval(job.interval)}`;

    const toggle = row.querySelector('[data-action="toggle"]');
    const isRunning = job.state === 'running';
    toggle.textContent = isRunning ? '‖' : '▶';
    toggle.title = isRunning ? 'Pause' : 'Resume';

    row.querySelector('.job__focus').addEventListener('click', () => focusTab(tabId));
    toggle.addEventListener('click', async () => {
      await send({ type: isRunning ? MSG.PAUSE : MSG.RESUME, tabId });
      render();
    });
    row.querySelector('[data-action="cancel"]').addEventListener('click', async () => {
      await send({ type: MSG.CANCEL, tabId });
      render();
    });

    list.appendChild(row);
  }
}

function startCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;

  const activeId = activeTab?.id;
  const job = activeId === undefined ? undefined : snapshot.jobs?.[activeId];
  const el = $('active-countdown');

  if (!job) {
    el.textContent = '';
    return;
  }
  if (job.state !== 'running') {
    el.textContent = 'Resume to continue.';
    return;
  }

  const tick = () => {
    const left = secondsUntilNextRun(job);
    el.textContent = left > 0 ? `Next refresh in ${left}s` : 'Refreshing…';
  };
  tick();
  countdownTimer = setInterval(tick, 500);
}

function syncPresets() {
  const current = Number($('interval-input').value);
  for (const chip of $('presets').querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.seconds) === current));
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    window.close();
  } catch {
    showError('That tab is gone.');
    await send({ type: MSG.GET_STATE });
    render();
  }
}

async function startOnActiveTab() {
  if (!activeTab) return;
  const seconds = normalizeInterval($('interval-input').value);
  if (seconds === null) {
    showError(`Enter a whole number of seconds between ${MIN_INTERVAL} and ${MAX_INTERVAL}.`);
    return;
  }
  await send({
    type: MSG.START,
    tabId: activeTab.id,
    interval: seconds,
    title: activeTab.title ?? '',
    favIconUrl: activeTab.favIconUrl ?? '',
  });
  render();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$('start-btn').addEventListener('click', startOnActiveTab);

$('interval-input').addEventListener('input', syncPresets);
$('interval-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') startOnActiveTab();
});

$('presets').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  $('interval-input').value = chip.dataset.seconds;
  syncPresets();
});

$('toggle-btn').addEventListener('click', async () => {
  const job = snapshot.jobs?.[activeTab?.id];
  if (!job) return;
  await send({ type: job.state === 'running' ? MSG.PAUSE : MSG.RESUME, tabId: activeTab.id });
  render();
});

$('cancel-btn').addEventListener('click', async () => {
  if (!activeTab) return;
  await send({ type: MSG.CANCEL, tabId: activeTab.id });
  render();
});

$('cancel-all-btn').addEventListener('click', async () => {
  await send({ type: MSG.CANCEL_ALL });
  render();
});

$('default-interval').addEventListener('change', async (event) => {
  const seconds = normalizeInterval(event.target.value);
  if (seconds === null) {
    showError(`Default must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} seconds.`);
    event.target.value = String(snapshot.defaultInterval);
    return;
  }
  await send({ type: MSG.SET_DEFAULT_INTERVAL, seconds });
  render();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;

  if (!(await send({ type: MSG.GET_STATE }))) return;

  // Labels are captured at Start time and drift as the tab navigates. This is
  // the one tab whose title we're allowed to read, so top it up while we can.
  if (activeTab && snapshot.jobs?.[activeTab.id] && (activeTab.title || activeTab.favIconUrl)) {
    await send({
      type: MSG.REFRESH_LABEL,
      tabId: activeTab.id,
      title: activeTab.title ?? '',
      favIconUrl: activeTab.favIconUrl ?? '',
    });
  }

  render();
})();
