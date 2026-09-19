import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_THEME_ID } from "../src/theme/Theme";

// ---------------------------------------------------------------------------
// New accounts must start green. The client default was right all along; the
// orange came from the database: the signup trigger and the settings RPC
// hard-code a theme id, the first sign-in adopts the server's settings, and the
// 2026-07-28 rebaseline silently restored the old literal after it had been
// fixed. These read whichever migration defines each function LAST, so a
// future rebaseline that regresses it fails here.
// ---------------------------------------------------------------------------

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"));

function latestFunctionBody(signature: string): string {
  const source = [...migrations].reverse().find((sql) => sql.includes(signature));
  assert.ok(source, `no migration defines ${signature}`);
  const start = source.lastIndexOf(signature);
  const bodyStart = source.indexOf("$function$", start);
  const bodyEnd = source.indexOf("$function$", bodyStart + "$function$".length);
  return source.slice(start, bodyEnd);
}

test("the client default theme is emerald-noir (green)", () => {
  assert.equal(DEFAULT_THEME_ID, "emerald-noir");
});

test("the signup trigger gives new accounts emerald-noir", () => {
  const body = latestFunctionBody("FUNCTION public.handle_streambox_user_created()");
  assert.ok(body.includes("'emerald-noir'"));
  assert.ok(!body.includes("'cinema-ember'"));
});

test("the settings RPC falls back to emerald-noir", () => {
  const body = latestFunctionBody("FUNCTION public.sync_streambox_profile_and_settings(");
  assert.ok(body.includes("'emerald-noir'"));
  assert.ok(!body.includes("'cinema-ember'"));
});
