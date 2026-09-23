import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());
const webPlayerServicePath = path.join(rootPath, "src", "services", "WebPlayerService.ts");
const source = fs.readFileSync(webPlayerServicePath, "utf8");

// ---------------------------------------------------------------------------
// Playback must land in a player WE control — expo-video natively, or the
// app-owned hls.js surface. The provider page/embed shells render the site's
// own Playerjs with its pre-rolls and its own controls, and unlike the HDFilm
// WebView (which injects a discovery script and hands off to expo-video) they
// have no route back to native. These tests fail if that path is reintroduced.
// ---------------------------------------------------------------------------

test("Dizipal page and embed shells are never returned as playable results", () => {
  assert.equal(
    source.includes('source: "dizipal_embed"'),
    false,
    "a Dizipal embed shell puts the user in the provider's own player"
  );
  assert.equal(
    /return \{ url: pageUrl, source: "dizipal", qualityWarning \}/.test(source),
    false,
    "a Dizipal page shell puts the user in the provider's own player"
  );
});

test("Dizipal only resolves when a real stream was extracted", () => {
  assert.ok(
    source.includes("if (dizipalResult?.stream)"),
    "the resolver must require an extracted stream, not just a reachable page"
  );
  assert.equal(
    source.includes("hasPlayableDizipalVideo"),
    false,
    "the 'page looks playable' consolation path must stay deleted"
  );
});

test("the resolver never returns HDFilm's page player — native or Not Available", () => {
  // An HDFilm page whose decoder yielded nothing used to be kept as a
  // last-resort result, which showed hdfilmcehennemi's own player ("Neagley",
  // 2026-09-20). Only an extracted stream may come out of the HDFilm tier.
  assert.equal(source.includes("hdfilmWebViewFallback"), false, "the deferred page result must stay deleted");
  const inner = source.slice(
    source.indexOf("async function resolveWebPlayerUrlInner"),
    source.indexOf("export async function resolveNativeAlternativeToHdFilm")
  );
  assert.match(inner, /const considerHdFilmResult = \(result: WebPlayerResult\): WebPlayerResult \| null =>\s*result\.streamUrl \? result : null;/);
  assert.equal(/source: "hdfilm"/.test(inner), false, "no page result may be built in the orchestration");
});

// ---------------------------------------------------------------------------
// Dizipal's player chain, after the Sept-2026 rebuild.
//
// The site's CSRF token, its /ajax player-config POST and the cookie handling
// around them all belonged to a site that no longer exists: the watch page now
// carries one encrypted blob, and only the resolver Worker can open it.
// ---------------------------------------------------------------------------

test("the encrypted player blob is handed to the resolver, not opened on device", () => {
  assert.ok(source.includes("function extractDizipalPlayerBlob"), "the blob must be read from the page");
  assert.ok(
    source.includes("async function resolveDizipalStreamViaWorker"),
    "and resolved through the Worker that Dizipal's firewall lets through"
  );
  assert.equal(
    /await mintToken\(\)|ajax-token|DIZIPAL_PLAYER_CONFIG_PATHS/.test(source),
    false,
    "the retired /ajax token dance must not come back"
  );
});

test("a Dizipal stream is only ever a stream the Worker returned", () => {
  const fn = source.slice(
    source.indexOf("async function fetchDizipalStreamUrl"),
    source.indexOf("function matchesDizipalEpisodeUrl")
  );
  assert.match(fn, /const stream = await resolveDizipalStreamViaWorker\(cfg, pageUrl\);/);
  assert.match(fn, /return stream \? \{ stream, embedUrl: null \} : null;/);
});
