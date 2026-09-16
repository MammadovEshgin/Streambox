# Changelog

All notable changes to StreamBox are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The app ships over-the-air on runtime **1.2.0** (branch `v1.2.0`). The older 1.0.2 and 1.1.0
runtimes are retired; entries mentioning them are historical. Update group IDs for each
release are recorded in [`ENGINEERING.md`](ENGINEERING.md).

## [Unreleased]

### Fixed — providers, Stats cast, language, playback stalls, Bakcell, launch smoothness (2026-09-15)

**Resident Evil (2026) played Resident Evil (2002).** The new film isn't on any
provider yet, so the resolver fell through to Dizibal, whose title-only scorer
accepted the 2002 record with the same name — Dizibal returned the identical
stream for both requests. A Dizibal hit whose own TMDB or IMDb id contradicts
the request is now never considered, and one dated outside the year tolerance
is ruled out. Provider sweep otherwise healthy (HDFilm, Dizipal, Dizibal all
resolving to live HLS manifests); **Dizipal rotated again, 2131 → 2132**, and
the shipped floor follows.

**Stats still missed Cate Blanchett's Lord of the Rings films.** Three reasons
the previous fix never reached the data. The backfill that re-reads old entries
stamped an entry as up to date even when its request failed; it only saved when
the whole pass finished, which a long history rarely did before the app closed,
so it restarted from scratch on every launch in several screens at once; and a
synced device took the cloud's five-name cast rows (the table's limit) as
current. Entries now keep the top **20** billed people, de-duplicated; the
backfill runs once per session after launch settles, two requests at a time,
pauses during playback, saves slice by slice and retries failures on a later
launch; and full cloud rows are refetched instead of trusted.

**The app felt slower since the 2026-09-11 update.** That same backfill: every
mounted screen ran it over the whole history on every storage change, fetching
details plus a third-party IMDb rating per title, and a pass that finished
could overwrite titles marked watched while it ran. Writes to the history now
share one lock and read the stored list inside it, and the parsed history is
shared by every screen instead of re-parsed by each on every storage change.

**The launch logo seemed to freeze.** The app tree mounted 2.4s in, right on the
splash's spin-slide. It now mounts once the motion has finished, the settled
lockup holds until the screen beneath has painted, and no spinning loader runs
invisibly under the splash.

**Turkish posters and titles under an English UI (Watchlist, Liked).** Profile
shelves hydrate through a concurrency queue, and each request read the language
when it actually left — seconds after its cache key was computed — so a switch
in between stored one language under the other's key for the cache's week-long
TTL. The request now carries the key's language, and the old cache is dropped.

**Playback paused for a couple of seconds, then carried on.** expo-video's
Android defaults resume a stalled stream with just 2s buffered, so a dip in
provider CDN speed played two seconds and stalled again. The player now waits
for 4s and keeps a 60s forward buffer.

**Nothing loaded on Bakcell mobile data.** A week of TMDB proxy logs shows every
Azerbaijani carrier and ISP except Bakcell (AS197830) — its subscribers can't
reach the proxy's `workers.dev` host. TMDB requests now fail over to the same
Worker on `tmdb.streamboxapp.stream` when a request gets no response, and
remember the host that answered. The custom domain is attached to the Worker
(`routes` in `workers/tmdb-proxy/wrangler.jsonc`).

### Fixed — Dizipal domain rotation (2026-09-14)

Provider health sweep from a residential connection. HDFilm resolved 8/8 probe
titles natively (1.1–5.2s), Dizibal 6/6 of the titles it carries, Dizipal 3/3
series and 3/3 films. The one defect: **Dizipal rotated `dizipal2130.com` →
`dizipal2131.com`**, so every Dizipal request walked a 301 that alone measured
about a second. The shipped fallback — which `normaliseDizipalBaseUrl` treats
as a floor over a stale Supabase row — is now 2131, and the test that guards
the floor was raised with it.

### Fixed — search, provider coverage, library correctness, navigation, keyboard (2026-09-11)

Eight reported defects. Several turned out to share a root cause, and two of
them were the same class of mistake in different places: a heuristic that was
allowed to override direct evidence.

