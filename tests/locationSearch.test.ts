import test from "node:test";
import assert from "node:assert/strict";

import { getLocalLocationSuggestions, normalizeLocationLabel } from "../src/services/locationSearch";

test("returns ranked city suggestions for partial queries", () => {
  const suggestions = getLocalLocationSuggestions("bak");

  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0], "Baku, Azerbaijan");
});

test("returns empty suggestions for short queries", () => {
  assert.deepEqual(getLocalLocationSuggestions("a"), []);
});

test("deduplicates repeated location parts", () => {
  assert.equal(normalizeLocationLabel(["Baku", "Baku", "Azerbaijan"]), "Baku, Azerbaijan");
  assert.equal(normalizeLocationLabel(["Singapore", "Singapore"]), "Singapore");
});

test("local fallback suggestions only keep city and country", () => {
  const suggestions = getLocalLocationSuggestions("san");

  assert.ok(suggestions.includes("San Francisco, United States"));
  assert.ok(suggestions.includes("San Diego, United States"));
  assert.ok(suggestions.includes("San Antonio, United States"));
});
