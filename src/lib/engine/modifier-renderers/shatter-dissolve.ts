// ============================================================
// PixelMorpher - Shatter Dissolve Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { lerpColor, dimColor } from '../color-utils';
import { animRng } from '../noise';
import { modifierGuard, emptyGrid } from './shared';

/** V9.3: Apply shatter dissolve — fragment the image and scatter/dissolve */
export function applyShatterDissolve(
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

  const fragmentSize = Number(params.fragmentSize ?? 4);
  const shatterDuration = Number(params.shatterDuration ?? 10);
  const dissolveDuration = Number(params.dissolveDuration ?? 20);
  const scatterForce = Number(params.scatterForce ?? 5);
  const scatterDir = String(params.scatterDirection || 'outward');
  const fadeRate = Number(params.fadeRate ?? 0.05);
  const rotationSpeed = Number(params.rotationSpeed ?? 5);
  const randomSeed = Number(params.randomSeed ?? 42);

  const totalDuration = shatterDuration + dissolveDuration;
  const progress = Math.min(1, weight);
  const currentPhase = progress * totalDuration;

  const rng = animRng(randomSeed);

  // Calculate padding for scattered fragments
  const maxScatter = scatterForce * totalDuration;
  const pad = Math.ceil(maxScatter + fragmentSize * 2);
  const resultW = w + pad * 2;
  const resultH = h + pad * 2;
  const result: PixelGrid = emptyGrid(resultH, resultW);

  // Process each fragment
  for (let fy = 0; fy < h; fy += fragmentSize) {
    for (let fx = 0; fx < w; fx += fragmentSize) {
      const fragSeed = rng();
      const fragAngle = (fragSeed - 0.5) * rotationSpeed * (currentPhase / totalDuration);

      // Fragment center in source
      const fcx = fx + fragmentSize / 2;
      const fcy = fy + fragmentSize / 2;

      // Scatter direction
      let sdx = 0, sdy = 0;
      const partCx = w / 2, partCy = h / 2;
      switch (scatterDir) {
        case 'outward': {
          const dx = fcx - partCx, dy = fcy - partCy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          sdx = dx / len; sdy = dy / len;
          break;
        }
        case 'upward': sdx = 0; sdy = -1; break;
        case 'downward': sdx = 0; sdy = 1; break;
        case 'random': {
          const angle = fragSeed * Math.PI * 2;
          sdx = Math.cos(angle); sdy = Math.sin(angle);
          break;
        }
      }

      // Scatter offset (accelerating)
      const scatterT = Math.max(0, (currentPhase - shatterDuration * 0.3) / totalDuration);
      const offsetX = sdx * scatterForce * scatterT * scatterT * 2;
      const offsetY = sdy * scatterForce * scatterT * scatterT * 2;

      // Opacity fade during dissolve phase
      const dissolveT = Math.max(0, (currentPhase - shatterDuration) / dissolveDuration);
      const opacity = Math.max(0, 1 - dissolveT * (1 / Math.max(0.01, fadeRate * 20)));

      if (opacity <= 0.01) continue;

      // Copy fragment pixels with scatter offset and rotation
      const cosA = Math.cos(fragAngle * Math.PI / 180);
      const sinA = Math.sin(fragAngle * Math.PI / 180);

      for (let dy = 0; dy < fragmentSize && fy + dy < h; dy++) {
        for (let dx = 0; dx < fragmentSize && fx + dx < w; dx++) {
          const srcColor = pixels[fy + dy]?.[fx + dx];
          if (srcColor === null) continue;

          // Local fragment offset
          const lx = dx - fragmentSize / 2;
          const ly = dy - fragmentSize / 2;

          // Apply rotation around fragment center
          const rx = lx * cosA - ly * sinA;
          const ry = lx * sinA + ly * cosA;

          // Final position in result grid
          const destX = Math.round(pad + fx + dx + offsetX + rx - lx);
          const destY = Math.round(pad + fy + dy + offsetY + ry - ly);

          if (destX >= 0 && destX < resultW && destY >= 0 && destY < resultH) {
            if (opacity >= 0.99) {
              result[destY][destX] = srcColor;
            } else {
              const existing = result[destY][destX];
              if (existing) {
                result[destY][destX] = lerpColor(existing, srcColor, opacity);
              } else {
                result[destY][destX] = dimColor(srcColor, opacity);
              }
            }
          }
        }
      }
    }
  }

  return result;
}
