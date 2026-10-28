# Streambox — Engineering Context & Guardrails (read first)

This file is the operating manual for anyone (human or AI) changing this repo. The task
prompt that pointed you here assumes you have read and will obey everything below. When in
doubt, **stop and ask** rather than guess.

---

## 1. What the app is

- React Native 0.81 + Expo SDK 54 Android app (iOS config exists but is not shipped).
  TypeScript strict, styled-components, React Navigation v6, Reanimated 4,
  react-native-svg, expo-video.
- Data: TMDB (through a Cloudflare Worker proxy), OMDb ratings (through a Supabase Edge
  Function), IMDb chart lists, Letterboxd import. (`api.imdbapi.dev` stopped resolving in
  Sept 2026; per-title IMDb ratings now come only from the chart-seeded cache.)
- Playback: streams are resolved **on device** by scraping providers in
  `src/services/WebPlayerService.ts` and played in the native expo-video player. All four
  providers are asked at once and the answer follows priority HDFilm → Dizipal → Dizibal →
  Kült Filmler (`firstNativeByPriority`: a lower tier's stream waits at most 2.5s for a higher
  tier still running). A provider's own web player is never shown — no native stream means
  "Not available" with a Retry that re-resolves; a found stream that won't start is re-resolved
  once silently, then shows the retryable stream error (never "Not available").
- Backend: Supabase (Auth, Postgres + RLS, RPCs, Storage, Realtime, Edge Functions) and
  three Cloudflare Workers.
- Watch Together: private two-person rooms with synced playback, WebRTC face-cam/voice and
  polaroid "memories" (§5).

### Key files
| Area | File |
|------|------|
| Provider search / stream resolution | `src/services/WebPlayerService.ts` (`scoreMatch`, `scoreHdFilmResult`, `scoreDizipalResult`, `probeDizipalDirectSlug`, `rankDizibalSuggestions`, `noteProviderSilence`) |
| HDFilm decoder interpreter | `src/services/rapidrameScript.ts` (runbook: `decoder-recovery.md`) |
| Provider base URLs (Supabase + shipped floor) | `src/services/providerConfigService.ts` |
| Kült Filmler session (hidden WebView past its Cloudflare challenge) | `src/services/kultfilmlerSession.ts`, `src/components/common/KultfilmlerBridge.tsx` |
| Player | `src/screens/PlayerScreen.tsx`; WebView policy `src/screens/player/playerWebViewPolicy.ts` |
| TMDB client + Bakcell host failover | `src/api/tmdb.ts` |
| Ratings client | `src/api/ratingsProxy.ts` |
| Watch history / episodes | `src/hooks/useWatchHistory.ts`, `src/hooks/useWatchedEpisodes.ts` |
| Supabase sync queue | `src/services/userDataSync.ts`, pure helpers `src/utils/syncQueue.ts` |
| Watch Together | `src/services/watchRoomService.ts`, `src/hooks/useWatchRoom*.ts`, `src/hooks/useWebRtcPeers.ts`, `src/components/watchTogether/` |
| OTA delivery on device | `src/services/appUpdateService.ts`, `src/components/common/LiveOpsHost.tsx` |
| DB schema | `supabase/migrations/` (see `docs/DATABASE.md`) |
| Edge Functions | `supabase/functions/` |
| Workers | `workers/tmdb-proxy`, `workers/provider-monitor`, `workers/turn-credentials` |

---

## 2. Runtime, branches and OTA

There is **one live runtime: `1.2.0`**, served on EAS Update channel/branch **`preview`**.
`runtimeVersion` in `app.config.js` is a fixed `"1.2.0"`; EAS routes an update only to
installs with the same runtime. The older 1.0.2 and 1.1.0 runtimes are retired and receive
nothing (their code survives only as the git tags `archive/release-1.0.2-legacy`,
`archive/release-1.1.0-navbar` and `archive/navbar-apk-base` — history, not work targets).

### Branches
- `v1.2.0` — the working branch. All work lands here.
- `main` — default branch, kept identical to `v1.2.0` by fast-forward only.
- Short-lived `feat/*` branches may be cut from `v1.2.0`; delete them once merged.
- Abandoned, do not resurrect: the 1.3.0 runtime / social platform (removed 2026-07-28)
  and Android TV (dropped 2026-09-17).

### OTA rules
1. **Native changes cannot go OTA.** Adding or upgrading a native module needs a new EAS
   build **and** a `runtimeVersion` bump. Prefer pure-JS solutions so a change stays
   OTA-deliverable (why the loader is SVG + Reanimated instead of Lottie).
2. Never change `runtimeVersion` to "reach more users".
3. On device, `appUpdateService` polls every 5 minutes and `LiveOpsHost` reloads silently on
   the next background → foreground transition, suppressed during playback
   (`isPlayerActive()`). There is intentionally no "Restart now" modal.

---

## 3. Deploy

Deploys happen **only when the owner approves them**. Typical sequence:

1. On `v1.2.0`: `npm run typecheck`, `npm test`, `npm run lint` (0 errors).
2. Commit, push `v1.2.0`, fast-forward `main` and push it.
3. Publish:
   ```
   npx eas-cli@latest update --branch preview --platform android --message "…" --non-interactive
   ```
   The package is `eas-cli`; plain `npx eas …` fails. **Confirm the output says
   `Runtime version 1.2.0`** and record the update group ID below.
