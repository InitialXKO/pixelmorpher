// ============================================================
// PixelMorpher - Teleport Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { hexToRgb, lerpColor, dimColor } from '../color-utils';
import { rgbToHex } from '../utils';
import { animRng } from '../noise';
import { modifierGuard, elapsedSeconds, emptyGrid } from './shared';

/** V9.5: Apply teleport — glitch scan lines + color shift + particle effect */
export function applyTeleport(
  pixels: PixelGrid,
  width: number,
  height: number,
  params: Record<string, ModifierParamValue>,
  currentFrame: number,
  frameRate: number,
  weight: number,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { h, w } = grid;

  const mode = String(params.mode || 'teleport_in');
  const duration = Number(params.duration ?? 15);
  const glitchIntensity = Number(params.glitchIntensity ?? 5);
  const scanLineSpeed = Number(params.scanLineSpeed ?? 30);
  const colorShift = Number(params.colorShift ?? 3);
  const scanLineColor = String(params.scanLineColor || '#00ffff');
  const particleDensity = Number(params.particleDensity ?? 0.3);
  const randomSeed = Number(params.randomSeed ?? 42);

  const progress = Math.min(1, weight);
  // For teleport_in: progress 0->1 means appearing; for teleport_out: 0->1 means disappearing
  const effectiveProgress = mode === 'teleport_in' ? progress : (1 - progress);

  const rng = animRng(randomSeed + currentFrame);
  const elapsed = elapsedSeconds(currentFrame, frameRate);

  const result: PixelGrid = emptyGrid(h, w);

  // Glitch: horizontal slice displacement
  const glitchAmount = (1 - effectiveProgress) * glitchIntensity;

  // Scan line position
  const scanLineY = Math.round((elapsed * scanLineSpeed) % h);

  for (let y = 0; y < h; y++) {
    // Per-row horizontal glitch offset
    let rowOffset = 0;
    if (rng() < 0.3 * (1 - effectiveProgress)) {
      rowOffset = Math.round((rng() - 0.5) * glitchAmount * 2);
    }

    // Scan line proximity
    const distToScan = Math.abs(y - scanLineY);
    const scanInfluence = distToScan < 3 ? (1 - distToScan / 3) * (1 - effectiveProgress) : 0;

    for (let x = 0; x < w; x++) {
      const srcX = x - rowOffset;
      const srcColor = (srcX >= 0 && srcX < w) ? pixels[y][srcX] : null;
      if (srcColor === null) continue;

      // Visibility based on progress
      let pixelOpacity = effectiveProgress;

      // Add particle-like random visibility near the edges
      if (effectiveProgress < 0.5) {
        const particleChance = rng();
        if (particleChance > effectiveProgress + particleDensity * (1 - effectiveProgress)) {
          pixelOpacity = 0;
        }
      }

      if (pixelOpacity <= 0.01) continue;

      // Color shift: offset RGB channels horizontally
      let finalColor = srcColor;
      if (colorShift > 0 && (1 - effectiveProgress) > 0.1) {
        const shiftX = Math.round(colorShift * (1 - effectiveProgress));
        const shiftedSrc = (x + shiftX < w) ? pixels[y]?.[x + shiftX] : null;
        if (shiftedSrc) {
          // Mix red channel from shifted pixel
          const [r1, g1, b1] = hexToRgb(srcColor);
          const [r2, g2, b2] = hexToRgb(shiftedSrc);
          const mixFactor = (1 - effectiveProgress) * 0.5;
          finalColor = rgbToHex(
            r1 * (1 - mixFactor) + r2 * mixFactor,
            g1,
            b1 * (1 - mixFactor) + b2 * mixFactor,
          );
        }
      }

      // Apply scan line overlay
      if (scanInfluence > 0) {
        finalColor = lerpColor(finalColor, scanLineColor, scanInfluence * 0.6);
      }

      // Apply opacity
      if (pixelOpacity >= 0.99) {
        result[y][x] = finalColor;
      } else {
        result[y][x] = dimColor(finalColor, pixelOpacity);
      }
    }
  }

  return result;
}
