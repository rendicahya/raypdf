import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import type { ShapeKind } from './editor';

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
