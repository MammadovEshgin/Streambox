/**
 * List key for a movie or series row.
 *
 * FlashList can ask for the key of an index its data no longer holds while a
 * list shrinks or is swapped mid-layout; a key extractor that read the item
 * unguarded crashed the screen on 2026-10-25 ("Cannot read property
 * 'mediaType' of undefined"). Such a row gets a key from its index instead.
 */
export function mediaListKey(
  item: { mediaType: string; id: number | string } | null | undefined,
  index: number
): string {
  return item ? `${item.mediaType}-${item.id}` : `missing-${index}`;
}
