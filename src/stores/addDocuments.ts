import { get, writable } from 'svelte/store';
import { editorStore } from './editor';
import { isFileAccepted, dedupeFiles, formatFileSize, MAX_PDF_SIZE_BYTES } from '../lib/utils/fileValidation';
import { DOCUMENT_ACCEPT, toPdfFiles } from '../lib/pdf/importFiles';

/**
 * Adding documents while the editor is open: from the toolbar's add tab,
 * Google Drive, or files dropped anywhere on the editor. Each opens in a tab
 * of its own; what was skipped shows for a few seconds under the toolbar.
 */

export const addDocumentsMessage = writable<string | null>(null);

let messageTimeout: ReturnType<typeof setTimeout> | undefined;

export function showAddDocumentsMessage(message: string | null) {
  clearTimeout(messageTimeout);
  addDocumentsMessage.set(message);
  if (message) messageTimeout = setTimeout(() => addDocumentsMessage.set(null), 4000);
}

export function isDocumentFile(file: File): boolean {
  return isFileAccepted(file, DOCUMENT_ACCEPT);
}

export async function addDocumentFiles(files: File[]) {
  const typeOk = files.filter(isDocumentFile);
  const tooLarge = typeOk.filter((f) => f.size > MAX_PDF_SIZE_BYTES);
  const sized = typeOk.filter((f) => f.size <= MAX_PDF_SIZE_BYTES);
  const { pdfs, messages } = await toPdfFiles(sized);
  const { unique, duplicates } = dedupeFiles(
    pdfs,
    get(editorStore).documents.map((d) => d.file),
  );

  if (tooLarge.length > 0) {
    messages.push(`Skipped (over ${formatFileSize(MAX_PDF_SIZE_BYTES)}): ${tooLarge.map((f) => f.name).join(', ')}`);
  }
  if (duplicates.length > 0) {
    messages.push(`Already added: ${duplicates.map((f) => f.name).join(', ')}`);
  }
  showAddDocumentsMessage(messages.length > 0 ? messages.join(' ') : null);

  if (unique.length > 0) editorStore.addPdfs(unique);
}
