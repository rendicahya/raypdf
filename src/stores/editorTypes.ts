// The editor's document model: what's placed on the pages, per document, in
// canvas pixels at the current zoom. The store itself is stores/editor.ts,
// which re-exports all of this.
import type { FormValues } from '../lib/pdf/forms';
import type { PageNumberSettings } from '../lib/pdf/pageNumbers';
import type { HeaderFooterSettings } from '../lib/pdf/headerFooter';
import type { PageWatermarkSettings } from '../lib/pdf/pageWatermark';
/** Signature instance placed on the page, in canvas pixel coordinates. */
export interface PlacedSignature {
  id: string;
  /** Which saved signature this shows (see stores/signature.ts). */
  signatureId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this placement belongs to. */
  page: number;
  /** Degrees clockwise, as shown, turned about the box's centre (none means upright). The box above is the unturned one. */
  angle?: number;
}

/** A user-drawn area to permanently strip from the exported PDF, in canvas pixel coordinates. */
export interface RedactionBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this box belongs to. */
  page: number;
}

export type TextFontFamily = 'helvetica' | 'times' | 'courier' | 'arial' | 'consolas';

export type TextAlign = 'left' | 'center' | 'right';
export type TextScript = 'normal' | 'superscript' | 'subscript';

/** A typed text box placed on the page, in canvas pixel coordinates. */
export interface PlacedText {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this text belongs to. */
  page: number;
  text: string;
  fontFamily: TextFontFamily;
  /** In canvas pixels at the current render scale — rescaled alongside x/y/width/height on zoom. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** CSS hex color. */
  color: string;
  /** CSS hex color filled behind the box, or null for none. */
  background: string | null;
  /** 0.1 to 1. */
  opacity: number;
  /** In canvas pixels at the current render scale. */
  letterSpacing: number;
  /** Extra space added to each space character, in canvas pixels at the current render scale. */
  wordSpacing: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Superscript and subscript apply to the whole box: smaller text, raised or lowered within each line. */
  script: TextScript;
  align: TextAlign;
}

/** A sticky-note style comment marker placed on the page, in canvas pixel coordinates. */
export interface PlacedComment {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this comment belongs to. */
  page: number;
  text: string;
  /**
   * The text markup (PlacedHighlight.groupId) this note is about, for a
   * comment on selected text. Removing the markup removes the note; the note
   * is saved as the markup annotation's own text rather than a sticky note.
   */
  groupId?: string;
}

export type MarkupKind = 'highlight' | 'underline' | 'strikeout';

/**
 * One rectangle of a text markup (highlight, underline, or strikethrough), in
 * canvas pixel coordinates — the box around the marked text, whatever the
 * kind. Markup spanning several lines is several of these sharing a
 * `groupId`, so each stays a plain box that zoom, rotation, and page edits
 * already know how to move.
 */
export interface PlacedHighlight {
  id: string;
  /** Shared by every rectangle made from the same selection — removed and recolored together. */
  groupId: string;
  kind: MarkupKind;
  /** CSS hex color. */
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this highlight belongs to. */
  page: number;
}

/** Closed shapes fill their box (outlines from `shapeOutline` in lib/pdf/shapes.ts); lines and arrows run corner to corner. */
export type ShapeKind =
  | 'rectangle'
  | 'roundedRectangle'
  | 'ellipse'
  | 'triangle'
  | 'rightTriangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'heart'
  | 'callout'
  | 'blockArrow'
  | 'line'
  | 'arrow';

/** An arrow's tip: two open strokes, a filled triangle, or a filled triangle notched at the back. */
export type ArrowHead = 'open' | 'triangle' | 'notched';

/** How a shape's outline, or a line, is drawn: unbroken, or as a repeating pattern. */
export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

