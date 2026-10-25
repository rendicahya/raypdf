import { writable } from 'svelte/store';

/**
 * Images added to documents this visit, by id. Placed images
 * (PlacedImage.imageId) point here, so undo, duplicating a page, or copying
 * to every page never copies the image data itself. Kept in memory only,
 * like the open PDFs: nothing is uploaded or stored.
 */
export interface StoredImage {
  /** PNG or JPEG, the two formats a PDF can embed directly. */
  blob: Blob;
  type: 'png' | 'jpeg';
  /** Object URL of `blob`, for showing it on the page. */
  url: string;
  width: number;
  height: number;
}

const images = new Map<string, StoredImage>();

export function imageFor(id: string): StoredImage | undefined {
  return images.get(id);
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/bmp,image/avif';

/** Whether a file looks like an image the browser can show. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** An image the user picked, waiting to be placed on the current page (see PDFViewer). */
export const pendingImage = writable<{ id: string; width: number; height: number } | null>(null);

/**
 * Reads an image file and keeps it for placing. PNGs and JPEGs are kept as
 * they are, unless a JPEG is rotated by its EXIF tag (which a PDF ignores);
 * anything else (WebP, GIF, SVG, …) is converted to PNG.
 */
export async function addImageFile(file: File): Promise<{ id: string; width: number; height: number }> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = sourceUrl;
    try {
      await img.decode();
    } catch {
      throw new Error(`"${file.name}" isn't an image this browser can open.`);
    }
    // An SVG without its own size reports 0; give it a sensible one.
    const width = img.naturalWidth || 600;
    const height = img.naturalHeight || 400;

    let blob: Blob = file;
    let type: StoredImage['type'] | null =
      file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpeg' : null;
    if (type === 'jpeg' && (await jpegOrientation(file)) > 1) type = null;
    if (!type) {
      blob = await redraw(img, width, height, file.type === 'image/jpeg');
      type = file.type === 'image/jpeg' ? 'jpeg' : 'png';
    }

    const id = crypto.randomUUID();
    images.set(id, { blob, type, url: URL.createObjectURL(blob), width, height });
    return { id, width, height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/** Draws a decoded image onto a canvas (which applies EXIF rotation) and encodes it. */
function redraw(img: HTMLImageElement, width: number, height: number, asJpeg: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to read the image'))),
      asJpeg ? 'image/jpeg' : 'image/png',
      0.92,
    ),
  );
}

/** The EXIF orientation of a JPEG (1 = upright), read from its APP1 segment. */
async function jpegOrientation(file: File): Promise<number> {
  const view = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1;
    offset += 2 + length;
  }
  return 1;
}
