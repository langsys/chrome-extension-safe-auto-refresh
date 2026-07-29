# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [semver](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-07-29

Drops the last permission that touched a web page.

### Removed

- **The `activeTab` permission.** It was used only to read a tab's title and
  favicon so a job could be labelled automatically. The cost was out of
  proportion: `activeTab` grants temporary access to the tab you clicked, so
  Chrome listed the extension under "Full access — these extensions can see and
  change information on this site", next to password managers, from the moment
  you used it. For an extension whose whole argument is that it cannot touch
  your pages, that was the wrong trade.

  The extension now holds no site access under any circumstance, and makes no
  network requests at all — including for favicons, which it can no longer
  fetch.

### Added

- **Optional job names.** Type a name when starting a job ("prod dashboard",
  "build #4821") and it labels that row. Unnamed jobs show as `Tab #4711` with a
  colour derived from the tab ID so rows stay distinguishable.
- `SET_LABEL` message, replacing `REFRESH_LABEL`.

### Changed

- Listing and documentation corrected throughout. The 1.0.0 copy claimed "no
  access to the pages you visit" and "it cannot read your pages", which
  overstated what `activeTab` allowed even though the code never used it for
  more than a title. Those claims are now true rather than merely nearly true.

## [1.0.0] — 2026-07-28

First release. A ground-up rewrite of an earlier private auto-refresh
extension, which was safe but did not work reliably.

### Added

- Independent per-tab refresh jobs. Starting a job on one tab never touches
  another.
- A popup that reads live state from the service worker every time it opens:
  current interval, running or paused, and a countdown to the next reload.
- A list of every other tab with a job, each row with pause/resume and cancel.
  Clicking a row focuses that tab.
- Per-tab toolbar badge — `↻` while refreshing, `‖` while paused — so a
  running job is visible without opening anything.
- Hybrid scheduling: `chrome.alarms` at 30s and above, `setInterval` below,
  with a 30s keepalive alarm that revives sub-30s jobs if the service worker
  is shut down.
- Job state mirrored to `chrome.storage.session` and rehydrated on worker
  startup, including dropping jobs whose tabs closed while it was asleep.
- Saved default interval, interval presets, and cancel-all.
- End-to-end test suite that drives a real browser and verifies reloads by
  counting requests at a fixture server.

### Fixed, relative to the extension this replaces

- The popup no longer reports a hardcoded "Ready" regardless of actual state.
- Starting a second job no longer silently cancels the first.
- Intervals above 30 seconds no longer stop firing when Chrome shuts the
  service worker down.
- The `storage` permission is now actually used, rather than requested and
  ignored.
- The README describes the architecture that is in the code.

[1.0.1]: https://github.com/langsys/chrome-extension-safe-auto-refresh/releases/tag/v1.0.1
[1.0.0]: https://github.com/langsys/chrome-extension-safe-auto-refresh/releases/tag/v1.0.0
