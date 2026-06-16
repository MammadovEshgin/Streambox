import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());
const playerScreenPath = path.join(rootPath, "src", "screens", "PlayerScreen.tsx");
const webviewInjectionPath = path.join(rootPath, "src", "screens", "player", "webviewInjection.ts");

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
