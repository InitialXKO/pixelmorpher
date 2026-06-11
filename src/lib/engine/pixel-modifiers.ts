// ============================================================
// PixelMorpher - Pixel Modifiers
// isPixelDeformModifier, applyPixelDisplace, applyDither (re-export),
// applyColorReplace, applyOutline, applyCylinderRotate, applySphereRotate,
// applyPixelModifiers, PixelModResult, padding utilities, trimTransparentEdges,
// floodFillPixels, renderCorrectionMask
// ============================================================

import type {
  Part,
  ModifierInstance,
  ModifierType,
  PixelGrid,
  PixelColor,
  BrushCommand,
  BrushStyleParams,
  ModifierParamValue,
  PartAnimationModifier,
} from '../types';
import { DEFAULT_BRUSH_STYLE } from '../types';
import { generateBrushStamp, applyBrushStamp, generateStrokePixels, applyStrokePixels, isStrokeAwareStyle } from '../brush-engine';
import { renderCompositedStroke } from '../brush-composite';
import type { StyleAspect, StrokeParamDriver } from '../types';
import { hexToRgb, colorDistance, lerpColor, darkenColor, lightenColor, blendColorsPixel } from './color-utils';
import { rgbToHex } from './utils';
import { applyDither } from './dither';
import { getAnimationFrameAndWeight } from './animation-state';
import { resolveStrokeDriverParams } from './param-driver';

// Import from shared module (also re-exported for backward compatibility)
import { PIXEL_DEFORM_MODIFIER_TYPES, isPixelDeformModifier } from './modifier-types';
export { isPixelDeformModifier };
export { PIXEL_DEFORM_MODIFIER_TYPES };

// ============================================================
// Modifier Renderer Registry
// Replaces the switch-case dispatch in applyPixelModifiers with
// a Map-based registry for O(1) lookup and easy extensibility.
// ============================================================

/** A modifier renderer extracts params, transforms pixels, returns result. */
type ModifierRenderer = (
  params: Record<string, ModifierParamValue>,
  pixels: PixelGrid,
  currentFrame: number,
) => PixelGrid;

/** Registry mapping modifier type strings to their renderer functions. */
const modifierRegistry = new Map<string, ModifierRenderer>();

// Register all modifier renderers at module load time.
// Function declarations are hoisted, so references below are valid.

modifierRegistry.set('color_replace', (params, pixels) => {
  const source = String(params.sourceColor);
  const target = String(params.targetColor);
  const tolerance = Number(params.tolerance) || 0;
  return applyColorReplace(pixels, source, target, tolerance);
});

modifierRegistry.set('outline', (params, pixels) => {
  const thickness = Number(params.thickness) || 1;
  const color = (params.color && String(params.color)) || '#000000';
  const directions = String(params.directions ?? '8');
  const outlineMode = String(params.outlineMode ?? 'solid');
  const blendMode = String(params.blendMode ?? 'normal');
  const edgesOnly = params.edgesOnly !== undefined ? Boolean(params.edgesOnly) : true;
  const lightAngle = Number(params.lightAngle ?? 315);
  return applyOutline(pixels, thickness, color, directions, outlineMode, blendMode, edgesOnly, lightAngle);
});

modifierRegistry.set('dither', (params, pixels) => {
  const pattern = String(params.pattern) || 'bayer4';
  return applyDither(pixels, pattern);
});

modifierRegistry.set('pixel_displace', (params, pixels, currentFrame) => {
  const intensity = Number(params.intensity) || 2;
  const frequency = Number(params.frequency) || 0.1;
  return applyPixelDisplace(pixels, intensity, frequency, currentFrame);
});

modifierRegistry.set('cylinder_rotate', (params, pixels) => {
  const angle = Number(params.angle) || 0;
  const axisOffsetX = Number(params.axisOffsetX) || 0;
  const radiusShrinkRatio = Number(params.radiusShrinkRatio ?? params.radiusScale ?? 1);
  const projection = String(params.projection) || 'front';
  const smooth = Boolean(params.smooth);
  const backFill = String(params.backFill ?? (Boolean(params.seamFill) ? 'cyclic' : 'none'));
  return applyCylinderRotate(pixels, angle, axisOffsetX, radiusShrinkRatio, projection, smooth, backFill);
});

modifierRegistry.set('sphere_rotate', (params, pixels) => {
  const angle = Number(params.angle) || 0;
  const mode = String(params.mode) || 'segmented';
  const centerX = Number(params.centerX) || 0;
  const centerY = Number(params.centerY) || 0;
  const maxLat = Number(params.maxLatitude) || 85;
  const radiusShrinkRatio = Number(params.radiusShrinkRatio ?? params.radiusScale ?? 1);
  const backFill = String(params.backFill || 'cyclic');
  return applySphereRotate(pixels, angle, mode, centerX, centerY, maxLat, radiusShrinkRatio, backFill);
});

modifierRegistry.set('mirror', (_params, pixels) => {
  // Horizontal mirror: reverse each row
  return pixels.map(row => [...row].reverse());
});

modifierRegistry.set('flip', (_params, pixels) => {
  // Vertical flip: reverse row order
  return [...pixels].reverse();
});

