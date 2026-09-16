# Streambox — Engineering Context & Guardrails (read first)

This file is the operating manual for anyone (human or AI) making changes to this
repo. The task prompt that pointed you here assumes you have read and will obey
everything below. When in doubt, **stop and ask** rather than guess.

---

## 1. What the app is

- React Native + Expo (SDK 54) mobile streaming app. TypeScript, styled-components,
  React Navigation, Reanimated v4, react-native-svg.
- Data: TMDB (primary), OMDB + imdbapi.dev (ratings), Letterboxd (scraping).
- Streaming is resolved **natively** (no WebView/iframe player) via provider
  scraping in `src/services/WebPlayerService.ts` (HDFilm → Dizipal → Dizibal chain).
- Backend: Supabase (Postgres + RPC + Storage). User data sync lives in
  `src/services/userDataSync.ts`. SQL lives in `supabase/migrations/`.

### Key files you will likely touch
| Area | File |
|------|------|
| Provider search / stream resolution | `src/services/WebPlayerService.ts` |
| Match scoring (title + year) | `WebPlayerService.ts` → `scoreMatch`, `scoreHdFilmResult`, `scoreDizipalResult`, `probeDizipalDirectSlug` |
| Player entry point | `src/screens/PlayerScreen.tsx` (`buildWebPlayerRequest`, `resolveWebPlayerUrl`) |
| Watch-history state/hook | `src/hooks/useWatchHistory.ts` |
| Watched-episode state | `src/hooks/useWatchedEpisodes.ts` |
| Season-log confirm handler | `src/screens/SeriesDetailScreen.tsx` → `handleWatchedConfirm` |
| Season-log modal UI | `src/components/detail/SeriesWatchedModal.tsx` |
| Profile watched/watchlist/liked shelves | `src/screens/ProfileScreen.tsx` |
| Supabase sync (queue, upsert, prune) | `src/services/userDataSync.ts` |
| Media hydration cache | `src/services/mediaHydration.ts` |
| DB schema | `supabase/migrations/*.sql` |

---

## 2. OTA runtime tracks — THIS IS THE MOST IMPORTANT SECTION

There are **three live OTA runtimes** served on EAS Update channel **`preview`**. EAS
routes each update to installs by their **`runtimeVersion`** — an update published
for one runtime is invisible to the others. Native code cannot ship over OTA; only
JS/asset changes do. **OTA routing is by `runtimeVersion` + channel, never by git
branch name** — the branch names below are organizational, so publishing depends on
the `app.config.js` runtime, not the branch you happen to be on.

| Runtime | Branch | Fleet | Hard rule |
|---------|--------|-------|-----------|
| **1.2.0** | `v1.2.0` (renamed 2026-07-23 from `release/1.2.0-watch-together`; folds in `feat/azerbaijani-classics`) | Watch Together APK build | Adds native `react-native-webrtc` + `expo-camera`. **Isolated — never ported back to 1.1.0/1.0.2.** `runtimeVersion` in `app.config.js` is a fixed `"1.2.0"`, so publishing from this branch auto-isolates. See **§2A**. **Player autonomy** (auto-mark-watched, next-episode, episode picker) was folded in 2026-07-28 (JS-only, ships as a 1.2.0 OTA); see **§2B**. The abandoned 1.3.0 social platform was removed the same day (teardown migration `20260728090000`). |
| **1.1.0** | tag `archive/release-1.1.0-navbar` (branch deleted 2026-09-14) | Nav-bar APK build | Frozen. For an emergency OTA, recreate the branch from the tag; `runtimeVersion` there is `1.1.0`. |
| **1.0.2** | tag `archive/release-1.0.2-legacy` (branch deleted 2026-09-14) | Legacy fleet, **no nav-bar** | Frozen. **MUST NEVER contain nav-bar code** (see below). |

### Other branches
- `main` — default branch. Since 2026-09-14 it carries `v1.2.0` (merged, then kept identical): commit on `v1.2.0` and fast-forward `main` to it. Never force-push it without the owner's explicit say-so.
- Android TV — **abandoned**; no TV build will ship. The old `feature/android-tv` commit line (pre-rewrite history, never merged into any release branch) is dropped and not kept as a tag.
- Ephemeral `feat/*` work branches — cut from `v1.2.0`, merged back, then deleted once `git diff v1.2.0 <branch>` is empty. Don't let them accumulate.
- `archive/release-1.1.0-navbar` / `archive/release-1.0.2-legacy` (tags) — the exact code lines of the two older fleets, kept when their branches were deleted on 2026-09-14. Everything else on them (splash, loaders, Watch Together resolver, Azerbaijani classics) is already in `v1.2.0`.
- `archive/navbar-apk-base` (tag) — the retired `release/navbar-apk` base of the 1.1.0 line, preserved for history; fully contained in `archive/release-1.1.0-navbar`.

### Non-negotiable OTA rules
1. **1.0.2 must NEVER include `expo-navigation-bar` / `NavigationBar` / `systemNavigationBar` / `expo-navigation` code.** These crash legacy APKs. When porting a file from the 1.1.0 branch to the 1.0.2 branch, diff it and confirm **zero** nav-bar references before committing. This has bitten us before — a wholesale `git checkout release/1.1.0-navbar -- PlayerScreen.tsx` dragged nav-bar imports onto 1.0.2. Verify with:
   ```bash
   git diff HEAD -- <file> | grep -Ei "navigation-bar|NavigationBar|expo-navigation|systemNavigation"
   ```
   It must print nothing.
2. **Any change that adds or upgrades a native module cannot go OTA.** It requires a new native build **and** a `runtimeVersion` bump (e.g. `1.2.0`). Do **not** reuse `1.1.0` for a build that adds a native module — existing `1.1.0` installs would crash on the next OTA when they call the missing module. Prefer pure-JS solutions to stay OTA-deliverable (this is why the loader was rebuilt with SVG+Reanimated instead of Lottie).
3. To ship to an older fleet, recreate its branch from the archive tag (e.g. `git switch -c release/1.1.0-navbar archive/release-1.1.0-navbar`), commit the JS change there (respecting rule 1 on 1.0.2), and publish an EAS update per runtime.
4. **Fleet policy (2026-07-25, user decision):** New feature development targets ONLY the newest runtime going forward — currently **1.2.0** (branch `v1.2.0`). (A separate 1.3.0 runtime was planned for a social platform + player autonomy but was abandoned 2026-07-28; the social platform was dropped entirely and the player-autonomy features were folded into 1.2.0 as a JS-only OTA.) Older runtimes (1.0.2 / 1.1.0) receive shared OTA updates **only for streaming-provider/source fixes and critical bug fixes** — no feature back-ports.

