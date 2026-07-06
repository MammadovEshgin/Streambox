/**
 * check-hdfilm-resolver
 *
 * Self-healing health check for the HDFilmCehennemi (Rapidrame) stream decoder.
 *
 * WHY THIS EXISTS
 * ---------------
 * HDFilm hides the real stream URL inside an obfuscated `s_*` parts array on the
 * embed page, decoded by an inline `dc_*()` function that THE PROVIDER ROTATES.
 * When they rotate it, `RAPIDRAME_PRE_UNMIX_TRANSFORMS` in WebPlayerService no
 * longer matches and every HDFilm title silently falls back to the WebView
 * player (black screen for disguised-.jpg HLS uploads).
 *
 * WHAT THIS DOES
 * --------------
 *  1. HEALTH CHECK: resolves a few live titles with the CURRENT decoder and
 *     confirms each produces a URL that actually serves an HLS manifest.
 *  2. AUTO-DERIVE (only if the health check fails): brute-forces compositions of
 *     the provider's known primitives (reverse / base64 / rot13) against the live
 *     parts array, using a self-validating oracle — "does the decoded URL return
 *     a real #EXTM3U manifest?". Prints the recovered transform, and with --write
 *     inserts it at the front of RAPIDRAME_PRE_UNMIX_TRANSFORMS automatically.
 *
 * USAGE
 *   npm run check:hdfilm            # health check, exit 1 if broken
 *   npm run check:hdfilm -- --write # also auto-patch a newly derived scheme
 *
 * Designed to be run on a schedule (CI / cron). Network-only; mutates one source
 * file when --write is passed and a new scheme is found.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import axios from "axios";

import { __internal } from "../src/services/WebPlayerService";

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// Base URL is intentionally hardcoded here (not the runtime provider config) so
// the script has zero dependency on Supabase / AsyncStorage. Update if the
// provider domain moves — the health check will tell you when that happens.
const HDFILM_BASE = "https://www.hdfilmcehennemi.nl";
const HDFILM_REFERER = `${HDFILM_BASE}/`;

const SERVICE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "services",
  "WebPlayerService.ts"
);

/** A few well-seeded catalog titles. Used only to locate live embed pages. */
const PROBE_TITLES = [
  "Edge of Tomorrow",
  "The Devil Wears Prada 2",
  "Ready or Not Here I Come"
];

const shouldWrite = process.argv.includes("--write");

// ─── HTTP helpers ───────────────────────────────────────────────────────────

async function getText(url: string, referer: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: 20000,
      headers: { "User-Agent": UA, Referer: referer, Accept: "*/*" },
      transformResponse: [(d) => (typeof d === "string" ? d : String(d ?? ""))]
    });
    return data;
  } catch {
    return null;
  }
}

async function searchFirstPageUrl(title: string): Promise<string | null> {
  try {
    const { data } = await axios.get<{ results?: string[] }>(
      `${HDFILM_BASE}/search/?q=${encodeURIComponent(title)}`,
      {
        timeout: 15000,
        headers: {
          "X-Requested-With": "fetch",
          Accept: "application/json",
          "User-Agent": UA,
          Referer: HDFILM_REFERER
        }
      }
    );
    const first = data?.results?.[0];
    if (!first) return null;
    const href = first.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) return null;
    return new URL(href, HDFILM_BASE).toString();
  } catch {
    return null;
  }
}

