/**
 * Phone-notepad cache for inventory counts.
 *
 * Every count edit (a tap, a typed value, a voice command) is mirrored into
 * an IndexedDB store keyed by `count_id|item_id|storage_location_id`. Each
 * record carries a `pending` flag and an `updated_at` timestamp so a
 * background sync loop can write only the still-unsynced rows back to the
 * cloud and mark them as confirmed.
 *
 * Why IndexedDB instead of localStorage:
 *   - localStorage is ~5MB total per origin; a 500-item count with audit
 *     metadata easily blows past that.
 *   - localStorage is synchronous and blocks the main thread on every tap.
 *   - IndexedDB persists across tab crashes, app restarts, and offline.
 *
 * What we do NOT do here:
 *   - No business logic. The cached payload is exactly what the existing
 *     saveItemsBatch() pipeline already writes to Supabase.
 *   - No conflict resolution beyond "newest local wins, then sync to cloud".
 *     One person counts at a time per location in practice.
 */

const DB_NAME = "croohq-inventory-cache";
const DB_VERSION = 1;
const STORE = "count-items";

export interface CachedCountItem {
  /** Composite key: `${countId}|${itemId}|${storageLocationId ?? ""}` */
  key: string;
  countId: string;
  itemId: string;
  storageLocationId: string | null;
  /** Full payload that saveItemsBatch/edit save expects. */
  payload: Record<string, unknown>;
  /** True until the cloud confirms the write. */
  pending: boolean;
  /** Last time the user edited this row, ms since epoch. */
  updatedAt: number;
  /** Set once the cloud confirms; for diagnostics only. */
  syncedAt: number | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("by-count", "countId", { unique: false });
        store.createIndex("by-pending", ["countId", "pending"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result: T;
        Promise.resolve(fn(store))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

function compositeKey(countId: string, itemId: string, storLocId: string | null): string {
  return `${countId}|${itemId}|${storLocId ?? ""}`;
}

/**
 * Stash a single edit. Marks pending=true so the next sync cycle picks it up.
 * Safe to call on every keystroke; IDB will coalesce.
 */
export async function cacheCountEdit(args: {
  countId: string;
  itemId: string;
  storageLocationId: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { countId, itemId, storageLocationId, payload } = args;
  const key = compositeKey(countId, itemId, storageLocationId);
  const record: CachedCountItem = {
    key,
    countId,
    itemId,
    storageLocationId,
    payload,
    pending: true,
    updatedAt: Date.now(),
    syncedAt: null,
  };
  try {
    await withStore("readwrite", (store) => {
      store.put(record);
    });
  } catch (e) {
    console.warn("[InventoryCache] Failed to cache edit:", e);
  }
}

/**
 * Bulk cache (used right after the initial count items hydrate from the DB
 * so we have a baseline; these arrive with pending=false because the cloud
 * is already the source of truth at hydration time).
 */
export async function seedCountCache(args: {
  countId: string;
  rows: Array<{
    itemId: string;
    storageLocationId: string | null;
    payload: Record<string, unknown>;
  }>;
}): Promise<void> {
  const { countId, rows } = args;
  if (rows.length === 0) return;
  try {
    await withStore("readwrite", (store) => {
      const now = Date.now();
      for (const row of rows) {
        const key = compositeKey(countId, row.itemId, row.storageLocationId);
        store.put({
          key,
          countId,
          itemId: row.itemId,
          storageLocationId: row.storageLocationId,
          payload: row.payload,
          pending: false,
          updatedAt: now,
          syncedAt: now,
        } satisfies CachedCountItem);
      }
    });
  } catch (e) {
    console.warn("[InventoryCache] Failed to seed cache:", e);
  }
}

/** Pull every still-pending row for a count (for the sync loop). */
export async function getPendingForCount(countId: string): Promise<CachedCountItem[]> {
  try {
    return await withStore("readonly", (store) => {
      return new Promise<CachedCountItem[]>((resolve, reject) => {
        const results: CachedCountItem[] = [];
        const idx = store.index("by-count");
        const req = idx.openCursor(IDBKeyRange.only(countId));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as CachedCountItem;
            if (val.pending) results.push(val);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  } catch (e) {
    console.warn("[InventoryCache] Failed to read pending:", e);
    return [];
  }
}

/** Pull every cached row for a count (for hydration / restore). */
export async function getAllForCount(countId: string): Promise<CachedCountItem[]> {
  try {
    return await withStore("readonly", (store) => {
      return new Promise<CachedCountItem[]>((resolve, reject) => {
        const results: CachedCountItem[] = [];
        const idx = store.index("by-count");
        const req = idx.openCursor(IDBKeyRange.only(countId));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            results.push(cursor.value as CachedCountItem);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  } catch (e) {
    console.warn("[InventoryCache] Failed to read all:", e);
    return [];
  }
}

/**
 * Mark a set of cached rows as synced. Pass the composite keys of the
 * rows that the cloud successfully accepted. Rows that updated_at moved
 * forward since we read them stay pending — meaning the user typed
 * something newer and we'll sync that on the next tick.
 */
export async function markSynced(args: {
  keys: string[];
  /** The updatedAt the sync loop saw when it picked these rows up. */
  baselineUpdatedAt: Map<string, number>;
}): Promise<void> {
  const { keys, baselineUpdatedAt } = args;
  if (keys.length === 0) return;
  try {
    await withStore("readwrite", (store) => {
      for (const key of keys) {
        const baseline = baselineUpdatedAt.get(key) ?? 0;
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const cur = getReq.result as CachedCountItem | undefined;
          if (!cur) return;
          // Only flip to synced if the user hasn't edited since we read this row
          if (cur.updatedAt > baseline) return;
          store.put({ ...cur, pending: false, syncedAt: Date.now() });
        };
      }
    });
  } catch (e) {
    console.warn("[InventoryCache] Failed to mark synced:", e);
  }
}

/** Wipe a count once it's submitted/closed/deleted. */
export async function clearCountCache(countId: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => {
      const idx = store.index("by-count");
      const req = idx.openCursor(IDBKeyRange.only(countId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
  } catch (e) {
    console.warn("[InventoryCache] Failed to clear cache:", e);
  }
}

/** Cheap status read used by the sync pill and the lock state. */
export async function getPendingCount(countId: string): Promise<number> {
  const rows = await getPendingForCount(countId);
  return rows.length;
}
