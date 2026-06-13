# StreamBox Video Player Notes

## Current Architecture

StreamBox resolves playback in `src/services/WebPlayerService.ts` and renders it in `src/screens/PlayerScreen.tsx`.

The preferred path is:

1. Resolve the provider page.
2. Extract a real playable stream when possible.
3. Use native `expo-video` playback for direct HLS/MP4 streams.
4. Keep WebView playback only as a provider fallback.

This is especially important for HDFilmCehennemi because some newer Rapidrame uploads use HLS playlists whose media segments are disguised as image files. Android WebView/JWPlayer can play audio for those streams while rendering a black video surface. Native `expo-video` handles that shape much more reliably.

## HDFilm Root Cause

The black screen was not primarily a UI-layer problem. It happened because HDFilm stream extraction silently failed.

HDFilm embeds store the real stream URL in an obfuscated `s_*` array on the embed page. The provider rotates the decode function from time to time. When the app decoder was outdated, `extractRapidrameStreamUrl` returned no valid URL, so HDFilm titles fell back to the WebView player with `streamUrl: none`.

Newer uploads then exposed the WebView weakness: audio could play while video stayed black.

## Current Fix

The resolver now supports multiple Rapidrame decode schemes through `RAPIDRAME_PRE_UNMIX_TRANSFORMS`.

The current strategy is:

- Try known decode transforms, newest first.
- Accept only decoded values that normalize to absolute `http(s)` media URLs.
- Inspect HLS playlists for disguised image segments.
- Route problematic HDFilm streams to native `expo-video`.
- Keep WebView fallback available for cases that cannot be resolved directly.

This keeps already-working HDFilm titles working while fixing black-screen uploads through native playback.

## Health Check

The repo has a resolver health script:

```bash
npm run check:hdfilm
```

It fetches a few live HDFilm probe titles, uses the current decoder, and verifies that the decoded URL serves a real HLS manifest containing `#EXTM3U`.

If healthy, it exits with code `0`.

If broken, it tries to derive the new provider transform from known primitives and prints the recovered transform. To auto-insert the recovered transform locally:

```bash
npm run check:hdfilm -- --write
```

After using `--write`, always run:

```bash
npm run typecheck
npm test
```

Review the one-line decoder diff before publishing an update.

## Scheduled Monitoring

`.github/workflows/hdfilm-resolver-health.yml` runs `npm run check:hdfilm` every day at 10:00 Asia/Baku and also supports manual runs from GitHub Actions.

If the provider rotates the decoder, the scheduled workflow should fail. Check the workflow logs. If the script recovered a transform, run the `--write` command locally, verify, and release an EAS update or APK depending on the changed surface.

## Known Limitations

- HDFilm can introduce a brand-new obfuscation primitive. The script can auto-derive only schemes made from the known primitives: reverse, base64, and rot13, followed by the Rapidrame unmix step.
- If the provider domain changes, update `HDFILM_BASE` in `scripts/check-hdfilm-resolver.ts` and the remote provider config.
- WebView playback should remain a fallback, not the preferred HDFilm path for Rapidrame streams.
- Avoid broad regex extraction that accepts any `.m3u8` on the page. Hidden ads can also use media URLs. Resolver output must stay gated by trusted embed context and manifest validation.

## Testing Checklist

Test these before releasing player changes:

- A known HDFilm black-screen title, such as `The Devil Wears Prada 2`.
- A second HDFilm title that previously failed, such as `Ready or Not Here I Come`.
- A previously-working HDFilm title.
- A Dizipal-only title.
- A series episode.
- Subtitle/audio controls in native and WebView paths.

Expected HDFilm result for fixed Rapidrame uploads: logs should show a populated direct stream URL and native playback should render video and audio.
