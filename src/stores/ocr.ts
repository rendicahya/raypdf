import { writable, get } from 'svelte/store';
import { editorStore, getActiveDocument } from './editor';
import { getCachedPdf } from '../lib/pdf/docCache';
import { pageHasText, recognizePages } from '../lib/pdf/ocr';

/**
 * Recognize text (OCR) on the active document's scanned pages. One run at a
 * time; its progress and outcome are shown by OcrStatus.
 */

export type OcrStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'loading' }
  | { state: 'recognizing'; done: number; total: number }
  | { state: 'finished'; message: string; error?: boolean };

export const ocrStatus = writable<OcrStatus>({ state: 'idle' });

let runId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;

function finish(message: string, error = false) {
  ocrStatus.set({ state: 'finished', message, error });
  clearTimeout(dismissTimer);
  if (!error) dismissTimer = setTimeout(dismissOcrStatus, 6000);
}

export function isOcrRunning(status: OcrStatus): boolean {
  return status.state === 'checking' || status.state === 'loading' || status.state === 'recognizing';
}

/**
 * Recognizes the text on the given pages (1-indexed) of the active document,
 * or on all of them. Pages that already have text are skipped.
 */
export async function recognizeText(pages?: number[]): Promise<void> {
  const doc = getActiveDocument(get(editorStore));
  if (!doc || isOcrRunning(get(ocrStatus))) return;
  const myRun = ++runId;
  const cancelled = () => myRun !== runId;
  clearTimeout(dismissTimer);
  ocrStatus.set({ state: 'checking' });

  try {
    const { id, file, rotation } = doc;
    const pdf = await getCachedPdf(id, file);
    const wanted = pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const todo: number[] = [];
    for (const page of wanted) {
      if (!(await pageHasText(pdf, page))) todo.push(page);
    }
    if (cancelled()) return;
    if (todo.length === 0) {
      finish(wanted.length === 1 ? 'This page already has text.' : 'These pages already have text.');
      return;
    }

    const results = await recognizePages(
      pdf,
      todo,
      rotation,
      (progress) => {
        if (cancelled()) return;
        ocrStatus.set(
          progress.phase === 'loading'
            ? { state: 'loading' }
            : { state: 'recognizing', done: progress.done, total: progress.total },
        );
      },
      cancelled,
    );
    if (cancelled()) return;

    const found = results.filter((r) => r.words.length > 0);
    if (found.length === 0) {
      finish(todo.length === 1 ? 'No text was found on this page.' : 'No text was found on these pages.');
      return;
    }
    const applied = await editorStore.addRecognizedText(id, file, found);
    if (cancelled()) return;
    if (!applied) {
      finish('The pages changed while their text was being recognized, so nothing was added. Try again.', true);
      return;
    }
    const where = found.length === 1 ? `page ${found[0].page}` : `${found.length} pages`;
    finish(`Text recognized on ${where}. You can now find, select, and copy it.`);
  } catch (e) {
    if (cancelled()) return;
    console.error(e);
    const offline = !navigator.onLine ? ' Text recognition needs a connection the first time it is used.' : '';
    finish(`Text recognition failed.${offline}`, true);
  }
}

export function cancelOcr() {
  runId++;
  ocrStatus.set({ state: 'idle' });
}

export function dismissOcrStatus() {
  clearTimeout(dismissTimer);
  ocrStatus.set({ state: 'idle' });
}
