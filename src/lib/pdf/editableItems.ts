import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { loadEditablePdf } from './password';
import { decodeImage } from './compress';
import type { ItemKind, PlacedImage, PlacedShape, PlacedSignature, PlacedText } from '../../stores/editor';
import type { StoredImage } from '../../stores/images';

/**
 * Keeps placed items (text boxes, shapes, images) editable when the saved
 * PDF is opened in RayPDF again.
 *
 * Every item is still drawn into the page as ordinary content, so any reader
 * shows the file exactly as before. Each one just goes into a content stream
 * of its own, and the page dictionary keeps a small record per item: its
 * settings (as JSON) and a reference to that stream (and, for an image, to
 * the picture). On opening, RayPDF takes those streams back out of the page
 * and puts the items back in the editor, as if they'd never been saved.
 *
 * Signatures are never kept editable: they're always flattened into the
 * page. Records of signatures from earlier saves are dropped on opening,
 * leaving the signature drawn on the page.
 */

/** Per-page array of item records. */
const RECORD_KEY = PDFName.of('RayPDFItems');
/** In the Info dictionary, so a file can be checked cheaply (pdf.js metadata) before parsing it again. */
const MARKER_KEY = 'RayPDFItems';
const VERSION = 1;

type Unplaced<T> = Omit<T, 'id' | 'page'>;

export type RestoredItem =
  | { kind: 'text'; page: number; item: Unplaced<PlacedText> }
  | { kind: 'shape'; page: number; item: Unplaced<PlacedShape> }
  | { kind: 'image'; page: number; item: Omit<Unplaced<PlacedImage>, 'imageId'>; image: Omit<StoredImage, 'url'> };

type AnyItem = PlacedSignature | PlacedText | PlacedShape | PlacedImage;

/** Fields in canvas pixels, which change with the render scale. */
const SCALED_FIELDS: Record<ItemKind, readonly string[]> = {
  signature: ['x', 'y', 'width', 'height'],
  text: ['x', 'y', 'width', 'height', 'fontSize', 'letterSpacing', 'wordSpacing'],
  shape: ['x', 'y', 'width', 'height', 'strokeWidth'],
  image: ['x', 'y', 'width', 'height'],
};

/** A copy of an item with its pixel sizes multiplied by `factor`. */
export function scaleItem<T extends object>(kind: ItemKind, item: T, factor: number): T {
  const out = { ...item } as Record<string, unknown>;
  for (const field of SCALED_FIELDS[kind]) {
    if (typeof out[field] === 'number') out[field] = (out[field] as number) * factor;
  }
  return out as T;
}

function infoDict(pdfDoc: PDFDocument): PDFDict {
  return (pdfDoc as unknown as { getInfoDict(): PDFDict }).getInfoDict();
}

/** The last entry of the page's content, to tell whether drawing added a stream. */
function lastContent(page: PDFPage): unknown {
  const contents = page.node.get(PDFName.Contents);
  const resolved = contents instanceof PDFRef ? page.doc.context.lookup(contents) : contents;
  if (resolved instanceof PDFArray) return resolved.size() > 0 ? resolved.get(resolved.size() - 1) : undefined;
  return contents;
}

/** Makes pdf-lib start a new content stream with the next thing drawn on the page. */
function startNewStream(page: PDFPage): void {
  (page as unknown as { contentStream?: unknown }).contentStream = undefined;
}

const RESOURCE_KINDS = ['Font', 'XObject', 'ExtGState'] as const;

/** The page's own resource names, as "Kind/Name". */
function resourceKeys(page: PDFPage): Set<string> {
  const keys = new Set<string>();
  const resources = page.node.Resources();
  if (!resources) return keys;
  for (const kind of RESOURCE_KINDS) {
    const dict = resources.lookupMaybe(PDFName.of(kind), PDFDict);
    for (const key of dict?.keys() ?? []) keys.add(`${kind}/${key.decodeText()}`);
  }
  return keys;
}

/** Collects item records during export; `finish` writes them into the file. */
export class EditableItemRecorder {
  private records = new Map<PDFPage, PDFDict[]>();
  private before: unknown;
  private resourcesBefore = new Set<string>();

  constructor(
    private pdfDoc: PDFDocument,
    private renderScale: number,
  ) {}

  /** Call before drawing one item on `page`. */
  begin(page: PDFPage): void {
    startNewStream(page);
    this.before = lastContent(page);
    this.resourcesBefore = resourceKeys(page);
  }

