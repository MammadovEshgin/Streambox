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
  assert.equal(source.includes("if (hasStarted && recoverCurrentStream(ev.error?.message)) return;"), true);
  assert.equal(source.includes("const recoverCurrentStream = useCallback("), true);
  assert.equal(source.includes("MAX_STREAM_RECOVERY_ATTEMPTS"), true);
  assert.equal(source.includes("streamRecoveryAttemptsRef"), true);

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