**Search answered a film with a stranger's filmography.** Typing `harry` found
the films; typing `harry potter` found none of them. TMDB's person index
contains a real acting credit literally named "Harry Potter" — popularity 0.28,
no photo, one television credit — and an exact name match scored a perfect 1000,
which unconditionally overrode the title results. (One word could never reach
that score, which is why half the query worked.) A person may now outrank a
matching title only if they are *prominent*: a profile photo and a non-trivial
popularity, i.e. someone a viewer could plausibly have meant. Searching Tom
Hanks or Cate Blanchett by name still returns their filmography; searching a
film by its name returns the film. The name matcher also now picks the best
match among all acting results rather than testing only the most popular one, so
an exact match sitting under a more popular partial one is no longer discarded.

**Search deleted results whose only match was a translated title.** The
weak-match quality floor (`rating >= 6`) applied to everything that did not score
against the typed query. With the UI in English, a Turkish query is matched by
TMDB against a translation the app never sees, so the film scored zero and the
floor deleted it — as it did new releases and niche titles, which TMDB reports as
unrated. The floor now applies only when the list already contains a title the
viewer plainly named; when nothing scores, what TMDB returned *is* the answer.
Two new scoring tiers back this up: whole-word matches at the *end* of a title
(the usual shape of a localized subtitle — "Harry Potter ve Sırlar Odası"), and
full token coverage in any order.

