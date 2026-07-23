/**
 * Minimal RFC-4180 CSV parser.
 *
 * Handles the cases Letterboxd exports actually contain: quoted fields with
 * embedded commas, embedded newlines, and doubled quotes (`""`). Kept tiny and
 * dependency-free on purpose — we only need correctness, not a full CSV engine.
 */

/** Parse CSV text into rows of string cells. Strips a leading UTF-8 BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Treat CRLF and lone CR as a single row break.
      pushRow();
      if (text[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Flush trailing field/row (file may not end with a newline). Skip a final
  // empty row produced by a trailing newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

/**
 * Parse CSV text into objects keyed by the header row. Header names are used
 * verbatim. Rows with no cells are skipped.
 */
export function parseCsvToObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell.trim());
  const records: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0].trim() === "") continue; // blank line

    const record: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) {
      record[header[c]] = cells[c] ?? "";
    }
    records.push(record);
  }

  return records;
}
