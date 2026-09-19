import assert from "node:assert/strict";
import test from "node:test";

import { isAnnouncementRelevantToInstall } from "../src/utils/announcementEligibility";

// A fresh install used to be greeted by every announcement ever published —
// the June 2026 "Letterboxd import" popup was still the first thing new users
// saw in September. News that predates the install is not news.

const INSTALL = "2026-09-20T10:00:00.000Z";
const NOW = "2026-09-20T12:00:00.000Z";
const row = (starts_at: string | null, ends_at: string | null = null) => ({ starts_at, ends_at });

test("an announcement that started after the install is shown", () => {
  assert.equal(isAnnouncementRelevantToInstall(row("2026-09-20T11:00:00.000Z"), INSTALL, NOW), true);
});

test("an open-ended announcement older than the install is hidden (the Letterboxd case)", () => {
  assert.equal(isAnnouncementRelevantToInstall(row("2026-06-28T00:00:00.000Z"), INSTALL, NOW), false);
});

test("a still-running time-boxed campaign reaches new installs too", () => {
  assert.equal(
    isAnnouncementRelevantToInstall(row("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), INSTALL, NOW),
    true
  );
});

test("a finished campaign older than the install is hidden", () => {
  assert.equal(
    isAnnouncementRelevantToInstall(row("2026-09-01T00:00:00.000Z", "2026-09-20T11:00:00.000Z"), INSTALL, NOW),
    false
  );
});

test("no start date means no reason to hide it", () => {
  assert.equal(isAnnouncementRelevantToInstall(row(null), INSTALL, NOW), true);
});

test("an announcement that starts exactly at install time is shown", () => {
  assert.equal(isAnnouncementRelevantToInstall(row(INSTALL), INSTALL, NOW), true);
});

test("an unparseable start date is treated as absent", () => {
  assert.equal(isAnnouncementRelevantToInstall(row("not a date"), INSTALL, NOW), true);
});
