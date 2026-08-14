# Production Release (DEV → master) — Full Process

Cutting a production release for Raindrop. Distilled from PR #596 (v2026.6.30, merged 2026-06-30) and the `build-and-deploy-raindrop.yml` + `sync-release-notes.yml` workflows.

## Branch model

- `DEV` (uppercase) is the integration branch — all feature/fix PRs merge here.
- `master` is the production branch — only updated via a DEV→master release PR.
- Pushing to `master` triggers the full deploy pipeline automatically. Pushing to `DEV` deploys to the dev channel (employee testing only).

## The gap: what's accumulated

Before starting, measure what's on DEV that isn't on master:

```bash
cd ~/Raindrop
git fetch --all
git log origin/master..origin/DEV --oneline          # commits ahead
git rev-list --count origin/master..origin/DEV      # count
git log origin/master..origin/DEV --merges --oneline | wc -l  # merged PRs
git diff --stat origin/master..origin/DEV | tail -5 # files/lines
```

Also check the last production release for the template:
```bash
# Find the last DEV->master merge PR
git log origin/master --oneline --grep="Merge pull request.*DEV" | head -3
gh pr view <PR_NUMBER> --json title,body,mergedAt   # the prior release PR body is your template
```

## Phase 1 — Prep on DEV

### 1a. Flag stale `_old` / diagnostic commands

Before a release, audit for dead `_old` commands and diagnostic-only commands that shouldn't ship. Prior cycle removed `IR_WeightedAreaCompare` (commit `516cdc6b`) with a skill note (commit `b22f9bb0`).

```bash
# Find _old commands still in the codebase
grep -rn 'CommandMethod(".*_old")' src/raindrop/ --include="*.cs"
# Find what references them (button wiring, Commands.Send, etc.)
grep -rn 'IR_.*_old' src/raindrop/ --include="*.cs"
```

For each `_old` command, decide:
- **Truly dead** (no UI wiring, no programmatic caller) → remove the `[CommandMethod]` + method. Check for cascade to palette methods (re-grep the method it called).
- **Still wired to a button** → check whether the button's container is itself dead code. A button in an orphaned WinForms control (never added to any live palette) is dead by transitivity. Example: `IR_MainlineAnalysis_old` is called from `PipeControl.cs:213`, but `PipeControl` is never added to any palette (V1 uses WPF `PipesView`, V2 uses `PipesViewV2`), so the command is dead despite the button wiring.

### 1a-verify. Loki-verify zero usage before removing

Before removing a stale command, confirm nobody actually invokes it in production via the Loki logs (see `references/loki-query-guide.md`). Command tracking requires `EnableCommandTracking && SendDiagnostics`, so only opted-in users appear — but zero hits across 30 days is strong evidence a command is unused:

```bash
# Query the structured CommandName field (NOT the rendered message — see the pitfall below)
python .claude/skills/read-loki-logs/query.py '{app="raindrop"} |= "Command executed:" | json | CommandName = "IR_MainlineAnalysis_old"' --since 30d --limit 50 --raw
```

**Pitfall:** the rendered `Message` field shows the Serilog *template* (`Command executed: {CommandName}...`), not the interpolated command name. A line filter like `|= "IR_MainlineAnalysis_old"` will return 0 even if the command ran. Always filter on the structured `CommandName` field via `| json | CommandName = "..."`.

**Verified dead (Jul 31, 2026, 0 Loki hits in 30d):**
- `IR_MainlineAnalysis_old` — only caller is orphaned `PipeControl` (never displayed).
- `IR_WeightedArea_old` — no callers at all.

To enumerate all commands actually in use (for comparison), query raw and extract the `CommandName` field from each JSON entry — a `collections.Counter` on those values gives the usage histogram.

### 1b. Verify release notes

Two surfaces must be ready:

