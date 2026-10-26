import { writable, derived, get, type Writable } from 'svelte/store';
import { editorStore, getActiveDocument } from './editor';
import { getCachedPdf } from '../lib/pdf/docCache';
import { pageHasText, recognizePages, recognizeArea, type OcrProgress } from '../lib/pdf/ocr';
import type { CaptureArea } from '../lib/pdf/screenshot';
import { OCR_LANGUAGES, type OcrLanguage } from '../lib/pdf/ocrLanguages';
import { persistedWritable } from '../lib/utils/persist';
import { redactMode } from './redact';
import { textToolMode } from './textTool';
import { commentToolMode } from './commentTool';
import { clickToPlaceMode } from './clickToPlace';
import { signatureToolMode } from './signatureTool';
import { textSelectMode } from './textSelect';
import { screenshotToolMode } from './screenshotTool';
import { pageNumbersToolMode } from './pageNumbersTool';
import { pageWatermarkToolMode } from './pageWatermarkTool';
import { shapeToolMode } from './shapeTool';
import { cropToolMode } from './cropTool';

/**
 * Recognize text (OCR) on the active document's scanned pages, or in an area
 * the user drags on a page. One run at a time; its progress and outcome are
 * shown by OcrStatus.
 */

export type OcrStatus =
  | { state: 'idle' }
  /** Waiting for the user to drag a rectangle on a page (PDFViewer draws it). */
  | { state: 'selecting' }
  | { state: 'checking' }
  | { state: 'loading' }
  | { state: 'recognizing'; done: number; total: number }
  /** `text`, when set, is what was read in an area, offered for copying. */
  | { state: 'finished'; message: string; error?: boolean; text?: string };

export const ocrStatus = writable<OcrStatus>({ state: 'idle' });

/** The language pages are read in, remembered for next time. */
export const ocrLanguage = persistedWritable<OcrLanguage>('ocrLanguage', 'eng');
// A language that's no longer offered falls back to English.
if (!OCR_LANGUAGES.some((l) => l.code === get(ocrLanguage))) ocrLanguage.set('eng');

/** Whether the page is waiting for an area to be dragged. It works like a tool: turning on another tool ends it. */
export const ocrAreaMode = derived(ocrStatus, (s) => s.state === 'selecting');

const OTHER_TOOLS: Writable<boolean>[] = [
  redactMode,
  textToolMode,
  commentToolMode,
  clickToPlaceMode,
  signatureToolMode,
  textSelectMode,
  screenshotToolMode,
  pageNumbersToolMode,
  pageWatermarkToolMode,
  shapeToolMode,
  cropToolMode,
];
for (const tool of OTHER_TOOLS) {
  tool.subscribe((on) => {
    if (on) stopAreaSelection();
  });
}

let runId = 0;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;

function finish(message: string, error = false, text?: string) {
  ocrStatus.set({ state: 'finished', message, error, text });
  clearTimeout(dismissTimer);
  // Text to copy stays until it's closed.
  if (!error && !text) dismissTimer = setTimeout(dismissOcrStatus, 6000);
}

function failed(e: unknown) {
  console.error(e);
  const offline = !navigator.onLine ? ' Text recognition needs a connection the first time it is used.' : '';
  finish(`Text recognition failed.${offline}`, true);
}

export function isOcrRunning(status: OcrStatus): boolean {
  return status.state === 'checking' || status.state === 'loading' || status.state === 'recognizing';
}

function showProgress(cancelled: () => boolean) {
  return (progress: OcrProgress) => {
    if (cancelled()) return;
    ocrStatus.set(
      progress.phase === 'loading'
        ? { state: 'loading' }
        : { state: 'recognizing', done: progress.done, total: progress.total },
    );
  };
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

    const results = await recognizePages(pdf, todo, rotation, get(ocrLanguage), showProgress(cancelled), cancelled);
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
    if (!cancelled()) failed(e);
  }
}

/** Waits for the user to drag a rectangle on a page; the other tools turn off. */
export function startAreaSelection() {
  if (isOcrRunning(get(ocrStatus))) return;
  for (const tool of OTHER_TOOLS) tool.set(false);
  clearTimeout(dismissTimer);
  ocrStatus.set({ state: 'selecting' });
}

export function stopAreaSelection() {
  if (get(ocrStatus).state === 'selecting') ocrStatus.set({ state: 'idle' });
}

/**
 * Recognizes the text in an area of a page of the active document (fractions
 * of the page as shown), adds what isn't text yet to the page as invisible
 * text, and offers all of it for copying.
 */
export async function recognizeTextInArea(page: number, area: CaptureArea): Promise<void> {
  const doc = getActiveDocument(get(editorStore));
  if (!doc || isOcrRunning(get(ocrStatus))) return;
  const myRun = ++runId;
  const cancelled = () => myRun !== runId;
  clearTimeout(dismissTimer);
  ocrStatus.set({ state: 'loading' });

  try {
    const { id, file, rotation } = doc;
    const pdf = await getCachedPdf(id, file);
    const { text, newWords } = await recognizeArea(pdf, page, rotation, area, get(ocrLanguage), showProgress(cancelled));
    if (cancelled()) return;
    if (!text) {
      finish('No text was found in this area.');
      return;
    }
    if (newWords.length === 0) {
      finish('This text was already on the page, so nothing was added.', false, text);
      return;
    }
    const applied = await editorStore.addRecognizedText(id, file, [{ page, words: newWords }]);
    if (cancelled()) return;
    if (!applied) {
      finish('The page changed while its text was being recognized, so nothing was added. Try again.', true);
      return;
    }
    finish('Text recognized. You can now find, select, and copy it.', false, text);
  } catch (e) {
    if (!cancelled()) failed(e);
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
