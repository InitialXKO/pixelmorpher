/**
 * OPFS (Origin Private File System) autosave storage.
 *
 * Replaces localStorage for project autosaves to avoid the ~5MB limit.
 * OPFS can store GBs of data.
 */

const AUTOSAVE_FILENAME = 'pixelmorpher-autosave.json';
const AUTOSAVE_META_FILENAME = 'pixelmorpher-autosave-meta.json';

interface AutosaveMeta {
  time: string;
  size: number;
}

/**
 * Check if OPFS is available.
 */
export function isOPFSAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

/**
 * Save project data to OPFS.
 * @returns true on success, false on failure
 */
export async function saveAutosaveToOPFS(data: unknown): Promise<boolean> {
  if (!isOPFSAvailable()) {
    console.warn('[autosave] OPFS not available, skipping');
    return false;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const json = JSON.stringify(data);

    // Write project data
    const fileHandle = await root.getFileHandle(AUTOSAVE_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();

    // Write metadata
    const metaHandle = await root.getFileHandle(AUTOSAVE_META_FILENAME, { create: true });
    const metaWritable = await metaHandle.createWritable();
    const meta: AutosaveMeta = {
      time: new Date().toISOString(),
      size: json.length,
    };
    await metaWritable.write(JSON.stringify(meta));
    await metaWritable.close();

    return true;
  } catch (e) {
    console.error('[autosave] OPFS save failed:', e);
    return false;
  }
}

/**
 * Check if an autosave exists in OPFS.
 * @returns metadata if exists, null otherwise
 */
export async function checkAutosaveInOPFS(): Promise<AutosaveMeta | null> {
  if (!isOPFSAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const metaHandle = await root.getFileHandle(AUTOSAVE_META_FILENAME, { create: false });
    const file = await metaHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as AutosaveMeta;
  } catch {
    return null;
  }
}

/**
 * Load autosave data from OPFS.
 * @returns parsed project file, or null on failure
 */
export async function loadAutosaveFromOPFS(): Promise<unknown | null> {
  if (!isOPFSAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(AUTOSAVE_FILENAME, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (e) {
    console.error('[autosave] OPFS load failed:', e);
    return null;
  }
}

/**
 * Delete autosave from OPFS.
 */
export async function clearAutosaveInOPFS(): Promise<void> {
  if (!isOPFSAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(AUTOSAVE_FILENAME).catch(() => {});
    await root.removeEntry(AUTOSAVE_META_FILENAME).catch(() => {});
  } catch (e) {
    console.error('[autosave] OPFS clear failed:', e);
  }
}

/**
 * Migrate legacy localStorage autosave to OPFS (one-time).
 * @returns true if migration happened
 */
export async function migrateLegacyAutosave(): Promise<boolean> {
  try {
    const legacy = localStorage.getItem('pixelmorpher-autosave');
    if (!legacy) return false;

    const data = JSON.parse(legacy);
    const ok = await saveAutosaveToOPFS(data);
    if (ok) {
      localStorage.removeItem('pixelmorpher-autosave');
      localStorage.removeItem('pixelmorpher-autosave-time');
      console.log('[autosave] Migrated legacy localStorage autosave to OPFS');
      return true;
    }
  } catch (e) {
    console.error('[autosave] Legacy migration failed:', e);
  }
  return false;
}
