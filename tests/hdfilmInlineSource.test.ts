import assert from "node:assert/strict";
import test from "node:test";

import { __internal } from "../src/services/WebPlayerService";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// HDFilm's /rplayer/ config since 2026-11: the stream is no longer a parts
// variable but an inline wrapper,
//   sources: [{file:(function(){ …guards…; return NAME("a~b~…".split("~")); })()}]
// with the decoder named afresh per request. Verity and The Dog Stars (2026),
// which only HDFilm carries, decoded to nothing.
// ---------------------------------------------------------------------------

const STREAM = "https://s231.rapidrame.com/hls2/01/00037/xdzfk1gjde24_,l,.urlset/master.m3u8?t=abc&s=1";
const RPLAYER = "https://www.hdfilmcehennemi.nl/rplayer/xdzfk1gjde24/";

// A decoder in the page's own style: one part is a key, the rest join into the payload.
const DECODER =
  "var q7x=function(p){var k=p.splice(1,1)[0];var s=p.join('');" +
  "if(k==='r'){s=s.split('').reverse().join('')}return atob(s)};";

function playerPage(options: { separator?: string; decoder?: string } = {}): string {
  const separator = options.separator ?? "~";
  const reversed = Buffer.from(STREAM, "latin1").toString("base64").split("").reverse().join("");
  const pieces = reversed.match(/.{1,9}/g) ?? [];
  pieces.splice(1, 0, "r");
  // The page writes the parts as a JS string literal, so "/" arrives as "\/".
  const literal = pieces.join(separator).replace(/\//g, "\\/");
  return [
    '<div id="pk" data-v="pwrR7JXNo" style="display:none" aria-hidden="true"></div><script>',
    options.decoder ?? DECODER,
    "var configs = {",
    " //sources: [{file:atob(file_link)}],",
    " sources: [{file:(function(){ if (typeof document==='undefined'||!document) return ''; " +
      "try{var e=document.getElementById('pk'); if(!e||e.getAttribute('data-v')!==\"pwrR7JXNo\"){return '';}}catch(x){return '';} " +
      `return q7x("${literal}".split("${separator}")); })()}],`,
    ' tracks: [{"file":"\\/srt\\/00037\\/xdzfk1gjde24_Turkish.vtt","label":"T\\u00fcrk\\u00e7e Altyaz\\u0131","language":"tr","kind":"captions"}],',
    ' type: "hls"',
    "};",
    'var player = jwplayer("player").setup(configs);',
    "</script>",
  ].join("\n");
}

test("the inline source wrapper is decoded by running the page's own decoder on its parts", () => {
  assert.equal(__internal.extractRapidrameStreamUrl(playerPage(), RPLAYER), STREAM);
});

test("the parts separator is whatever the page chose, and escaped slashes are restored", () => {
  // The Dog Stars' page split on "^" and its parts carried "\/".
  const page = playerPage({ separator: "^" });
  assert.ok(page.includes("\\/"), "the fixture must carry an escaped slash");
  assert.equal(__internal.extractRapidrameStreamUrl(page, RPLAYER), STREAM);
});

test("the decoder may be a declaration and its argument an array literal", () => {
  // Verity's page a minute later: `function qxj(p){…}` and `return qxj(["PW85","yeE8",…])`,
  // guarded through `document.querySelector('[data-v]')` instead of the #pk lookup.
  const pieces = Buffer.from(STREAM, "latin1").toString("base64").match(/.{1,7}/g) ?? [];
  const page = [
    '<div data-v="adU3FMKy" style="display:none"></div><script>',
    "function qxj(p){var s=p.join('');var k=\"bv\";if(k.length>4096){s=s.split('').reverse().join('')}return atob(s)}",
    "function law(){return btoa('x'+Math.random())}",
    "var configs = {",
    " //sources: [{file:atob(file_link)}],",
    " sources: [{file:(function(){ try{ if(typeof document==='undefined') return ''; var e=document.querySelector('[data-v]'); " +
      "if(!e||e.getAttribute('data-v')!==\"adU3FMKy\"){return '';} }catch(x){return '';} " +
      `return qxj([${pieces.map((piece) => JSON.stringify(piece)).join(",")}]); })()}],`,
    ' type: "hls"',
    "};",
    "</script>",
  ].join("\n");
  assert.equal(__internal.extractRapidrameStreamUrl(page, RPLAYER), STREAM);
});

test("an inline source whose decoder is not on the page yields no stream, not a wrong one", () => {
  assert.equal(__internal.extractRapidrameStreamUrl(playerPage({ decoder: "" }), RPLAYER), null);
});

test("captions still come from the same page", () => {
  assert.deepEqual(__internal.extractRapidrameSubtitles(playerPage(), RPLAYER), [
    { url: "https://www.hdfilmcehennemi.nl/srt/00037/xdzfk1gjde24_Turkish.vtt", label: "Türkçe Altyazı", lang: "tr" },
  ]);
});
