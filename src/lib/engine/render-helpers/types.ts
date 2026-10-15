/**
 * Shared types used by render-pipeline and its extracted helpers.
 */

import type { DirectionIndex } from '../../unified-types';

/** Interpolated values for a single node at the current frame (new Character/Node model) */
export interface InterpolatedNodeValues {
  angle: number;
  stretch: number;
  x: number;
  y: number;
  variantIndex: DirectionIndex;
  zIndex: number;
  skewX: number;
  skewY: number;
  scaleX: number;
}

/** Computed world transform for a puppet node */
export interface WorldTransform {
  worldX: number;
  worldY: number;
  worldAngle: number;
  worldStretch: number;
}
