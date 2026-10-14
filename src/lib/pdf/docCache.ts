import { loadPdf, type PdfDocument } from './loader';

const cache = new Map<string, { file: File; promise: Promise<PdfDocument> }>();

/**
 * Shares one parsed pdf.js document between the main viewer and the page
 * thumbnail sidebar, keyed by our own document id (a File isn't a stable
 * cache key) so the same PDF isn't parsed twice just to render thumbnails.
 * A document's file can be swapped out (e.g. after reordering its pages, or
 * undoing that), so the entry is only reused while it's for the same File.
 */
export function getCachedPdf(id: string, file: File): Promise<PdfDocument> {
  const entry = cache.get(id);
  if (entry && entry.file === file) return entry.promise;
  const promise = loadPdf(file);
  cache.set(id, { file, promise });
  return promise;
}

export function clearCachedPdf(id: string): void {
  cache.delete(id);
}
