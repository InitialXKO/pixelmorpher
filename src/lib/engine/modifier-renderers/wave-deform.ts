// ============================================================
// PixelMorpher - Wave Deform Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { hexToRgb, hexBrightness, hexSaturation, adjustSaturation, lerpColor } from '../color-utils';
import { rgbToHex } from '../utils';
import { modifierGuard, elapsedSeconds, emptyGrid } from './shared';

/**
 * Apply wave deformation to a pixel grid.
 *
 * Displaces pixels using sinusoidal wave patterns. Supports transverse,
 * longitudinal, and mixed wave types with horizontal, vertical, diagonal,
 * and radial direction modes.
 *
 * Algorithm:
 * 1. Compute direction vector k based on directionType and diagonalAngle
 * 2. For each non-null pixel at (x, y):
 *    a. Compute spatial phase: φ_spatial = 2π * f * (x·cosθ + y·sinθ) for linear,
 *       or 2π*f*r for radial
 *    b. Compute time phase: φ_time = ω * t + φ0
 *    c. Total phase: φ = φ_spatial + φ_time
 *    d. Using sin(A+B) = sin(A)cos(B) + cos(A)sin(B) for efficiency
 *    e. Compute displacement vectors based on waveType
 *    f. Apply near-center smoothing for radial mode
 * 3. Build target canvas with overlap handling
 * 4. Apply density wave if enabled
 * 5. Fill holes if enabled
 */
