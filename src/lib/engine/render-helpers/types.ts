/**
 * Shared types used by render-pipeline and its extracted helpers.
 */

import type { PuppetDirection } from '../../types';

/** Interpolated values for a single puppet node at the current frame */
export interface InterpolatedNodeValues {
  angle: number;
  stretch: number;
  offsetX: number;
  offsetY: number;
  direction: PuppetDirection;
  viewLatitude: number;
}

/** Computed world transform for a puppet node */
export interface WorldTransform {
  worldX: number;
  worldY: number;
  worldAngle: number;
  worldStretch: number;
}
