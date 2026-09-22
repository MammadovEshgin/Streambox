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
- Branch: `v1.2.0` (no PR needed for these fixes). After pushing it, fast-forward `main`
  to it and push `main` too — `main` never gets its own commits.
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
git push origin v1.2.0
git checkout main; git merge --ff-only v1.2.0; git push origin main; git checkout v1.2.0

# 5. Publish the OTA to the runtime the branch pins (check app.config.js first).
$SHA = (git rev-parse --short HEAD).Trim()
npx eas-cli@latest update --branch preview --platform android --message "HDFilm decoder recovery ($SHA)" --non-interactive
# The output must say "Runtime version 1.2.0"; record the group ID in ENGINEERING.md.
```

Users get the fix on their next background→foreground cycle (silent reload, no
modal, no restart prompt — by design).

---

## Background context (so you don't re-derive it every time)

**What's actually breaking.** HDFilm (`hdfilmcehennemi.nl` /
`hdfilmcehennemi.mobi`) hides each stream URL inside an obfuscated parts array
on the embed page, decoded by an inline function. Until Sep 2026 those were
named `s_*` and `dc_XXXX(value_parts)`; **since 2026-09-08 both are random
short identifiers** (`var avdp1 = h738([...])`), so nothing may key off those
prefixes any more. The
user-facing symptom of a decode failure is NOT usually "no video" — it is
**"the wrong provider played"**: HDFilm silently loses, the resolver falls
through to Dizipal/Dizibal, and the user gets a Turkish-dub-only stream (and a
much slower load, because every play now walks the whole provider chain).

**The decoder is randomized per request.** Function name, the number and order
of pre-passes, the Caesar shifts, and the de-scramble constants all change on
*every single fetch*. A sample of 15 fetches of one title produced 13 distinct
shapes. There is no "current scheme" to pin down.

**The de-scramble family changes too.** Three seen in production:

| when | family |
| --- | --- |
| until Aug 2026 | arithmetic: `c - (CONST % (i + N))` |
| Aug 2026 | rolling XOR: `acc=(acc+step)%256; plain=b^acc; acc=(acc+b)%256` (feedback off the CIPHER byte) |
| Sep 2026 | seeded shuffle: two literal seed strings derive an LCG + XOR seed, Fisher-Yates un-shuffles the chars, THEN rolling XOR |
| 2026-09-20 | same family, but the key and the ops string are **spliced out of the parts** (`Array.splice`), the decoder is a function **expression** (`var x = function (p) {…}`), the call is `x("a\|b\|…".split("\|"))` instead of an array literal, and a decoy old-style `var y = z([…])` call precedes it |

The 2026-09-20 rotation broke three things at once, each fatal alone: the
interpreter had no `splice`, the decoder lookup only found `function name(`,
and the parts reader only understood an array literal (it would even have read
the decoy). Parts are now read by `extractRapidrameParts` (bounded to the
declaration's own statement, both call forms), and a function expression is
rewritten to a declaration before interpretation. `tests/rapidrameScript.test.ts`
carries the live body plus a native-execution oracle.

The Sep-2026 body is much richer than its predecessors — arrays and element
assignment, several loops including descending ones, `if/else if/else`,
multi-declarator `var`, ternaries, and a closure passed to `String.replace` —
and it carries **dead `if (x.length > 100000)` guards whose position is
shuffled on every request**. The two seed strings and every identifier are
per-request random; the numeric constants (31, 251, 255, 13, 65521, 75, 74,
65537) were stable across every sample.

**So we interpret, we don't pattern-match.** `src/services/rapidrameScript.ts`
is a small JS interpreter: tokenizer → recursive-descent parser → AST walker,
covering numbers/strings/arrays, the arithmetic, bitwise, comparison and
logical operators, `if`/`for`/`while`/`return`, function expressions and
closures, and a handful of built-ins (`atob`, `String.fromCharCode`, the string
and array methods the bodies use). No `eval`/`Function` — Hermes has neither,
and executing provider JS would be a code-execution sink. It handles all three
de-scramble families with no special casing, and **fails closed** (returns
`null`, caller falls back) on anything outside that subset.

Guardrails that matter when you widen it: a step budget and string/array size
caps bound a hostile body; `compileRegex` rejects any pattern with a
quantifier, group or alternation so a page cannot hand us a catastrophic
backtracking regex; and there is no property write anywhere except into a local
array, so a body cannot reach `constructor`, `__proto__` or any host object.

### Why brute force no longer works

`npm run check:hdfilm -- --write` composes `reverse`/`base64`/`rot13` with a
FIXED unmix constant and appends to `RAPIDRAME_PRE_UNMIX_TRANSFORMS`. Against a
per-request-randomized decoder that is meaningless: any scheme it "derives"
describes one response and is wrong for the next. `RAPIDRAME_PRE_UNMIX_TRANSFORMS`
survives only as a fallback for old embeds. Treat `--write` as deprecated.

### What to do instead

1. Capture a live embed body (the health check prints one, or fetch the iframe
   URL from a movie page with the mobile UA).
2. Find the `var <file> = <fn>([...])` assignment named by
   `sources: [{file: <file>` and read `function <fn>`. Ask one question:
   **does it use a JS construct the interpreter does not model yet?**
   - **No** → the bug is in the extraction, not the decoder. Check the two
     identifier regexes in `WebPlayerService.extractRapidrameStreamUrl` and
     `decodeRapidrameByInterpretingDcBody`, and the parts-array window size.
   - **Yes** → widen the INTERPRETER (parser + evaluator), never add another
     static scheme. Keep unknown calls bailing so the body still fails closed.
3. Verify against the LIVE site, not just tests. Decode a handful of titles and
   fetch each decoded URL — a real fix returns `#EXTM3U`.
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

### Dizibal finds the title but nothing plays

Tier 3 only. Since the Sept 2026 rebuild the chain is search → watch page →
player (see `ENGINEERING.md` §4); the old `/api/*` routes are gone (404) — do
not reintroduce them. Walk it by hand from a residential connection (the site
IP-bans datacenters, so the Worker can't):

```powershell
curl.exe -s -H "Accept: application/json" "https://dizibal.org/ara/oneri?q=criminal%20minds"
curl.exe -s "https://dizibal.org/series/criminal-minds/season/1/episode/1" |
  Select-String -Pattern 'data-player-type="[a-z]+"|data-pv="[^"]+"|data-src="[^"]+"|https://[^"/]+/assets/js/core\.js'
# embed: the player page must carry window.__PLAYER__ with a "stream" URL
curl.exe -s -H "Referer: https://dizibal.org/" "https://<player host>/assets/js/s.php?s=<data-pv>"
# direct: the MP4 must answer 200 (some ids 502 upstream — their origin, nothing to fix)
curl.exe -sI "https://dizibal.org/video/bolum/<id>"
```

`s.php` answering "Video bulunamadı" (404) means Dizibal has no video for that
title either. A 403 "Erişim engellendi" there means the Referer lock changed.
If the site itself moved domain, `/set_dizibal https://<new host>`.

---

## Failure modes

### `npm run check:hdfilm` reports "Could not fetch ANY embed page" (exit 2)

Two very different causes — check which before concluding anything:

1. **You're not on the user's PC.** Cloudflare's WAF on hdfilmcehennemi blocks
   datacenter / cloud / VPN IPs. **Do not try to work around this** — it's the
   reason the cloud automation was abandoned. Tell the user the recovery must
   run from their machine and stop.
2. **The site changed shape.** Confirm by hand before believing (1):
   ```bash
   UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36'
   # MUST send X-Requested-With: fetch. The literal value matters — with
   # "XMLHttpRequest" (what the monitor's baseHeaders send) this 404s.
   curl -s -A "$UA" -H 'X-Requested-With: fetch'      'https://www.hdfilmcehennemi.nl/search/?q=inception' | head -c 200
   ```
   A JSON `{"query":…,"results":[…]}` means the site is fine and the failure is
   downstream. In Sep 2026 this exit-2 message was actively misleading: the
   script's own private copy of the parts parser had gone stale and dropped
   every probe as "no embed" **before** the health check ran, so it reported a
   provider domain move while the site was up and only the decoder had changed.
   That gate is now removed — parts extraction no longer blocks a probe.

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
git pull --rebase origin v1.2.0
git push origin v1.2.0
git checkout main; git merge --ff-only v1.2.0; git push origin main; git checkout v1.2.0
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
same commit and say when it was re-measured. (This section's own "`.github/`
is intentionally empty" line was false when written — `ci.yml` already existed.
Fixed 2026-09-08.)

---

Added from the 2026-09-08 session, where HDFilm — **tier 1** — had been 100%
dead and nothing had noticed.

**11. A diagnostic tool with its own copy of production parsing WILL lie to
you.** `check-hdfilm-resolver.ts` kept a private `extractPartsArray` that still
looked for `s_*`. When HDFilm renamed those identifiers, that copy matched
nothing and dropped every probe as "no embed" *before* the health check ran —
so the script reported "provider domain moved, or network/geo block" while the
site was up and served every page fine. That message sent the investigation
after DNS and Cloudflare for a while. The parts array now never gates a probe,
and the health check itself calls the real `extractRapidrameStreamUrl`. If you
must duplicate production logic in a tool, make the duplicate non-blocking.

**12. Prefix-based extraction is a liability; match the shape, not the name.**
Both `sources: [{file: s_…}]` and `= dc_…(` were prefix matches, and both broke
the day HDFilm switched to random short identifiers. The structure
(`sources:` → identifier → `var <identifier> = <fn>([...])` → `function <fn>`)
is what the page guarantees; the naming is not.

**13. "Cannot be monitored" is a finding to write down, not a gap to paper
over.** The instinct after this outage is "add an HDFilm check to the monitor".
Both available runners are datacenter IPs and both are 403'd, so such a check
would fail forever and train everyone to ignore the alerts — the same trap as
Dizibal's IP-banned pages (see the monitor README). Verify egress with
`wrangler dev --remote` BEFORE adding a Worker check. Where no prober can
reach, instrument the app instead: `player_resolve` telemetry carries the
resolved `source`, and a sustained shift away from hdfilm/`direct` is the
tier-1 outage signal.

**14. The header VALUE can matter, not just its presence.** HDFilm's
`/search/?q=` returns the JSON payload only for `X-Requested-With: fetch`. With
`XMLHttpRequest` — which is what the monitor's `baseHeaders` sends, and what
most scrapers default to — it returns a **404 HTML page**. A probe that used
the wrong value would have "proved" the search endpoint was gone.

**15. A playback error is not a missing title.** `PlayerScreen` mapped any
expo-video `status === "error"` on a direct source to
`{ source: "not_found" }`, i.e. the "isn't in our catalog yet" card. ExoPlayer
raises that status for ordinary hiccups — seeking past the buffered edge, one
5xx segment, an expired CDN token, a track switch racing the initial buffer —
so seeking or tapping the subtitle button early showed the viewer a
"this title doesn't exist" card for a film that was playing a second ago.
Reserve `not_found` for resolve-time exhaustion; recover a started stream in
place (see `recoverCurrentStream`).

---

## Hard constraints (DO NOT CHANGE)

- **Runtime version.** `app.config.js` pins the runtime the checked-out branch
  ships to — `1.2.0` on `v1.2.0`, the only live runtime. An OTA only reaches
  installs on the matching runtime, so **read `app.config.js` before every
  `eas update`** and never bump it to "reach more users". See `ENGINEERING.md` §2.
- **OTA branch.** Always `preview`. That's the channel installed apps listen
  on (`updates.url` in `app.config.js`).
- **Test count.** 461 tests as of 2026-09-17. If the count drops or any fail,
  do not push.
- **No resolver workflow in CI.** `.github/workflows/ci.yml` (typecheck / lint /
  test) is fine and stays. What must NOT be added is anything that reaches
  hdfilmcehennemi from CI: Cloudflare blocks GitHub's datacenter IPs, so a
  resolver workflow fails with exit 2 on every run and produces false-alarm
  emails. The same applies to Cloudflare Workers — re-verified 2026-09-08 with
  `wrangler dev --remote`: both `www.hdfilmcehennemi.nl` and
  `hdfilmcehennemi.mobi` answer **403 "Just a moment…"** for every path from
  Worker egress. HDFilm health can only be observed from a residential IP:
  `npm run check:hdfilm` on the user's PC, plus the `player_resolve` telemetry
  event the app emits on every play.
- **Where to run from.** The user's Windows PC at
  `C:\Users\e.a.mammadov\Desktop\Personal projects\Streambox`. Their home IP is
  what reaches the provider. Cloud VMs (Oracle, AWS, GitHub Actions) are all WAF-blocked.

---

## Architecture pointers (for unusual breakage)

- The decoder interpreter lives in **`src/services/rapidrameScript.ts`**. Since
  2026-09-08 it is a small but general JS interpreter, not a statement runner:
  - `runRapidrameDecoder(functionSource, valueParts)` — the entry point. Parses
    the live decoder body and calls it with the parts array.
  - `tokenize` / `Parser` — tokenizer (including regex-literal disambiguation)
    and recursive-descent parser producing an AST. `Parser.parseFunctionDeclaration`
    finds the decoder regardless of its name.
  - `Interpreter` — the AST walker. Supports arrays and element assignment,
    `if`/`for`/`while`/`return`/`break`/`continue`, multi-declarator `var`,
    ternaries, closures, and the string/array built-ins the bodies use. All
    three de-scramble families run through this one path with no special casing.
  - `bail` / `UnsupportedScript` — the fail-closed guard. Any construct or call
    outside the modelled subset aborts the decode rather than being skipped
    (skipping would produce a plausible-but-WRONG url).
  - `compileRegex` — rejects quantifiers, groups and alternation, so a page
    cannot hand the resolver a catastrophic-backtracking pattern.
  - `MAX_STEPS` / `MAX_STRING_LENGTH` / `MAX_ARRAY_LENGTH` — the budgets that
    bound a hostile or malformed body.
- Provider glue stays in **`src/services/WebPlayerService.ts`**:
  - `decodeRapidrameByInterpretingDcBody` — locates the decoder function named
    by the parts assignment and delegates to the interpreter. Matches ANY
    identifier: the `dc_`/`s_` prefixes are gone as of Sep 2026.
  - `findVariableDeclaration` — whole-identifier `var|let|const <name>` lookup,
    so `var s_a` is not found inside `var s_abc`.
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

