// End-to-end test: launches Chrome with the extension loaded, drives the real
// popup -> background message protocol, and verifies reloads actually happened
// by counting requests hitting a local fixture server.
//
//   node test/e2e.mjs            headless
//   node test/e2e.mjs --headful  watch it work
//
// Runs for roughly three minutes: several assertions are about time passing.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { connect, evaluate, launchChrome, sleep, waitFor } from './cdp.mjs';
import { startFixtureServer } from './fixture-server.mjs';

const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEADLESS = !process.argv.includes('--headful');

const results = [];

// Tracked at module scope so a mid-test throw still tears the browser down —
// an orphaned Chrome holding a debug port is how a test run starts driving
// something it did not launch.
let chrome = null;
let fixture = null;
let browser = null;

async function teardown() {
  try {
    browser?.close();
  } catch {
    // Socket already gone.
  }
  browser = null;
  await chrome?.close();
  chrome = null;
  await fixture?.close();
  fixture = null;
}

function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '[32m✓[0m' : '[31m✗[0m'} ${name}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n[1m${title}[0m`);
}

async function main() {
  fixture = await startFixtureServer();
  console.log(`fixture server: ${fixture.origin}`);

  chrome = await launchChrome({ extensionPath: EXTENSION_DIR, headless: HEADLESS });
  console.log(`chrome: ${chrome.version.Browser} on port ${chrome.port} (headless=${HEADLESS})`);

  browser = await connect(chrome.browserWsUrl);

  // ---- discover the extension ------------------------------------------
  // Chrome ships several component extensions with their own service workers,
  // so match on our own deterministic unpacked ID rather than "the first one".
  const extensionId = chrome.extensionId;
  const ours = (t) => t.type === 'service_worker' && t.url.includes(extensionId);
  await waitFor(async () => (await chrome.targets()).find(ours), 20000).catch(() => {
    throw new Error(
      `Extension ${extensionId} never started a service worker. ` +
        'Chrome may be ignoring --load-extension.',
    );
  });
  console.log(`extension: ${extensionId}`);

  // The popup page doubles as our driver: it is a real extension context, so
  // sendMessage exercises exactly the path the shipped popup uses.
  const { targetId: driverId } = await browser.send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/popup.html`,
  });
  const driver = await browser.attach(driverId);
  await driver.send('Runtime.enable');
  await waitFor(async () => (await evaluate(driver, 'return document.readyState')) === 'complete');

  const msg = (payload) =>
    evaluate(driver, `return chrome.runtime.sendMessage(${JSON.stringify(payload)});`);
  const badge = (tabId) =>
    evaluate(driver, `return chrome.action.getBadgeText({ tabId: ${tabId} });`);
  const alarms = () => evaluate(driver, 'return chrome.alarms.getAll();');

  // ---- fixture tabs -----------------------------------------------------
  const tabs = await evaluate(
    driver,
    `const a = await chrome.tabs.create({ url: '${fixture.origin}/a', active: false });
     const b = await chrome.tabs.create({ url: '${fixture.origin}/b', active: false });
     const c = await chrome.tabs.create({ url: '${fixture.origin}/c', active: false });
     return { a: a.id, b: b.id, c: c.id };`,
  );
  await waitFor(async () => fixture.hitsFor('/a') && fixture.hitsFor('/b') && fixture.hitsFor('/c'));
  console.log(`tabs: a=${tabs.a} b=${tabs.b} c=${tabs.c}`);

  // ======================================================================
  section('Popup ↔ background protocol');

  const initial = await msg({ type: 'GET_STATE' });
  check('GET_STATE responds ok', initial?.ok === true);
  check('no jobs at startup', Object.keys(initial.jobs ?? {}).length === 0);
  check('a default interval is supplied', Number.isInteger(initial.defaultInterval), `${initial.defaultInterval}s`);

  const badStart = await msg({ type: 'START', tabId: tabs.a, interval: 1 });
  check('interval below the floor is rejected', badStart?.ok === false, badStart?.error);

  const badStart2 = await msg({ type: 'START', tabId: tabs.a, interval: 999999 });
  check('interval above the ceiling is rejected', badStart2?.ok === false, badStart2?.error);

  const unknown = await msg({ type: 'NOT_A_REAL_MESSAGE' });
  check('unknown message types are rejected', unknown?.ok === false);

  // ======================================================================
  section('Fast job (setInterval path, 3s)');

  const beforeA = fixture.hitsFor('/a');
  const started = await msg({
    type: 'START',
    tabId: tabs.a,
    interval: 3,
    label: 'Fixture A',
  });
  check('START accepted', started?.ok === true, started?.error);
  check('job is reported as running', started.jobs?.[tabs.a]?.state === 'running');
  check('badge shows the running mark', (await badge(tabs.a)) === '↻');

  await sleep(10500);
  const grewA = fixture.hitsFor('/a') - beforeA;
  check('tab reloaded on schedule', grewA >= 2 && grewA <= 5, `${grewA} reloads in 10.5s @3s`);

  // ---- state survives popup reopen (the bug this replaces) -------------
  await driver.send('Page.reload');
  await waitFor(async () => (await evaluate(driver, 'return document.readyState')) === 'complete');
  const reopened = await msg({ type: 'GET_STATE' });
  check('reopened popup still sees the job', reopened.jobs?.[tabs.a]?.state === 'running');
  check('reopened popup reports the right interval', reopened.jobs?.[tabs.a]?.interval === 3);

  // ======================================================================
  section('Pause / resume');

  await msg({ type: 'PAUSE', tabId: tabs.a });
  check('badge shows the paused mark', (await badge(tabs.a)) === '‖');
  const atPause = fixture.hitsFor('/a');
  await sleep(7000);
  check('paused job stops reloading', fixture.hitsFor('/a') === atPause, `${fixture.hitsFor('/a') - atPause} reloads while paused`);

  const resumed = await msg({ type: 'RESUME', tabId: tabs.a });
  check('RESUME reports running', resumed.jobs?.[tabs.a]?.state === 'running');
  const atResume = fixture.hitsFor('/a');
  await sleep(7000);
  check('resumed job reloads again', fixture.hitsFor('/a') > atResume, `+${fixture.hitsFor('/a') - atResume}`);

  // ======================================================================
  section('Independent multi-tab jobs');

  await msg({ type: 'START', tabId: tabs.b, interval: 4, label: 'Fixture B' });
  const twoJobs = await msg({ type: 'GET_STATE' });
  check('both tabs have jobs', Object.keys(twoJobs.jobs).length === 2);
  check('starting B did not disturb A', twoJobs.jobs[tabs.a]?.interval === 3);
  check('B kept its own interval', twoJobs.jobs[tabs.b]?.interval === 4);

  const beforeBoth = { a: fixture.hitsFor('/a'), b: fixture.hitsFor('/b') };
  await sleep(9000);
  check('A still reloading', fixture.hitsFor('/a') > beforeBoth.a, `+${fixture.hitsFor('/a') - beforeBoth.a}`);
  check('B reloading independently', fixture.hitsFor('/b') > beforeBoth.b, `+${fixture.hitsFor('/b') - beforeBoth.b}`);

  await msg({ type: 'PAUSE', tabId: tabs.b });
  const beforePauseB = { a: fixture.hitsFor('/a'), b: fixture.hitsFor('/b') };
  await sleep(7000);
  check('pausing B leaves A running', fixture.hitsFor('/a') > beforePauseB.a);
  check('pausing B stops only B', fixture.hitsFor('/b') === beforePauseB.b);
  await msg({ type: 'RESUME', tabId: tabs.b });

  // ======================================================================
  section('Service-worker death and recovery');

  const before = await alarms();
  check(
    'keepalive alarm exists for sub-30s jobs',
    before.some((a) => a.name === 'keepalive'),
    before.map((a) => a.name).join(', '),
  );

  const swBefore = (await chrome.targets()).find(ours);
  await browser.send('Target.closeTarget', { targetId: swBefore.id }).catch(() => {});
  const died = await waitFor(
    async () => !(await chrome.targets()).some(ours),
    10000,
  ).catch(() => false);
  check('service worker was killed', died === true);

  const killMark = { a: fixture.hitsFor('/a'), b: fixture.hitsFor('/b') };
  console.log('  … waiting up to 50s for the keepalive alarm to revive it');
  const revived = await waitFor(
    () => fixture.hitsFor('/a') > killMark.a && fixture.hitsFor('/b') > killMark.b,
    50000,
    1000,
  ).catch(() => false);
  check(
    'sub-30s jobs recover after worker death',
    revived === true,
    `a +${fixture.hitsFor('/a') - killMark.a}, b +${fixture.hitsFor('/b') - killMark.b}`,
  );

  const afterRevive = await msg({ type: 'GET_STATE' });
  check('rehydrated state still has both jobs', Object.keys(afterRevive.jobs).length === 2);
  check('rehydrated intervals are intact', afterRevive.jobs[tabs.a]?.interval === 3 && afterRevive.jobs[tabs.b]?.interval === 4);

  // ======================================================================
  section('Slow job (alarms path, 30s)');

  await msg({ type: 'START', tabId: tabs.c, interval: 30, label: 'Fixture C' });
  const alarmList = await alarms();
  const cAlarm = alarmList.find((a) => a.name === `refresh:${tabs.c}`);
  check('an alarm was created for the slow job', Boolean(cAlarm));
  check('alarm period matches the interval', cAlarm?.periodInMinutes === 0.5, `${cAlarm?.periodInMinutes} min`);

  const beforeC = fixture.hitsFor('/c');
  console.log('  … waiting up to 45s for the alarm to fire');
  const cFired = await waitFor(() => fixture.hitsFor('/c') > beforeC, 45000, 1000).catch(() => false);
  check('alarm-scheduled reload fired', cFired === true, `+${fixture.hitsFor('/c') - beforeC}`);

  // ======================================================================
  section('Tab lifecycle');

  await evaluate(driver, `await chrome.tabs.remove(${tabs.b}); return true;`);
  const afterClose = await waitFor(
    async () => {
      const s = await msg({ type: 'GET_STATE' });
      return s.jobs[tabs.b] ? null : s;
    },
    10000,
  ).catch(() => null);
  check('closing a tab cancels its job', afterClose !== null);
  check('other jobs survive the close', afterClose && Object.keys(afterClose.jobs).length === 2);

  const beforeGhost = fixture.hitsFor('/b');
  await sleep(6000);
  check('no reloads fired at the dead tab', fixture.hitsFor('/b') === beforeGhost);

  // ======================================================================
  section('Preferences and cancel-all');

  const pref = await msg({ type: 'SET_DEFAULT_INTERVAL', seconds: 42 });
  check('default interval saved', pref?.defaultInterval === 42);
  const badPref = await msg({ type: 'SET_DEFAULT_INTERVAL', seconds: 0 });
  check('invalid default rejected', badPref?.ok === false);

  const cleared = await msg({ type: 'CANCEL_ALL' });
  check('CANCEL_ALL empties the job list', Object.keys(cleared.jobs).length === 0);
  check('badge cleared on cancel', (await badge(tabs.a)) === '');
  const leftoverAlarms = await alarms();
  check('no alarms left behind', leftoverAlarms.length === 0, leftoverAlarms.map((a) => a.name).join(', ') || 'none');

  const settled = fixture.hitsFor('/a');
  await sleep(6000);
  check('nothing reloads after cancel-all', fixture.hitsFor('/a') === settled);

  // ---- report ----------------------------------------------------------
  await teardown();

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n[1m${results.length - failed.length}/${results.length} checks passed[0m`,
  );
  if (failed.length) {
    console.log('[31mFailed:[0m');
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void teardown().finally(() => process.exit(130)));
}

main().catch(async (err) => {
  console.error('\n[31mHarness error:[0m', err);
  await teardown().catch(() => {});
  process.exit(1);
});