### Current deployed state (last updated 2026-09-15, 1.2.0 six-issue batch)

| Runtime | Branch @ commit | EAS update group |
|---------|-----------------|------------------|
| 1.2.0 | `v1.2.0` @ `fdcdb56` | `413b4741-25b4-413f-8ca1-8015e36830e3` |
| 1.1.0 | `archive/release-1.1.0-navbar` @ `c65d7db` | `b4a79405-d989-4b16-858d-0f3bb1ebb055` |
| 1.0.2 | `archive/release-1.0.2-legacy` @ `1da0cae` | `0513cd3d-1105-4d9c-b954-a8cb1b54c190` |

- **2026-09-17 (backend only — no OTA yet):** Audit fixes `e53a642`…`f59d298`.
  The app-side fixes (`e53a642` sync queue, `8ccdc71` player WebView trust) are
  committed but **not published**; the table above still reflects the last OTA.
  - **Workers** (`d2f1f8f`): `streambox-turn-credentials` → version `f182c417`
    (verifies ES256 user tokens against the project JWKS — the project signs
    with ES256, so the old HS256-only check rejected every user), `streambox-tmdb-proxy`
    → `56f844af`, `streambox-provider-monitor` → `c3ca7009` (status route, `/run`
    and the Telegram webhook now require their secrets). Smoke-tested: TURN 401
    without a user token or with the anon key; TMDB 200 on both hosts with
    `access-control-allow-origin: null`; monitor `/`, `/run`, `/telegram` 401.
  - **Database** (`bf1a7c4`): `20260916211341_restore_watch_room_realtime_policies`
    pushed; both `realtime.messages` policies present for `authenticated`.
  - **Edge Functions** (`f59d298`): `user-feedback` redeployed. The ratings
    function's production **slug is `clever-handler`** (name `external-ratings`);
    it was deployed from `supabase/functions/external-ratings` into that slug.
    `supabase functions deploy external-ratings` would create a second function
    instead. The app calls `/functions/v1/external-ratings`, which returns 404 —
    unresolved.
- **2026-09-15 (1.2.0 only):** Six reported issues. Deploy: `fdcdb56` → group
  `413b4741-25b4-413f-8ca1-8015e36830e3`. 435 tests green.
  - **Providers.** HDFilm, Dizipal and Dizibal all resolve to live HLS
    manifests (11 probe titles). Dizipal rotated **2131 → 2132**; floor bumped.
  - **Resident Evil (2026) played the 2002 film.** No provider carries the
    new one yet, so the chain reached Dizibal, whose title-only scorer took the
    2002 record with the same name — Dizibal returned the *identical* stream for
    both requests. `pickDizibalHit` now never title-scores a hit whose own TMDB
    or IMDb id contradicts the request, or whose year is outside tolerance.
  - **Stats still missed Cate Blanchett's LOTR films after the 09-11 fix.** The
    data never changed: (1) `enrichEntry` stamped the new version even when
    its request FAILED; (2) the backfill saved only when a full pass finished,
    which a long history rarely did, so it restarted from scratch every launch
    — in every mounted `useWatchHistory`, on every storage change; (3) cloud
    rows hold 5 names (table CHECK) and were read back as current. Now: 20
    de-duplicated people, `METADATA_VERSION` 7, a single-flight backfill per
    session (8s after launch, 2 concurrent, paused while playing, saved every
    20, failures retried next launch, lightweight
    `getWatchHistoryMetadata` without the IMDb call), and full five-name
    cloud rows come back as version 1 so they're refetched.
  - **"The app got slower" since 09-11 was that backfill.** It also wrote a
    minutes-old snapshot back at the end, undoing anything marked watched
    meanwhile. All history writers now share `withWatchHistoryWriteLock` and
    read storage inside it; the parsed history is cached module-wide by raw
    string, so an unrelated storage change no longer re-parses it per screen.
  - **Launch logo froze mid-spin.** `CONTENT_MOUNT_GATE_MS` (2.4s) dropped the
    app-tree mount onto the spin-slide. It now opens at
    `LAUNCH_SPLASH_MOTION_END_MS`; the static lockup holds until the tree has
    painted (max +1.5s); the spinning `SplashLoading` no longer runs hidden
    under the splash.
  - **Turkish posters under an English UI.** `hydrateMediaIds` computed the
    cache key up front, but queued requests read the language when they left;
    a switch in between cached one language under the other's key for 7 days.
    `getMovieSummary`/`getSeriesSummary` take the language explicitly; the
    hydration cache moved to `-v2` and v1 is deleted.
  - **Playback paused for a couple of seconds.** expo-video's Android
    LoadControl resumes after a stall at 2s (1s initial) — play two seconds,
    stall again on a slow CDN patch. `bufferOptions` now 4s / 60s forward.
  - **Bakcell showed "network error" everywhere.** Workers Observability,
    7 days of `streambox-tmdb-proxy`: ~18k sampled requests from Azercell,
    Nar and the ISPs, **zero** from Bakcell (AS197830) — its network can't
    reach `*.workers.dev`. `tmdb.ts` now fails over, on a request with no
    response, to `tmdb.streamboxapp.stream` (same Worker, `routes` in
    `wrangler.jsonc`) and persists the host that answered. The owner attached
    the custom domain the same day with `wrangler deploy` (version
    `e50b4a77-47a0-48ed-9200-ad91422c446b`); both hosts verified serving 200.
    Keep both hostnames on the Worker.
  - Not changed: HDFilm finds *Dune: Part Two* but yields no native stream
    for that page, so it plays from Dizipal (~6s). Per-title, not a decoder
    failure (`npm run check:hdfilm` healthy).

