/**
 * Turns a drawn or typed signature into a transparent PNG — the same kind of
 * image an uploaded scan is, so placing, watermarking, and export treat all
 * three alike. Canvas only; nothing leaves the browser.
 */

import '@fontsource/great-vibes/latin-400.css';
import '@fontsource/dancing-script/latin-400.css';
import '@fontsource/sacramento/latin-400.css';
import '@fontsource/caveat/latin-400.css';

/** Handwriting fonts for typed signatures — bundled with the app, so they work offline. */
export const SIGNATURE_FONTS = ['Great Vibes', 'Dancing Script', 'Sacramento', 'Caveat'] as const;
export type SignatureFont = (typeof SIGNATURE_FONTS)[number];

export const INK_COLORS = [
  { value: '#111827', label: 'Black ink' },
  { value: '#1d4ed8', label: 'Blue ink' },
] as const;

/**
 * Crops a canvas to its inked (non-transparent) pixels plus `padding`, as a
 * PNG. Resolves null if nothing has been drawn.
 */
export function trimToPng(canvas: HTMLCanvasElement, padding = 12): Promise<Blob | null> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const { width, height } = canvas;
  const alpha = ctx.getImageData(0, 0, width, height).data;

  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return Promise.resolve(null);

  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding);
  bottom = Math.min(height - 1, bottom + padding);

  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')?.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/png'));
}

/** Renders `text` in a handwriting font as a trimmed transparent PNG, large enough to print sharply. */
export async function renderTypedSignature(text: string, font: SignatureFont, color: string): Promise<Blob | null> {
  const fontSize = 160;
  const css = `${fontSize}px "${font}"`;
  // The font is only fetched once something asks for it.
  await document.fonts.load(css, text);

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = css;
  const textWidth = measure.measureText(text).width;

  // Generous room around the text: script fonts swash well past their advance width.
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textWidth + fontSize * 2);
  canvas.height = Math.ceil(fontSize * 2.4);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = css;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, fontSize, canvas.height / 2);
  return trimToPng(canvas);
}
