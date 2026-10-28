/**
 * Decode the HTML entities a provider's listing writes into a title.
 *
 * HDFilm escapes titles in its search rows: "L&eacute;on: The Professional",
 * "Harry Potter and the Philosopher&#039;s Stone", "Fast &amp; Furious 6". The
 * resolver used to know a handful of entities and turn every other one into a
 * space, so "Léon" scored as "L on" and never matched (2026-10-28).
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  times: "×",
  sup2: "²",
  sup3: "³",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oelig: "œ",
  OElig: "Œ",
  eth: "ð",
  ETH: "Ð",
  thorn: "þ",
  THORN: "Þ",
  oslash: "ø",
  Oslash: "Ø",
};

/** `&eacute;` → e + U+0301, composed back to é. */
const ACCENTS: Record<string, string> = {
  acute: "́",
  grave: "̀",
  circ: "̂",
  tilde: "̃",
  uml: "̈",
  ring: "̊",
  cedil: "̧",
  caron: "̌",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    if (NAMED[body] !== undefined) return NAMED[body];
    const accented = body.match(/^([a-zA-Z])(acute|grave|circ|tilde|uml|ring|cedil|caron)$/);
    if (accented) return `${accented[1]}${ACCENTS[accented[2]]}`.normalize("NFC");
    return entity;
  });
}