**`docs/release-notes.md`** — the docs-site changelog:
- **During development**, individual dev-channel entries accumulate here (one per dev release). They are internal build logs, not user-facing.
- **For a production release**, strip the dev-channel entries that accumulated since the last production release and replace them with **one clean consolidated entry** matching the style of prior production releases. Concise: one–two sentences per bullet, grouped into New Features / Improvements / Bug Fixes. The file should show one entry per production release going back through history — not the dev-build history.
- **⚠ Do NOT keep the dev entries below the consolidated entry.** The prior cycle (PR #596) added a consolidated entry on top but left the dev entries below it as a "detailed record" — Tim corrected this on Jul 31, 2026: the dev entries are duplicated content that clutters the user-facing file. Strip them. The consolidated entry IS the release note; the dev entries were internal.
- Verify no user-facing change was missed: `git diff origin/master origin/DEV -- docs/release-notes.md`

**`Raindrop_UpdatesConfig.aip`** `Description` field — the auto-update prompt text + GitHub Release notes:
```bash
grep -A 30 'Key="Description"' src/Raindrop.Installer/UpdatesConfig/Raindrop_UpdatesConfig.aip
```
- Must be a consolidated New/Improved/Fixed summary of the release span.
- CI validates it has ≥2 non-empty lines or the build fails (`build-and-deploy-raindrop.yml` "Validate version and changelog" step).

### 1c. Re-stamp version strings

The version is computed from the build date at build time. **As of Aug 1, 2026 (commit `a10e33e3`), all three date sources use MST (America/Phoenix, UTC-7, no DST), not UTC:**

1. **`Raindrop.csproj`** `VersionDate` — uses `TimeZoneInfo.ConvertTimeBySystemTimeZoneId(Now, 'US Mountain Standard Time')` to stamp in MST.
2. **`build-and-deploy-raindrop.yml`** validate step — `TZ: America/Phoenix` env var on the pwsh step.
3. **`validate-version.yml`** — `TZ='America/Phoenix' date +%Y%m%d` for the future-date check.

So the stamped version matches the date in Tim's timezone (MST), not the CI runner's UTC clock. A merge at 22:00 MST on July 31 stamps `2026.7.31`, not `2026.8.1` (which is what UTC would produce at that moment). **Before merging, still check the time** — run `date -u` (shows UTC; subtract 7 hours for MST) to confirm the stamp will match what you wrote in the AIP files and release notes. If merging near midnight MST, account for the date rolling over.

Before merging:
```bash
date -u    # what UTC day is it RIGHT NOW (subtract 7h for MST)
```
- **Two edit points in each `.aip` file** — both must be re-stamped to the same version:
  1. The `Key="Version"` row (line ~18) — update the Value to the target date.
  2. The version string inside the `Key="Description"` Value — the Description text starts with e.g. `July 2026 Update&#13;&#10;Version 2026.7.30.2&#13;&#10;...` — update the `Version X.Y.Z` inside that string too.
- Do this for **both** `Raindrop_UpdatesConfig.aip` (prod) AND `Raindrop_UpdatesConfig_Dev.aip` (dev) — `validate-version.yml` checks they match each other.
- The release-notes.md consolidated entry header says `## YYYY-MM-DD - Version YYYY.M.D` — match it to the same.
- If merging tomorrow, account for the date rolling over.

### 1d. Build verification

```bash
# Primary gate (per Tim's convention)
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD25_Debug

# CI builds AutoCAD_Release — verify it's clean too
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD_Release
```

0 errors is the success signal. Pre-existing warnings (~4400) are noise.

## Phase 2 — The PR

### Create the PR

```bash
# Make sure DEV is clean and pushed
git checkout DEV && git pull origin DEV
git push origin DEV

# Create the PR
gh pr create \
  --base master \
  --head DEV \
  --title "Production release YYYY.M.D" \
  --body "$(cat <<'EOF'
## Production release YYYY.M.D

Ships everything on DEV since production **vYYYY.M.D** (N commits, M PRs).

⏰ **Merge within UTC day YYYY-MM-DD** — the build stamps its version from the runner's UTC date.

### User-facing highlights
- (bullet summary of major themes — Settings redesign, new features, key fixes)

Internal-only (correctly absent from release notes): (e.g. debug bridge stays dev-only, enki relay, CI/CD changes)

### On merge (automatic)
- `build-and-deploy-raindrop.yml` builds the MSI → Cloudflare R2 **prod** channel, creates immutable `vYYYY.M.D` GitHub Release.
- `sync-release-notes.yml` republishes release notes to the docs site.
- Users' auto-updaters notify them.

### Post-merge checklist
- [ ] `build-and-deploy` run succeeded; log shows `Expected version from build date` = **YYYY.M.D**
- [ ] `vYYYY.M.D` release exists with MSI attached
- [ ] `sync-release-notes` run succeeded
- [ ] Docs repo: add new commands to `commands.md` + feature pages
EOF
)"
```

The PR triggers CI in **PR mode**: it builds + signs both MSIs, validates version/changelog, but does **NOT** deploy or create a release (those only fire on `push` to master).

### `validate-version.yml` (PR + DEV push)

A dedicated validation workflow gates the PR with 5 checks that **must all pass** or the PR is blocked. Read `.github/workflows/validate-version.yml` before opening the PR and self-verify each one:

1. **Dev and prod AIP `Key="Version"` values match** — both must be the same string.
2. **`docs/release-notes.md` contains `Version X.Y.Z`** — the version string must appear verbatim somewhere in the release notes (the consolidated entry header satisfies this).
3. **Dev AIP `Description` mentions the version** — the version string must appear inside the Description Value.
4. **Prod AIP `Description` mentions the version** — same, for the prod config.
5. **Version not dated in the future** — `date +%Y%m%d` vs the version's `yyyy.M.d`; future dates hard-fail, past dates warn (warn doesn't block).

