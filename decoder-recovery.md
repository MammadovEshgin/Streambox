# Provider Recovery Playbook

When the user reports "playback isn't working" / "videos won't play" / "it says
Not available" / "everything got slow", one of the four providers has changed
or gone down. This file says how to find out which, and how to fix what can be
fixed. It is written as a runbook for an LLM: read it top to bottom on the
first invocation; after that, start at "Triage".

Last rewritten 2026-11-26. `ENGINEERING.md` §4 holds the dated notes for every
provider change; this file is the procedure.

---

## Repository

- Path on the user's machine: `C:\Users\e.a.mammadov\Desktop\Personal projects\Streambox`
- GitHub: `MammadovEshgin/Streambox`
- Branch: `v1.2.0` (no PR needed for these fixes). After pushing it, fast-forward `main`
  to it and push `main` too — `main` never gets its own commits.
- Shell: PowerShell on Windows (Bash tool also available; use whichever fits)

---

## Triage (start here)

**Start from telemetry, not from a script.** No tool outside a phone can see
HDFilm any more (see "Hard constraints"), and the app records what every
provider answered on every play. Run the queries in `docs/live-ops.md`
("Which provider served each play", then the three HDFilm queries) with
`npx supabase db query --linked "<sql>"`.

| What the last day shows | Meaning | What to do |
| --- | --- | --- |
| `hd:legal` in `tiers`; `hdfilm_session` `blocked` titled "451 - Yasal Nedenlerle Erisime Kapali" | HDFilm refuses that viewer's network on every request | Nothing in the app can pass it. Not a fault. |
| `hd:no_stream` for viewers who had `hd:hit` before | HDFilm's player page or decoder changed | "HDFilm decoder" below |
| `hd:no_page`, `page:web:timeout`, `recycled` rows | The hidden WebView session cannot read pages | `ENGINEERING.md` §4, the session notes |
| `hd:no_match` for titles HDFilm lists | Search or title matching | Search by hand (see "Failure modes") |
| `hd:no_player` | HDFilm's page for that title has no video | Nothing: they removed it |
| No `dizipal` plays; `dp:miss` everywhere | Dizipal moved, or its player chain changed, or it is down | "Dizipal" below |
| No `dizibal` plays | Dizibal changed or is down | "Dizibal" below |
| `kultfilmler_session` `challenge_timeout` / `blocked` | Cloudflare does not let that phone's WebView in | Nothing: per network |
| Long `durationMs` with `passes: 2` | A provider is timing out | Find the slow tier in `tiers` |

"Everything got slow" and "it's in the app but says Not available" are most
often Dizipal. "The wrong audio / lower quality plays" is most often HDFilm
losing, so a lower tier answers.

**Then check the site in a real browser before touching code.** If the
provider's own page cannot play the video either (Dizipal on 2026-11-26: its
player endpoint answered 520 for every title), it is their outage. Say so and
stop.

---

## HDFilm decoder (the happy path)

Use this when telemetry shows `hd:no_stream` for viewers HDFilm accepts.

### 1. Capture live pages in a real browser

curl, axios and `npm run check:hdfilm` all get a challenge or a block page
(since 2026-11-19). Use the Playwright browser:

1. Open `https://www.hdfilmcehennemi.nl/dizi/streambox/` and wait until the
   title is HDFilm's own 404 page ("404 Hata … Hdfilmcehennemi"), not "Just a
   moment…". This is the page the app's hidden session holds.
