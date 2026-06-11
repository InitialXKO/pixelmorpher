// ============================================================
// PixelMorpher - Reveal/Hide Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { animRng, animEase } from '../noise';
import { modifierGuard, emptyGrid } from './shared';

/** V9.2: Apply reveal/hide animation — wipe, dissolve, blinds, radial transitions */
export function applyRevealHide(
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

  const mode = String(params.mode || 'reveal');
  const transitionType = String(params.transitionType || 'wipe_right');
  const duration = Number(params.duration ?? 20);
  const easing = String(params.easing || 'smooth');
  const randomSeed = Number(params.randomSeed ?? 42);
  const blindsCount = Number(params.blindsCount ?? 6);

  // Progress is based on relative frame position within the modifier's effective range
  const progress = Math.min(1, weight);
  const easedProgress = animEase(progress, easing);

  const result: PixelGrid = emptyGrid(h, w);
  const rng = animRng(randomSeed);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = pixels[y][x];
      if (pixel === null) continue;

      let threshold: number;
      const nx = x / w; // 0-1 normalized x
      const ny = y / h; // 0-1 normalized y

      switch (transitionType) {
        case 'wipe_right': threshold = nx; break;
        case 'wipe_left': threshold = 1 - nx; break;
        case 'wipe_down': threshold = ny; break;
        case 'wipe_up': threshold = 1 - ny; break;
        case 'radial_out': {
          const cx = 0.5, cy = 0.5;
          const dist = Math.sqrt((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy));
          threshold = dist / 0.7; // normalize to ~1 at edges
          break;
        }
        case 'radial_in': {
          const cx2 = 0.5, cy2 = 0.5;
          const dist2 = Math.sqrt((nx - cx2) * (nx - cx2) + (ny - cy2) * (ny - cy2));
          threshold = 1 - dist2 / 0.7;
          break;
        }
        case 'pixel_dissolve': {
          threshold = rng();
          break;
        }
        case 'blinds': {
          const blindIndex = Math.floor(ny * blindsCount);
          const withinBlind = (ny * blindsCount) - blindIndex;
          threshold = (blindIndex % 2 === 0) ? withinBlind : 1 - withinBlind;
          break;
        }
        default: threshold = nx;
      }

      const visible = mode === 'reveal'
        ? (easedProgress >= threshold)
        : (easedProgress < threshold);

      if (visible) {
        result[y][x] = pixel;
      }
    }
  }

  return result;
}
