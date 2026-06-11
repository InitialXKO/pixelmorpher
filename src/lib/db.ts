// ============================================================
// PixelMorpher - Browser-Compatible Database Layer
// Uses IndexedDB via a lightweight wrapper for client-side
// persistence of project data, tile sets, and preferences.
// Replaces the previous Prisma-based approach which required
// a Node.js server runtime.
// ============================================================

const DB_NAME = 'pixelmorpher';
const DB_VERSION = 2;

/** Store names used by the application */
export const STORES = {
  projects: 'projects',
  tileSets: 'tileSets',
  preferences: 'preferences',
  assetLibrary: 'assetLibrary',
  projectMeta: 'projectMeta',
} as const;

/** Open (or create) the IndexedDB database */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.projects)) {
        db.createObjectStore(STORES.projects, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.tileSets)) {
        db.createObjectStore(STORES.tileSets, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.preferences)) {
        db.createObjectStore(STORES.preferences, { keyPath: 'key' });
      }
      // V2: Asset Library & Project Metadata stores
      if (!db.objectStoreNames.contains(STORES.assetLibrary)) {
        db.createObjectStore(STORES.assetLibrary, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.projectMeta)) {
        db.createObjectStore(STORES.projectMeta, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Generic get from a store */
export async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

/** Generic put into a store */
export async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Generic delete from a store */
export async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Get all entries from a store */
export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

/** Convenience: save a project */
async function saveProject(project: { id: string; [k: string]: unknown }): Promise<void> {
  await dbPut(STORES.projects, { ...project, updatedAt: Date.now() });
}

/** Convenience: load a project by ID */
async function loadProject(id: string): Promise<Record<string, unknown> | undefined> {
  return dbGet(STORES.projects, id);
}

/** Convenience: list all projects */
async function listProjects(): Promise<Record<string, unknown>[]> {
  return dbGetAll(STORES.projects);
}

/** Convenience: save a preference */
async function savePreference(key: string, value: unknown): Promise<void> {
  await dbPut(STORES.preferences, { key, value });
}

/** Convenience: load a preference */
async function loadPreference<T>(key: string): Promise<T | undefined> {
  const row = await dbGet<{ key: string; value: T }>(STORES.preferences, key);
  return row?.value;
}
