// ============================================================
// PixelMorpher - Modifier Renderer Shared Utilities
// Common guard checks and grid helpers used by all modifier renderers
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';

/** Return type for the guard check: either null (skip) or validated grid dimensions */
export interface ModifierGridInfo {
  h: number;
  w: number;
}

/**
 * Common guard check for all modifier renderers.
 * Returns grid dimensions if the modifier should proceed, or null if it should early-return.
 *
 * Usage:
 * ```ts
 * const grid = modifierGuard(pixels, weight);
 * if (!grid) return pixels;
 * const { h, w } = grid;
 * ```
 */
export function modifierGuard(
  pixels: PixelGrid,
  weight: number,
): ModifierGridInfo | null {
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  if (w === 0 || h === 0 || weight <= 0) return null;
  return { h, w };
}

/**
 * Compute elapsed seconds from frame number and frame rate.
 * Returns 0 if frameRate is not positive.
 */
export function elapsedSeconds(currentFrame: number, frameRate: number): number {
  return frameRate > 0 ? currentFrame / frameRate : 0;
}

/**
 * Create an empty pixel grid of the given dimensions.
 */
export function emptyGrid(h: number, w: number): PixelGrid {
  return Array.from({ length: h }, () => Array(w).fill(null));
}
