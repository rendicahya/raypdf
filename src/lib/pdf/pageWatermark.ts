import { degrees, type PDFDocument, type PDFFont, type PDFImage } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import { embedTextFont, hexToRgb } from './textRender';
import type { PageNumberFont } from './pageNumbers';
import { FONT_FAMILY_CSS } from '../../stores/textTool';
import type { StoredImage } from '../../stores/images';

/**
 * A watermark stamped across every page of a document: a word such as
 * CONFIDENTIAL, or a picture such as a logo, once in the middle or repeated
 * over the page. Unlike the signature's protective watermark
 * (lib/watermark/visible.ts), which is part of the signature image, this one
 * is drawn onto the pages themselves. Sizes are in PDF points.
 */
export interface PageWatermarkSettings {
  kind: 'text' | 'image';
  text: string;
  font: PageNumberFont;
  bold: boolean;
  fontSize: number;
  /** CSS hex color. */
  color: string;
  /** The picture (stores/images.ts), or null until one is chosen. */
  imageId: string | null;
  /** The picture's width as a share of the page width. */
  imageWidth: number;
  /** Turned counter-clockwise as shown, in degrees. */
  angle: number;
  /** 0.05 to 1. */
  opacity: number;
  layout: 'center' | 'tile';
}

/** What the panel remembers between documents: everything but the picture, which is only kept in memory. */
export type PageWatermarkStyle = Omit<PageWatermarkSettings, 'imageId'>;

export const DEFAULT_PAGE_WATERMARK: PageWatermarkStyle = {
  kind: 'text',
  text: 'CONFIDENTIAL',
  font: 'helvetica',
  bold: true,
  fontSize: 72,
  color: '#6b7280',
  imageWidth: 0.5,
  angle: 45,
  opacity: 0.25,
  layout: 'center',
};

/** Roughly the height of a capital, as a share of the font size, for centring text on its middle. */
const CAP_HEIGHT = 0.72;

type Size = { width: number; height: number };
type Point = [number, number];

let measureCtx: CanvasRenderingContext2D | null = null;

export function watermarkFontCss(settings: Pick<PageWatermarkSettings, 'font' | 'bold' | 'fontSize'>, unit = 1): string {
  return `${settings.bold ? 700 : 400} ${settings.fontSize * unit}px ${FONT_FAMILY_CSS[settings.font]}`;
}

/**
 * The size of one stamp on a page of `pageWidth` points, or null if there's
 * nothing to draw. Text is measured by the browser in every place that lays
 * the watermark out, so the editor, screenshots, and export agree.
 */
export function watermarkSize(
  settings: PageWatermarkSettings,
  pageWidth: number,
  image: Size | undefined,
): Size | null {
  if (settings.kind === 'image') {
    if (!image || image.width <= 0) return null;
    const width = settings.imageWidth * pageWidth;
    return { width, height: (width * image.height) / image.width };
  }
  const text = settings.text.trim();
  if (!text) return null;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  let width = text.length * settings.fontSize * 0.6;
  if (measureCtx) {
    measureCtx.font = watermarkFontCss(settings);
    width = measureCtx.measureText(text).width;
  }
  return { width, height: settings.fontSize };
}

/** Whether the settings draw anything (text, or a picture that's still in memory). */
export function hasWatermarkContent(
  settings: PageWatermarkSettings,
  imageFor: (id: string) => StoredImage | undefined,
): boolean {
  return settings.kind === 'text' ? settings.text.trim() !== '' : !!settings.imageId && !!imageFor(settings.imageId);
}

/**
 * The centre of each stamp on a page of `pageWidth` × `pageHeight` as shown
 * (y downwards). Tiled stamps sit on a grid turned to the watermark's angle,
 * every other row shifted by half a step, covering the whole page.
 */
export function watermarkCenters(
  settings: PageWatermarkSettings,
  size: Size,
  pageWidth: number,
  pageHeight: number,
): Point[] {
  const cx = pageWidth / 2;
  const cy = pageHeight / 2;
  if (settings.layout === 'center') return [[cx, cy]];

  const a = (settings.angle * Math.PI) / 180;
  const along: Point = [Math.cos(a), -Math.sin(a)];
  const across: Point = [Math.sin(a), Math.cos(a)];
  const gap = settings.kind === 'text' ? size.height * 2 : Math.max(size.width, size.height) * 0.5;
  const stepAlong = size.width + gap;
  const stepAcross = size.height + gap;
  const reach = Math.hypot(pageWidth, pageHeight) / 2 + Math.hypot(size.width, size.height);
  const rows = Math.ceil(reach / stepAcross);
  const cols = Math.ceil(reach / stepAlong) + 1;
  const margin = Math.hypot(size.width, size.height) / 2;

  const centers: Point[] = [];
  for (let j = -rows; j <= rows; j++) {
    const shift = j % 2 === 0 ? 0 : stepAlong / 2;
    for (let i = -cols; i <= cols; i++) {
      const s = i * stepAlong + shift;
      const t = j * stepAcross;
      const x = cx + s * along[0] + t * across[0];
      const y = cy + s * along[1] + t * across[1];
      if (x > -margin && x < pageWidth + margin && y > -margin && y < pageHeight + margin) centers.push([x, y]);
    }
  }
  return centers;
}

