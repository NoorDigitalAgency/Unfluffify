export type TransferPayloadHandle = Readonly<{
  id: string;
  scope: string;
  sha256: string;
  byteLength: number;
}>;

type TransferPayloadEntry = Readonly<{
  handle: TransferPayloadHandle;
  value: string;
  expiresAt: number;
}>;

type TransferPayloadStoreOptions = Readonly<{
  id?: () => string;
  now?: () => number;
  ttlMs?: number;
  maxBytes?: number;
}>;

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

async function sha256(value: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTransferPayloadStore(options: TransferPayloadStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const nextId = options.id ?? (() => globalThis.crypto.randomUUID());
  const encoder = new TextEncoder();
  const entries = new Map<string, TransferPayloadEntry>();
  const deduplication = new Map<string, string>();
  let totalBytes = 0;

  const deduplicationKey = (handle: TransferPayloadHandle) =>
    `${handle.scope}\u0000${handle.sha256}\u0000${handle.byteLength}`;

  const remove = (id: string): boolean => {
    const entry = entries.get(id);
    if (!entry) {
      return false;
    }
    entries.delete(id);
    deduplication.delete(deduplicationKey(entry.handle));
    totalBytes -= entry.handle.byteLength;
    return true;
  };

  const sweep = (): void => {
    const currentTime = now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= currentTime) {
        remove(id);
      }
    }
  };

  return {
    async put(scope: string, value: string): Promise<TransferPayloadHandle> {
      sweep();
      const encoded = encoder.encode(value);
      const handleFacts = {
        scope,
        sha256: await sha256(encoded),
        byteLength: encoded.byteLength,
      };
      const key = `${scope}\u0000${handleFacts.sha256}\u0000${handleFacts.byteLength}`;
      const duplicateId = deduplication.get(key);
      const duplicate = duplicateId ? entries.get(duplicateId) : undefined;
      if (duplicate?.value === value) {
        entries.set(duplicate.handle.id, { ...duplicate, expiresAt: now() + ttlMs });
        return duplicate.handle;
      }

      while (entries.size > 0 && totalBytes + encoded.byteLength > maxBytes) {
        const oldestId = entries.keys().next().value as string | undefined;
        if (!oldestId) break;
        remove(oldestId);
      }
      const handle: TransferPayloadHandle = { id: nextId(), ...handleFacts };
      entries.set(handle.id, { handle, value, expiresAt: now() + ttlMs });
      deduplication.set(key, handle.id);
      totalBytes += handle.byteLength;
      return handle;
    },

    async get(handle: TransferPayloadHandle): Promise<string | null> {
      sweep();
      const entry = entries.get(handle.id);
      if (
        !entry ||
        entry.handle.scope !== handle.scope ||
        entry.handle.sha256 !== handle.sha256 ||
        entry.handle.byteLength !== handle.byteLength
      ) {
        return null;
      }
      const encoded = encoder.encode(entry.value);
      if (encoded.byteLength !== handle.byteLength || await sha256(encoded) !== handle.sha256) {
        remove(handle.id);
        return null;
      }
      return entry.value;
    },

    releaseScope(scope: string): number {
      let released = 0;
      for (const [id, entry] of entries) {
        if (entry.handle.scope === scope && remove(id)) {
          released += 1;
        }
      }
      return released;
    },

    entryCount(): number {
      sweep();
      return entries.size;
    },
  };
}

export type TransferPayloadStore = ReturnType<typeof createTransferPayloadStore>;
