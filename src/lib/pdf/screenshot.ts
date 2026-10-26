import { renderPageToCanvas, type PdfDocument } from './loader';
import type { FormWidgetKind } from './forms';
import type { MarkupPaint } from './highlight';
import type { PlacedShape, PlacedText } from '../../stores/editor';
import { insetBox, lineGeometry } from './shapes';
import { FONT_FAMILY_CSS, SCRIPT_SCALE, SCRIPT_SHIFT } from '../../stores/textTool';
import { pageNumberAnchor, type PageLabel } from './pageNumbers';
import { drawWatermarkOnCanvas, type PageWatermarkSettings } from './pageWatermark';
import type { StoredImage } from '../../stores/images';

/** An area of the page as fractions (0–1) of its width/height, so it's independent of zoom. */
export interface CaptureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Captures are rendered fresh at their own scale (3 unless the user picks
// another) rather than copied off the on-screen canvas, so a screenshot taken
// while zoomed out is still crisp.
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
  /** Highlights, underlines, and strikethroughs, already resolved to what to paint (see markupPaint). */
  markups: MarkupPaint[];
  redactions: Box[];
  /** Each placed signature with its image, visible watermark already applied (see lib/watermark/visible.ts). */
  signatures: (Box & { image: Blob; angle?: number })[];
  texts: PlacedText[];
  shapes?: PlacedShape[];
  /** Each placed image with its picture. */
  images?: (Box & { opacity: number; image: Blob })[];
  /** This page's number and header and footer text (`pageLabels`). */
  labels?: PageLabel[];
  /** The document's watermark, with its picture if it has one. */
  watermark?: { settings: PageWatermarkSettings; image?: StoredImage } | null;
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
  scale = CAPTURE_SCALE,
): Promise<Blob> {
  const pageCanvas = document.createElement('canvas');
  await renderPageToCanvas(pdfDoc, pageNumber, pageCanvas, scale, rotation);
  if (overlays) await drawOverlays(pageCanvas, overlays, scale);

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

async function drawOverlays(canvas: HTMLCanvasElement, overlays: CaptureOverlays, scale: number): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.save();
  // Everything below is drawn in the editor's own on-screen pixel units.
  ctx.scale(scale / overlays.renderScale, scale / overlays.renderScale);

  // Highlights are multiplied over the page like a highlighter, so the text stays readable.
  for (const m of overlays.markups) {
    ctx.globalCompositeOperation = m.multiply ? 'multiply' : 'source-over';
    ctx.fillStyle = m.color;
    ctx.fillRect(m.x, m.y, m.width, m.height);
  }
  ctx.globalCompositeOperation = 'source-over';

  for (const field of overlays.fields) drawField(ctx, field);

  ctx.fillStyle = '#000';
  for (const box of overlays.redactions) ctx.fillRect(box.x, box.y, box.width, box.height);

  // The watermark, over the page and under everything placed on it, as export draws it.
  if (overlays.watermark) {
    const { settings, image } = overlays.watermark;
    await drawWatermarkOnCanvas(ctx, settings, image, canvas.width / scale, canvas.height / scale, overlays.renderScale);
  }

  // Images, then shapes, under signatures and text, in the order export draws them.
  for (const placed of overlays.images ?? []) {
    const bitmap = await createImageBitmap(placed.image);
    ctx.globalAlpha = placed.opacity;
    ctx.drawImage(bitmap, placed.x, placed.y, placed.width, placed.height);
    bitmap.close();
  }
  ctx.globalAlpha = 1;
  for (const s of overlays.shapes ?? []) drawShape(ctx, s);

  const bitmaps = new Map<Blob, ImageBitmap>();
  for (const box of overlays.signatures) {
    let bitmap = bitmaps.get(box.image);
    if (!bitmap) {
      bitmap = await createImageBitmap(box.image);
      bitmaps.set(box.image, bitmap);
    }
    // object-fit: contain, like the editor shows it.
    const scale = Math.min(box.width / bitmap.width, box.height / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    // Turned about its centre, as the editor shows it.
    ctx.save();
    ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
    if (box.angle) ctx.rotate((box.angle * Math.PI) / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  bitmaps.forEach((b) => b.close());

  for (const t of overlays.texts) drawTextBox(ctx, t);

  for (const label of overlays.labels ?? []) {
    const unit = overlays.renderScale;
    const factor = overlays.renderScale / scale;
    ctx.font = `${label.fontSize * unit}px ${FONT_FAMILY_CSS[label.font]}`;
    ctx.fillStyle = label.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const width = ctx.measureText(label.text).width;
    const { x, baseline } = pageNumberAnchor(label, canvas.width * factor, canvas.height * factor, width, unit);
    ctx.fillText(label.text, x, baseline);
  }

  ctx.restore();
}

function setSpacing(ctx: CanvasRenderingContext2D, letterPx: number, wordPx: number): void {
  // Not in every browser yet; without them, text is drawn with normal spacing.
  const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };
  if ('letterSpacing' in withSpacing) withSpacing.letterSpacing = `${letterPx}px`;
  if ('wordSpacing' in withSpacing) withSpacing.wordSpacing = `${wordPx}px`;
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

interface LineOptions {
  /** Multiple of `lineSize`. */
  lineHeight?: number;
  /** Font size that sets the line pitch, if the glyphs are drawn smaller (superscript/subscript). */
  lineSize?: number;
  /** Vertical offset of the glyphs from each line's centre, in pixels. */
  shift?: number;
  underline?: boolean;
  strikethrough?: boolean;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: Box,
  fontSize: number,
  align: 'left' | 'center' | 'right',
  top: number,
  { lineHeight = LINE_HEIGHT, lineSize = fontSize, shift = 0, underline = false, strikethrough = false }: LineOptions = {},
): void {
  const pitch = lineSize * lineHeight;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  const x = align === 'left' ? box.x : align === 'center' ? box.x + box.width / 2 : box.x + box.width;
  const thickness = Math.max(1, fontSize / 15);
  lines.forEach((line, i) => {
    const y = top + pitch * (i + 0.5) + shift;
    ctx.fillText(line, x, y);
    if ((underline || strikethrough) && line) {
      const width = ctx.measureText(line).width;
      const left = align === 'left' ? x : align === 'center' ? x - width / 2 : x - width;
      if (underline) ctx.fillRect(left, y + fontSize * 0.45, width, thickness);
      if (strikethrough) ctx.fillRect(left, y - thickness / 2, width, thickness);
    }
  });
}

function drawTextBox(ctx: CanvasRenderingContext2D, t: PlacedText): void {
  if (!t.text.trim() && !t.background) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x, t.y, t.width, t.height);
  ctx.clip();
  ctx.globalAlpha = t.opacity;
  if (t.background) {
    ctx.fillStyle = t.background;
    ctx.fillRect(t.x, t.y, t.width, t.height);
  }
  const size = t.script === 'normal' ? t.fontSize : t.fontSize * SCRIPT_SCALE;
  ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 700 : 400} ${size}px ${FONT_FAMILY_CSS[t.fontFamily]}`;
  ctx.fillStyle = t.color;
  setSpacing(ctx, t.letterSpacing, t.wordSpacing);
  // Smaller glyphs drawn centred sit higher than the normal baseline, so
  // they're first brought down onto it, then shifted like the editor does.
  const shift = (t.fontSize - size) * 0.3 + SCRIPT_SHIFT[t.script] * t.fontSize;
  drawLines(ctx, wrapLines(ctx, t.text, t.width), t, size, t.align, t.y, {
    lineHeight: t.lineHeight,
    lineSize: t.fontSize,
    shift,
    underline: t.underline,
    strikethrough: t.strikethrough,
  });
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, s: PlacedShape): void {
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.strokeStyle = s.stroke;
  ctx.lineWidth = s.strokeWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (s.kind === 'line' || s.kind === 'arrow') {
    const { start, end, head } = lineGeometry(s);
    for (const [a, b] of [[start, end], ...head]) {
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
    if (s.strokeWidth > 0) ctx.stroke();
  } else {
    const box = insetBox(s);
    if (s.kind === 'rectangle') ctx.rect(box.x, box.y, box.width, box.height);
    else ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill();
    }
    if (s.strokeWidth > 0) ctx.stroke();
  }
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