/**
 * Where a stamp centred on `center` starts, as shown: the baseline start of
 * text, or the bottom-left corner of a picture. Both are what pdf-lib turns
 * the stamp around.
 */
function stampAnchor(center: Point, width: number, below: number, angle: number): Point {
  const a = (angle * Math.PI) / 180;
  return [
    center[0] - (width / 2) * Math.cos(a) + below * Math.sin(a),
    center[1] + (width / 2) * Math.sin(a) + below * Math.cos(a),
  ];
}

/** Draws the watermark onto every page, laid out on the page as shown, so rotated pages match the editor. */
export async function drawPageWatermark(
  pdfDoc: PDFDocument,
  pdfjsDoc: PdfDocument,
  settings: PageWatermarkSettings,
  imageFor: (id: string) => StoredImage | undefined,
  rotation: number,
): Promise<void> {
  const stored = settings.kind === 'image' && settings.imageId ? imageFor(settings.imageId) : undefined;
  let image: PDFImage | null = null;
  let font: PDFFont | null = null;
  let text = '';
  if (settings.kind === 'image') {
    if (!stored) return;
    const bytes = new Uint8Array(await stored.blob.arrayBuffer());
    image = stored.type === 'png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } else {
    font = await embedTextFont(pdfDoc, settings.font, settings.bold, false);
    // The standard fonts only cover Latin text; anything else would make drawText throw.
    const supported = new Set(font.getCharacterSet());
    text = [...settings.text.trim()].map((c) => (supported.has(c.codePointAt(0)!) ? c : '?')).join('');
    if (!text) return;
  }

  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pdfjsPage = await pdfjsDoc.getPage(i + 1);
    const totalRotation = getTotalRotation(pdfjsPage, rotation);
    const viewport = pdfjsPage.getViewport({ scale: 1, rotation: totalRotation });
    const size = watermarkSize(settings, viewport.width, stored);
    if (!size) return;
    const rotate = degrees(totalRotation + settings.angle);

    for (const center of watermarkCenters(settings, size, viewport.width, viewport.height)) {
      if (font) {
        const width = font.widthOfTextAtSize(text, settings.fontSize);
        const [x, y] = viewport.convertToPdfPoint(
          ...stampAnchor(center, width, (settings.fontSize * CAP_HEIGHT) / 2, settings.angle),
        );
        pages[i].drawText(text, {
          x,
          y,
          size: settings.fontSize,
          font,
          color: hexToRgb(settings.color),
          opacity: settings.opacity,
          rotate,
        });
      } else if (image) {
        const [x, y] = viewport.convertToPdfPoint(...stampAnchor(center, size.width, size.height / 2, settings.angle));
        pages[i].drawImage(image, { x, y, width: size.width, height: size.height, opacity: settings.opacity, rotate });
      }
    }
  }
}

/**
 * Draws the watermark onto a canvas showing the whole page, for screenshots.
 * `unit` is canvas pixels per point.
 */
export async function drawWatermarkOnCanvas(
  ctx: CanvasRenderingContext2D,
  settings: PageWatermarkSettings,
  image: StoredImage | undefined,
  pageWidth: number,
  pageHeight: number,
  unit: number,
): Promise<void> {
  const size = watermarkSize(settings, pageWidth, image);
  if (!size) return;
  const bitmap = settings.kind === 'image' && image ? await createImageBitmap(image.blob) : null;
  ctx.save();
  ctx.scale(unit, unit);
  ctx.globalAlpha = settings.opacity;
  ctx.fillStyle = settings.color;
  ctx.font = watermarkFontCss(settings);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const [x, y] of watermarkCenters(settings, size, pageWidth, pageHeight)) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((-settings.angle * Math.PI) / 180);
    if (bitmap) ctx.drawImage(bitmap, -size.width / 2, -size.height / 2, size.width, size.height);
    else ctx.fillText(settings.text.trim(), 0, (settings.fontSize * CAP_HEIGHT) / 2);
    ctx.restore();
  }
  ctx.restore();
  bitmap?.close();
}
