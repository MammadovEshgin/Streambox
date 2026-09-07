/**
 * Folding for letters Unicode NFD cannot decompose.
 *
 * Every title-matching path in the app normalises the same way: lowercase, NFD,
 * strip combining marks, then drop whatever is left outside `[a-z0-9]`. That
 * handles most accented Latin letters, because NFD splits them into a base
 * letter plus a combining mark (ö → o + ¨, ç → c + ¸, ğ → g + ˘).
 *
 * It does NOT handle letters that are their own base codepoint. The Turkish
 * dotless i (ı, U+0131) is the one that bites hardest here: it has no
 * decomposition, so the final strip deletes it outright. "Mezarlık" normalised
 * to "mezarl k" and could never match the "mezarlik" a viewer typed — the
 * series was simply missing from search results, spelled correctly or not.
 * Azerbaijani ə (U+0259) fails the same way, as do ø, ł, đ and friends.
 *
 * Apply this BEFORE the `[^a-z0-9]` strip in every normalisation path.
 */

const NON_DECOMPOSING_LETTERS: Record<string, string> = {
  ı: "i", // Turkish dotless i
  İ: "i", // Turkish dotted capital I (lowercases to i + U+0307, folded here too)
  ə: "e", // Azerbaijani schwa
  Ə: "E",
  ø: "o",
  Ø: "o",
  ł: "l",
  Ł: "l",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  ß: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ħ: "h",
  Ħ: "H",
  ŧ: "t",
  Ŧ: "T",
};

const NON_DECOMPOSING_PATTERN = new RegExp(
  `[${Object.keys(NON_DECOMPOSING_LETTERS).join("")}]`,
  "g"
);

/**
 * Replace letters with no NFD decomposition by their ASCII equivalent, so the
 * usual `normalize("NFD") → strip marks → strip non-ASCII` pipeline keeps them
 * instead of deleting them.
 */
export function foldNonDecomposingLetters(value: string): string {
  return value.replace(NON_DECOMPOSING_PATTERN, (char) => NON_DECOMPOSING_LETTERS[char] ?? char);
}

/**
 * The shared normalisation used for comparing titles and names: fold, lowercase,
 * strip diacritics, reduce everything else to single spaces.
 */
export function foldForTitleCompare(value: string): string {
  return foldNonDecomposingLetters(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
