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
