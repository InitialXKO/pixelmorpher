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
  'local_inflate',
  // Edit modifier: brush strokes as non-destructive pixel deform on PuppetNode
  'pixel_edit',
  // V12: 补齐的像素修改器（有旧实现，走 modifierRegistry）
  'color_replace',
  'outline',
  'dither',
  'pixel_displace',
  'mirror',
  'flip',
  'cylinder_rotate',
  'sphere_rotate',
  // V12: 路径跟随
  'path_follow',
  // V12: 凸凹光照
  'bump_light',
];

/** Check if a modifier type operates at the pixel-deformation level. */
export function isPixelDeformModifier(type: ModifierType): boolean {
  return (PIXEL_DEFORM_MODIFIER_TYPES as string[]).includes(type);
}
