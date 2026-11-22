import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());
const playerScreenPath = path.join(rootPath, "src", "screens", "PlayerScreen.tsx");
const webviewInjectionPath = path.join(rootPath, "src", "screens", "player", "webviewInjection.ts");
const hlsWebPlayerPath = path.join(rootPath, "src", "screens", "player", "HlsWebPlayer.tsx");

test("player screen keeps direct playback native and cleans provider web fallbacks", () => {
  const playerScreenSource = fs.readFileSync(playerScreenPath, "utf8");
  assert.equal(playerScreenSource.includes("useVideoPlayer"), true);
  assert.equal(playerScreenSource.includes("<VideoView"), true);
  assert.equal(playerScreenSource.includes("YoutubeIframe"), true);
  assert.equal(playerScreenSource.includes("nativeControls"), true);
  assert.equal(playerScreenSource.includes("clearCache?.(true)"), true);
});

test("HDFilm runtime stream discovery is wired to native playback handoff", () => {
  // The discovery script itself lives in the extracted webviewInjection module
  // (so PlayerScreen.tsx stays a screen, not a 2k-line WebView script bundle).
  // PlayerScreen still owns the runtime-handoff side (message handlers, stream
  // acceptance, native player switching).
  const injectionSource = fs.readFileSync(webviewInjectionPath, "utf8");
  const playerScreenSource = fs.readFileSync(playerScreenPath, "utf8");

  assert.equal(injectionSource.includes("HDFILM_RUNTIME_DISCOVERY_SCRIPT"), true);
  assert.equal(injectionSource.includes("hdfilm_stream_discovered"), true);
  assert.equal(injectionSource.includes("hdfilm_embed_discovered"), true);

  assert.equal(playerScreenSource.includes("shouldAcceptDiscoveredHdFilmStream"), true);
  assert.equal(playerScreenSource.includes("switchToDiscoveredHdFilmStream"), true);
});

test("Dizipal HTML5 recovery refreshes the stream in-session and keeps a direct fallback", () => {
  const hlsSource = fs.readFileSync(hlsWebPlayerPath, "utf8");
  const playerScreenSource = fs.readFileSync(playerScreenPath, "utf8");

  assert.equal(hlsSource.includes("/player/index.php?data="), true);
  assert.equal(hlsSource.includes("data.videoSource || data.securedLink"), true);
  assert.equal(hlsSource.includes("headers: pageUrl ? { Referer: pageUrl }"), true);
  assert.equal(hlsSource.includes("userAgent={PLAYER_WEBVIEW_USER_AGENT}"), false);

  assert.equal(playerScreenSource.includes("resolveDirectWebPlayerFallback"), true);
  assert.equal(playerScreenSource.includes("recoverFromDizipalFailure"), true);
  assert.equal(playerScreenSource.includes('referer:${fallback.referer ?? "none"}'), true);
  assert.equal(playerScreenSource.includes("isImagestooStream(playerResult.streamUrl)"), true);
});

// ---------------------------------------------------------------------------
// "Not available yet" must mean "no provider has this title", never "the
// stream hiccuped". Conflating the two is what made the player answer a seek,
// an early tap on the subtitle button, or one bad segment with a card telling
// the viewer the title isn't in the catalog — for a title that was playing a
// second earlier and that a retry reliably fixed.
// ---------------------------------------------------------------------------

test("a mid-playback stream error recovers in place instead of showing not_found", () => {
  const source = fs.readFileSync(playerScreenPath, "utf8");

  // The error branch must try in-place recovery first, and only for a stream
  // that had actually started.
  assert.equal(
    source.includes("if ((hasStarted || nativePlaybackStartedRef.current) && recoverCurrentStream(ev.error?.message)) return;"),
    true
  );
  assert.equal(source.includes("const recoverCurrentStream = useCallback("), true);
  assert.equal(source.includes("MAX_STREAM_RECOVERY_ATTEMPTS"), true);
  assert.equal(source.includes("planStreamRecovery(streamRecoveryStateRef.current"), true);

  // Recovery must preserve the position, or "recovery" restarts the film.
  assert.equal(/resumeAt\s*=\s*videoPlayer\.currentTime/.test(source), true);
  assert.equal(source.includes("videoPlayer.currentTime = resumeAt"), true);

  // The native-error path must no longer be able to produce not_found.
  const errorBranch = source.slice(
    source.indexOf('if (ev.status === "error")'),
    source.indexOf('const playingSub = videoPlayer.addListener("playingChange"')
  );
  assert.ok(errorBranch.length > 0, "error branch should be locatable");
  assert.equal(
    errorBranch.includes('source: "not_found"'),
    false,
    "a playback error must not be reported as a missing title"
  );
});

