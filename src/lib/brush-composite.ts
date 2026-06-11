// ============================================================
// PixelMorpher - Composable Style Rendering Engine (V7)
// ============================================================
// Renders strokes with freely composable style aspects and
// stroke-direction parameter drivers.

import type {
  BrushStyleParams,
  StyleAspect, StyleAspectType, StrokeParamDriver,
  ModifierParamValue,
} from './types';
import { DEFAULT_BRUSH_STYLE, ASPECT_TYPE_PARAMS } from './types';

import type { BrushPixel } from './brush-engine';
import { rgbToHex } from './engine/utils';

// ---- Color Utilities ----

interface RGB { r: number; g: number; b: number; }

function hexToRGB(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---- Seeded PRNG ----

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Stroke Geometry ----

function computeArcLengths(points: { x: number; y: number }[]): number[] {
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return lengths;
}

function interpolatePoint(
  points: { x: number; y: number }[],
  arcLengths: number[],
  t: number,
): { x: number; y: number; tangentAngle: number } {
  const totalLen = arcLengths[arcLengths.length - 1] || 0;
  if (totalLen === 0) return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, tangentAngle: 0 };
  const targetLen = t * totalLen;
  let segIdx = 0;
  for (let i = 1; i < arcLengths.length; i++) {
    if (arcLengths[i] >= targetLen) { segIdx = i - 1; break; }
    if (i === arcLengths.length - 1) segIdx = i - 1;
  }
  const segStart = arcLengths[segIdx];
  const segEnd = arcLengths[segIdx + 1] ?? segStart;
  const segFrac = segEnd > segStart ? (targetLen - segStart) / (segEnd - segStart) : 0;
  const p0 = points[segIdx];
  const p1 = points[segIdx + 1] ?? p0;
  return {
    x: p0.x + (p1.x - p0.x) * segFrac,
    y: p0.y + (p1.y - p0.y) * segFrac,
    tangentAngle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
  };
}

// ---- Taper utility ----

function taperFactor(t: number, taperLength: number, taperCurve: string, minSizeRatio: number): number {
  if (taperLength <= 0) return 1;
  const startT = t / taperLength;
  let startFactor = 1;
  if (startT < 1) {
    const clamped = Math.max(0, Math.min(1, startT));
    switch (taperCurve) {
      case 'linear': startFactor = clamped; break;
      case 'ease_in': startFactor = clamped * clamped; break;
      case 'ease_out': startFactor = 1 - (1 - clamped) * (1 - clamped); break;
      case 'smooth': default: startFactor = smoothstep(0, 1, clamped); break;
    }
  }
  const endT = (1 - t) / taperLength;
  let endFactor = 1;
  if (endT < 1) {
    const clamped = Math.max(0, Math.min(1, endT));
    switch (taperCurve) {
      case 'linear': endFactor = clamped; break;
      case 'ease_in': endFactor = clamped * clamped; break;
      case 'ease_out': endFactor = 1 - (1 - clamped) * (1 - clamped); break;
      case 'smooth': default: endFactor = smoothstep(0, 1, clamped); break;
    }
  }
  const factor = Math.min(startFactor, endFactor);
  return minSizeRatio + (1 - minSizeRatio) * factor;
}

// ---- Stroke-Direction Parameter Driver ----

/** Evaluate a stroke driver at normalized position t along the stroke.
 *  Returns a multiplier (1 = no effect, >1 = boost, <1 = reduce). */
