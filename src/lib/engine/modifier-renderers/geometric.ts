// ============================================================
// PixelMorpher - Geometric Deformation Modifier Renderers
// bend, elliptical_compress, dumbbell_stretch, pillow_stretch,
// hyperbolic_stretch, ring_ripple
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { hexToRgb } from '../color-utils';
import { geoRng } from '../noise';
import { modifierGuard, elapsedSeconds, emptyGrid } from './shared';

/** Find nearest non-null source pixel for hole filling */
function findNearestSourceColor(pixels: PixelGrid, x: number, y: number, maxRadius: number = 10): string | null {
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only check perimeter
        const sx = x + dx, sy = y + dy;
        if (sx >= 0 && sx < w && sy >= 0 && sy < h && pixels[sy][sx] !== null) {
          return pixels[sy][sx];
        }
      }
    }
  }
  return null;
}

/**
 * V10.1: Apply bend deformation — bends the part along a direction with configurable curvature.
 *
 * Algorithm (inverse mapping):
 * For each destination pixel (dx, dy), compute the source pixel (sx, sy) by:
 * 1. Normalize position relative to part center
 * 2. Apply bend displacement based on bendMode:
 *    - arc: displacement follows circular arc curvature
 *    - s_curve: sinusoidal S-curve
 *    - fishtail: exponential fishtail bend
 * 3. Scale displacement by curvature and weight
 * 4. Copy source pixel to destination with optional smooth sampling
 */
export function applyBend(
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

  const direction = String(params.direction || 'horizontal');
  const curvature = Number(params.curvature ?? 0.3);
  const bendMode = String(params.bendMode || 'arc');
  const sPeriods = Number(params.sPeriods ?? 1);
  const centerBias = Number(params.centerBias ?? 0) / 100;
  const falloff = Number(params.falloff ?? 1);
  const phaseSpeed = Number(params.phaseSpeed ?? 0);
  const smoothSampling = Boolean(params.smoothSampling);
  const holeFill = String(params.holeFill || 'edge_copy');

  if (curvature === 0) return pixels;

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const phase = phaseSpeed * elapsed;
  const cx = w / 2 + (centerBias * w / 2);
  const cy = h / 2;

  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Normalize position relative to center
      let nx: number, ny: number;
      if (direction === 'horizontal') {
        // Bend along horizontal axis: displacement is in Y based on X position
        nx = (x - cx) / (w / 2); // -1 to 1
        ny = (y - cy) / (h / 2);
      } else {
        // Bend along vertical axis: displacement is in X based on Y position
        nx = (x - cx) / (w / 2);
        ny = (y - cy) / (h / 2);
      }

      // Compute bend displacement
      let displacement: number;
      if (bendMode === 'arc') {
        // Arc bend: displacement = curvature * t^2 (parabolic approximation of circular arc)
        const t = direction === 'horizontal' ? nx : ny;
        displacement = curvature * t * t * Math.sign(t) * weight;
      } else if (bendMode === 's_curve') {
        // S-curve: sinusoidal bend
        const t = direction === 'horizontal' ? nx : ny;
        displacement = curvature * Math.sin(t * Math.PI * sPeriods + phase) * weight;
      } else {
        // fishtail: exponential — displacement increases rapidly at the tail
        const t = direction === 'horizontal' ? nx : ny;
        const absT = Math.abs(t);
        const sign = Math.sign(t) || 1;
        displacement = curvature * sign * Math.pow(absT, 1 + falloff) * weight;
      }

      // Apply falloff (distance from center in the non-bend direction)
      if (direction === 'horizontal') {
        const distFactor = 1 - Math.min(1, Math.abs(ny) * falloff);
        displacement *= distFactor;
      } else {
        const distFactor = 1 - Math.min(1, Math.abs(nx) * falloff);
        displacement *= distFactor;
      }

      // Compute source pixel position (inverse mapping)
      let sx: number, sy: number;
      if (direction === 'horizontal') {
        sx = x;
        sy = y - Math.round(displacement * (h / 2));
      } else {
        sx = x - Math.round(displacement * (w / 2));
        sy = y;
      }

      // Sample source pixel
      if (smoothSampling) {
        // Bilinear interpolation
        const srcX = direction === 'horizontal' ? x : x - displacement * (w / 2);
        const srcY = direction === 'horizontal' ? y - displacement * (h / 2) : y;
        const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
        const x1 = x0 + 1, y1 = y0 + 1;
        const fx = srcX - x0, fy = srcY - y0;

        const c00 = (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) ? pixels[y0][x0] : null;
        const c10 = (x1 >= 0 && x1 < w && y0 >= 0 && y0 < h) ? pixels[y0][x1] : null;
        const c01 = (x0 >= 0 && x0 < w && y1 >= 0 && y1 < h) ? pixels[y1][x0] : null;
        const c11 = (x1 >= 0 && x1 < w && y1 >= 0 && y1 < h) ? pixels[y1][x1] : null;

        if (c00 || c10 || c01 || c11) {
          // Use nearest non-null for pixel art
          if (c00) result[y][x] = c00;
          else if (c10) result[y][x] = c10;
          else if (c01) result[y][x] = c01;
          else if (c11) result[y][x] = c11;
        }
      } else {
        // Nearest neighbor
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          result[y][x] = pixels[sy][sx];
        }
      }

      // Hole filling
      if (result[y][x] === null && holeFill === 'edge_copy') {
        const nearest = findNearestSourceColor(pixels, x, y);
        if (nearest !== null) {
          result[y][x] = nearest;
        }
      }
    }
  }

  return result;
}

