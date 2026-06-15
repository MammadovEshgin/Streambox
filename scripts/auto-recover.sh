#!/usr/bin/env bash
#
# Hands-off HDFilm decoder recovery loop.
#
# WHERE THIS RUNS
# ---------------
# A free Oracle Cloud "Always Free" VM (or any Linux box with a residential /
# non-WAF'd IP). It must NOT run on a GitHub-hosted runner — Cloudflare on
# hdfilmcehennemi.nl serves the JS challenge page to GitHub's datacenter IPs,
# so the resolver script can't probe a single title from there.
#
# WHAT IT DOES (every 30 min via cron)
#   1. Fast-forward main from origin (so we never fight a manual push).
#   2. Run the read-only health check.
#        - exit 0  → decoder healthy, exit quietly.
#        - exit 2  → couldn't reach the provider (shouldn't happen here, but
#                    if it does it's a transient network issue; exit quietly).
#        - other   → decoder genuinely rotated, continue to step 3.
#   3. Run the auto-derive (--write) pass. Brute-forces compositions of the
#      known primitives (reverse / b64 / rot13) against a live #EXTM3U oracle,
#      and patches WebPlayerService.ts in place.
#   4. Typecheck + tests. If either fails, abort without committing — we'd
#      rather have a broken decoder for 30 more min than ship a broken bundle.
#   5. Commit, push to main, run `eas update`. The OTA reaches installed apps
#      on their next foreground-from-background (silent reload, no modal).
#
# REQUIREMENTS ON THE VM
#   - Node 20+, npm, git, jq (optional, just for nicer logs)
#   - eas-cli installed globally:  npm i -g eas-cli
#   - Environment variables exported in this script's shell (cron does NOT
#     inherit your interactive shell env — set them here or in the crontab):
#         EXPO_TOKEN=<token from expo.dev/settings/access-tokens>
#         GIT_PUSH_REMOTE=origin            # usually fine as-is
#         GH_REMOTE_URL=https://<user>:<PAT>@github.com/<user>/<repo>.git
#             (PAT = GitHub fine-grained PAT with `contents: write` on this repo)
#   - The repo is cloned to a path that you set in REPO_DIR below.
#
# SUGGESTED CRONTAB (every 30 min)
#   */30 * * * * /home/ubuntu/streambox/scripts/auto-recover.sh
#
# Log rotation is delegated to logrotate or `journalctl --vacuum-time` —
# this script just appends to LOG.

set -uo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="${AUTO_RECOVER_LOG:-/var/log/streambox-auto-recover.log}"
BRANCH="${BRANCH:-main}"
EAS_UPDATE_BRANCH="${EAS_UPDATE_BRANCH:-preview}"

# ─── Logging ────────────────────────────────────────────────────────────────

# Use tee so output goes to BOTH the log file and stdout when run interactively.
exec > >(tee -a "$LOG") 2>&1

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()   { printf "[%s] %s\n" "$(stamp)" "$*"; }

log "── auto-recover start ──"

# ─── Pre-flight ─────────────────────────────────────────────────────────────

if [ -z "${EXPO_TOKEN:-}" ]; then
  log "✗ EXPO_TOKEN is not set; cannot ship OTA. Edit this script or the crontab."
  exit 1
fi

cd "$REPO_DIR" || { log "✗ REPO_DIR not found: $REPO_DIR"; exit 1; }

# Identify the commit author for auto-fix commits — distinct from any human
# committer so it's obvious in `git log` what was machine-generated.
git config user.email "auto-recover@streambox" 2>/dev/null || true
git config user.name  "StreamBox Auto-Recover" 2>/dev/null || true

# ─── 1. Sync with origin ────────────────────────────────────────────────────

log "fetching origin..."
if ! git fetch --quiet origin "$BRANCH"; then
  log "✗ git fetch failed"
  exit 1
fi
git checkout --quiet "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

# ─── 2. Health check ────────────────────────────────────────────────────────

log "running health check..."
set +e
npm --silent run check:hdfilm
HEALTH_EXIT=$?
set -e

case "$HEALTH_EXIT" in
  0)
    log "✓ decoder healthy, nothing to do"
    exit 0
    ;;
  2)
    log "ℹ couldn't reach provider from this VM (transient network blip). Exiting quietly."
    exit 0
    ;;
  *)
    log "✗ decoder rotation detected (exit $HEALTH_EXIT). Attempting auto-recovery."
    ;;
esac

# ─── 3. Auto-derive + patch ─────────────────────────────────────────────────

log "auto-deriving new scheme..."
set +e
npm --silent run check:hdfilm -- --write
DERIVE_EXIT=$?
set -e

if [ "$DERIVE_EXIT" != "0" ]; then
  log "✗ auto-derivation failed (exit $DERIVE_EXIT). Manual fix needed."
  log "  Manual steps: open https://www.hdfilmcehennemi.nl in a browser, view a"
  log "  movie embed, find the inline 'function dc_*(value_parts)' helper, and"
  log "  translate it into a new RAPIDRAME_PRE_UNMIX_TRANSFORMS entry."
  exit 1
fi

if git diff --quiet -- src/services/WebPlayerService.ts; then
  log "ℹ auto-derive reported success but no diff in WebPlayerService.ts — likely"
  log "  the new scheme was already present. Exiting without committing."
  exit 0
fi

# ─── 4. Validate the patched bundle ─────────────────────────────────────────

log "typecheck + tests..."
if ! npm --silent run typecheck; then
  log "✗ typecheck failed after auto-patch. Reverting and bailing out."
  git checkout -- src/services/WebPlayerService.ts
  exit 1
fi

if ! npm --silent test; then
  log "✗ tests failed after auto-patch. Reverting and bailing out."
  git checkout -- src/services/WebPlayerService.ts
  exit 1
fi

# ─── 5. Commit, push, ship OTA ──────────────────────────────────────────────

log "committing fix..."
git add src/services/WebPlayerService.ts
SHA_BEFORE=$(git rev-parse --short HEAD)
git commit --quiet -m "fix(resolver): auto-derived new HDFilm decoder scheme

Detected by the Oracle VM auto-recover cron. The provider rotated the
on-page dc_*() deobfuscation scheme; a new composition of the known
primitives was brute-forced against a live #EXTM3U oracle and inserted
at the front of RAPIDRAME_PRE_UNMIX_TRANSFORMS.

Previous schemes kept as fallbacks. Validated by:
  - npm run typecheck
  - npm test"

log "pushing to $BRANCH..."
if ! git push --quiet "$GIT_PUSH_REMOTE" "$BRANCH"; then
  log "✗ git push failed. Reverting local commit."
  git reset --hard --quiet "$SHA_BEFORE"
  exit 1
fi

SHA=$(git rev-parse --short HEAD)
log "publishing OTA (branch=$EAS_UPDATE_BRANCH, sha=$SHA)..."
if ! EXPO_TOKEN="$EXPO_TOKEN" npx --yes eas-cli update \
      --branch "$EAS_UPDATE_BRANCH" \
      --message "auto-recovery: HDFilm decoder rotation ($SHA)" \
      --non-interactive; then
  log "✗ eas update failed (commit already pushed; OTA must be retried manually)."
  exit 1
fi

log "✓ recovery complete — OTA $SHA shipped"
