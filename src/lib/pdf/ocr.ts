import * as pdfjsLib from 'pdfjs-dist';
import type { Page as TesseractPage, Worker as TesseractWorker } from 'tesseract.js';
import { getTotalRotation, type PdfDocument } from './loader';
import type { CaptureArea } from './screenshot';

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
// An area is rendered at up to twice that, so small print in it reads better.
const AREA_MAX_SCALE = 2 * OCR_SCALE;
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

/**
 * Renders a page the way it's shown, or just `area` of it (fractions of the
 * page as shown), onto a canvas of its own. The viewport maps that canvas's
 * pixels back to the page.
 */
async function renderForOcr(pdf: PdfDocument, pageNumber: number, extraRotation: number, area?: CaptureArea) {
  const page = await pdf.getPage(pageNumber);
  const rotation = getTotalRotation(page, extraRotation);
  const base = page.getViewport({ scale: 1, rotation });
  const box = area ?? { x: 0, y: 0, width: 1, height: 1 };
  const longest = Math.max(box.width * base.width, box.height * base.height);
  const scale = Math.min(area ? AREA_MAX_SCALE : OCR_SCALE, MAX_SIDE_PX / longest);
  const offsetX = -Math.round(box.x * base.width * scale);
  const offsetY = -Math.round(box.y * base.height * scale);
  const viewport = page.getViewport({ scale, rotation, offsetX, offsetY });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.width * base.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * base.height * scale));
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('Canvas 2D context unavailable');
  canvasContext.fillStyle = '#fff';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  return { page, canvas, viewport };
}

/** The words Tesseract found, mapped from canvas pixels to the page through `viewport`. */
function wordsOf(data: TesseractPage, viewport: pdfjsLib.PageViewport): OcrWord[] {
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
  return words;
}

/** The text of the recognized lines, one per line, a blank line between paragraphs. */
function textOf(data: TesseractPage): string {
  return (data.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .map((paragraph) =>
      paragraph.lines
        .map((line) =>
          line.words
            .filter((w) => w.text.trim() && w.confidence >= MIN_CONFIDENCE)
            .map((w) => w.text.trim())
            .join(' '),
        )
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

type TextBox = { origin: [number, number]; along: [number, number]; up: [number, number] };

/** Where the page's own text items sit, as parallelograms in PDF space. */
async function existingTextBoxes(page: pdfjsLib.PDFPageProxy): Promise<TextBox[]> {
  const content = await page.getTextContent();
  const boxes: TextBox[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const alongLength = Math.hypot(a, b) || 1;
    const upLength = Math.hypot(c, d) || 1;
    const height = item.height || upLength;
    boxes.push({
      origin: [e, f],
      along: [(a / alongLength) * item.width, (b / alongLength) * item.width],
      up: [(c / upLength) * height, (d / upLength) * height],
    });
  }
  return boxes;
}

function insideBox([x, y]: [number, number], { origin, along, up }: TextBox): boolean {
  // Solve point = origin + s·along + t·up, inside when both are in 0..1.
  const det = along[0] * up[1] - along[1] * up[0];
  if (Math.abs(det) < 1e-6) return false;
  const dx = x - origin[0];
  const dy = y - origin[1];
  const s = (dx * up[1] - dy * up[0]) / det;
  const t = (along[0] * dy - along[1] * dx) / det;
  return s >= 0 && s <= 1 && t >= -0.1 && t <= 1.1;
}

function wordCentre(word: OcrWord): [number, number] {
  const halfUp = [(word.up[0] - word.start[0]) / 2, (word.up[1] - word.start[1]) / 2];
  return [(word.start[0] + word.end[0]) / 2 + halfUp[0], (word.start[1] + word.end[1]) / 2 + halfUp[1]];
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
      results.push({ page: pageNumber, words: wordsOf(data, viewport) });
      canvas.width = canvas.height = 0; // let the browser free the bitmap right away
    }
  } finally {
    await worker.terminate();
  }
  return results;
}

export interface OcrAreaResult {
  /** Everything read in the area, as plain text (empty when nothing was found). */
  text: string;
  /** The words that aren't already text on the page, ready for `addInvisibleText`. */
  newWords: OcrWord[];
}

/**
 * Recognizes the text in one area of a page (fractions of the page as
 * shown), even on a page that has text of its own, such as a picture of
 * text in a typed document. Words that are already real text are left out
 * of `newWords`, so they don't turn up twice in Find.
 */
export async function recognizeArea(
  pdf: PdfDocument,
  pageNumber: number,
  extraRotation: number,
  area: CaptureArea,
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrAreaResult> {
  onProgress({ phase: 'loading' });
  const worker = await createOcrWorker();
  try {
    onProgress({ phase: 'recognizing', done: 0, total: 1 });
    const { page, canvas, viewport } = await renderForOcr(pdf, pageNumber, extraRotation, area);
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    canvas.width = canvas.height = 0;
    const existing = await existingTextBoxes(page);
    const newWords = wordsOf(data, viewport).filter((word) => {
      const centre = wordCentre(word);
      return !existing.some((box) => insideBox(centre, box));
    });
    return { text: textOf(data), newWords };
  } finally {
    await worker.terminate();
  }
}
