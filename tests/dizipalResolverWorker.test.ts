import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { __internal } from "../workers/dizipal-resolver/src/index.js";

const {
  absolutise,
  extractPlayerToken,
  extractSubtitles,
  isProxyableUrl,
  normaliseBase,
  parsePlayerConfig,
  pickBestVariant,
} = __internal;

test("only a dizipalN origin may be named as the base", () => {
  assert.equal(normaliseBase("https://dizipal2221.com/dizi/x"), "https://dizipal2221.com");
  assert.equal(normaliseBase("https://www.dizipal2221.com"), "https://www.dizipal2221.com");
  // An open resolver would fetch anything the caller names.
  assert.equal(normaliseBase("https://evil.example/"), null);
  assert.equal(normaliseBase("http://dizipal2221.com"), null, "plain http is not the site");
  assert.equal(normaliseBase("not a url"), null);
});

test("the player blob is read exactly as the page writes it", () => {
  const blob = '{&quot;ciphertext&quot;:&quot;YWJj&quot;,&quot;iv&quot;:&quot;00&quot;,&quot;salt&quot;:&quot;aa&quot;}';
  assert.deepEqual(parsePlayerConfig(blob), { ciphertext: "YWJj", iv: "00", salt: "aa" });
  assert.equal(parsePlayerConfig('{"iv":"00","salt":"aa"}'), null, "a blob without ciphertext is not a config");
  assert.equal(parsePlayerConfig("not json"), null);
  assert.equal(parsePlayerConfig("x".repeat(20_001)), null, "an oversized body is refused before parsing");
});

test("the site's own decryption is reproduced exactly (PBKDF2-SHA512/999 + AES-256-CBC)", async () => {
  // `oyunculistdc()` in the site's pageload.js. Encrypt here, decrypt in the
  // Worker: if either side's parameters drift, every Dizipal title goes dead.
  const passphrase = "a-passphrase-the-site-rotates";
  const playerUrl = "//four.dplayer82.site/iframe.php?v=62d045908c58ee6f481d113712733d49&dp=1";
  const salt = crypto.randomBytes(48);
  const iv = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(passphrase, salt, 999, 32, "sha512");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const ciphertext = Buffer.concat([cipher.update(playerUrl, "utf8"), cipher.final()]).toString("base64");

  const source = fs.readFileSync(
    path.join(process.cwd(), "workers", "dizipal-resolver", "src", "index.js"),
    "utf8"
  );
  // decryptPlayerUrl is not exported (nothing else may call it), so drive the
  // same WebCrypto path the Worker takes and assert the numbers it uses.
  assert.match(source, /iterations: 999, hash: "SHA-512"/);
  assert.match(source, /deriveBits\(\s*\{ name: "PBKDF2"/s);
  assert.match(source, /"AES-CBC"/);

  const material = await crypto.webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 999, hash: "SHA-512" },
    material,
    256
  );
  const aes = await crypto.webcrypto.subtle.importKey("raw", bits, "AES-CBC", false, ["decrypt"]);
  const plain = await crypto.webcrypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    aes,
    Buffer.from(ciphertext, "base64")
  );
  assert.equal(new TextDecoder().decode(plain), playerUrl);
  assert.equal(absolutise(playerUrl), "https://four.dplayer82.site/iframe.php?v=62d045908c58ee6f481d113712733d49&dp=1");
});

test("the player page's token and subtitles are read out of openPlayer()", () => {
  const html = `<script>
    window.openPlayer = function (playList, reqHash) {};
    openPlayer('UzFsMDZVanFFd3hpcUovRzJI', 'hash', 'https://vast', '', '', '', 0, '', '', 0, true, '', '', '', 'TR', 'android', '', '', '', [{"file":"https:\\/\\/lkm.x9.cfd\\/f/1/tr.vtt?sp=3","label":"T\\u00fcrk\\u00e7e","kind":"captions","lang":"tr","default":true},{"file":"https://lkm.x9.cfd/f/1/en.vtt","label":"İngilizce","kind":"captions","lang":"en","default":false}]);
  </script>`;

  assert.equal(extractPlayerToken(html), "UzFsMDZVanFFd3hpcUovRzJI");
  assert.deepEqual(extractSubtitles(html), [
    { url: "https://lkm.x9.cfd/f/1/tr.vtt?sp=3", label: "Türkçe", lang: "tr" },
    { url: "https://lkm.x9.cfd/f/1/en.vtt", label: "İngilizce", lang: "en" },
  ]);

  assert.equal(extractPlayerToken("<script>nothing here</script>"), null);
  assert.deepEqual(extractSubtitles("<script>openPlayer('t');</script>"), []);
});

test("the best variant is the one with the most bandwidth", () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="Türkçe",URI="https://four.dplayer82.site/ld.php?v=a"',
    "#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,NAME=HD",
    "https://four.dplayer82.site/l.php?v=hd",
    "#EXT-X-STREAM-INF:BANDWIDTH=2750000,RESOLUTION=1920x1080,NAME=FHD",
    "https://four.dplayer82.site/l.php?v=fhd",
  ].join("\n");

  assert.equal(
    pickBestVariant(master, "https://four.dplayer82.site/master.m3u8?v=x"),
    "https://four.dplayer82.site/l.php?v=fhd"
  );
  assert.equal(pickBestVariant("#EXTM3U\n", "https://four.dplayer82.site/master.m3u8"), null);
});

test("the proxy is not an open one: only this chain's hosts and paths", () => {
  // Playlists on the player host, subtitles on its CDN.
  assert.equal(isProxyableUrl("https://four.dplayer82.site/l.php?v=x"), true);
  assert.equal(isProxyableUrl("https://four.dplayer82.site/master.m3u8?v=x"), true);
  assert.equal(isProxyableUrl("https://lkm-h1c2wv.mal6xbdls8.cfd/f/1/2/tr.vtt?sp=3"), true);

  // Segments are the bytes: the device fetches those itself, always.
  assert.equal(isProxyableUrl("https://lkm-h1c2wv.mal6xbdls8.cfd/f/1/m/a/92acd.jpg"), false);
  // And nothing else at all.
  assert.equal(isProxyableUrl("https://evil.example/anything.m3u8"), false);
  assert.equal(isProxyableUrl("http://four.dplayer82.site/l.php?v=x"), false);
  assert.equal(isProxyableUrl("https://four.dplayer82.site/admin.php"), false);
  assert.equal(isProxyableUrl("garbage"), false);
});
