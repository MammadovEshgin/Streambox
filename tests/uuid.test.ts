import assert from "node:assert/strict";
import test from "node:test";

import { generateUuidV4 } from "../src/utils/uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("generateUuidV4 produces RFC 4122 v4 ids", () => {
  for (let i = 0; i < 50; i += 1) {
    assert.match(generateUuidV4(), UUID_V4);
  }
});

test("generateUuidV4 is deterministic under a seeded random and still well-formed", () => {
  const seeded = () => 0.5;
  const id = generateUuidV4(seeded);
  assert.match(id, UUID_V4);
  assert.equal(id, generateUuidV4(seeded));
});

test("consecutive ids differ", () => {
  assert.notEqual(generateUuidV4(), generateUuidV4());
});