/**
 * V10.2: Apply elliptical compression — compresses the part into an elliptical shape.
 *
 * Algorithm (inverse mapping):
 * For each destination pixel, compute the source by applying an elliptical scaling:
 * 1. Translate to center
 * 2. Apply non-uniform scaling (different X/Y scale factors for ellipse)
 * 3. If preserveArea: expand the non-compressed axis to maintain total area
 * 4. Anisotropy adds rotational skew to the ellipse
 */
export function applyEllipticalCompress(
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

  const compressAxis = String(params.compressAxis || 'y');
  const compressRatio = Number(params.compressRatio ?? 0.6);
  const centerX = Number(params.centerX ?? 0) / 100;
  const centerY = Number(params.centerY ?? 0) / 100;
  const preserveArea = Boolean(params.preserveArea);
  const anisotropy = Number(params.anisotropy ?? 0);
  const phaseSpeed = Number(params.phaseSpeed ?? 0);
  const smoothSampling = Boolean(params.smoothSampling);
  const holeFill = String(params.holeFill || 'edge_copy');

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const phase = phaseSpeed * elapsed;

  // Compute scale factors based on compress axis
  // Weight interpolates between identity (weight=0) and full compression (weight=1)
  let scaleX: number, scaleY: number;
  const effectiveCompress = compressRatio + (1 - compressRatio) * (1 - weight);

  if (compressAxis === 'y') {
    scaleX = preserveArea ? 1 / effectiveCompress : 1;
    scaleY = effectiveCompress;
  } else if (compressAxis === 'x') {
    scaleX = effectiveCompress;
    scaleY = preserveArea ? 1 / effectiveCompress : 1;
  } else {
    // both
    scaleX = effectiveCompress;
    scaleY = effectiveCompress;
  }

  // Apply anisotropy as a rotational offset
  const anisoAngle = anisotropy * Math.PI / 4 + phase * 0.1;

  const cx = w / 2 + centerX * w / 2;
  const cy = h / 2 + centerY * h / 2;

  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Translate to center
      let dx = x - cx;
      let dy = y - cy;

      // Apply anisotropy rotation (forward transform on source coords)
      if (anisotropy !== 0) {
        const cosA = Math.cos(-anisoAngle);
        const sinA = Math.sin(-anisoAngle);
        const rdx = dx * cosA - dy * sinA;
        const rdy = dx * sinA + dy * cosA;
        dx = rdx;
        dy = rdy;
      }

      // Inverse scale to find source position
      let srcDx = dx / scaleX;
      let srcDy = dy / scaleY;

      // Undo anisotropy rotation
      if (anisotropy !== 0) {
        const cosA = Math.cos(anisoAngle);
        const sinA = Math.sin(anisoAngle);
        const rdx = srcDx * cosA - srcDy * sinA;
        const rdy = srcDx * sinA + srcDy * cosA;
        srcDx = rdx;
        srcDy = rdy;
      }

      const sx = Math.round(srcDx + cx);
      const sy = Math.round(srcDy + cy);

      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        result[y][x] = pixels[sy][sx];
      }

      // Hole filling
      if (result[y][x] === null && holeFill === 'edge_copy') {
        const nearest = findNearestSourceColor(pixels, x, y);
        if (nearest !== null) {
          result[y][x] = nearest;
        }
      }
    }
  }

  return result;
}

