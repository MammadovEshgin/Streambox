import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());
const webPlayerServicePath = path.join(rootPath, "src", "services", "WebPlayerService.ts");
const playerScreenPath = path.join(rootPath, "src", "screens", "PlayerScreen.tsx");

test("TV resolver branches to a native-only path and never returns WebView sources", () => {
  // The TV build flow must never surface `hdfilm`, `dizipal`, or `dizipal_embed`
  // sources, because Android TV has no usable focus/touch model for our WebView
  // overlays. resolveWebPlayerUrl must short-circuit into a native-only resolver
  // when isTvBuild() is true.
  const source = fs.readFileSync(webPlayerServicePath, "utf8");

  assert.equal(source.includes("resolveTvNativeUrl"), true,
    "expected a dedicated TV resolver function");
  assert.match(source, /if \(isTvBuild\(\)\)\s*{[\s\S]*?return resolveTvNativeUrl\(request\);/,
    "resolveWebPlayerUrl must short-circuit to resolveTvNativeUrl on TV builds");

  // The TV resolver body must never produce non-native source strings.
  const tvFnStart = source.indexOf("async function resolveTvNativeUrl");
  const tvFnEnd = source.indexOf("export async function resolveWebPlayerUrl", tvFnStart);
  assert.notEqual(tvFnStart, -1, "resolveTvNativeUrl function not found");
  assert.notEqual(tvFnEnd, -1, "resolveWebPlayerUrl boundary not found");
  const tvFnBody = source.slice(tvFnStart, tvFnEnd);

  assert.equal(tvFnBody.includes('source: "hdfilm"'), false,
    "TV resolver must not emit a hdfilm WebView source");
  assert.equal(tvFnBody.includes('source: "dizipal"'), false,
    "TV resolver must not emit a dizipal WebView source");
  assert.equal(tvFnBody.includes('source: "dizipal_embed"'), false,
    "TV resolver must not emit a dizipal_embed WebView source");
});

test("PlayerScreen defensively coerces unexpected WebView sources to not_found on TV", () => {
  // Even if a future refactor of the resolver accidentally returns a WebView
  // source on TV, the screen must refuse to render it — TV users would see a
  // blank, unfocusable WebView instead of the "Not Available" message.
  const source = fs.readFileSync(playerScreenPath, "utf8");

  assert.match(
    source,
    /isTvBuild\(\)\s*&&\s*\(result\.source\s*===\s*"hdfilm"[\s\S]*?dizipal_embed[\s\S]*?not_found/,
    "expected a TV guard that coerces WebView sources to not_found"
  );
});