4. Backend, when touched:
   - Workers: `cd workers/<name> && npx wrangler deploy`. Nothing auto-deploys on push.
   - Edge Functions: `npx supabase functions deploy <slug> --project-ref zbeexmqmcwtlsbbuuqor --use-api`.
     Slugs match the directory names under `supabase/functions/`.
   - Database: `npx supabase db push` after `--dry-run` (see `docs/DATABASE.md`).

### Current deployed state (2026-10-28)

| Piece | Version |
|-------|---------|
| App OTA (runtime 1.2.0, `preview`) | `v1.2.0` @ `1208b95` → group `6146176d-7754-46cf-bf07-e0c80f3557de` |
| `streambox-tmdb-proxy` | `9bb542c0` (also on `tmdb.streamboxapp.stream`; 24h edge TTL for film records; `/t/p/…` image proxy, 30-day edge TTL) |
| `streambox-provider-monitor` | `338e4a0f` (hourly cron; classic Dizipal checks, hex `data-cfg` + `/_pb` beacon + player-config POST that must yield an embed URL, decrypting `enc`) |
| `provider_configs` | rows `hdfilm`, `dizipal`, `dizibal`, `kultfilmler` (added 2026-10-23, priority 3) |
| `streambox-dizipal-resolver` | deleted 2026-09-25 (`dizipal.streamboxapp.stream` gone with it) |
| `streambox-turn-credentials` | `dcfe4675` |
| Latest migration | `20260923210451_franchise_catalogue_audit_2026_09` |
| Edge Functions | `external-ratings` v1, `user-feedback` v5, `provider-configs` v4, `refresh-hot-ratings` v3 |

### OTA history (runtime 1.2.0)
Full release notes are in `CHANGELOG.md`; commit IDs are post-rewrite (see §7).

