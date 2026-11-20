import { get } from 'svelte/store';
import { editorStore, type PlacedSignature } from '../../stores/editor';
import { signatureStore } from '../../stores/signature';
import { lastPlacement } from '../../stores/placement';
import { openSignatureTool } from '../../stores/tools';
import { clamp } from '../../lib/utils/boxGeometry';
import type { PageSelection } from './pageContext.svelte';

// Placed signatures: the box maths and actions shared by SignatureLayer and
// PDFViewer (placing one, its right-click menu). Sizes are in canvas pixels;
// `bounds` is the page canvas.

type Bounds = { width: number; height: number };

/** The smallest a signature can be resized to, on either side. */
const MIN_SIZE = 24;

/** Whole degrees in 0–359, or undefined for upright. */
export function normalizedAngle(angle: number): number | undefined {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  return a === 0 ? undefined : a;
}

/**
 * Remembers where a signature was placed (as fractions of the page) so
 * "Use last position" can put the next one in the same spot.
 */
export function rememberPlacement(placement: PlacedSignature, bounds: Bounds): void {
  lastPlacement.set({
    xRatio: placement.x / bounds.width,
    yRatio: placement.y / bounds.height,
    widthRatio: placement.width / bounds.width,
    heightRatio: placement.height / bounds.height,
    ...(placement.angle && { angle: placement.angle }),
  });
}

/** Turns a signature by `delta` degrees (clockwise). */
export function rotateSignatureBy(sig: PlacedSignature, delta: number, bounds: Bounds): void {
  const angle = normalizedAngle((sig.angle ?? 0) + delta);
  editorStore.updateSignature(sig.id, { angle });
  rememberPlacement({ ...sig, angle }, bounds);
}

/** Opens the signature panel with this placement's signature as the active one. */
export function editSignature(placed: PlacedSignature | undefined, id: string, selection: PageSelection): void {
  if (placed && get(signatureStore).signatures.some((s) => s.id === placed.signatureId)) {
    signatureStore.setActive(placed.signatureId);
  }
  selection.signatureId = id;
  openSignatureTool();
}

/**
 * The size toward `targetWidth` from `origin`, keeping the aspect ratio and
 * never overflowing the page or going below MIN_SIZE.
 */
function clampedResize(targetWidth: number, origin: PlacedSignature, bounds: Bounds, fromCentre: boolean): Bounds {
  const aspect = origin.width / origin.height;
  // A turned signature grows from its turned corner, so the page edges only
  // limit it to the page's own size. Growing from the centre, the nearer edge does.
  const turned = !!origin.angle;
  const cx = origin.x + origin.width / 2;
  const cy = origin.y + origin.height / 2;
  const maxWidth = turned ? bounds.width : fromCentre ? 2 * Math.min(cx, bounds.width - cx) : bounds.width - origin.x;
  const maxHeight = turned
    ? bounds.height
    : fromCentre
      ? 2 * Math.min(cy, bounds.height - cy)
      : bounds.height - origin.y;

  let width = clamp(targetWidth, MIN_SIZE, maxWidth);
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  if (height < MIN_SIZE) {
    height = MIN_SIZE;
    width = height * aspect;
  }
  return { width, height };
}

/**
 * The new box for a resize toward `targetWidth`, with the corner across from
 * the handle (the top-left one, turned with the signature) kept in place, or
 * the centre with `fromCentre` (Shift while dragging).
 */
export function resizedFromCorner(
  origin: PlacedSignature,
  targetWidth: number,
  bounds: Bounds,
  fromCentre = false,
): { width: number; height: number; x?: number; y?: number } {
  const { width, height } = clampedResize(targetWidth, origin, bounds, fromCentre);
  if (fromCentre) {
    const cx = origin.x + origin.width / 2;
    const cy = origin.y + origin.height / 2;
    return { width, height, x: cx - width / 2, y: cy - height / 2 };
  }
  if (!origin.angle) return { width, height };
  const a = (origin.angle * Math.PI) / 180;
  const turn = (dx: number, dy: number) => [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  // The fixed corner, from the old centre, then the new centre from it.
  const [ox, oy] = turn(-origin.width / 2, -origin.height / 2);
  const [nx, ny] = turn(width / 2, height / 2);
  const cx = origin.x + origin.width / 2 + ox + nx;
  const cy = origin.y + origin.height / 2 + oy + ny;
  return { width, height, x: cx - width / 2, y: cy - height / 2 };
}