  /** Call after drawing it: records the item, if anything was drawn. */
  end(page: PDFPage, kind: ItemKind, item: AnyItem, image?: PDFRef): void {
    const content = lastContent(page);
    // Whatever's drawn next (another item, page numbers) goes elsewhere.
    startNewStream(page);
    if (!(content instanceof PDFRef) || content === this.before) return;

    const { id: _id, page: _page, ...rest } = item;
    const data = scaleItem(kind, rest, 1 / this.renderScale);
    if (kind === 'image') delete (data as Partial<PlacedImage>).imageId;
    const record = this.pdfDoc.context.obj({
      V: VERSION,
      Kind: PDFName.of(kind),
      Data: PDFHexString.fromText(JSON.stringify(data)),
      Content: content,
    });
    if (image) record.set(PDFName.of('Image'), image);
    // What drawing it added to the page's resources, to take away with it.
    const added = [...resourceKeys(page)].filter((k) => !this.resourcesBefore.has(k));
    if (added.length > 0) record.set(PDFName.of('Res'), this.pdfDoc.context.obj(added.map((k) => PDFString.of(k))));
    const list = this.records.get(page) ?? [];
    list.push(record);
    this.records.set(page, list);
  }

  /** Writes the records into their pages, next to any kept from an earlier save. */
  finish(): void {
    for (const [page, records] of this.records) {
      const existing = page.node.lookupMaybe(RECORD_KEY, PDFArray);
      if (existing) records.forEach((r) => existing.push(r));
      else page.node.set(RECORD_KEY, this.pdfDoc.context.obj(records));
    }
    markEditableItems(this.pdfDoc);
  }
}

/** Sets (or clears) the Info marker from what the pages hold. Call after pages are copied into a new document. */
export function markEditableItems(pdfDoc: PDFDocument): void {
  const count = pdfDoc
    .getPages()
    .reduce((n, page) => n + (page.node.lookupMaybe(RECORD_KEY, PDFArray)?.size() ?? 0), 0);
  const info = infoDict(pdfDoc);
  if (count > 0) info.set(PDFName.of(MARKER_KEY), PDFNumber.of(count));
  else info.delete(PDFName.of(MARKER_KEY));
}

/** Forgets every item record, leaving what's drawn on the pages as it is. */
export function removeEditableItems(pdfDoc: PDFDocument): void {
  for (const page of pdfDoc.getPages()) page.node.delete(RECORD_KEY);
  infoDict(pdfDoc).delete(PDFName.of(MARKER_KEY));
}

/** Whether pdf.js metadata (`getMetadata().info`) says the file holds editable items. */
export function hasEditableItemsMarker(info: unknown): boolean {
  const custom = (info as { Custom?: Record<string, unknown> } | null)?.Custom;
  return !!custom && MARKER_KEY in custom;
}

function textOf(value: unknown): string | null {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText();
  return null;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function pixelsOf(bitmap: ImageBitmap): ImageData | null {
  const ctx = makeCanvas(bitmap.width, bitmap.height).getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/** The picture behind an image XObject, as a PNG or JPEG, or null if it can't be read back. */
async function readImage(pdfDoc: PDFDocument, ref: PDFRef): Promise<Omit<StoredImage, 'url'> | null> {
  const stream = pdfDoc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return null;
  const { dict } = stream;
  const width = dict.lookup(PDFName.of('Width'));
  const height = dict.lookup(PDFName.of('Height'));
  if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return null;
  const size = { width: width.asNumber(), height: height.asNumber() };

  const filter = dict.lookup(PDFName.of('Filter'));
  const isJpeg = filter instanceof PDFName && filter.decodeText() === 'DCTDecode';
  const maskRef = dict.get(PDFName.of('SMask'));
  const mask = maskRef ? pdfDoc.context.lookup(maskRef) : undefined;

  // A JPEG on its own is the very file that was placed.
  if (isJpeg && !mask) {
    return { blob: new Blob([stream.contents as BlobPart], { type: 'image/jpeg' }), type: 'jpeg', ...size };
  }

  const bitmap = await decodeImage(stream).catch(() => null);
  if (!bitmap) return null;
  const pixels = pixelsOf(bitmap);
  bitmap.close();
  if (!pixels) return null;

  if (mask) {
    const maskBitmap = mask instanceof PDFRawStream ? await decodeImage(mask).catch(() => null) : null;
    if (!maskBitmap) return null;
    const alpha = maskBitmap.width === size.width && maskBitmap.height === size.height ? pixelsOf(maskBitmap) : null;
    maskBitmap.close();
    if (!alpha) return null;
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = alpha.data[i - 3];
  }

  const canvas = makeCanvas(size.width, size.height);
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? { blob, type: 'png', ...size } : null;
}

/**
 * Takes the items saved by RayPDF back out of a PDF. Returns the file with
 * those items removed from the pages, and the items (in canvas pixels at
 * scale 1, as the page is shown with its own rotation), or null if there was
 * nothing to bring back. Items that can't come back (a picture that can't be
 * read) stay drawn on the page, and their records stay too, for a later try.
 * Signatures stay drawn and lose their records.
 */
export async function restoreEditableItems(file: File): Promise<{ file: File; items: RestoredItem[] } | null> {
  const pdfDoc = await loadEditablePdf(await file.arrayBuffer());
  const { context } = pdfDoc;
  const items: RestoredItem[] = [];

  const pages = pdfDoc.getPages();
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const records = page.node.lookupMaybe(RECORD_KEY, PDFArray);
    if (!records) continue;
    const contents = context.lookup(page.node.get(PDFName.Contents));
    if (!(contents instanceof PDFArray)) continue;

    const kept: unknown[] = [];
    const freed = new Set<string>();
    for (const entry of records.asArray()) {
      const record = context.lookup(entry);
      if (!(record instanceof PDFDict)) continue;
      const kind = record.lookup(PDFName.of('Kind'));
      if (kind instanceof PDFName && kind.decodeText() === 'signature') continue;
      const restored = await restoreRecord(pdfDoc, record, contents, index + 1).catch(() => null);
      if (!restored) {
        kept.push(entry);
        continue;
      }
      items.push(restored);
      const res = record.lookupMaybe(PDFName.of('Res'), PDFArray);
      for (const key of res?.asArray() ?? []) {
        const text = textOf(key);
        if (text) freed.add(text);
      }
    }

    if (kept.length > 0) page.node.set(RECORD_KEY, context.obj(kept as PDFDict[]));
    else page.node.delete(RECORD_KEY);
    if (freed.size > 0) dropUnusedResources(page, contents, freed);
  }

  if (items.length === 0) return null;
  markEditableItems(pdfDoc);
  dropUnreachable(pdfDoc);
  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  return { file: new File([bytes as BlobPart], file.name, { type: 'application/pdf' }), items };
}

/**
 * Takes the resources the restored items added off the page, unless
 * something still drawn there uses them (another item sharing a font, say).
 * If any of the page's content can't be read, everything is kept.
 */
function dropUnusedResources(page: PDFPage, contents: PDFArray, keys: Set<string>): void {
  const { context } = page.doc;
  const latin1 = new TextDecoder('latin1');
  let text = '';
  for (const ref of contents.asArray()) {
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) return;
    try {
      text += latin1.decode(decodePDFRawStream(stream).decode()) + '\n';
    } catch {
      return;
    }
  }
  const resources = page.node.Resources();
  if (!resources) return;
  for (const key of keys) {
    const [kind, name] = key.split('/', 2);
    if (!(RESOURCE_KINDS as readonly string[]).includes(kind) || !name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`/${escaped}(?![^\\s/<>\\[\\]()%{}])`).test(text)) continue;
    resources.lookupMaybe(PDFName.of(kind), PDFDict)?.delete(PDFName.of(name));
  }
}

