import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { downloadBlob } from './screenshot';
import './loader'; // sets up the pdf.js worker

export type PageImageFormat = 'png' | 'jpg';

// About 216 dpi: sharp enough to read or print, without huge files.
const IMAGE_SCALE = 3;
const JPEG_QUALITY = 0.92;

/**
 * Renders every page of an already-exported PDF to an image. Working from the
 * export rather than the editor means redactions, signatures, text, markups,
 * and form values look exactly as they will in the saved PDF.
 */
async function renderPdfToImages(bytes: Uint8Array, format: PageImageFormat): Promise<Blob[]> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const images: Blob[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: IMAGE_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) throw new Error('Canvas 2D context unavailable');
      // JPEG has no transparency, so start from white paper.
      canvasContext.fillStyle = '#fff';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      // ENABLE draws form fields onto the canvas too; the default leaves them
      // for an HTML layer, which an image doesn't have.
      await page.render({ canvasContext, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
      images.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create the image'))),
            format === 'png' ? 'image/png' : 'image/jpeg',
            JPEG_QUALITY,
          ),
        ),
      );
    }
    return images;
  } finally {
    await pdf.destroy();
  }
}

/**
 * Downloads the pages of an exported PDF (made with `onlyPages: pages`) as
 * images: one file for a single page, or a ZIP with one image per page.
 */
export async function downloadPagesAsImages(
  bytes: Uint8Array,
  originalFileName: string,
  pages: number[],
  format: PageImageFormat,
): Promise<void> {
  const base = originalFileName.replace(/\.pdf$/i, '');
  const images = await renderPdfToImages(bytes, format);
  if (images.length === 1) {
    downloadBlob(images[0], `${base}_page${pages[0]}.${format}`);
    return;
  }
  const zip = new JSZip();
  images.forEach((image, i) => zip.file(`${base}_page${pages[i]}.${format}`, image));
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}_pages_${format}.zip`);
}
