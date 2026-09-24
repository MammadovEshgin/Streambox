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
    source.includes("if (!dizipalResult?.stream) return null;"),
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
// Dizipal's player config. The page's data-cfg is a single-use token bound to
// the PHP session that rendered the page (dizipal2134, 2026-09-25); the POST
// rides that session, and /ajax-token is not needed.
// ---------------------------------------------------------------------------

test("the player-config POST leaves cookies to the platform jar", () => {
  // The token is bound to the page's PHPSESSID. Setting a Cookie header
  // REPLACES the native jar for that request, so the primary attempt must not
  // set one; only the retry names the session explicitly.
  assert.equal(
    source.includes("Cookie: `_ct=${csrfToken}`"),
    false,
    "hand-setting the cookie header drops PHPSESSID and the DDoS-Guard cookies"
  );
  assert.ok(source.includes("withCredentials: true"), "the native cookie jar must be used");
});

test("a rejected data-cfg is never replayed: the retry re-reads the page", () => {
  // The token is single-use; replaying one always answers "Invalid token".
  const streamFn = source.slice(
    source.indexOf("async function fetchDizipalStreamUrl"),
    source.indexOf("function matchesDizipalEpisodeUrl")
  );
  assert.match(streamFn, /for \(let attempt = 0; attempt < 2 && !configResp\?\.success; attempt\+\+\) \{\s*const page = await fetchDizipalPlayerPage\(pageUrl\);/);
  assert.equal(source.includes("${baseUrl}/ajax-token"), false, "no token mint on the critical path");
});
