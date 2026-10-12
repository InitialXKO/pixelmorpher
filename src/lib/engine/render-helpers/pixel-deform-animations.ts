/**
 * Helper: apply pixel-level deformation animation modifiers.
 * Extracted from createPartCanvasInner to reduce cyclomatic complexity.
 *
 * Handles the animation modifier padding, per-modifier switch dispatch,
 * and transparent-edge trimming after animation deformation.
 */

import type { Part, Keyframe, PixelGrid, PartAnimationModifier } from '../../types';
import { padPixelGrid, computeTotalAnimPadding, isPixelDeformModifier, trimTransparentEdges } from '../pixel-modifiers';
import { resolveAnimModifierParams } from '../param-driver';
import { getAnimationFrameAndWeight } from '../animation-state';
import {
  applyTextureScroll, applyWaveDeform, applyContourScroll, applyRevealHide,
  applyShatterDissolve, applyAnnihilate, applyTeleport, applyCrtOff,
  applyBend, applyEllipticalCompress, applyDumbbellStretch,
  applyPillowStretch, applyHyperbolicStretch, applyRingRipple,
} from '../modifier-renderers';

export interface PixelDeformResult {
  pixels: PixelGrid;
  modOffsetX: number;
  modOffsetY: number;
}

/**
 * Apply pixel-level deformation animation modifiers to the pixel grid.
 * Returns the (potentially modified) pixel grid and adjusted offsets.
 */
export function applyPixelDeformAnimations(
  part: Part,
  keyframe: Keyframe | null,
  pixels: PixelGrid,
  currentFrame: number,
  frameRate: number,
  worldOffsetX: number,
  worldOffsetY: number,
  modOffsetX: number,
  modOffsetY: number,
  /** 覆盖的动画修改器（木偶节点用；Part 不再自带 animationModifiers） */
  overrideModifiers?: PartAnimationModifier[],
): PixelDeformResult {
  const animMods = overrideModifiers ?? [];
  if (animMods.length === 0) {
    return { pixels, modOffsetX, modOffsetY };
  }

  const effectiveWidth = keyframe?.overrideWidth ?? part.width;
  const effectiveHeight = keyframe?.overrideHeight ?? part.height;

  // Compute required padding for animation modifiers that can produce overflow
  const animPadding = computeTotalAnimPadding(animMods, currentFrame, frameRate);
  if (animPadding.left > 0 || animPadding.top > 0 || animPadding.right > 0 || animPadding.bottom > 0) {
    pixels = padPixelGrid(pixels, animPadding.left, animPadding.top, animPadding.right, animPadding.bottom);
    modOffsetX += animPadding.left;
    modOffsetY += animPadding.top;
  }

  // Apply each enabled pixel-deform animation modifier
  for (const rawAnimMod of animMods) {
    if (!rawAnimMod.enabled) continue;
    if (!isPixelDeformModifier(rawAnimMod.type)) continue;

    const animMod = resolveAnimModifierParams(rawAnimMod, currentFrame);
    const { weight } = getAnimationFrameAndWeight(animMod, currentFrame);
    if (weight <= 0) continue;

    const effectiveWeight = computeEffectiveWeight(animMod, currentFrame);
    pixels = dispatchDeformModifier(
      animMod, pixels, part.width, part.height,
      effectiveWidth, effectiveHeight,
      currentFrame, frameRate, effectiveWeight,
      worldOffsetX, worldOffsetY,
    );
  }

  // Trim transparent edges created by the animation padding
  if (animPadding.left > 0 || animPadding.top > 0 || animPadding.right > 0 || animPadding.bottom > 0) {
    const trimmed = trimTransparentEdges(pixels);
    pixels = trimmed.pixels;
    modOffsetX -= trimmed.trimLeft;
    modOffsetY -= trimmed.trimTop;
  }

  return { pixels, modOffsetX, modOffsetY };
}

// ── Internal helpers ──────────────────────────────────────────

/** Compute effective weight including converge factor */
function computeEffectiveWeight(animMod: PartAnimationModifier, currentFrame: number): number {
  const { weight } = getAnimationFrameAndWeight(animMod, currentFrame);
  if (weight <= 0) return 0;

  const blendMode = animMod.blendMode || 'add';
  if (blendMode === 'converge') {
    const convergeSpeed = Number(animMod.params.convergeSpeed) || 0.5;
    const { relativeFrame: cRelFrame } = getAnimationFrameAndWeight(animMod, currentFrame);
    const convergeFactor = Math.exp(-convergeSpeed * cRelFrame * 0.1);
    return weight * convergeFactor;
  }
  return weight;
}

/** Dispatch a single deformation modifier to the appropriate renderer */
function dispatchDeformModifier(
  animMod: PartAnimationModifier,
  pixels: PixelGrid,
  partWidth: number,
  partHeight: number,
  effectiveWidth: number,
  effectiveHeight: number,
  currentFrame: number,
  frameRate: number,
  effectiveWeight: number,
  worldOffsetX: number,
  worldOffsetY: number,
): PixelGrid {
  const { params, type } = animMod;
  const w = type === 'wave_deform' ? effectiveWidth : partWidth;
  const h = type === 'wave_deform' ? effectiveHeight : partHeight;

  switch (type) {
    case 'texture_scroll':
      return applyTextureScroll(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'wave_deform':
      return applyWaveDeform(pixels, w, h, params, currentFrame, frameRate, effectiveWeight, worldOffsetX, worldOffsetY);
    case 'contour_scroll':
      return applyContourScroll(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'reveal_hide':
      return applyRevealHide(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'shatter_dissolve':
      return applyShatterDissolve(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'annihilate':
      return applyAnnihilate(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'teleport':
      return applyTeleport(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'crt_off':
      return applyCrtOff(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'bend':
      return applyBend(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'elliptical_compress':
      return applyEllipticalCompress(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'dumbbell_stretch':
      return applyDumbbellStretch(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'pillow_stretch':
      return applyPillowStretch(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'hyperbolic_stretch':
      return applyHyperbolicStretch(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'ring_ripple':
      return applyRingRipple(pixels, partWidth, partHeight, params, currentFrame, frameRate, effectiveWeight);
    case 'pixel_edit': {
      // Edit modifier as non-destructive pixel deform on PuppetNode.
      // Applies brushCommands from params (same as old Part.editModifiers).
      const brushCommands = (params.brushCommands as any[]) || [];
      if (brushCommands.length === 0) return pixels;
      // Import the brush application logic from pixel-modifiers
      // For now, apply via the registry if available
      try {
        const { modifierRegistry } = require('../../pixel-modifiers');
        const handler = modifierRegistry.get('pixel_edit');
        if (handler) {
          return handler(params, pixels, currentFrame);
        }
      } catch {}
      return pixels;
    }
    default:
      return pixels;
  }
}