**"Rosemary's Baby" reported Not Available while HDFilm was carrying it.**
HDFilm's search does not tokenize an apostrophe: `/search/?q=Rosemary's Baby`
returns zero rows, `/search/?q=Rosemarys Baby` returns the film. The
punctuation-free spelling existed in the query plan but sat *behind* the
year-qualified variants, so the two-query empty-result cutoff fired before it was
ever sent. Every possessive title failed identically — verified live against the
site: Ocean's Eleven and Schindler's List were also unreachable. Distinct
spellings of a name are now all emitted before any year-qualified variant, and
the sweep budget can no longer cut off mid-way through them.

**A film's original title was withheld from the resolver under a Turkish UI.**
`originalTitle` was only populated for non-English films, so with the app in
Turkish an English-language film handed the provider search nothing but its
Turkish title. It is now populated whenever it differs from the display title.
Punctuation cleaning also stopped deleting non-ASCII letters (JS `\w` is
ASCII-only, so "Bebeği" was being cleaned to "Bebei").

**Marking something watched left it in the watchlist.** The watchlist answers
"what do I still want to see?", so every path that logs a title as watched — the
log sheet, the season modal, the player's auto-mark — now removes it. A
Letterboxd import prunes titles it has just proven were watched, instead of only
declining to add new ones.

**Back from a grid landed on Discover.** React Navigation's `navigate(name)` does
not push when a route of that name is already in the stack — it pops back to the
existing instance and destroys everything above it. Actor → See All → a film →
Back therefore collapsed onto the MovieDetail the journey started from, and one
more Back reached the tab root. Every screen that can be reached *from* a detail
screen now uses `push` for routes that can legitimately repeat.

**Stats' most-watched actors missed the films they were counting.** A watch
history entry stored the top **five** billed names, and the TMDB details fetch
supplied only twelve. Cate Blanchett is credited 13th on The Fellowship of the
Ring, so the trilogy could never count towards her and never appeared in the list
her row opens. Entries now keep 15 of 20 fetched, cast lists de-duplicate (TMDB
lists an actor once per role, and counting both made a tally exceed the number of
titles it summarised), and `METADATA_VERSION` is bumped so existing entries are
re-enriched.

**The profile watchlist count climbed in batches.** The section header counted
*hydrated poster cards*, so it ticked upward as TMDB lookups landed instead of
stating the number the app already had on disk. It now states the stored count
immediately. The rails hydrate only their head (30) rather than all several
hundred, and See All pages in as the grid is scrolled.

**"Recently added" showed the oldest bookmarks first.** Stored id lists are
append-ordered, and the sort walked them forwards. They are now reversed into
display order. Sorting by year no longer returns `NaN` from a comparator for
undated titles ("----"), which had left the whole list arbitrarily ordered rather
than just that entry.

**Switching language left content in the language you had just left.**
`i18next.changeLanguage` is asynchronous; the settings store is not. For a render
or two after a switch, `i18n.resolvedLanguage` still reported the old value, and
everything keyed on it — the TMDB `language` parameter, the poster hydration
cache key — acted on it. That is both the Turkish posters under an English UI and
the stretch of duplicated loading after every switch. A new
`localization/contentLanguage` module is set synchronously by the settings store
before it re-renders, and every content path reads from it.

**The room code field hid behind the keyboard.** "Have a code" sits near the
bottom of a tall scroll page with no keyboard handling at all. The form is now
scrolled into view on focus, with `KeyboardAvoidingView` on iOS.

Ranking, shelf ordering and the watchlist rule moved into pure modules
(`utils/searchRanking`, `utils/profileShelf`, `utils/watchHistoryOps`) and are
covered by 45 new tests, including fixtures taken verbatim from the live TMDB
responses that produced each bug.

### Fixed — Dizipal rotation, Cloudflare-challenge resilience, monitor false alarms (2026-09-10)

The Telegram bot paged "Dizipal is down" three runs in a row. Dizipal was not
down. Two separate defects produced that alert, and one of them was hiding a
real problem underneath.

- **Dizipal had rotated 2126 → 2130 and the monitor never said so.** Supabase
  was pinned at 2127, i.e. three dead 301 hops on every single Dizipal request.
  The pinned fallback now ships 2130. Because `normaliseDizipalBaseUrl` treats
  the shipped constant as a floor, this takes effect even where the Supabase row
  is still stale. A regression test now fails if the shipped floor falls behind
  the last domain verified live.
- **Dizipal started serving Cloudflare challenge pages to a fraction of
  requests, and the app dropped the whole tier when it got one.** HDFilm's
  fetches have retried past this interstitial since 2026-09-02, but Dizipal's
  search and page fetches used a bare `axios.get`, so a challenged request read
  as "Dizipal doesn't have it" and the resolver fell through to Dizibal — which
  is slower — or to nothing at all. Both providers now share one `providerGet`
  helper with the same two-retry budget. Non-challenge failures (a 404 meaning
  the title really is absent) are still not retried.
- **The monitor took the first 403 as final, so an intermittent challenge read
  as a 36-hour outage.** It now retries a challenged request twice before
  calling an endpoint down, matching the client it is supposed to model. Only a
  genuine interstitial is retried — the body is inspected, not just the status
  — so a real permission failure still fails fast.
- **A failing check could hide a rotation.** A challenge is served *at* the
  requested host, so nothing redirects and the rotation detector saw nothing.
  That is precisely how 2127 → 2130 stayed invisible behind three days of 403
  pages. Rotation is now appended to the failure reason instead of being
  replaced by it, so the alert carries the fact that needs acting on.
- Corrected a stale comment pointing at `.github/workflows/provider-health.yml`,
  a workflow that was deleted and must not come back — GitHub Actions runners
  are datacenter IPs and get challenged exactly like Worker egress.

Verified from Cloudflare Worker egress on 2026-09-10: Dizipal 36/36 clean,
Dizibal 200, HDFilm 403 (unchanged, and still unmonitorable from any datacenter
IP). End-to-end, 10 of 10 probe titles resolve, Castle Rock episodes among them
at 1.4–2.8s on HDFilm's dual-audio stream.


### Fixed — HDFilm decoder rewrite, player false "Not Available", search, Watch Together (2026-09-08)

HDFilm — **tier 1** — was 100% dead and no dashboard had noticed, because
nothing can monitor it (see below). Every play was silently walking the whole
provider chain, which is what "the app got slow" and "it's available but won't
open" actually were. Verified after the fix: 10 of 10 probe titles resolve, in
0.6–1.0s, and nearly all now land on HDFilm's dual-audio stream rather than a
Turkish-dub-only fallback.

- **HDFilm changed its stream obfuscation and every title on it stopped
  playing.** The parts array and its decoder are no longer named `s_*` / `dc_*`
  but random short identifiers (`var avdp1 = h738([...])`), and the algorithm
  gained a whole new family: two literal seed strings derive an LCG and an XOR
  seed, a Fisher-Yates pass un-shuffles the characters, and only then does the
  rolling-XOR cipher run — wrapped in dead `if (x.length > 100000)` guards whose
  positions are re-shuffled on every request. `rapidrameScript.ts` is now a
  small but general JS interpreter (tokenizer → recursive-descent parser → AST
  walker) instead of a single-loop statement runner, so all three de-scramble
  families decode through one code path and the next reshuffle costs nothing.
  It still executes no `eval`/`Function`, still fails closed on anything outside
  the modelled subset, and now also rejects backtracking-prone regexes and
  bounds itself with step and size budgets. Extraction matches the page's
  *structure* rather than the `s_`/`dc_` prefixes that broke.
- **A stream hiccup was being reported as "this title isn't in our catalog
  yet".** Any expo-video `status === "error"` on a direct stream became
  `not_found`. ExoPlayer raises that for ordinary things — seeking past the
  buffered edge, one 5xx segment, an expired CDN token, a track switch racing
  the initial buffer — so seeking, or tapping the subtitle button just after
  opening, showed the "not available" card for a film that was playing a second
  earlier, and only backing out and re-entering fixed it. A stream that has
  already produced frames is now re-opened in place at the position it died on
  (3 attempts), and a playback failure can no longer masquerade as a missing
  title.
- **Black screen with audio still playing.** The same error path left
  `isPlaybackReady` false, and only the *first* play could set it back — so
  after a recovered error the opaque loading overlay stayed painted over a
  playing video. Readiness is now restored on every play.
- **Search dropped titles that were typed correctly.** Two causes. Turkish ı
  (U+0131) has no Unicode decomposition, so the `[^a-z0-9]` strip deleted it and
  "Mezarlık" normalised to `"mezarl k"` — unmatchable against "mezarlik".
  Separately, a flat `rating >= 6` gate hid everything TMDB reports as unrated
  (`vote_average` 0 for too few votes): new releases, niche and non-English
  titles. When it hid *all* of them the result list went empty, which is one of
  the conditions that flips the search to the actor-credits branch — so a film
  search would answer with somebody's filmography, exactly the "conflict between
  movie search and actor search" that was reported. Folding now lives in one
  shared helper used by both TMDB search and the provider matcher, and the
  quality gate applies only to results that do *not* match the typed query.
- **Watch Together showed only the host's camera.** The peer connection was
  published to `pcRef` before its handlers were attached and before an awaited
  `setParameters` call. An offer arriving in that window was answered by a
  connection with no `ontrack` and no `onicecandidate`, so the partner's video
  never arrived and the answerer's ICE candidates were never sent. Because the
  window is one native round-trip wide, it reproduced on some phones and not
  others. Handlers and local tracks are now attached before the connection is
  published, with nothing awaited in between; an offer that lands while the
  camera is still being acquired is queued and replayed instead of dropped; and
  a peer whose connection is still coming up now answers the readiness
  handshake instead of staying silent until the other side's retry loop expired.
- **The resolver now reports which provider served each play.** HDFilm
  WAF-blocks datacenter IPs, so neither the Cloudflare Worker monitor nor a CI
  runner can probe it — re-verified with `wrangler dev --remote`, which gets a
  403 challenge on every path. The app's own devices are the only vantage point
  on residential IPs, so a `player_resolve` telemetry event now carries the
  resolved source and duration; a sustained shift away from HDFilm is the
  tier-1 outage signal that was missing this time.
- **The health check no longer misdiagnoses itself.** `check:hdfilm` kept a
  private copy of the parts parser that still looked for `s_*`; when that
  stopped matching it dropped every probe *before* the health check ran and
  reported "provider domain moved, or network/geo block" while the site was
  serving every page fine. Parts extraction no longer gates a probe, and the
  failure message now points at the real candidates.
- **Dizipal base bumped** `2123` → `2126` (live chain walked 2123→2124→2125→2126),
  and **Dizibal's embed host has recovered** — `x.ag2m4.cfd` serves again after
  the outage recorded on 2026-09-02, so all three tiers are healthy.


### Fixed — all three providers: Dizipal playback, Dizipal rotation cost, HDFilm series (2026-09-02)

Three independent provider breakages that together produced "everything is slow"
and "it's in the app but says Not Available". Verified end to end afterwards: 14
of 14 probe titles resolve to a live HLS manifest, none slower than 3.1s (the
same sweep before the fix had series failing outright at 7.7s).

- **Dizipal playback was completely dead.** The provider renamed
  `/ajax-player-config` to `/ajax/player-config`; the old path answers 404, which
  the resolver read as "no stream" and dropped silently — search kept working, so
  titles appeared in the app and then refused to play. This was the direct cause
  of the *Mezarlık / Graveyard* report: Dizipal is the only provider carrying it
  (HDFilm has no series page for it, Dizibal's embed host is down), so a broken
  Dizipal meant a missing title. The app now reads the player config straight out
  of the page's base64 `data-cfg` attribute — byte-identical to what the endpoint
  returned — which removes a token mint plus a POST from the critical path of
  every play *and* makes playback immune to the next rename. The network call
  survives as a fallback and tries both paths.
- **A stale Dizipal domain cost seconds on every request, and past 21 hops broke
  it outright.** `dizipalN.com` 301s to `dizipalN+1.com` and the hops are not one
  per rotation — the shipped base (`2079`) was 22 hops / 3.3s behind the live
  `2123`, i.e. past axios' redirect ceiling. The base is now current, and
  `normaliseDizipalBaseUrl` compares the numeric suffix so any published base
  older than the shipped one is ignored automatically instead of having to be
  enumerated by hand.
- **The self-healed domain no longer survives only until the next refresh.**
  `recordObservedBaseUrl` pins the post-redirect origin, but
  `refreshProviderConfigs()` overwrote it with the (lagging) Supabase value — so
  the "refresh, then retry" path in `resolveWebPlayerUrl` walked the entire
  redirect chain a second time, the exact opposite of what that retry is for. The
  pin now survives a refresh that republishes the same base, and is discarded the
  moment the operator publishes a *different* one, so `/set_dizipal` still wins.
- **The Dizipal direct-slug probe capped redirects at 5**, so on a stale base it
  was the one call that failed hard (`ERR_FR_TOO_MANY_REDIRECTS`) rather than
  merely getting slow. It now uses the same ceiling as every other Dizipal call.
- **Every HDFilm series was quietly losing to Dizipal.** `/dizi/` URLs answer
  `403 cf-mitigated: challenge` on the *first* request over a fresh connection
  and 200 on every one after it (measured: 9/10 with connection reuse, 0/10
  without; no cookie involved — the clearance rides on the connection).
  `findSeriesEpisodeUrl` and `checkVideoAvailability` read that first 403 as
  "HDFilm doesn't have it", so series fell through to Dizipal's Turkish-dub-only
  stream. HDFilm page fetches now retry past the challenge, and Breaking Bad,
  Severance, Stranger Things and From are back on HDFilm's dual-audio streams
  (6 subtitle tracks vs Dizipal's 2).
- **`provider-monitor` was green through the whole Dizipal outage** because it
  only probed search. Added a `dizipal_playback` check that decodes the episode
  page's `data-cfg`, and refreshed the worker's stale `dizibal.com` default and
  `/set_*` examples.

Known upstream outage, not fixed here: Dizibal's rotating Playerjs embed host
(`x.ag2m4.cfd`) returns 502 for every code, movies and series alike, while
`dizibal.org/api/*` stays healthy. Tier-3 fallback only; nothing to change on our
side.

### Fixed — non-Latin title search, audio menu, default subtitles, daily hero (2026-08-10)

Shipped to runtime **1.2.0** only — `v1.2.0` @ `7d08cc1` → EAS update group
`de6dcbdb-b64d-4e4b-9d06-2d7b512f6852`. 1.1.0 / 1.0.2 not shipped.

- **Films with a non-Latin original title reported "Not Available".** Harakiri
  (1962) is on HDFilm as `/harakiri-izle-hdf-4/`, but its TMDB original title is
  `切腹`. `generateSearchQueries` emitted the original-language spelling and its
  year variant first, and the two-query empty-result cutoff stopped the sweep
  before the display title was ever searched — so `切腹` and `切腹 1962` both
  returned zero rows and the film was declared missing. Every Japanese, Korean,
  Chinese, Cyrillic and Arabic-titled film failed the same way (verified: Oldboy,
  Parasite, Spirited Away all now resolve). Bare titles now go out first, and the
  cutoff is a floor that can never fire before each of them has been tried.
- **A one-year gap in provider metadata no longer rejects the match.** Turkish
  providers date a film by its local release: HDFilm lists *Dune: Part Two* as
  2023 against TMDB's 2024, and the hard year gate threw it out. ±1 year is now
  accepted with a small scoring penalty, so an exact-year listing still wins when
  both exist and the Dune 1984-vs-2021 protection is untouched.
- **Audio track menu showed every track as "Unknown".** expo-video's Android
  `AudioTrack.fromFormat` builds its label from `format.language` alone and drops
  `format.label`; provider DUAL masters carry `NAME="Turkish"` /
  `NAME="Original Audio"` but no `LANGUAGE`, so both renditions arrived as
  `{ language: null, label: "Unknown" }`. The names are recovered from the media3
  format id (`<GROUP-ID>:<NAME>`). This also repairs the original-audio
  preference, which had nothing to match on and was silently leaving the
  provider's `DEFAULT=YES` Turkish dub playing.
- **Subtitles start off.** The auto-enable-when-audio-isn't-your-language rule is
  gone; it put text over every foreign-language film watched in original audio on
  purpose. Provider `DEFAULT=YES` subtitle renditions are cleared on every track
  republish until the viewer picks one from the CC menu.
- **Movie/series of the day stopped rotating.** Two causes. (1) The pick was
  `hash("<type>:<user>:<date>") % shortlistLength`, which collides across
  consecutive days about one time in six and could repeat a title days later; it
  now steps by the day number, so consecutive days always differ, and the last
  seven days' picks are excluded outright. The TMDB-rate-limit fallback path also
  returned `filteredCandidates[0]` — an index with no date in it at all, i.e. the
  same film forever. (2) A hub refresh that ran before the liked/watched lists
  had loaded wrote the *previous* day's hero into the cache stamped with today's
  freshness version; for an account with no liked or watched titles that version
  never changed afterwards either, so the stale hero carried forward day after
  day. Such snapshots are now marked pending so the next focus re-runs the pick.

### Fixed — provider resolution, playback audio/subtitles, watched-season sync (2026-08-02)

- **HDFilmCehennemi decoder rebuilt as an interpreter.** The provider replaced
  its arithmetic de-scramble (`c - (CONST % (i + N))`) with a rolling-XOR
  cipher, and randomizes the whole `dc_*()` scheme per request (15 live fetches
  → 13 distinct shapes). The old matcher returned `null` for *every* HDFilm
  title, so films silently played from Dizipal/Dizibal instead — Turkish-dub
  audio only — and every play burned the full ~15–20s resolver budget first.
  New `src/services/rapidrameScript.ts` parses and replays the live function
  body (no `eval`; Hermes has none and running provider JS would be a
  code-execution sink) and fails closed on anything outside its subset.
- **Dizipal player-config handshake repaired.** `/ajax-token` now returns JSON
  `{"t":…}`; the old code stringified the parsed object and sent the literal
  `"[object Object]"`, so every config POST answered `"Invalid token"`. The
  token is also single-use, and validation covers the whole cookie jar
  (`_ct` + `PHPSESSID` + DDoS-Guard `__ddg*`) — hand-setting a `Cookie` header
  replaces the native jar and fails.
- **Native players only.** Dizipal page/embed shells are no longer returned as
  playable results; they rendered the provider's own Playerjs with no route back
  to native. Playback now always lands in `expo-video` or the app-owned hls.js
  surface. Trade-off: a title whose stream can't be extracted shows "Not
  Available" rather than the provider's player.
- **Resolver latency.** Removed a duplicated Dizipal search in the
  Turkish-title retry, and stopped sweeping weaker query variants once a
  provider has returned zero rows. Measured across 13 live titles: all resolve
  natively in 0.9–3.2s (was: 3 of them falling to a provider WebView, worst case
  ~15.8s); "Not Available" now settles in ~3.2s.
- **Season watch history never synced.** Season entries are keyed
  `series-season:{id}:{n}`, which was sent to Supabase's `internal_id` — a
  `uuid` column. Postgres rejected every write and, because failed ops re-queue
  forever, they also clogged the durable sync queue. Production held 2327
  watch-history rows and **zero** season rows. Non-uuid ids are now hashed to a
  stable uuid (`deriveStableUuidFromKey`) and the readable key is rebuilt from
  the row snapshot on the way back down.
- **Watched seasons missing from the Profile list.** Ticking episodes wrote only
  the episode map, so SeriesDetail showed a season as watched while watch
  history — what Profile and Stats read — had no entry. New
  `useSeasonWatchHistorySync` reconciles both stores from the episode toggle and
  from the player's auto-mark, and only ever removes undated entries so an
  explicitly dated season is never deleted by un-ticking one episode.

### Added

- **Audio track selection.** Turkish providers flag the dub `DEFAULT=YES`, so
  ExoPlayer dubbed every film. The player now prefers the original soundtrack,
  exposes a picker, and remembers the choice across titles.
- **Automatic subtitles.** Subtitles switch on when the soundtrack isn't in the
  app's language, picking a track in that language. `Forced` tracks (a handful
  of sign-only cues) are never auto-selected but remain in the menu.

- ESLint 9 (flat config, built on `eslint-config-expo`) + Prettier with `npm run lint` / `npm run format` scripts.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) — runs `typecheck` + `lint` + `test` on every push and PR to `main`.
- `SECURITY.md` describing the vulnerability disclosure policy.
- `CHANGELOG.md` (this file).

### Removed

- `content-sources/az-classics/` (767 files, 56MB) — never wired into the app.
- `.agent/` — duplicate of `.agents/skills/`.
- `src/components/common/LaunchAnimationOverlay.tsx` — never imported.
- Unused assets (`announcement-logo-banner.png`, superseded `frenchise-card-bg.jpg`).
- Empty directories (`src/screens/tv/`, `scripts/lib/`).
- `hermes-parser` from direct dependencies — already pulled in transitively by Expo + RN.

## [1.0.2] — 2026-06-16

### Fixed

- **Dune (2021) opening Dune (1984)** — hard year gate in `findBestHdFilmMatch` and `searchDizipal` rejects candidates whose known year disagrees with the target.
- **HDFilm WebView shown when Dizipal had a working stream** — WebView fallbacks are now deferred until every native provider has been tried (Dizipal native/embed + Stremio direct).
- **Harry Potter / Fantastic Beasts not playing** — `getTurkishAlternativeTitle` now queries TMDB's `/translations` endpoint (canonical Turkish title) instead of the rarely-populated `/alternative_titles`. Title normalization also folds the Turkish dotless ı (U+0131) to "i" before stripping non-alphanumerics, so "Yadigârları" correctly matches the slug "yadigarlari".
- **"Cuban Fury" returned for "Fury"** — substring-only matches no longer get the wrong-year boost; the score stays below the provider cutoff so the resolver falls through.
- **HDFilm Rapidrame decoder rotation** — auto-derived `reverse → b64 → rot13` scheme added.

### Changed

- Movie / Series of the Day rolls over at local midnight (with AppState wake-up for sleeping devices).
- Daily-pick cold start always fetches fresh.
- Persisted hub caches hydrate into memory before first render (no more skeleton flash on cold start).
- `fallbackToCacheTimeout` raised to 3000ms so new APK installs jump to the latest OTA on first launch.
- Deactivated the legacy "New APK Available" Supabase announcement (was greeting fresh installs as a confusing pop-up).

### Removed

- Removed the in-app "Restart Now" modal — OTA updates apply silently on the next background→foreground transition while the player is idle.
- Removed the abandoned cloud-VM automation scripts (Oracle / GitHub Actions). Decoder rotation is now handled via the manual playbook in [`decoder-recovery.md`](decoder-recovery.md).

## [1.0.1] — Earlier

Baseline runtime. Initial multi-provider resolver, Supabase user-data platform, taste profiles, franchise timelines, native expo-video player.
