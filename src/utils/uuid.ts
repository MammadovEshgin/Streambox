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
