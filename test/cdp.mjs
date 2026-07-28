// Minimal Chrome DevTools Protocol client — just enough to launch Chrome with
// the extension loaded, attach to a page, and evaluate code in it.
// No dependencies: Node 22+ ships a global WebSocket.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Chrome derives an unpacked extension's ID from the absolute path: sha256,
 * first 16 bytes, hex digits remapped 0-f -> a-p. Knowing it up front lets us
 * pick our own service worker out of Chrome's built-in component extensions.
 */
export function extensionIdFromPath(absPath) {
  const hex = createHash('sha256').update(absPath, 'utf8').digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/**
 * Chrome 137+ ships a kill switch for the --load-extension command line flag,
 * and in stable Chrome 150 it stays off even with the feature disabled — the
 * extension silently never loads. "Chrome for Testing" (what Playwright and
 * gstack's browse daemon download) still honours it, so prefer that build.
 */
async function chromeCandidates() {
  const { glob } = await import('node:fs/promises');
  const { homedir } = await import('node:os');

  const found = [];
  const patterns = [
    `${homedir()}/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${homedir()}/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`,
  ];
  for (const pattern of patterns) {
    try {
      for await (const hit of glob(pattern)) found.push(hit);
    } catch {
      // glob is Node 22+; fall through to the fixed paths below.
    }
  }
  // Newest build directory first.
  found.sort().reverse();

  return [
    ...found,
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
}

export async function launchChrome({ extensionPath, headless = true, extraArgs = [] }) {
  const { existsSync } = await import('node:fs');
  const binary =
    process.env.CHROME_PATH ?? (await chromeCandidates()).find((p) => existsSync(p));
  if (!binary) throw new Error('No Chrome binary found. Set CHROME_PATH.');

  const profile = await mkdtemp(join(tmpdir(), 'sar-profile-'));
  const args = [
    // Port 0 = let the OS pick, then read it back from DevToolsActivePort.
    // A fixed port risks attaching to someone else's browser — including the
    // user's own, if they run Chrome with remote debugging enabled.
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--load-extension=${extensionPath}`,
    `--disable-extensions-except=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Chrome 137+ ignores --load-extension unless this kill switch is disabled.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
    // CI runners restrict the user namespaces Chrome's sandbox needs, and
    // /dev/shm is small in containers. Both are safe here (throwaway profile,
    // local fixture pages) and neither is used on a developer machine.
    ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ...extraArgs,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  // detached => the child leads its own process group, so we can signal the
  // whole tree. Killing only the browser process orphans Chrome's renderer,
  // GPU and utility helpers.
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(d.toString()));

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const fail = (err) => {
    child.kill('SIGKILL');
    throw new Error(`${err.message}\nChrome stderr:\n${stderr.join('')}`);
  };

  // Chrome writes the port it actually bound into DevToolsActivePort.
  const { readFile } = await import('node:fs/promises');
  const port = await waitFor(async () => {
    const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => null);
    const value = Number(text?.split('\n')[0]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }, 20000).catch(fail);

  const version = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    return res?.ok ? res.json() : null;
  }, 20000).catch(fail);

  return {
    version,
    port,
    extensionId: extensionIdFromPath(extensionPath),
    browserWsUrl: version.webSocketDebuggerUrl,
    async targets() {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      return res.json();
    },
    async close() {
      const signalGroup = (signal) => {
        try {
          process.kill(-child.pid, signal); // negative pid => process group
        } catch {
          // Group already gone.
        }
      };

      // Ask Chrome to shut down cleanly first: it reaps its own helpers.
      try {
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise((resolve) => {
          ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
            resolve();
          });
          ws.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 2000);
        });
      } catch {
        // Fall through to signals.
      }

      for (let i = 0; i < 30 && !exited; i++) await sleep(100);
      if (!exited) {
        signalGroup('SIGTERM');
        for (let i = 0; i < 20 && !exited; i++) await sleep(100);
      }
      signalGroup('SIGKILL');
      await sleep(200);

      // Last resort: anything still holding THIS run's profile directory.
      // Deleting the profile out from under a live helper is what makes Chrome
      // pop "Something went wrong when opening your profile" dialogs later.
      // The path is a unique mkdtemp name, so this cannot match anything else.
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync('pkill', ['-9', '-f', profile], { stdio: 'ignore' });
        await sleep(300);
      } catch {
        // pkill exits non-zero when nothing matched, which is the good case.
      }

      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${url}`)), {
      once: true,
    });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
    });
  }

  return {
    send,
    on: (fn) => listeners.add(fn),
    close: () => ws.close(),
    /** Attach to a target and return a session-bound send(). */
    async attach(targetId) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      return {
        sessionId,
        send: (method, params) => send(method, params, sessionId),
      };
    },
  };
}

/** Evaluate an async function body in a page/worker session. */
export async function evaluate(session, body) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
    expression: `(async () => {\n${body}\n})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

export async function waitFor(fn, timeoutMs = 10000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