modifierRegistry.set('pixel_edit', (params, pixels, currentFrame) => {
  const brushCommands = (params.brushCommands as BrushCommand[]) || [];
  const opacity = Number(params.opacity) || 1;
  for (const cmd of brushCommands) {
    if (cmd.type === 'draw') {
      const cmdStyle = cmd.brushStyle ?? 'solid';

      // V7: Composited style aspects or stroke drivers take priority
      if ((cmd.styleAspects && cmd.styleAspects.length > 0) || (cmd.strokeDrivers && cmd.strokeDrivers.length > 0)) {
        const baseParams: BrushStyleParams = { ...DEFAULT_BRUSH_STYLE, ...(cmd.brushStyleParams ?? {}) };
        // M7+: Resolve time-domain drivers on stroke drivers before rendering
        const resolvedStrokeDrivers = (cmd.strokeDrivers ?? []).map(
          sd => resolveStrokeDriverParams(sd, currentFrame)
        );
        const strokePixels = renderCompositedStroke(
          cmd.points, cmd.size, cmd.color, baseParams,
          (cmd.styleAspects ?? []) as StyleAspect[],
          resolvedStrokeDrivers as StrokeParamDriver[],
          Number(baseParams.seed) || 0,
        );
        applyStrokePixels(pixels, strokePixels, pixels[0]?.length ?? 0, pixels.length);
      } else if (isStrokeAwareStyle(cmdStyle) && cmd.brushStyleParams && cmd.points.length > 1) {
        // V6: Stroke-aware rendering — render the entire stroke at once
        const strokePixels = generateStrokePixels(
          cmdStyle, cmd.points, cmd.size, cmd.color, cmd.brushStyleParams, 0,
        );
        applyStrokePixels(pixels, strokePixels, pixels[0]?.length ?? 0, pixels.length);
      } else if (cmdStyle !== 'solid' && cmd.brushStyleParams) {
        // V5: Stamp-based advanced style rendering
        for (let ptIdx = 0; ptIdx < cmd.points.length; ptIdx++) {
          const pt = cmd.points[ptIdx];
          const stamp = generateBrushStamp(cmdStyle, cmd.size, cmd.color, cmd.brushStyleParams, ptIdx * 7919);
          applyBrushStamp(pixels, stamp, Math.round(pt.x), Math.round(pt.y), pixels[0]?.length ?? 0, pixels.length);
        }
      } else {
        // Legacy: solid square brush
        for (const pt of cmd.points) {
          for (let dy = 0; dy < cmd.size; dy++) {
            for (let dx = 0; dx < cmd.size; dx++) {
              const px = Math.round(pt.x) + dx - Math.floor(cmd.size / 2);
              const py = Math.round(pt.y) + dy - Math.floor(cmd.size / 2);
              if (py >= 0 && py < pixels.length && px >= 0 && px < pixels[0].length) {
                const prev = pixels[py][px];
                if (cmd.blendMode === 'normal') {
                  pixels[py][px] = cmd.color;
                } else if (cmd.blendMode === 'multiply' && prev) {
                  pixels[py][px] = blendColorsPixel(prev, cmd.color, 'multiply', opacity);
                } else if (cmd.blendMode === 'screen' && prev) {
                  pixels[py][px] = blendColorsPixel(prev, cmd.color, 'screen', opacity);
                } else if (cmd.blendMode === 'overlay' && prev) {
                  pixels[py][px] = blendColorsPixel(prev, cmd.color, 'overlay', opacity);
                } else {
                  pixels[py][px] = cmd.color;
                }
              }
            }
          }
        }
      }
    } else if (cmd.type === 'erase') {
      for (const pt of cmd.points) {
        for (let dy = 0; dy < cmd.size; dy++) {
          for (let dx = 0; dx < cmd.size; dx++) {
            const px = Math.round(pt.x) + dx - Math.floor(cmd.size / 2);
            const py = Math.round(pt.y) + dy - Math.floor(cmd.size / 2);
            if (py >= 0 && py < pixels.length && px >= 0 && px < pixels[0].length) {
              pixels[py][px] = null; // transparent
            }
          }
        }
      }
    } else if (cmd.type === 'fill') {
      // Flood fill from first point
      if (cmd.points.length > 0) {
        const startPt = cmd.points[0];
        const sx = Math.round(startPt.x);
        const sy = Math.round(startPt.y);
        if (sy >= 0 && sy < pixels.length && sx >= 0 && sx < pixels[0].length) {
          const targetColor = pixels[sy][sx];
          if (targetColor !== cmd.color) {
            floodFillPixels(pixels, sx, sy, targetColor, cmd.color);
          }
        }
      }
    }
  }
  return pixels;
});

// ============================================================
// Private modifier implementation functions
// ============================================================

function applyPixelDisplace(
  pixels: PixelGrid,
  intensity: number,
  frequency: number,
  currentFrame: number,
): PixelGrid {
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  const result: PixelGrid = Array.from({ length: h }, () => Array(w).fill(null));

  const timeOffset = currentFrame * frequency * Math.PI * 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = pixels[y][x];
      if (!color) continue;

      // Displacement based on position + time
      const dx = Math.round(Math.sin((y * frequency + timeOffset) * Math.PI * 2) * intensity);
      const dy = Math.round(Math.cos((x * frequency + timeOffset) * Math.PI * 2) * intensity);

      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        result[ny][nx] = color;
      }
    }
  }
  return result;
}
export interface PixelModResult {
  pixels: PixelGrid;
  /** How many pixels the grid expanded to the left relative to the original origin.
   *  The original (0,0) pixel is now at (offsetX, offsetY) in the result grid. */
  offsetX: number;
  /** How many pixels the grid expanded to the top relative to the original origin. */
  offsetY: number;
}

