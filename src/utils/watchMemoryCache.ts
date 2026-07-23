// Watch Together — pure helpers for the on-device polaroid cache (no React
// Native / expo imports, so they stay unit-testable; see
// tests/watchMemoryCache.test.ts). The native FileSystem plumbing that uses
// these lives in src/services/watchMemories.ts.

// Every cached polaroid is stored as "{memoryId}.png" in one flat directory, so
// the row id round-trips to a filename and back with no separate index.
export const WATCH_MEMORY_CACHE_DIRNAME = "watch-memories";
const FILE_SUFFIX = ".png";

export function memoryCacheFileName(memoryId: string): string {
  return `${memoryId}${FILE_SUFFIX}`;
}

export function memoryIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(FILE_SUFFIX)) return null;
  const id = fileName.slice(0, -FILE_SUFFIX.length);
  return id.length > 0 ? id : null;
}

// Given the files currently in the cache dir and the memory ids that are still
// live on the shelf, return the files that should be deleted (orphans left
// behind by removed/expired memories). Files that are not "{id}.png" are left
// untouched.
export function selectStaleCacheFiles(files: readonly string[], activeIds: readonly string[]): string[] {
  const active = new Set(activeIds);
  const stale: string[] = [];
  for (const file of files) {
    const id = memoryIdFromFileName(file);
    if (id && !active.has(id)) stale.push(file);
  }
  return stale;
}
