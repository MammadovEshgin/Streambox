import assert from "node:assert/strict";
import test from "node:test";

import {
  createDurableDocumentStore,
  documentFileName,
  type DurableFileBackend,
  type DurableStoreEvent,
} from "../src/utils/durableDocumentStore";

// In-memory file system with fault injection, standing in for expo-file-system.
function createFakeFiles() {
  const files = new Map<string, string>();
  const faults = {
    failWrite: false,
    truncateWrite: false,
    failMoveTo: null as string | null,
  };
  const backend: DurableFileBackend = {
    async read(path) {
      return files.has(path) ? (files.get(path) as string) : null;
    },
    async write(path, contents) {
      if (faults.failWrite) throw new Error("ENOSPC: no space left on device");
      files.set(path, faults.truncateWrite ? contents.slice(0, Math.floor(contents.length / 2)) : contents);
    },
    async move(from, to) {
      if (faults.failMoveTo !== null && to.endsWith(faults.failMoveTo)) throw new Error("rename failed");
      if (!files.has(from)) throw new Error(`no such file ${from}`);
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
    async remove(path) {
      files.delete(path);
    },
  };
  return { files, faults, backend };
}

function createFakeLegacy(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const unreadable = new Set<string>();
  return {
    rows,
    unreadable,
    backend: {
      async getItem(key: string) {
        if (unreadable.has(key)) throw new Error("Row too big to fit into CursorWindow requiredPos=0, totalRows=1");
        return rows.has(key) ? (rows.get(key) as string) : null;
      },
      async removeItem(key: string) {
        rows.delete(key);
      },
    },
  };
}

const DIR = "file:///data/user-library/";
const KEY = "streambox/watch-history";
const MAIN = `${DIR}${documentFileName(KEY)}`;

test("documents round-trip through files and survive a fresh store (app restart)", async () => {
  const { backend } = createFakeFiles();
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  await store.write(KEY, JSON.stringify([{ id: 603 }]));
  assert.equal(await store.read(KEY), JSON.stringify([{ id: 603 }]));

  const restarted = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  assert.equal(await restarted.read(KEY), JSON.stringify([{ id: 603 }]));
});

test("a value too large for AsyncStorage (> 2 MB) is stored and read back intact", async () => {
  const { backend } = createFakeFiles();
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  const entries = Array.from({ length: 1500 }, (_, index) => ({
    id: index + 1,
    title: `Film ${index + 1}`,
    castNames: Array.from({ length: 20 }, (__, member) => `Actor Number ${member} With A Long Name`),
    castProfilePaths: Array.from({ length: 20 }, () => "/a1b2c3d4e5f6g7h8i9j0k1l2m3n4.jpg"),
  }));
  const raw = JSON.stringify(entries);
  assert.ok(raw.length > 2 * 1024 * 1024);
  await store.write(KEY, raw);
  store.forgetCache();
  assert.equal(await store.read(KEY), raw);
});

test("the legacy AsyncStorage value is migrated once, then its row is freed", async () => {
  const { backend, files } = createFakeFiles();
  const legacy = createFakeLegacy({ [KEY]: JSON.stringify([{ id: 1 }]) });
  const events: DurableStoreEvent[] = [];
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: legacy.backend, onEvent: (e) => events.push(e) });

  assert.equal(await store.read(KEY), JSON.stringify([{ id: 1 }]));
  assert.equal(files.get(MAIN), JSON.stringify([{ id: 1 }]));
  assert.equal(legacy.rows.has(KEY), false, "the AsyncStorage row is removed after a verified file write");
  assert.ok(events.some((e) => e.type === "legacy_migrated"));
});

test("a legacy row stays in place when the file write fails, and is still served", async () => {
  const { backend, faults } = createFakeFiles();
  const legacy = createFakeLegacy({ [KEY]: JSON.stringify([{ id: 2 }]) });
  faults.failWrite = true;
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: legacy.backend });
  assert.equal(await store.read(KEY), JSON.stringify([{ id: 2 }]));
  assert.equal(legacy.rows.has(KEY), true, "nothing is lost while the file can't be written");
});

test("an unreadable legacy row (CursorWindow) reads as empty and is reported, never throws", async () => {
  const { backend } = createFakeFiles();
  const legacy = createFakeLegacy({ [KEY]: "x" });
  legacy.unreadable.add(KEY);
  const events: DurableStoreEvent[] = [];
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: legacy.backend, onEvent: (e) => events.push(e) });
  assert.equal(await store.read(KEY), null);
  assert.ok(events.some((e) => e.type === "legacy_unreadable"));

  // A later write lands in a file and frees the unreadable row.
  await store.write(KEY, "[]");
  assert.equal(legacy.rows.has(KEY), false);
});

test("a write that doesn't verify (short write) is refused and the previous copy kept", async () => {
  const { backend, faults } = createFakeFiles();
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  await store.write(KEY, JSON.stringify([1, 2, 3]));
  faults.truncateWrite = true;
  await assert.rejects(store.write(KEY, JSON.stringify([1, 2, 3, 4])));
  faults.truncateWrite = false;
  store.forgetCache();
  assert.equal(await store.read(KEY), JSON.stringify([1, 2, 3]));
});

test("a crash between the two renames recovers the new copy from tmp", async () => {
  const { backend, faults, files } = createFakeFiles();
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  await store.write(KEY, JSON.stringify(["old"]));
  // main → bak succeeds, tmp → main "crashes".
  faults.failMoveTo = documentFileName(KEY);
  await assert.rejects(store.write(KEY, JSON.stringify(["new"])));
  faults.failMoveTo = null;
  assert.equal(files.has(MAIN), false);

  const restarted = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  assert.equal(await restarted.read(KEY), JSON.stringify(["new"]));
  assert.equal(files.get(MAIN), JSON.stringify(["new"]), "the recovered copy is promoted back to main");
});

test("a corrupted main file falls back to the backup", async () => {
  const { backend, files } = createFakeFiles();
  const events: DurableStoreEvent[] = [];
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null, onEvent: (e) => events.push(e) });
  await store.write(KEY, JSON.stringify(["first"]));
  await store.write(KEY, JSON.stringify(["second"]));
  files.set(MAIN, '["second"'); // torn

  const restarted = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null, onEvent: (e) => events.push(e) });
  assert.equal(await restarted.read(KEY), JSON.stringify(["first"]));
  assert.ok(events.some((e) => e.type === "recovered_from_copy" && e.copy === "bak"));
});

test("remove deletes every copy and the legacy row", async () => {
  const { backend, files } = createFakeFiles();
  const legacy = createFakeLegacy({ [KEY]: "[1]" });
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: legacy.backend });
  await store.write(KEY, "[1]");
  await store.write(KEY, "[2]");
  await store.remove(KEY);
  assert.equal(files.size, 0);
  assert.equal(legacy.rows.size, 0);
  assert.equal(await store.read(KEY), null);
});

test("concurrent writes land in call order", async () => {
  const { backend } = createFakeFiles();
  const store = createDurableDocumentStore({ directory: DIR, files: backend, legacy: null });
  await Promise.all([store.write(KEY, "[1]"), store.write(KEY, "[2]"), store.write(KEY, "[3]")]);
  store.forgetCache();
  assert.equal(await store.read(KEY), "[3]");
});