### `validate-commands.yml` (PR + DEV push)

A **second** validation workflow checks that `docs/command-manifest.txt` is in sync with the `[CommandMethod]` attributes in source. It regenerates the manifest from source and diffs it against the committed file (ignoring the `#` comment header). A drift fails the PR.

**This is the one that bites when you remove a command.** Removing a `[CommandMethod]` from a `.cs` file without updating `docs/command-manifest.txt` → CI failure with a diff like `113d112 < IR_WeightedArea_old`.

**Fix:** regenerate the manifest and commit it alongside the command removal:
```bash
# The script outputs the command list WITHOUT the header comment
bash .claude/actions/gen-command-manifest.sh > /tmp/manifest-new.txt

# Safe edit: just delete the one <CommandName> line from the committed file,
# keeping the 3-line # header (CI ignores the header in the diff).
# Verify they match (ignoring the header):
diff <(grep -vE '^[[:space:]]*#' docs/command-manifest.txt | grep -vE '^[[:space:]]*$') <(bash .claude/actions/gen-command-manifest.sh)
```

Pre-flight self-check before pushing the prep commit:
```bash
DEV_VER=$(grep 'Key="Version"' src/Raindrop.Installer/UpdatesConfig/Raindrop_UpdatesConfig_Dev.aip | head -1 | sed 's/.*Value="\([^"]*\)".*/\1/')
PROD_VER=$(grep 'Key="Version"' src/Raindrop.Installer/UpdatesConfig/Raindrop_UpdatesConfig.aip | head -1 | sed 's/.*Value="\([^"]*\)".*/\1/')
echo "Dev=$DEV_VER Prod=$PROD_VER"  # must be equal
grep -q "Version $DEV_VER" docs/release-notes.md && echo "release-notes OK" || echo "MISSING in release-notes"
grep -q "$DEV_VER" src/Raindrop.Installer/UpdatesConfig/Raindrop_UpdatesConfig.aip && echo "prod desc OK" || echo "MISSING in prod desc"
grep -q "$DEV_VER" src/Raindrop.Installer/UpdatesConfig/Raindrop_UpdatesConfig_Dev.aip && echo "dev desc OK" || echo "MISSING in dev desc"
# Command manifest sync (run this too — it's a separate CI check)
diff <(grep -vE '^[[:space:]]*#' docs/command-manifest.txt | grep -vE '^[[:space:]]*$') <(bash .claude/actions/gen-command-manifest.sh) && echo "manifest OK" || echo "MANIFEST DRIFT"
```

## Phase 3 — Merge & automated deploy

**Use a normal merge (merge commit), not a squash merge.** A squash merge collapses all 487+ DEV commits into one commit on master, erasing the granular history. For a release PR, you want the full commit history on master — every feature, every fix, every release-prep commit — as the production audit trail. If a customer reports a bug in a shipped version, `git log master` must let you trace exactly which commit introduced it. Squash merge is for feature branches with throwaway "wip"/"fix typo" commits; a release PR's commits ARE the history. `gh pr merge <PR> --merge` creates a merge commit (matches the PR #596 / #709 pattern).

