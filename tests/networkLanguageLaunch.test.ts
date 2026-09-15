import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(rootPath, ...segments), "utf8");
}

// ---------------------------------------------------------------------------
// Bakcell: the proxy's workers.dev host is unreachable from that carrier, so
// every TMDB request needs a second host to fall back to.
// ---------------------------------------------------------------------------

test("TMDB requests fail over to the proxy's custom domain on a network-level error", () => {
  const tmdb = readSource("src", "api", "tmdb.ts");

  assert.match(tmdb, /const TMDB_PROXY_CUSTOM_DOMAIN_ORIGIN = "https:\/\/tmdb\.streamboxapp\.stream";/);
  // Every request is pinned to one of the hosts...
  assert.match(tmdb, /nextConfig\.baseURL = tmdbProxyBaseUrls\[baseIndex\]/);
  // ...and only a missing response (not an HTTP status) moves it to the other.
  assert.match(tmdb, /if \(usesTmdbProxy && config && !status && !axios\.isCancel\(error\) && tmdbProxyBaseUrls\.length > 1\)/);
  // The failover runs before the same-host transient retries.
  assert.ok(
    tmdb.indexOf("config._tmdbProxyBasesTried = triedIndexes") < tmdb.indexOf("if (config && isTransientTmdbError(status))"),
    "failover must come before spending retries on a blocked host"
  );
  // The host that answered is remembered across launches.
  assert.match(tmdb, /rememberTmdbProxyBase\(nextIndex\)/);
});

// ---------------------------------------------------------------------------
// Language: a hydrate request must fetch the language its cache key names.
// ---------------------------------------------------------------------------

test("summary fetches pin the language used for both the cache key and the request", () => {
  const tmdb = readSource("src", "api", "tmdb.ts");
  const hydration = readSource("src", "services", "mediaHydration.ts");

  for (const [name, path] of [["getMovieSummary", "movie"], ["getSeriesSummary", "tv"]] as const) {
    const body = tmdb.slice(tmdb.indexOf(`export async function ${name}(`));
    assert.match(body, /^export async function \w+\(id: number, language\?: AppLanguage\)/);
    assert.match(body.slice(0, 900), /getLocalizedTmdbCacheKey\("[a-z-]+", id, locale\)/);
    assert.match(body.slice(0, 900), new RegExp(`\\/${path}\\/\\$\\{id\\}\`, \\{\\s*params: \\{ language: locale \\}`));
  }

  assert.match(hydration, /getMovieSummary\(numericId, language\)/);
  assert.match(hydration, /getSeriesSummary\(numericId, language\)/);
  // The cache that could hold wrong-language items is not read any more.
  assert.equal(hydration.includes('const PERSISTENT_HYDRATION_PREFIX = "@streambox/media-hydration-v1:"'), false);
});

// ---------------------------------------------------------------------------
// Launch: the app tree mounts once the splash has stopped moving.
// ---------------------------------------------------------------------------

test("the app tree mounts after the splash motion and the splash waits for it to paint", () => {
  const app = readSource("App.tsx");
  const splash = readSource("src", "components", "common", "LaunchSplash.tsx");

  assert.match(app, /const CONTENT_MOUNT_GATE_MS = LAUNCH_SPLASH_MOTION_END_MS;/);
  assert.match(splash, /export const LAUNCH_SPLASH_MOTION_END_MS = MOVE_START \+ MOVE_MS;/);
  assert.match(app, /<LaunchSplash onComplete=\{handleSplashComplete\} canReveal=\{revealTargetPainted\} \/>/);
  // No spinning loader under the opaque splash.
  assert.match(app, /showLoadingFallback \? \(splashComplete \? <SplashLoading \/> : <SplashBackdrop \/>\) : null/);
});

// ---------------------------------------------------------------------------
// Playback: resume a stalled stream with enough buffer to keep playing.
// ---------------------------------------------------------------------------

test("the native player waits for a few seconds of buffer before resuming", () => {
  const player = readSource("src", "screens", "PlayerScreen.tsx");
  const match = player.match(/player\.bufferOptions = \{\s*preferredForwardBufferDuration: (\d+),\s*minBufferForPlayback: (\d+),/);
  assert.ok(match, "PlayerScreen must set bufferOptions on the native player");
  assert.ok(Number(match[2]) >= 3, "resuming on expo-video's 2s default is what stalled again straight away");
  assert.ok(Number(match[1]) >= Number(match[2]));
});