/** Compute required padding for a single modifier based on its parameters. */
function computeModifierPadding(mod: ModifierInstance): { left: number; top: number; right: number; bottom: number } {
  if (!mod.enabled) return { left: 0, top: 0, right: 0, bottom: 0 };
  switch (mod.type) {
    case 'outline': {
      const thickness = Number(mod.params.thickness) || 1;
      return { left: thickness, top: thickness, right: thickness, bottom: thickness };
    }
    case 'pixel_displace': {
      const intensity = Number(mod.params.intensity) || 2;
      return { left: intensity, top: intensity, right: intensity, bottom: intensity };
    }
    case 'pixel_edit': {
      // pixel_edit draws at explicit coordinates; can't pre-compute padding easily
      // but brush commands can draw outside bounds — use a generous padding based on brush size
      const brushCommands = (mod.params.brushCommands as BrushCommand[]) || [];
      let maxHalf = 0;
      for (const cmd of brushCommands) {
        const half = Math.ceil((cmd.size || 1) / 2);
        // V5: Account for brush styles that extend beyond the brush size
        const style = cmd.brushStyle ?? 'solid';
        let extra = 0;
        if (style === 'neon') {
          extra = Number(cmd.brushStyleParams?.glowRadius) || 2;
        } else if (style === 'dual_flame') {
          extra = half * (Number(cmd.brushStyleParams?.elongation) || 1.5);
        } else if (style === 'spray' || style === 'scatter') {
          extra = half * (Number(cmd.brushStyleParams?.spread) || 1);
        } else if (style === 'segmented_pipe') {
          // Bellows can expand beyond base size
          extra = half * (Number(cmd.brushStyleParams?.bellowsWidth) || 0.3);
        } else if (style === 'vine') {
          // Sub-branches extend beyond the main vine width
          const branchDensity = Number(cmd.brushStyleParams?.branchDensity) || 0.2;
          extra = half * (1 + branchDensity * 2);
        } else if (style === 'tapered') {
          extra = 0; // tapered stays within base size
        } else if (style === 'pipe') {
          extra = 0; // pipe stays within base size
        }
        const total = Math.ceil(half + extra);
        if (total > maxHalf) maxHalf = total;
      }
      return { left: maxHalf, top: maxHalf, right: maxHalf, bottom: maxHalf };
    }
    default:
      return { left: 0, top: 0, right: 0, bottom: 0 };
  }
}

/** Compute total required padding across all enabled modifiers. */
function computeTotalPadding(modifiers: ModifierInstance[]): { left: number; top: number; right: number; bottom: number } {
  let left = 0, top = 0, right = 0, bottom = 0;
  for (const mod of modifiers) {
    if (!mod.enabled) continue;
    const p = computeModifierPadding(mod);
    left += p.left;
    top += p.top;
    right += p.right;
    bottom += p.bottom;
  }
  return { left, top, right, bottom };
}

/** Expand a pixel grid by adding null padding on all four sides. */
export function padPixelGrid(
  pixels: PixelGrid,
  padLeft: number,
  padTop: number,
  padRight: number,
  padBottom: number,
): PixelGrid {
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  const newW = padLeft + w + padRight;
  const newH = padTop + h + padBottom;

  const result: PixelGrid = Array.from({ length: newH }, (_, y) => {
    const row: (string | null)[] = Array(newW).fill(null);
    if (y >= padTop && y < padTop + h) {
      for (let x = 0; x < w; x++) {
        row[padLeft + x] = pixels[y - padTop][x];
      }
    }
    return row;
  });
  return result;
}