function evaluateStrokeDriver(driver: StrokeParamDriver, t: number): number {
  if (!driver.enabled || driver.amplitude <= 0) return 1;

  // Apply direction: 'reverse' flips the t axis
  let normT = driver.direction === 'reverse' ? 1 - t : t;
  // Apply phase (wrap safely for negative values)
  normT = ((normT + driver.phase) % 1 + 1) % 1;

  // Compute waveform value at this position
  const freq = Math.max(1, driver.frequency);
  const pos = normT * freq;
  const withinCycle = pos - Math.floor(pos); // 0-1 within one cycle

  let waveValue: number;
  // Whether this waveform is localized (has an "outside" region where it should have no effect)
  // Bump and pulse are localized: they only affect a specific region and should leave
  // the rest of the stroke unchanged. Sine/sawtooth/square are continuous oscillations
  // that fill the entire stroke and should oscillate symmetrically around the base value.
  let isLocalized = false;

  switch (driver.waveform) {
    case 'bump': {
      isLocalized = true;
      // Gaussian-like bump centered at driver.center within the cycle
      // Bump width controlled by driver.width
      const center = driver.center ?? 0.5;
      let distFromCenter = Math.abs(withinCycle - center);
      // Handle wrap-around: distance should account for cyclic nature
      distFromCenter = Math.min(distFromCenter, 1 - distFromCenter);
      // driver.width is in stroke-fraction units; convert to cycle-fraction by multiplying by freq.
      // halfWidth is half the bump width in cycle-fraction units.
      const halfWidth = Math.max(0.01, driver.width * freq / 2);
      waveValue = distFromCenter < halfWidth ? Math.exp(-((distFromCenter / halfWidth) ** 2) * 3) : 0;
      break;
    }
    case 'sine': {
      waveValue = 0.5 + 0.5 * Math.sin(withinCycle * Math.PI * 2 - Math.PI / 2);
      break;
    }
    case 'sawtooth': {
      waveValue = withinCycle;
      break;
    }
    case 'square': {
      waveValue = withinCycle < 0.5 ? 1 : 0;
      break;
    }
    case 'pulse': {
      isLocalized = true;
      // Sharp narrow pulse
      // driver.width is in stroke-fraction units; convert to cycle-fraction by multiplying by freq.
      const pulseWidth = Math.max(0.01, driver.width * freq);
      waveValue = withinCycle < pulseWidth ? 1 : 0;
      break;
    }
    default:
      waveValue = 0;
  }

  // Localized waveforms (bump, pulse): add boost on top of base value, no reduction outside.
  //   multiplier = 1 + amplitude * waveValue
  //   Outside region → waveValue=0 → multiplier=1 (no change)
  //   At peak → waveValue=1 → multiplier=1+amplitude (boost up to 2x)
  //
  // Continuous waveforms (sine, sawtooth, square): symmetric oscillation around base value.
  //   multiplier = 1 + (waveValue - 0.5) * 2 * amplitude
  //   waveValue=0 → multiplier=1-amplitude (reduce)
  //   waveValue=0.5 → multiplier=1 (no change)
  //   waveValue=1 → multiplier=1+amplitude (boost)
  if (isLocalized) {
    return Math.max(0, 1 + waveValue * driver.amplitude);
  } else {
    const variation = (waveValue - 0.5) * 2 * driver.amplitude;
    return Math.max(0, 1 + variation);
  }
}

/** Evaluate all stroke drivers for a given parameter at position t.
 *  Returns the combined multiplier (product of all drivers affecting this param). */
function evaluateStrokeDriversForParam(
  drivers: StrokeParamDriver[],
  targetParam: string,
  t: number,
): number {
  let combined = 1;
  for (const driver of drivers) {
    if (driver.targetParam === targetParam && driver.enabled) {
      combined *= evaluateStrokeDriver(driver, t);
    }
  }
  return combined;
}

// ---- Build BrushStyleParams from aspects + base params ----

/** Merge all enabled style aspects into a single BrushStyleParams object. */
function buildParamsFromAspects(
  baseParams: BrushStyleParams,
  aspects: StyleAspect[],
): BrushStyleParams {
  const merged = { ...baseParams };
  for (const aspect of aspects) {
    if (!aspect.enabled) continue;
    for (const [key, value] of Object.entries(aspect.params)) {
      (merged as Record<string, ModifierParamValue>)[key] = value;
    }
  }
  return merged;
}

// ---- Composited Stroke Renderer ----

/** Render a stroke with composited style aspects and stroke-direction drivers.
 *  This is the V7 rendering pipeline that freely combines aspects:
 *
 *  1. Width profile: taper × segment × strokeDriver('size')
 *  2. Cross-section shading: pipe_shade + directional_light + inner_outer
 *  3. Edge modifiers: organic_edge
 *  4. Detail overlays: vein, branch, glow_halo, bellows rings, spray_scatter
 */
