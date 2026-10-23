import { get, writable } from 'svelte/store';
import {
  saveSignature,
  loadSignatures,
  deleteSignature,
  type SignatureKind,
  type StoredSignature,
} from '../lib/signature/db';
import { persistedWritable } from '../lib/utils/persist';

/** A saved signature, ready to show and place. */
export interface SignatureEntry extends StoredSignature {
  /** Object URL for <img>; revoked when the signature is deleted. */
  previewUrl: string;
  /** Natural pixel dimensions of the image, used to keep its aspect ratio. */
  naturalWidth: number;
  naturalHeight: number;
}

export interface SignatureState {
  loading: boolean;
  /** Every saved signature, oldest first. */
  signatures: SignatureEntry[];
  /** The one new placements use — also what the fields below describe. */
  activeId: string | null;
  signature: SignatureEntry | null;
  previewUrl: string | null;
  naturalWidth: number;
  naturalHeight: number;
}

/** Which saved signature is active — just its id, never image data (see persist.ts). */
const activeSignatureId = persistedWritable<string | null>('activeSignatureId', null);

async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

async function toEntry(stored: StoredSignature): Promise<SignatureEntry | null> {
  try {
    const { width, height } = await readDimensions(stored.blob);
    return { ...stored, previewUrl: URL.createObjectURL(stored.blob), naturalWidth: width, naturalHeight: height };
  } catch {
    // An unreadable image can't be placed — leave it out rather than break the list.
    return null;
  }
}

function withActive(signatures: SignatureEntry[], wantedId: string | null): SignatureState {
  const active = signatures.find((s) => s.id === wantedId) ?? signatures[signatures.length - 1] ?? null;
  return {
    loading: false,
    signatures,
    activeId: active?.id ?? null,
    signature: active,
    previewUrl: active?.previewUrl ?? null,
    naturalWidth: active?.naturalWidth ?? 0,
    naturalHeight: active?.naturalHeight ?? 0,
  };
}

/**
 * The signature a placement shows. Placements remember which signature they
 * were made with; if that one has since been deleted, the active one stands in.
 */
export function resolveSignature(state: SignatureState, id: string | undefined): SignatureEntry | null {
  return state.signatures.find((s) => s.id === id) ?? state.signature;
}

function createSignatureStore() {
  const store = writable<SignatureState>({
    loading: true,
    signatures: [],
    activeId: null,
    signature: null,
    previewUrl: null,
    naturalWidth: 0,
    naturalHeight: 0,
  });
  const { subscribe, update, set } = store;

  // Remember the active choice across visits.
  subscribe((state) => {
    if (!state.loading) activeSignatureId.set(state.activeId);
  });

  async function init() {
    const stored = await loadSignatures().catch(() => []);
    const entries = (await Promise.all(stored.map(toEntry))).filter((e): e is SignatureEntry => e !== null);
    set(withActive(entries, get(activeSignatureId)));
  }

  /** Saves a new signature and makes it the active one. */
  async function add(blob: Blob, meta: { fileName: string; kind: SignatureKind; label: string }) {
    const stored = await saveSignature(blob, meta);
    const entry = await toEntry(stored);
    if (!entry) {
      await deleteSignature(stored.id);
      throw new Error("That image couldn't be read.");
    }
    update((state) => withActive([...state.signatures, entry], entry.id));
    return entry;
  }

  async function remove(id: string) {
    await deleteSignature(id);
    update((state) => {
      const removed = state.signatures.find((s) => s.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return withActive(
        state.signatures.filter((s) => s.id !== id),
        state.activeId === id ? null : state.activeId,
      );
    });
  }

  function setActive(id: string) {
    update((state) => (state.signatures.some((s) => s.id === id) ? withActive(state.signatures, id) : state));
  }

  function entryFor(id: string | undefined): SignatureEntry | null {
    return resolveSignature(get(store), id);
  }

  /** For export: each placement's signature image, or null if no signature is saved at all. */
  function lookup(): ((signatureId: string) => Blob | undefined) | null {
    if (!get(store).signature) return null;
    return (signatureId) => entryFor(signatureId)?.blob;
  }

  // Kick off the initial load; consumers can show a spinner via `loading`.
  init();

  return { subscribe, add, remove, setActive, entryFor, lookup };
}

export const signatureStore = createSignatureStore();
