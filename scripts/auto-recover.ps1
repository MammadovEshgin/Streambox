# Windows-native auto-recovery for HDFilm decoder rotation.
#
# WHY THIS EXISTS (and not auto-recover.sh on a cloud VM)
# -------------------------------------------------------
# Cloudflare's WAF on hdfilmcehennemi.nl blocks datacenter ASNs — both GitHub
# Actions runners AND Oracle Cloud Always Free VMs. Cloudflare WARP, which
# would otherwise be an obvious bypass, also breaks SSH connectivity on
# those VMs. Your home IP, however, works fine — it's the same IP your phone
# uses when the app plays. So the recovery loop runs here, on your PC, and
# the cost is "only fires when the PC is on". For a single-developer app on
# a personal machine, that's acceptable: fixes ship within a few minutes of
# you next opening your laptop, instead of staying broken until you remember
# to run things manually.
#
# REQUIRED ENVIRONMENT
#   EXPO_TOKEN  →  set as a Windows User env var (one-time setup)
#                  Create at https://expo.dev/settings/access-tokens
#
# SCHEDULING
#   Triggered every 30 min by Windows Task Scheduler. The setup commands
#   live alongside this file in `setup-windows-task.ps1`.

$ErrorActionPreference = 'Stop'

# ── Config ──────────────────────────────────────────────────────────────────

$repoDir   = Split-Path -Parent $PSScriptRoot
$logFile   = Join-Path $env:USERPROFILE 'streambox-auto-recover.log'
$branch    = 'main'
$easBranch = 'preview'

# ── Logging ─────────────────────────────────────────────────────────────────

function Log {
    param([string]$msg)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $line  = "[$stamp] $msg"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

Log "── auto-recover start ──"

# ── Pre-flight ──────────────────────────────────────────────────────────────

if (-not $env:EXPO_TOKEN) {
    Log "X EXPO_TOKEN is not set; cannot ship OTA."
    Log "  Fix: Win+S -> 'Edit environment variables for your account' ->"
    Log "       add User variable EXPO_TOKEN = <token from expo.dev>"
    exit 1
}

Set-Location $repoDir

# ── 1. Sync with origin ─────────────────────────────────────────────────────

Log "fetching origin..."
git fetch --quiet origin $branch 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Log "X git fetch failed"; exit 1 }
git checkout --quiet $branch 2>&1 | Out-Null
git reset --hard --quiet "origin/$branch" 2>&1 | Out-Null

# ── 2. Health check ─────────────────────────────────────────────────────────

Log "running health check..."
npm --silent run check:hdfilm
$healthExit = $LASTEXITCODE

switch ($healthExit) {
    0 { Log "OK decoder healthy, nothing to do"; exit 0 }
    2 { Log "i  couldn't reach provider from this network (transient blip). Exiting quietly."; exit 0 }
    default { Log "X  decoder rotation detected (exit $healthExit). Attempting auto-recovery." }
}

# ── 3. Auto-derive + patch ──────────────────────────────────────────────────

Log "auto-deriving new scheme..."
npm --silent run check:hdfilm -- --write
$deriveExit = $LASTEXITCODE
if ($deriveExit -ne 0) {
    Log "X auto-derivation failed (exit $deriveExit). Manual fix needed."
    exit 1
}

git diff --quiet -- src/services/WebPlayerService.ts
if ($LASTEXITCODE -eq 0) {
    Log "i  auto-derive succeeded but no diff — scheme already present. Exiting."
    exit 0
}

# ── 4. Validate ─────────────────────────────────────────────────────────────

Log "typecheck + tests..."
npm --silent run typecheck
if ($LASTEXITCODE -ne 0) {
    Log "X typecheck failed after auto-patch. Reverting."
    git checkout -- src/services/WebPlayerService.ts
    exit 1
}
npm --silent test
if ($LASTEXITCODE -ne 0) {
    Log "X tests failed after auto-patch. Reverting."
    git checkout -- src/services/WebPlayerService.ts
    exit 1
}

# ── 5. Commit, push, ship OTA ───────────────────────────────────────────────

Log "committing fix..."
$shaBefore = (git rev-parse --short HEAD).Trim()
git add src/services/WebPlayerService.ts

$commitMsg = @"
fix(resolver): auto-derived new HDFilm decoder scheme

Detected by the Windows Task Scheduler auto-recover task. The provider
rotated the on-page dc_*() deobfuscation scheme; a new composition of
the known primitives was brute-forced against a live #EXTM3U oracle
and inserted at the front of RAPIDRAME_PRE_UNMIX_TRANSFORMS.

Previous schemes kept as fallbacks. Validated by:
  - npm run typecheck
  - npm test
"@
git -c user.email="auto-recover@streambox" -c user.name="StreamBox Auto-Recover" commit --quiet -m $commitMsg

Log "pushing to $branch..."
git push --quiet origin $branch
if ($LASTEXITCODE -ne 0) {
    Log "X git push failed. Reverting."
    git reset --hard --quiet $shaBefore
    exit 1
}

$sha = (git rev-parse --short HEAD).Trim()
Log "publishing OTA (branch=$easBranch, sha=$sha)..."
npx --yes eas-cli update --branch $easBranch --message "auto-recovery: HDFilm decoder rotation ($sha)" --non-interactive
if ($LASTEXITCODE -ne 0) {
    Log "X eas update failed (commit already pushed; OTA must be retried manually)."
    exit 1
}

Log "OK recovery complete — OTA $sha shipped"