- **2026-09-14 (1.2.0 only):** Provider health sweep from a residential
  connection, run through the shipped resolver with each tier isolated. HDFilm
  8/8 probe titles native (1.1–5.2s); Dizipal 3/3 series and 3/3 films; Dizibal
  6/6 of the titles it carries. The one defect: **Dizipal rotated 2130 → 2131**
  (the 301 alone ~1s). Shipped floor bumped to 2131; the operator updated the
  Supabase row the same day. Deploy: `6845830` → group
  `377d7005-7033-4da1-851a-f90370ac2fe8`.
  - **Git history was rewritten the same day** (owner-approved): every commit
    is authored by Eshgin Mammadov and AI co-author trailers were removed, so
    all commit IDs changed; file contents did not. Commit IDs in this file were
    remapped, but the EAS dashboard still shows the pre-rewrite IDs. The old
    history survives only in the local backup bundle
    `.git/backup/streambox-pre-rewrite-2026-09-14.bundle`.
  - **Dizipal lists films under Turkish titles** (`/film/baslangic` for
    Inception). An English-title probe with no TMDB access misses every film
    and looks like a broken movie path — it isn't; the app's Turkish alt-title
    retry supplies the name. Probe Dizipal films with the Turkish title.
  - **Worker egress now gets 403 from dizipal2131**, while a residential
    connection gets 200, so `provider-monitor` has reported Dizipal down since
    2026-09-11. If that persists with the Supabase row on 2131, Dizipal needs
    the same treatment as HDFilm (no Worker check).
  - **1.1.0 and 1.0.2 are degraded and were deliberately NOT shipped** (user
    decision, 2026-09-14). Their provider code is identical on both branches:
    HDFilm yields no native stream (pre-Sep decoder), Dizipal's player config
    404s at `/ajax-player-config` and `/ajax-token` now returns JSON, and the
    Dizipal *page* result they still return stops the chain before Dizibal,
    which does work there. Fixing them means porting the v1.2.0 provider layer.

- **2026-09-11 (1.2.0 only):** Eight reported defects across search, provider
  coverage, the profile library, navigation and language switching. Two of them
  were the same mistake in different places: **a heuristic allowed to override
  direct evidence.**
  - **Searching a film by its full name returned none of it.** `harry` found the
    Harry Potter films; `harry potter` found none. TMDB's person index holds a
    real acting credit literally named "Harry Potter" — popularity 0.28, no
    photo, one TV credit — and `getActorSearchConfidence` scored that exact name
    match 1000, which unconditionally flipped `searchMulti` to the
    actor-credits branch. One word can never reach that score, which is exactly
    why half the query worked and the whole query did not. Overriding a matching
    title now also requires *prominence* (a profile photo + popularity ≥ 1),
    which is what separates a person a viewer could have meant from index noise.
    Verified live against `/search/person` and `/search/multi` in both locales.
  - **The weak-match rating floor deleted cross-language results.** With the UI
    in English, TMDB matches a Turkish query against a translation the client
    never sees, so the film scored 0 and the `rating >= 6` floor removed it —
    same for anything TMDB reports as unrated. The floor now applies only when
    the list already holds a title the viewer plainly named.
  - **"Rosemary's Baby" reported Not Available while HDFilm carried it.** HDFilm
    does not tokenize an apostrophe: `/search/?q=Rosemary's Baby` → 0 rows,
    `/search/?q=Rosemarys Baby` → the film. The cleaned spelling existed but sat
    *behind* the year-qualified variants, so the two-query empty cutoff fired
    before it was ever sent. Confirmed live that Ocean's Eleven and Schindler's
    List failed identically. Distinct spellings now all precede year-qualified
    queries. Re-probed after the fix: all six test titles resolve, each on the
    apostrophe-free query.
  - **A Turkish UI withheld the original title from the resolver.**
    `originalTitle` was gated on `original_language !== "en"`, so an English film
    under a Turkish UI handed the provider search only its Turkish name. It is
    never rendered — it exists for the resolver — so the gate is gone.
  - **Watched titles stayed in the watchlist.** Now pruned from every path via
    `applyWatchHistoryMutations` (the single funnel for log sheet, season modal
    and player auto-mark) plus the Letterboxd import.
  - **Stats' most-watched actors could not see the films it counted.** Entries
    stored the top FIVE billed names out of a twelve-name fetch. Cate Blanchett
    is credited **13th** on Fellowship of the Ring, so the trilogy was invisible
    to her counts and to the list her row opens. Now 15 of 20, de-duplicated per
    title (TMDB lists an actor once per role, which is how a tally could exceed
    the titles it summarised), `METADATA_VERSION` 5 → 6 to re-enrich.
  - **The profile count climbed in batches** because the header counted hydrated
    poster cards rather than the ids already on disk. Rails now hydrate 30, not
    all several hundred; See All pages in on scroll.
  - **"Recently added" showed the oldest first** — stored id lists are
    append-ordered and the sort walked them forwards.
  - **Back from a grid landed on Discover.** `navigate(name)` pops back to an
    existing route rather than pushing, so actor → See All → film collapsed the
    stack onto the detail screen the journey began at.
  - **Language switches resolved content in the language just left.**
    `i18next.changeLanguage` is async, the settings store is not; for a render or
    two `i18n.resolvedLanguage` still reported the old value, and the TMDB
    `language` param and the hydration cache key both read from it. That is both
    the Turkish posters under an English UI and the duplicated loading after
    every switch. New `localization/contentLanguage`, set synchronously by the
    settings store before it re-renders.
  - **The Watch Together room-code field hid behind the keyboard** — no keyboard
    handling on that screen at all. Scrolled into view on focus.

  Lesson worth keeping: **a scoring heuristic must never be able to outrank the
  literal thing the user typed unless it can show independent evidence it is
  what they meant.** Both search bugs were a confidence number treated as truth —
  an exact string match on a junk record, and a rating floor applied to results
  whose real match was in a language the client had not asked for. Prominence
  and "only prune when something matched" are both the same repair.

- **2026-09-10 (1.2.0 only):** Dizipal rotation + Cloudflare-challenge
  resilience, prompted by the bot paging "Dizipal is down" three runs running.
  Dizipal was not down. Verified from Worker egress the same day: Dizipal
  36/36 clean, Dizibal 200, HDFilm 403 (unchanged — still unmonitorable from
  any datacenter IP). What was actually wrong:
  - **Dizipal had rotated 2126 → 2130** while Supabase stayed pinned at 2127,
    i.e. three dead 301 hops on every request. Shipped fallback bumped to 2130;
    `normaliseDizipalBaseUrl` treats it as a floor, so it applies even against
    a stale Supabase row. A test now fails if that floor falls behind.
  - **Dizipal began challenging a fraction of requests**, and the app dropped
    the tier on the first 403. HDFilm had retried past this since 2026-09-02;
    Dizipal's fetches used a bare `axios.get`. Both now share `providerGet`.
  - **The monitor modelled a client it wasn't.** It took the first 403 as
    final, so an intermittent challenge read as a 36-hour outage. It now
    retries twice, inspecting the body so a real permission failure still
    fails fast.
  - **A failing check could hide a rotation.** A challenge is served *at* the
    requested host, so nothing redirects and the rotation detector saw nothing
    — which is exactly how 2127 → 2130 stayed invisible behind three days of
    403s. Rotation is now appended to the failure reason, not replaced by it.

  Lesson worth keeping: **a provider alert that names a symptom the site does
  not have is a monitor bug until proven otherwise.** Re-probe from the same
  egress the monitor uses (`wrangler dev --remote`) before touching provider
  code — that one step separated "Dizipal is down" from the two real defects.

