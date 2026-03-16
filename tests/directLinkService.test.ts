import assert from "node:assert/strict";
import test from "node:test";

import { __internal } from "../src/services/DirectLinkService";

test("extracts direct playable URLs from mixed payloads", () => {
  const payload = {
    data: {
      sources: [
        { file: "https://cdn.example.com/movie-title-1080p.m3u8" },
        { file: "https://cdn.example.com/movie-title-720p.mp4" }
      ]
    }
  };

  const candidates = __internal.extractStreamCandidatesFromPayload(payload, "provider-a", 180);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.providerId, "provider-a");
  assert.equal(candidates[0]?.latencyMs, 180);
});

test("flags CAM/TS/HC style source labels as blocked", () => {
  assert.equal(__internal.containsBlockedMarker("movie.HDCAM.1080p.m3u8"), true);
  assert.equal(__internal.containsBlockedMarker("movie.TS.720p.mp4"), true);
  assert.equal(__internal.containsBlockedMarker("movie.HC.subs.1080p.m3u8"), true);
  assert.equal(__internal.containsBlockedMarker("movie.WEB-DL.1080p.m3u8"), false);
});

test("parses HLS manifest metadata and resolves highest quality stream", () => {
  const manifest = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,FRAME-RATE=24.000',
    "720p.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=5400000,RESOLUTION=1920x1080,FRAME-RATE=24.000',
    "1080p.m3u8"
  ].join("\n");

  const metadata = __internal.parseHlsManifestMetadata(manifest);

  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
  assert.equal(metadata.qualityLabel, "1080p");
  assert.equal(metadata.frameRate, 24);
});

test("marks inconsistent frame-rate streams as invalid candidates", () => {
  assert.equal(__internal.isFrameRateConsistent([23.98, 24]), true);
  assert.equal(__internal.isFrameRateConsistent([23.98, 47.95]), false);
});

test("requires at least 720p unless a trusted quality marker is present", () => {
  assert.equal(__internal.meetsMinimumQuality(1080, "normal"), true);
  assert.equal(__internal.meetsMinimumQuality(480, "low"), false);
  assert.equal(__internal.meetsMinimumQuality(null, "movie.WEB-DL"), true);
});
