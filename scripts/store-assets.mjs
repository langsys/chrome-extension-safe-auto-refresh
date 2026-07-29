// Builds every Chrome Web Store image asset.
//
// The popup shots are captured from the REAL extension running in a real
// browser, not from a mockup, so a UI change that breaks the layout also
// breaks the store assets.
//
//   node scripts/store-assets.mjs
//
// Outputs to assets/store/. Needs rsvg-convert and ImageMagick.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { connect, evaluate, launchChrome, sleep, waitFor } from '../test/cdp.mjs';
import { startFixtureServer } from '../test/fixture-server.mjs';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'store');
const RAW = join(OUT, 'raw');

const BRAND = { deep: '#0f5f2c', mid: '#1a7f37', light: '#2ea043' };
const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';

// Names are typed by the user in the real product, so they are typed here too.
const TABS = [
  { path: '/grafana', label: 'prod dashboard', interval: 30 },
  { path: '/ci', label: 'build #4821', interval: 60 },
  { path: '/status', label: 'status board', interval: 15 },
];

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function capturePopupShots() {
  const fixture = await startFixtureServer();
  const chrome = await launchChrome({ extensionPath: ROOT, headless: true });
  const browser = await connect(chrome.browserWsUrl);

  try {
    const ours = (t) => t.url.includes(chrome.extensionId);
    const swT = await waitFor(
      async () => (await chrome.targets()).find((t) => t.type === 'service_worker' && ours(t)),
      20000,
    );
    const sw = await browser.attach(swT.id);
    await sw.send('Runtime.enable');

    // Real tabs, opened in reverse so the first entry ends up active last.
    const ids = [];
    for (const tab of TABS) {
      const id = await evaluate(
        sw,
        `const t = await chrome.tabs.create({ url: '${fixture.origin}${tab.path}', active: true });
         return t.id;`,
      );
      ids.push(id);
    }
    await sleep(1500);

    // popup.html is rendered in a background tab rather than as the real action
    // popup. The action popup rejects Emulation.setDeviceMetricsOverride and its
    // window clips to ~200px in headless, so it cannot be captured whole. A
    // background tab renders identical markup, and because it is NOT the active
    // tab, the popup's own tabs.query still resolves to the fixture page behind
    // it — which is exactly the state a user sees.
    const stage = await openPopupTab(chrome, browser, sw);
    const msg = (payload) =>
      evaluate(stage.session, `return chrome.runtime.sendMessage(${JSON.stringify(payload)});`);

    for (const [i, tab] of TABS.entries()) {
      await msg({
        type: 'START',
        tabId: ids[i],
        interval: tab.interval,
        label: tab.label,
      });
    }

    // --- shot 1: running on the active tab, two others listed --------------
    await shoot(sw, stage, ids[0], join(RAW, 'running.png'));

    // --- shot 2: one of the others paused ---------------------------------
    await msg({ type: 'PAUSE', tabId: ids[2] });
    await shoot(sw, stage, ids[0], join(RAW, 'paused.png'));

    // --- shot 3: idle, ready to start -------------------------------------
    await msg({ type: 'CANCEL', tabId: ids[0] });
    await shoot(sw, stage, ids[0], join(RAW, 'idle.png'));
  } finally {
    browser.close();
    await chrome.close();
    await fixture.close();
  }
}

async function openPopupTab(chrome, browser, sw) {
  const tabId = await evaluate(
    sw,
    `const t = await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false });
     return t.id;`,
  );
  const target = await waitFor(
    async () =>
      (await chrome.targets()).find((t) => t.type === 'page' && t.url.endsWith('/popup.html')),
    10000,
  );
  const session = await browser.attach(target.id);
  await session.send('Runtime.enable');
  await settle(session);
  return { tabId, target, session };
}

/** Wait until popup.js has finished its first render. */
async function settle(session) {
  await waitFor(async () => (await evaluate(session, 'return document.readyState')) === 'complete');
  // Exactly one of the two views is revealed once state has been fetched.
  await waitFor(
    async () =>
      evaluate(
        session,
        'return !document.getElementById("idle-view").hidden || !document.getElementById("active-view").hidden',
      ),
    8000,
  );
  await sleep(600); // countdown paints on its first tick
}

