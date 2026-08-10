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
#    Exit 1/3/4/5 = decoder broken. Exit 2 = network unreachable (you're on
#    the wrong machine — see "Hard constraints" below).
npm run check:hdfilm

# 2. If it IS broken, capture a live decoder body and read it (see below).
#    Do NOT reach for `--write` first — see "Why brute force no longer works".

# 3. Validate. All tests must pass; typecheck must be clean.
npm run typecheck
npm test

# 4. Ship.
git add -A
git commit -m "fix(resolver): handle new HDFilm decoder shape"
git push origin <the current release branch>

# 5. Publish the OTA to the runtime the branch pins (check app.config.js first).
$SHA = (git rev-parse --short HEAD).Trim()
npx eas-cli update --branch preview --message "HDFilm decoder recovery ($SHA)" --non-interactive
```

Users get the fix on their next background→foreground cycle (silent reload, no
modal, no restart prompt — by design).

---

## Background context (so you don't re-derive it every time)

**What's actually breaking.** HDFilm (`hdfilmcehennemi.nl` /
`hdfilmcehennemi.mobi`) hides each stream URL inside an obfuscated `s_*` array
on the embed page, decoded by an inline `dc_XXXX(value_parts)` function. The
user-facing symptom of a decode failure is NOT usually "no video" — it is
**"the wrong provider played"**: HDFilm silently loses, the resolver falls
through to Dizipal/Dizibal, and the user gets a Turkish-dub-only stream (and a
much slower load, because every play now walks the whole provider chain).

**The decoder is randomized per request.** Function name, the number and order
of pre-passes, the Caesar shifts, and the de-scramble constants all change on
*every single fetch*. A sample of 15 fetches of one title produced 13 distinct
shapes. There is no "current scheme" to pin down.

**The de-scramble family changes too.** It was arithmetic
(`c - (CONST % (i + N))`) until Aug 2026, when it became a rolling-XOR cipher:

```js
var acc = <seed>;
acc = (acc + <step>) % 256;
var plain = b ^ acc;
acc = (acc + b) % 256;   // feedback off the CIPHER byte
```

**So we interpret, we don't pattern-match.** `src/services/rapidrameScript.ts`
parses the live function body and replays it: a recursive-descent expression
evaluator plus a statement interpreter over a restricted subset (numbers,
strings, arithmetic + bitwise operators, `charCodeAt`, `String.fromCharCode`).
No `eval`/`Function` — Hermes has neither, and executing provider JS would be a
code-execution sink. It handles both de-scramble families with no special
casing, and **fails closed** (returns `null`, caller falls back) if the body
uses anything outside that subset.

### Why brute force no longer works

`npm run check:hdfilm -- --write` composes `reverse`/`base64`/`rot13` with a
FIXED unmix constant and appends to `RAPIDRAME_PRE_UNMIX_TRANSFORMS`. Against a
per-request-randomized decoder that is meaningless: any scheme it "derives"
describes one response and is wrong for the next. `RAPIDRAME_PRE_UNMIX_TRANSFORMS`
survives only as a fallback for old embeds. Treat `--write` as deprecated.

### What to do instead

1. Capture a live embed body (the health check prints one, or fetch the iframe
   URL from a movie page with the mobile UA).
2. Read the `dc_*()` function. Ask one question: **does it use an operation
   outside {reverse, atob, caesar, and a loop of plain assignments}?**
   - **No** → the interpreter should already handle it. The bug is a parse
     mismatch in `rapidrameScript.ts` — check `collectStringOps`,
     `parseLoopHeader`, and `runAssignment` against the new body shape.
   - **Yes** → teach the interpreter that one primitive. Keep it narrow, and
     keep `assertOnlyKnownCalls` honest so unknown calls still fail closed.
3. Add a case to `tests/rapidrameScript.test.ts`. Those tests build a payload by
   running the provider's ENCODE direction and assert the interpreter recovers
   the URL — so a new shape is a handful of lines.

**Two embed flows.** The extractor handles both:
1. `hdfilmcehennemi.mobi/video/embed/...` — plain HTML containing
   `var s_X = dc_Y([...])`.
2. `hdfilmcehennemi.nl/rplayer/...` — same content but wrapped in
   `eval(function(p,a,c,k,e,d){...})` packer.js. `tryUnpackInlinePackerJs`
   runs first and expands the block in-place before the regex sees it.

**⚠ Flow 2 is currently unreachable over plain HTTP** (checked 2026-08-10).
Cloudflare now serves an interactive challenge ("Just a moment…", `403`,
`cf-mitigated: challenge`) for everything on `www.hdfilmcehennemi.nl` except
`/search/` and film pages — that includes `/rplayer/`, `/dizi/` series pages,
and the site's own JS bundles. No header combination gets past it; it needs a
real browser. So a title whose page carries
`<iframe class="rapidrame" data-src=".../rplayer/…">` (e.g. Seven Samurai) will
never decode, and HDFilm series are unreachable altogether. **This is not a
decoder rotation — do not go looking for one.** Those titles fall through to
Dizipal / Dizibal, which is working as designed. The `.mobi` embed host is not
challenged, but it does not know `/rplayer/` ids, so there is no way to
translate between them.

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

### How to capture a live decoder body

1. Open `https://www.hdfilmcehennemi.nl/` in a real desktop browser (NOT curl —
   curl also won't decompress the gzip by default, which has wasted time before;
   pass `--compressed` if you must).
