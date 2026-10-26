import { persistedWritable } from '../lib/utils/persist';

/**
 * The signature's last placement, stored as ratios (0–1) of the page
 * dimensions rather than pixels — so it can be reapplied to a differently
 * sized PDF or at a different zoom level and still land in roughly the
 * same spot. Persisted so it survives across documents and sessions.
 */
export interface PlacementRatio {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  /** The signature's turn in degrees clockwise (PlacedSignature.angle). */
  angle?: number;
}

export const lastPlacement = persistedWritable<PlacementRatio | null>('lastPlacement', null);