/** Deletes objects nothing in the file points to any more (the restored items' pictures and fonts). */
function dropUnreachable(pdfDoc: PDFDocument): void {
  const { context } = pdfDoc;
  const reached = new Set<PDFRef>();
  const pending: unknown[] = [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value instanceof PDFRef) {
      if (reached.has(value)) continue;
      reached.add(value);
      pending.push(context.lookup(value));
    } else if (value instanceof PDFDict) {
      pending.push(...value.values());
    } else if (value instanceof PDFArray) {
      pending.push(...value.asArray());
    } else if (value instanceof PDFStream) {
      pending.push(value.dict);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref)) context.delete(ref);
  }
}

/** One item, its drawing taken off the page; null leaves it as it is. */
async function restoreRecord(
  pdfDoc: PDFDocument,
  record: PDFDict,
  contents: PDFArray,
  page: number,
): Promise<RestoredItem | null> {
  const version = record.lookup(PDFName.of('V'));
  if (!(version instanceof PDFNumber) || version.asNumber() !== VERSION) return null;
  const kind = record.lookup(PDFName.of('Kind'));
  const json = textOf(record.lookup(PDFName.of('Data')));
  const content = record.get(PDFName.of('Content'));
  if (!(kind instanceof PDFName) || json === null || !(content instanceof PDFRef)) return null;

  // Gone from the page (a later redaction flattened it): nothing to lift off.
  const at = contents.asArray().indexOf(content);
  if (at === -1) return null;

  const data = JSON.parse(json) as Record<string, unknown>;
  if (!['x', 'y', 'width', 'height'].every((f) => typeof data[f] === 'number')) return null;

  let restored: RestoredItem;
  switch (kind.decodeText()) {
    case 'text':
      if (typeof data.text !== 'string') return null;
      restored = { kind: 'text', page, item: data as unknown as Unplaced<PlacedText> };
      break;
    case 'shape':
      if (typeof data.kind !== 'string') return null;
      restored = { kind: 'shape', page, item: data as unknown as Unplaced<PlacedShape> };
      break;
    case 'image': {
      const imageRef = record.get(PDFName.of('Image'));
      const image = imageRef instanceof PDFRef ? await readImage(pdfDoc, imageRef) : null;
      if (!image) return null;
      restored = { kind: 'image', page, item: data as unknown as Omit<Unplaced<PlacedImage>, 'imageId'>, image };
      break;
    }
    default:
      return null;
  }

  // The stream itself goes with everything else nothing points to any more
  // (a duplicated page may still be showing it).
  contents.remove(at);
  return restored;
}