function extractEmbedUrl(pageHtml: string, pageUrl: string): string | null {
  const m = pageHtml.match(/https?:\/\/[^"'\s]*hdfilmcehennemi\.mobi\/video\/embed\/[^"'\s]+/i);
  if (m) return m[0];
  const iframe = pageHtml.match(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1];
  return iframe ? new URL(iframe, pageUrl).toString() : null;
}

/** True if `url` actually serves an HLS manifest — the validation oracle. */
async function urlServesHlsManifest(url: string, referer: string): Promise<boolean> {
  const body = await getText(url, referer);
  return Boolean(body && body.includes("#EXTM3U"));
}

// ─── Embed parsing (mirrors WebPlayerService, kept local on purpose) ─────────

type EmbedParts = { parts: string[]; embedUrl: string; embedHtml: string };

function extractPartsArray(embedHtml: string): string[] | null {
  const varName = embedHtml.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*(s_[A-Za-z0-9_]+)/)?.[1];
  if (!varName) return null;
  const idx = embedHtml.indexOf(`var ${varName}`);
  if (idx === -1) return null;
  const snippet = embedHtml.slice(idx, idx + 2200);
  const arrayLiteral = snippet.match(/\[[\s\S]*?\]/)?.[0];
  if (!arrayLiteral) return null;
  try {
    const parts = JSON.parse(arrayLiteral);
    if (Array.isArray(parts) && parts.every((p) => typeof p === "string")) return parts;
  } catch {
    /* fall through */
  }
  return null;
}

async function fetchEmbedParts(title: string): Promise<EmbedParts | null> {
  const pageUrl = await searchFirstPageUrl(title);
  if (!pageUrl) return null;
  const pageHtml = await getText(pageUrl, HDFILM_REFERER);
  if (!pageHtml) return null;
  const embedUrl = extractEmbedUrl(pageHtml, pageUrl);
  if (!embedUrl) return null;
  const embedHtml = await getText(embedUrl, pageUrl);
  if (!embedHtml) return null;
  const parts = extractPartsArray(embedHtml);
  if (!parts) return null;
  return { parts, embedUrl, embedHtml };
}

// ─── Brute-force scheme recovery (primitives + self-validating oracle) ───────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decode(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "", buf = 0, bits = 0;
  for (const ch of cleaned) {
    if (ch === "=") break;
    const i = B64.indexOf(ch);
    if (i === -1) continue;
    buf = (buf << 6) | i; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 0xff); }
  }
  return out;
}
function reverse(v: string): string { return v.split("").reverse().join(""); }
function rot13(v: string): string {
  return v.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}
function unmix(v: string): string {
  let out = "";
  for (let i = 0; i < v.length; i += 1) {
    out += String.fromCharCode((v.charCodeAt(i) - (399756995 % (i + 5)) + 256) % 256);
  }
  return out;
}

// The provider only ever composes these primitives before the final unmix.
const PRIMITIVES: Array<{ id: string; fn: (s: string) => string }> = [
  { id: "reverse", fn: reverse },
  { id: "b64", fn: b64decode },
  { id: "rot13", fn: rot13 }
];

type DerivedScheme = { steps: string[]; url: string };

/**
 * Search compositions of length 1..maxDepth of PRIMITIVES, apply `unmix`, and
 * return the first whose result is a URL that serves a live HLS manifest.
 */
async function deriveScheme(
  parts: string[],
  embedUrl: string,
  maxDepth = 4
): Promise<DerivedScheme | null> {
  const joined = parts.join("");

  // Build all step-sequences (with repetition) up to maxDepth, shortest first.
  const sequences: string[][] = [];
  function build(prefix: string[]) {
    if (prefix.length >= 1) sequences.push(prefix);
    if (prefix.length === maxDepth) return;
    for (const p of PRIMITIVES) build([...prefix, p.id]);
  }
  build([]);
  sequences.sort((a, b) => a.length - b.length);

  const byId = new Map(PRIMITIVES.map((p) => [p.id, p.fn]));
  const tested = new Set<string>();

  for (const steps of sequences) {
    let value = joined;
    try {
      for (const id of steps) value = byId.get(id)!(value);
      value = unmix(value);
    } catch {
      continue;
    }
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(value)) continue;
    if (tested.has(value)) continue;
    tested.add(value);

    if (await urlServesHlsManifest(value, embedUrl)) {
      return { steps, url: value };
    }
  }
  return null;
}

/** Render derived steps as a RAPIDRAME_PRE_UNMIX_TRANSFORMS entry. */
function renderTransform(steps: string[]): string {
  // steps are applied left→right on `joined`; compose as nested calls.
  const map: Record<string, string> = {
    reverse: "reverseString",
    b64: "decodeBase64Binary",
    rot13: "rot13"
  };
  let expr = "joined";
  for (const id of steps) expr = `${map[id]}(${expr})`;
  return `  (joined) => ${expr}`;
}

