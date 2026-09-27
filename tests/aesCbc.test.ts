import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { aesCbcDecrypt } from "../src/services/aesCbc";

test("aesCbcDecrypt matches Node's AES-CBC for every key size and padding length", () => {
  for (const keyBytes of [16, 24, 32]) {
    for (const length of [0, 1, 15, 16, 17, 47, 64]) {
      const key = crypto.randomBytes(keyBytes);
      const iv = crypto.randomBytes(16);
      const plain = crypto.randomBytes(length);
      const cipher = crypto.createCipheriv(`aes-${keyBytes * 8}-cbc`, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);

      const decrypted = aesCbcDecrypt(ciphertext, key, iv);
      assert.deepEqual(Buffer.from(decrypted ?? []), plain, `aes-${keyBytes * 8}, ${length} bytes`);
    }
  }
});

test("aesCbcDecrypt answers null for a wrong key or malformed input", () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const ciphertext = Buffer.concat([cipher.update("https://example.test/embed-abc.html"), cipher.final()]);

  // A wrong key almost always leaves invalid padding; a lucky 0x01 tail would
  // still decrypt to garbage, so only compare against the real plaintext.
  const wrong = aesCbcDecrypt(ciphertext, crypto.randomBytes(32), iv);
  assert.notEqual(wrong && Buffer.from(wrong).toString(), "https://example.test/embed-abc.html");
  assert.equal(aesCbcDecrypt(ciphertext.subarray(0, 20), key, iv), null);
  assert.equal(aesCbcDecrypt(ciphertext, key.subarray(0, 20), iv), null);
  assert.equal(aesCbcDecrypt(ciphertext, key, iv.subarray(0, 8)), null);
  assert.equal(aesCbcDecrypt(new Uint8Array(0), key, iv), null);
});