test("a recovered stream clears the loading overlay instead of leaving a black screen", () => {
  // The overlay is an opaque black fill, so `isPlaybackReady` stuck false over
  // a playing stream is exactly the "I can hear it but the screen is black"
  // report. The error branch sets it false; only playingChange can set it back,
  // and it used to do so only on the FIRST play.
  const source = fs.readFileSync(playerScreenPath, "utf8");
  const playingBranch = source.slice(
    source.indexOf('const playingSub = videoPlayer.addListener("playingChange"'),
    source.indexOf('const subtitleSub = videoPlayer.addListener(')
  );
  assert.ok(playingBranch.length > 0, "playingChange branch should be locatable");
  assert.equal(playingBranch.includes("if (!ev.isPlaying) return;"), true);
  assert.equal(playingBranch.includes("setIsPlaybackReady(true);"), true);
  assert.equal(
    playingBranch.includes("&& !hasStarted"),
    false,
    "readiness must be restored on every play, not only the first"
  );
});

test("the quality switch reports failure instead of dropping the rejection", () => {
  const source = fs.readFileSync(playerScreenPath, "utf8");
  const selectQuality = source.slice(
    source.indexOf("const selectQuality = useCallback("),
    source.indexOf("const toggleDirectSubtitleMenu = useCallback(")
  );
  assert.ok(selectQuality.length > 0, "selectQuality should be locatable");
  assert.equal(selectQuality.includes(".catch("), true);
});

// ---------------------------------------------------------------------------
// The provider's own player is never shown (2026-09-20, "Neagley"). A failed
// HDFilm stream used to drop to hdfilmcehennemi's page player; it now asks
// Dizipal/Dizibal for a native stream of the same title, and says "Failed to
// load" with a Retry that really re-resolves when neither has one.
// ---------------------------------------------------------------------------

test("a failed HDFilm stream asks the other providers instead of opening HDFilm's page", () => {
  const source = fs.readFileSync(playerScreenPath, "utf8");
  assert.equal(
    /setPlayerResult\(\{ url: prev\.webViewFallbackUrl, source: "hdfilm" \}\)/.test(source),
    false,
    "the stall watchdog must not open the provider page"
  );
  assert.equal(
    /return \{ url: prev\.webViewFallbackUrl, source: "hdfilm" \}/.test(source),
    false,
    "the playback-error branch must not open the provider page"
  );
  assert.match(source, /recoverFromHdFilmFailure\("native_stall"\)/);
  assert.match(source, /recoverFromHdFilmFailure\(ev\.error\?\.message \?\? "native_error"\)/);
  assert.match(source, /resolveNativeAlternativeToHdFilm\(buildWebPlayerRequest\(\)\)/);
});

test("Retry re-runs the resolve for native streams and Not available", () => {
  const source = fs.readFileSync(playerScreenPath, "utf8");
  const retry = source.slice(source.indexOf("const retryPlayback = () => {"), source.indexOf("const isLoading = "));
  assert.ok(retry.length > 0, "retryPlayback should be locatable");
  assert.equal(retry.includes("setResolveNonce((nonce) => nonce + 1);"), true);
  assert.match(source, /\}, \[route\.params, buildWebPlayerRequest, resolveNonce\]\);/);
  // Both the error card and the Not available card use it.
  assert.equal(source.split("onPress={retryPlayback}").length - 1, 2);
});

