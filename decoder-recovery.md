# Decoder Recovery Playbook

When the user reports "playback isn't working" / "videos won't play" / "Still Alice
shows ads but no video" / "black screen on POCO" — the upstream HDFilm decoder
has almost certainly rotated. End-to-end recovery from this document takes
~3 minutes.

This file is intentionally written as a runbook for an LLM. Read it top to
bottom on the first invocation; on subsequent runs jump to the "Happy path"
section.

---

## Repository

- Path on the user's machine: `C:\Users\e.a.mammadov\Desktop\app`
- GitHub: `MammadovEshgin/Streambox`
- Branch: `main` (no PR needed for these fixes — push directly)
- Shell: PowerShell on Windows (Bash tool also available; use whichever fits)

---

## Happy path (~3 min, ~80% of breakages)

Run these from the repo root, in order. Stop and read if any step fails.

```powershell
# 1. Diagnose. Exit 0 = healthy (stop, nothing to do).
#    Exit 1/3/4/5 = decoder rotated. Exit 2 = network unreachable (you're on
#    the wrong machine — see "Hard constraints" below).
npm run check:hdfilm

# 2. Auto-derive a new scheme + patch WebPlayerService.ts in place.
npm run check:hdfilm -- --write

# 3. Validate. 82 tests must pass; typecheck must be clean.
npm run typecheck
npm test

# 4. Ship. The commit message below is the convention; keep it.
git add src/services/WebPlayerService.ts
git commit -m "fix(resolver): auto-derived new HDFilm decoder scheme"
git push origin main

# 5. Publish the OTA. The user's eas-cli is already logged in; no token needed.
$SHA = (git rev-parse --short HEAD).Trim()
npx eas-cli update --branch preview --message "auto-recovery: HDFilm decoder rotation ($SHA)" --non-interactive
```

That's it. Users get the fix on their next background→foreground cycle (silent
reload, no modal, no restart prompt — by design).

---

## Background context (so you don't re-derive it every time)

**What's actually breaking.** HDFilm (`hdfilmcehennemi.nl` /
`hdfilmcehennemi.mobi`) hides each stream URL inside an obfuscated `s_*` array
on the embed page. The array is decoded by an inline JavaScript function
`dc_XXXX(value_parts)` that **the provider rotates** every few weeks. When they
rotate it, the existing decoder schemes in
`RAPIDRAME_PRE_UNMIX_TRANSFORMS` (in `src/services/WebPlayerService.ts`,
around line 1011) no longer produce a valid URL, and every HDFilm title falls
back to the WebView player. On some Androids (POCO F7 / HyperOS specifically)
the WebView path hits a black-screen-on-pre-roll bug — so the user-facing
symptom is usually "ads play but the movie never does" or "Still Alice doesn't
play".

**Decoder primitives.** The provider only ever composes these four:
`reverse`, `base64`, `rot13`, then a final fixed `unmix` step
(shift each char by `399756995 % (i + 5)`). The auto-derive script in
`scripts/check-hdfilm-resolver.ts` brute-forces compositions of the first
three against a LIVE `#EXTM3U` manifest oracle. If the rotation uses a
primitive outside this set, brute force will fail — see "Manual derivation"
below.

**Two embed flows.** The extractor handles both:
1. `hdfilmcehennemi.mobi/video/embed/...` — plain HTML containing
   `var s_X = dc_Y([...])`.
2. `hdfilmcehennemi.nl/rplayer/...` — same content but wrapped in
   `eval(function(p,a,c,k,e,d){...})` packer.js. `tryUnpackInlinePackerJs`
   runs first and expands the block in-place before the regex sees it.

If the user reports breakage on a *specific* title while the standard probes
("Edge of Tomorrow", "The Devil Wears Prada 2") still work, the iframe
attribute may have changed. Read `extractHdFilmEmbedUrl` in
`src/services/WebPlayerService.ts` (~line 1125) and add the missing attribute.
Recent example: lazy-loaded iframes use `data-src=` instead of `src=`.

---

## Failure modes

### `npm run check:hdfilm` reports "Could not fetch ANY embed page" (exit 2)

You're not on the user's PC. Cloudflare's WAF on hdfilmcehennemi blocks
datacenter / cloud / VPN IPs. **Do not try to work around this** — it's the
reason the cloud automation was abandoned. Tell the user the recovery must
run from their machine and stop.

### `--write` fails with "Could not derive a working scheme"

The rotation introduced a primitive outside the brute-force set. Do manual
derivation:

1. Open `https://www.hdfilmcehennemi.nl/` in a real desktop browser (NOT curl).
2. Pick any movie. View the page source.
3. Find the player iframe. Two patterns:
   - `<iframe ... src="https://hdfilmcehennemi.mobi/video/embed/XXX/">`
   - `<iframe ... data-src="https://www.hdfilmcehennemi.nl/rplayer/XXX/">`
4. Open that iframe URL directly in the browser. View source.
5. If you see `eval(function(p,a,c,k,e,d){...}`, the dc_*() function is
   inside that packed block. Copy the block, paste into a JS console as
   `let unpacked = ...; console.log(unpacked)` (remove the outer `eval`)
   to get the unpacked source.
