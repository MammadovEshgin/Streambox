import assert from "node:assert/strict";
import test from "node:test";

import {
  __adoptBaselineForTests,
  __resetProviderConfigsForTests,
  getProviderConfig,
  normaliseDizipalBaseUrl,
  parseDizipalSuffix,
  recordObservedBaseUrl,
  type ProviderConfigMap,
} from "../src/services/providerConfigService";

// The service's debugLog reads the Metro-injected __DEV__ global, which node
// doesn't define. It is only read at call time, so setting it here is enough
// to keep the module's log lines inert.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const HDFILM = { baseUrl: "https://www.hdfilmcehennemi.nl", referer: "https://www.hdfilmcehennemi.nl/" };
const DIZIBAL = { baseUrl: "https://dizibal.org", referer: "https://dizibal.org/" };

function baseline(dizipalBaseUrl: string): ProviderConfigMap {
  return {
    hdfilm: { ...HDFILM },
    dizipal: { baseUrl: dizipalBaseUrl, referer: `${dizipalBaseUrl}/` },
    dizibal: { ...DIZIBAL },
  };
}

test("Dizipal host suffixes parse, and non-Dizipal hosts don't", () => {
  assert.equal(parseDizipalSuffix("https://dizipal2079.com"), 2079);
  assert.equal(parseDizipalSuffix("https://dizipal2123.com/"), 2123);
  assert.equal(parseDizipalSuffix("https://resmi.dizipal2117.com"), 2117);
  assert.equal(parseDizipalSuffix("https://dizibal.org"), null);
  assert.equal(parseDizipalSuffix("https://dizipalmoz8.vip"), null);
  assert.equal(parseDizipalSuffix("not a url"), null);
});

test("a Dizipal base older than the shipped one is replaced, a newer one is kept", () => {
  // Rotation only moves forward, so a lower suffix is always a redirect chain
  // we can skip. The live chain from 2079 to 2123 was 22 hops — past axios'
  // 21-redirect ceiling, i.e. Dizipal fully down, not merely slow.
  const stale = normaliseDizipalBaseUrl("https://dizipal2079.com");
  assert.ok(stale, "an older suffix must be normalised forward");
  assert.equal(parseDizipalSuffix(stale.baseUrl)! >= 2123, true);
  assert.equal(stale.referer, `${stale.baseUrl}/`);

  // Once the operator gets ahead of the shipped fallback, remote must win.
  assert.equal(normaliseDizipalBaseUrl("https://dizipal9999.com"), null);
  assert.equal(normaliseDizipalBaseUrl("https://dizibal.org"), null);
});

test("a self-healed origin survives a refresh that republishes the same base", () => {
  __resetProviderConfigsForTests();
  __adoptBaselineForTests(baseline("https://dizipal9990.com"));

  recordObservedBaseUrl("dizipal", "https://dizipal9995.com/dizi/mezarlik");
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9995.com");

  // The bot hasn't caught up: Supabase still publishes the old base. Before
  // this, refreshProviderConfigs() overwrote the pin, so the "refresh then
  // retry" path in resolveWebPlayerUrl re-walked the whole redirect chain.
  __adoptBaselineForTests(baseline("https://dizipal9990.com"));
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9995.com");
  assert.equal(getProviderConfig("dizipal").referer, "https://dizipal9995.com/");
});

test("a self-healed origin is dropped as soon as the operator publishes a new base", () => {
  __resetProviderConfigsForTests();
  __adoptBaselineForTests(baseline("https://dizipal9990.com"));
  recordObservedBaseUrl("dizipal", "https://dizipal9995.com");
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9995.com");

  // Operator rotates. Remote is now authoritative again — the pin must not be
  // able to strand this device on a domain the operator has moved off.
  __adoptBaselineForTests(baseline("https://dizipal9997.com"));
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9997.com");
});

test("self-heal refuses foreign origins and never pins backwards", () => {
  __resetProviderConfigsForTests();
  __adoptBaselineForTests(baseline("https://dizipal9995.com"));

  recordObservedBaseUrl("dizipal", "https://evil.example.com");
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9995.com");

  // An absolute link inside a cached page can point at an older domain;
  // adopting it would re-introduce the redirect chain we just escaped.
  recordObservedBaseUrl("dizipal", "https://dizipal9991.com");
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9995.com");

  recordObservedBaseUrl("dizipal", "https://dizipal9996.com");
  assert.equal(getProviderConfig("dizipal").baseUrl, "https://dizipal9996.com");
});

test("dizibal.com is mapped forward to the live .org host", () => {
  __resetProviderConfigsForTests();
  __adoptBaselineForTests({
    hdfilm: { ...HDFILM },
    dizipal: { baseUrl: "https://dizipal9995.com", referer: "https://dizipal9995.com/" },
    dizibal: { ...DIZIBAL },
  });
  // The self-heal path accepts .org for .com because both are the dizibal
  // family; the published-config path is covered by STALE_PROVIDER_BASE_URLS.
  recordObservedBaseUrl("dizibal", "https://dizibal.org/api/series");
  assert.equal(getProviderConfig("dizibal").baseUrl, "https://dizibal.org");
});
