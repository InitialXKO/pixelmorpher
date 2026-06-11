// ============================================================
// PixelMorpher - Annihilate Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { lerpColor, dimColor } from '../color-utils';
import { animRng } from '../noise';
import { modifierGuard, emptyGrid } from './shared';

/** V9.4: Apply annihilation — energy implosion with flash, sparks, and afterglow */
export function applyAnnihilate(
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

  const implosionDuration = Number(params.implosionDuration ?? 8);
  const flashDuration = Number(params.flashDuration ?? 4);
  const flashColor = String(params.flashColor || '#ffffff');
  const implosionForce = Number(params.implosionForce ?? 8);
  const sparkCount = Number(params.sparkCount ?? 12);
  const sparkColor = String(params.sparkColor || '#ffaa00');
  const sparkLength = Number(params.sparkLength ?? 3);
  const afterglowColor = String(params.afterglowColor || '#ff4400');
  const afterglowDuration = Number(params.afterglowDuration ?? 10);

  const totalDuration = implosionDuration + flashDuration + afterglowDuration;
  const progress = Math.min(1, weight);
  const currentPhase = progress * totalDuration;

  const cx = w / 2, cy = h / 2;

  // Phase 1: Implosion — pixels shrink toward center
  if (currentPhase < implosionDuration) {
    const t = currentPhase / implosionDuration;
    const eased = t * t; // accelerating
    const shrink = 1 - eased;

    if (shrink <= 0.01) {
      // Fully imploded
      const result: PixelGrid = emptyGrid(h, w);
      // Small bright point at center
      const dotR = 2;
      for (let dy = -dotR; dy <= dotR; dy++) {
        for (let dx = -dotR; dx <= dotR; dx++) {
          const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
          if (px >= 0 && px < w && py >= 0 && py < h && dx * dx + dy * dy <= dotR * dotR) {
            result[py][px] = flashColor;
          }
        }
      }
      return result;
    }

    const result: PixelGrid = emptyGrid(h, w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcColor = pixels[y][x];
        if (srcColor === null) continue;

        // Move pixel toward center
        const dx = x - cx, dy = y - cy;
        const newX = Math.round(cx + dx * shrink);
        const newY = Math.round(cy + dy * shrink);

        if (newX >= 0 && newX < w && newY >= 0 && newY < h) {
          // Brighten as pixel approaches center
          const brighten = 1 + (1 - shrink) * 0.5;
          result[newY][newX] = dimColor(srcColor, Math.min(2, brighten));
        }
      }
    }
    return result;
  }

  // Phase 2: Flash
  const flashStart = implosionDuration;
  if (currentPhase < flashStart + flashDuration) {
    const flashT = (currentPhase - flashStart) / flashDuration;
    const result: PixelGrid = emptyGrid(h, w);

    // Bright flash fading out
    const flashIntensity = 1 - flashT;
    const flashRadius = Math.max(1, (1 - flashT) * Math.min(w, h) * 0.3);
    for (let dy = -Math.ceil(flashRadius); dy <= Math.ceil(flashRadius); dy++) {
      for (let dx = -Math.ceil(flashRadius); dx <= Math.ceil(flashRadius); dx++) {
        const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= flashRadius) {
            const intensity = (1 - dist / flashRadius) * flashIntensity;
            result[py][px] = lerpColor('#000000', flashColor, intensity);
          }
        }
      }
    }

    // Sparks
    const rng = animRng(42);
    for (let i = 0; i < sparkCount; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = (0.5 + rng() * 0.5) * implosionForce * flashT;
      const sx = Math.round(cx + Math.cos(angle) * speed);
      const sy = Math.round(cy + Math.sin(angle) * speed);
      for (let l = 0; l < sparkLength; l++) {
        const lx = Math.round(sx + Math.cos(angle) * l);
        const ly = Math.round(sy + Math.sin(angle) * l);
        if (lx >= 0 && lx < w && ly >= 0 && ly < h) {
          const sparkFade = (1 - l / sparkLength) * flashIntensity;
          result[ly][lx] = lerpColor(result[ly][lx] || '#000000', sparkColor, sparkFade);
        }
      }
    }
    return result;
  }

  // Phase 3: Afterglow
  const afterglowStart = flashStart + flashDuration;
  if (afterglowDuration > 0 && currentPhase < afterglowStart + afterglowDuration) {
    const glowT = (currentPhase - afterglowStart) / afterglowDuration;
    const result: PixelGrid = emptyGrid(h, w);

    const glowIntensity = (1 - glowT) * 0.6;
    const glowRadius = glowT * Math.min(w, h) * 0.4;
    for (let dy = -Math.ceil(glowRadius + 2); dy <= Math.ceil(glowRadius + 2); dy++) {
      for (let dx = -Math.ceil(glowRadius + 2); dx <= Math.ceil(glowRadius + 2); dx++) {
        const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= glowRadius + 1) {
            const ringDist = Math.abs(dist - glowRadius);
            if (ringDist < 3) {
              const ringIntensity = (1 - ringDist / 3) * glowIntensity;
              result[py][px] = lerpColor('#000000', afterglowColor, ringIntensity);
            }
          }
        }
      }
    }
    return result;
  }

  // After all phases: empty
  return emptyGrid(h, w);
}
