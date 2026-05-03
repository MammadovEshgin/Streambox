import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());
const playerScreenPath = path.join(rootPath, "src", "screens", "PlayerScreen.tsx");

test("player screen keeps direct playback native and cleans provider web fallbacks", () => {
  const playerScreenSource = fs.readFileSync(playerScreenPath, "utf8");
  assert.equal(playerScreenSource.includes("useVideoPlayer"), true);
  assert.equal(playerScreenSource.includes("<VideoView"), true);
  assert.equal(playerScreenSource.includes("YoutubeIframe"), true);
  assert.equal(playerScreenSource.includes("nativeControls"), true);
  assert.equal(playerScreenSource.includes("clearCache?.(true)"), true);
});
