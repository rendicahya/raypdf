import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';
import JSZip from 'jszip';
import { getTotalRotation } from './loader';
import { loadEditablePdf } from './password';
import { downloadBlob } from './screenshot';

// The pictures a PDF's pages paint, found by following the operator list's
// transforms, and saved at the resolution stored in the file rather than as
// shown. A plain JPEG (RGB or gray, no mask) is saved byte for byte from the
// file; anything else is saved as a PNG of pdf.js's decoded image, with its
// soft mask already applied, so transparency survives.

// Pictures smaller than this (in points) are decoration, not content.
const MIN_IMAGE_SIZE = 8;

export type Rect = { x: number; y: number; width: number; height: number };

/** A picture painted on a page, in points on the page as shown (scale 1). */
export type PaintedImage = Rect & {
  /** pdf.js's id for an image XObject, or null for an inline image. */
  objId: string | null;
  inline: DecodedImage | null;
  /** Size stored in the PDF, in pixels. */
  pixelWidth: number;
  pixelHeight: number;
};

type DecodedImage = {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
};

/**
 * Where each picture is painted, in paint order (the last one is on top): the
 * current transform is followed through the operator list, and a picture
 * fills the unit square under it.
 */
export function paintedImages(
  operators: { fnArray: number[]; argsArray: unknown[] },
  viewport: { transform: number[]; width: number; height: number },
): PaintedImage[] {
  const { OPS, Util } = pdfjsLib;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const images: PaintedImage[] = [];

  operators.fnArray.forEach((fn, i) => {
    const args = operators.argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = Util.transform(ctm, args as number[]);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args?.[0])) ctm = Util.transform(ctm, args[0] as number[]);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        const m = Util.transform(viewport.transform, ctm);
        const corners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => Util.applyTransform([x, y], m));
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const left = Math.max(0, Math.min(...xs));
        const top = Math.max(0, Math.min(...ys));
        const right = Math.min(viewport.width, Math.max(...xs));
        const bottom = Math.min(viewport.height, Math.max(...ys));
        if (right - left < MIN_IMAGE_SIZE || bottom - top < MIN_IMAGE_SIZE) break;
        const rect = { x: left, y: top, width: right - left, height: bottom - top };
        if (fn === OPS.paintImageXObject) {
          const [objId, w, h] = args as [string, number, number];
          images.push({ ...rect, objId, inline: null, pixelWidth: w, pixelHeight: h });
        } else {
          const inline = args?.[0] as DecodedImage;
          images.push({ ...rect, objId: null, inline, pixelWidth: inline.width, pixelHeight: inline.height });
        }
        break;
      }
    }
  });
  return images;
}

/** The pictures on a page, laid out as shown with the given total rotation. */
export async function pageImages(page: PDFPageProxy, rotation: number): Promise<PaintedImage[]> {
  const viewport = page.getViewport({ scale: 1, rotation });
  return paintedImages(await page.getOperatorList(), viewport);
}

/** The topmost picture under a point (in points on the page as shown), if any. */
export function imageAt(images: PaintedImage[], x: number, y: number): PaintedImage | undefined {
  for (let i = images.length - 1; i >= 0; i--) {
    const r = images[i];
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return r;
  }
  return undefined;
}

/** Same picture, painted again (a logo on every page shares one id). */
function imageKey(image: PaintedImage): string | PaintedImage {
  return image.objId ?? image;
}

