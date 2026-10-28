import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { loadEditablePdf } from './password';

/**
 * Makes a PDF smaller, entirely in the browser:
 *
 *  - Photos and scans (the usual bulk of a large PDF) are scaled down to at
 *    most the level's `maxSide` pixels on their long side and re-encoded as
 *    JPEG at its `quality`.
 *  - Streams stored without any compression are deflated.
 *  - The file is written with object streams, which packs the remaining
 *    small objects together.
 *
 * Text, vector drawings, and fonts are left alone, so text stays sharp and
 * selectable. An image is only replaced if the new version is clearly
 * smaller, and images this can't decode safely (CMYK, masks, unusual bit
 * depths or color spaces) are kept as they are.
 */

export type CompressionLevel = 'low' | 'medium' | 'high';

interface ImageSettings {
  maxSide: number;
  quality: number;
}

/** Low keeps images close to print quality; high is for email and the screen. */
export const COMPRESSION_LEVELS: Record<CompressionLevel, ImageSettings & { label: string; description: string }> = {
  low: { maxSide: 2600, quality: 0.85, label: 'Low', description: 'Best quality, a little smaller' },
  medium: { maxSide: 1800, quality: 0.7, label: 'Medium', description: 'Good quality, much smaller' },
  high: { maxSide: 1100, quality: 0.5, label: 'High', description: 'Smallest file, for screen and email' },
};

/** Re-encoded images must come out at least this much smaller to be used. */
const MIN_SAVING = 0.9;
/** Raw streams below this size aren't worth deflating. */
const MIN_DEFLATE_BYTES = 512;

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
}

const name = (n: string) => PDFName.of(n);

function filterNames(dict: PDFDict): string[] {
  const filter = dict.lookup(name('Filter'));
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) {
    return filter.asArray().map((f) => (f instanceof PDFName ? f.decodeText() : '?'));
  }
  return [];
}

/** Number of color components, or null for color spaces this doesn't handle. */
function colorComponents(dict: PDFDict): 1 | 3 | null {
  const cs = dict.lookup(name('ColorSpace'));
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    return n === 'DeviceRGB' ? 3 : n === 'DeviceGray' ? 1 : null;
  }
  // [/ICCBased stream]: as many components as the profile says.
  if (cs instanceof PDFArray && cs.size() === 2) {
    const kind = cs.lookup(0);
    const profile = cs.lookup(1);
    if (kind instanceof PDFName && kind.decodeText() === 'ICCBased' && profile instanceof PDFRawStream) {
      const n = profile.dict.lookup(name('N'));
      if (n instanceof PDFNumber) return n.asNumber() === 3 ? 3 : n.asNumber() === 1 ? 1 : null;
    }
  }
  return null;
}

function numberOf(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookup(name(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToJpeg(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob =
    canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      : await canvas.convertToBlob({ type: 'image/jpeg', quality });
  if (!blob) throw new Error('JPEG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decodes an image XObject to something drawable, or null if it isn't a kind this handles. */
async function decodeImage(stream: PDFRawStream): Promise<ImageBitmap | null> {
  const { dict } = stream;
  const width = numberOf(dict, 'Width');
  const height = numberOf(dict, 'Height');
  const components = colorComponents(dict);
  if (!width || !height || !components || numberOf(dict, 'BitsPerComponent') !== 8) return null;

  const filters = filterNames(dict);
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    return createImageBitmap(new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }));
  }

  if (filters.length === 1 && filters[0] === 'FlateDecode') {
    // pdf-lib's Flate decoder doesn't undo PNG-style predictors.
    const parms = dict.lookup(name('DecodeParms'));
    if (parms instanceof PDFDict && (numberOf(parms, 'Predictor') ?? 1) > 1) return null;

    const raw = decodePDFRawStream(stream).decode();
    if (raw.length < width * height * components) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += components) {
      rgba[i * 4] = raw[j];
      rgba[i * 4 + 1] = raw[components === 3 ? j + 1 : j];
      rgba[i * 4 + 2] = raw[components === 3 ? j + 2 : j];
      rgba[i * 4 + 3] = 255;
    }
    return createImageBitmap(new ImageData(rgba, width, height));
  }

  return null;
}

/** The re-encoded image, or null to keep the original. */
async function recompressImage(stream: PDFRawStream, settings: ImageSettings): Promise<Uint8Array | null> {
  const { dict } = stream;
  // Masks, color-key masks, and custom decode arrays all depend on exact
  // pixel values, which JPEG doesn't keep.
  if (dict.lookup(name('ImageMask')) === PDFBool.True) return null;
  if (dict.lookup(name('Mask')) instanceof PDFArray) return null;
  if (dict.has(name('Decode'))) return null;

  const bitmap = await decodeImage(stream).catch(() => null);
  if (!bitmap) return null;
  try {
    const scale = Math.min(1, settings.maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await canvasToJpeg(canvas, settings.quality);
    if (jpeg.length > stream.contents.length * MIN_SAVING) return null;
    dict.set(name('Width'), PDFNumber.of(width));
    dict.set(name('Height'), PDFNumber.of(height));
    return jpeg;
  } finally {
    bitmap.close();
  }
}

export async function compressPdf(
  input: Uint8Array,
  finish?: (pdfDoc: PDFDocument) => void,
  level: CompressionLevel = 'medium',
): Promise<CompressResult> {
  const settings = COMPRESSION_LEVELS[level];
  const pdfDoc = await loadEditablePdf(input);
  const { context } = pdfDoc;

  // Soft masks (transparency) are images too, but blurring them with JPEG
  // gives soft edges a visible fringe, so they're kept as they are.
  const softMasks = new Set<PDFRef>();
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const smask = obj.dict.get(name('SMask'));
    if (smask instanceof PDFRef) softMasks.add(smask);
  }

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.transform) continue;
    const { dict } = obj;
    const subtype = dict.lookup(name('Subtype'));

    if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
      if (softMasks.has(ref)) continue;
      const jpeg = await recompressImage(obj, settings);
      if (!jpeg) continue;
      const replacement = context.stream(jpeg);
      for (const [key, value] of dict.entries()) {
        if (key === name('DecodeParms') || key === name('Length')) continue;
        replacement.dict.set(key, value);
      }
      replacement.dict.set(name('Filter'), name('DCTDecode'));
      replacement.dict.set(name('ColorSpace'), name('DeviceRGB'));
      replacement.dict.set(name('BitsPerComponent'), PDFNumber.of(8));
      context.assign(ref, replacement);
      continue;
    }

    // Uncompressed streams (content, fonts, and so on). XMP metadata is meant
    // to stay readable as plain text, so it's skipped.
    const type = dict.lookup(name('Type'));
    const isMetadata = type instanceof PDFName && type.decodeText() === 'Metadata';
    if (filterNames(dict).length === 0 && !isMetadata && obj.contents.length >= MIN_DEFLATE_BYTES) {
      const deflated = context.flateStream(obj.contents);
      if (deflated.contents.length >= obj.contents.length) continue;
      for (const [key, value] of dict.entries()) {
        if (key === name('Length')) continue;
        deflated.dict.set(key, value);
      }
      context.assign(ref, deflated);
    }
  }

  finish?.(pdfDoc);
  const saved = await pdfDoc.save({ useObjectStreams: true, updateFieldAppearances: false });
  // Never hand back something bigger than what came in (unless `finish`
  // changed the document, e.g. locked copying, which the input lacks).
  const bytes = finish || saved.length < input.length ? saved : input;
  return { bytes, originalSize: input.length, compressedSize: bytes.length };
}