async function shoot(sw, stage, subjectTabId, outPath) {
  // Put the page we want the popup to describe back in front, then re-render.
  await evaluate(sw, `await chrome.tabs.update(${subjectTabId}, { active: true }); return 1;`);
  await sleep(300);
  await stage.session.send('Page.reload');
  await settle(stage.session);

  const size = await evaluate(
    stage.session,
    'return { w: document.body.scrollWidth, h: document.body.scrollHeight }',
  );

  // Grow the viewport to the whole popup instead of using captureBeyondViewport
  // with a clip — that path re-rasterises past the layout viewport and tiles the
  // content, which silently produced a screenshot containing two headers.
  await stage.session.send('Emulation.setDeviceMetricsOverride', {
    width: size.w,
    height: size.h,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await sleep(300);
  const { data } = await stage.session.send('Page.captureScreenshot', { format: 'png' });
  await stage.session.send('Emulation.clearDeviceMetricsOverride').catch(() => {});

  await writeFile(outPath, Buffer.from(data, 'base64'));
  console.log(`  captured ${outPath.split('/').pop()} (css ${size.w}x${size.h})`);
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

async function svgToPng(svg, out, width, height) {
  const tmp = `${out}.svg`;
  await writeFile(tmp, svg);
  await run('rsvg-convert', ['-w', String(width), '-h', String(height), tmp, '-o', out]);
  await run('rm', ['-f', tmp]);
}

async function embed(path) {
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

function slide({ width, height, eyebrow, headline, sub, shotHref, shotW, shotH, shotY }) {
  const shotX = Math.round((width - shotW) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#f7fbf8"/><stop offset="1" stop-color="#e4ede7"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.05" r="0.75">
      <stop offset="0" stop-color="${BRAND.light}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${BRAND.light}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#0b2f18" flood-opacity="0.22"/>
    </filter>
    <clipPath id="round">
      <rect x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" rx="12" ry="12"/>
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <text x="${width / 2}" y="76" text-anchor="middle" font-family="${FONT}" font-size="17"
        font-weight="700" letter-spacing="2.4" fill="${BRAND.mid}">${eyebrow}</text>
  <text x="${width / 2}" y="132" text-anchor="middle" font-family="${FONT}" font-size="42"
        font-weight="700" fill="#132018">${headline}</text>
  <text x="${width / 2}" y="172" text-anchor="middle" font-family="${FONT}" font-size="20"
        fill="#4a5b50">${sub}</text>
  <rect x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" rx="12" ry="12"
        fill="#ffffff" filter="url(#shadow)"/>
  <image href="${shotHref}" x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}"
         clip-path="url(#round)" preserveAspectRatio="xMidYMin slice"/>
  <rect x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" rx="12" ry="12"
        fill="none" stroke="#c9d6cd" stroke-width="1"/>
</svg>`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function composeSlides() {
  const shots = [
    {
      file: 'running.png',
      out: 'screenshot-1-running.png',
      eyebrow: 'ALWAYS KNOWS WHAT IS RUNNING',
      headline: 'Reopen the popup. Get the truth.',
      sub: 'Live interval, live countdown, and every other tab with a job.',
    },
    {
      file: 'idle.png',
      out: 'screenshot-2-idle.png',
      eyebrow: 'ONE CLICK TO START',
      headline: 'Name it, time it, start it',
      sub: 'Give the job a name you will recognise later. 2 seconds to 24 hours.',
    },
    {
      file: 'paused.png',
      out: 'screenshot-3-multi.png',
      eyebrow: 'INDEPENDENT PER-TAB JOBS',
      headline: 'Pause one. The rest keep going.',
      sub: 'No shared slot, no silent takeover. Click a row to jump to that tab.',
    },
  ];

  for (const shot of shots) {
    const raw = join(RAW, shot.file);
    const { stdout } = await run('identify', ['-format', '%w %h', raw]);
    const [w, h] = stdout.trim().split(' ').map(Number);

    // The capture is @2x, so CSS pixels are w/2 by h/2. Scale it up for the
    // slide, but never past the space left below the headline block.
    const TOP = 208;
    const BOTTOM_MARGIN = 44;
    const scale = Math.min(1.7, (800 - TOP - BOTTOM_MARGIN) / (h / 2));
    const shotW = Math.round((w / 2) * scale);
    const shotH = Math.round((h / 2) * scale);
    const svg = slide({
      width: 1280,
      height: 800,
      eyebrow: esc(shot.eyebrow),
      headline: esc(shot.headline),
      sub: esc(shot.sub),
      shotHref: await embed(raw),
      shotW,
      shotH,
      shotY: TOP + Math.round((800 - TOP - BOTTOM_MARGIN - shotH) / 2),
    });
    await svgToPng(svg, join(OUT, shot.out), 1280, 800);
    console.log(`  composed ${shot.out}`);
  }
}

async function composePrivacySlide() {
  const rows = [
    ['alarms', 'Reliable scheduling at 30s and above'],
    ['storage', 'Job state in session, one saved preference'],
  ];
  // Every line here is now literally true: with activeTab gone the extension
  // holds no site access of any kind, and there are no favicons to fetch.
  const absent = [
    'No host permissions',
    'No content scripts',
    'No activeTab',
    'No network requests',
    'No data collection',
    'No remote code',
  ];

  const TOP = 312;
  const rowSvg = rows
    .map(
      ([name, why], i) => `
    <g transform="translate(150, ${TOP + i * 88})">
      <rect x="0" y="-30" width="440" height="60" rx="10" fill="#ffffff" stroke="#cfdcd4"/>
      <text x="20" y="-4" font-family="ui-monospace, Menlo, monospace" font-size="18"
            font-weight="700" fill="${BRAND.deep}">${name}</text>
      <text x="20" y="18" font-family="${FONT}" font-size="14" fill="#5c6d63">${esc(why)}</text>
    </g>`,
    )
    .join('');

  const absentSvg = absent
    .map(
      (label, i) => `
    <g transform="translate(700, ${TOP + i * 44})">
      <circle cx="10" cy="-4" r="9" fill="#e8f2ec" stroke="${BRAND.light}"/>
      <path d="M6 -4 L9 -1 L15 -8" fill="none" stroke="${BRAND.mid}" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
      <text x="32" y="1" font-family="${FONT}" font-size="17" fill="#243b2e">${esc(label)}</text>
    </g>`,
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#f7fbf8"/><stop offset="1" stop-color="#e4ede7"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="800" fill="url(#bg)"/>
  <text x="640" y="128" text-anchor="middle" font-family="${FONT}" font-size="17"
        font-weight="700" letter-spacing="2.4" fill="${BRAND.mid}">PRIVACY BY CONSTRUCTION</text>
  <text x="640" y="186" text-anchor="middle" font-family="${FONT}" font-size="42"
        font-weight="700" fill="#132018">No access to any website. At all.</text>
  <text x="640" y="226" text-anchor="middle" font-family="${FONT}" font-size="20"
        fill="#4a5b50">Two permissions, neither of which touches a single web page.</text>
  <text x="150" y="272" font-family="${FONT}" font-size="13" font-weight="700"
        letter-spacing="1.6" fill="#6b7d72">WHAT IT ASKS FOR</text>
  <text x="700" y="272" font-family="${FONT}" font-size="13" font-weight="700"
        letter-spacing="1.6" fill="#6b7d72">WHAT IT DOES NOT</text>
  ${rowSvg}
  ${absentSvg}
  <text x="640" y="684" text-anchor="middle" font-family="${FONT}" font-size="17" fill="#4a5b50">
    Open source. Every claim on this slide is checkable in the manifest.
  </text>
</svg>`;
  await svgToPng(svg, join(OUT, 'screenshot-4-privacy.png'), 1280, 800);
  console.log('  composed screenshot-4-privacy.png');
}

async function composePromoTiles() {
  const icon = await embed(join(ROOT, 'icons', 'icon-128.png'));

  const tile = (w, h, iconSize, titleSize, subSize) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.light}"/><stop offset="1" stop-color="${BRAND.deep}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${w * 0.86}" cy="${h * 0.12}" r="${h * 0.42}" fill="#ffffff" opacity="0.06"/>
  <circle cx="${w * 0.1}" cy="${h * 0.92}" r="${h * 0.34}" fill="#ffffff" opacity="0.05"/>
  <image href="${icon}" x="${(w - iconSize) / 2}" y="${h * 0.17}"
         width="${iconSize}" height="${iconSize}"/>
  <text x="${w / 2}" y="${h * 0.17 + iconSize + titleSize + 12}" text-anchor="middle"
        font-family="${FONT}" font-size="${titleSize}" font-weight="700" fill="#ffffff">
    Safe Auto Refresh
  </text>
  <text x="${w / 2}" y="${h * 0.17 + iconSize + titleSize + subSize + 26}" text-anchor="middle"
        font-family="${FONT}" font-size="${subSize}" fill="#d6f0de">
    Per-tab reloads. Zero site access.
  </text>
</svg>`;

  await svgToPng(tile(440, 280, 76, 30, 16), join(OUT, 'promo-small-440x280.png'), 440, 280);
  console.log('  composed promo-small-440x280.png');
  await svgToPng(tile(1400, 560, 150, 62, 30), join(OUT, 'promo-marquee-1400x560.png'), 1400, 560);
  console.log('  composed promo-marquee-1400x560.png');

  await run('cp', [join(ROOT, 'icons', 'icon-128.png'), join(OUT, 'store-icon-128.png')]);
  console.log('  copied store-icon-128.png');
}

// ---------------------------------------------------------------------------

await mkdir(RAW, { recursive: true });
console.log('Capturing the real popup…');
await capturePopupShots();
console.log('Composing store slides…');
await composeSlides();
await composePrivacySlide();
await composePromoTiles();
console.log('\nDone. Assets in assets/store/');
