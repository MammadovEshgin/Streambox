import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(rootPath, ...segments), "utf8");
}

test("watch-memory uploads stay native and cancel timed-out responder work", () => {
  const source = readSource("src", "services", "watchMemories.ts");
  assert.equal(source.includes("createSignedUploadUrl"), true);
  assert.equal(source.includes("createUploadTask"), true);
  assert.equal(source.includes("cancelAsync"), true);
  assert.equal(source.includes("readAsStringAsync"), false);
  assert.equal(source.includes("decode(base64)"), false);
});

test("room transport checks acknowledged sends and runs a liveness probe", () => {
  const source = readSource("src", "services", "watchRoomService.ts");
  assert.equal(source.includes("broadcast: { self: false, ack: true }"), true);
  assert.equal(source.includes('event: "liveness"'), true);
  assert.equal(source.includes('result !== "ok"'), true);
  assert.equal(source.includes("watchRoomReconnectDelayMs"), true);
});

test("watch-together overlays stay in-layer and have room-scoped recovery", () => {
  const layerSource = readSource("src", "components", "watchTogether", "WatchRoomLayer.tsx");
  const playerSource = readSource("src", "screens", "PlayerScreen.tsx");
  assert.equal(layerSource.includes("<Modal"), false);
  assert.equal(layerSource.includes("deriveWatchRoomPresenceUiState"), true);
  assert.equal(layerSource.includes("canStartWatchRoomCapture"), true);
  assert.equal(playerSource.includes("<WatchRoomBoundary"), true);
});
