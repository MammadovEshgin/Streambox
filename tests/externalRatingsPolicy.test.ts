import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldFetchExternalRatings } from "../src/services/externalRatingsPolicy";

describe("externalRatingsPolicy", () => {
  it("allows detail-page external ratings", () => {
    assert.equal(shouldFetchExternalRatings("detail", {}), true);
  });

  it("blocks list external ratings by default", () => {
    assert.equal(shouldFetchExternalRatings("list", {}), false);
  });

  it("allows list external ratings only when explicitly enabled", () => {
    assert.equal(
      shouldFetchExternalRatings("list", { EXPO_PUBLIC_ENABLE_LIST_EXTERNAL_RATINGS: "1" }),
      true
    );
    assert.equal(
      shouldFetchExternalRatings("list", { EXPO_PUBLIC_ENABLE_LIST_EXTERNAL_RATINGS: "true" }),
      true
    );
  });

  it("blocks background external ratings", () => {
    assert.equal(
      shouldFetchExternalRatings("background", { EXPO_PUBLIC_ENABLE_LIST_EXTERNAL_RATINGS: "1" }),
      false
    );
  });
});