### `build-and-deploy-raindrop.yml` (master push only)
1. **Validate** version + changelog (updater config Description ≥2 lines).
2. **Build** `AutoCAD_Release` + `AutoCAD25_Release` via `scripts/build.sh`. The debug bridge is **excluded** on master — `RAINDROP_DEBUGBRIDGE=0` (vs `1` on DEV), so the bridge never ships to customers.
3. **Azure Trusted Signing** — code-signs all `Raindrop*.dll` + `GeometryExtension*.dll`, then signs the production MSI.
4. **Build production installer** (`Raindrop.Installer.aip` → `Raindrop_Setup.msi`).
5. **Build production updater config** (`Raindrop_UpdatesConfig.aip` → `updatesConfiguration.txt`) with the MSI version stamped in.
6. **Deploy to Cloudflare R2** (prod channel, root keys): `Raindrop_Setup.msi` + `updatesConfiguration.txt`. Verifies uploaded sizes match local.
7. **Create GitHub Release** `vYYYY.M.D` with MSI attached, notes pulled from the updater config Description. Fails on duplicate tag (same-day re-release needs a version bump).

### `sync-release-notes.yml` (master push, docs/release-notes.md changed)
1. Checks out Raindrop + Raindrop-Documentation repo.
2. Transforms `docs/release-notes.md` → `docs-repo/docs/releasenotes.md` (prepends MkDocs header, strips the `# Release Notes` H1 + trailing comment).
3. Commits + pushes to the docs repo.

## Phase 4 — Post-merge verification

```bash
# Check the deploy workflow run
gh run list --branch master --workflow build-and-deploy-raindrop.yml --limit 1
gh run view <RUN_ID> --log | grep "Expected version from build date"

# Verify the GitHub Release exists
gh release view vYYYY.M.D

# Verify sync-release-notes ran
gh run list --workflow sync-release-notes.yml --limit 1
```

Checklist (from PR #596):
- [ ] `build-and-deploy` run succeeded; log shows `Expected version from build date` = the intended version
- [ ] `vYYYY.M.D` release exists with MSI attached
- [ ] `sync-release-notes` run succeeded
- [ ] Docs repo: add any new commands to `commands.md` + feature pages
- [ ] Test install on Ally's machine or the laptop — verify install + new drawing starts (per README)
- [ ] Website post about new features (per README + marketing goals)

## Prior release reference

- **PR #596** (v2026.6.30, merged 2026-07-01) — the template for this process. Body has the highlights summary, internal-only callouts, on-merge automation description, and post-merge checklist.
- Prep commit `93aed549` (`chore(release): prep 2026.6.30 production release`) — rolled up both updater config Descriptions to a New/Improved/Fixed summary, re-stamped version to UTC build date, added the consolidated entry to release-notes.md on top of the individual dev entries.

## Pitfalls

- **Removing a `[CommandMethod]` requires updating `docs/command-manifest.txt`.** The `validate-commands.yml` CI workflow regenerates the manifest from source and diffs it against the committed file. A removed command shows up as a `< CommandName` diff line and fails the PR. Always run `bash .claude/actions/gen-command-manifest.sh` and commit the manifest change alongside the command removal. (Bite: PR #709, Jul 31, 2026 — removed `IR_WeightedArea_old` from code but not the manifest; CI failed within 6 seconds.)
- **Don't duplicate release notes content.** The consolidated entry and the dev entries cover the same ground. The user wants ONE clean entry per production release — strip the dev entries, don't keep them as a "detailed record." The release notes are for users, not for developers. (Corrected Jul 31, 2026 — the prior cycle left dev entries in place and Tim pushed back on the clutter.)
- **Consolidate large themes into one bullet with sub-items.** When a release spans many changes to one area (e.g. the Settings dialog redesign touching 5 pages), write ONE bullet for the area with per-page sub-bullets, not 5 separate bullets. Keep each bullet to one–two sentences.
- **Don't merge without checking `date -u`.** The version stamps from the UTC date at build time. A 22:00 local merge on July 30 stamps `2026.7.31` if UTC has already rolled over.
- **The updater config Description won't fail CI on a date mismatch** (it's free-text) but the GitHub Release tag will use the CI-computed version, creating a mismatch between what the config says and what the release is tagged.
- **Debug bridge must not ship to production.** CI handles this automatically (`RAINDROP_DEBUGBRIDGE=0` on master), but don't accidentally set it in the csproj or workflow for master builds.
- **`docs/release-notes.md` has a trailing comment** (`<!-- Keep entries concise... -->`) — `sync-release-notes.yml` strips it via `sed`, so don't remove it from the source file.
- **The prior cycle's stale-command cleanup** (commit `516cdc6b` + skill note `b22f9bb0`) was done as a separate commit on DEV before the release PR. Follow that pattern: clean up dead `_old`/diagnostic commands on DEV first, commit, then open the release PR.