export function renderCompositedStroke(
  points: { x: number; y: number }[],
  size: number,
  color: string,
  baseParams: BrushStyleParams,
  aspects: StyleAspect[],
  drivers: StrokeParamDriver[],
  seed: number = 0,
): BrushPixel[] {
  if (points.length === 0) return [];

  const rng = mulberry32(seed);

  // Build merged params from aspects
  const params = buildParamsFromAspects(baseParams, aspects);

  // Check which aspects are active
  const hasAspect = (type: StyleAspectType) => aspects.some(a => a.type === type && a.enabled);

  // Single-point stroke: render a simple cross-section
  if (points.length === 1) {
    const stampSize = Math.max(1, size * evaluateStrokeDriversForParam(drivers, 'size', 0.5));
    const stamp = renderCompositedCrossSection(stampSize, color, params, hasAspect, drivers, size);
    return stamp.map(p => ({ ...p, x: p.x + Math.round(points[0].x), y: p.y + Math.round(points[0].y) }));
  }

  const arcLengths = computeArcLengths(points);
  const totalLen = arcLengths[arcLengths.length - 1];
  if (totalLen < 0.5) {
    const stampSize = Math.max(1, size * evaluateStrokeDriversForParam(drivers, 'size', 0.5));
    const stamp = renderCompositedCrossSection(stampSize, color, params, hasAspect, drivers, size);
    return stamp.map(p => ({ ...p, x: p.x + Math.round(points[0].x), y: p.y + Math.round(points[0].y) }));
  }

  const colorRGB = hexToRGB(color);
  const pixelMap = new Map<string, { color: string; opacity: number; t?: number }>();

  const stepSize = 0.5;
  const numSamples = Math.max(2, Math.ceil(totalLen / stepSize) + 1);

  // Pre-generate organic noise offsets if needed
  const effectiveOrganicNoise = hasAspect('organic_edge')
    ? Number(params.organicNoise)
    : 0;
  const noiseOffsets: number[] = [];
  if (effectiveOrganicNoise > 0) {
    for (let i = 0; i < numSamples; i++) {
      const driverMod = evaluateStrokeDriversForParam(drivers, 'organicNoise', i / (numSamples - 1));
      noiseOffsets.push((rng() - 0.5) * 2 * effectiveOrganicNoise * driverMod * size * 0.3);
    }
  }

  // Segment cycle info
  const segmentLen = Math.max(2, Number(params.segmentLength));
  const gapLen = Math.max(0, Number(params.segmentGap));
  const cycleLen = segmentLen + gapLen;
  const baseBellowsWidth = hasAspect('segment') ? Number(params.bellowsWidth) : 0;

  // Light direction (for directional_light aspect)
  const effectiveLightDir = Number(params.lightDirection);
  const effectiveLightIntensity = hasAspect('directional_light') ? Number(params.lightIntensity) : 0;
  const lightAngleRad = (effectiveLightDir * Math.PI) / 180;
  const lightDirX = Math.cos(lightAngleRad);
  const lightDirY = Math.sin(lightAngleRad);

  // Pipe shade info
  const effectiveWallShade = hasAspect('pipe_shade') ? Number(params.wallShade) : 0;
  const effectiveHighlightPos = String(params.highlightPosition) as 'top' | 'bottom' | 'left' | 'right';
  const effectiveHighlightSize = Number(params.highlightSize);
  const effectiveHighlightIntensity = Number(params.highlightIntensity);
  const highlightOffset = effectiveHighlightPos === 'bottom' || effectiveHighlightPos === 'right' ? 0.5 : -0.5;

  // Inner/outer color info
  const hasInnerOuter = hasAspect('inner_outer');
  const innerRGB = hasInnerOuter ? hexToRGB(String(params.innerColor)) : colorRGB;
  const outerRGB = hasInnerOuter ? hexToRGB(String(params.outerColor)) : colorRGB;
  const innerRadius = Number(params.innerRadius);
  const falloff = Number(params.falloff);

  // Vein info
  const hasVein = hasAspect('vein');
  const veinRGB = hasVein ? hexToRGB(String(params.veinColor)) : colorRGB;

  for (let i = 0; i < numSamples; i++) {
    const t = i / (numSamples - 1);
    const { x, y, tangentAngle } = interpolatePoint(points, arcLengths, t);

    // ---- WIDTH PROFILE ----
    let localSize = size;

    // Taper
    if (hasAspect('taper')) {
      const taperLen = Number(params.taperLength);
      const taperCurve = String(params.taperCurve);
      const minRatio = Number(params.minSizeRatio);
      localSize *= taperFactor(t, taperLen, taperCurve, minRatio);
    }

    // Segment (with gap + bellows)
    const posAlongStroke = t * totalLen;
    if (hasAspect('segment')) {
      const cyclePos = posAlongStroke % cycleLen;
      const isInGap = cyclePos >= segmentLen;
      const segmentLocalT = cyclePos / segmentLen;

      if (isInGap) continue; // Don't draw in gaps

      // Segment taper
      const segTaper = Number(params.segmentTaper);
      if (segTaper > 0) {
        const taperAtStart = Math.min(1, segmentLocalT / (segTaper * 0.5 + 0.01));
        const taperAtEnd = Math.min(1, (1 - segmentLocalT) / (segTaper * 0.5 + 0.01));
        let widthFactor = Math.min(taperAtStart, taperAtEnd);
        widthFactor = 1 - segTaper * (1 - widthFactor);
        localSize *= widthFactor;
      }

      // Bellows expansion at joints (apply stroke driver for bellowsWidth)
      const jointProximity = Math.min(segmentLocalT, 1 - segmentLocalT);
      const bellowsDriverMod = evaluateStrokeDriversForParam(drivers, 'bellowsWidth', t);
      const effectiveBellowsWidth = baseBellowsWidth * bellowsDriverMod;
      const bellowsFactor = 1 + effectiveBellowsWidth * Math.exp(-jointProximity * 10);
      localSize *= bellowsFactor;
    }

    // Stroke driver for size
    localSize *= evaluateStrokeDriversForParam(drivers, 'size', t);

    // Organic noise on width
    const noiseOffset = noiseOffsets[i] ?? 0;
    localSize = Math.max(1, localSize + noiseOffset);

    const halfSize = localSize / 2;

    // Perpendicular direction
    const perpX = -Math.sin(tangentAngle);
    const perpY = Math.cos(tangentAngle);

    // ---- CROSS-SECTION RENDERING ----
    const numCrossPixels = Math.ceil(localSize);
    for (let j = 0; j < numCrossPixels; j++) {
      const offset = -halfSize + (j / Math.max(1, numCrossPixels - 1)) * localSize;
      const px = Math.round(x + perpX * offset);
      const py = Math.round(y + perpY * offset);

      const dist = Math.abs(offset);
      const maxDist = halfSize;
      if (dist > maxDist + 0.5) continue;

      const normalDist = maxDist > 0 ? dist / maxDist : 0;

      // ---- COLOR COMPUTATION (layered) ----
      let pixelColor: RGB = { ...colorRGB };

      // Layer 1: Inner/outer color gradient
      if (hasInnerOuter) {
        const colorT = smoothstep(
          innerRadius - falloff * 0.5,
          innerRadius + falloff * 0.5,
          normalDist,
        );
        pixelColor = lerpColor(innerRGB, outerRGB, colorT);
      }

      // Layer 2: Pipe shading (cylindrical highlight) — apply stroke driver for wallShade
      if (hasAspect('pipe_shade') && effectiveWallShade > 0) {
        const driverWallShade = evaluateStrokeDriversForParam(drivers, 'wallShade', t);
        const resolvedWallShade = effectiveWallShade * driverWallShade;
        const normalAtOffset = maxDist > 0 ? offset / maxDist : 0;
        const lightDot = normalAtOffset * (-highlightOffset) / 0.5;
        const shadeFactor = 0.5 + 0.5 * lightDot;
        const darkFactor = 1 - resolvedWallShade * (1 - shadeFactor);

        // Highlight band
        const highlightCenter = highlightOffset * maxDist;
        const distToHighlight = Math.abs(offset - highlightCenter);
        const highlightBand = maxDist * effectiveHighlightSize;

        if (distToHighlight < highlightBand && effectiveHighlightIntensity > 0) {
          const highlightT = 1 - distToHighlight / highlightBand;
          const highlightMix = highlightT * effectiveHighlightIntensity;
          const shadedBase = {
            r: pixelColor.r * darkFactor,
            g: pixelColor.g * darkFactor,
            b: pixelColor.b * darkFactor,
          };
          pixelColor = lerpColor(shadedBase, { r: 255, g: 255, b: 255 }, highlightMix);
        } else {
          pixelColor = {
            r: pixelColor.r * darkFactor,
            g: pixelColor.g * darkFactor,
            b: pixelColor.b * darkFactor,
          };
        }
      }

      // Layer 3: Directional lighting (apply stroke driver for lightIntensity)
      if (hasAspect('directional_light') && effectiveLightIntensity > 0) {
        const driverLightIntensity = evaluateStrokeDriversForParam(drivers, 'lightIntensity', t);
        const resolvedLightIntensity = effectiveLightIntensity * driverLightIntensity;
        const lightPerpDot = perpX * lightDirX + perpY * lightDirY;
        const surfaceNormalSign = offset >= 0 ? 1 : -1;
        const lightOnThisSide = lightPerpDot * surfaceNormalSign;
        const shadeFactor = 1 - resolvedLightIntensity * (1 - Math.max(0, lightOnThisSide));
        pixelColor = {
          r: pixelColor.r * shadeFactor,
          g: pixelColor.g * shadeFactor,
          b: pixelColor.b * shadeFactor,
        };
      }

      // Layer 4: Vein center line
      if (hasVein) {
        const veinWidth = Math.max(0.05, 0.15 * (localSize / size));
        const veinMix = normalDist < veinWidth
          ? 1 - (normalDist / veinWidth) * 0.7
          : 0;
        pixelColor = lerpColor(pixelColor, veinRGB, veinMix * 0.6);
      }

      // Edge falloff (hardness) — clamp to [0, 1] since driver multiplier can exceed 1
      const driverHardness = evaluateStrokeDriversForParam(drivers, 'hardness', t);
      const effectiveHardness = Math.max(0, Math.min(1, Number(params.hardness) * driverHardness));
      const edgeDist = maxDist - dist;
      const softEdge = 1 - effectiveHardness;
      const edgeWidth = Math.max(0.01, softEdge * maxDist);
      const opacity = edgeDist < edgeWidth ? edgeDist / edgeWidth : 1;

      // Stroke driver for opacity
      const driverOpacity = evaluateStrokeDriversForParam(drivers, 'opacity', t);

      if (opacity > 0.01) {
        const key = `${px},${py}`;
        pixelMap.set(key, {
          color: rgbToHex(
            Math.max(0, Math.min(255, pixelColor.r)),
            Math.max(0, Math.min(255, pixelColor.g)),
            Math.max(0, Math.min(255, pixelColor.b)),
          ),
          opacity: opacity * Number(params.opacity) * driverOpacity,
          t,
        });
      }
    }
  }

  // ---- DETAIL OVERLAYS (post-pass) ----

  // Bellows rings
  if (hasAspect('segment') && baseBellowsWidth > 0.1) {
    const numSegments = Math.ceil(totalLen / cycleLen);
    for (let seg = 0; seg <= numSegments; seg++) {
      const jointPos = seg * cycleLen;
      const jointT = jointPos / totalLen;
      if (jointT > 1) break;
      const { x, y, tangentAngle } = interpolatePoint(points, arcLengths, jointT);
      const pX = -Math.sin(tangentAngle);
      const pY = Math.cos(tangentAngle);
      // Apply stroke driver for bellowsWidth at this joint position
      const bellowsDriverMod = evaluateStrokeDriversForParam(drivers, 'bellowsWidth', jointT);
      const ringBellowsWidth = baseBellowsWidth * bellowsDriverMod;
      const ringWidth = size * (1 + ringBellowsWidth * 0.5);
      const halfRing = ringWidth / 2;
      const numRP = Math.ceil(ringWidth);
      for (let j = 0; j < numRP; j++) {
        const offset = -halfRing + (j / Math.max(1, numRP - 1)) * ringWidth;
        const rpx = Math.round(x + pX * offset);
        const rpy = Math.round(y + pY * offset);
        const rdist = Math.abs(offset);
        const isEdge = rdist > halfRing - 1.5 && rdist <= halfRing;
        if (isEdge || rdist <= 0.5) {
          const ringColor = { r: colorRGB.r * 0.7, g: colorRGB.g * 0.7, b: colorRGB.b * 0.7 };
          pixelMap.set(`${rpx},${rpy}`, {
            color: rgbToHex(ringColor.r, ringColor.g, ringColor.b),
            opacity: Number(params.opacity) * 0.6,
          });
        }
      }
    }
  }

  // Sub-branches
  if (hasAspect('branch') && Number(params.branchDensity) > 0.05) {
    const numBranches = Math.max(0, Math.floor(totalLen * Number(params.branchDensity) * 0.1));
    for (let b = 0; b < numBranches; b++) {
      const branchT = rng();
      const { x, y, tangentAngle } = interpolatePoint(points, arcLengths, branchT);
      const branchAngle = tangentAngle + (rng() > 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.5;
      const branchLength = Math.max(2, size * (0.5 + rng() * 1.5));
      const branchSize = Math.max(1, Math.round(size * 0.4));
      const steps = Math.ceil(branchLength);
      for (let s = 0; s < steps; s++) {
        const frac = s / steps;
        const bx = Math.round(x + Math.cos(branchAngle) * s);
        const by = Math.round(y + Math.sin(branchAngle) * s);
        const bHalfSize = Math.max(0.5, branchSize * (1 - frac * 0.5) / 2);
        for (let dy = -Math.ceil(bHalfSize); dy <= Math.ceil(bHalfSize); dy++) {
          for (let dx = -Math.ceil(bHalfSize); dx <= Math.ceil(bHalfSize); dx++) {
            if (dx * dx + dy * dy <= bHalfSize * bHalfSize) {
              const branchColor = lerpColor(colorRGB, veinRGB, 0.3);
              const bOpacity = (1 - frac * 0.7) * Number(params.opacity) * 0.8;
              if (bOpacity > 0.01) {
                const key = `${bx + dx},${by + dy}`;
                if (!pixelMap.has(key)) {
                  pixelMap.set(key, {
                    color: rgbToHex(branchColor.r, branchColor.g, branchColor.b),
                    opacity: bOpacity,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // Glow halo
  if (hasAspect('glow_halo') && Number(params.glowRadius) > 0) {
    const glowR = Number(params.glowRadius);
    const baseGlowI = Number(params.glowIntensity);
    // Render a soft glow around all existing pixels
    const existingPixels = new Map(pixelMap);
    for (const [key, val] of existingPixels) {
      // Apply glowIntensity driver at this pixel's stroke position
      const driverGlowIntensity = val.t !== undefined
        ? evaluateStrokeDriversForParam(drivers, 'glowIntensity', val.t)
        : 1;
      const glowI = baseGlowI * driverGlowIntensity;
      const [xs, ys] = key.split(',');
      const cx = parseInt(xs);
      const cy = parseInt(ys);
      for (let dy = -glowR; dy <= glowR; dy++) {
        for (let dx = -glowR; dx <= glowR; dx++) {
          if (dx === 0 && dy === 0) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > glowR) continue;
          const gpx = cx + dx;
          const gpy = cy + dy;
          const gkey = `${gpx},${gpy}`;
          const glowOpacity = (1 - dist / glowR) * glowI * val.opacity * 0.5;
          if (glowOpacity > 0.01 && !pixelMap.has(gkey)) {
            pixelMap.set(gkey, {
              color: val.color,
              opacity: glowOpacity,
            });
          }
        }
      }
    }
  }

  // Spray/scatter
  if (hasAspect('spray_scatter')) {
    const spread = Number(params.spread);
    const density = Number(params.density);
    const halfSize = size / 2 * spread;
    const numParticles = Math.max(1, Math.floor(Math.PI * halfSize * halfSize * density * 0.3));
    for (let p = 0; p < numParticles; p++) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * halfSize;
      // Position along stroke
      const st = rng();
      const { x: sx, y: sy } = interpolatePoint(points, arcLengths, st);
      const spx = Math.round(sx + Math.cos(angle) * radius);
      const spy = Math.round(sy + Math.sin(angle) * radius);
      const sOpacity = (0.3 + rng() * 0.7) * Number(params.opacity);
      if (sOpacity > 0.01) {
        const key = `${spx},${spy}`;
        if (!pixelMap.has(key)) {
          pixelMap.set(key, {
            color: rgbToHex(colorRGB.r, colorRGB.g, colorRGB.b),
            opacity: sOpacity,
          });
        }
      }
    }
  }

  // Convert map to array
  const result: BrushPixel[] = [];
  for (const [key, val] of pixelMap) {
    const [xStr, yStr] = key.split(',');
    result.push({ x: parseInt(xStr), y: parseInt(yStr), color: val.color, opacity: val.opacity });
  }
  return result;
}

/** Render a single cross-section for the composited style (for single-point strokes).
 *  Supports the same driver-modulated parameters as the multi-point pipeline. */
function renderCompositedCrossSection(
  size: number,
  color: string,
  params: BrushStyleParams,
  hasAspect: (type: StyleAspectType) => boolean,
  drivers: StrokeParamDriver[] = [],
  baseSize: number = size,
): BrushPixel[] {
  const pixels: BrushPixel[] = [];
  const halfSize = size / 2;
  const colorRGB = hexToRGB(color);
  const t = 0.5; // normalized position for single-point stroke

  // Directional light parameters
  const effectiveLightDir = Number(params.lightDirection);
  const effectiveLightIntensity = hasAspect('directional_light') ? Number(params.lightIntensity) : 0;
  const lightAngleRad = (effectiveLightDir * Math.PI) / 180;
  const lightDirX = Math.cos(lightAngleRad);
  const lightDirY = Math.sin(lightAngleRad);

  // Pipe shade parameters
  const effectiveWallShade = hasAspect('pipe_shade') ? Number(params.wallShade) : 0;
  const effectiveHighlightPos = String(params.highlightPosition) as 'top' | 'bottom' | 'left' | 'right';
  const effectiveHighlightSize = Number(params.highlightSize);
  const effectiveHighlightIntensity = Number(params.highlightIntensity);
  const highlightOffset = effectiveHighlightPos === 'bottom' || effectiveHighlightPos === 'right' ? 0.5 : -0.5;

  // Driver modulations
  const driverOpacity = evaluateStrokeDriversForParam(drivers, 'opacity', t);
  const driverHardness = evaluateStrokeDriversForParam(drivers, 'hardness', t);
  const driverWallShade = evaluateStrokeDriversForParam(drivers, 'wallShade', t);
  const driverLightIntensity = evaluateStrokeDriversForParam(drivers, 'lightIntensity', t);

  for (let dy = -Math.ceil(halfSize); dy < Math.floor(halfSize + 0.5); dy++) {
    for (let dx = -Math.ceil(halfSize); dx < Math.floor(halfSize + 0.5); dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = halfSize;
      if (dist > maxDist) continue;

      const normalDist = dist / maxDist;
      let pixelColor: RGB = { ...colorRGB };

      // Inner/outer color
      if (hasAspect('inner_outer')) {
        const innerRGB = hexToRGB(String(params.innerColor));
        const outerRGB = hexToRGB(String(params.outerColor));
        const colorT = smoothstep(
          Number(params.innerRadius) - Number(params.falloff) * 0.5,
          Number(params.innerRadius) + Number(params.falloff) * 0.5,
          normalDist,
        );
        pixelColor = lerpColor(innerRGB, outerRGB, colorT);
      }

      // Pipe shading (with driver modulation)
      if (hasAspect('pipe_shade') && effectiveWallShade > 0) {
        const resolvedWallShade = effectiveWallShade * driverWallShade;
        const normalAtOffset = maxDist > 0 ? dy / maxDist : 0;
        const lightDot = normalAtOffset * (-highlightOffset) / 0.5;
        const shadeFactor = 0.5 + 0.5 * lightDot;
        const darkFactor = 1 - resolvedWallShade * (1 - shadeFactor);

        const highlightCenter = highlightOffset * maxDist;
        const distToHighlight = Math.abs(dy - highlightCenter);
        const highlightBand = maxDist * effectiveHighlightSize;

        if (distToHighlight < highlightBand && effectiveHighlightIntensity > 0) {
          const highlightT = 1 - distToHighlight / highlightBand;
          const highlightMix = highlightT * effectiveHighlightIntensity;
          const shadedBase = {
            r: pixelColor.r * darkFactor,
            g: pixelColor.g * darkFactor,
            b: pixelColor.b * darkFactor,
          };
          pixelColor = lerpColor(shadedBase, { r: 255, g: 255, b: 255 }, highlightMix);
        } else {
          pixelColor = {
            r: pixelColor.r * darkFactor,
            g: pixelColor.g * darkFactor,
            b: pixelColor.b * darkFactor,
          };
        }
      }

      // Directional lighting (with driver modulation)
      if (hasAspect('directional_light') && effectiveLightIntensity > 0) {
        const resolvedLightIntensity = effectiveLightIntensity * driverLightIntensity;
        // Use vertical direction for cross-section (dx,dy as perpendicular offset)
        const lightPerpDot = lightDirX * 0 + lightDirY * 1; // perpendicular is Y for stamp
        const surfaceNormalSign = dy >= 0 ? 1 : -1;
        const lightOnThisSide = lightPerpDot * surfaceNormalSign;
        const shadeFactor = 1 - resolvedLightIntensity * (1 - Math.max(0, lightOnThisSide));
        pixelColor = {
          r: pixelColor.r * shadeFactor,
          g: pixelColor.g * shadeFactor,
          b: pixelColor.b * shadeFactor,
        };
      }

      // Vein (proportional width)
      if (hasAspect('vein')) {
        const veinRGB = hexToRGB(String(params.veinColor));
        const veinWidth = Math.max(0.05, 0.15 * (size / baseSize));
        const veinMix = normalDist < veinWidth ? 1 - (normalDist / veinWidth) * 0.7 : 0;
        pixelColor = lerpColor(pixelColor, veinRGB, veinMix * 0.6);
      }

      // Edge falloff (hardness) — apply driver modulation
      const effectiveHardness = Math.max(0, Math.min(1, Number(params.hardness) * driverHardness));
      const edgeDist = maxDist - dist;
      const softEdge = 1 - effectiveHardness;
      const edgeWidth = Math.max(0.01, softEdge * maxDist);
      const opacity = edgeDist < edgeWidth ? edgeDist / edgeWidth : 1;

      // Apply driver modulation to opacity
      if (opacity > 0.01) {
        pixels.push({
          x: dx, y: dy,
          color: rgbToHex(
            Math.max(0, Math.min(255, pixelColor.r)),
            Math.max(0, Math.min(255, pixelColor.g)),
            Math.max(0, Math.min(255, pixelColor.b)),
          ),
          opacity: opacity * Number(params.opacity) * driverOpacity,
        });
      }
    }
  }

  // Glow halo post-processing
  if (hasAspect('glow_halo') && Number(params.glowRadius) > 0) {
    const glowR = Number(params.glowRadius);
    const baseGlowI = Number(params.glowIntensity);
    // Apply glowIntensity driver for single-point stroke (t=0.5)
    const driverGlowIntensity = evaluateStrokeDriversForParam(drivers, 'glowIntensity', t);
    const glowI = baseGlowI * driverGlowIntensity;
    const existingPixels = new Map<string, { color: string; opacity: number }>();
    for (const p of pixels) {
      existingPixels.set(`${p.x},${p.y}`, { color: p.color, opacity: p.opacity });
    }
    const glowPixels: BrushPixel[] = [];
    for (const [key, val] of existingPixels) {
      const [xs, ys] = key.split(',');
      const cx = parseInt(xs);
      const cy = parseInt(ys);
      for (let gdy = -glowR; gdy <= glowR; gdy++) {
        for (let gdx = -glowR; gdx <= glowR; gdx++) {
          if (gdx === 0 && gdy === 0) continue;
          const gDist = Math.sqrt(gdx * gdx + gdy * gdy);
          if (gDist > glowR) continue;
          const gpx = cx + gdx;
          const gpy = cy + gdy;
          const gkey = `${gpx},${gpy}`;
          const glowOpacity = (1 - gDist / glowR) * glowI * val.opacity * 0.5;
          if (glowOpacity > 0.01 && !existingPixels.has(gkey)) {
            glowPixels.push({
              x: gpx, y: gpy,
              color: val.color,
              opacity: glowOpacity,
            });
          }
        }
      }
    }
    pixels.push(...glowPixels);
  }

  return pixels;
}