/**
 * V10.3: Apply dumbbell stretch — creates a dumbbell/barbell shape
 * (thin center neck, thick/swollen ends).
 *
 * Algorithm (inverse mapping):
 * For each destination pixel, the perpendicular scale factor varies along the stretch axis:
 * - At the center: scale = neckRatio (thin)
 * - At the ends: scale = endRatio (thick)
 * - Transition follows a smooth cosine interpolation over transitionWidth
 * - The stretch axis itself is elongated by stretchLength
 */
export function applyDumbbellStretch(
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

  const direction = String(params.direction || 'horizontal');
  const neckRatio = Number(params.neckRatio ?? 0.4);
  const endRatio = Number(params.endRatio ?? 1.3);
  const transitionWidth = Number(params.transitionWidth ?? 0.3);
  const stretchLength = Number(params.stretchLength ?? 1.2);
  const centerX = Number(params.centerX ?? 0) / 100;
  const centerY = Number(params.centerY ?? 0) / 100;
  const phaseSpeed = Number(params.phaseSpeed ?? 0);
  const smoothSampling = Boolean(params.smoothSampling);
  const holeFill = String(params.holeFill || 'edge_copy');

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const phase = phaseSpeed * elapsed;

  // Effective ratios interpolated by weight
  const eNeck = 1 + (neckRatio - 1) * weight;
  const eEnd = 1 + (endRatio - 1) * weight;
  const eStretch = 1 + (stretchLength - 1) * weight;

  const cx = w / 2 + centerX * w / 2;
  const cy = h / 2 + centerY * h / 2;

  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x - cx;
      let dy = y - cy;

      // Rotate by phase for animation
      if (phase !== 0) {
        const cosP = Math.cos(-phase * 0.05);
        const sinP = Math.sin(-phase * 0.05);
        const rdx = dx * cosP - dy * sinP;
        const rdy = dx * sinP + dy * cosP;
        dx = rdx;
        dy = rdy;
      }

      let srcDx: number, srcDy: number;

      if (direction === 'horizontal') {
        // t is the normalized position along the horizontal axis (-1 to 1)
        const t = eStretch !== 0 ? dx / (w / 2 * eStretch) : dx / (w / 2);
        const absT = Math.min(1, Math.abs(t));

        // Perpendicular scale varies: neck at center, end at edges
        // Use smooth cosine interpolation between neck and end
        const halfTrans = transitionWidth / 2;
        let perpScale: number;
        if (absT < 0.5 - halfTrans) {
          perpScale = eNeck;
        } else if (absT > 0.5 + halfTrans) {
          perpScale = eEnd;
        } else {
          // Cosine interpolation in transition zone
          const interpT = (absT - (0.5 - halfTrans)) / (2 * halfTrans);
          const smooth = (1 - Math.cos(interpT * Math.PI)) / 2;
          perpScale = eNeck + (eEnd - eNeck) * smooth;
        }

        srcDx = dx / eStretch;
        srcDy = dy / perpScale;
      } else {
        // vertical
        const t = eStretch !== 0 ? dy / (h / 2 * eStretch) : dy / (h / 2);
        const absT = Math.min(1, Math.abs(t));

        const halfTrans = transitionWidth / 2;
        let perpScale: number;
        if (absT < 0.5 - halfTrans) {
          perpScale = eNeck;
        } else if (absT > 0.5 + halfTrans) {
          perpScale = eEnd;
        } else {
          const interpT = (absT - (0.5 - halfTrans)) / (2 * halfTrans);
          const smooth = (1 - Math.cos(interpT * Math.PI)) / 2;
          perpScale = eNeck + (eEnd - eNeck) * smooth;
        }

        srcDx = dx / perpScale;
        srcDy = dy / eStretch;
      }

      // Undo phase rotation
      if (phase !== 0) {
        const cosP = Math.cos(phase * 0.05);
        const sinP = Math.sin(phase * 0.05);
        const rdx = srcDx * cosP - srcDy * sinP;
        const rdy = srcDx * sinP + srcDy * cosP;
        srcDx = rdx;
        srcDy = rdy;
      }

      const sx = Math.round(srcDx + cx);
      const sy = Math.round(srcDy + cy);

      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        result[y][x] = pixels[sy][sx];
      }

      // Hole filling
      if (result[y][x] === null && holeFill === 'edge_copy') {
        const nearest = findNearestSourceColor(pixels, x, y);
        if (nearest !== null) {
          result[y][x] = nearest;
        }
      }
    }
  }

  return result;
}

