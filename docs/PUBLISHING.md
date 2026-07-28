# Publishing

Releases are automated with one hard limit: **the Chrome Web Store API only
moves bytes and flips the publish switch.** Listing copy, screenshots, promo
tiles, category and the privacy disclosures live in the developer dashboard and
cannot be set by any API. `STORE_LISTING.md` is the source of truth for those;
someone pastes it in by hand.

| Automated | By hand, in the dashboard |
| --- | --- |
| Upload a new version | Creating the item the first time |
| Publish (public, trusted testers, staged %) | Listing copy and graphics |
| Version/tag consistency checks | Privacy and permission justifications |
| Running the test suite before release | The one-time $5 developer fee |
| GitHub release with the zip attached | Answering a review rejection |

## One-time setup

You need four secrets. Getting them takes about forty minutes, once.

### 1. Register and create the item

1. Pay the one-time $5 fee at the
   [developer dashboard](https://chrome.google.com/webstore/devconsole/).
2. **Add new item**, upload `dist/safe-auto-refresh-<version>.zip`
   (`npm run package`).
3. Fill in the listing from [`STORE_LISTING.md`](../STORE_LISTING.md) and upload
   the graphics from `assets/store/`.
4. Submit for review.
5. Copy the **item ID** out of the dashboard URL — a 32-character string. That
   is `CWS_ITEM_ID`.

The API cannot do any of this. It can only update an item that already exists.

### 2. Create an OAuth client

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project (or reuse one).
2. **APIs & Services → Library →** enable the **Chrome Web Store API**.
3. **APIs & Services → OAuth consent screen**: configure it, then **publish the
   app so its status is "In production"**.

   This step is not optional. While the consent screen sits in "Testing",
   Google expires refresh tokens after **seven days**, and your release
   pipeline breaks with `invalid_grant` a week after you set it up.

4. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   application type **Desktop app**. A "Web application" client will refuse the
   `http://localhost` redirect this uses.

   That gives you `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET`.

### 3. Mint a refresh token

```bash
CWS_CLIENT_ID=xxx CWS_CLIENT_SECRET=yyy node scripts/get-refresh-token.mjs
```

It opens a consent page, catches the redirect on localhost, and prints
`CWS_REFRESH_TOKEN`. Use the Google account that owns the Web Store item.

### 4. Verify, then store the secrets

```bash
export CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... CWS_REFRESH_TOKEN=... CWS_ITEM_ID=...
npm run package
node scripts/publish.mjs --dry-run
```

`--dry-run` checks the credentials, confirms the item exists and confirms the
version is new, without uploading anything.

Then add all four as repository secrets:
**Settings → Secrets and variables → Actions → New repository secret.**

## Releasing

```bash
# bump "version" in manifest.json AND package.json, update CHANGELOG.md
git commit -am "v1.0.1"
git tag v1.0.1
git push && git push --tags
```

The workflow runs the end-to-end suite, builds the zip, checks the tag matches
the manifest, uploads the version as a **draft**, and creates a GitHub release.

It deliberately does not publish to users. Publishing queues a review that CI
cannot cancel and whose outcome arrives by email hours or days later, so it
should be a decision, not a side effect of tagging.

To publish, either:

- **Actions → Release → Run workflow**, tick *publish*, pick a target; or
- set the repository variable `CWS_AUTO_PUBLISH` to `true` to publish on every
  tag.

### Manually

```bash
npm run package
node scripts/publish.mjs --upload-only              # draft
node scripts/publish.mjs --target=trustedTesters    # to your test group
node scripts/publish.mjs                            # to everyone
node scripts/publish.mjs --percentage=20            # staged rollout
```

## When it goes wrong

**`invalid_grant` on the token exchange.** Almost always the OAuth consent
screen is back in "Testing" mode, or the token was revoked. Set it to "In
production" and re-run `scripts/get-refresh-token.mjs`.

**"Version already exists".** The store refuses a re-upload of a version it
already has. Bump `manifest.json` and `package.json` together — `npm run
package` fails if they disagree.

**Nothing happens after a green pipeline.** Expected. Publishing submits for
review; it does not ship. Watch the dashboard or your email.

**A rejection.** Arrives by email, never in CI. With `activeTab` and a "no page
access" pitch, expect questions on the first submission — which is why the
permission justifications in `STORE_LISTING.md` are written as prose a reviewer
can read rather than one-liners.
