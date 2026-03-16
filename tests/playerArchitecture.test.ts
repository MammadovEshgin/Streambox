import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());
const playerScreenPath = path.join(rootPath, "src", "screens", "PlayerScreen.tsx");
const customUiPath = path.join(rootPath, "src", "components", "player", "CustomPlayerUI.tsx");

test("player screen uses custom controls and does not embed web rendering primitives", () => {
  const playerScreenSource = fs.readFileSync(playerScreenPath, "utf8");
  const customUiSource = fs.readFileSync(customUiPath, "utf8");
  const merged = `${playerScreenSource}\n${customUiSource}`.toLowerCase();

  assert.equal(merged.includes("webview"), false);
  assert.equal(merged.includes("iframe"), false);
  assert.equal(playerScreenSource.includes("useNativeControls={false}"), true);
});