/**
 * V10.4: Apply pillow stretch — bulge or pinch deformation like a pillow cushion.
 *
 * Algorithm (inverse mapping):
 * For each destination pixel, compute the displacement from center:
 * 1. Compute normalized distance from center (elliptical with radiusX/radiusY)
 * 2. If within radius, apply bulge displacement:
 *    - Positive bulgeAmount: push pixels outward (magnify center)
 *    - Negative bulgeAmount: pull pixels inward (pinch)
 * 3. Displacement magnitude follows the selected falloff curve
 * 4. Displacement direction is always radially outward from center
 */
export function applyPillowStretch(
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

  const bulgeAmount = Number(params.bulgeAmount ?? 0.4);
  const centerX = Number(params.centerX ?? 0) / 100;
  const centerY = Number(params.centerY ?? 0) / 100;
  const radiusX = Number(params.radiusX ?? 100) / 100;
  const radiusY = Number(params.radiusY ?? 100) / 100;
  const falloffCurve = String(params.falloffCurve || 'cosine');
  const phaseSpeed = Number(params.phaseSpeed ?? 0);
  const smoothSampling = Boolean(params.smoothSampling);
  const holeFill = String(params.holeFill || 'edge_copy');

  if (bulgeAmount === 0) return pixels;

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const phase = phaseSpeed * elapsed;

  const cx = w / 2 + centerX * w / 2;
  const cy = h / 2 + centerY * h / 2;
  const rx = w / 2 * radiusX;
  const ry = h / 2 * radiusY;

  const effectiveBulge = bulgeAmount * weight;

  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Normalized distance from center (elliptical)
      const dx = x - cx;
      const dy = y - cy;
      const nx = rx > 0 ? dx / rx : 0;
      const ny = ry > 0 ? dy / ry : 0;
      const dist = Math.sqrt(nx * nx + ny * ny);

      if (dist > 1.001) {
        // Outside the bulge radius — copy source pixel directly
        if (x >= 0 && x < w && y >= 0 && y < h) {
          result[y][x] = pixels[y][x];
        }
        continue;
      }

      // Compute bulge factor based on falloff curve
      let factor: number;
      const t = dist; // 0 at center, 1 at edge
      if (falloffCurve === 'cosine') {
        factor = Math.cos(t * Math.PI / 2);
      } else if (falloffCurve === 'linear') {
        factor = 1 - t;
      } else if (falloffCurve === 'quadratic') {
        factor = (1 - t) * (1 - t);
      } else {
        // exponential
        factor = Math.exp(-3 * t);
      }

      // Add phase animation as a pulsing bulge
      const animatedBulge = effectiveBulge + Math.sin(phase) * 0.05;

      // Inverse mapping: to find source pixel, reverse the displacement
      // Displacement pushes pixels outward: dest = src + bulge * factor * direction
      // So: src = dest - bulge * factor * direction
      const displacement = animatedBulge * factor;
      const srcDx = dx / (1 + displacement);
      const srcDy = dy / (1 + displacement);

      const sx = Math.round(srcDx + cx);
      const sy = Math.round(srcDy + cy);

      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        result[y][x] = pixels[sy][sx];
      }

      // Hole filling
      if (result[y][x] === null && holeFill === 'edge_copy') {
        const nearest = findNearestSourceColor(pixels, x, y);
        if (nearest !== null) {
          result[y][x] = nearest;
        }
      }
    }
  }

  return result;
}

