# Changelog

All notable changes to StreamBox are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Runtime versions (EAS Updates compatibility): **1.0.2**, **1.1.0**, **1.2.0** —
this branch (`v1.2.0`) ships to **1.2.0**. See
[`docs/release-tracks.md`](docs/release-tracks.md) for which fleet gets what.

## [Unreleased]

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

Shipped to runtime **1.2.0** only — `v1.2.0` @ `3eb6b70` → EAS update group
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
