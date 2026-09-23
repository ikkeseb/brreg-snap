# Release runbook

The one place for how a version gets from `main` to both stores. Every
step is a script or a workflow; the only hand-written parts are the
CHANGELOG entries, the store release notes and the approval click.

## The flow

1. **Changes land on `main`** with entries under `## [Unreleased]` in
   `CHANGELOG.md`, and CI goes green.
2. **`pnpm release X.Y.Z`** (on `main`, clean tree, up to date with
   origin, CI green for `HEAD`, a non-empty `[Unreleased]`). It sets
   the version in `package.json` and both `public/manifest.*.json`,
   turns `[Unreleased]` into `## [X.Y.Z] — YYYY-MM-DD` under a fresh
   empty `[Unreleased]`, runs `pnpm verify`, and renders the
   submission kit `docs/submission-kit/X.Y.Z/{amo,cws}.md` from
   `docs/submission-kit/templates/`. Nothing is committed yet.
   `--dry-run` runs the checks and prints every step without writing.
   No `gh` on the machine: pass `--skip-ci-check` and check the CI run
   on GitHub yourself.
3. **Write the store release notes** in
   `docs/submission-kit/X.Y.Z/amo.md` over the two `TODO(store-notes)`
   lines: nb-NO and en-US, a few plain lines each. Line breaks inside
   a paragraph are fine: the publisher joins them (AMO keeps every
   newline). Everything else in the kit is generated: fix wording in
   the canonical docs (`docs/amo-submission.md`,
   `docs/cws-submission.md`, `PRIVACY.md`, `CHANGELOG.md`) and re-run,
   never in the kit.
4. **`pnpm release X.Y.Z --tag`** refuses while a TODO is left or
   anything but the release files changed, then commits
   `release: X.Y.Z` and creates the annotated tag `vX.Y.Z`. It never
   pushes; it prints `git push --atomic origin main vX.Y.Z` (the
   pre-push hook runs `pnpm verify`).
5. **`release.yml`** (on the tag):
   - `build` (read-only token): `pnpm verify`, tag == `package.json`
     version, a non-empty CHANGELOG section for the tag, the three zips,
     `scripts/verify-package.mjs` on them (manifest invariants, file
     set, no maps, stamped version; sha256 into the job summary).
   - `reproduce`: unzips the source zip, frozen install,
     `pnpm package:firefox`, and diffs the result against the release
     zip, the way an AMO reviewer rebuilds it (`BUILD.md`).
   - `publish` (no checkout): build provenance for each zip
     (`actions/attest`), then the GitHub Release with the CHANGELOG
     section as notes.
6. **Publish to the stores:** Actions → **Publish to stores** → Run
   workflow → version `X.Y.Z`, stores `both`, `dry_run` on. Approve it
   in the `store-publish` environment and read the plan in the log.
   Then run it again with `dry_run` off and approve. The workflow
   downloads the Release assets (never rebuilds), checks them against
   the Release's sha256 digests, the `release.yml` attestation
   (`gh attestation verify`) and `verify-package.mjs`, then:
   - **AMO** (`scripts/publish-amo.mjs`, API v5): uploads
     `brreg-snap-X.Y.Z.zip` to the listed channel, waits for
     validation, creates the version with the kit's release notes
     (nb-NO, en-US) and reviewer notes, attaches
     `brreg-snap-source-X.Y.Z.zip`.
   - **CWS** (`scripts/publish-cws.mjs`, API v2): uploads
     `brreg-snap-chrome-X.Y.Z.zip` and submits it for review; it goes
     live when review passes.
   - Tags what went up: annotated `amo-submission-X.Y.Z` /
     `cws-submission-X.Y.Z` on the `vX.Y.Z` commit, the message
     carrying asset names and sha256.