/** A drawn shape, in canvas pixel coordinates. Lines and arrows run corner to corner across the box. */
export interface PlacedShape {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this shape belongs to. */
  page: number;
  kind: ShapeKind;
  /** CSS hex color of the outline, or of the line itself. */
  stroke: string;
  /** In canvas pixels at the current render scale — rescaled on zoom. 0 means no outline. */
  strokeWidth: number;
  /** CSS hex color filling a closed shape, or null for none. */
  fill: string | null;
  /** 0.1 to 1. */
  opacity: number;
  /** Where a line starts: the right (flipX) or bottom (flipY) edge instead of the left or top. Arrows point to the other end. */
  flipX: boolean;
  flipY: boolean;
  /** An arrow's tip. Unset means 'open'. */
  arrowHead?: ArrowHead;
  /** The outline's or line's pattern. Unset means 'solid'. */
  lineStyle?: LineStyle;
  /** Degrees clockwise as shown, about the box's centre (the box itself is unturned). Unset for upright. */
  angle?: number;
}

/** An image placed on the page, in canvas pixel coordinates. The image itself is in stores/images.ts. */
export interface PlacedImage {
  id: string;
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this image belongs to. */
  page: number;
  /** 0.1 to 1. */
  opacity: number;
}

/** Per-document editing state — one entry per uploaded PDF. */
export interface PdfDocumentState {
  id: string;
  /** The current version of the PDF — replaced whenever pages are moved, deleted, duplicated, inserted, or rotated. */
  file: File;
  /** The file as uploaded, to tell whether any page edits have been made. */
  originalFile: File;
  pageNumber: number;
  pageCount: number;
  placedSignatures: PlacedSignature[];
  redactions: RedactionBox[];
  texts: PlacedText[];
  comments: PlacedComment[];
  highlights: PlacedHighlight[];
  shapes: PlacedShape[];
  images: PlacedImage[];
  /** Values entered into the PDF's own form fields, by field name — only fields the user changed. */
  formValues: FormValues;
  /** How the pages are numbered on export, or null for no page numbers. */
  pageNumbers: PageNumberSettings | null;
  /** Text along the top and bottom of the pages, or null for none. */
  headerFooter: HeaderFooterSettings | null;
  /** Text or a picture stamped across the pages, or null for none. */
  pageWatermark: PageWatermarkSettings | null;
  /** Additional rotation (0/90/180/270) the user applied on top of the page's own rotation. */
  rotation: number;
  /** Whether the current placement/redactions have been saved/printed — cleared whenever either changes. Used to warn before closing an unsaved tab. */
  exported: boolean;
}

export interface EditorState {
  documents: PdfDocumentState[];
  activeId: string | null;
  /** pdf.js render scale for the visible canvas; shared across documents so switching between them keeps the same zoom level. */
  renderScale: number;
  /** Whether at least one PDF has been downloaded this session — used to warn before a "Start Over" that would discard undownloaded work. */
  hasExported: boolean;
}

/** A box in canvas pixels. */
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Anything placed on a page. */
export type PageItem = Geometry & { id: string; page: number };

/** Every list of things placed on a document's pages. */
export type PageItems = Pick<
  PdfDocumentState,
  'placedSignatures' | 'redactions' | 'texts' | 'comments' | 'highlights' | 'shapes' | 'images'
>;

/** The names of those lists. A new kind of placed item adds its list here and in `SCALED_FIELDS`. */
export const PAGE_ITEM_LISTS = [
  'placedSignatures',
  'redactions',
  'texts',
  'comments',
  'highlights',
  'shapes',
  'images',
] as const satisfies readonly (keyof PageItems)[];

const BOX = ['x', 'y', 'width', 'height'] as const;

/** The fields of each list's items that are pixel sizes, so they change with the zoom. */
export const SCALED_FIELDS: Record<keyof PageItems, readonly string[]> = {
  placedSignatures: BOX,
  redactions: BOX,
  texts: [...BOX, 'fontSize', 'letterSpacing', 'wordSpacing'],
  comments: BOX,
  highlights: BOX,
  shapes: [...BOX, 'strokeWidth'],
  images: BOX,
};

/** Things the user placed that can be selected together, aligned, and duplicated. */
export type ItemKind = 'signature' | 'text' | 'shape' | 'image';
export const ITEM_KINDS: readonly ItemKind[] = ['signature', 'text', 'shape', 'image'];
export interface ItemRef {
  kind: ItemKind;
  id: string;
}
export const ITEM_LISTS = {
  signature: 'placedSignatures',
  text: 'texts',
  shape: 'shapes',
  image: 'images',
} as const satisfies Record<ItemKind, keyof PageItems>;