# Chrome Web Store submission

Copy-paste source for the developer dashboard. Keep this in sync with
`manifest.json`, `README.md` and `PRIVACY.md` — if they disagree, the listing
is wrong.

Upload artifact: `dist/safe-auto-refresh-<version>.zip` (`npm run package`).

Everything on this page is entered by hand, once. The Chrome Web Store API can
upload a package and publish it, but it cannot set any listing field, upload a
screenshot, or answer a privacy question. See [`docs/PUBLISHING.md`](docs/PUBLISHING.md)
for what is automated and how to set it up.

---

## Store listing

**Name**

```
Safe Auto Refresh & Page Reloader
```

**Summary** (132 char limit)

```
Reload any tab on a timer. Independent per-tab jobs, live state you can trust, and no access to the pages you visit.
```

**Category:** Workflow & Planning
**Language:** English (United States)

**Detailed description**

```
Safe Auto Refresh reloads your tabs on a timer — dashboards, build pipelines,
status boards, ticket queues, anything you would otherwise keep hitting F5 on.

What makes it different is what it does NOT ask for. It requests no host
permissions and registers no content scripts, so it cannot read, modify, or
inject anything into any page you visit. It does not request the "tabs"
permission either, so the addresses of the pages you have open are not visible
to it at all. It reloads tabs by ID, and that is all it can do.


INDEPENDENT PER-TAB JOBS

Start a refresh on as many tabs as you like. Each one keeps its own interval
and its own pause and cancel controls. Starting a job on a second tab never
disturbs the first.


A POPUP THAT TELLS YOU THE TRUTH

Every time you open the popup it reads live state from the background worker.
Reopen it halfway through a run and it shows the real interval, whether the job
is running or paused, and a countdown to the next reload — not a generic
"Ready".

Below that, every other tab with a job is listed, with pause/resume and cancel
on each row. Click a row to jump straight to that tab.


YOU CAN SEE WHAT IS RUNNING WITHOUT OPENING ANYTHING

A badge sits on the toolbar icon per tab: a green refresh mark while that tab
is refreshing, a grey pause mark while it is paused. No more wondering whether
you left something running.


IT KEEPS RUNNING

Chrome shuts down extension background workers after about 30 seconds idle,
which is how a lot of auto-refresh extensions quietly stop working. This one
mirrors every job to session storage and rebuilds them when the worker
restarts, and backs up its fast timers with a Chrome alarm. The test suite
kills the background worker mid-run and asserts that refreshing resumes.


INTERVALS

Anything from 2 seconds to 24 hours. Presets for 5s, 15s, 30s, 1m and 5m, plus
a saved default for new jobs.


PERMISSIONS, AND WHY

- alarms: scheduling reloads of 30 seconds or more reliably, in a way that
  survives Chrome shutting down the background worker.
- storage: holding live job state in session storage so it can be rebuilt, plus
  one saved preference (your default interval).
- activeTab: reading the title and favicon of the tab you press Start on, so
  the job list can say "Production Overview — Grafana" instead of "Tab #4711".
  Granted only for the tab you invoked the extension on, only at that moment.

No host permissions. No content scripts. No remote code. No analytics, no
telemetry, no accounts, no servers. Nothing about your browsing is collected or
transmitted.


OPEN SOURCE

Every claim above is checkable:
https://github.com/langsys/chrome-extension-safe-auto-refresh
```

---

## Privacy tab

**Single purpose description**

```
This extension reloads browser tabs on a timer set by the user. Every part of its interface and code serves that one function: choosing an interval, starting, pausing or cancelling a reload timer for a specific tab, and showing which tabs currently have a timer running.
```

**Permission justifications**

`alarms`

```
Used to schedule the tab reloads that are this extension's only function, at intervals of 30 seconds or longer.

Chrome terminates MV3 service workers after roughly 30 seconds of inactivity, which would kill a setInterval timer held in the worker and silently stop refreshing. chrome.alarms is managed by Chrome, so a scheduled reload still fires after the worker has been shut down.

One additional 30-second "keepalive" alarm wakes the worker so that intervals shorter than 30 seconds can be re-armed after a shutdown.
```

`storage`

```
Two uses, both local to the user's device, neither transmitted anywhere.

chrome.storage.session holds the list of active reload jobs: tab ID, interval, running or paused, timestamps, and the tab title and favicon URL used as the label for that row in the popup. This lets the extension rebuild its state after Chrome shuts down its service worker; without it, reopening the popup could not report what is actually running. Chrome clears session storage when the browser closes.

chrome.storage.local holds a single value: the user's preferred default interval, so it does not have to be re-entered.

No browsing history, page content, or URLs are stored.
```

`activeTab`

```
Used only to read the title and favicon URL of the tab the user invoked the extension on, at the moment they click Start. These label that job in the popup's list of running tabs. Without them the list can only show an opaque numeric tab ID such as "Tab #4711".

The extension requests no host permissions and does not request the "tabs" permission, so it has no other way to identify a tab to the user, and no ability to read or modify page content. activeTab applies to one tab at a time, only on explicit user action.
```

**Remote code:** No, the extension does not use remote code. All JavaScript is
included in the package; there are no third-party libraries, no CDN loads, and
no `eval`.

**Data usage — collected data types:** none.

Certifications:

- Not being sold to third parties.
- Not being used or transferred for purposes unrelated to the item's single
  purpose.
- Not being used or transferred to determine creditworthiness or for lending
  purposes.

**Privacy policy URL**

```
https://github.com/langsys/chrome-extension-safe-auto-refresh/blob/main/PRIVACY.md
```

---

## Graphics

Uploading the zip does **not** populate any of these. The package and the
listing are separate: nothing in `manifest.json`, including its `icons` block,
reaches the store listing. Every file below is a manual upload under
**Store listing → Graphics**, one field at a time.

| Dashboard field | File | Size | Required |
| --- | --- | --- | --- |
| Store icon | `assets/store/store-icon-128.png` | 128×128 | yes |
| Screenshots (up to 5) | `assets/store/screenshot-1-running.png` | 1280×800 | at least 1 |
| | `assets/store/screenshot-2-idle.png` | 1280×800 | |
| | `assets/store/screenshot-3-multi.png` | 1280×800 | |
| | `assets/store/screenshot-4-privacy.png` | 1280×800 | |
| Small promo tile | `assets/store/promo-small-440x280.png` | 440×280 | no |
| Marquee promo tile | `assets/store/promo-marquee-1400x560.png` | 1400×560 | no |

The promo tiles are optional, but the store needs the small tile to place the
item in its browsing pages, and the marquee for any featured slot.

Screenshots 1–3 are captured from the extension actually running
(`npm run store-assets`), not mocked up.

---

## Pre-submission checklist

- [ ] `npm test` green
- [ ] `npm run package` produces a zip containing only the ten extension files
- [ ] `manifest.json` version bumped and matching `package.json`
- [ ] `CHANGELOG.md` updated
- [ ] Screenshots regenerated if the popup UI changed
- [ ] Privacy policy URL resolves on the default branch
