/**
 * Versioned browser storage.
 *
 * The previous near.social app ran on this origin and left its data in localStorage:
 * wallet-selector state (with contract `social.near`), near-api-js keys, HERE/web3-onboard
 * wallet state, VM caches and editor state. The wallet selector here uses the same key names, so
 * those stale entries break wallet sign-in.
 *
 * `ns:storage-version` marks storage this app has already migrated. Without it, storage is either
 * empty or legacy, and everything except this app's own keys (`ns:`, `nsk:`) is removed. Later
 * layout changes add a step to MIGRATIONS and bump STORAGE_VERSION.
 */

export const STORAGE_VERSION = 1;
export const STORAGE_VERSION_KEY = "ns:storage-version";
const OWN_PREFIXES = ["ns:", "nsk:"];

type Migration = (storage: Storage) => void;

/** `MIGRATIONS[n]` upgrades storage from version n − 1 to n. */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: drop everything left by the previous near.social app.
  1: (storage) => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
    for (const key of keys) {
      if (!OWN_PREFIXES.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
    }
  },
};

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined; // blocked storage (privacy settings)
  }
}

/**
 * Brings localStorage up to STORAGE_VERSION. Returns the version it found (0 = none/legacy), or
 * null when storage is unavailable. Storage from a newer app version is left alone.
 */
export function migrateStorage(storage: Storage | undefined = browserStorage()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_VERSION_KEY);
    const found = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
    if (found >= STORAGE_VERSION) return found;
    for (let version = found + 1; version <= STORAGE_VERSION; version++) {
      MIGRATIONS[version]?.(storage);
    }
    storage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
    return found;
  } catch {
    return null; // quota or access errors: never break the app over cleanup
  }
}
