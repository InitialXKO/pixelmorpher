// ============================================================
// PixelMorpher - CRT Off Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { lerpColor, dimColor } from '../color-utils';
import { modifierGuard, emptyGrid } from './shared';

export function applyCrtOff(
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

  const shrinkDuration = Number(params.shrinkDuration ?? 12);
  const flashDuration = Number(params.flashDuration ?? 3);
  const lineDuration = Number(params.lineDuration ?? 8);
  const dotDuration = Number(params.dotDuration ?? 15);
  const scanlineIntensity = Number(params.scanlineIntensity ?? 0.5);
  const flashColor = String(params.flashColor || '#ffffff');
  const dotColor = String(params.dotColor || '#ffffff');

  const totalDuration = shrinkDuration + flashDuration + lineDuration + dotDuration;
  const progress = Math.min(1, weight);
  const currentPhase = progress * totalDuration;

  const cx = w / 2, cy = h / 2;

  // Phase 1: Shrink vertically toward center line
  if (currentPhase < shrinkDuration) {
    const t = currentPhase / shrinkDuration;
    const eased = t * t; // accelerating shrink
    const verticalScale = 1 - eased;
    const result: PixelGrid = emptyGrid(h, w);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcColor = pixels[y][x];
        if (srcColor === null) continue;

        // Shrink y toward center
        const dy = y - cy;
        const newY = Math.round(cy + dy * verticalScale);

        // Also slightly compress horizontally
        const dx = x - cx;
        const hScale = 1 - eased * 0.3;
        const newX = Math.round(cx + dx * hScale);

        if (newX >= 0 && newX < w && newY >= 0 && newY < h) {
          // Brighten as we shrink (CRT phosphor concentration)
          const brighten = 1 + eased * 0.5;
          // Add scanlines
          let color = dimColor(srcColor, Math.min(1.8, brighten));
          if (scanlineIntensity > 0 && y % 2 === 0 && eased < 0.8) {
            color = dimColor(color, 1 - scanlineIntensity * eased * 0.5);
          }
          result[newY][newX] = color;
        }
      }
    }
    return result;
  }

  // Phase 2: White flash (brief)
  const flashStart = shrinkDuration;
  if (currentPhase < flashStart + flashDuration) {
    const flashT = (currentPhase - flashStart) / flashDuration;
    const result: PixelGrid = emptyGrid(h, w);

    // Horizontal line flash
    const lineHalfHeight = Math.max(1, Math.round(2 * (1 - flashT)));
    const flashIntensity = 1 - flashT;
    for (let dy = -lineHalfHeight; dy <= lineHalfHeight; dy++) {
      for (let dx = -Math.floor(w * 0.4); dx <= Math.floor(w * 0.4); dx++) {
        const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          result[py][px] = lerpColor('#000000', flashColor, flashIntensity * (1 - Math.abs(dx) / (w * 0.4)));
        }
      }
    }
    return result;
  }

  // Phase 3: Horizontal line fading
  const lineStart = flashStart + flashDuration;
  if (currentPhase < lineStart + lineDuration) {
    const lineT = (currentPhase - lineStart) / lineDuration;
    const result: PixelGrid = emptyGrid(h, w);

    // Shrinking horizontal line
    const lineHalfWidth = Math.max(1, Math.round(w * 0.3 * (1 - lineT)));
    const lineIntensity = 1 - lineT;
    for (let dx = -lineHalfWidth; dx <= lineHalfWidth; dx++) {
      const px = Math.round(cx) + dx, py = Math.round(cy);
      if (px >= 0 && px < w && py >= 0 && py < h) {
        result[py][px] = lerpColor('#000000', flashColor, lineIntensity * (1 - Math.abs(dx) / lineHalfWidth));
      }
    }
    return result;
  }

  // Phase 4: Dot fading to black
  const dotStart = lineStart + lineDuration;
  if (currentPhase < dotStart + dotDuration) {
    const dotT = (currentPhase - dotStart) / dotDuration;
    const result: PixelGrid = emptyGrid(h, w);

    const dotIntensity = (1 - dotT) * (1 - dotT); // quadratic fade
    const dotR = Math.max(1, Math.round(2 * (1 - dotT)));
    for (let dy = -dotR; dy <= dotR; dy++) {
      for (let dx = -dotR; dx <= dotR; dx++) {
        const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
        if (px >= 0 && px < w && py >= 0 && py < h && dx * dx + dy * dy <= dotR * dotR) {
          result[py][px] = lerpColor('#000000', dotColor, dotIntensity);
        }
      }
    }
    return result;
  }

  // After all phases: black
  return emptyGrid(h, w);
}
