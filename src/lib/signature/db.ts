import { openDB, type IDBPDatabase } from 'idb';

/**
 * Local persistence for the user's signature images — uploaded scans, drawn,
 * or typed. Everything stays in IndexedDB — nothing ever leaves the browser.
 */

// The app's old name (Signy). Kept so returning users keep their saved signatures.
const DB_NAME = 'signy';
const DB_VERSION = 2;
const STORE_NAME = 'signatures';
/** Version 1 kept a single signature under this store/key; it's moved into STORE_NAME on upgrade. */
const LEGACY_STORE_NAME = 'signature';
const LEGACY_RECORD_KEY = 'current';

export type SignatureKind = 'upload' | 'drawn' | 'typed';

export interface StoredSignature {
  id: string;
  /** Image bytes (PNG/JPEG) — as uploaded, or rendered from a drawn/typed signature. */
  blob: Blob;
  fileName: string;
  mimeType: string;
  kind: SignatureKind;
  /** Short name shown in the signature list. */
  label: string;
  savedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (oldVersion >= 1 && db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          const legacy = await tx.objectStore(LEGACY_STORE_NAME).get(LEGACY_RECORD_KEY);
          if (legacy) {
            const migrated: StoredSignature = {
              id: crypto.randomUUID(),
              blob: legacy.blob,
              fileName: legacy.fileName,
              mimeType: legacy.mimeType,
              kind: 'upload',
              label: labelFromFileName(legacy.fileName),
              savedAt: legacy.savedAt,
            };
            await tx.objectStore(STORE_NAME).put(migrated);
          }
          db.deleteObjectStore(LEGACY_STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export function labelFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'Signature';
}

export async function saveSignature(
  blob: Blob,
  meta: { fileName: string; kind: SignatureKind; label: string },
): Promise<StoredSignature> {
  const record: StoredSignature = {
    id: crypto.randomUUID(),
    blob,
    fileName: meta.fileName,
    mimeType: blob.type,
    kind: meta.kind,
    label: meta.label,
    savedAt: Date.now(),
  };
  const db = await getDb();
  await db.put(STORE_NAME, record);
  return record;
}

/** Every saved signature, oldest first. */
export async function loadSignatures(): Promise<StoredSignature[]> {
  const db = await getDb();
  const all: StoredSignature[] = await db.getAll(STORE_NAME);
  return all.sort((a, b) => a.savedAt - b.savedAt);
}

export async function deleteSignature(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}