- **2026-09-08 (1.2.0 only):** HDFilm decoder rewrite + player/search/WebRTC
  fixes. **HDFilm — tier 1 — was 100% dead**, and nothing had noticed: it
  WAF-blocks datacenter IPs, so the Cloudflare Worker monitor cannot probe it at
  all (re-verified with `wrangler dev --remote`: 403 challenge on every path,
  both `.nl` and `.mobi`) and it has never had a check there. Every play was
  quietly walking the full provider chain — that is what "the app got slow" and
  "it's available but won't open" actually were.
  (1) **HDFilm changed its obfuscation.** Parts array and decoder are no longer
  `s_*` / `dc_*` but random short identifiers, and the algorithm gained a third
  de-scramble family (two seed strings → LCG + XOR seed → Fisher-Yates
  un-shuffle → rolling XOR) with dead `if` guards re-shuffled per request.
  `rapidrameScript.ts` became a small general JS interpreter (tokenizer →
  recursive-descent parser → AST walker) so all three families run through one
  path; still no `eval`/`Function`, still fails closed, now with step/size
  budgets and a regex guard. Extraction matches page structure, not name
  prefixes. Measured after: 10/10 probe titles resolve in 0.6–1.0s, nearly all
  on HDFilm's dual-audio stream instead of a Turkish-dub-only fallback.
  (2) **A stream hiccup was shown as "not in our catalog".** Any expo-video
  `status === "error"` on a direct stream became `not_found`; ExoPlayer raises
  it for seeks past the buffered edge, single 5xx segments, expired tokens and
  track switches, so seeking or tapping subtitles early produced the
  "not available" card mid-film. Started streams now recover in place at their
  last position (3 attempts) and playback failures can no longer read as missing
  titles. The same path left `isPlaybackReady` false with only the first play
  able to restore it, which is the "audio plays, screen stays black" report.
  (3) **Search hid correctly-typed titles.** Turkish ı has no NFD decomposition
  so it was stripped to a space ("Mezarlık" → `"mezarl k"`); and a flat
  `rating >= 6` gate deleted everything TMDB reports as unrated, which when it
  emptied the list flipped search to the actor-credits branch — a film search
  answering with a filmography. Folding is now one shared helper across TMDB
  search and the provider matcher; the quality gate applies only to results that
  do not match the typed query.
  (4) **Watch Together was one-way on some devices.** The peer connection was
  published to `pcRef` before its handlers were attached and before an awaited
  `setParameters`; an offer landing in that window was answered by a connection
  with no `ontrack`/`onicecandidate`. Handlers and local tracks now attach
  before publishing with no await in between, early offers are queued and
  replayed, and a peer still starting up answers the readiness handshake.
  (5) **Observability.** A `player_resolve` telemetry event now records the
  resolved provider and duration — the only vantage point on a residential IP,
  and the signal that was missing when tier 1 died.
  Also: Dizipal base `2123` → `2126`, and Dizibal's embed host recovered from
  the outage recorded on 2026-09-02, so all three tiers are healthy.

