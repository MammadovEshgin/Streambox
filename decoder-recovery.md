# Decoder Recovery Playbook

When the user reports "playback isn't working" / "videos won't play" / "Still Alice
shows ads but no video" / "black screen on POCO" — the upstream HDFilm decoder
has almost certainly rotated. End-to-end recovery from this document takes
~3 minutes.

**Run `npm run check:hdfilm` FIRST.** If it says HEALTHY the decoder is fine and
the problem is one of the other three providers' failure modes — jump straight
to ["When the breakage is NOT HDFilm"](#when-the-breakage-is-not-hdfilm).
"Everything got slow" and "it's in the app but says Not Available" are almost
always Dizipal, not the decoder.

This file is intentionally written as a runbook for an LLM. Read it top to
bottom on the first invocation; on subsequent runs jump to the "Happy path"
section.

---

## Repository

- Path on the user's machine: `C:\Users\e.a.mammadov\Desktop\Personal projects\Streambox`
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

**⚠ The Cloudflare challenge on `/dizi/` is a FIRST-REQUEST challenge, not a
wall** (re-measured 2026-09-02, correcting the 2026-08-10 note that said HDFilm
series were unreachable). `www.hdfilmcehennemi.nl/dizi/…` answers `403`
`cf-mitigated: challenge` on the first request over a fresh connection and
`200` on every request after it — 9/10 with connection reuse, 0/10 when each
request opened a new connection. No cookie is set; the clearance rides on the
connection, so **asking again is the entire fix**. `hdFilmGet()` in
`WebPlayerService.ts` does that (2 retries) and it is why HDFilm series resolve
natively again.

Before that retry existed, `findSeriesEpisodeUrl` / `checkVideoAvailability`
read the first 403 as "HDFilm doesn't have it", so every series fell through to
Dizipal — Turkish-dub-only and slower. If you see series quietly preferring
Dizipal, check that retry first before suspecting the decoder.

The `.mobi` embed host is not challenged but does not know `/rplayer/` ids, so
there is still no way to translate between the two flows.

If the user reports breakage on a *specific* title while the standard probes
("Edge of Tomorrow", "The Devil Wears Prada 2") still work, the iframe
attribute may have changed. Read `extractHdFilmEmbedUrl` in
`src/services/WebPlayerService.ts` (~line 1125) and add the missing attribute.
Recent example: lazy-loaded iframes use `data-src=` instead of `src=`.

---

## When the breakage is NOT HDFilm

`npm run check:hdfilm` only covers HDFilm. Two other classes of outage look
identical to the user ("slow", "says not available") and the health check will
report HEALTHY through both. Diagnosis order, worst-first:

### Dizipal moved (the usual cause of "everything got slow")

`dizipalN.com` 301s to `dizipalN+1.com`, and the hops are **not** one per
rotation — on 2026-09-02 the chain from the then-configured `2079` to the live
`2123` was 22 hops / 3.3s **per request**, and the resolver makes several. Past
axios' 21-redirect ceiling the request fails outright, so a base that falls far
enough behind takes Dizipal down rather than merely slowing it.

```powershell
# Walk the chain and print where it actually lands.
curl.exe -sSI https://dizipal2123.com/ | Select-String -Pattern 'location|HTTP/'
```

Fixes, in order:
1. `/set_dizipal https://<live host>` to the Telegram bot — updates Supabase for
   every device.
2. Bump `HARDCODED_FALLBACK.dizipal` in `src/services/providerConfigService.ts`
   and ship an OTA. `normaliseDizipalBaseUrl` compares the numeric suffix, so a
   Supabase row that is BEHIND the shipped fallback is ignored automatically —
   you no longer have to enumerate stale hosts.

Devices also self-heal within a session: `recordObservedBaseUrl` pins the
post-redirect origin, and the pin now survives `refreshProviderConfigs()` (it is
discarded the moment Supabase publishes a *different* base, so the operator can
always take control back).

### Dizipal renamed an endpoint (the usual cause of "it finds it but won't play")

Search keeps answering 200 while nothing plays. Sept 2026:
`/ajax-player-config` → `/ajax/player-config`. The app no longer depends on
either — `decodeDizipalCfg` reads the base64 `data-cfg` attribute off the page,
which is byte-identical to what the endpoint returned — and the network call
survives only as a fallback that tries both paths.

```powershell
# Healthy = base64 JSON with {"v":"https://…","t":"embed"}
curl.exe -s https://dizipal2123.com/bolum/breaking-bad-1-sezon-1-bolum |
  Select-String -Pattern 'data-cfg="([^"]+)"'
```

The `dizipal_playback` check in `workers/provider-monitor` watches exactly this
attribute, so a repeat should now page you instead of failing silently.

### Dizibal's embed host is down

Tier 3 only. `dizibal.org/api/*` can be perfectly healthy while the rotating
Playerjs host it hands back (`https://x.<something>.cfd/embed-<code>.html`) is
502 — that was the state on 2026-09-02, for every code, movies and series
alike. Nothing to fix on our side; it is their origin. Confirm with:

```powershell
curl.exe -s "https://dizibal.org/api/stream/embed?code=<code>&autoplay=1"
curl.exe -sI "<the embedUrl it returned>"
```

If `/api/*` itself moved host, `/set_dizibal https://<new host>`.

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

## Learnings — read this before debugging any provider

Distilled from the 2026-09-02 session, where three separate provider breakages
had been mistaken for one. Every one of these cost real time; none of them is
obvious from the code.

**1. A green decoder check does NOT mean the providers are fine.**
`npm run check:hdfilm` covers exactly one flow: HDFilm movie embeds. It reported
HEALTHY while Dizipal playback was 100% dead and every HDFilm series was falling
through. Always reproduce the user's *actual* symptom end to end before
believing any health check. The fastest way is a throwaway script that imports
`resolveWebPlayerUrl` and runs the real titles — see step 3.

**2. "Search works" and "it plays" are different systems. Test the second.**
Dizipal's `/ajax-search` answered 200 with correct results for the entire
outage; only `/ajax-player-config` had moved. Every provider here has the same
split, and a monitor (or a human) that only probes search will report healthy
through a total playback failure. When a user says "it's in the app but says Not
Available", go straight to the *playback* endpoint.

**3. Reproduce with the real resolver, not a re-implementation.**
Write a temp `scripts/_probe.ts`, `import { resolveWebPlayerUrl }` and
`initialiseProviderConfigs`, set `globalThis.__DEV__ = true`, and run it with
`npx tsx`. It works in node — AsyncStorage and the RN imports resolve fine — and
the `debugLog` lines name the failing provider and status code immediately. It
MUST live under the repo (node_modules resolution) and be deleted afterwards.
Then assert the stream actually serves `#EXTM3U`; a returned URL is not proof of
playback.

**4. Distinguish "slow" from "broken" — for these providers they are the same
bug at different magnitudes.** Dizipal's rotation is a 301 chain, and the hops
are not one per rotation. A base a few days stale is slow; one far enough behind
crosses axios' 21-redirect ceiling and fails outright with
`ERR_FR_TOO_MANY_REDIRECTS`. Always measure the chain (`maxRedirects: 0` in a
loop, printing each `location`) rather than assuming "a few hops".

**5. A 403 from Cloudflare is not necessarily a wall.** Test it with connection
reuse AND without before concluding anything: `/dizi/` was 403 on the first
request over a fresh TLS connection and 200 on every one after, with no cookie
involved — 9/10 vs 0/10. A single `curl` (fresh connection every time) says
"permanently blocked" and is wrong. This mistake sat in this very document for
three weeks and cost every series its dual-audio stream.

**6. Prefer reading data the page already carries over calling an endpoint for
it.** Dizipal's `data-cfg` attribute decodes to exactly what
`/ajax-player-config` returned. Doing that locally removed two round-trips from
every play *and* made the rename a non-event. Whenever a provider hands you an
opaque blob that a later request just echoes back, decode it.

**7. Self-healing config must outlive the refresh that fights it.** The pin from
`recordObservedBaseUrl` was being clobbered by `refreshProviderConfigs()` — the
retry path was undoing its own fix. If you add optimistic local state on top of
remote config, define exactly when remote takes it back (here: the published
base changing at all) and test both directions.

**8. Order matters in the resolver chain, and fixing one provider can silently
demote a better one.** Once Dizipal started working again it began winning
series that HDFilm would have served with dual audio, because step 2 short
circuits before step 2b's Turkish-title HDFilm retry. Fixing the HDFilm 403 was
what actually restored quality. After any provider fix, re-check *which*
provider serves each title, not just that something plays.

**9. When you fix a class of failure, add the monitor check in the same
change.** `dizipal_playback` exists because nothing would otherwise have caught
a repeat. Verify a new Worker check from Worker egress before trusting it —
`wrangler dev --remote` against a throwaway probe worker — since Cloudflare
egress is treated differently from the user's residential IP by every one of
these providers.

**10. Correct this document when reality contradicts it.** The stale claim in
§Background context ("HDFilm series are unreachable altogether") actively
misdirected the investigation. If you disprove something here, rewrite it in the
same commit and say when it was re-measured.

---

## Hard constraints (DO NOT CHANGE)

- **Runtime version.** `app.config.js` pins the runtime the checked-out branch
  ships to — currently `1.2.0` on `v1.2.0`. An OTA only reaches installs on the
  matching runtime, so **read `app.config.js` before every `eas update`** and
  never bump it to "reach more users". There are three live fleets; see
  [`docs/release-tracks.md`](docs/release-tracks.md).
- **OTA branch.** Always `preview`. That's the channel installed apps listen
  on (`updates.url` in `app.config.js`).
- **Test count.** 345 tests as of 2026-09-02. If the count drops or any fail,
  do not push.
- **No GitHub Actions.** `.github/workflows/` is intentionally empty.
  Cloudflare blocks GitHub's datacenter IPs from reaching hdfilmcehennemi,
  so any resolver workflow there fails with exit 2 every hour and produces
  false-alarm emails. Do not add workflows back.
- **Where to run from.** The user's Windows PC at
  `C:\Users\e.a.mammadov\Desktop\Personal projects\Streambox`. Their home IP is
  what reaches the provider. Cloud VMs (Oracle, AWS, GitHub Actions) are all WAF-blocked.

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
  - `hdFilmGet` — every HDFilm page fetch goes through this. Retries twice past
    a `403`/`503` Cloudflare challenge and rethrows anything else unchanged. If
    HDFilm ever looks "missing" for content you can see in a browser, check here
    first.
  - `decodeDizipalCfg` — reads Dizipal's player config out of the page's base64
    `data-cfg` attribute. Fails closed (returns null) on anything that isn't
    `{v: "http…", t: "…"}`, so the caller falls back to
    `requestDizipalPlayerConfig`, which tries `/ajax/player-config` then the
    legacy `/ajax-player-config`.
- Provider hosts live in **`src/services/providerConfigService.ts`**:
  - `HARDCODED_FALLBACK` — bump `dizipal.baseUrl` here when the domain rotates
    far enough to matter; it is also the reference for the numeric rule below.
  - `normaliseDizipalBaseUrl` / `parseDizipalSuffix` — Dizipal rotation only
    moves forward, so a published base with a LOWER `dizipalN` suffix than the
    shipped one is ignored. Do not go back to enumerating stale hosts.
  - `recordObservedBaseUrl` / `adoptBaseline` — the self-heal pin and the rule
    that decides when remote config takes it back (the published base changing).
- Health check: **`scripts/check-hdfilm-resolver.ts`**. Its `--write`
  auto-derive is deprecated (see above); the health check itself still works and
  validates through `extractRapidrameStreamUrl`, so it reflects real playback —
  **but it only covers HDFilm movie embeds.** A green run says nothing about
  Dizipal, Dizibal, or HDFilm series.
- Uptime monitor: **`workers/provider-monitor/`** (Cloudflare Cron, 12h). The
  `dizipal_playback` check decodes the episode page's `data-cfg`, which is the
  only check that would catch a playback-endpoint rename. Deploy with
  `npx wrangler deploy` from that folder.
- Regression tests: **`tests/rapidrameScript.test.ts`** (decoder families),
  **`tests/webPlayerService.test.ts`** (matching/scoring, cfg decode, challenge
  retry) and **`tests/providerConfigService.test.ts`** (rotation + self-heal).
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