// ─── Auto-patch ──────────────────────────────────────────────────────────────

function insertTransform(steps: string[]): boolean {
  const source = fs.readFileSync(SERVICE_PATH, "utf8");
  const anchor = "const RAPIDRAME_PRE_UNMIX_TRANSFORMS: Array<(joined: string) => string> = [";
  const idx = source.indexOf(anchor);
  if (idx === -1) {
    console.error("  ✗ Could not locate RAPIDRAME_PRE_UNMIX_TRANSFORMS to patch.");
    return false;
  }
  const insertAt = idx + anchor.length;
  const entry = `\n${renderTransform(steps)}, // auto-derived by check-hdfilm-resolver`;
  const patched = source.slice(0, insertAt) + entry + source.slice(insertAt);
  fs.writeFileSync(SERVICE_PATH, patched, "utf8");
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("HDFilm resolver health check\n----------------------------");

  const probes: EmbedParts[] = [];
  for (const title of PROBE_TITLES) {
    const e = await fetchEmbedParts(title);
    if (e) {
      probes.push(e);
      console.log(`  • fetched embed for "${title}"`);
    } else {
      console.log(`  • (skip) no embed for "${title}"`);
    }
  }

  if (probes.length === 0) {
    console.error("\n✗ Could not fetch ANY embed page. Provider domain moved, or network/geo block.");
    console.error("  Check HDFILM_BASE in this script and the hdfilm baseUrl in Supabase provider_configs.");
    process.exit(2);
  }

  // 1. Health check with the CURRENT shipped decoder. Uses the full extractor
  //    (dc_*() interpreter + static-scheme fallback), matching the app path, so
  //    the check reflects real playback rather than only the static schemes.
  let healthy = 0;
  for (const { embedHtml, embedUrl } of probes) {
    const candidate = __internal.extractRapidrameStreamUrl(embedHtml);
    const ok = candidate ? await urlServesHlsManifest(candidate, embedUrl) : false;
    if (ok) healthy += 1;
  }

  console.log(`\nCurrent decoder: ${healthy}/${probes.length} probes resolve to a live HLS manifest.`);

  if (healthy > 0) {
    console.log("✓ Decoder is HEALTHY. No action needed.");
    process.exit(0);
  }

  // 2. Broken — try to auto-derive the new scheme against a live probe.
  console.log("\n✗ Decoder is BROKEN (provider rotated the scheme). Attempting auto-derivation…");

  for (const { parts, embedUrl } of probes) {
    const derived = await deriveScheme(parts, embedUrl);
    if (!derived) continue;

    console.log("\n🎉 Recovered a working scheme:");
    console.log(`   steps : join → ${derived.steps.join(" → ")} → unmix`);
    console.log(`   url   : ${derived.url}`);
    console.log("\n   Add this entry to the FRONT of RAPIDRAME_PRE_UNMIX_TRANSFORMS:");
    console.log(`\n${renderTransform(derived.steps)},\n`);

    if (shouldWrite) {
      if (insertTransform(derived.steps)) {
        console.log("   ✓ Auto-patched WebPlayerService.ts. Run `npm run typecheck && npm test`, then review the diff.");
        process.exit(0);
      }
      process.exit(3);
    } else {
      console.log("   Re-run with `-- --write` to insert it automatically.");
      process.exit(1);
    }
  }

  console.error("\n✗ Auto-derivation failed: the new scheme isn't a composition of known primitives.");
  console.error("  Manual step: open the embed page, find the inline `dc_*()` function, and translate");
  console.error("  it into a new RAPIDRAME_PRE_UNMIX_TRANSFORMS entry (see WebPlayerService.ts).");
  process.exit(4);
}

main().catch((err) => {
  console.error("Unexpected error:", err?.message ?? err);
  process.exit(5);
});
