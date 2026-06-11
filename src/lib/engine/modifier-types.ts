// ============================================================
// PixelMorpher - Modifier Types
// Shared type predicates and constants for modifier classification
// ============================================================

import type { ModifierType } from '../types';

/** Animation modifier types that operate at the pixel level (deforming the pixel grid)
 *  rather than at the transform level (matrix-based rotation/translation/scale).
 *  These modifiers require the render pipeline to rebuild the part's pixel canvas
 *  every frame instead of caching it. */
export const PIXEL_DEFORM_MODIFIER_TYPES: ModifierType[] = [
  'texture_scroll',
  'wave_deform',
  'contour_scroll',
  'reveal_hide',
  'shatter_dissolve',
  'annihilate',
  'teleport',
  'crt_off',
  'bend',
  'elliptical_compress',
  'dumbbell_stretch',
  'pillow_stretch',
  'hyperbolic_stretch',
  'ring_ripple',
];

/** Check if a modifier type operates at the pixel-deformation level. */
export function isPixelDeformModifier(type: ModifierType): boolean {
  return (PIXEL_DEFORM_MODIFIER_TYPES as string[]).includes(type);
}
