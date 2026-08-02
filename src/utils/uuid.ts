// Dependency-free UUIDv4 (no native module, node-testable; see
// tests/uuid.test.ts). Watch Together generates a memory's id CLIENT-SIDE at
// capture time so the local index entry, the cached file, and the cloud row all
// share one id from birth — that is what makes the background upload retryable
// (a second insert with the same id is a no-op conflict, never a duplicate).

export function generateUuidV4(randomFn?: () => number): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!randomFn && cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (!randomFn && cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    const rand = randomFn ?? Math.random;
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(rand() * 256) & 0xff;
    }
  }

  // RFC 4122: version 4, variant 10xx.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derive a STABLE uuid from an arbitrary string key.
 *
 * Some local entities are keyed by a readable composite string rather than a
 * TMDB number — season watch-history rows use `series-season:{seriesId}:{n}`.
 * Supabase stores those under `internal_id`, which is a `uuid` column (and the
 * sync RPCs take `p_internal_id uuid`), so sending the raw string made Postgres
 * reject the write with `invalid input syntax for type uuid`. Because a failed
 * op is re-queued forever, every season a user logged also wedged the sync
 * queue behind it — which is why production held 2327 watch-history rows and
 * not one of them was a season.
 *
 * Hashing the key instead keeps the column's type contract while preserving the
 * property upserts depend on: the same logical entity always maps to the same
 * uuid, on every device and every reinstall. The readable key is not lost —
 * it is reconstructed from the row's `snapshot` on the way back down.
 *
 * FNV-1a over four differently-seeded passes; this is an id, not a security
 * primitive, so collision resistance at this scale is ample.
 */
export function deriveStableUuidFromKey(key: string): string {
  const words: number[] = [];

  for (let seed = 0; seed < 4; seed += 1) {
    // Distinct FNV offset basis per word so the four passes can't agree.
    let hash = 0x811c9dc5 ^ (seed * 0x9e3779b9);
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      // FNV prime (16777619) via shifts — stays inside 32-bit int math.
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    words.push(hash >>> 0);
  }

  const bytes = new Uint8Array(16);
  words.forEach((word, wordIndex) => {
    bytes[wordIndex * 4] = (word >>> 24) & 0xff;
    bytes[wordIndex * 4 + 1] = (word >>> 16) & 0xff;
    bytes[wordIndex * 4 + 2] = (word >>> 8) & 0xff;
    bytes[wordIndex * 4 + 3] = word & 0xff;
  });

  // Same RFC 4122 shaping as above so the value passes uuid validation.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