/**
 * V10.5: Apply hyperbolic stretch — stretches pixels using a hyperbolic tangent mapping.
 *
 * Algorithm (inverse mapping):
 * Uses tanh-based distortion which creates a "fish-eye" or "anti-fish-eye" effect:
 * - For radial mode: pixels near center are compressed (magnified) while
 *   pixels far from center are stretched (minified), following a tanh curve
 * - For horizontal/vertical: the same principle applied along one axis only
 * - Asymmetry allows shifting the distortion center off-center
 *
 * The tanh mapping provides smooth, natural-looking distortion that's stronger
 * at the center and gradually normalizes toward the edges.
 */
export function applyHyperbolicStretch(
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

  const intensity = Number(params.intensity ?? 0.5);
  const direction = String(params.direction || 'radial');
  const centerX = Number(params.centerX ?? 0) / 100;
  const centerY = Number(params.centerY ?? 0) / 100;
  const asymmetry = Number(params.asymmetry ?? 0);
  const falloff = Number(params.falloff ?? 1);
  const phaseSpeed = Number(params.phaseSpeed ?? 0);
  const smoothSampling = Boolean(params.smoothSampling);
  const holeFill = String(params.holeFill || 'edge_copy');

  if (intensity === 0) return pixels;

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const phase = phaseSpeed * elapsed;
  const effectiveIntensity = intensity * weight;

  const cx = w / 2 + centerX * w / 2;
  const cy = h / 2 + centerY * h / 2;

  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;

      let srcDx: number, srcDy: number;

      if (direction === 'radial') {
        // Radial hyperbolic stretch
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2));
        const nd = maxDist > 0 ? dist / maxDist : 0;

        // Hyperbolic mapping: tanh compresses near center, stretches far
        // Inverse: srcDist = atanh(nd * k) / k (approximated)
        // Simplified: use tanh-based scaling factor
        const k = effectiveIntensity * falloff;
        // Forward mapping: dest = tanh(src * k) / tanh(k) * maxDist
        // Inverse: src = atanh(dest * tanh(k) / maxDist) / k
        const tanhK = Math.tanh(k);
        let srcNd: number;
        if (tanhK > 0.001) {
          const arg = nd * tanhK;
          srcNd = Math.abs(arg) < 0.999 ? Math.atanh(arg) / k : nd;
        } else {
          srcNd = nd;
        }

        // Apply asymmetry as a directional offset
        const asymAngle = Math.atan2(dy, dx) + asymmetry * Math.PI / 4;
        const asymFactor = 1 + asymmetry * 0.3 * Math.cos(asymAngle + phase * 0.1);

        if (dist > 0.001) {
          const ratio = (srcNd * asymFactor) / nd;
          srcDx = dx * ratio;
          srcDy = dy * ratio;
        } else {
          srcDx = dx;
          srcDy = dy;
        }
      } else {
        // Horizontal or vertical hyperbolic stretch
        const isHorizontal = direction === 'horizontal';
        const halfDim = isHorizontal ? w / 2 : h / 2;
        const component = isHorizontal ? dx : dy;
        const nc = halfDim > 0 ? component / halfDim : 0;

        const k = effectiveIntensity * falloff;
        const tanhK = Math.tanh(k);
        let srcNc: number;
        if (tanhK > 0.001) {
          const arg = nc * tanhK;
          srcNc = Math.abs(arg) < 0.999 ? Math.atanh(arg) / k : nc;
        } else {
          srcNc = nc;
        }

        // Asymmetry
        srcNc *= 1 + asymmetry * 0.3 * Math.sign(srcNc) * (1 + Math.sin(phase * 0.1));

        if (isHorizontal) {
          srcDx = srcNc * halfDim;
          srcDy = dy;
        } else {
          srcDx = dx;
          srcDy = srcNc * halfDim;
        }
      }

      const sx = Math.round(srcDx + cx);
      const sy = Math.round(srcDy + cy);

      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        result[y][x] = pixels[sy][sx];
      }

      // Hole filling
      if (result[y][x] === null && holeFill === 'edge_copy') {
        const nearest = findNearestSourceColor(pixels, x, y);
        if (nearest !== null) {
          result[y][x] = nearest;
        }
      }
    }
  }

  return result;
}

