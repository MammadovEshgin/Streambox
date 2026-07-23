import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv, parseCsvToObjects } from "../src/utils/csv";

test("parseCsv handles a simple Letterboxd watched.csv", () => {
  const csv = "Date,Name,Year,Letterboxd URI\n2022-06-03,La La Land,2016,https://boxd.it/a5fa\n";
  assert.deepEqual(parseCsv(csv), [
    ["Date", "Name", "Year", "Letterboxd URI"],
    ["2022-06-03", "La La Land", "2016", "https://boxd.it/a5fa"],
  ]);
});

test("parseCsv keeps commas inside quoted fields (e.g. 'Oslo, August 31st')", () => {
  const csv = 'Date,Name,Year\n2011-01-01,"Oslo, August 31st",2011\n';
  const rows = parseCsv(csv);
  assert.deepEqual(rows[1], ["2011-01-01", "Oslo, August 31st", "2011"]);
});

test("parseCsv handles embedded newlines and doubled quotes inside a field", () => {
  const csv = 'Name,Review\nA Real Pain,"line one\n""quoted"" line two"\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ["A Real Pain", 'line one\n"quoted" line two']);
});

test("parseCsv strips a leading UTF-8 BOM and a trailing newline", () => {
  const csv = "﻿Name,Year\nDune,2021\n";
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ["Name", "Year"]);
  assert.equal(rows.length, 2);
});

test("parseCsvToObjects maps rows to header-keyed records", () => {
  const csv =
    "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n" +
    "2022-08-21,Another Round,2020,https://boxd.it/39jaJt,4,,,2022-08-20\n";
  const records = parseCsvToObjects(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].Name, "Another Round");
  assert.equal(records[0].Year, "2020");
  assert.equal(records[0]["Watched Date"], "2022-08-20");
  assert.equal(records[0]["Letterboxd URI"], "https://boxd.it/39jaJt");
});

test("parseCsvToObjects returns [] for a header-only or empty file", () => {
  assert.deepEqual(parseCsvToObjects("Date,Name,Year\n"), []);
  assert.deepEqual(parseCsvToObjects(""), []);
});

test("parseCsvToObjects skips blank lines without misaligning columns", () => {
  const csv = "Name,Year\nDune,2021\n\nSicario,2015\n";
  const records = parseCsvToObjects(csv);
  assert.equal(records.length, 2);
  assert.equal(records[1].Name, "Sicario");
});
