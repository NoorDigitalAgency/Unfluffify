import { z } from "zod";

export type StorageReadResult<T> =
  | Readonly<{ ok: true; value: T | null }>
  | Readonly<{ ok: false; error: StorageRepositoryError }>;

export class StorageRepositoryError extends Error {
  readonly code: "INVALID_STORED_VALUE" | "STORAGE_UNAVAILABLE";
  readonly issues: readonly z.ZodIssue[];

  constructor(
    code: "INVALID_STORED_VALUE" | "STORAGE_UNAVAILABLE",
    message: string,
    issues: readonly z.ZodIssue[] = [],
  ) {
    super(message);
    this.name = "StorageRepositoryError";
    this.code = code;
    this.issues = issues;
  }
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryStore(seed: Readonly<Record<string, unknown>> = {}): KeyValueStore {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
    async clear() {
      values.clear();
    },
  };
}

type IndexedDbFactory = Pick<IDBFactory, "open">;

export function createIndexedDbStore(options: Readonly<{
  indexedDBFactory?: IndexedDbFactory;
  dbName?: string;
  storeName?: string;
}> = {}): KeyValueStore {
  const indexedDBFactory = options.indexedDBFactory ?? globalThis.indexedDB;
  const dbName = options.dbName ?? "unfluffify-rewrite";
  const storeName = options.storeName ?? "kv";
  if (!indexedDBFactory) {
    throw new StorageRepositoryError("STORAGE_UNAVAILABLE", "IndexedDB is unavailable");
  }

  let dbPromise: Promise<IDBDatabase> | null = null;
  const openDb = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDBFactory.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    return dbPromise;
  };

  const transact = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T | undefined> => {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = run(store);
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
  };

  return {
    async get(key) {
      return await transact("readonly", (store) => store.get(key));
    },
    async set(key, value) {
      await transact("readwrite", (store) => store.put(value, key));
    },
    async remove(key) {
      await transact("readwrite", (store) => store.delete(key));
    },
    async clear() {
      await transact("readwrite", (store) => store.clear());
    },
  };
}

export function parseStoredValue<T>(schema: z.ZodType<T>, value: unknown): StorageReadResult<T> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: new StorageRepositoryError(
        "INVALID_STORED_VALUE",
        "Stored value failed schema validation",
        parsed.error.issues,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

export function invalidStoredValue(message: string): StorageReadResult<never> {
  return {
    ok: false,
    error: new StorageRepositoryError("INVALID_STORED_VALUE", message),
  };
}
