import { loadPdf, isPasswordError, type PdfDocument } from './loader';

const cache = new Map<string, { file: File; promise: Promise<PdfDocument> }>();

// A replaced document may still be finishing a render (the viewer and the
// thumbnails switch over once the new one has loaded), so it's freed after a
// grace period rather than immediately.
const RELEASE_DELAY_MS = 10_000;

function release(promise: Promise<PdfDocument>, delay = 0): void {
  setTimeout(() => {
    promise.then((doc) => doc.destroy()).catch(() => {});
  }, delay);
}

/**
 * Shares one parsed pdf.js document between the main viewer and the page
 * thumbnail sidebar, keyed by our own document id (a File isn't a stable
 * cache key) so the same PDF isn't parsed twice just to render thumbnails.
 * A document's file can be swapped out (e.g. after reordering its pages, or
 * undoing that), so the entry is only reused while it's for the same File.
 * The previous parse is destroyed once replaced, so a large PDF edited many
 * times doesn't keep every old copy in memory.
 */
export function getCachedPdf(id: string, file: File): Promise<PdfDocument> {
  const entry = cache.get(id);
  if (entry && entry.file === file) return entry.promise;
  const promise = loadPdf(file);
  cache.set(id, { file, promise });
  if (entry) release(entry.promise, RELEASE_DELAY_MS);
  return promise;
}

/** Whether a document needs a password before it can be opened. */
export function isLockedPdf(id: string, file: File): Promise<boolean> {
  return getCachedPdf(id, file).then(
    () => false,
    (e) => isPasswordError(e),
  );
}

export function clearCachedPdf(id: string): void {
  const entry = cache.get(id);
  cache.delete(id);
  if (entry) release(entry.promise, RELEASE_DELAY_MS);
}
