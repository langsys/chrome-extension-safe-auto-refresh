// Tiny no-cache HTTP server used as the reload target in the e2e run.
// Every reload of a fixture page is a fresh GET, so the request counter is a
// trustworthy record of how many times the extension actually reloaded a tab.

import { createServer } from 'node:http';

export function startFixtureServer(port = 0) {
  /** @type {Map<string, number>} */
  const hits = new Map();

  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
    });
    res.end(page(path, hits.get(path)));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        origin: `http://127.0.0.1:${actual}`,
        hitsFor: (path) => hits.get(path) ?? 0,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function page(path, count) {
  const name = path.replace(/^\//, '') || 'index';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${name} — load #${count}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#0969da"/></svg>`,
  )}">
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;
       font:16px system-ui,sans-serif;background:#0d1117;color:#cdd9e5}
  .n{font-size:72px;font-weight:700;font-variant-numeric:tabular-nums}
</style></head>
<body><div><div class="n">${count}</div><div>loads of /${name}</div></div></body></html>`;
}
