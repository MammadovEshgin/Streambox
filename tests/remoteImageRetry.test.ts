import assert from "node:assert/strict";
import test from "node:test";

import { getRemoteImageRetryDelay } from "../src/services/remoteImageRetry";

const POSTER = "https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg";

test("a poster that failed on the network is retried three times, each wait longer", () => {
  const error = "java.net.SocketTimeoutException: timeout";
  const delays = [0, 1, 2, 3].map((attempt) => getRemoteImageRetryDelay(POSTER, attempt, error));
  assert.deepEqual(delays.slice(0, 3).map((delay) => typeof delay), ["number", "number", "number"]);
  assert.ok(delays[0]! < delays[1]! && delays[1]! < delays[2]!);
  assert.equal(delays[3], null);
});

test("a missing image or a local file is not retried", () => {
  assert.equal(getRemoteImageRetryDelay(POSTER, 0, "HttpException: Not Found, status code: 404"), null);
  assert.equal(getRemoteImageRetryDelay("file:///data/poster.jpg", 0, "decode failed"), null);
});