/** A page's pictures without repeats, in paint order: what gets numbered and saved. */
export function distinctImages(images: PaintedImage[]): PaintedImage[] {
  const seen = new Set<string | PaintedImage>();
  return images.filter((image) => {
    const key = imageKey(image);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodedImage(page: PDFPageProxy, image: PaintedImage): Promise<DecodedImage> {
  if (image.inline) return Promise.resolve(image.inline);
  const objId = image.objId!;
  // Pictures shared between pages are kept document-wide.
  const objs = objId.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => objs.get(objId, resolve));
}

function imageToCanvas(image: DecodedImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  if (image.bitmap) {
    ctx.drawImage(image.bitmap, 0, 0);
    return canvas;
  }
  const { width, height } = image;
  const src = image.data;
  if (!src) throw new Error('The picture could not be read');
  const out = ctx.createImageData(width, height);
  const dest = out.data;
  const pixels = width * height;
  const { ImageKind } = pdfjsLib;
  if (image.kind === ImageKind.RGBA_32BPP) {
    dest.set(src.subarray(0, pixels * 4));
  } else if (image.kind === ImageKind.RGB_24BPP) {
    for (let i = 0; i < pixels; i++) {
      dest[i * 4] = src[i * 3];
      dest[i * 4 + 1] = src[i * 3 + 1];
      dest[i * 4 + 2] = src[i * 3 + 2];
      dest[i * 4 + 3] = 255;
    }
  } else {
    // One bit per pixel, rows padded to a byte; a set bit is white.
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = src[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
        const i = (y * width + x) * 4;
        dest[i] = dest[i + 1] = dest[i + 2] = v;
        dest[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to create the image'))), 'image/png'),
  );
}

/** The picture as a PNG, at its stored resolution (for copying, which only takes PNG). */
export async function imagePng(page: PDFPageProxy, image: PaintedImage): Promise<Blob> {
  return canvasToPng(imageToCanvas(await decodedImage(page, image)));
}

// The image streams a page uses, by stored size, to tie pdf.js's decoded
// pictures back to the file; null where two pictures share a size, so it
// can't be told which is which.
type PageStreams = Map<string, PDFRawStream | null>;

const sizeKey = (width: number, height: number) => `${width}x${height}`;

function pageStreams(pdf: PDFDocument, pageIndex: number): PageStreams {
  const streams: PageStreams = new Map();
  const seen = new Set<PDFRawStream>();
  const visit = (resources: PDFDict | undefined) => {
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return;
    for (const [, value] of xobjects.entries()) {
      const stream = pdf.context.lookup(value);
      if (!(stream instanceof PDFRawStream) || seen.has(stream)) continue;
      seen.add(stream);
      const subtype = stream.dict.lookup(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Form')) {
        visit(stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict));
      } else if (subtype === PDFName.of('Image')) {
        const width = numberOf(stream.dict.lookup(PDFName.of('Width')));
        const height = numberOf(stream.dict.lookup(PDFName.of('Height')));
        const key = sizeKey(width, height);
        streams.set(key, streams.has(key) ? null : stream);
      }
    }
  };
  try {
    visit(pdf.getPage(pageIndex).node.Resources());
  } catch {
    // Unreadable resources only mean PNGs instead of the original JPEGs.
  }
  return streams;
}

function numberOf(value: PDFObject | undefined): number {
  return value instanceof PDFNumber ? value.asNumber() : -1;
}

/** The stream's bytes, if they are a JPEG any viewer shows the same as the PDF does. */
function plainJpeg(pdf: PDFDocument, stream: PDFRawStream): Uint8Array | null {
  const dict = stream.dict;
  const filter = dict.lookup(PDFName.of('Filter'));
  const filters = filter instanceof PDFArray ? filter.asArray().map((f) => pdf.context.lookup(f)) : [filter];
  if (filters.length !== 1 || filters[0] !== PDFName.of('DCTDecode')) return null;
  for (const key of ['SMask', 'Mask', 'Decode', 'DecodeParms', 'ImageMask']) {
    if (dict.has(PDFName.of(key))) return null;
  }
  if (!plainColorSpace(pdf, dict.lookup(PDFName.of('ColorSpace')))) return null;
  const bytes = stream.contents;
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
}

// CMYK JPEGs (common from print workflows) look inverted outside a PDF.
function plainColorSpace(pdf: PDFDocument, colorSpace: PDFObject | undefined): boolean {
  if (colorSpace === PDFName.of('DeviceRGB') || colorSpace === PDFName.of('DeviceGray')) return true;
  if (colorSpace instanceof PDFArray && colorSpace.lookup(0) === PDFName.of('ICCBased')) {
    const profile = pdf.context.lookup(colorSpace.get(1));
    const n = profile instanceof PDFRawStream ? numberOf(profile.dict.lookup(PDFName.of('N'))) : -1;
    return n === 1 || n === 3;
  }
  return false;
}

/** The file's stream for a picture, if it can be told apart (inline pictures have none). */
function streamFor(streams: PageStreams, image: PaintedImage): PDFRawStream | null {
  return image.objId ? (streams.get(sizeKey(image.pixelWidth, image.pixelHeight)) ?? null) : null;
}

async function imageFile(
  pdf: PDFDocument,
  page: PDFPageProxy,
  image: PaintedImage,
  stream: PDFRawStream | null,
): Promise<{ blob: Blob; extension: 'jpg' | 'png' }> {
  const jpeg = stream && plainJpeg(pdf, stream);
  if (jpeg) return { blob: new Blob([jpeg as BlobPart], { type: 'image/jpeg' }), extension: 'jpg' };
  return { blob: await imagePng(page, image), extension: 'png' };
}

const baseName = (fileName: string) => fileName.replace(/\.pdf$/i, '');

/** Downloads one picture as original_filename_page2_image1.jpg (or .png). */
export async function downloadImage(
  file: File,
  page: PDFPageProxy,
  images: PaintedImage[],
  image: PaintedImage,
): Promise<void> {
  const pdf = await loadEditablePdf(await file.arrayBuffer(), { updateMetadata: false });
  const stream = streamFor(pageStreams(pdf, page.pageNumber - 1), image);
  const { blob, extension } = await imageFile(pdf, page, image, stream);
  const number = distinctImages(images).findIndex((i) => imageKey(i) === imageKey(image)) + 1;
  downloadBlob(blob, `${baseName(file.name)}_page${page.pageNumber}_image${number}.${extension}`);
}

/**
 * Downloads every picture in the document: one file for a single picture,
 * otherwise a ZIP. A picture repeated across pages is saved once, and
 * `skip` leaves out pictures the user hid (under a redaction). Returns how
 * many were saved.
 */
export async function downloadAllImages(
  pdfDoc: PDFDocumentProxy,
  file: File,
  rotation: number,
  skip: (pageNumber: number, image: PaintedImage) => boolean,
): Promise<number> {
  const pdf = await loadEditablePdf(await file.arrayBuffer(), { updateMetadata: false });
  const base = baseName(file.name);
  // pdf.js only shares an id once a picture shows up on a few pages, so a
  // repeat is also recognised by the file's stream.
  const saved = new Set<string | PDFRawStream>();
  const files: { name: string; blob: Blob }[] = [];

  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n);
    const images = await pageImages(page, getTotalRotation(page, rotation));
    const hidden = new Set(images.filter((image) => skip(n, image)).map(imageKey));
    const streams = pageStreams(pdf, n - 1);
    let number = 0;
    for (const image of distinctImages(images)) {
      number++;
      if (hidden.has(imageKey(image))) continue;
      const stream = streamFor(streams, image);
      const keys = [image.objId?.startsWith('g_') ? image.objId : null, stream].filter((k) => k !== null);
      if (keys.some((k) => saved.has(k))) continue;
      for (const k of keys) saved.add(k);
      const { blob, extension } = await imageFile(pdf, page, image, stream);
      files.push({ name: `${base}_page${n}_image${number}.${extension}`, blob });
    }
  }

  if (files.length === 1) downloadBlob(files[0].blob, files[0].name);
  if (files.length > 1) {
    const zip = new JSZip();
    for (const { name, blob } of files) zip.file(name, blob);
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}_images.zip`);
  }
  return files.length;
}