test("a load error is visible, not hidden behind the loading overlay", () => {
  const source = fs.readFileSync(playerScreenPath, "utf8");
  assert.match(source, /const isLoading = isResolving \|\| \(!isPlaybackReady && !loadError && /);
});

test("native video uses SurfaceView so HDR streams aren't dimmed, TextureView only in a watch room", () => {
  // Many provider streams are HDR (PQ/BT.2020 — The Mandalorian). Android's
  // TextureView does not tone-map HDR to an SDR display, so the video rendered
  // dark. SurfaceView does. A Watch Together room keeps TextureView because its
  // face-cam overlay only composes above a TextureView video.
  const playerScreenSource = fs.readFileSync(playerScreenPath, "utf8");
  assert.match(
    playerScreenSource,
    /surfaceType=\{route\.params\.watchRoomCode \? "textureView" : "surfaceView"\}/,
    "the direct-stream VideoView must pick surfaceType by watch-room, defaulting to surfaceView"
  );
  assert.equal(
    playerScreenSource.includes('surfaceType="textureView"'),
    false,
    "no unconditional textureView may remain"
  );
});

test("a stream that freezes mid-film is watched for, reloaded, and re-resolved for a fresh link", () => {
  // Past Lives (HDFilm, 2026-11-19) sat on the buffering spinner: the CDN went
  // quiet without an error, so the error-only recovery never ran. HDFilm's own
  // web player has a "position has not moved" watchdog for the same reason.
  const source = fs.readFileSync(playerScreenPath, "utf8");

  // The watchdog samples the position and recovers the way an error does.
  assert.equal(source.includes("nextStallWatch(watch, { position, expectingProgress, now: Date.now() })"), true);
  assert.equal(source.includes('expectingProgress = videoPlayer.status === "loading" || videoPlayer.playing === true;'), true);
  assert.equal(source.includes('recoverCurrentStream("freeze");'), true);
  // A watch room drives playback itself.
  assert.equal(source.includes("if (!videoPlayer || !isNativeStreamSource || route.params.watchRoomCode) return;"), true);

  // When reloading cannot help, a fresh link is resolved and playback resumes where it stopped.
  assert.equal(source.includes("const refreshStreamAtPosition = useCallback("), true);
  // …and at once when the link has expired or the CDN refuses it (410, 403).
  assert.equal(source.includes('linkExpired: isStreamLinkExpired(directStreamUrl) || failure === "gone",'), true);
  // A rate-limited CDN (429) is given a pause before the reload.
  assert.equal(source.includes("const delay = reloadDelayMs(failure, plan.state.attempts);"), true);
  assert.equal(source.includes("if (delay > 0) streamReloadTimerRef.current = setTimeout(reload, delay);"), true);
  assert.equal(source.includes("if (resumeAt > 1) pendingResumeSecondsRef.current = resumeAt;"), true);
  assert.equal(source.includes("videoPlayer.currentTime = resumeAt;"), true);

  // No re-resolve may be answered with the remembered link that just failed.
  const occurrences = source.split("forgetResolvedStream(").length - 1;
  assert.ok(occurrences >= 3, `silent retry, fresh link and Retry must each forget the failed link (found ${occurrences})`);
});

test("an HDFilm failure with the other providers already asked fails the title instead of hanging", () => {
  // recoverFromHdFilmFailure returned silently when it had already run for the
  // source, after the caller had put the loader up: a spinner with nothing
  // behind it. It now says so, and both callers fall through to the error.
  const source = fs.readFileSync(playerScreenPath, "utf8");
  assert.equal(source.includes("const recoverFromHdFilmFailure = useCallback((reason: string): boolean => {"), true);
  assert.equal(source.includes("if (hdfilmRecoveryTriggeredRef.current) return false;"), true);
  assert.equal(source.includes('prev.webViewFallbackUrl && recoverFromHdFilmFailure("native_stall")'), true);
  assert.equal(source.includes('recoverFromHdFilmFailure(ev.error?.message ?? "native_error")'), true);
  // The silent retry reports what the player actually said.
  assert.equal(source.includes('failPlayableTitle("hdfilm_no_alternative", reason);'), true);
  assert.equal(source.includes("...(cause ? { cause: cause.slice(0, 160) } : {}),"), true);
});