6. Find `function dc_XXXXX(value_parts) { ... return unmix; }`. Translate the
   body into a new `RAPIDRAME_PRE_UNMIX_TRANSFORMS` entry. The existing
   entries demonstrate the format. Insert yours at the FRONT of the array
   so it's tried first.
7. Add a regression test in `tests/webPlayerService.test.ts` that decodes a
   real captured `parts` array via the new scheme. Use the existing
   `HDFilm Rapidrame decoder ...` tests as templates.
8. Continue with steps 3-5 of the happy path.

### Tests fail after `--write` succeeded

Rare. The brute-force found a scheme that produces a URL for the live probe
but garbage for one of the regression fixtures. Revert and do manual
derivation:

```powershell
git checkout -- src/services/WebPlayerService.ts
```

### `git push` rejected (non-fast-forward)

```powershell
git pull --rebase origin main
git push origin main
```

### `eas update` says EXPO_TOKEN missing or not authenticated

eas-cli is normally logged in via `~/.expo/state.json` on the user's machine.
If it's gone, the user has to run `npx eas-cli login` once interactively.
You can't do this for them.

---

## Hard constraints (DO NOT CHANGE)

- **Runtime version.** `app.config.js` pins `runtimeVersion: "1.0.2"`. Every
  installed user has an APK with that runtime. Any OTA published against a
  different runtime will simply not reach them. Do not bump this.
- **OTA branch.** Always `preview`. That's the channel installed apps listen
  on (`updates.url` in `app.config.js`).
- **Test count.** 82 tests. If after your changes the count drops or any
  fail, do not push.
- **No GitHub Actions.** `.github/workflows/` is intentionally empty.
  Cloudflare blocks GitHub's datacenter IPs from reaching hdfilmcehennemi,
  so any resolver workflow there fails with exit 2 every hour and produces
  false-alarm emails. Do not add workflows back.
- **Where to run from.** The user's Windows PC at
  `C:\Users\e.a.mammadov\Desktop\app`. Their home IP is what reaches the
  provider. Cloud VMs (Oracle, AWS, GitHub Actions) are all WAF-blocked.

---

## Architecture pointers (for unusual breakage)

- All decoder logic lives in **`src/services/WebPlayerService.ts`**:
  - `RAPIDRAME_PRE_UNMIX_TRANSFORMS` (~line 1011) — the scheme array. Newest
    schemes go at the front. Old schemes are kept as fallbacks for embeds
    that haven't been re-encoded yet.
  - `tryUnpackInlinePackerJs` (~line 1090) — expands `eval(function(p,a,c,k,
    e,d){...})` packer.js blocks. Required for the `/rplayer/` flow.
  - `extractRapidrameStreamUrl` (~line 1148) — top-level entry that unpacks
    then runs the source-variable lookup.
  - `extractHdFilmEmbedUrl` (~line 1180) — finds the iframe in the page HTML.
    Currently matches `src=`, `data-src=`, `data-lazy-src=`, plus
    `data-video=`/`data-link=`/`data-url=`.
  - `buildHdFilmResult` (~line 639) — ALWAYS returns native (`source:
    "direct"`) when a stream URL was decoded. The `webViewFallbackUrl` field
    is the last-resort fallback if the native stream itself dies at playback
    time (broken segment, expired token, geo block) — it is NOT the path
    taken when extraction fails.
- Auto-derive logic: **`scripts/check-hdfilm-resolver.ts`**. Self-contained,
  uses only `axios` and the existing `__internal` exports from
  `WebPlayerService.ts`.
- Regression tests: **`tests/webPlayerService.test.ts`**. After adding a new
  scheme, add a corresponding test using real captured parts so the rotation
  history is preserved.
- App-side OTA delivery: **`src/services/appUpdateService.ts`** (5-min poll)
  and **`src/components/common/LiveOpsHost.tsx`** (silent reload on
  background→foreground transition, suppressed during playback via
  `isPlayerActive()`). Do not re-introduce a "Restart now" modal — the user
  explicitly removed it.

---

## What the user wants when they ask you to fix this

Direct execution, not consultation. They've been through this loop enough
times that they want the fix shipped, not options weighed. Run the happy
path. If it works, tell them concisely: "fixed and shipped, OTA <sha>".
If it doesn't, tell them which failure mode you hit and what you need from
them. No long preambles, no walking through what you intend to do — just do
it and report.

When you ship successfully:
- Confirm the commit SHA and the OTA group ID.
- Remind them users get the fix on next background→foreground cycle.
- Don't suggest "follow-ups" or "next steps" unless something genuinely
  unexpected happened.

---

## Optional: Windows Task Scheduler automation (currently NOT enabled)

There's a PowerShell script `scripts/auto-recover.ps1` that wraps the entire
happy path. It can be wired to Windows Task Scheduler to run every 30 min
and ship OTAs without the user asking. The user opted out of this in favor
of telling an LLM when the decoder breaks. **Do not enable this unless the
user explicitly asks.** If they ever do, the setup commands are in the
script's header comment.
