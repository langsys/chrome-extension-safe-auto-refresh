# Privacy Policy — Safe Auto Refresh & Page Reloader

Last updated: 29 July 2026

## The short version

This extension does not collect, transmit, sell, or share any data. There is no
server, no analytics, no telemetry, no account, and no remote code.

## What the extension stores

Everything it stores stays on your own computer.

**In `chrome.storage.session`** (Chrome wipes this when the browser closes):

- the numeric tab ID of each tab you started a refresh on
- the interval you chose and whether the job is running or paused
- timestamps for when the job started and last fired
- the optional name you typed for that job, if you typed one

**In `chrome.storage.local`** (persists until you uninstall):

- one number: your preferred default interval

That is the complete list. No browsing history, no page contents, no URLs of
pages you visit, no identifiers.

## What the extension can see

Nothing. That is not a figure of speech.

It requests no host permissions, registers no content scripts, and does not
request `activeTab`, so there is no moment at which it has access to a web page
— not even the one you are looking at when you click it. It does not request
the `tabs` permission either, so tab URLs and titles are invisible to it. It
works with opaque numeric tab IDs and nothing else.

This is why you name jobs yourself: the extension genuinely cannot read the
title of the page you are refreshing.

## Network activity

The extension makes no network requests. None at all. It contacts no server,
and it contains no remote code, no third-party libraries, and no tracking
pixels.

It does not even load favicons: displaying a site's icon would require access to
that site, which it does not have. Unnamed jobs are shown with a coloured dot
derived from the tab ID instead.

## Permissions

| Permission | Why |
| --- | --- |
| `alarms` | Scheduling reloads at 30 seconds or longer, reliably, across service-worker shutdowns. |
| `storage` | Storing the job state and the single default-interval preference described above. |

Neither grants access to any website. There is no third permission.

## Data sharing

None. There is no third party to share with.

## Changes

Any change to this policy will be committed to the public repository, so the
history is auditable:
https://github.com/langsys/chrome-extension-safe-auto-refresh

## Contact

Open an issue:
https://github.com/langsys/chrome-extension-safe-auto-refresh/issues