2. From that page, `fetch(url, { credentials: "same-origin" })` the film (or
   episode) page, read its `rapidrame_id` (in the `.mobi` iframe's `data-src`),
   then fetch `/rplayer/{rapidrame_id}/`.
3. Save both bodies to files under `scripts/` (`browser_evaluate` with
   `filename`; it saves a string result JSON-encoded, so `JSON.parse` it).
4. **Capture at least twice.** The decoder's shape changes on every request.

Find the page to fetch with the search, which answers plain requests:

```bash
curl -s -H 'X-Requested-With: fetch' -H 'Accept: application/json' \
  'https://www.hdfilmcehennemi.nl/search/?q=inception' | head -c 300
```

The header value matters: with `XMLHttpRequest` the search returns a 404 page.

### 2. Replay them through the real resolver

Write a temporary script under `scripts/` (delete it afterwards) that:

- sets `globalThis.__DEV__ = true` before importing anything from `src/`
  (`debugLog` throws without it, and every resolve then returns nothing);
- imports `hdfilmSession` and stands in for the WebView:
  `hdfilmSession.subscribe(open => hdfilmSession.attachHost(open ? host : null))`
  where `host.evaluate(script)` reads the URL (`fetch\("([^"]+)"`) and the id
  (`id: (\d+)`) from the script and answers with
  `hdfilmSession.handleMessage(JSON.stringify({ kf: "fetch", id, status: 200, challenged: false, body }))`
  from the captures, and sends `{ kf: "page", ready: true }` once when opened;
- calls `resolveWebPlayerUrl({ mediaType, title, originalTitle, tmdbId, year, castNames })`
  and prints `result.source`, `result.streamUrl` and `result.trace`.

A healthy run reads the film page and the rplayer page from the captures and
ends with `source=direct` and `tiers` starting `hd:hit`. `hd:no_stream` with
the captures served means the extraction or the interpreter needs work.

### 3. Fix

1. In the rplayer capture, find `sources: [{file: …}]`. Since 2026-11-19 it is
   an inline call, `file:(function(){ …; return NAME(ARG); })()`; before that a
   variable, `var <file> = <fn>([...])`. Read the decoder function it names.
2. Ask one question: **does it use a JS construct the interpreter does not
   model yet?**
   - **No** → the bug is in the extraction, not the decoder. Check
     `decodeRapidrameInlineSource`, `findRapidramePageFunction`,
     `readCallArguments` and, for the variable form, `extractRapidrameParts`
     in `WebPlayerService.ts`.
   - **Yes** → widen the INTERPRETER (`rapidrameScript.ts`: parser +
     evaluator). Never add another static scheme. Keep unknown calls bailing
     so the body still fails closed.
3. Add a test: `tests/hdfilmInlineSource.test.ts` for the page shape,
   `tests/rapidrameScript.test.ts` for a decoder family (those build a payload
   by running the provider's ENCODE direction, so a new shape is a few lines).
4. Re-run the replay on every capture. A real fix returns a
   `*.rapidrame.com/…/master.m3u8` URL for each.

### 4. Validate and ship

```powershell
npm run typecheck
npm test
npm run lint          # 0 errors

git add <the files you changed>
git commit -m "fix(resolver): handle new HDFilm decoder shape"
git push origin v1.2.0
git push origin v1.2.0:main

# Check app.config.js first: the runtime must be 1.2.0.
npx eas-cli@latest update --branch preview --platform android --message "HDFilm decoder recovery" --non-interactive
# The output must say "Runtime version 1.2.0"; record the group ID in ENGINEERING.md §3.
```

Run the push, the `main` push and the update as separate commands. Deploys
need the owner's approval (`ENGINEERING.md` §7).

Users get the fix after the app next checks (every cold start, and at most
every 5 minutes on foreground): it downloads in the background and a
"Restart now / Later" card appears, never during playback. Later means the
next cold start.

### Mind the rate limits

The dev machine and the owner's phone share one public IP. HDFilm's `.mobi`
host and its CDN (`*.rapidrame.com`) rate-limit per address: about 60 embed
resolves in a few minutes drew `429` on everything for over an hour
(2026-10-28) and broke the owner's phone. Space embed and stream requests
(one title every 15–20 s), keep bulk checks to the search endpoint, and never
poll a blocked host in a loop.

---

## Background context (so you don't re-derive it every time)

**What's actually breaking.** HDFilm (`hdfilmcehennemi.nl`) hides each stream
URL behind an obfuscated decoder on its player page. Until Sep 2026 the pieces
were named `s_*` and `dc_XXXX(value_parts)`; **since 2026-09-08 every
identifier is random** (`var avdp1 = h738([...])`), so nothing may key off a
name. The user-facing symptom of a decode failure is usually NOT "no video" —
it is **"the wrong provider played"**: HDFilm silently loses, a lower tier
answers, and the user gets a Turkish-dub-only or lower-quality stream.

**The decoder is randomized per request.** Function name, the number and order
of pre-passes, the Caesar shifts, and the de-scramble constants all change on
*every single fetch*. A sample of 15 fetches of one title produced 13 distinct
shapes. There is no "current scheme" to pin down.

**The de-scramble family changes too.**

| when | family |
| --- | --- |
| until Aug 2026 | arithmetic: `c - (CONST % (i + N))` |
| Aug 2026 | rolling XOR: `acc=(acc+step)%256; plain=b^acc; acc=(acc+b)%256` (feedback off the CIPHER byte) |
| Sep 2026 | seeded shuffle: two literal seed strings derive an LCG + XOR seed, Fisher-Yates un-shuffles the chars, THEN rolling XOR |
| 2026-09-20 | same family, but the key and the ops string are **spliced out of the parts** (`Array.splice`), the decoder is a function **expression** (`var x = function (p) {…}`), the call is `x("a\|b\|…".split("\|"))` instead of an array literal, and a decoy old-style `var y = z([…])` call precedes it |
| 2026-10-22 | same family, but the key gains **the embed page's hostname** — `self.location.hostname`, `location['hostna'+'me']`, `window.location…`, `document.location…` or bare `location…`, varying per request — and the split character is random (`^`, `@`, …). The interpreter models read-only `location` / `self` / `window` / `document` for the page URL the caller passes (`runRapidrameDecoder(source, parts, pageUrl)`); without it the body fails closed |
| 2026-11-19 | no parts variable at all: `sources: [{file:(function(){ …guards on a hidden data-v element…; return NAME(ARG); })()}]`. NAME is random per request, declared as a function declaration or an expression; ARG is `"a~b".split("~")` (any separator, `\/` escapes) on one request and an array literal on the next. `decodeRapidrameInlineSource` runs the call as written in the interpreter |

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
and executing provider JS would be a code-execution sink. It handles every
de-scramble family with no special casing, and **fails closed** (returns
`null`, caller falls back) on anything outside that subset. It does not
support nested function *declarations*; a nested function goes in as an
expression.

Guardrails that matter when you widen it: a step budget and string/array size
caps bound a hostile body; `compileRegex` rejects any pattern with a
quantifier, group or alternation so a page cannot hand us a catastrophic
backtracking regex; and there is no property write anywhere except into a local
array, so a body cannot reach `constructor`, `__proto__` or any host object.

### Why brute force no longer works

`npm run check:hdfilm -- --write` composed `reverse`/`base64`/`rot13` with a
FIXED unmix constant and appended to `RAPIDRAME_PRE_UNMIX_TRANSFORMS`. Against
a per-request-randomized decoder that is meaningless: any scheme it "derives"
describes one response and is wrong for the next.
`RAPIDRAME_PRE_UNMIX_TRANSFORMS` survives only as a fallback for old embeds.
The script itself can no longer reach HDFilm (see "Failure modes").

**Two sources for one video.** A film page carries
`<iframe data-src="https://hdfilmcehennemi.mobi/video/embed/{id}/?rapidrame_id={rid}">`:

1. the `.mobi` embed — plain HTML. Since 2026-11-15 it answers the app 404
   (it loads only framed by HDFilm's own site), so it serves nothing;
2. `https://www.hdfilmcehennemi.nl/rplayer/{rid}/` — the same video's player
   on the main domain, named by that `rapidrame_id`. Older titles wrap its
   decoder in `eval(function(p,a,c,k,e,d){...})` packer.js, which
   `tryUnpackInlinePackerJs` expands first. Non-browser clients get an
   "Uygulama desteklenmiyor" page, so the app reads it through the session.

The app asks both at once and prefers `.mobi` if it ever answers.

**The gate.** Every page on the main origin except `/search/` refuses
non-browser clients, and some networks are refused entirely with a 451 page.
The dated story is in `ENGINEERING.md` §4 ("HDFilm (tier 1) today" and the two
notes after it). In short: `hdFilmGet` tries a gated page natively once, then
reads it through the hidden WebView session, and goes straight to the session
for 30 minutes after it has met the gate.

If the user reports breakage on a *specific* title while others play, look at
that title's film page in the capture. An empty `player-container` means
HDFilm removed the video (`hd:no_player`: Dune 2021, The Rings of Power). A
player that is there but not found means the iframe attribute changed: read
`extractHdFilmEmbedUrl` (it matches `src=`, `data-src=`, `data-lazy-src=`, and
`data-video=`/`data-link=`/`data-url=`).

---

## When the breakage is NOT HDFilm

### Dizipal moved (the usual cause of "everything got slow")

`dizipalN.com` 301s to a later `dizipalN`, and the hops are **not** one per
rotation — on 2026-09-02 the chain from the then-configured `2079` to the live
`2123` was 22 hops / 3.3s **per request**, and the resolver makes several. Past
axios' 21-redirect ceiling the request fails outright, so a base that falls far
enough behind takes Dizipal down rather than merely slowing it. It can also
jump: 2150 → 2161 on 2026-11-26.

```powershell
# Walk the chain from the shipped floor and print where it lands.
curl.exe -sSI https://dizipal2161.com/ | Select-String -Pattern 'location|HTTP/'
```

Before trusting a higher number, check what the old domains redirect to: the
22xx band is a different operator's clone, and on 2026-11-22 `dizipal2152.com`
redirected to `dizipal1.rest`, a differently built site. Ask the owner before
following either.

Fixes, in order:
1. Ask the owner to send `/set_dizipal https://<live host>` to the Telegram
   bot — it updates Supabase for every device. Never write that row yourself.
2. Bump `HARDCODED_FALLBACK.dizipal` in `src/services/providerConfigService.ts`
   (and the floor in `tests/providerConfigService.test.ts`) and ship an OTA.
   `normaliseDizipalBaseUrl` compares the numeric suffix, so a Supabase row
   that is BEHIND the shipped fallback is ignored automatically.

Devices also self-heal within a session: `recordObservedBaseUrl` pins the
post-redirect origin, and the pin survives `refreshProviderConfigs()` (it is
discarded the moment Supabase publishes a *different* base, so the operator can
always take control back).

### Dizipal finds the title but nothing plays

Search keeps answering 200 while nothing plays: the player chain changed, or
their player is down. The chain today:

1. the watch page, asked for as `//film/{slug}` or `//bolum/{slug}` (the plain
   path answers a Turnstile gate; a crawler user agent is the second door);
2. its `#videoContainer[data-cfg]`, a 32-hex **single-use** token bound to the
   PHP session that rendered the page — never cache or replay it;
3. `POST /_pb` with `s=f:{slug}` (film) or `s=b:{slug}` (episode), the "player
   beacon", on the same session;
4. `POST /ajax-player-config` with `cfg=…` → `{success, config: {v, t}, enc}`;
   since 2026-09-27 `v` is empty and `enc: {c, iv, k1, k2}` carries the embed
   URL AES-256-CBC under `k1 XOR k2` (`decryptDizipalEnc`);
5. the embed page's m3u8 (`resolveEmbedToM3u8`).

**Find a changed step by recording a real browser, not by reading `main.js`.**
Open an episode page in the Playwright browser and log every request and
answer to the site (`page.on("request")` / `page.on("response")`). The `/_pb`
beacon was found that way; it is not in `main.js`. Then compare with what the
app sends (`fetchDizipalStreamUrl`, `postDizipalPlayerBeacon`,
`postDizipalPlayerConfig`).

If the browser gets an error at the same step, it is their outage. On
2026-11-26 `/ajax-player-config` answered Cloudflare's 520 for every title, in
the browser too. The app treats that endpoint's 5xx-at-the-edge as an outage
of its own (`DIZIPAL_PLAYER` breaker): one render, no second pass, and the
tier stands down until a probe succeeds.

History, for orientation: the endpoint has been renamed before
(`/ajax-player-config` ↔ `/ajax/player-config`, Sept 2026;
`DIZIPAL_PLAYER_CONFIG_PATHS` tries the known ones on a 404), and until
2026-09-25 `data-cfg` was base64 JSON that could be decoded without the POST
(`decodeDizipalCfg` still accepts that form).

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
If the site itself moved domain, `/set_dizibal https://<new host>`. A title
the search no longer lists was removed from their catalogue (Prison Break,
2026-11-26).

### Kült Filmler

Tier 4, read through its own hidden WebView session because every path is
behind Cloudflare's challenge. Whether a phone gets in is decided by
Cloudflare per network (`kultfilmler_session`: `ready`, `challenge_timeout`,
`blocked`). The chain and its players are in `ENGINEERING.md` §4.

---

## Failure modes

### `npm run check:hdfilm` reports "Could not fetch ANY embed page" (exit 2)

This is now its only outcome. The script reads HDFilm's film pages with plain
requests, and since 2026-11-19 those answer a Cloudflare challenge from every
address, the owner's PC included. Exit 2 says nothing about the decoder. Use
telemetry and the browser capture instead; the script is kept for the day the
gate comes down.

If you suspect the site changed shape, check the one endpoint that still
answers plain requests:

```bash
# MUST send X-Requested-With: fetch. With "XMLHttpRequest" this 404s.
curl -s -H 'X-Requested-With: fetch' 'https://www.hdfilmcehennemi.nl/search/?q=inception' | head -c 200
```

A JSON `{"query":…,"results":[…]}` means the site is up for this network. A
451 page means this network is refused. A "Just a moment…" page means the
search is being challenged too (seen intermittently from 2026-11-26; the app
asks again up to twice).

### The session reads fail on phones but the capture replays fine

Then the logic is right and the transport is not. Read `hdReads` and the
`hdfilm_session` rows for the affected viewers before changing anything:
`blocked` with the 451 title is the legal block; `challenge_timeout` is a
challenge that phone's WebView did not pass; `recycled` is a WebView that
stopped answering. From 2026-11-19 to 11-26 several rounds of fixes were
shipped on guesses while the answer (451) was one telemetry field away.

### `git push` rejected (non-fast-forward)

```powershell
git pull --rebase origin v1.2.0
git push origin v1.2.0
git push origin v1.2.0:main
```

### `eas update` says EXPO_TOKEN missing or not authenticated

eas-cli is normally logged in via `~/.expo/state.json` on the user's machine.
If it's gone, the user has to run `npx eas-cli login` once interactively.
You can't do this for them.

---

## Learnings — read this before debugging any provider

Each of these cost real time; none is obvious from the code. Where a later
change overtook a lesson's example, the note says so; the lesson stands.

**1. A green check does NOT mean the providers are fine.** In Sept 2026
`npm run check:hdfilm` reported HEALTHY while Dizipal playback was 100% dead
and every HDFilm series was falling through. Always reproduce the user's
*actual* symptom end to end before believing any health check. (That script
cannot reach HDFilm at all now; the principle applies to every check.)

**2. "Search works" and "it plays" are different systems. Test the second.**
Dizipal's `/ajax-search` answered 200 with correct results for the entire
outage; only `/ajax-player-config` had moved. Every provider here has the same
split. When a user says "it's in the app but says Not Available", go straight
to the *playback* step.

**3. Reproduce with the real resolver, not a re-implementation.** Write a
temporary script under `scripts/`, set `globalThis.__DEV__ = true`, import
`resolveWebPlayerUrl`, and run it with `npx tsx`. It works in node — the
`debugLog` lines name the failing provider and status immediately. Dizipal and
Dizibal resolve live from this machine; HDFilm needs the captured pages and a
stand-in session host (see the happy path). It MUST live under the repo and be
deleted afterwards. A returned URL is not proof of playback: fetch the
playlist and look for `#EXTM3U`.

**4. Distinguish "slow" from "broken" — for these providers they are the same
bug at different magnitudes.** Dizipal's rotation is a 301 chain, and the hops
are not one per rotation. A base a few days stale is slow; one far enough
behind crosses axios' 21-redirect ceiling and fails outright with
`ERR_FR_TOO_MANY_REDIRECTS`. Measure the chain rather than assuming "a few
hops".

**5. Measure a 403 before calling it a wall — and measure it again later.** In
Sept 2026 HDFilm's `/dizi/` 403 was a first-request challenge: 9/10 requests
passed with connection reuse, 0/10 without, and a single `curl` said
"permanently blocked" and was wrong. By 2026-11-11 the same 403 had become
permanent for non-browser clients, and the retry that had been "the entire
fix" was three wasted requests per page. Both conclusions were right on their
day.

**6. Prefer reading data the page already carries over calling an endpoint for
it.** Until 2026-09-25 Dizipal's `data-cfg` decoded to exactly what
`/ajax-player-config` returned, and decoding it locally made an endpoint
rename a non-event. (It is a single-use token now, so the POST is back.)

**7. Self-healing config must outlive the refresh that fights it.** The pin from
`recordObservedBaseUrl` was being clobbered by `refreshProviderConfigs()` — the
retry path was undoing its own fix. If you add optimistic local state on top of
remote config, define exactly when remote takes it back (here: the published
base changing at all) and test both directions.

**8. Fixing one provider can silently demote a better one.** After any provider
fix, re-check *which* provider serves each title (`provider` in
`player_resolve`), not just that something plays.

**9. When you fix a class of failure, add the monitor check in the same
change.** `dizipal_playback` exists because nothing would otherwise have caught
a repeat. Verify a new Worker check from Worker egress before trusting it —
`wrangler dev --remote` against a throwaway probe worker — since Cloudflare
egress is treated differently from the user's residential IP by every one of
these providers.

**10. Correct this document when reality contradicts it.** A stale claim here
("HDFilm series are unreachable altogether") once misdirected an
investigation for weeks; by November 2026 this file still opened with a check
script that could no longer run and an update flow removed in June. If you
disprove something here, rewrite it in the same commit and say when it was
re-measured.

**11. A diagnostic tool with its own copy of production parsing WILL lie to
you.** `check-hdfilm-resolver.ts` kept a private `extractPartsArray` that still
looked for `s_*`. When HDFilm renamed those identifiers, that copy matched
nothing and dropped every probe as "no embed" *before* the health check ran —
so the script reported "provider domain moved" while the site was up. If you
must duplicate production logic in a tool, make the duplicate non-blocking.

**12. Prefix-based extraction is a liability; match the shape, not the name.**
Both `sources: [{file: s_…}]` and `= dc_…(` were prefix matches, and both broke
the day HDFilm switched to random short identifiers. The structure is what the
page guarantees; the naming is not.

**13. "Cannot be monitored" is a finding to write down, not a gap to paper
over.** Both available runners are datacenter IPs and both are 403'd by HDFilm,
so a monitor check would fail forever and train everyone to ignore the alerts.
Where no prober can reach, instrument the app instead: `player_resolve` carries
the provider, each tier's outcome (`tiers`) and the HDFilm reads that failed
(`hdReads`).

**14. The header VALUE can matter, not just its presence.** HDFilm's
`/search/?q=` returns the JSON payload only for `X-Requested-With: fetch`. With
`XMLHttpRequest` it returns a **404 HTML page**. A probe that used the wrong
value would have "proved" the search endpoint was gone.

**15. A playback error is not a missing title.** `PlayerScreen` once mapped any
expo-video `status === "error"` on a direct source to "isn't in our catalog
yet". ExoPlayer raises that status for ordinary hiccups — seeking past the
buffered edge, one 5xx segment, an expired CDN token. Reserve `not_found` for
resolve-time exhaustion; recover a started stream in place (see
`recoverCurrentStream` and `src/screens/player/streamHealth.ts`).

**16. Record which step failed before guessing why.** From 2026-11-19 HDFilm
played for two viewers a day while every phone logged its session `ready`. Four
plausible fixes were shipped over a week. The cause was a 451 legal-block page
that passed for a ready session, and it was found the day after the app
started recording each tier's outcome and the session page's title. When a
failure cannot be reproduced off-device, ship the measurement first.

**17. "Ready" must mean "the site's own page", not "anything but the
challenge".** HDFilm's session accepted any page that was not titled "Just a
moment…": a challenge page in another language and the 451 page both
qualified. Test for the page you expect, and name the pages that mean stop.

**18. The developer's phone is not the user base.** The owner's network is one
HDFilm accepts, so every fix "worked" in testing. Count *viewers* a provider
serves per day, not plays.

**19. A provider can remove a title or break its own player.** Before debugging
a miss, load the provider's page for that title in a browser: an empty player
(HDFilm: Dune) or a player that errors there too (Dizipal, 2026-11-26) is not
the app's bug.

---

## Hard constraints (DO NOT CHANGE)

- **Runtime version.** `app.config.js` pins the runtime the checked-out branch
  ships to — `1.2.0` on `v1.2.0`, the only live runtime. An OTA only reaches
  installs on the matching runtime, so **read `app.config.js` before every
  `eas update`** and never bump it to "reach more users". See `ENGINEERING.md` §2.
- **OTA branch.** Always `preview`. That's the channel installed apps listen
  on (`updates.url` in `app.config.js`).
- **Tests.** 654 tests as of 2026-11-26. If the count drops or any fail, do not
  push.
- **No resolver workflow in CI, and no HDFilm check in the Worker monitor.**
  `.github/workflows/ci.yml` (typecheck / lint / test) is fine and stays.
  Cloudflare blocks GitHub's and Cloudflare Workers' datacenter IPs on
  `www.hdfilmcehennemi.nl` and `hdfilmcehennemi.mobi` (403 "Just a moment…" on
  every path; re-verified 2026-09-22 with `wrangler dev --remote`), so such a
  check fails on every run and trains everyone to ignore the alerts.
- **HDFilm can only be observed from phones and from a real browser.** Since
  2026-11-19 plain requests are refused even from the owner's home IP. Use the
  app's telemetry and the Playwright capture.
- **Do not hunt for ways past a block with raw requests.** Trying header
  variants against a bot check or a legal block is not this project's method
  (and headers have never made a difference here). Record what a real browser
  does and have the app do the same, or report that the site refuses.
- **Where to run from.** The user's Windows PC. Its home IP is what reaches
  Dizipal and Dizibal; cloud VMs are blocked by all of them.

---

## Architecture pointers (for unusual breakage)

- The decoder interpreter lives in **`src/services/rapidrameScript.ts`**, a
  small but general JS interpreter:
  - `runRapidrameDecoder(functionSource, valueParts, pageUrl)` — the entry
    point. Parses the live decoder body and calls it; `pageUrl` backs the
    read-only `location` the body may consult.
  - `tokenize` / `Parser` — tokenizer (including regex-literal disambiguation)
    and recursive-descent parser producing an AST.
  - `Interpreter` — the AST walker. Supports arrays and element assignment,
    `if`/`for`/`while`/`return`/`break`/`continue`, multi-declarator `var`,
    ternaries, closures, and the string/array built-ins the bodies use.
  - `bail` / `UnsupportedScript` — the fail-closed guard. Any construct or call
    outside the modelled subset aborts the decode rather than being skipped
    (skipping would produce a plausible-but-WRONG url).
  - `compileRegex` — rejects quantifiers, groups and alternation.
  - `MAX_STEPS` / `MAX_STRING_LENGTH` / `MAX_ARRAY_LENGTH` — the budgets that
    bound a hostile or malformed body.
- Provider glue stays in **`src/services/WebPlayerService.ts`**:
  - `hdFilmGet` — every HDFilm request goes through this. Search and `.mobi`
    go natively; a gated page is tried natively once, then read through the
    session (session first while it is open or the gate was met lately); a 451
    sets HDFilm aside (`isHdfilmLegallyBlocked`).
  - `extractHdFilmEmbedUrl` — finds the iframe in the film page.
  - `resolveHdFilmNativeFallback` — asks the `.mobi` embed and the rplayer page
    together (`firstHitByPriority`).
  - `extractRapidrameStreamUrl` — unpacks (`tryUnpackInlinePackerJs`), then
    reads the source: `decodeRapidrameInlineSource` for the inline call,
    `decodeRapidrameByInterpretingDcBody` for the variable form,
    `RAPIDRAME_PRE_UNMIX_TRANSFORMS` as the legacy fallback.
  - `buildHdFilmResult` — returns a native result (`source: "direct"`) when a
    stream URL was decoded, and a page result with no `streamUrl` otherwise,
    which the resolver discards: the provider's page is never shown.
    `webViewFallbackUrl` only marks the stream as HDFilm's, so a stream that
    dies at playback asks the other providers.
  - `fetchDizipalStreamUrl` → `fetchDizipalPlayerPage`,
    `postDizipalPlayerBeacon`, `postDizipalPlayerConfig`, `decryptDizipalEnc`
    — Dizipal's chain as listed above.
  - `providerGet` — every native provider request: challenge retries and the
    per-host breaker (`noteProviderSilence`, `isSettledOutage`).
  - `resolveWebPlayerUrl` / `resolveWebPlayerUrlInner` — the passes, the tier
    race (`firstNativeByPriority`) and the `trace` that telemetry records.
- The hidden sessions: **`src/services/webSession.ts`** (the machinery),
  **`hdfilmSession.ts`** and **`kultfilmlerSession.ts`** (one each), mounted by
  **`src/components/common/WebSessionBridge.tsx`**.
- Provider hosts live in **`src/services/providerConfigService.ts`**:
  - `HARDCODED_FALLBACK` — bump `dizipal.baseUrl` here when the domain rotates;
    it is the floor for the numeric rule below.
  - `normaliseDizipalBaseUrl` / `parseDizipalSuffix` — Dizipal rotation only
    moves forward, so a published base with a LOWER `dizipalN` suffix than the
    shipped one is ignored.
  - `recordObservedBaseUrl` / `adoptBaseline` — the self-heal pin and the rule
    that decides when remote config takes it back.
- Player-side recovery: **`src/screens/player/streamHealth.ts`** and
  `recoverCurrentStream` in `PlayerScreen.tsx`.
- Health check script: **`scripts/check-hdfilm-resolver.ts`** — cannot reach
  HDFilm since 2026-11-19 (always exit 2); kept for the day the gate drops.
- Uptime monitor: **`workers/provider-monitor/`** (Cloudflare Cron, hourly).
  It covers Dizipal and Dizibal, not HDFilm or Kült Filmler. Deploy with
  `npx wrangler deploy` from that folder.
- Regression tests: `tests/rapidrameScript.test.ts` (decoder families),
  `tests/hdfilmInlineSource.test.ts` (the inline source),
  `tests/webSession.test.ts`, `tests/hdfilmSession.test.ts` and
  `tests/hdfilmReads.test.ts` (the session and HDFilm reads),
  `tests/providerOutages.test.ts` (451, Dizipal's player, settled outages),
  `tests/webPlayerService.test.ts` (matching, scoring, Dizipal, breakers) and
  `tests/providerConfigService.test.ts` (rotation and self-heal).
- App-side OTA delivery: `src/services/appUpdateService.ts` (cold start, then
  at most every 5 minutes on foreground) and
  `src/components/common/LiveOpsHost.tsx` (a "Restart now / Later" card, held
  back during playback via `isPlayerActive()`).

---

## What the user wants when they ask you to fix this

Direct execution, not consultation. Run the triage. If something can be fixed,
fix it and ship it (they ask for "commit and deploy" in the same breath), then
tell them concisely what was broken, what you changed, and the OTA group ID.
If the cause is on the provider's side — a legal block, their player down, a
removed title — say that plainly, with the evidence, and do not ship guesses.

When you ship successfully:
- Confirm the commit SHA and the OTA group ID.
- Remind them users get it after the next update check, via the restart card.
- Tell them anything only they can do (`/set_dizipal <url>`, for instance).