| Date | Commit | Update group | Summary |
|------|--------|--------------|---------|
| 2026-10-28 | `1208b95` | `6146176d-7754-46cf-bf07-e0c80f3557de` | `splitDualTitle` tries runs of adjacent parts (John Wick 3); Dizipal URL guard trusts an exact search row; `&`→`and` spelling and pre-colon prefix before the empty cutoff (Songbirds & Snakes); `hdfilm_embed_rate_limited` telemetry |
| 2026-10-26 | `7f763bf` | `273b435b-eb03-4733-bdec-5c2f7a00c59a` | imagestoo packed FirePlayer embeds unpacked (HP7 Part 1); `Sec-Fetch-*` stream headers + Dizipal stream pre-check (The Invite); a pass that skipped a provider is retried, Retry clears breakers (The Fall); Dizipal numeric JSON-LD year, floor 2143; Kült warm deferred 1.5s, 3 min idle/cooldown; list key guard |
| 2026-10-23 (2) | `7ff117f` | `6f0f5049-49a2-4af5-b35d-1e079c60cd72` | Kült Filmler session WebView drawn (360×640, opacity 0.01, beneath the navigator; opacity 0 stalled the challenge on phones), warmed from detail screens, 20s challenge budget, timeout telemetry carries page state |
| 2026-10-23 | `7be516a` | `0cfe3425-18a4-4579-91b1-c9d150cfd4fa` | Kült Filmler as tier 4 (hidden WebView session past its Cloudflare challenge; ok.ru + FirePlayer players); HDFilm decoder keyed by the embed's hostname (interpreter page globals); Dizipal `/_pb` player beacon before player-config; Dizipal floor 2141 → 2142 |
| 2026-10-18 | `e4d54a7` | `fe986646-7367-428c-b85a-a3195001b143` | TMDB images load from `tmdb.streamboxapp.stream/t/p/…` (image.tmdb.org's Azerbaijani BunnyCDN edges refuse connections); a failed image retries on the other host at once; one disk-cache key for both hosts |
| 2026-10-16 (2) | `818e38f` | `d95b3381-efba-4204-8b71-b727e3d280cc` | Dizipal search sends ASCII-only queries (its search returns nothing for non-ASCII; Dune: Part Two is listed under its Turkish title); direct-slug probe reads through the gate-safe fetch |
| 2026-10-16 | `a67b739` | `2e7cddff-f3f8-4fc8-bfce-fd5c99a83643` | Dizipal watch pages fetched past the 429 Turnstile gate (`//bolum/…`, crawler-agent fallback); `CachedRemoteImage` retries failed loads (2s/5s/12s) and reports `image_load_failed`; Dizipal floor 2137 → 2140 |
| 2026-10-08 | `30bca9b` | `47ebebd2-a0af-423c-8823-d9ac978f2cdf` | Dizipal floor 2135 → 2137 |
| 2026-10-05 (2) | `83e0f44` | `27c0d390-1afb-4e61-b579-53828f1a4de1` | Home / Movies hub cache keys bumped so lists saved before the cinema filter are discarded; Settings footer shows the running update id and publish time |
| 2026-10-05 | `129aa20` | `5b285890-94f2-4874-9497-ce872cbc6ef7` | Discovery rails hide films still in cinemas (TMDB `release_dates`: shown once a digital/physical/TV release is past, or 90 days after cinema release); Trending rail tops up from page 2; Dizipal floor 2135 |
| 2026-09-27 | `3c5199e` | `ce7ffcde-8541-455f-a54a-3978f0cce3a8` | Dizipal's player-config now AES-encrypts the embed URL (`enc`, key k1 XOR k2); decrypted on device in pure TS, so Dizipal titles play again instead of falling to Dizibal's single-audio streams (*Succession* regains English audio) |
| 2026-09-25 | `a74377d` | `645e40af-2006-4d59-a993-8f4a1575692c` | Dizipal back on the numbered chain (2134, classic site, single-use session-bound `data-cfg` → `/ajax-player-config`; clone path and resolver Worker removed); providers resolved in parallel by priority; Dizibal series player 10s timeout; per-host breakers; detail screen no longer awaits dead imdbapi.dev, movie details persisted, TMDB custom domain first, provider config cache-first |
| 2026-09-24 (3) | `3de33f0` | `3a55ef0f-814a-4db6-9cb0-39f64f331a58` | Dizipal's resolver reads the watch page itself (the player host binds the token to whoever fetched it) and caches under the host's throttle |
| 2026-09-24 (2) | `23c63b5` | `deb84267-3e6c-4600-b805-317bd015f69a` | Dizipal follows its rebuilt site (POST `/bg/searchcontent`, `/film/{slug}-film-izle`, `div[data-rm-k]`) and resolves the stream through `streambox-dizipal-resolver`, because its player host 403s our users for every dynamic path while serving the media fine |
| 2026-09-24 | `25d0007` | `6725b6a2-bf14-484a-86b1-7831ba09e22f` | A provider that answers nothing is set aside after two dead calls (Dizipal's origin went 502 and starved Dizibal of the budget — *Star Wars* reported "Not available"); franchise catalogue audit: 55 titles re-punctuated, two entries given their missing tmdb_id, six series' episode counts, 17 titles added |
| 2026-09-22 | `d5a3bad` | `3d87c34d-8f3e-4aae-8d2d-febd113dcbb2` | Dizibal follows its rebuilt site (search → page → pilavyer HLS / direct MP4; movies, series, anime); FirePlayer root-relative subtitles (Criminal Minds CC); a found title that won't start re-resolves silently instead of "Not available", 15s stall watchdog, transient-miss retry |
| 2026-09-20 | `4dd1670` | `8c96926e-594b-4974-8f3b-c7eb12957da6` | Full cast (20) survives the cloud round-trip so Stats keeps ensemble leads; resolver awaits its in-flight pass and skips the pointless retry ("Not available" 3.3 s → 1.2 s); player error/Not-available copy localised |
| 2026-09-20 | `aeb3510` | `9b4e6424-b175-49a4-bede-e04f841762c2` | Dizipal encrypted `data-cfg` + HDFilm Sep-20 decoder (both tiers native again); provider player never shown, failed HDFilm tries others natively, real Retry; announcements older than the install hidden |
| 2026-09-18 | `d83c558` | `88228e31-f0bd-4fca-bb5f-a7c769eacc97` | Dizipal 2132 → 2133 floor |
| 2026-09-17 | `c6357aa` | `136302d1-fa59-4fc9-820c-5dcb3c9e13b8` | Sync queue surfaces rejected writes with backoff/dead-letter; WebView trust anchored to hostnames |
| 2026-09-15 | `fdcdb56` | `413b4741-25b4-413f-8ca1-8015e36830e3` | Dizibal wrong-film guard, Stats cast backfill, language/poster cache, playback buffer, Bakcell host failover, launch splash |
| 2026-09-14 | `6845830` | `377d7005-7033-4da1-851a-f90370ac2fe8` | Dizipal 2130 → 2131 floor |
| 2026-09-11 | `5987121` | `4b9f5051-51cd-42d6-b34b-c476dc8a941c` | Full-title search, apostrophe queries, watched leaves watchlist, actor stats depth, nav back stack, language switch |
| 2026-09-02 | `faf0e43` | `4fc77eff-1b8f-43ff-a389-14cc79675de5` | Dizipal `data-cfg` playback, stale-base floor, HDFilm first-request challenge retry |
| 2026-08-10 | `7d08cc1` | `de6dcbdb-b64d-4e4b-9d06-2d7b512f6852` | Non-Latin titles, ±1 year, audio track names, subtitles off by default, daily hero rotation |
| 2026-08-02 | `effb1d8` | `f192271c-b031-4a42-9619-c40c871b4f6c` | HDFilm decoder interpreter, Dizipal handshake, audio picker, season history sync |
| 2026-07-23 | `70ea35c` | `9ad008d5-55d7-496e-b6c8-7c8b03d40c4f` | YouTube player revert, chat delivery, launch smoothness |

---

## 4. Operational knowledge (hard-won — read before touching providers)

### Providers
- **HDFilm (tier 1)** WAF-blocks every datacenter IP, so neither the Worker monitor nor CI can
  see it. Health comes from `npm run check:hdfilm` on a residential connection and from the
  app's `player_resolve` telemetry. Its obfuscation rotates; `rapidrameScript.ts` interprets
  the live decoder body. Follow `decoder-recovery.md`.
- **HDFilm's decoder keys off the embed page's own hostname (2026-10-22).** The key string
  gains `self.location.hostname` (also spelt `location['hostna'+'me']`, `window.location…`,
  `document.location…` or bare `location…`, varying per request), and the parts are split on a
  random character. The interpreter now has read-only `location` / `self` / `window` /
  `document` objects for the page the embed came from (`runRapidrameDecoder(…, pageUrl)`), so
  every caller passes the embed's URL. Until then every HDFilm title fell through — 41
  `not_found` resolves on 10-22 against a usual ~7.
- HDFilm `/dizi/` pages challenge the **first** request on a fresh connection and pass after;
  `hdFilmGet()` retries past it.
- **HDFilm's second source, `/rplayer/{rapidrame_id}/` on the main domain, is the fallback
  (2026-10-28).** The `.mobi` embed's `rapidrame_id` names it, so no extra page read is needed;
  `resolveHdFilmNativeFallback` asks `.mobi` first (its streams carry the dual audio) and the
  rplayer page when `.mobi` refuses (429) or decodes nothing. Its decoder is packed, so the
  unpacker now unescapes the payload literal first (`unescapeJsStringLiteral`); its config keeps a
  commented-out `//sources: [{file:atob(file_link)}]` ahead of the live one, so the source variable
  is the first declared non-call; its captions are root-relative with `\u` labels. Streams come
  from `*.rapidrame.com` and play with `streamRequestHeaders`.
- HDFilm does not tokenize apostrophes: search `Rosemarys Baby`, not `Rosemary's Baby`.
- **HDFilm's search matches the listed title literally, punctuation included** (2026-10-28):
  "The Hunger Games: The Ballad of Songbirds & Snakes" finds nothing, nor does it with the colon
  stripped; "…: The Ballad of Songbirds and Snakes" finds the film. `generateSearchQueries` sends
  an `&`→`and` spelling that keeps the punctuation, and the franchise prefix before a colon
  ("The Hunger Games") counts as a bare name, so the two-empty-query cutoff waits for both.
  Before, the sweep gave up and the film played from Dizipal at lower quality.
- **Search wide, match here (2026-10-28).** Every spelling the plan sends must equal the listing
  letter for letter, and listings differ from TMDB in ways no rule foresees. The plan's bare
  names now end with the title's most distinctive word (`distinctiveTitleWord`: longest word of
  five letters or more in a title of three or more words, minus generic ones), which is a
  substring of the listing however the rest is spelled; scoring picks the film from the short
  list it returns. Listing titles are entity-decoded properly (`decodeHtmlEntities`: HDFilm
  writes "L&eacute;on", "Philosopher&#039;s", "Fast &amp; Furious"; the old decoder turned
  unknown entities into spaces), and both sides of a comparison fold "Vol."/"Volume", "Pt"/"Part"
  and roman numerals II–X (`canonicalTitleWords`). Measured with `findBestHdFilmMatch` /
  `searchDizipal` over 97 films: HDFilm 82 → 85 found (145 → 148 searches), Dizipal 68 → 69
  (373 → 429 searches; the extra ones are for titles it does not have), no title lost.
- **A title can carry " - " itself.** HDFilm lists "Turkish - English"; splitting
  "John Wick 3 Parabellum - John Wick: Chapter 3 - Parabellum" on every dash never offered the
  English title whole (score 43, "Not available"). `splitDualTitle` also tries every run of
  adjacent parts. Dizipal's slugs abbreviate (`/film/john-wick-3-parabellum`), so its URL guard
  accepts a page whose own search row names the title exactly.
- **HDFilm's embed host (`hdfilmcehennemi.mobi`) rate-limits per address**: ~60 resolves in a few
  minutes from one IP drew `429` on every embed (2026-10-28) and every HDFilm title fell to lower
  tiers. Sweep test titles slowly. Devices report it once per session as
  `hdfilm_embed_rate_limited` (carrier NAT shares addresses).
- **Dizipal (2026-09-25 onward) is the numbered chain again: `dizipal2134.com`**, on
  Cloudflare, reached by 2133's 301, with the classic site. The chain is `/ajax-search?q=`
  (JSON rows `{title, year, type: Film|Dizi, url}`; Turkish titles, but it matches English
  names too) → `/film/{slug}` or `/dizi/{slug}` → `/bolum/{slug}-{S}-sezon-{E}-bolum` →
  `#videoContainer[data-cfg]` → `POST /ajax-player-config` → `{v, t: "embed"}` → the embed
  page's jwplayer `sources[0].file` m3u8 (Referer: the embed URL). Everything runs on device;
  no Worker is involved.
- **Since 2026-09-27 `/ajax-player-config` encrypts the embed URL**: `config.v` is `""` and
  `enc: {c, iv, k1, k2}` (base64) carries it AES-256-CBC/PKCS#7 under the key `k1 XOR k2`
  (the site's `main.js` patches XHR and decrypts with CryptoJS). `decryptDizipalEnc` does the
  same on device with the pure-TS `src/services/aesCbc.ts` (no native crypto, so OTA-safe).
  Until it shipped, every Dizipal title fell through to Dizibal — whose pilavyer streams carry
  a single audio track — so series like *Succession* lost the English audio Dizipal's
  multi-audio HLS masters (`EXT-X-MEDIA TYPE=AUDIO`, Türkçe + English) offer. The monitor's
  `dizipal_playback` check now does the same POST on the page's session and requires an embed
  URL back (clear, or `enc` that decrypts), so a change here alerts "push OTA" instead of
  staying green.
- **`data-cfg` is a single-use token bound to the PHP session that rendered the page.** Posted
  from another session, or a second time, it answers `{"success":false,"message":"Invalid
  token"}`. The POST therefore rides the page read's session (the native cookie jar carries
  `PHPSESSID`; no `/ajax-token` mint is needed), and a rejected attempt re-reads the page and
  retries once with the session named explicitly (`fetchDizipalStreamUrl`). Never cache the
  page HTML for playback.
- **Watch pages sit behind a verification gate (2026-10-13 onward).** Every `/film/` and
  `/bolum/` page answers 429 with a Turnstile form posting to `/_ts_verify`; series pages,
  search and `/ajax-player-config` are not gated. The gate matches the path literally, so
  `fetchDizipalPlayerPage` asks for `//bolum/…` first, and falls back to a search-engine
  crawler user agent (allowlisted for SEO). Either render's cfg is accepted by the POST from
  the app's own user agent. A gated reply is treated as an answer, not an outage. If both
  doors close, Dizipal titles fall through to Dizibal again: `player_resolve` shows no
  `dizipal` rows. The direct-slug probe (`/film/{slug}`) reads through the same fetch.
- **The player-config POST needs the player beacon first (2026-10-23).** The watch page's
  script POSTs `/_pb` with `s=f:{slug}` (film) or `s=b:{slug}` (episode) before asking for the
  config; without it the config POST answers 403/429 `{"success":false}`. Its answer sets the
  `_ct` cookie the config is checked against (`postDizipalPlayerBeacon`). The gated page's
  browser check (`/_bcs` script → `POST /_bc_verify` with a fingerprint and proof of work →
  `_bc_ok` cookie) is **not** needed: the doubled-slash render skips it, and the config POST
  doesn't look for `_bc_ok`.
- **Dizipal's search answers an empty body to any non-ASCII query** (2026-10-16: "Çöl
  Gezegeni" → nothing). It matches by substring on the listed (often Turkish) title, so
  `toDizipalSearchQuery` sends the longest run of words the query already spells in ASCII
  ("Dune: Çöl Gezegeni - Bölüm İki" → "Gezegeni"); scoring ranks against the full title.
- **imagestoo packs its player call (2026-10-26).** `FirePlayer("{hash}", {…})` sits inside a
  Dean Edwards packer (`eval(function(p,a,c,k,e,d)…)`), so `resolveEmbedToM3u8` unpacks the embed
  (`tryUnpackInlinePackerJs`) before looking for the hash; the `getVideo` POST is unchanged. The
  config's `tracks` captions are WebVTT behind a `.jpg` name (`extractFirePlayerCaptionTracks`).
  Read packed, every imagestoo title (*Harry Potter and the Deathly Hallows: Part 1*) had no
  Dizipal stream. Dizipal pages also write JSON-LD `"datePublished":2024` as a bare number now,
  which the direct-slug year check has to read.
- **Stream hosts want a browser's `Sec-Fetch-*` headers (2026-10-26).** formationfeed's CDN
  (`*.superadjacentsoddenly.xyz`) answers 403 to a playlist request without `Sec-Fetch-Site`,
  `-Mode` and `-Dest`, whatever the Referer or agent: *The Invite* resolved, then spun through the
  player's recoveries and a silent re-resolve that returned the same refused stream. The player
  sends `streamRequestHeaders(referer)` (Referer, the app's agent, the Sec-Fetch trio) with every
  playlist and segment, and a Dizipal embed stream is pre-checked with the same headers
  (`isStreamRefused`): a 4xx drops it so the other tiers answer; no answer or a 5xx keeps it.
- Embeds come from several hosts. `formationfeed.net` serves the m3u8 inline;
  `imagestoo.com` (`/player/index.php?do=getVideo`) was **down for everyone** on 2026-09-25
  (522 from Cloudflare, TLS stalls from Azerbaijani ISPs), so the titles on it have no Dizipal
  stream. Each embed host has its own `providerGet` breaker (`Dizipal embed <host>`), so a dead
  one costs two timeouts, not one per title.
- 2026-09-23 → 24 the numbered origin was 502 at DDoS-Guard and the app briefly followed
  `dizipal2200`–`2222.com`, **a different operator's clone** (`/bg/searchcontent`,
  `div[data-rm-k]`, a player host that 403s Azerbaijani ISPs, reached through a
  `streambox-dizipal-resolver` Worker). That code and Worker were removed on 2026-09-25 when
  the real site came back. **Check the old domains' redirect target before trusting a higher
  `dizipalN.com`**: the 22xx band is the clone, and 2200, 2203-2205, 2207 and 2300 are SEO
  squatters serving "güncel adres" landing pages.
- **Dizipal** rotates its numbered domain (`dizipalN.com` → `N+1`, currently 2143; 2141 went
  dark without a redirect, so a device pinned to it reached 2142 only through Supabase). Hops are
  not one per rotation; a stale base costs seconds and past ~21 hops breaks axios.
  `normaliseDizipalBaseUrl` treats the shipped base as a **floor** — bump it when Dizipal
  rotates, and update the Supabase row with the Telegram bot (`/set_dizipal <url>`). The floor
  compares suffixes numerically, so a row pointing into the 22xx clone band would win over
  it: never `/set_dizipal` there.
- `/set_dizipal` saves a failing candidate when the configured URL 301s to it (2026-09-18: the
  bot rejected the very command its own rotation alert suggested). Failure reasons carry the
  page title; the Worker logs only 10% of invocations, so the Telegram reply and KV state are
  the record.
- From 2133 (2026-09-18) to 2134 (2026-09-25, back on Cloudflare) Dizipal sat behind
  **DDoS-Guard**, which answers the monitor's
  Cloudflare IPs 403 ("Error 403") while residential users get 200. The monitor marks those
  checks `blocked` (never "down") and watches rotations through **DNS** instead: Dizipal
  bulk-registers future `dizipalN.com` domains on placeholder nameservers that SERVFAIL until
  the day they go live, so "a newer dizipalN resolves" is the rotation alert
  (`checkDizipalDomain`, hourly cron, 12-suffix lookahead). `/set_dizipal` accepts a walled
  candidate when it resolves in DNS and is not behind the configured domain; `… force`
  overrides. The app picks the new row up without an OTA (remote wins when ahead of the floor).
- Dizipal lists films under **Turkish** titles, and its search rows carry the year, which is
  what disambiguates remakes. A film found only under its Turkish name is reached by the
  retry with TMDB's Turkish title (`getTurkishAlternativeTitle`).
- Dizipal and HDFilm serve intermittent Cloudflare challenges; both go through `providerGet`
  / `hdFilmGet` retries.
- **A provider that is DOWN must not cost the others their budget.** On 2026-09-24 Dizipal's
  origin went 502 behind DDoS-Guard: the domain still resolves, but every path hangs ~6s and
  then answers "502 - Bad Gateway". Four dead calls ate 24s of the resolver's 20s ceiling, so
  Dizibal — which had the film — was never asked and *Star Wars* (1977) reported "Not
  available" although it was watchable. Every provider fetch now goes through `providerGet`
  (Dizibal included, via `dizibalGet`), which counts requests that got **no answer at all**:
  two in a row and that provider is skipped instantly for a minute, doubling per further
  outage up to 15 minutes. Any HTTP reply — 404, 403, 500 — proves the host is alive and
  clears the record, so a provider is never skipped for saying "no". A skip is not a request
  failure, but a pass that **skipped** a provider never asked it, so its miss is not final:
  `resolveWebPlayerUrl` clears the breakers and runs its second pass (`providerSkips`). Before
  that, two dropped HDFilm requests on one phone made every HDFilm-only title (*The Fall*,
  2026-10-24: ten episodes in a row) "Not available" in about a second until the cooldown ended
  or the app was killed — "clearing the cache" fixed it only by restarting the app. Retry on the
  player (`forgetProviderBackoff`) clears the breakers and Kült Filmler's cooldown too.
  A host a provider hands out has its **own** breaker (`Dizipal embed <host>`,
  `Dizibal player`), so a dead embed or player host never gets the provider's site skipped.
- **The tiers run in parallel (2026-09-25).** They used to run one after another — HDFilm,
  Dizipal, then both again with the Turkish title, then Dizibal — so a title only Dizibal had
  paid for every step before it (10-15s on "Watch"). `resolveWebPlayerUrlInner` now starts all
  three at once, fetches the Turkish title once up front, and `firstNativeByPriority` answers
  with the highest tier's stream (a lower tier waits ≤2.5s for a higher one still running).
  Measured from Baku: 0.9-1.5s for titles on HDFilm/Dizipal.
- **Dizibal's series player host is slow**: `pilavyerplay.top/assets/js/s.php` takes 4-10s
  (the movie host `play2.` 0.2s). It gets `DIZIBAL_PLAYER_TIMEOUT_MS` (10s); at the shared 5s
  it timed out, tripped its breaker and every later title lost Dizibal. A series only Dizibal
  carries therefore still takes ~7s — that is the host, not the app.
- Dizipal's rotation is announced by the **old domains**: 2120 … 2133 all 301 to the configured
  2134. "Some higher `dizipalN.com` answers" is not the signal (see the clone band above).
- **Dizibal** rebuilt its site in Sept 2026 (Laravel); the old `/api/*` JSON routes all 404.
  The resolver now follows the browser: `/ara/oneri?q=` (JSON search; Turkish titles, but it
  matches English names too; no TMDB ids, so the year from `meta` must fit) → the movie page or
  `{series|anime url}/season/S/episode/E` (anime films are anime entries, episode 1×1) → the
  player box. `embed`: `https://{player host}/assets/js/s.php?s={data-pv}` with the Dizibal
  origin as `Referer` (403 otherwise) → `window.__PLAYER__` → AES-128 HLS `stream` + WebVTT
  `subs`. `direct`: `/video/bolum/{id}` MP4, HEAD-probed first (some ids 502 upstream). A
  Turkish-named listing is confirmed by the page's JSON-LD `alternateName` (≤3 pages). The site
  IP-bans datacenter IPs (monitor: `blocked`); the player host does not.
- **Kült Filmler (tier 4, 2026-10-23)** — kultfilmler.net, a WordPress catalogue of classics and
  arthouse (~5,000 films, a few dozen series) that often has what the other three lack. **Every
  path answers a Cloudflare managed challenge** (`403 cf-mitigated: challenge`, "Just a
  moment…") that only a browser engine passes; it does so on its own in ~5s, with no click.
  The clearance cookie is bound to that browser's exact user agent, and a spoofed agent fails
  the challenge, so it can't be lifted into native requests. The site is therefore read
  through **a hidden WebView** (`KultfilmlerBridge`, mounted in the app shell, rendering
  nothing until asked): it loads the empty search URL, which is a tiny JSON document once
  cleared, and every request runs as a same-origin `fetch()` in that page, bodies coming back
  over `postMessage` (`kultfilmlerSession`). Nothing the site serves is rendered or executed;
  navigation off the site is refused. **The WebView must be drawn**: the first release made it
  2×2 px at opacity 0, Android never drew it, an undrawn WebView gets no animation frames, and
  every phone hit `challenge_timeout` (desktop Chromium, which renders regardless, passed). It
  is now a 360×640 viewport at opacity 0.01, mounted beneath the navigator. Detail screens
  warm the session once they have been open 1.5s (`scheduleKultfilmlerWarm`; started on mount,
  the challenge's script ran during every detail page's entrance, and for pages merely skimmed
  past), so the challenge is usually done before Watch. The session closes 3 min after its last
  use; a reopened WebView keeps its clearance cookie and is ready in ~1s. A challenge not passed
  in 20s puts the provider aside for 3 min (no second resolver pass for it; Retry lifts it); one still running when the tier's
  14s budget ends counts as transient, so the second pass asks again; a lapsed clearance
  mid-session reloads and retries once. Worker egress is challenged too (checked with
  `wrangler dev --remote`), so a server-side proxy is no way round it. Telemetry:
  `kultfilmler_session` (`outcome: ready|challenge_timeout`, `ms`, `loads`, and on a timeout
  the page's last `title`, `visibility` and `challengeFrame`).
  Chain: `/wp-admin/admin-ajax.php?action=kf_live_search&q=` (JSON `{title: "English –
  Turkish", url, year, type: Film|Dizi}`; matches original titles and Turkish letters) → film
  page, or series page → `div.eps[data-season]` → episode → the watch page's JSON player list
  `[{name, langLabel, html: "<iframe src>"}]` ("Altyazılı" = original audio + Turkish subs,
  preferred over "Türkçe Dublaj"). Players: **ok.ru** `/videoembed/{id}` (`data-options` →
  `flashvars.metadata.hlsManifestUrl`, signed for the requesting IP, plays with any agent,
  subtitles burned in) and **FirePlayer** on vidpapi.xyz (`/video/{hash}`, `getVideo` →
  `securedLink`; `.srt` subtitles from `playerjsSubtitle`; the embed names the IMDb id, which
  must match a film's). A 40-film sample was 22 ok.ru, 17 FirePlayer, 1 vidmoly (unreachable
  from Azerbaijan, skipped). Some episodes are "Bu bölüm çok yakında" placeholders. The first
  play of a session pays for the challenge; a title nobody has can then take ~5s to say "Not
  available" instead of ~2s.
- A stream the resolver found but that will not start is never "Not available": the player
  re-resolves once silently (`failPlayableTitle`), then shows the retryable stream error. The
  stall watchdog is 15s (`minBufferForPlayback: 4` + imagestoo's per-segment hostnames made cold
  starts outrun 8s). A resolve pass in which a request got no answer (timeout, 5xx, 403/429 —
  never 404) is retried; a clean miss still answers after one pass.
- **Discovery rails hide films still in cinemas** (`src/api/releaseWindow.ts`). No provider
  carries a film until it is released online: TMDB `release_dates` type 4/5/6 (digital,
  physical, TV). A film shows once its earliest home release in any country is past, or 90
  days after its earliest cinema release if TMDB has no home date. Applied to Trending
  Movies, the hero, Top New Movies and Movie of the Day; search, detail pages and journeys are
  unfiltered. Verified 2026-10-05: every trending film with a past home date played, every
  cinema-only one was missing. Films older than last year skip the lookup; a failed lookup
  keeps the film.
- **A provider alert that names a symptom the site does not have is a monitor bug until
  proven otherwise.** Re-probe from Worker egress (`npx wrangler dev --remote`) first.
- **A scoring heuristic must never outrank the literal thing the user typed** unless it has
  independent evidence (search person-index noise, rating floors on cross-language matches).

### Infrastructure
- **Bakcell** mobile data cannot reach `*.workers.dev`. Since 2026-09-25 `tmdb.ts` asks
  `tmdb.streamboxapp.stream` (same Worker) **first** and fails over to workers.dev; the two
  hostnames keep separate edge caches, so one primary also doubles the hit rate. Keep both
  attached.
- TMDB proxy edge TTLs: film/collection/person records 24h, everything else 6h (series gain
  episodes), search 5 min. The Cache API is per-colo, so a short TTL misses often in the
  low-traffic Baku colo (miss ≈ 0.8s, hit ≈ 0.05s).
- Detail-screen speed: movie details persist across cold starts (`PersistedLruMap`, 80
  entries); provider config serves the local cache at launch and swaps in Supabase's answer
  when it lands, so a Watch tap never waits on it.
- The Supabase project signs user JWTs with **ES256**. The TURN Worker verifies them against
  the project JWKS; it only mints for `role: authenticated` tokens with a `sub`.
- Worker secrets are required; each Worker fails closed (401/503) without them. CORS allows
  no browser origins unless `ALLOWED_ORIGINS` is set.
- Logs: Cloudflare dashboard → Workers & Pages → worker → Observability, or
  `npx wrangler tail <worker>`. `streambox-turn-credentials` logs 100% of requests (events
  `issued`, `unauthorized`, `misconfigured`); the other Workers sample 10%.
- Cron `external-ratings-hot-refresh` was recreated on 2026-09-17 with the real anon key via
  `ensure_external_ratings_jobs(...)`; it is not in the baseline and must be recreated on any
  rebuilt project.
- Sync queue (`userDataSync.ts`): rejected writes back off (5s → 5min) and are dropped with
  `sync_operation_dead_lettered` telemetry after 8 server rejections; connectivity and
  expired-session failures back off but never count.

---

## 5. Watch Together

A private **2-person room**: join by 6-character code or deep link
`streambox://room/<code>`, watch a movie in sync, face-cam + voice, text reactions/chat, and
polaroid memories saved to a **Shared Sessions** shelf on both profiles. Entry point is the
movie detail screen (movies only; the episode picker is excluded in rooms). Architecture and
wire protocol: `docs/watch-together.md`.

- **The host does not need to wait for a guest.** Playback is never blocked; the "Waiting for
  your partner" card is non-interactive. When the guest joins, they sync to the host's
  position. Capturing a polaroid requires both people present.
- Native stack (why this is its own runtime): `react-native-webrtc@124`, `expo-camera@17`,
  `@config-plugins/react-native-webrtc@13`. WebRTC is loaded optionally via
  `src/services/webrtcCompat.ts`, so JS still runs where the native module is missing.
- **Media never traverses Supabase.** WebRTC is peer-to-peer with Cloudflare Realtime TURN as
  relay (credentials from `workers/turn-credentials`); Supabase Realtime carries only
  signalling, sync heartbeats, chat and presence.
- The room channel is `private: true` and authorized by two `realtime.messages` RLS policies
  (migration `20260916211341`). Without them joins are rejected.
- Sync is by **content timecode** with the host as clock; each phone resolves its own stream.
  The guest measures clock offset with `sync-ping/pong` (median of 5); hard seeks need >2s
  drift, have a 5s cooldown, and skip while buffering.
- A `webrtc-ready` handshake gates the offer so it cannot race the guest's peer connection.
  Offers use `iceRestart`; failed connections rebuild up to 3 times, then show "Tap to retry".

### Photo capture (non-obvious)
- **Do not view-shot the `RTCView`** — it renders to a SurfaceView that screenshots capture
  black. Stills are taken with `expo-camera` by briefly handing the camera off from WebRTC.
- `PolaroidCard.tsx` is code/SVG, captured at 1080×1451. Valid TMDB image sizes are
  `w185/w300/w342/w500/w780/original`.
- Uploads use a Storage signed upload URL and a native binary upload task (no base64 on the
  JS thread); the responder's 12s deadline is end-to-end.

### Memories
- Local-first: the PNG + an AsyncStorage entry (`streambox/watch-memories-local`) are written
  immediately, then uploaded in the background. The memory id is a client UUID from birth;
  `watchMemorySync.syncPendingMemories()` retries idempotently (23505 = success).
  Participants come from `watch_room_members`, never presence.
- Delete is per-user (`remove_watch_memory`); the row and file are purged only when no
  participant is left.

### Realtime health
- Broadcasts use server acknowledgements; sends and a 20s liveness probe require an open
  socket. Lifecycle generations stop stale work from resurrecting a room after exit.
- Auth refreshes at the 60s boundary, retries a failed refresh after 10s, and reconnects if
  the token is unusable.
- Only the never-connected lobby shows the code; a channel failure shows "Reconnecting…", a
  real departure shows partner-left copy.
- `scripts/watchPartnerBot.ts` no longer exists; private channels need real 2-device testing.

---

## 6. Player autonomy

- `src/utils/playerProgress.ts`: `shouldAutoMarkWatched` (≥95% and ≥60s of real engaged time),
  `shouldShowNextEpisode` (≤45s left or ≥97%), `nextEpisodeCountdownReducer`.
- `src/hooks/useAutoMarkWatched.ts` fires once per session using the manual mark-watched
  builders.
- `src/hooks/useNextEpisode.ts` + `NextEpisodePill.tsx`: "Up next" with an auto-advance
  countdown and a persisted `@streambox/auto-play-next` toggle.
- `EpisodePickerSheet.tsx`: switching episodes does `navigation.replace("Player", …)` so the
  resolver remounts cleanly.

---

## 7. Hard guardrails (do NOT violate)

- **Work lands on `v1.2.0`; `main` only fast-forwards to it.** Never force-push either without
  the owner's explicit approval.
- **Commits and PRs are authored by Eshgin Mammadov only.** No `Co-Authored-By:` or other AI
  attribution trailers. Git history was rewritten on 2026-09-14 to enforce this; commit IDs on
  the EAS dashboard from before that date are pre-rewrite.
- **Production-mutating commands need the owner's explicit approval in the current task**:
  `supabase db push`, `supabase functions deploy`, `wrangler deploy`, `eas update`, and any SQL
  that writes to production. Schema changes are always a new migration file first.
- **Never echo, log, or commit secrets** (Supabase keys, tokens, `.env`).
- Temporary scripts live in `scripts/` and are deleted when done.
- Keep the player **native**: never show a provider's own web player. The resolver returns a
  native stream or `not_found`; a failed HDFilm stream asks Dizipal/Dizibal for a native one
  (`resolveNativeAlternativeToHdFilm`). The only WebViews left are trailer pages and the
  app-owned hls.js surface (`dizipal_html5`). Keep `useNativeControls={false}`.
- Match the surrounding code style; don't reformat unrelated code.

---

## 8. Environment notes (Windows)

- PowerShell 5.1 is the primary shell (no `&&`/`||`); Git Bash is also available.
- Multi-line commit messages: write to a temp file and `git commit -F <file>`.
- No Docker, `psql` or Deno on this machine; use `supabase db query --linked` for reads and
  `npx --yes deno@2 check` for Edge Functions.

---

## 9. Verification checklist before calling anything done

- [ ] `npm run typecheck` clean.
- [ ] `npm test` passes (extend the relevant suite; don't weaken tests).
- [ ] `npm run lint` has 0 errors.
- [ ] New behaviour has a test or a manual repro the owner can run.
- [ ] No secrets committed; no production command run without approval; temp scripts removed.
- [ ] Final report lists files changed, test results, and any update group ID / deploy version.
