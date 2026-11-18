import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import type { ArrowHead, LineStyle, ShapeKind } from './editor';

/** The Shapes tool: drag on the page to draw the chosen shape. */
export const shapeToolMode = writable<boolean>(false);

/** The shape whose style ShapeOptions edits, if one is selected (shared by every page). */
export const selectedShapeId = writable<string | null>(null);

/** Style for new shapes — the last one chosen. Widths are in PDF points. */
export const shapeKind = persistedWritable<ShapeKind>('shapeKind', 'rectangle');
export const shapeStroke = persistedWritable<string>('shapeStroke', '#dc2626');
export const shapeStrokeWidth = persistedWritable<number>('shapeStrokeWidth', 2);
export const shapeFill = persistedWritable<string | null>('shapeFill', null);
export const shapeOpacity = persistedWritable<number>('shapeOpacity', 1);
export const shapeArrowHead = persistedWritable<ArrowHead>('shapeArrowHead', 'open');
export const shapeLineStyle = persistedWritable<LineStyle>('shapeLineStyle', 'solid');

export const isLineKind = (kind: ShapeKind) => kind === 'line' || kind === 'arrow';

/** Each kind's name, in the order the Shapes panel offers them. */
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  roundedRectangle: 'Rounded rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  rightTriangle: 'Right triangle',
  diamond: 'Diamond',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  star: 'Star',
  heart: 'Heart',
  callout: 'Speech bubble',
  blockArrow: 'Block arrow',
  line: 'Line',
  arrow: 'Arrow',
};