/**
 * V10.6: Apply ring ripple stretch — concentric ring ripple deformation.
 *
 * Algorithm (inverse mapping):
 * For each destination pixel:
 * 1. Compute distance and angle from the ripple center
 * 2. Apply sinusoidal radial displacement based on distance:
 *    displacement = amplitude * sin(2π * distance * frequency - speed * time + phase)
 * 3. Optional damping attenuates displacement for pixels far from center
 * 4. In spiral mode, add angular twist proportional to distance
 * 5. Displacement direction is always radially (or spirally)
 *
 * This creates a water-ripple-like distortion that propagates outward from center.
 */
export function applyRingRipple(
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

  const amplitude = Number(params.amplitude ?? 3);
  const frequency = Number(params.frequency ?? 0.15);
  const speed = Number(params.speed ?? 6.28);
  const centerX = Number(params.centerX ?? 0) / 100;
  const centerY = Number(params.centerY ?? 0) / 100;
  const damping = Number(params.damping ?? 0.02);
  const rippleMode = String(params.rippleMode || 'radial');
  const spiralTwist = Number(params.spiralTwist ?? 2);
  const phaseSpeed = Number(params.phaseSpeed ?? 0);
  const smoothSampling = Boolean(params.smoothSampling);
  const holeFill = String(params.holeFill || 'edge_copy');

  if (amplitude === 0) return pixels;

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const timePhase = speed * elapsed + phaseSpeed * elapsed;

  const cx = w / 2 + centerX * w / 2;
  const cy = h / 2 + centerY * h / 2;
  const maxDist = Math.sqrt((w / 2) * (w / 2) + (h / 2) * (h / 2));
  const effectiveAmplitude = amplitude * weight;

  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 0.001) {
        result[y][x] = pixels[y][x];
        continue;
      }

      // Compute displacement
      const dampFactor = Math.exp(-damping * dist);
      const wave = Math.sin(2 * Math.PI * dist * frequency - timePhase);
      const displacement = effectiveAmplitude * wave * dampFactor;

      // Compute direction
      let dirX: number, dirY: number;
      if (rippleMode === 'spiral') {
        // Spiral mode: add tangential component based on distance
        const angle = Math.atan2(dy, dx) + spiralTwist * dist * 0.01;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      } else {
        // Radial mode: displacement is purely radial
        dirX = dx / dist;
        dirY = dy / dist;
      }

      // Inverse mapping: subtract displacement to find source
      const srcX = x - displacement * dirX;
      const srcY = y - displacement * dirY;

      if (smoothSampling) {
        const sx0 = Math.floor(srcX), sy0 = Math.floor(srcY);
        const sx1 = sx0 + 1, sy1 = sy0 + 1;
        const c00 = (sx0 >= 0 && sx0 < w && sy0 >= 0 && sy0 < h) ? pixels[sy0][sx0] : null;
        const c10 = (sx1 >= 0 && sx1 < w && sy0 >= 0 && sy0 < h) ? pixels[sy0][sx1] : null;
        const c01 = (sx0 >= 0 && sx0 < w && sy1 >= 0 && sy1 < h) ? pixels[sy1][sx0] : null;
        const c11 = (sx1 >= 0 && sx1 < w && sy1 >= 0 && sy1 < h) ? pixels[sy1][sx1] : null;
        if (c00) result[y][x] = c00;
        else if (c10) result[y][x] = c10;
        else if (c01) result[y][x] = c01;
        else if (c11) result[y][x] = c11;
      } else {
        const sx = Math.round(srcX);
        const sy = Math.round(srcY);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          result[y][x] = pixels[sy][sx];
        }
      }

      // Hole filling
      if (result[y][x] === null && holeFill === 'edge_copy') {
        const nearest = findNearestSourceColor(pixels, x, y);
        if (nearest !== null) {
          result[y][x] = nearest;
        }
      }
    }
  }

  return result;
}
