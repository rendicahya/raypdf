import * as pdfjsLib from 'pdfjs-dist';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { getTotalRotation, type PdfDocument } from './loader';

/**
 * Text recognition (OCR) for scanned pages, with tesseract.js running in a
 * worker. Nothing leaves the browser: the engine and the English language
 * data are served with RayPDF itself (see `ocrFiles` in vite.config.ts) and
 * only downloaded the first time text is recognized. The words found are
 * written into the PDF as invisible text (`addInvisibleText` in pageOps.ts),
 * so pdf.js's text layer, Find, and copying work on them like any other text.
 */

/** A recognized word, in the page's own PDF coordinates (points). */
export interface OcrWord {
  text: string;
  /** Where its baseline starts and ends. */
  start: [number, number];
  end: [number, number];
  /** One font size above `start`: the direction and height of its letters. */
  up: [number, number];
}

export interface OcrPage {
  /** 1-indexed. */
  page: number;
  words: OcrWord[];
}

export type OcrProgress =
  | { phase: 'loading' }
  | { phase: 'recognizing'; done: number; total: number };

// About 300 dpi, the resolution Tesseract is trained for, but capped so a
// very large page doesn't make a huge canvas.
const OCR_SCALE = 300 / 72;
const MAX_SIDE_PX = 4200;
// Below this (0 to 100), a "word" is usually a smudge, a stamp, or part of a signature.
const MIN_CONFIDENCE = 30;
// The share of the font size that sits above the baseline, roughly, for typical text.
const ASCENT = 0.75;

const OCR_BASE = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;

async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker, OEM } = await import('tesseract.js');
  return createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${OCR_BASE}worker.min.js`,
    corePath: `${OCR_BASE}tesseract-core-simd-lstm.wasm.js`,
    langPath: OCR_BASE.replace(/\/$/, ''),
  });
}

/** Whether a page already has text of its own, so there's nothing to recognize. */
export async function pageHasText(pdf: PdfDocument, pageNumber: number): Promise<boolean> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.some((item) => 'str' in item && item.str.trim() !== '');
}

async function renderForOcr(pdf: PdfDocument, pageNumber: number, extraRotation: number) {
  const page = await pdf.getPage(pageNumber);
  const rotation = getTotalRotation(page, extraRotation);
  const base = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(OCR_SCALE, MAX_SIDE_PX / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('Canvas 2D context unavailable');
  canvasContext.fillStyle = '#fff';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  return { canvas, viewport };
}

/**
 * Recognizes the text on the given pages (1-indexed), rendered the way
 * they're shown (`extraRotation` being the view's own rotation), so upright
 * text on screen is upright for Tesseract too. `isCancelled` is checked
 * between pages; a cancelled run returns what it has so far.
 */
export async function recognizePages(
  pdf: PdfDocument,
  pages: number[],
  extraRotation: number,
  onProgress: (progress: OcrProgress) => void,
  isCancelled: () => boolean = () => false,
): Promise<OcrPage[]> {
  onProgress({ phase: 'loading' });
  const worker = await createOcrWorker();
  const results: OcrPage[] = [];
  try {
    for (const [i, pageNumber] of pages.entries()) {
      if (isCancelled()) break;
      onProgress({ phase: 'recognizing', done: i, total: pages.length });
      const { canvas, viewport } = await renderForOcr(pdf, pageNumber, extraRotation);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const toPdf = (x: number, y: number) => viewport.convertToPdfPoint(x, y) as [number, number];

      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const { baseline, bbox: lineBox } = line;
            const slope = baseline.x1 !== baseline.x0 ? (baseline.y1 - baseline.y0) / (baseline.x1 - baseline.x0) : 0;
            for (const word of line.words) {
              const text = word.text.trim();
              if (!text || word.confidence < MIN_CONFIDENCE) continue;
              const { x0, x1 } = word.bbox;
              let baseY = baseline.y0 + (x0 - baseline.x0) * slope;
              // A baseline outside its own line is a recognition glitch: fall back to the word's bottom.
              if (!(baseY > lineBox.y0 && baseY <= lineBox.y1 + 2)) baseY = word.bbox.y1;
              const size = Math.max((baseY - lineBox.y0) / ASCENT, 1);
              words.push({
                text,
                start: toPdf(x0, baseY),
                end: toPdf(x1, baseY),
                up: toPdf(x0, baseY - size),
              });
            }
          }
        }
      }
      results.push({ page: pageNumber, words });
      canvas.width = canvas.height = 0; // let the browser free the bitmap right away
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