- **2026-09-02 (1.2.0 only):** Provider recovery batch — three independent
  breakages that together read as "everything is slow" and "it's in the app but
  says Not Available". `npm run check:hdfilm` reported HEALTHY throughout, which
  is why none of them surfaced as a normal decoder recovery.
  (1) **Dizipal playback was dead** — the provider renamed
  `/ajax-player-config` to `/ajax/player-config`; the 404 was read as "no
  stream" and dropped silently while search kept answering 200, so titles
  appeared and then refused to play. This is why *Mezarlık / Graveyard*
  disappeared: Dizipal is the only provider carrying it. `decodeDizipalCfg` now
  reads the player config out of the page's base64 `data-cfg` attribute — it is
  byte-identical to the endpoint's response — which drops a token mint plus a
  POST from every play and is immune to the next rename; the network call
  survives as a fallback that tries both paths.
  (2) **A stale Dizipal base cost seconds per request and past 21 hops broke it
  outright** — `dizipalN.com` 301s to `N+1` and the hops are *not* one per
  rotation: the shipped `2079` was 22 hops / 3.3s behind the live `2123`, past
  axios' redirect ceiling. `normaliseDizipalBaseUrl` now compares the numeric
  suffix so any published base older than the shipped one is ignored, replacing
  the hand-maintained stale-host list. Also dropped `maxRedirects: 5` from
  `probeDizipalDirectSlug`, the one call that failed hard rather than slowly.
  (3) **The self-healed origin died at every refresh** — `recordObservedBaseUrl`
  pins the post-redirect origin, but `refreshProviderConfigs()` overwrote it
  with the lagging Supabase value, so `resolveWebPlayerUrl`'s "refresh then
  retry" walked the whole chain a second time. The pin now survives a refresh
  that republishes the *same* base and is dropped the moment the operator
  publishes a different one, so `/set_dizipal` still wins.
  (4) **Every HDFilm series was quietly losing to Dizipal** — `/dizi/` answers
  `403 cf-mitigated: challenge` on the *first* request over a fresh connection
  and 200 on every one after (9/10 with connection reuse, 0/10 without; no
  cookie — the clearance rides on the connection). That first 403 read as
  "HDFilm doesn't have it". `hdFilmGet()` retries past it, and Breaking Bad,
  Severance, Stranger Things and From are back on dual-audio HDFilm streams
  (6 subtitle tracks vs Dizipal's 2). **This corrects the 2026-08-10 note
  below** — HDFilm series are not unreachable.
  (5) **`provider-monitor` stayed green through the whole outage** because it
  only probed search; added a `dizipal_playback` check that decodes the episode
  page's `data-cfg`, verified reachable from Worker egress before deploy.
  Measured after: 14/14 live titles resolve to a playing HLS manifest in
  0.5–3.1s (the same sweep beforehand had series failing at 7.7s).
  Deploy: 1.2.0 `faf0e43` → group `4fc77eff-1b8f-43ff-a389-14cc79675de5`.
  1.1.0/1.0.2 NOT shipped. 345 tests green. Worker deployed separately
  (version `6f2dc0a1-ad54-4efd-ac1c-295d04557c38`).
  Known upstream outage, not ours: Dizibal's rotating embed host
  (`x.ag2m4.cfd`) 502s for every code while `dizibal.org/api/*` stays healthy.

- **2026-08-10 (1.2.0 only):** Search, player and daily-hero batch.
  (1) **Films with a non-Latin original title reported "Not Available"** —
  `generateSearchQueries` emitted the TMDB original title first and the 2-query
  empty-result cutoff counted from the top, so Harakiri (original title `切腹`)
  never got `/search/?q=Harakiri` sent at all; every Japanese/Korean/Chinese/
  Cyrillic/Arabic-titled film failed identically. Bare titles go first now and
  the cutoff is a floor raised by `bareTitleCount`. (2) **±1-year provider
  metadata accepted** — HDFilm dates *Dune: Part Two* 2023 against TMDB's 2024
  and the hard year gate threw it out; exact-year listings still win on score.
  (3) **Audio menu showed every track as "Unknown"** — expo-video's Android
  `AudioTrack.fromFormat` builds its label from `format.language` alone and drops
  `format.label`, so DUAL masters (NAME, no LANGUAGE) produced two identical
  rows; names are recovered from the media3 format id `<GROUP-ID>:<NAME>`. This
  also repaired the original-audio preference, which had nothing to match on and
  was leaving the provider's `DEFAULT=YES` Turkish dub playing. (4) **Subtitles
  default to off**, with provider `DEFAULT=YES` renditions cleared on every track
  republish. (5) **Movie/series of the day rotates daily** — the hash-modulo pick
  collided across consecutive days, the rate-limit fallback used a date-free
  index, and a hub refresh racing the liked/watched load stamped yesterday's hero
  as current (for an account with no liked/watched titles that never self-healed).
  Deploy: 1.2.0 `7d08cc1` → group `de6dcbdb-b64d-4e4b-9d06-2d7b512f6852`.
  1.1.0/1.0.2 NOT shipped. 335 tests green.

  Also recorded in `decoder-recovery.md`: `www.hdfilmcehennemi.nl` serves a
  Cloudflare challenge on `/rplayer/` embeds and `/dizi/` series pages — **not**
  a decoder rotation. ⚠ **Superseded 2026-09-02:** on `/dizi/` the challenge is
  a first-request-per-connection challenge, not a wall; retrying clears it and
  HDFilm series resolve natively again. `/rplayer/` remains unreachable.

- **2026-08-02 (1.2.0 only):** Provider + playback batch. (1) **HDFilm decoder
  rebuilt as an interpreter** — the provider swapped its arithmetic de-scramble
  for a rolling-XOR cipher and randomizes the whole `dc_*()` scheme per request,
  so the old matcher failed on *every* HDFilm title; films silently played from
  Dizipal/Dizibal (Turkish-dub-only audio) after burning the full ~15–20s
  resolver budget. New `src/services/rapidrameScript.ts` parses and replays the
  live body. (2) **Dizipal handshake repaired** — `/ajax-token` returns JSON now,
  the token is single-use, and the config POST needs the whole cookie jar.
  (3) **Native players only** — Dizipal page/embed shells are no longer returned
  as playable results. (4) **Audio track picker**, defaulting to the original
  soundtrack instead of the provider's `DEFAULT=YES` Turkish dub, with the choice
  remembered. (5) **Subtitles auto-enable** when the audio isn't in the app's
  language. (6) **Season watch history now syncs** — season ids were being sent
  to a `uuid` column, so prod had 2327 watch-history rows and zero season rows,
  and the failing op clogged the durable queue; ticking episodes now also
  reconciles watch history, fixing "watched on SeriesDetail, missing from
  Profile". Measured after: 13/13 live titles resolve natively in 0.9–3.2s.
  Deploy: 1.2.0 `effb1d8` → group `f192271c-b031-4a42-9619-c40c871b4f6c`. 1.1.0/1.0.2 NOT shipped.

- **2026-07-23 (1.2.0 only, follow-up):** Reverted the custom YouTube expand/
  fullscreen player from earlier today — it was worse than the stock player, so
  trailers + Azerbaijani Classics return to the original portrait iframe (its own
  controls + `onFullScreenChange` landscape handling). The rest of the batch below
  is kept. Also renamed the AZ Classics play button "Play on YouTube" → "Watch
  Now" / "Şimdi İzle". Deploy: 1.2.0 `70ea35c` → group
  `9ad008d5-55d7-496e-b6c8-7c8b03d40c4f`.
- **2026-07-23 (1.2.0 only):** UX + stability batch. (1) **Watch Together chat is
  now durably delivered** — un-acked chat lines queue in `watchRoomService` and
  flush the moment a fresh healthy channel subscribes; the partner de-dupes by
  `(from, at)`, so a line typed across a reconnect/radio blip is no longer
  silently lost (the reported "I sent it but they never got it"). Send-side only;
  old bundles interop, no wire-format change. (2) **YouTube fullscreen** — trailers
  + Azerbaijani Classics gain an app-owned expand button (rotates to landscape,
  fills the screen; the iframe's own fullscreen is disabled) with always-visible
  close/expand controls (the iframe swallows taps). (3) **"Not available" player
  screen redesigned** — themed badge, Outfit type, pill Go-Back button, fade-in.
  (4) **Movie/Series of the Day** rebalanced toward acclaimed + popular titles
  (heavier rating + popularity weights, rating floor 7.6, higher popularity floor,
  algorithm version → `quality-v3` so today's cached pick recomputes). (5) **Launch
  splash smoothness** — the heavy Navigation + Home-hub mount is deferred past the
  splash's entrance/heartbeat beats (`CONTENT_MOUNT_GATE_MS`) so hundreds of native
  views no longer contend with the Reanimated reveal on slower/fuller phones; the
  splash stays an opaque overlay so there is still no black flash. Pure JS — no
  native/dependency/SQL change. Branch `release/1.2.0-watch-together` renamed to
  `v1.2.0` and `feat/azerbaijani-classics` recorded as merged (already a strict
  superset, so `-s ours`). Deploy: 1.2.0 `b810246` → group
  `409f6556-fd0a-450b-a1d7-7275d4120768`.
- **2026-07-21 (1.2.0 only):** Removed 30 incorrectly-included films that are not genuine Azerbaijani classics from `azClassics` catalog. Deploy: 1.2.0 `8681531` → group `3752ea2e-18f6-4929-8714-fc3809820e26`.
- **2026-07-13 (ALL THREE fleets):** Dizibal resolver repair + anime support.
  Dizibal retired `/api/stream/m3u8` (now 404 "Video bulunamadı" for every
  code), and the old resolver required both it and `/api/stream/embed`, so
  Dizibal produced no streams while HDFilm/Dizipal still worked. Resolver now
  follows `/api/stream/embed` → the rotating Playerjs embed HTML → the deferred
  `fetch('/dl?op=get_stream&…')` (called with an `Origin` header — it 401s
  without one) → the real `master.m3u8`, played with the embed host as
  `Referer` (CDN 403s otherwise). On-device regex, no WebView — player stays
  native. Anime SERIES now resolve via the separate `/api/anime` namespace
  (`searchDizibal` returns `{hit, kind}`; tv tries `/api/series` then
  `/api/anime`; `fetchDizibalEpisodeSrc` picks the `/seasons` root); anime
  FILMS already worked through `/api/movies`. `DIRECT_FALLBACK_TIMEOUT_MS`
  8s→12s. Pure JS in `WebPlayerService.ts` + test (no native/dependency/SQL
  change) — cherry-picked identically across all three (both files were
  byte-identical pre-fix). Deploy: 1.2.0 `b7da30a` → group
  `1116b7f6-1688-44b4-bf19-728af3e73abc`; 1.1.0 `c65d7db` → group
  `b4a79405-d989-4b16-858d-0f3bb1ebb055`; 1.0.2 `1da0cae` (nav-bar guard clean)
  → group `0513cd3d-1105-4d9c-b954-a8cb1b54c190`. Expo-verified by user on
  1.2.0 (anime plays via `kind=anime`).
- **2026-07-11 latest (1.2.0 only):** Watch Together stability repair @
  `959af9e` → group `f06bbf09-4270-4861-a871-1984d68188cb` — memory uploads
  moved off the JS thread to cancellable native binary tasks; responder upload
  deadline covers signed-URL creation + body upload; room sends are acknowledged
  and socket/liveness checked; token refresh + reconnect/disconnect lifecycle
  races are guarded; disconnected captures are blocked/aborted; reconnecting and
  partner-left states never show the join code; chat is an in-layer overlay; a
  room-scoped recovery boundary + released-player/stream guards contain future
  white-screen paths. No wire-format, native, dependency, runtime, or SQL change.
- **2026-07-11 later (1.2.0 only):** polaroid capture flow repair @ `ec8f03e` —
  responder still shoots at q0.3 with a 12s-bounded upload (decline on timeout;
  fixes the missing partner photo + forever-stuck spinner), getUserMedia leak on
  teardown race fixed (camera no longer wedges after rapid captures), preview
  Modal → in-layer overlay (kills the Android stuck-white-window), new
  `polaroid-preview` signal (partner sees the finished card too — both devices
  must run this bundle), shared 30s capture cooldown with countdown on the rail
  button. Author wait for the partner still is now 20s.
- **2026-07-11 (all three fleets):** launch-splash black-flash fix (splash is now an
  opaque overlay fading out over pre-painted content), Profile Movies/Series
  chip-squeeze fix (`ToggleRow` dropped `flex:1`), and the **user-data sync
  data-loss hardening** (involuntary auth loss purges tokens only — local lists +
  sync queue survive; sign-out drains the queue in rounds and preserves it across
  the wipe; cross-account guard in bootstrap; enqueue falls back to the last
  bootstrapped user id; cold bootstrap flushes pending ops before the union
  merge). Port chain: `52a8825` (1.2.0) → hunk-port `561c01b` (1.1.0, minus
  watch-together-only bits in App.tsx/ProfileScreen/SharedSessionsSection) →
  cherry-pick `a3c2275` (1.0.2, nav-bar guard clean). 1.2.0 additionally got the
  Shared Sessions polaroid rail restyle (bare polaroids, no poster containers).
- **2026-07-10 (1.2.0 only):** Watch Together audit hardening (all 34 findings —
  ICE restart/re-announce, private Realtime channels [needs migration
  `20260710190000`], memory outbox, audio ducking, capture privacy) @ `1361017`
  → group `98cbce14-4460-47a7-872c-8307a51af73c`.
- Older deploy history: memory file `release-tracks.md` (agent memory) and the
  EAS dashboard. `docs/release-tracks.md` predates the 1.2.0 track and the
  branch renames — treat this section and §2 as the source of truth.

---

## 2A. Watch Together / Shared Sessions — runtime 1.2.0 (IMPORTANT, NEW)

The flagship 1.2.0 feature. A **private 2-person Watch Room**: two people join by
6-char code / deep link (`streambox://room/<code>`), watch a title in sync, see
each other's faces over the video and talk, drop text reactions, and capture
**polaroid "memories"** that land in a **Shared Sessions** section on the Profile
for **both** users. Movie-only for now (no series episode picker yet).

### Isolation (do not break this)
- 1.2.0 is a **separate native build** because it adds `react-native-webrtc@124`,
  `expo-camera@17`, `@config-plugins/react-native-webrtc@13` (v13 for SDK 54).
  These are native → **cannot** ship to 1.1.0/1.0.2 and are **never ported back**.
- Everything built this line is **additive**: new files under
  `src/components/watchTogether/`, `src/hooks/useWatchRoom*.ts`,
  `src/services/watchRoom*.ts` / `watchMemor*.ts`, new migrations, a Cloudflare
  Worker. Old runtimes are untouched.
- WebRTC is loaded **optionally** via `src/services/webrtcCompat.ts` (`getWebRtc()`
  only `require()`s when `NativeModules.WebRTCModule` exists) so the JS still runs
  in Expo Go with face-cam disabled.

### Media / networking architecture
- **Media is raw WebRTC P2P** (`src/hooks/useWebRtcPeers.ts`) + **Cloudflare
  Realtime TURN** (`src/services/turnCredentials.ts`, creds minted by
  `workers/turn-credentials/`). **Video/audio NEVER traverse Supabase** — Supabase
  Realtime only carries tiny signaling/sync/chat messages, so the free tier is fine.
- Sync is by **content timecode** (host-authoritative clock), not a shared file —
  each phone resolves its own stream via `WebPlayerService` (`useWatchRoomSession.ts`).
- **WebRTC readiness handshake**: a `webrtc-ready` signal (see `utils/watchRoom.ts`
  `WatchRoomSignal` + `negotiationActionOnPeerReady`) gates the offer so the host's
  offer can't race ahead of the guest's `RTCPeerConnection` and get dropped. The
  original "host offers immediately" flow silently never connected on real 2-device
  use (untestable with the one-phone `scripts/watchPartnerBot.ts` bot).

### Photo capture (non-obvious)
- **Do NOT view-shot the `RTCView`** — react-native-webrtc renders to an Android
  SurfaceView that screenshot APIs capture **black**. The self-still is taken with
  **`expo-camera`** by briefly handing the camera off from WebRTC
  (`setCamerasOn(false)` → snap via hidden `CameraView` in `PhotoCaptureHost` →
  `setCamerasOn(true)`; the readiness handshake reconnects). Brief live-video pause
  during the shot is the tradeoff.
- The polaroid (`PolaroidCard.tsx`) is fully code/SVG, captured at full-HD
  `captureRef(..., { width: 1080, height: 1451 })`. Backdrop uses TMDB `original`
  (only `w185/w300/w342/w500/w780/original` are valid sizes).

### Memory persistence (Shared Sessions) — know the flow
- **Local-first + cloud, reconciled in background.** On capture, `WatchRoomLayer`
  `buildPolaroid`: (1) writes the cached PNG + an AsyncStorage index entry
  **immediately** (`services/watchMemoryLocalStore.ts`, key
  `streambox/watch-memories-local`) so it shows instantly and survives leaving; then
  (2) uploads + inserts the cloud row **detached in the background**
  (`services/watchMemories.ts` → Supabase Storage `watch-memories` bucket +
  `saveWatchMemory` returns the row id) and reconciles the `cloudId`.
- `SharedSessionsSection.tsx` (Profile, below Liked) merges local store +
  `listWatchMemories` (dedup by cloudId). Share uses the **local** file (remote-URL
  share is unreliable on Android).
- **Delete is per-user**: `deleteWatchMemory` → RPC `remove_watch_memory` removes
  the caller from `participant_user_ids`; the row + Storage object are purged only
  when nobody is left.

### Migrations that MUST be applied manually (never `db push`)
`20260708120000` (platform), `20260708150000` (imdb/year/original_title cols + 3
create-room params — Create room fails without it), `20260709120000` (memories
shelf + participant-based Storage read policy), `20260709160000` (resilient
delete — wraps the Storage delete in an exception block so it can't roll back the
whole delete), **`20260710190000`** (hardening — private Realtime channels RLS,
storage UPDATE policy for outbox retries, join throttle, expired-room cleanup.
**MUST be applied BEFORE testing any build from 2026-07-10 on**: the client now
joins the room channel with `private: true`, which Realtime rejects until the
realtime.messages policies exist). Apply with `npx supabase db push` **by the
user**, not the agent. (2026-09-17: these files are archived; their content is in the
baseline except the two realtime.messages policies, which now live in
`supabase/migrations/20260916211341_restore_watch_room_realtime_policies.sql`.)

### Deploy specifics for 1.2.0
- The CLI binary lives in package **`eas-cli`**, not `eas`: use
  `npx eas-cli@latest update --branch preview --platform android --message "…"
  --non-interactive`. Plain `npx eas …` errors ("could not determine executable").
- **Verify the output says `Runtime version 1.2.0`** — that is proof the update is
  isolated to the 1.2.0 fleet. Record the update group ID in the final report.
- This branch is standalone: **no porting to the other two release branches.**

### Hardening round (2026-07-10) — know these when debugging
Implemented from the technical audit (`outputs/shared-sessions-tech-review-2026-07-10.md`):
- **Reconnects**: offers always use `iceRestart`; `webrtc-ready` re-announces
  every 2s until SDP lands; failed / stuck-disconnected connections auto-rebuild
  (max 3 attempts, then a "Tap to retry" chip on the partner tile). Channel
  flaps rebuild + re-track presence; `connect()` resolves only on SUBSCRIBED.
- **Sync**: guest measures the host clock offset via `sync-ping/pong` (median of
  5), hard-seeks have a 5s cooldown and skip while buffering; host broadcasts
  immediately on seek jumps (owns `timeUpdateEventInterval` in rooms).
- **Audio**: mic constraints (EC/NS/AGC) explicit; 640×480@24 + 400kbps cap on
  the face-cam; **audio ducking** (`useAudioDucking` + pure
  `utils/audioDucking.ts`) drops movie volume while someone talks.
- **Memories**: OUTBOX — client-generated UUID is the memory id from birth;
  `pending` payload on the local entry; `watchMemorySync.syncPendingMemories()`
  retries upload+insert idempotently (deterministic Storage path, 23505 =
  success). Participants come from `watch_room_members`, never presence.
  Shelf loads local + cloud independently (offline shows local).
- **Privacy/security**: room channel is `private: true` (needs migration
  20260710190000 — see above); a capture request is DECLINED when the partner's
  face-cam is off (`capture-unavailable`); playback signals apply only from the
  host; TURN worker optionally requires a Supabase JWT
  (`wrangler secret put SUPABASE_JWT_SECRET`, enforced only when set).
- **Gotcha**: `scripts/watchPartnerBot.ts` (anon-key one-phone test bot) cannot
  join private channels anymore — real 2-device testing only.

### Stability repair (2026-07-11) — current behavior

- **Capture uploads**: `watchMemories.ts` obtains a Storage signed upload URL,
  then streams the JPEG/PNG through Expo FileSystem's native binary upload task.
  The responder's 12s deadline is end-to-end and cancels the native task
  best-effort; no whole-file base64 decode runs on the JS thread.
- **Realtime health**: broadcasts use server acknowledgements; normal sends and
  the 20s liveness probe first require an open Realtime socket, so REST fallback
  cannot hide a dead receive path. Failed sends coalesce into the bounded manual
  reconnect. Lifecycle generations prevent stale auth/join/remove work from
  resurrecting a room after exit, and failed initial joins invalidate their exact
  channel so late callbacks cannot create a ghost connection.
- **Auth**: the room refreshes at the 60s boundary, awaits `setAuth`, retries a
  failed/null refresh after 10s, and reconnects if the token is no longer usable.
- **Session UX**: only the never-connected lobby shows the code. A local channel
  failure shows “Reconnecting…”; an actual departure shows partner-left copy.
  Capture requires a connected channel + present partner, and a mid-capture
  disconnect aborts instead of saving a misleading one-person card.
- **White-screen containment**: chat and polaroid preview are both in-player
  overlays (no competing Watch Together native Modals). Stream/player teardown
  reads are guarded, and `WatchRoomBoundary` can retry or exit only the room layer.
- **Compatibility**: no `WatchRoomSignal` format changed. The `liveness` event is
  service-only and is not dispatched as a signal. Both devices should still run
  the current bundle so acknowledgements, capture gating, and recovery UI are
  symmetric.

---

## 2B. Player autonomy — part of runtime 1.2.0

**Player autonomy** — auto-mark-watched, the next-episode pill / auto-advance,
and the in-player episode picker — ships on the **1.2.0** runtime (branch
`v1.2.0`). It is JS-only (no native modules beyond the 1.2.0 stack), so it goes
out as a normal 1.2.0 OTA. It was built on the short-lived `v1.3.0` branch
(2026-07-25 → 2026-07-28) and folded into `v1.2.0` when the separate 1.3.0
runtime was abandoned; `v1.3.0` was then deleted.

> **Social platform removed (2026-07-28).** An earlier iteration of 1.3.0 also
> carried a Letterboxd-style social layer (usernames, a follow graph, an activity
> feed, in-app notifications, mutual-follow Watch Together invites, Android push).
> It was dropped in full at the user's request — every screen/service/hook/util,
> the `social.*` i18n, the `expo-notifications` / `expo-device` deps + plugin, and
> all of the DB objects are gone, without touching any other feature. The DB
> teardown is `supabase/migrations/20260728090000_drop_social_platform.sql` (drops
> `user_follows` / `user_activity` / `user_notifications` / `watch_invites` /
> `user_push_tokens`, every follow/activity/notify/invite/search/username RPC, the
> activity triggers on the core tables, the `profile_assets_peer_read` storage
> policy, and the `user_profiles.username` columns; restores the pre-social signup
> trigger). Apply it with `npx supabase db push` (it is idempotent / `IF EXISTS`).
> **Watch Together CORE** (join-by-code + synced playback + memories) was left
> intact — only the follow-gated invite bridge went with the social layer.

### Player autonomy
- `src/utils/playerProgress.ts` (+ `tests/playerProgress.test.ts`):
  `shouldAutoMarkWatched` (>=95% AND >=60s **real engaged** time — seeks don't
  count), `shouldShowNextEpisode` (<=45s left OR >=97%), `nextEpisodeCountdownReducer`.
- `src/hooks/useAutoMarkWatched.ts` — shares the native player's 1s ticks, fires
  once/session, reuses the manual mark-watched builders.
- `src/hooks/useNextEpisode.ts` + `src/components/player/NextEpisodePill.tsx` —
  manual "Up next" + auto-advance countdown with a persisted
  `@streambox/auto-play-next` toggle.
- `src/components/player/EpisodePickerSheet.tsx` — right-side in-layer episode
  drawer; switching an episode does a full `navigation.replace("Player", …)` so the
  resolver remounts cleanly (no stale "not available"). Native series path only;
  excluded in watch rooms.

All wired into `PlayerScreen`; typecheck + eslint clean.

---

## 3. Deploy workflow (only when the user explicitly approves)

- **Do NOT deploy OTA until the user has tested in Expo and said go.** Build/commit
  is fine to prepare; publishing is gated on the user.
- Typical sequence once approved:
  1. On `v1.2.0`: typecheck + `npm test`, commit, push `v1.2.0`, fast-forward `main` to it and push, `eas update` (runtime 1.2.0, channel `preview`).
  2. Only if an older fleet is in scope: recreate its branch from the archive tag (§2 rule 3), confirm `runtimeVersion`, port the change (**nav-bar grep guard** on 1.0.2), typecheck + test, commit, push, `eas update`.
- Record every EAS update group ID in your final report.

---

## 4. Hard guardrails (do NOT violate)

- **Work lands on `v1.2.0`; `main` only ever fast-forwards to it.** Never merge anything else into `main`.
- **Never force-push `main` or `v1.2.0`** without the owner's explicit approval.
- **Commits and PRs are authored by Eshgin Mammadov only.** No `Co-Authored-By:`, `Claude-Session:` or other AI attribution lines.
- **Never run `supabase db push`** (or any command that mutates the production DB). Write SQL as a new timestamped migration file in `supabase/migrations/` and hand it to the user to apply. You may read/inspect, but never push schema.
- **Never echo, log, or commit secrets/credentials** (Supabase keys, tokens, `.env`). Do not print `process.env` secrets.
- **Temporary/one-off scripts live in `scripts/`** and should be deleted when done. Never leave probe scripts at repo root.
- Keep player architecture **native**: `PlayerScreen.tsx` must not contain `webview`/`iframe` player code and must keep `useNativeControls={false}`. (There is an existing HDFilm WebView *fallback* — do not extend it into the primary player.)
- Match the surrounding code style (naming, comment density, styled-components idiom). Don't reformat unrelated code.

---

## 5. Environment notes (Windows / PowerShell)

- Primary shell is PowerShell 5.1; a Git Bash tool is also available. Use the right
  syntax per shell — no `&&`/`||` chaining in PowerShell 5.1.
- Multi-line git commit messages: write the message to a temp file and use
  `git commit -F <file>` (embedded quotes in inline `-m` here-strings have mangled
  commits before). Delete the temp file after.
- Commit messages carry no trailers: no `Co-Authored-By:` or other AI
  attribution (see §4).

---

## 6. Verification checklist before you call anything "done"

- [ ] `npx tsc --noEmit` (or the project's typecheck script) is clean.
- [ ] `npm test` passes (there is a `tests/webPlayerService.test.ts` suite — extend it, don't break it).
- [ ] Any new behavior has a test or a clear manual repro the user can run in Expo.
- [ ] If you touched anything that ships to 1.0.2, the nav-bar grep guard is clean.
- [ ] No secrets, no `supabase db push`, no merge to main, temp scripts removed.
- [ ] Final report lists: files changed, why, test results, and (if deploying) both EAS update group IDs.
