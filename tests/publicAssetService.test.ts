import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAbsoluteAssetUrl, resolvePublicAssetUrl } from "../src/services/publicAssetService";

describe("publicAssetService", () => {
  it("keeps absolute URLs unchanged", () => {
    assert.equal(
      resolvePublicAssetUrl("https://cdn.example.com/a.webp", {
        EXPO_PUBLIC_STREAMBOX_ASSET_BASE_URL: "https://assets.streamboxapp.stream",
      }),
      "https://cdn.example.com/a.webp"
    );
  });

  it("resolves relative paths against the configured Cloudflare asset base", () => {
    assert.equal(
      resolvePublicAssetUrl("/announcements/new-feature.webp", {
        EXPO_PUBLIC_STREAMBOX_ASSET_BASE_URL: "https://assets.streamboxapp.stream/",
      }),
      "https://assets.streamboxapp.stream/announcements/new-feature.webp"
    );
  });

  it("returns the original relative path if no base URL is configured", () => {
    assert.equal(resolvePublicAssetUrl("announcements/a.webp", {}), "announcements/a.webp");
  });

  it("normalizes blank values to null", () => {
    assert.equal(resolvePublicAssetUrl("  ", {}), null);
    assert.equal(resolvePublicAssetUrl(null, {}), null);
  });

  it("detects protocol-relative and data URLs as absolute assets", () => {
    assert.equal(isAbsoluteAssetUrl("//cdn.example.com/a.webp"), true);
    assert.equal(isAbsoluteAssetUrl("data:image/png;base64,abc"), true);
  });
});
