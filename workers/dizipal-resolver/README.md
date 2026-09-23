# streambox-dizipal-resolver

Turns a Dizipal watch page into a playable HLS URL. It exists because our users
can stream Dizipal but cannot **ask** it for the stream.

## The problem it solves

Dizipal rebuilt its site in Sept 2026 and moved playback behind its own player
host (`*.dplayer*.site`). That host runs a Cloudflare firewall rule that answers
**403 "Attention Required"** to our users' networks for every dynamic path:

| Path | From an Azerbaijani ISP | From Cloudflare (this Worker) |
|---|---|---|
| `iframe.php` (player page) | 403 | 200 |
| `source2.php` (stream JSON) | 403 | 200 |
| `l.php` / `ld.php` (variant playlists) | 403 | 200 |
| `master.m3u8` | **200** | 200 |
| `.jpg` segments on `*.cfd` | **200** (Referer required) | 200 |
| `.vtt` subtitles on `*.cfd` | 403 | 200 |

Verified 2026-09-24 from a residential AZ connection and from `wrangler dev
--remote`. The device can fetch every byte of video; it just cannot obtain the
playlist that names them. This Worker asks that one question from Cloudflare's
network and hands the answer back.

**Video never passes through the Worker.** Only the ~40 KB variant playlist and,
if the viewer turns subtitles on, a WebVTT file.

## The chain

1. The app reads the watch page (`dizipalN.com` itself is *not* walled) and
   posts its `div[data-rm-k]` blob to `POST /player`.
2. `{ciphertext,iv,salt}` → PBKDF2-SHA512(passphrase, salt, 999 iterations,
   32 bytes) → AES-256-CBC → the player iframe URL. This is the site's own
   `oyunculistdc()`; the passphrase is a literal in its `pageload.js` and is
   re-read hourly rather than pinned, because it rotates.
3. `iframe.php` → `openPlayer('<token>', …, [subtitles])`.
4. `source2.php?v=<token>` → JSON; `playlist[0].sources[0].file` is an `m.php`
   URL, and swapping in `master.m3u8` is what the site's own player does.
5. The master lists `l.php` variants, so the highest-bandwidth one is fetched
   and served back through `/playlist`. Its segments are absolute `.cfd` URLs
   the device fetches itself — with `Referer: https://<player host>/`, without
   which the CDN answers 403.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /player` | `{cfg, base}` → `{stream, streamType, referer, subtitles[]}` |
| `GET /playlist?u=&r=` | The variant playlist, proxied |
| `GET /subtitle?u=&r=` | One WebVTT file, proxied |
| `GET /health` | Liveness for the provider monitor |

`u` is only ever fetched when `isProxyableUrl()` allows it: the player host with
an `l.php`/`ld.php`/`m.php`/`.m3u8` path, or its CDN with a `.vtt`/`.srt` path.
Segments are deliberately **not** proxyable — that is what keeps this from being
an open media proxy. `r` carries the player-host Referer the CDN insists on, and
is itself checked against the player-host pattern.

## Hosts

Served on `dizipal.streamboxapp.stream` **and** `workers.dev`. The app tries the
custom domain first: Bakcell's mobile network cannot reach `*.workers.dev` at
all (same reason the TMDB proxy has two hosts).

## Deploy

```bash
cd workers/dizipal-resolver
npx wrangler deploy
```

No secrets, no bindings. `DIZIPAL_BASE_URL` is only a fallback for a caller that
sends no `base`; the app always sends the domain from `provider_configs`, so a
Dizipal rotation needs no redeploy here.

## When it breaks

`dizipal_resolver` in the provider monitor is end-to-end (canary page → blob →
resolver → stream URL), so an alert naming it means playback is dead for every
Dizipal title even if `dizipal_home` and `dizipal_search` are green. The likely
causes, in order:

1. **The passphrase moved out of `pageload.js`** — `player_config_undecryptable`
   in the logs. Find the new `oyunculistdc('…')` call site.
2. **`openPlayer` was renamed** — `iframe_shape_changed`.
3. **`source2.php` changed shape** — `source_shape_changed`.
4. **The firewall rule widened** to `master.m3u8` or the segments. Then the
   device cannot stream Dizipal at all and no Worker change helps; the app falls
   through to HDFilm and Dizibal, which is what it already does when Dizipal is
   down.
