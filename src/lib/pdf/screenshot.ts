import { renderPageToCanvas, type PdfDocument } from './loader';
import type { FormWidgetKind } from './forms';
import type { PlacedText } from '../../stores/editor';
import { FONT_FAMILY_CSS } from '../../stores/textTool';

/** An area of the page as fractions (0–1) of its width/height, so it's independent of zoom. */
export interface CaptureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Captures are rendered fresh at a fixed, generous scale rather than copied
// off the on-screen canvas, so a screenshot taken while zoomed out is still crisp.
const CAPTURE_SCALE = 3;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A form field's current value, as shown over the page. */
export interface CaptureField extends Box {
  kind: FormWidgetKind;
  /** Text to draw (text/select fields), or whether the box is ticked (checkbox/radio). */
  value: string | boolean;
  multiLine: boolean;
  /** In on-screen pixels. */
  fontSize: number;
  align: 'left' | 'center' | 'right';
}

/**
 * The editor's unsaved edits for one page, so a capture shows what the user
 * sees rather than just the original PDF. Boxes are in on-screen canvas
 * pixels at `renderScale`, exactly as the editor stores them.
 */
export interface CaptureOverlays {
  renderScale: number;
  fields: CaptureField[];
  redactions: Box[];
  signatures: Box[];
  /** The signature image with its visible watermark already applied (see lib/watermark/visible.ts). */
  signatureImage: Blob | null;
  texts: PlacedText[];
}

/**
 * Renders a page (with the user's extra rotation applied) and returns it, or
 * the given area of it, as a PNG. With `overlays`, the editor's placed
 * signatures, text, redactions, and form values are drawn on top, the same
 * way they'll appear in the exported PDF. (Comments are left out: they're
 * notes in the PDF, not part of the page.)
 */
export async function capturePage(
  pdfDoc: PdfDocument,
  pageNumber: number,
  rotation: number,
  area: CaptureArea | null,
  overlays: CaptureOverlays | null = null,
): Promise<Blob> {
  const pageCanvas = document.createElement('canvas');
  await renderPageToCanvas(pdfDoc, pageNumber, pageCanvas, CAPTURE_SCALE, rotation);
  if (overlays) await drawOverlays(pageCanvas, overlays);

  let output = pageCanvas;
  if (area) {
    const sx = Math.round(area.x * pageCanvas.width);
    const sy = Math.round(area.y * pageCanvas.height);
    const sw = Math.max(1, Math.round(area.width * pageCanvas.width));
    const sh = Math.max(1, Math.round(area.height * pageCanvas.height));
    output = document.createElement('canvas');
    output.width = sw;
    output.height = sh;
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  return new Promise((resolve, reject) =>
    output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to create the image'))), 'image/png'),
  );
}

const LINE_HEIGHT = 1.2; // matches the editor's text boxes

async function drawOverlays(canvas: HTMLCanvasElement, overlays: CaptureOverlays): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.save();
  // Everything below is drawn in the editor's own on-screen pixel units.
  ctx.scale(CAPTURE_SCALE / overlays.renderScale, CAPTURE_SCALE / overlays.renderScale);

  for (const field of overlays.fields) drawField(ctx, field);

  ctx.fillStyle = '#000';
  for (const box of overlays.redactions) ctx.fillRect(box.x, box.y, box.width, box.height);

  if (overlays.signatureImage && overlays.signatures.length > 0) {
    const bitmap = await createImageBitmap(overlays.signatureImage);
    for (const box of overlays.signatures) {
      // object-fit: contain, like the editor shows it.
      const scale = Math.min(box.width / bitmap.width, box.height / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.drawImage(bitmap, box.x + (box.width - w) / 2, box.y + (box.height - h) / 2, w, h);
    }
    bitmap.close();
  }

  for (const t of overlays.texts) drawTextBox(ctx, t);

  ctx.restore();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  // Not in every browser yet; without it, text is drawn with normal spacing.
  const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in withSpacing) withSpacing.letterSpacing = `${px}px`;
}

/** Splits text into lines that fit `maxWidth`, wrapping at spaces (or mid-word if a word alone is too wide). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (line === '' || ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
      while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: Box,
  fontSize: number,
  align: 'left' | 'center' | 'right',
  top: number,
  underline = false,
): void {
  const lineHeight = fontSize * LINE_HEIGHT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  const x = align === 'left' ? box.x : align === 'center' ? box.x + box.width / 2 : box.x + box.width;
  lines.forEach((line, i) => {
    const y = top + lineHeight * (i + 0.5);
    ctx.fillText(line, x, y);
    if (underline && line) {
      const width = ctx.measureText(line).width;
      const left = align === 'left' ? x : align === 'center' ? x - width / 2 : x - width;
      ctx.fillRect(left, y + fontSize * 0.45, width, Math.max(1, fontSize / 15));
    }
  });
}

function drawTextBox(ctx: CanvasRenderingContext2D, t: PlacedText): void {
  if (!t.text.trim()) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x, t.y, t.width, t.height);
  ctx.clip();
  ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 700 : 400} ${t.fontSize}px ${FONT_FAMILY_CSS[t.fontFamily]}`;
  ctx.fillStyle = t.color;
  setLetterSpacing(ctx, t.letterSpacing);
  drawLines(ctx, wrapLines(ctx, t.text, t.width), t, t.fontSize, t.align, t.y, t.underline);
  ctx.restore();
}

function drawField(ctx: CanvasRenderingContext2D, field: CaptureField): void {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  if (field.kind === 'checkbox' || field.kind === 'radio') {
    if (field.value === true) {
      const size = Math.min(field.width, field.height);
      const cx = field.x + field.width / 2;
      const cy = field.y + field.height / 2;
      if (field.kind === 'radio') {
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.25, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = Math.max(1, size * 0.12);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.28, cy);
        ctx.lineTo(cx - size * 0.08, cy + size * 0.22);
        ctx.lineTo(cx + size * 0.3, cy - size * 0.24);
        ctx.stroke();
      }
    }
  } else if (typeof field.value === 'string' && field.value !== '') {
    ctx.beginPath();
    ctx.rect(field.x, field.y, field.width, field.height);
    ctx.clip();
    ctx.font = `${field.fontSize}px Helvetica, Arial, sans-serif`;
    const padding = 2;
    const inner = { ...field, x: field.x + padding, width: field.width - padding * 2 };
    const lines = field.multiLine ? wrapLines(ctx, field.value, inner.width) : [field.value];
    // Single-line fields are vertically centered; multi-line ones start at the top.
    const top = field.multiLine ? field.y + padding : field.y + (field.height - field.fontSize * LINE_HEIGHT) / 2;
    drawLines(ctx, lines, inner, field.fontSize, field.align, top);
  }

  ctx.restore();
}

/**
 * Puts a PNG on the clipboard; returns false if the browser doesn't allow it.
 * Takes the still-rendering image as a promise so this can be called straight
 * from the click handler — browsers only allow clipboard writes during a
 * user gesture, which would have lapsed by the time a big render finishes.
 */
export async function copyImageToClipboard(png: Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