/** Compute required padding for a pixel-level animation modifier. */
function computeAnimModifierPadding(
  animMod: { enabled: boolean; type: string; params: Record<string, ModifierParamValue>; blendMode?: string },
  currentFrame: number,
  frameRate: number,
): { left: number; top: number; right: number; bottom: number } {
  if (!animMod.enabled) return { left: 0, top: 0, right: 0, bottom: 0 };

  // Compute weight from effective range — cast to the expected union type
  const { weight } = getAnimationFrameAndWeight(animMod as unknown as PartAnimationModifier, currentFrame);
  if (weight <= 0) return { left: 0, top: 0, right: 0, bottom: 0 };

  // V3.2: Apply converge factor
  const blendMode = animMod.blendMode || 'add';
  let convergeFactor = 1;
  if (blendMode === 'converge') {
    const convergeSpeed = Number(animMod.params.convergeSpeed) || 0.5;
    const { relativeFrame: cRelFrame } = getAnimationFrameAndWeight(animMod as unknown as PartAnimationModifier, currentFrame);
    convergeFactor = Math.exp(-convergeSpeed * cRelFrame * 0.1);
  }
  const effectiveWeight = weight * convergeFactor;

  switch (animMod.type) {
    case 'texture_scroll': {
      const scrollMode = String(animMod.params.scrollMode || 'loop');
      // Only bounce_canvas mode clips pixels; loop/bounce_loop modes wrap
      if (scrollMode === 'loop' || scrollMode === 'bounce_loop') {
        return { left: 0, top: 0, right: 0, bottom: 0 };
      }
      // bounce_canvas: compute max displacement
      const scrollSpeed = Number(animMod.params.scrollSpeed ?? 30);
      const elapsedSeconds = (frameRate > 0) ? currentFrame / frameRate : 0;
      const rawOffset = Math.abs(scrollSpeed * elapsedSeconds * effectiveWeight);
      const pad = Math.ceil(rawOffset);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    case 'wave_deform': {
      const transverseAmplitude = Number(animMod.params.transverseAmplitude ?? 5);
      const longitudinalAmplitude = Number(animMod.params.longitudinalAmplitude ?? 0);
      const waveType = String(animMod.params.waveType || 'transverse');
      let maxAmp = 0;
      if (waveType === 'transverse') {
        maxAmp = transverseAmplitude;
      } else if (waveType === 'longitudinal') {
        maxAmp = longitudinalAmplitude || transverseAmplitude;
      } else {
        // mixed: both contribute
        const ratio = Number(animMod.params.transLongRatio ?? 0.7);
        maxAmp = transverseAmplitude * Math.max(ratio, 1 - ratio)
          + longitudinalAmplitude * Math.max(1 - ratio, ratio);
      }
      const pad = Math.ceil(maxAmp * effectiveWeight);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    case 'bend': {
      const curvature = Number(animMod.params.curvature ?? 0.3);
      // Estimate max displacement: curvature * 0.5 * dim, use a generous 32px baseline
      const pad = Math.ceil(Math.abs(curvature) * 32 * effectiveWeight);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    case 'elliptical_compress': {
      const compressRatio = Number(animMod.params.compressRatio ?? 0.6);
      const preserveArea = Boolean(animMod.params.preserveArea);
      if (!preserveArea) return { left: 0, top: 0, right: 0, bottom: 0 };
      // When preserving area, the expanded axis can push pixels outward
      const expandRatio = 1 / (compressRatio + (1 - compressRatio) * (1 - effectiveWeight));
      const pad = Math.ceil((expandRatio - 1) * 32);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    case 'dumbbell_stretch': {
      const endRatio = Number(animMod.params.endRatio ?? 1.3);
      const stretchLength = Number(animMod.params.stretchLength ?? 1.2);
      const eEnd = 1 + (endRatio - 1) * effectiveWeight;
      const eStretch = 1 + (stretchLength - 1) * effectiveWeight;
      const padH = Math.ceil((eEnd - 1) * 16);
      const padW = Math.ceil((eStretch - 1) * 16);
      return { left: padW, top: padH, right: padW, bottom: padH };
    }
    case 'pillow_stretch': {
      const bulgeAmount = Number(animMod.params.bulgeAmount ?? 0.4);
      const pad = Math.ceil(Math.abs(bulgeAmount) * 16 * effectiveWeight);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    case 'hyperbolic_stretch': {
      const intensity = Number(animMod.params.intensity ?? 0.5);
      const pad = Math.ceil(intensity * 10 * effectiveWeight);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    case 'ring_ripple': {
      const amplitude = Number(animMod.params.amplitude ?? 3);
      const pad = Math.ceil(amplitude * effectiveWeight);
      return { left: pad, top: pad, right: pad, bottom: pad };
    }
    default:
      return { left: 0, top: 0, right: 0, bottom: 0 };
  }
}

/** Compute total required padding across all enabled animation modifiers. */
export function computeTotalAnimPadding(
  animModifiers: readonly { enabled: boolean; type: string; params: Record<string, ModifierParamValue>; blendMode?: string }[],
  currentFrame: number,
  frameRate: number,
): { left: number; top: number; right: number; bottom: number } {
  let left = 0, top = 0, right = 0, bottom = 0;
  for (const animMod of animModifiers) {
    if (!animMod.enabled) continue;
    if (!isPixelDeformModifier(animMod.type as ModifierType)) continue;
    const p = computeAnimModifierPadding(animMod, currentFrame, frameRate);
    left += p.left;
    top += p.top;
    right += p.right;
    bottom += p.bottom;
  }
  return { left, top, right, bottom };
}

/** Trim fully-transparent rows/columns from the edges of a pixel grid.
 *  Returns the trimmed grid and how many rows/columns were removed from the left/top. */
export function trimTransparentEdges(pixels: PixelGrid): { pixels: PixelGrid; trimLeft: number; trimTop: number } {
  const h = pixels.length;
  if (h === 0) return { pixels: [], trimLeft: 0, trimTop: 0 };
  const w = pixels[0]?.length || 0;
  if (w === 0) return { pixels: [[]], trimLeft: 0, trimTop: 0 };

  // Find top edge (first row with a non-null pixel)
  let top = 0;
  while (top < h && pixels[top].every(p => p === null)) top++;
  if (top >= h) return { pixels: [[]], trimLeft: 0, trimTop: 0 };

  // Find bottom edge (last row with a non-null pixel)
  let bottom = h - 1;
  while (bottom > top && pixels[bottom].every(p => p === null)) bottom--;

  // Find left edge (min x with a non-null pixel across all rows top..bottom)
  let left = w;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < left; x++) {
      if (pixels[y][x] !== null) { left = x; break; }
    }
  }

  // Find right edge (max x with a non-null pixel across all rows top..bottom)
  let right = left;
  for (let y = top; y <= bottom; y++) {
    for (let x = w - 1; x > right; x--) {
      if (pixels[y][x] !== null) { right = x; break; }
    }
  }

  // Crop to bounding box
  const result: PixelGrid = [];
  for (let y = top; y <= bottom; y++) {
    result.push(pixels[y].slice(left, right + 1));
  }

  return { pixels: result, trimLeft: left, trimTop: top };
}

export function applyPixelModifiers(
  part: Part,
  modifiers: ModifierInstance[],
  currentFrame: number = 0,
  /** Optional base pixels to use instead of part.pixels (e.g. keyframe.correctionMask) */
  basePixels?: PixelGrid,
): PixelModResult {
  const enabledMods = modifiers.filter(m => m.enabled);

  // Compute required padding from forward-mapping modifiers
  const padding = computeTotalPadding(enabledMods);

  // Create padded input grid
  const srcPixels = basePixels ?? part.pixels;
  let pixels: PixelGrid;
  if (padding.left > 0 || padding.top > 0 || padding.right > 0 || padding.bottom > 0) {
    pixels = padPixelGrid(srcPixels, padding.left, padding.top, padding.right, padding.bottom);
  } else {
    pixels = srcPixels.map((row) => [...row]);
  }

  for (const mod of modifiers) {
    if (!mod.enabled) continue;
    const renderer = modifierRegistry.get(mod.type);
    if (renderer) {
      pixels = renderer(mod.params, pixels, currentFrame);
    }
  }

  // Trim transparent edges and compute offset
  if (padding.left > 0 || padding.top > 0 || padding.right > 0 || padding.bottom > 0) {
    const trimmed = trimTransparentEdges(pixels);
    return {
      pixels: trimmed.pixels,
      offsetX: padding.left - trimmed.trimLeft,
      offsetY: padding.top - trimmed.trimTop,
    };
  }

  return { pixels, offsetX: 0, offsetY: 0 };
}
function applyColorReplace(pixels: PixelGrid, source: string, target: string, tolerance: number): PixelGrid {
  return pixels.map((row) =>
    row.map((pixel) => {
      if (!pixel) return pixel;
      if (colorDistance(pixel, source) <= tolerance) {
        return target;
      }
      return pixel;
    })
  );
}
/**
 * V2.5: Fast Outline Emphasis — Offset Overlay Algorithm
 *
 * Instead of per-pixel neighbor checking, this uses the offset-overlay method:
 * 1. Build an alpha mask of opaque pixels
 * 2. For each direction (4 or 8) and each distance (1..thickness),
 *    shift the "filled" (outline-colored) version and union into an outline layer
 * 3. Overlay the original content on top
 *
 * This is much faster for thick outlines (O(N * dirs * thickness) vs O(N * thickness²))
 * and produces uniform, clean outlines ideal for pixel art.
 *
 * Modes:
 * - solid: outline is a flat color
 * - darken: outline color is a darkened version of the nearest source pixel
 * - gradient (light-direction simulation): outline pixels use the nearest source
 *   pixel's actual color as the base, then apply directional lighting:
 *   pixels facing the light source are brightened (highlight), pixels facing
 *   away are darkened (shadow). This creates a natural 3D shading effect where
 *   the outline looks like an extension of the object's surface.
 */
function applyOutline(
  pixels: PixelGrid,
  thickness: number,
  color: string,
  directions: string = '8',
  outlineMode: string = 'solid',
  blendMode: string = 'normal',
  edgesOnly: boolean = true,
  lightAngle: number = 315,
): PixelGrid {
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  if (w === 0 || h === 0) return pixels;

  const dirCount = directions === '4' ? 4 : 8;
  const DIRS_4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const DIRS_8: [number, number][] = [...DIRS_4, [-1, -1], [-1, 1], [1, -1], [1, 1]];
  const dirs = dirCount === 4 ? DIRS_4 : DIRS_8;

  // Step 1: Build alpha mask
  const opaque: boolean[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => pixels[y][x] !== null)
  );

  // Step 2: Build outline layer using offset overlay
  // Track the minimum distance and nearest source color for each outline pixel
  const outlineColor: (string | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  const outlineDist: number[][] = Array.from({ length: h }, () => Array(w).fill(Infinity));
  // For gradient mode: track the direction vector from source pixel to outline pixel
  const outlineDirX: number[][] = Array.from({ length: h }, () => Array(w).fill(0));
  const outlineDirY: number[][] = Array.from({ length: h }, () => Array(w).fill(0));
  // For darken/gradient: track the nearest source pixel's color
  const outlineSrcColor: (string | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));

  // For each direction, offset the "filled" version
  for (const [dy, dx] of dirs) {
    for (let dist = 1; dist <= thickness; dist++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!opaque[y][x]) continue;
          // Target position after offset
          const ny = y + dy * dist;
          const nx = x + dx * dist;
          // Skip out-of-bounds or already-opaque positions
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          if (opaque[ny][nx]) continue;

          // Track minimum distance
          if (dist < outlineDist[ny][nx]) {
            outlineDist[ny][nx] = dist;

            // Store direction from source to outline pixel (normalized)
            const dirLen = Math.sqrt(dx * dx + dy * dy);
            outlineDirX[ny][nx] = dx / dirLen;
            outlineDirY[ny][nx] = dy / dirLen;

            // Store nearest source color
            outlineSrcColor[ny][nx] = pixels[y][x];

            // Compute outline color based on mode
            if (outlineMode === 'solid') {
              outlineColor[ny][nx] = color;
            } else if (outlineMode === 'darken') {
              // Use darkened version of the source pixel
              const srcColor = pixels[y][x];
              outlineColor[ny][nx] = srcColor ? darkenColor(srcColor, 0.4) : color;
            } else if (outlineMode === 'gradient') {
              // Will be computed after all offsets based on light direction
              outlineColor[ny][nx] = color; // placeholder
            }
          }
        }
      }
    }
  }

  // Step 3: For gradient (light-direction) mode, compute shading based on light angle
  // Key difference from solid mode: the outline color is based on the CONTENT pixel
  // (the source pixel that was offset), not a flat outline color.
  // This creates a natural 3D lighting effect where the outline looks like
  // an extension of the object's surface, just in shadow or highlight.
  //
  // Algorithm:
  // 1. Each outline pixel has a nearest source pixel (stored in outlineSrcColor)
  // 2. The direction from source→outline tells us which side of the shape this is on
  // 3. Dot product with light direction determines brightness:
  //    - Facing the light → lighten the content color (highlight)
  //    - Facing away → darken the content color (shadow)
  //    - Perpendicular → keep original content color
  //
  // Light angle convention: 0° = right, 90° = down, 180° = left, 270° = up
  // Default 315° = upper-right (classic pixel art light direction)
  if (outlineMode === 'gradient') {
    // Light source direction vector (pointing FROM the object TOWARD the light)
    const lightRad = (lightAngle * Math.PI) / 180;
    const lightDirX = Math.cos(lightRad);
    const lightDirY = Math.sin(lightRad);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (outlineColor[y][x] === null) continue;
        if (outlineDist[y][x] === Infinity) continue;

        // Direction from source pixel to outline pixel
        const dx = outlineDirX[y][x];
        const dy = outlineDirY[y][x];

        // Dot product: how much the outline direction aligns with the light direction
        // Positive = facing the light (bright), Negative = facing away (dark)
        const dot = dx * lightDirX + dy * lightDirY;

        // Map dot product from [-1, 1] to [0, 1] for color interpolation
        // dot = -1 → fully in shadow (dark), dot = 1 → fully lit (bright)
        const t = (dot + 1) / 2; // normalize to [0, 1]

        // Use the source content pixel's color as the base, NOT the outline color
        // This is the key difference: the outline is made of content-colored pixels
        // with lighting applied, creating a natural 3D shading effect
        const srcColor = outlineSrcColor[y][x];
        if (srcColor) {
          const darkVersion = darkenColor(srcColor, 0.3);   // shadow side: darkened content
          const lightVersion = lightenColor(srcColor, 0.5); // lit side: brightened content
          outlineColor[y][x] = lerpColor(darkVersion, lightVersion, t);
        }
        // If no source color (shouldn't happen for valid outline pixels), keep placeholder
      }
    }
  }

  // Step 4: Build result — outline layer + original on top
  const result: PixelGrid = pixels.map((row, y) =>
    row.map((pixel, x) => {
      if (pixel !== null) {
        // Original pixel: when edgesOnly is false, replace edge pixels with outline
        if (!edgesOnly) {
          // Check if this pixel is on the outer edge of the shape
          let isEdge = false;
          for (const [ddy, ddx] of DIRS_4) {
            const ey = y + ddy;
            const ex = x + ddx;
            if (ey < 0 || ey >= h || ex < 0 || ex >= w || !opaque[ey][ex]) {
              isEdge = true;
              break;
            }
          }
          if (isEdge) {
            // Replace edge pixel with outline color (inset outline effect)
            if (outlineMode === 'solid') return color;
            if (outlineMode === 'darken') return darkenColor(pixel, 0.4);
            // gradient mode: edge pixels use the outline color
            // (could also shade based on light direction, but this keeps it simple)
            return color;
          }
        }
        return pixel;
      }
      // Transparent pixel: fill with outline if present
      return outlineColor[y][x];
    })
  );

  return result;
}
// ============================================================
// V2.2: Cylinder Projection Rotation Modifier
// ============================================================