2. Pick any movie. View the page source.
3. Find the player iframe. Two patterns:
   - `<iframe ... src="https://hdfilmcehennemi.mobi/video/embed/XXX/">`
   - `<iframe ... data-src="https://www.hdfilmcehennemi.nl/rplayer/XXX/">`
4. Open that iframe URL directly. View source.
5. If you see `eval(function(p,a,c,k,e,d){...}`, the `dc_*()` function is inside
   that packed block — `tryUnpackInlinePackerJs` expands it in the app; to read
   it by hand, paste the block minus the outer `eval` into a JS console.
6. Find `function dc_XXXXX(value_parts) { ... return unmix; }` and follow "What
   to do instead" above.

Remember to fetch it **more than once**. The body changes every request, and a
single sample will mislead you into thinking a constant is fixed.

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

- **Runtime version.** `app.config.js` pins the runtime the checked-out branch
  ships to — currently `1.2.0` on `v1.2.0`. An OTA only reaches installs on the
  matching runtime, so **read `app.config.js` before every `eas update`** and
  never bump it to "reach more users". There are three live fleets; see
  [`docs/release-tracks.md`](docs/release-tracks.md).
- **OTA branch.** Always `preview`. That's the channel installed apps listen
  on (`updates.url` in `app.config.js`).
- **Test count.** 335 tests as of 2026-08-10. If the count drops or any fail,
  do not push.
- **No GitHub Actions.** `.github/workflows/` is intentionally empty.
  Cloudflare blocks GitHub's datacenter IPs from reaching hdfilmcehennemi,
  so any resolver workflow there fails with exit 2 every hour and produces
  false-alarm emails. Do not add workflows back.
- **Where to run from.** The user's Windows PC at
  `C:\Users\e.a.mammadov\Desktop\app`. Their home IP is what reaches the
  provider. Cloud VMs (Oracle, AWS, GitHub Actions) are all WAF-blocked.

---

## Architecture pointers (for unusual breakage)

- The decoder interpreter lives in **`src/services/rapidrameScript.ts`**:
  - `runRapidrameDecoder(functionSource, valueParts)` — the entry point. Parses
    and replays the live `dc_*()` body.
  - `runHead` / `collectStringOps` — the pre-passes (reverse / atob / caesar),
    ordered deepest-nesting-first then left-to-right so both
    `atob(x.reverse())` and `x.reverse().replace(…)` evaluate correctly.
  - `parseLoopHeader` / `runAssignment` / `ExpressionEvaluator` — the
    de-scramble loop. This is what makes the arithmetic and rolling-XOR
    families work from one code path.
  - `assertOnlyKnownCalls` — the fail-closed guard. An unrecognised call in a
    pre-pass aborts the decode instead of being silently skipped (skipping it
    would produce a plausible-but-WRONG url).
- Provider glue stays in **`src/services/WebPlayerService.ts`**:
  - `decodeRapidrameByInterpretingDcBody` — locates the `dc_*()` function and
    delegates to the interpreter.
  - `RAPIDRAME_PRE_UNMIX_TRANSFORMS` — legacy static schemes, fallback ONLY.
  - `tryUnpackInlinePackerJs` — expands `eval(function(p,a,c,k,e,d){...})`
    packer.js blocks. Required for the `/rplayer/` flow.
  - `extractRapidrameStreamUrl` — unpacks, then runs the source-variable lookup.
  - `extractHdFilmEmbedUrl` — finds the iframe in the page HTML. Matches `src=`,
    `data-src=`, `data-lazy-src=`, plus `data-video=`/`data-link=`/`data-url=`.
  - `buildHdFilmResult` — ALWAYS returns native (`source: "direct"`) when a
    stream URL was decoded. `webViewFallbackUrl` is the last-resort fallback if
    the native stream dies at playback time (broken segment, expired token, geo
    block) — it is NOT the path taken when extraction fails.
- Health check: **`scripts/check-hdfilm-resolver.ts`**. Its `--write`
  auto-derive is deprecated (see above); the health check itself still works and
  validates through `extractRapidrameStreamUrl`, so it reflects real playback.
- Regression tests: **`tests/rapidrameScript.test.ts`** (decoder families) and
  **`tests/webPlayerService.test.ts`** (matching/scoring).
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