7. **By hand, only if this release changed them:** listing text and
   the privacy policy (see [What stays manual](#what-stays-manual)).

### When a store run fails or is skipped

- A store with no keys in the environment is skipped with a notice;
  the other still runs. A store whose `*-submission-X.Y.Z` tag exists
  is skipped too, so re-running after a partial failure only retries
  the store that didn't go up.
- AMO creates the version before attaching the source. If only the
  source step failed, the log says so: upload the source zip on the
  version's page in the AMO Developer Hub, then create the tag by hand
  (below).
- The attestation check needs a Release built by this `release.yml`;
  Releases up to v1.3.1 have none, so the workflow can't publish them.

### Manual fallback

If the workflow can't run, upload the same Release assets by hand
(AMO Developer Hub → the add-on → Upload New Version; CWS Developer
Dashboard → the item → Package → Upload new package) with the text
from the kit, then record it:

```bash
gh release view vX.Y.Z --json assets --jq '.assets[] | [.name, .digest] | @tsv'
git tag -a amo-submission-X.Y.Z 'vX.Y.Z^{commit}' -m "AMO X.Y.Z: brreg-snap-X.Y.Z.zip sha256:… source brreg-snap-source-X.Y.Z.zip sha256:…"
git tag -a cws-submission-X.Y.Z 'vX.Y.Z^{commit}' -m "CWS X.Y.Z: brreg-snap-chrome-X.Y.Z.zip sha256:…"
git push origin amo-submission-X.Y.Z cws-submission-X.Y.Z
```

## What stays manual

Store APIs submit packages, not listings. These stay edits in Seb's
logged-in browser, from the kit, and only when the release changed
them (before each change, one line to Seb: version, store, what
changes):

- **AMO:** summary and description (nb-NO, en-US), and the privacy
  policy field, which gets the reflowed `PRIVACY.md` from the kit
  (AMO keeps every newline and renders no headings or tables).
  Screenshots.
- **CWS:** store listing description, privacy practices tab,
  screenshots. The privacy policy URL serves `PRIVACY.md` on `main`.

## One-time setup (Seb)

Agents never create, see or store these keys. Everything lives in one
GitHub environment, so only an approved `publish.yml` run can read it.

### 1. The `store-publish` environment

GitHub → the repository → **Settings** → **Environments** → **New
environment** → name `store-publish` → **Configure environment**:

- **Required reviewers**: add yourself → **Save protection rules**.
  Leave **Prevent self-review** off: you both start and approve the
  run.
- **Deployment branches and tags**: **Selected branches and tags** →
  **Add deployment branch or tag rule** → Branch `main`, so only the
  workflow as it is on `main` gets the keys.
- The keys below go under **Environment secrets** → **Add secret**;
  the two ids under **Environment variables** → **Add variable**.

Source: <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>.

### 2. AMO API key

1. Signed in to AMO as the add-on's author, open
   <https://addons.mozilla.org/developers/addon/api/key/> and generate
   credentials (the button's label wasn't checked: the page needs a
   login).
2. Environment secret `AMO_JWT_ISSUER` = the **JWT issuer**
   (`user:…`), `AMO_JWT_SECRET` = the **JWT secret**.

The publisher signs a fresh HS256 JWT for every request (`iss`, a
random `jti`, `iat`, `exp` = `iat` + 60 s), as
<https://mozilla.github.io/addons-server/topics/api/auth.html>
specifies.

### 3. Chrome Web Store API: a service account

Preferred over an OAuth client: an OAuth consent screen left in
"Testing" issues refresh tokens that expire after 7 days
(<https://developers.google.com/identity/protocols/oauth2#expiration>),
which would break a release every other week.

1. [Google Cloud Console](https://console.cloud.google.com/): create
   a project (or pick one), search "Chrome Web Store API" and
   **Enable** it.
2. IAM & Admin → **Service accounts** → **Create service account**:
   a name, then **Done**; no roles needed.
3. Click the new account's email → **Keys** → **Add key** → **Create
   new key** → **JSON** → **Create**. The key file downloads once.
4. [CWS Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   → **Account**: add the service account's email (one per
   publisher).
5. Environment secret `CWS_SERVICE_ACCOUNT_JSON` = the whole key file.
   Then delete the downloaded file.
6. Environment variables (not secrets; both are visible anyway):
   `CWS_PUBLISHER_ID` = the publisher id from the Developer Dashboard
   (Publisher → Settings), `CWS_ITEM_ID` =
   `mccggmiialopdaaokhakeijmbafhdmli`.

Sources: <https://developer.chrome.com/docs/webstore/service-accounts>,
<https://developer.chrome.com/docs/webstore/using-api>,
<https://cloud.google.com/iam/docs/keys-create-delete>.

Fallback, if a service account isn't possible: an OAuth client plus a
refresh token as secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
`CWS_REFRESH_TOKEN` (steps in the using-api page above). The
publisher uses them only when `CWS_SERVICE_ACCOUNT_JSON` is unset.
Publish the consent screen to "In production", or the token dies
after 7 days.

### 4. Tag protection (recommended, not applied)

Tags are the release record, so nobody should move or delete them.
Settings → **Rules** → **Rulesets** → **New ruleset** → **New tag
ruleset**:

- Name `release tags`, enforcement **Active**, empty bypass list.
- Target tags → **Add a target** → Include by pattern: `v*`,
  `amo-submission-*`, `cws-submission-*`.
- Tag protections: **Restrict updates**, **Restrict deletions**,
  **Block force pushes**. Leave **Restrict creations** off: you push
  `v*` tags and `publish.yml` creates the submission tags.

Source: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository>.
Also worth turning on under Settings → General: immutable releases
(`release.yml` attaches all assets when it creates the Release).

## Files

| What | Where |
|---|---|
| Release script | `scripts/release.mjs` (pure parts: `scripts/lib/release.mjs`, tests: `tests/release.test.ts`) |
| Kit templates | `docs/submission-kit/templates/{amo,cws}.md`, pulling `<!-- SECTION: … -->` anchors from `docs/amo-submission.md` and `docs/cws-submission.md` |
| Package check | `scripts/verify-package.mjs`, `scripts/lib/zip.mjs` |
| Release notes for GitHub | `scripts/release-notes.mjs` |
| Store publishers | `scripts/publish-amo.mjs`, `scripts/publish-cws.mjs`, `scripts/lib/{amo,cws,publish}.mjs`, tests: `tests/publish.test.ts` |
| Workflows | `.github/workflows/release.yml`, `.github/workflows/publish.yml` |

Local dry run of a publisher against real Release assets (public, no
keys needed):

```bash
gh release download vX.Y.Z --pattern '*.zip' --dir /tmp/assets
node scripts/publish-amo.mjs X.Y.Z /tmp/assets --dry-run
node scripts/publish-cws.mjs X.Y.Z /tmp/assets --dry-run
```

`publish-amo.mjs` reads the kit from the tag
(`git show vX.Y.Z:docs/submission-kit/X.Y.Z/amo.md`); `--kit <file>`
reads another file.