export function applyWaveDeform(
  pixels: PixelGrid,
  width: number,
  height: number,
  params: Record<string, ModifierParamValue>,
  currentFrame: number,
  frameRate: number,
  weight: number,
  /** World-space offset for the part (translate + pivot adjustment) — used when coordinateSystem='world' */
  worldOffsetX: number = 0,
  worldOffsetY: number = 0,
): PixelGrid {
  const grid = modifierGuard(pixels, weight);
  if (!grid) return pixels;
  const { h, w } = grid;

  // Parse parameters
  const directionType = String(params.directionType || 'horizontal');
  const diagonalAngle = Number(params.diagonalAngle ?? 45);
  const radialCenterX = Number(params.radialCenterX ?? 0);
  const radialCenterY = Number(params.radialCenterY ?? 0);
  const tangentialSign = String(params.tangentialSign || 'cw') === 'cw' ? 1 : -1;
  const smoothRadius = Number(params.smoothRadius ?? 5);
  const waveType = String(params.waveType || 'transverse');
  const transLongRatio = Number(params.transLongRatio ?? 0.7);
  const transverseSign = Number(params.transverseSign ?? 1);
  const transverseAmplitude = Number(params.transverseAmplitude ?? 5);
  const longitudinalAmplitude = Number(params.longitudinalAmplitude ?? 0);
  const spatialFrequency = Number(params.spatialFrequency ?? 0.3);
  const phaseSpeed = Number(params.phaseSpeed ?? 6.28);
  const initialPhase = Number(params.initialPhase ?? 0);
  const densityWaveIntensity = Number(params.densityWaveIntensity ?? 0);
  const densityMinWeight = Number(params.densityMinWeight ?? 0.3);
  const densityMaxWeight = Number(params.densityMaxWeight ?? 1.5);
  const densityTargetRGB = Boolean(params.densityTargetRGB ?? true);
  const densityTargetAlpha = Boolean(params.densityTargetAlpha ?? false);
  const densityTargetBrightness = Boolean(params.densityTargetBrightness ?? false);
  const densityTargetSaturation = Boolean(params.densityTargetSaturation ?? false);
  const blendModeComposite = String(params.blendMode_composite || 'nearest');
  const holeFill = String(params.holeFill || 'edge_copy');
  const coordinateSystem = String(params.coordinateSystem || 'local');

  // World-space offset: when coordinateSystem='world', pixel positions are shifted
  // so that the wave phase is computed in world/canvas coordinates rather than
  // the part's local pixel grid. This ensures the deformation pattern stays
  // spatially consistent when the part moves across the canvas.
  const useWorldCoords = coordinateSystem === 'world';
  const coordOffsetX = useWorldCoords ? worldOffsetX : 0;
  const coordOffsetY = useWorldCoords ? worldOffsetY : 0;

  // Compute effective amplitudes based on waveType
  let effectiveTransverseAmp = transverseAmplitude;
  let effectiveLongitudinalAmp = longitudinalAmplitude;

  if (waveType === 'transverse') {
    effectiveLongitudinalAmp = 0;
  } else if (waveType === 'longitudinal') {
    effectiveTransverseAmp = 0;
    effectiveLongitudinalAmp = longitudinalAmplitude || transverseAmplitude;
  } else if (waveType === 'mixed') {
    // Mix based on transLongRatio
    effectiveTransverseAmp = transverseAmplitude * transLongRatio + longitudinalAmplitude * (1 - transLongRatio);
    effectiveLongitudinalAmp = longitudinalAmplitude * (1 - transLongRatio) + transverseAmplitude * transLongRatio;
  }

  if (effectiveTransverseAmp === 0 && effectiveLongitudinalAmp === 0) return pixels;

  // Compute direction vector
  const isRadial = directionType === 'radial';
  const angleRad = directionType === 'vertical' ? Math.PI / 2
    : directionType === 'diagonal' ? (diagonalAngle * Math.PI) / 180
    : 0; // horizontal default
  const kx = Math.cos(angleRad);
  const ky = Math.sin(angleRad);

  // Compute time
  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const phiTime = phaseSpeed * elapsed + initialPhase;

  // Precompute sin(phiTime) and cos(phiTime) for the sin(A+B) trick
  const sinPhiTime = Math.sin(phiTime);
  const cosPhiTime = Math.cos(phiTime);

  // Radial center in pixel coordinates
  const cx = w / 2 + (radialCenterX / 100) * (w / 2);
  const cy = h / 2 + (radialCenterY / 100) * (h / 2);

  // Build displacement map: for each source pixel, compute target position
  // Also track overlaps for blend mode handling
  interface TargetEntry {
    color: string;
    depth: number; // for depth blend mode: source position along wave direction
  }

  const targetMap: (TargetEntry[])[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => [] as TargetEntry[])
  );

  // Density wave data: maps target position to weight factor
  const densityWeightMap: number[][] = Array.from({ length: h }, () => Array(w).fill(1));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = pixels[y][x];
      if (color === null) continue;

      let phiSpatial: number;
      let perpX: number; // transverse direction x
      let perpY: number; // transverse direction y
      let paraX: number; // longitudinal direction x
      let paraY: number; // longitudinal direction y
      let depthValue: number;

      if (isRadial) {
        // Radial mode
        const dx = (x + coordOffsetX) - cx;
        const dy = (y + coordOffsetY) - cy;
        const r = Math.sqrt(dx * dx + dy * dy);

        // Spatial phase based on distance from center
        phiSpatial = 2 * Math.PI * spatialFrequency * r;

        // Radial direction (r_hat)
        const rHatX = r > 0.001 ? dx / r : 0;
        const rHatY = r > 0.001 ? dy / r : 0;

        // Tangential direction (t_hat) - perpendicular to radial
        const tHatX = -rHatY * tangentialSign;
        const tHatY = rHatX * tangentialSign;

        // Near-center smoothing: reduce amplitude when r < smoothRadius
        const smoothFactor = r < smoothRadius ? r / smoothRadius : 1;

        // Effective amplitudes with smoothing
        const effTransAmp = effectiveTransverseAmp * smoothFactor;
        const effLongAmp = effectiveLongitudinalAmp * smoothFactor;

        // Transverse: displacement along tangential direction
        perpX = tHatX;
        perpY = tHatY;
        // Longitudinal: displacement along radial direction
        paraX = rHatX;
        paraY = rHatY;
        depthValue = r;

        // Compute sin(phiSpatial + phiTime) using sin(A+B) trick
        const sinPhiSpatial = Math.sin(phiSpatial);
        const cosPhiSpatial = Math.cos(phiSpatial);
        const sinTotal = sinPhiTime * cosPhiSpatial + cosPhiTime * sinPhiSpatial;

        // Compute displacement
        const dxDisp = (perpX * effTransAmp * sinTotal * transverseSign
          + paraX * effLongAmp * sinTotal) * weight;
        const dyDisp = (perpY * effTransAmp * sinTotal * transverseSign
          + paraY * effLongAmp * sinTotal) * weight;

        // Target position with weight interpolation
        const targetX = x + dxDisp;
        const targetY = y + dyDisp;

        // Quantize to nearest pixel
        const tx = Math.round(targetX);
        const ty = Math.round(targetY);

        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          targetMap[ty][tx].push({ color, depth: depthValue });
        }

        // Density wave: compute from longitudinal displacement gradient
        if (densityWaveIntensity > 0) {
          const longDisp = effLongAmp * sinTotal * weight;
          const densityWeight = densityMinWeight + (densityMaxWeight - densityMinWeight) * (0.5 + 0.5 * Math.cos(longDisp * spatialFrequency * Math.PI));
          if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
            densityWeightMap[ty][tx] = densityWeight;
          }
        }

      } else {
        // Linear mode (horizontal/vertical/diagonal)
        phiSpatial = 2 * Math.PI * spatialFrequency * ((x + coordOffsetX) * kx + (y + coordOffsetY) * ky);

        // Perpendicular direction to wave propagation (for transverse)
        perpX = -ky; // perpendicular to (kx, ky)
        perpY = kx;
        // Parallel direction (for longitudinal)
        paraX = kx;
        paraY = ky;
        depthValue = x * kx + y * ky;

        // Compute sin(phiSpatial + phiTime) using sin(A+B) trick
        const sinPhiSpatial = Math.sin(phiSpatial);
        const cosPhiSpatial = Math.cos(phiSpatial);
        const sinTotal = sinPhiTime * cosPhiSpatial + cosPhiTime * sinPhiSpatial;

        // Compute displacement
        const dxDisp = (perpX * effectiveTransverseAmp * sinTotal * transverseSign
          + paraX * effectiveLongitudinalAmp * sinTotal) * weight;
        const dyDisp = (perpY * effectiveTransverseAmp * sinTotal * transverseSign
          + paraY * effectiveLongitudinalAmp * sinTotal) * weight;

        // Target position with weight interpolation
        const targetX = x + dxDisp;
        const targetY = y + dyDisp;

        // Quantize to nearest pixel
        const tx = Math.round(targetX);
        const ty = Math.round(targetY);

        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          targetMap[ty][tx].push({ color, depth: depthValue });
        }

        // Density wave
        if (densityWaveIntensity > 0) {
          const longDisp = effectiveLongitudinalAmp * sinTotal * weight;
          const densityWeight = densityMinWeight + (densityMaxWeight - densityMinWeight) * (0.5 + 0.5 * Math.cos(longDisp * spatialFrequency * Math.PI));
          if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
            densityWeightMap[ty][tx] = densityWeight;
          }
        }
      }
    }
  }

  // Build result from target map, handling overlaps
  const result: PixelGrid = emptyGrid(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const entries = targetMap[y][x];
      if (entries.length === 0) continue;

      if (entries.length === 1) {
        result[y][x] = entries[0].color;
      } else {
        // Multiple pixels map to the same target — handle overlap
        if (blendModeComposite === 'nearest') {
          // Use the pixel with the smallest depth (closest to viewer)
          let bestEntry = entries[0];
          for (let i = 1; i < entries.length; i++) {
            if (Math.abs(entries[i].depth) < Math.abs(bestEntry.depth)) {
              bestEntry = entries[i];
            }
          }
          result[y][x] = bestEntry.color;
        } else if (blendModeComposite === 'average') {
          // Average all overlapping colors
          let rSum = 0, gSum = 0, bSum = 0, count = 0;
          for (const entry of entries) {
            const [r, g, b] = hexToRgb(entry.color);
            rSum += r; gSum += g; bSum += b;
            count++;
          }
          if (count > 0) {
            const r = Math.round(rSum / count);
            const g = Math.round(gSum / count);
            const b = Math.round(bSum / count);
            result[y][x] = rgbToHex(r, g, b);
          }
        } else if (blendModeComposite === 'depth') {
          // Weight by inverse depth (closer pixels have more weight)
          let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
          for (const entry of entries) {
            const depthWeight = 1 / (1 + Math.abs(entry.depth));
            const [r, g, b] = hexToRgb(entry.color);
            rSum += r * depthWeight;
            gSum += g * depthWeight;
            bSum += b * depthWeight;
            weightSum += depthWeight;
          }
          if (weightSum > 0) {
            const r = Math.round(rSum / weightSum);
            const g = Math.round(gSum / weightSum);
            const b = Math.round(bSum / weightSum);
            result[y][x] = rgbToHex(r, g, b);
          }
        }
      }
    }
  }

  // Apply density wave modifications
  if (densityWaveIntensity > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = result[y][x];
        if (color === null) continue;

        const dw = densityWeightMap[y][x];
        if (Math.abs(dw - 1) < 0.001) continue; // no change

        const intensity = densityWaveIntensity * (dw - 1); // negative = dimmer, positive = brighter

        if (densityTargetRGB && intensity !== 0) {
          const [r, g, b] = hexToRgb(color);
          let nr = r, ng = g, nb = b;

          if (intensity > 0) {
            // Brighten
            nr = Math.min(255, Math.round(r + (255 - r) * intensity));
            ng = Math.min(255, Math.round(g + (255 - g) * intensity));
            nb = Math.min(255, Math.round(b + (255 - b) * intensity));
          } else {
            // Darken
            const factor = Math.max(0, 1 + intensity);
            nr = Math.round(r * factor);
            ng = Math.round(g * factor);
            nb = Math.round(b * factor);
          }
          result[y][x] = rgbToHex(nr, ng, nb);
        }

        if (densityTargetBrightness) {
          const brightness = hexBrightness(color);
          const newBrightness = Math.max(0, Math.min(1, brightness + intensity * 0.5));
          if (newBrightness !== brightness) {
            const [r, g, b] = hexToRgb(result[y][x]!);
            const scale = brightness > 0.001 ? newBrightness / brightness : 1;
            const nr = Math.min(255, Math.round(r * scale));
            const ng = Math.min(255, Math.round(g * scale));
            const nb = Math.min(255, Math.round(b * scale));
            result[y][x] = rgbToHex(nr, ng, nb);
          }
        }

        if (densityTargetSaturation) {
          const sat = hexSaturation(color);
          const newSat = Math.max(0, Math.min(1, sat + intensity * 0.5));
          if (newSat !== sat) {
            result[y][x] = adjustSaturation(result[y][x]!, newSat);
          }
        }

        // densityTargetAlpha: adjust pixel transparency based on density wave
        // This replaces the null/visible binary with smooth alpha variation
        if (densityTargetAlpha) {
          const alphaFactor = Math.max(0, Math.min(1, 1 + intensity * 0.5));
          if (alphaFactor < 0.99) {
            // For pixel art, we simulate alpha by darkening toward background
            // (true alpha blending isn't used at pixel level in pixel art)
            const [r, g, b] = hexToRgb(result[y][x]!);
            const nr = Math.round(r * alphaFactor);
            const ng = Math.round(g * alphaFactor);
            const nb = Math.round(b * alphaFactor);
            result[y][x] = rgbToHex(nr, ng, nb);
          }
        }
      }
    }
  }

  // Fill holes
  if (holeFill !== 'none') {
    // Identify holes: positions where the original had a pixel but result is null
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (result[y][x] !== null) continue;
        if (pixels[y][x] === null) continue; // was already empty

        if (holeFill === 'edge_copy') {
          // Copy from nearest non-null neighbor in the result
          let nearestColor: string | null = null;
          let nearestDist = Infinity;
          // Search in expanding rings
          for (let searchR = 1; searchR <= 3 && nearestColor === null; searchR++) {
            for (let dy = -searchR; dy <= searchR; dy++) {
              for (let dx = -searchR; dx <= searchR; dx++) {
                if (dy === 0 && dx === 0) continue;
                const ny = y + dy;
                const nx = x + dx;
                if (ny >= 0 && ny < h && nx >= 0 && nx < w && result[ny][nx] !== null) {
                  const dist = Math.abs(dy) + Math.abs(dx);
                  if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestColor = result[ny][nx];
                  }
                }
              }
            }
          }
          if (nearestColor !== null) {
            result[y][x] = nearestColor;
          }
        } else if (holeFill === 'fixed_color') {
          // 'fixed_color': fill holes with a fixed color from the wave_deform params
          // (falls back to nearest source pixel color if no fixed color is specified)
          const fixedColor = params.holeFillColor
            ? String(params.holeFillColor)
            : (() => {
                // Find the nearest non-null source pixel color
                let found: string | null = null;
                for (let sr = 1; sr <= 3 && !found; sr++) {
                  for (let dy2 = -sr; dy2 <= sr && !found; dy2++) {
                    for (let dx2 = -sr; dx2 <= sr && !found; dx2++) {
                      if (dy2 === 0 && dx2 === 0) continue;
                      const ny2 = y + dy2;
                      const nx2 = x + dx2;
                      if (ny2 >= 0 && ny2 < h && nx2 >= 0 && nx2 < w && pixels[ny2][nx2] !== null) {
                        found = pixels[ny2][nx2];
                      }
                    }
                  }
                }
                return found;
              })();
          if (fixedColor) {
            result[y][x] = fixedColor;
          }
        }
      }
    }
  }

  return result;
}