/**
 * Apply cylinder projection rotation.
 *
 * Treats the part's pixel grid as the unwrapped texture of a cylinder.
 * The texture wraps around 360° horizontally; the vertical axis is the cylinder height.
 * Rotation shifts which portion of the texture faces the viewer.
 *
 * Algorithm (front projection):
 * 1. Each output column x maps to an angle θ_out on the visible front face of the cylinder.
 * 2. With rotation angle α, the source angle is θ_src = θ_out + α.
 * 3. The source column is computed from θ_src, with wrap-around for seamless tiling.
 * 4. Columns near the left/right edges are slightly compressed (cosine foreshortening),
 *    simulating the curvature of the cylinder.
 *
 * For oblique projection, the visible arc is offset, showing more of one side.
 */
function applyCylinderRotate(
  pixels: PixelGrid,
  angleDeg: number,
  axisOffsetX: number,
  radiusShrinkRatio: number,
  projection: string,
  smooth: boolean,
  backFill: string,
): PixelGrid {
  if (angleDeg === 0) return pixels;

  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  if (w === 0 || h === 0) return pixels;

  const result: PixelGrid = Array.from({ length: h }, () => Array(w).fill(null));

  // Cylinder center offset (default: center of part)
  const cx = Math.floor(w / 2) + axisOffsetX;

  // Effective half-width: radiusShrinkRatio < 1 shrinks the projection area,
  // so the outer ring of pixels (outline) stays untouched and is not
  // treated as rotating texture.
  const effectiveHalfW = Math.max(1, (w / 2) * radiusShrinkRatio);

  // Rotation in radians
  const angleRad = (angleDeg * Math.PI) / 180;

  // The visible arc of the cylinder (front view shows 180°)
  // For oblique view, shift the visible arc center
  const viewOffset = projection === 'oblique' ? Math.PI / 6 : 0;

  // Texture tile: only the effective area, not the full part width.
  // Cyclic wrapping starts from the effective radius boundary,
  // so only pixels within the shrunk area participate in the texture cycle.
  const textureTileWidth = 2 * effectiveHalfW;
  const textureStartX = cx - effectiveHalfW;

  // Precompute edge colors for "extend" back-fill mode:
  // Find the nearest non-null pixel at each boundary edge of the projection area
  const leftEdgeX = Math.round(textureStartX);
  const rightEdgeX = Math.round(cx + effectiveHalfW);
  const leftEdgeColors: (string | null)[] = Array(h).fill(null);
  const rightEdgeColors: (string | null)[] = Array(h).fill(null);

  if (backFill === 'extend') {
    for (let y = 0; y < h; y++) {
      for (let searchX = leftEdgeX; searchX <= rightEdgeX; searchX++) {
        const sx = Math.max(0, Math.min(w - 1, searchX));
        if (pixels[y][sx] !== null) {
          leftEdgeColors[y] = pixels[y][sx];
          break;
        }
      }
      for (let searchX = rightEdgeX; searchX >= leftEdgeX; searchX--) {
        const sx = Math.max(0, Math.min(w - 1, searchX));
        if (pixels[y][sx] !== null) {
          rightEdgeColors[y] = pixels[y][sx];
          break;
        }
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Normalized position relative to cylinder center: -1 (left) to +1 (right)
      // Using effectiveHalfW so that only the inner region participates in projection
      const nx = (x - cx) / effectiveHalfW;

      // Pixels outside the scaled radius keep their original appearance
      if (Math.abs(nx) > 1) {
        // Outside the projection area — keep original pixel (outline stays intact)
        result[y][x] = pixels[y][x];
        continue;
      }

      // This output column's angle on the cylinder surface
      const thetaOut = nx * (Math.PI / 2) + viewOffset;

      // Cosine foreshortening factor: columns at edges appear compressed
      const cosFactor = Math.cos(thetaOut);

      // Check if this column is at the edge of the visible arc (back face)
      const isEdge = Math.abs(thetaOut - viewOffset) > Math.PI / 2 - 0.01;

      // Handle edge/back-face pixels for non-cyclic modes
      if (isEdge) {
        if (backFill === 'none') {
          // No fill — leave transparent
          continue;
        } else if (backFill === 'extend') {
          // Same-color extend: use the edge color from the nearer boundary
          if (thetaOut - viewOffset > 0) {
            result[y][x] = rightEdgeColors[y];
          } else {
            result[y][x] = leftEdgeColors[y];
          }
          continue;
        }
        // 'cyclic' falls through to normal sampling — no dimming,
        // because the texture has rotated into view
      }

      // Source angle on the cylinder after rotation
      const thetaSrc = thetaOut + angleRad;

      // Map source angle to texture position within the effective area only.
      // Full 2π rotation maps to the texture tile (textureTileWidth),
      // starting from textureStartX (left edge of effective area).
      // This ensures cyclic wrapping only uses texture from the shrunk area.
      const srcNx = thetaSrc / (Math.PI * 2);
      let srcX: number;

      if (smooth) {
        srcX = textureStartX + srcNx * textureTileWidth;
      } else {
        srcX = Math.round(textureStartX + srcNx * textureTileWidth);
      }

      // Wrap within the texture tile (effective area)
      const localX = ((srcX - textureStartX) % textureTileWidth + textureTileWidth) % textureTileWidth;
      srcX = Math.round(textureStartX + localX);

      // Clamp to valid pixel range
      srcX = Math.max(0, Math.min(w - 1, srcX));

      // Apply cosine compression to source x to simulate curvature
      const compressedSrcX = cx + (srcX - cx) * cosFactor;

      if (smooth) {
        // Simple bilinear sampling
        const x0 = Math.floor(compressedSrcX);
        const x1 = (x0 + 1) % w;
        const frac = compressedSrcX - x0;
        const wx0 = ((x0 % w) + w) % w;

        const c0 = pixels[y][wx0];
        const c1 = pixels[y][x1];

        if (c0 && c1) {
          // Blend colors
          const [r0, g0, b0] = hexToRgb(c0);
          const [r1, g1, b1] = hexToRgb(c1);
          const r = Math.round(r0 + (r1 - r0) * frac);
          const g = Math.round(g0 + (g1 - g0) * frac);
          const b = Math.round(b0 + (b1 - b0) * frac);
          result[y][x] = rgbToHex(r, g, b);
        } else {
          result[y][x] = c0 || c1;
        }
      } else {
        // Nearest neighbor
        const nearestX = ((Math.round(compressedSrcX) % w) + w) % w;
        result[y][x] = pixels[y][nearestX];
      }
    }
  }

  return result;
}
// ============================================================
// V2.2: Sphere (Mercator) Projection Rotation Modifier
// ============================================================

/**
 * Apply sphere projection rotation.
 *
 * Treats the part's pixel grid as a texture mapped onto a sphere.
 * Rotation around the vertical axis shifts which longitude faces the viewer.
 *
 * **Segmented mode (simplified, pixel-friendly):**
 * Divides the part into latitude bands. Each band shifts horizontally
 * by an amount proportional to cos(latitude) — the equator moves most,
 * the poles barely move, matching real sphere surface velocity.
 *
 * **Mercator mode (full projection):**
 * Uses equirectangular (Mercator-like) projection:
 * - x maps to longitude φ ∈ [-π, π]
 * - y maps to latitude λ ∈ [-maxLat, maxLat]
 * For each output pixel, computes the source longitude after rotation,
 * then samples the source pixel with cosine foreshortening at the edges.
 * Pixels beyond the visible hemisphere are hidden.
 */
function applySphereRotate(
  pixels: PixelGrid,
  angleDeg: number,
  mode: string,
  centerX: number,
  centerY: number,
  maxLatitude: number,
  radiusShrinkRatio: number,
  backFill: string,
): PixelGrid {
  if (angleDeg === 0) return pixels;

  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  if (w === 0 || h === 0) return pixels;

  const result: PixelGrid = Array.from({ length: h }, () => Array(w).fill(null));

  // Sphere center (default: geometric center)
  const cx = Math.floor(w / 2) + centerX;
  const cy = Math.floor(h / 2) + centerY;

  // Rotation in radians
  const angleRad = (angleDeg * Math.PI) / 180;

  // Effective radii: radiusShrinkRatio < 1 shrinks the projection disc,
  // so pixels outside the disc keep their original appearance (outline stays intact)
  const effectiveRadiusX = (w / 2) * radiusShrinkRatio;
  const effectiveRadiusY = (h / 2) * radiusShrinkRatio;

  // Texture tile dimensions: only the effective area, not the full part dimensions.
  // Cyclic wrapping starts from the effective radius boundary,
  // so only pixels within the shrunk area participate in the texture cycle.
  const textureWidth = 2 * effectiveRadiusX;
  const textureHeight = 2 * effectiveRadiusY;
  const textureStartX = cx - effectiveRadiusX;
  const textureStartY = cy - effectiveRadiusY;

  if (mode === 'mercator') {
    // Full Mercator projection mode
    const maxLatRad = (maxLatitude * Math.PI) / 180;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Distance from sphere center
        const dx = x - cx;
        const dy = y - cy;

        // Normalized position using effective radii
        const nx = dx / effectiveRadiusX;
        const ny = dy / effectiveRadiusY;
        const r2 = nx * nx + ny * ny;

        // Pixels outside the scaled radius keep their original appearance
        if (r2 > 1) {
          result[y][x] = pixels[y][x];
          continue;
        }

        // Compute 3D point on sphere surface
        const nz = Math.sqrt(Math.max(0, 1 - r2));

        // Spherical coordinates of the output point
        const lat = Math.asin(Math.max(-1, Math.min(1, -ny * Math.sin(maxLatRad))));
        const lon = Math.atan2(nx, nz);

        // Apply rotation
        const srcLon = lon - angleRad;

        // Check if the source longitude is on the back hemisphere
        let normalizedSrcLon = ((srcLon % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        const isBackHemisphere = Math.abs(normalizedSrcLon) > Math.PI / 2;

        if (isBackHemisphere) {
          if (backFill === 'none') {
            continue; // transparent
          } else if (backFill === 'extend') {
            // Extend: use the nearest edge pixel from the projection disc boundary
            const dist = Math.sqrt(r2);
            if (dist > 0.001) {
              const edgeNx = nx / dist;
              const edgeNy = ny / dist;
              const edgeX = Math.round(cx + edgeNx * effectiveRadiusX);
              const edgeY = Math.round(cy + edgeNy * effectiveRadiusY);
              if (edgeX >= 0 && edgeX < w && edgeY >= 0 && edgeY < h) {
                result[y][x] = pixels[edgeY][edgeX];
              }
            }
            continue;
          }
          // 'cyclic' falls through to normal sampling — no dimming,
          // because the texture has rotated into view
        }

        // Source texture coordinates — using effective area as texture tile
        // longitude φ ∈ [-π, π] maps to [textureStartX, textureStartX + textureWidth]
        const srcX = cx + (srcLon / Math.PI) * effectiveRadiusX;
        // latitude λ ∈ [-maxLatRad, maxLatRad] maps to [textureStartY, textureStartY + textureHeight]
        const srcY = cy - (lat / maxLatRad) * effectiveRadiusY;

        // Wrap source x within the texture tile (effective area)
        const localSrcX = ((srcX - textureStartX) % textureWidth + textureWidth) % textureWidth;
        const sx = Math.max(0, Math.min(w - 1, Math.round(textureStartX + localSrcX)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(srcY)));

        result[y][x] = pixels[sy][sx];
      }
    }
  } else {
    // Segmented mode: latitude-dependent horizontal shift
    // Using effective area as texture tile for cyclic wrapping

    for (let y = 0; y < h; y++) {
      // Compute latitude for this row
      const ny = (y - cy) / effectiveRadiusY; // -1 to +1
      const latRad = ny * (Math.PI / 2); // latitude in radians

      // Horizontal shift proportional to cos(latitude), using effective width
      const cosLat = Math.cos(latRad);
      const shiftPixels = angleRad / (2 * Math.PI) * textureWidth * cosLat;
      const shiftRounded = Math.round(shiftPixels);

      for (let x = 0; x < w; x++) {
        // Check if this pixel is within the sphere disc (using effective radii)
        const dx = (x - cx) / effectiveRadiusX;
        const dy = (y - cy) / effectiveRadiusY;
        const r2 = dx * dx + dy * dy;
        if (r2 > 1) {
          result[y][x] = pixels[y][x];
          continue;
        }

        // Compute source position with wrapping within the effective area
        const localX = x - cx;
        const shiftedLocalX = localX - shiftRounded;
        const wrappedLocalX = ((shiftedLocalX + effectiveRadiusX) % textureWidth + textureWidth) % textureWidth - effectiveRadiusX;
        const srcX = Math.max(0, Math.min(w - 1, Math.round(cx + wrappedLocalX)));

        // Check if the source is on the "back" hemisphere
        // In segmented mode, estimate by whether the shift exceeds the effective radius
        const isBackHemisphere = Math.abs(shiftedLocalX) > effectiveRadiusX;

        if (isBackHemisphere) {
          if (backFill === 'none') {
            continue; // transparent
          } else if (backFill === 'extend') {
            // Extend: use the edge color in this pixel's direction
            const dist = Math.sqrt(r2);
            if (dist > 0.001) {
              const edgeNx = dx / dist;
              const edgeX = Math.round(cx + edgeNx * effectiveRadiusX);
              if (edgeX >= 0 && edgeX < w) {
                result[y][x] = pixels[y][edgeX];
              }
            } else {
              result[y][x] = pixels[y][srcX];
            }
            continue;
          }
          // 'cyclic' falls through to show the wrapped texture — no dimming
        }

        result[y][x] = pixels[y][srcX];
      }
    }
  }

  return result;
}

/** Flood fill on a pixel grid (for PixelEdit fill command) */
function floodFillPixels(pixels: PixelColor[][], startX: number, startY: number, targetColor: PixelColor, fillColor: string): void {
  if (targetColor === fillColor) return;
  const height = pixels.length;
  const width = pixels[0].length;
  const stack: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (pixels[y][x] !== targetColor) continue;
    visited.add(key);
    pixels[y][x] = fillColor;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

/**
 * Render correction mask on top of the part
 */
export function renderCorrectionMask(
  ctx: CanvasRenderingContext2D,
  mask: PixelGrid,
  width: number,
  height: number,
  ox: number,
  oy: number
) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = mask[y]?.[x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}
