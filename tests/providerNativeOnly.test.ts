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

test("the HDFilm WebView fallback is still the last resort, after every native tier", () => {
  const dizibalIndex = source.indexOf("resolveDirectWebPlayerFallback(request)");
  const webViewFallbackIndex = source.indexOf("if (hdfilmWebViewFallback) return hdfilmWebViewFallback");

  assert.ok(dizibalIndex > 0 && webViewFallbackIndex > 0);
  assert.ok(
    dizibalIndex < webViewFallbackIndex,
    "Dizibal (native) must be tried before falling back to the HDFilm WebView"
  );
});

// ---------------------------------------------------------------------------
// Dizipal's /ajax-token contract. It answers with {"t":"<hex>"} — the old code
// did String(data) on the parsed object and sent the literal "[object Object]",
// so every player-config POST returned "Invalid token" and no Dizipal title
// could produce a native stream.
// ---------------------------------------------------------------------------

test("the Dizipal CSRF token is parsed from JSON, not stringified", () => {
  assert.ok(source.includes("function parseDizipalToken"), "token parsing must be explicit");
  assert.equal(
    source.includes('typeof tokenResp.data === "string" ? tokenResp.data.trim() : String(tokenResp.data).trim()'),
    false,
    "String(object) yields '[object Object]' and is rejected as an invalid token"
  );
});

test("the player-config POST leaves cookies to the platform jar", () => {
  // Validation covers _ct + PHPSESSID + the DDoS-Guard __ddg* cookies. Setting
  // a Cookie header REPLACES the native jar for that request and drops the
  // rest, so the primary attempt must not set one.
  assert.equal(
    source.includes("Cookie: `_ct=${csrfToken}`"),
    false,
    "hand-setting the cookie header drops PHPSESSID and the DDoS-Guard cookies"
  );
  assert.ok(source.includes("withCredentials: true"), "the native cookie jar must be used");
});

test("a fresh token is minted for every player-config attempt", () => {
  // The token is single-use: replaying one always fails.
  const configFn = source.slice(
    source.indexOf("async function requestDizipalPlayerConfig"),
    source.indexOf("async function fetchDizipalStreamUrl")
  );
  const mintCalls = configFn.match(/await mintToken\(\)/g) ?? [];
  assert.equal(mintCalls.length, 2, "both the first attempt and the retry need their own token");
});
