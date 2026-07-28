# Privacy Policy — Safe Auto Refresh & Page Reloader

Last updated: 28 July 2026

## The short version

This extension does not collect, transmit, sell, or share any data. There is no
server, no analytics, no telemetry, no account, and no remote code.

## What the extension stores

Everything it stores stays on your own computer.

**In `chrome.storage.session`** (Chrome wipes this when the browser closes):

- the numeric tab ID of each tab you started a refresh on
- the interval you chose and whether the job is running or paused
- timestamps for when the job started and last fired
- the title and favicon URL of the tab, captured at the moment you pressed
  Start, used only to label the row in the popup

**In `chrome.storage.local`** (persists until you uninstall):

- one number: your preferred default interval

That is the complete list. No browsing history, no page contents, no URLs of
pages you visit, no identifiers.

## What the extension can see

It requests no host permissions and registers no content scripts, so it cannot
read, modify, or inject anything into any web page. It does not request the
`tabs` permission, so tab URLs are not visible to it at all — it works with
opaque numeric tab IDs.

The `activeTab` permission lets it read the title and favicon of one tab: the
one that is active at the moment you open the popup. That is what makes the
popup able to say "Grafana Dashboard" instead of "Tab #4711".

## Network activity

The extension makes no network requests of its own. It contacts no server, and
it contains no remote code, no third-party libraries, and no tracking pixels.

One clarification, because we would rather be precise than sound better than we
are: the popup displays each job's favicon using the URL the tab reports for it.
When that is an `https://` URL, your browser loads that image — almost always
from the cache it already populated to draw the tab strip. That request goes to
the site whose tab you are refreshing, contains no information about you beyond
a normal image request, and is sent with `referrerpolicy="no-referrer"`. It is
the only network activity the extension can cause.

## Permissions

| Permission | Why |
| --- | --- |
| `alarms` | Scheduling reloads at 30 seconds or longer, reliably, across service-worker shutdowns. |
| `storage` | Storing the job state and the single default-interval preference described above. |
| `activeTab` | Reading the current tab's title and favicon to label jobs in the popup. |

## Data sharing

None. There is no third party to share with.

## Changes

Any change to this policy will be committed to the public repository, so the
history is auditable:
https://github.com/langsys/chrome-extension-safe-auto-refresh

## Contact

Open an issue:
https://github.com/langsys/chrome-extension-safe-auto-refresh/issues
