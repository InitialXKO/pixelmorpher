/**
 * Helper: compute the effective part base pixels by resolving edit modifiers.
 * Extracted from createPartCanvasInner to reduce cyclomatic complexity.
 *
 * Applies part.editModifiers (or resolvedEditModifiers) to part.pixels,
 * handling pixel-modifying modifiers and translate shifts.
 */

import type { Part, Keyframe, ModifierInstance, ModifierType, PixelGrid, PixelColor } from '../../types';
import { applyPixelModifiers } from '../pixel-modifiers';
import { resolveKeyframeModifierParams } from '../param-driver';

export interface PartBaseResult {
  partBasePixels: PixelGrid;
  partBaseOffsetX: number;
  partBaseOffsetY: number;
  partBaseIsUnique: boolean;
}

/** Modifier types that operate at the pixel level (not geometric transforms) */
const PIXEL_MOD_TYPES: ModifierType[] = [
  'color_replace', 'outline', 'dither', 'pixel_displace',
  'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
];

/**
 * Resolve edit modifiers and apply them to part.pixels.
 * Returns the computed base pixels along with offset and uniqueness tracking.
 */
export function computePartBasePixels(
  part: Part,
  keyframe: Keyframe | null,
  currentFrame: number,
  resolvedEditModifiers?: ModifierInstance[],
): PartBaseResult {
  const rawEditMods = resolvedEditModifiers ?? part.editModifiers;

  // Resolve paramKeyframes/paramDrivers on part-level edit modifiers
  const effectiveEditMods = shouldResolveEditMods(rawEditMods)
    ? resolveKeyframeModifierParams(rawEditMods, currentFrame)
    : rawEditMods;

  // No edit modifiers → reference original pixels without copy
  if (!effectiveEditMods || effectiveEditMods.length === 0) {
    return {
      partBasePixels: part.pixels,
      partBaseOffsetX: 0,
      partBaseOffsetY: 0,
      partBaseIsUnique: false,
    };
  }

  // Apply pixel-modifying edit modifiers
  const activePartMods = effectiveEditMods.filter(m => PIXEL_MOD_TYPES.includes(m.type) && m.enabled);
  let partBasePixels: PixelGrid;
  let partBaseOffsetX = 0;
  let partBaseOffsetY = 0;
  let partBaseIsUnique = false;

  if (activePartMods.length > 0) {
    const modResult = applyPixelModifiers(part, activePartMods, 0, part.pixels);
    partBasePixels = modResult.pixels;
    partBaseOffsetX = modResult.offsetX;
    partBaseOffsetY = modResult.offsetY;
    partBaseIsUnique = true;
  } else {
    partBasePixels = part.pixels;
    partBaseIsUnique = false;
  }

  // Apply translate shift from part edit modifiers
  const translateMod = effectiveEditMods.find(m => m.type === 'translate' && m.enabled);
  if (translateMod) {
    const result = applyTranslateShift(partBasePixels, translateMod);
    partBasePixels = result.pixels;
    partBaseIsUnique = result.wasShifted || partBaseIsUnique;
  }

  return { partBasePixels, partBaseOffsetX, partBaseOffsetY, partBaseIsUnique };
}

// ── Internal helpers ──────────────────────────────────────────

function shouldResolveEditMods(mods: ModifierInstance[] | undefined): boolean {
  return !!(mods && mods.length > 0 && mods.some(m =>
    (m.paramKeyframes && m.paramKeyframes.length > 0) ||
    (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some(d => d.enabled && !d.isBaked))
  ));
}

interface ShiftResult {
  pixels: PixelGrid;
  wasShifted: boolean;
}

function applyTranslateShift(pixels: PixelGrid, translateMod: ModifierInstance): ShiftResult {
  const dx = Math.round(Number(translateMod.params.offsetX) || 0);
  const dy = Math.round(Number(translateMod.params.offsetY) || 0);
  if (dx === 0 && dy === 0) return { pixels, wasShifted: false };

  const gridH = pixels.length;
  const gridW = pixels[0]?.length || 0;
  const shifted: PixelGrid = [];
  for (let y = 0; y < gridH; y++) {
    const row: PixelColor[] = [];
    for (let x = 0; x < gridW; x++) {
      const srcX = x - dx;
      const srcY = y - dy;
      if (srcX >= 0 && srcX < gridW && srcY >= 0 && srcY < gridH) {
        row.push(pixels[srcY]?.[srcX] ?? null);
      } else {
        row.push(null);
      }
    }
    shifted.push(row);
  }
  return { pixels: shifted, wasShifted: true };
}
