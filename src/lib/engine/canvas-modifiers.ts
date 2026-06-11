// ============================================================
// PixelMorpher - Canvas Modifiers
// applyCanvasModifiers and all canvas-level modifier implementations
// ============================================================

import type {
  CanvasModifierTrack,
  CanvasModifierInstance,
  CanvasModifierType,
  CanvasModifierKeyframe,
  getCanvasModifierDef,
  ModifierParamValue,
} from '../types';
import { hexToRgb, darkenColor, lightenColor } from './color-utils';
import { acquireCanvas, releaseCanvas } from './canvas-pool';
import { boxBlurAlpha } from './effect-render';

// ============================================================
// V2.4: Canvas Modifier System
// ============================================================

/**
 * Get resolved params for a canvas modifier at the current frame,
 * interpolating between keyframes if necessary.
 */
function resolveCanvasModifierParams(
  track: CanvasModifierTrack,
  modifier: CanvasModifierInstance,
  currentFrame: number,
): Record<string, ModifierParamValue> {
  const kfs = track.keyframes.sort((a, b) => a.frame - b.frame);
  if (kfs.length === 0) return modifier.params;

  // Find surrounding keyframes
  let prevKf = kfs[0];
  let nextKf: typeof kfs[0] | null = null;
  for (const kf of kfs) {
    if (kf.frame <= currentFrame) prevKf = kf;
    if (kf.frame > currentFrame && !nextKf) nextKf = kf;
  }

  // If no next keyframe, just use prev keyframe params merged with defaults
  if (!nextKf) {
    return { ...modifier.params, ...prevKf.params };
  }

  // Interpolate numeric params
  const t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
  const result: Record<string, ModifierParamValue> = { ...modifier.params };
  for (const key of Object.keys(prevKf.params)) {
    const prevVal = prevKf.params[key];
    const nextVal = nextKf.params[key];
    if (typeof prevVal === 'number' && typeof nextVal === 'number') {
      result[key] = prevVal + (nextVal - prevVal) * t;
    } else {
      // For non-numeric, use prev if t < 0.5, next otherwise
      result[key] = t < 0.5 ? prevVal : nextVal;
    }
  }
  return result;
}

/**
 * Apply outline emphasis canvas modifier using offset-and-composite algorithm.
 *
 * For each opaque pixel in the source canvas, copies of the pixel are placed
 * at offset positions in 4 or 8 directions (scaled by thickness). The outline
 * layer is then composited onto the canvas behind the original content.
 *
 * Parameters:
 * - thickness (1-5): Pixel offset distance for outline copies
 * - color (hex): Outline color
 * - directions ('4' or '8'): 4-direction (faster) or 8-direction (rounder)
 * - outlineMode ('solid' | 'darken' | 'gradient'): How to color the outline
 *   - 'gradient' uses light-direction simulation based on lightAngle parameter
 * - blendMode ('normal' | 'overlay' | 'multiply' | 'screen'): How to blend
 * - edgesOnly (boolean): Only apply to pixels adjacent to transparent areas
 */
function applyOutlineEmphasis(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const thickness = Number(params.thickness) || 1;
  const color = String(params.color) || '#000000';
  const directions = String(params.directions) === '4' ? 4 : 8;
  const outlineMode = String(params.outlineMode) || 'solid';
  const blendMode = String(params.blendMode) || 'normal';
  const edgesOnly = Boolean(params.edgesOnly);
  const lightAngle = Number(params.lightAngle ?? 315);

  // Read current canvas content
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const src = imageData.data;

  // Parse outline color
  const [outlineR, outlineG, outlineB] = hexToRgb(color);

  // Create outline layer (zeroed RGBA buffer)
  const outlineData = new Uint8ClampedArray(src.length);

  // Pre-compute direction offsets
  // 4-direction: [(-1,0), (1,0), (0,-1), (0,1)]
  // 8-direction: add [(-1,-1), (-1,1), (1,-1), (1,1)]
  const dirOffsets: [number, number][] =
    directions === 4
      ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

  // For 'gradient' mode: compute light-direction-based shading per direction
  // Light angle convention: 0° = right, 90° = down, 180° = left, 270° = up
  // For each direction, compute how much it faces the light source
  const lightRad = (lightAngle * Math.PI) / 180;
  const ldx = Math.cos(lightRad);
  const ldy = Math.sin(lightRad);

  // Compute dark and light variants of outline color
  const [darkR, darkG, darkB] = hexToRgb(darkenColor(color, 0.3));
  const [lightR, lightG, lightB] = hexToRgb(lightenColor(color, 0.5));

  // For each direction offset, pre-compute the shading color
  const dirColors: [number, number, number][] = dirOffsets.map(([dx, dy]) => {
    if (outlineMode !== 'gradient') return [outlineR, outlineG, outlineB];
    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    const ndx = dx / len;
    const ndy = dy / len;
    // Dot product with light direction
    const dot = ndx * ldx + ndy * ldy;
    // Map [-1, 1] to [0, 1]
    const t = (dot + 1) / 2;
    // Interpolate between dark and light
    return [
      Math.round(darkR + (lightR - darkR) * t),
      Math.round(darkG + (lightG - darkG) * t),
      Math.round(darkB + (lightB - darkB) * t),
    ];
  });

  const pixelCount = canvasWidth * canvasHeight;

  // For edgesOnly: build a boolean mask of edge pixels
  // An edge pixel is an opaque pixel with at least one transparent 4-connected neighbor
  let edgeMask: Uint8Array | null = null;
  if (edgesOnly) {
    edgeMask = new Uint8Array(pixelCount);
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const i = (y * canvasWidth + x) * 4;
        if (src[i + 3] === 0) continue; // skip transparent pixels

        // Check 4-connected neighbors for transparency
        let isEdge = false;
        // Up
        if (y === 0 || src[((y - 1) * canvasWidth + x) * 4 + 3] === 0) isEdge = true;
        // Down
        if (!isEdge && (y === canvasHeight - 1 || src[((y + 1) * canvasWidth + x) * 4 + 3] === 0)) isEdge = true;
        // Left
        if (!isEdge && (x === 0 || src[(y * canvasWidth + (x - 1)) * 4 + 3] === 0)) isEdge = true;
        // Right
        if (!isEdge && (x === canvasWidth - 1 || src[(y * canvasWidth + (x + 1)) * 4 + 3] === 0)) isEdge = true;

        if (isEdge) {
          edgeMask![y * canvasWidth + x] = 1;
        }
      }
    }
  }

  // Build outline layer by iterating over opaque pixels and stamping offset copies
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const srcIdx = (y * canvasWidth + x) * 4;
      const srcAlpha = src[srcIdx + 3];

      // Skip transparent pixels
      if (srcAlpha === 0) continue;

      // If edgesOnly, skip non-edge pixels
      if (edgeMask && !edgeMask[y * canvasWidth + x]) continue;

      // Source pixel RGB
      const sr = src[srcIdx];
      const sg = src[srcIdx + 1];
      const sb = src[srcIdx + 2];

      // Stamp outline at each direction offset
      for (let d = 0; d < dirOffsets.length; d++) {
        const [dx, dy] = dirOffsets[d];
        const ox = x + dx * thickness;
        const oy = y + dy * thickness;

        // Bounds check
        if (ox < 0 || ox >= canvasWidth || oy < 0 || oy >= canvasHeight) continue;

        const outIdx = (oy * canvasWidth + ox) * 4;

        // Determine outline color based on outlineMode
        let or: number, og: number, ob: number;

        switch (outlineMode) {
          case 'darken': {
            // Darken the source pixel color by subtracting 80 from each channel (clamped to 0)
            or = Math.max(0, sr - 80);
            og = Math.max(0, sg - 80);
            ob = Math.max(0, sb - 80);
            break;
          }
          case 'gradient': {
            // Use pre-computed direction-based light shading
            [or, og, ob] = dirColors[d];
            break;
          }
          case 'solid':
          default: {
            // Use the outline color directly
            or = outlineR;
            og = outlineG;
            ob = outlineB;
            break;
          }
        }

        // "Max alpha" blending: write the outline color with full alpha,
        // but if there's already an outline pixel here, keep the one with higher alpha
        // (to avoid over-brightening). For same alpha, just overwrite.
        const existingAlpha = outlineData[outIdx + 3];
        if (srcAlpha >= existingAlpha) {
          outlineData[outIdx] = or;
          outlineData[outIdx + 1] = og;
          outlineData[outIdx + 2] = ob;
          outlineData[outIdx + 3] = srcAlpha; // carry source alpha for natural blending
        }
      }
    }
  }

  // Composite the outline layer onto the canvas
  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = canvasWidth;
  outlineCanvas.height = canvasHeight;
  const outlineCtx = outlineCanvas.getContext('2d')!;
  outlineCtx.putImageData(new ImageData(outlineData, canvasWidth, canvasHeight), 0, 0);

  if (blendMode === 'normal') {
    // For 'normal': draw outline layer first, then redraw original content on top
    // Save current canvas content
    const originalCanvas = document.createElement('canvas');
    originalCanvas.width = canvasWidth;
    originalCanvas.height = canvasHeight;
    const originalCtx = originalCanvas.getContext('2d')!;
    originalCtx.putImageData(imageData, 0, 0);

    // Clear and draw outline first
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(outlineCanvas, 0, 0);

    // Then draw original on top
    ctx.drawImage(originalCanvas, 0, 0);
  } else {
    // For overlay/multiply/screen: use canvas globalCompositeOperation
    ctx.save();
    switch (blendMode) {
      case 'overlay':
        ctx.globalCompositeOperation = 'overlay';
        break;
      case 'multiply':
        ctx.globalCompositeOperation = 'multiply';
        break;
      case 'screen':
        ctx.globalCompositeOperation = 'screen';
        break;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(outlineCanvas, 0, 0);
    ctx.restore();
  }
}

/**
 * Apply color LUT canvas modifier.
 */
function applyColorLut(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const preset = String(params.preset) || 'none';
  const intensity = Number(params.intensity) ?? 1;

  if (preset === 'none' || intensity === 0) return;

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    let nr = r, ng = g, nb = b;

    switch (preset) {
      case 'retro': {
        // Reduce palette + warm yellow tint
        nr = Math.min(255, Math.round(r / 32) * 32 + 20);
        ng = Math.min(255, Math.round(g / 32) * 32 + 10);
        nb = Math.round(b / 48) * 48;
        break;
      }
      case 'monochrome': {
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        nr = gray;
        ng = gray;
        nb = gray;
        break;
      }
      case 'nightvision': {
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const boosted = Math.min(1, lum * 1.5);
        nr = Math.round(boosted * 50);
        ng = Math.round(boosted * 255);
        nb = Math.round(boosted * 50);
        break;
      }
      case 'warm': {
        nr = Math.min(255, r + 25);
        ng = g + 5;
        nb = Math.max(0, b - 15);
        break;
      }
      case 'cool': {
        nr = Math.max(0, r - 15);
        ng = g + 5;
        nb = Math.min(255, b + 25);
        break;
      }
      case 'invert': {
        nr = 255 - r;
        ng = 255 - g;
        nb = 255 - b;
        break;
      }
    }

    // Mix based on intensity
    data[i] = Math.round(r + (nr - r) * intensity);
    data[i + 1] = Math.round(g + (ng - g) * intensity);
    data[i + 2] = Math.round(b + (nb - b) * intensity);
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply pixel zoom canvas modifier.
 */
function applyPixelZoom(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const scale = Number(params.scale) || 1;
  const antiAlias = Boolean(params.antiAlias);

  if (scale === 1) return;

  // Get current canvas content
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = canvasWidth;
  srcCanvas.height = canvasHeight;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(ctx.canvas, 0, 0);

  // Clear and redraw scaled
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const scaledW = canvasWidth * scale;
  const scaledH = canvasHeight * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = antiAlias;

  // Center the result
  const offsetX = (canvasWidth - scaledW) / 2;
  const offsetY = (canvasHeight - scaledH) / 2;

  if (scale > 1) {
    // Scale up: pixel-sharp (nearest neighbor)
    ctx.imageSmoothingEnabled = false;

    // Draw scaled source to temp canvas first
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = scaledW;
    tempCanvas.height = scaledH;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(srcCanvas, 0, 0, scaledW, scaledH);

    // Clip to canvas bounds and center
    const srcX = Math.max(0, -offsetX);
    const srcY = Math.max(0, -offsetY);
    const dstX = Math.max(0, offsetX);
    const dstY = Math.max(0, offsetY);
    const drawW = Math.min(canvasWidth, scaledW) ;
    const drawH = Math.min(canvasHeight, scaledH);

    ctx.drawImage(tempCanvas, srcX, srcY, drawW, drawH, dstX, dstY, drawW, drawH);
  } else {
    // Scale down
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = scaledW;
    tempCanvas.height = scaledH;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.imageSmoothingEnabled = antiAlias;
    tempCtx.drawImage(srcCanvas, 0, 0, scaledW, scaledH);

    ctx.drawImage(tempCanvas, 0, 0, scaledW, scaledH, offsetX, offsetY, scaledW, scaledH);
  }
  ctx.restore();
}

/**
 * Apply bloom canvas modifier.
 */
function applyBloom(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const threshold = Number(params.threshold) || 0.7;
  const radius = Number(params.radius) || 3;
  const intensity = Number(params.intensity) || 0.5;
  const color = String(params.color) || '#ffffff';

  // Extract bright pixels
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const brightData = new Uint8ClampedArray(imageData.data);

  for (let i = 0; i < brightData.length; i += 4) {
    const r = brightData[i];
    const g = brightData[i + 1];
    const b = brightData[i + 2];
    const a = brightData[i + 3];
    const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    if (brightness < threshold || a === 0) {
      brightData[i + 3] = 0; // Make dim pixels transparent
    } else {
      // Keep the bright pixel
      const factor = (brightness - threshold) / (1 - threshold);
      brightData[i + 3] = Math.round(a * factor);
    }
  }

  // Create bright canvas and blur
  const brightCanvas = document.createElement('canvas');
  brightCanvas.width = canvasWidth;
  brightCanvas.height = canvasHeight;
  const brightCtx = brightCanvas.getContext('2d')!;
  brightCtx.putImageData(new ImageData(brightData, canvasWidth, canvasHeight), 0, 0);

  // Blur the bright canvas
  const blurredData = boxBlurAlpha(brightCtx.getImageData(0, 0, canvasWidth, canvasHeight), radius);

  // Tint with bloom color
  const [cr, cg, cb] = hexToRgb(color);
  for (let i = 0; i < blurredData.data.length; i += 4) {
    const alpha = blurredData.data[i + 3];
    if (alpha > 0) {
      blurredData.data[i] = cr;
      blurredData.data[i + 1] = cg;
      blurredData.data[i + 2] = cb;
      blurredData.data[i + 3] = Math.round(alpha * intensity);
    }
  }

  const bloomCanvas = document.createElement('canvas');
  bloomCanvas.width = canvasWidth;
  bloomCanvas.height = canvasHeight;
  const bloomCtx = bloomCanvas.getContext('2d')!;
  bloomCtx.putImageData(blurredData, 0, 0);

  // Composite additively
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(bloomCanvas, 0, 0);
  ctx.restore();
}

/**
 * Apply scanlines canvas modifier.
 */
function applyScanlines(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const lineSpacing = Number(params.lineSpacing) || 2;
  const lineOpacity = Number(params.lineOpacity) || 0.3;
  const lineColor = String(params.lineColor) || '#000000';
  const vignette = Boolean(params.vignette);
  const vignetteIntensity = Number(params.vignetteIntensity) || 0.3;

  const [lr, lg, lb] = hexToRgb(lineColor);

  // Get current image data
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  // Apply scanlines
  for (let y = 0; y < canvasHeight; y++) {
    if (y % lineSpacing === 0) {
      for (let x = 0; x < canvasWidth; x++) {
        const i = (y * canvasWidth + x) * 4;
        if (data[i + 3] > 0) {
          data[i] = Math.round(data[i] * (1 - lineOpacity) + lr * lineOpacity);
          data[i + 1] = Math.round(data[i + 1] * (1 - lineOpacity) + lg * lineOpacity);
          data[i + 2] = Math.round(data[i + 2] * (1 - lineOpacity) + lb * lineOpacity);
        }
      }
    }
  }

  // Apply vignette
  if (vignette && vignetteIntensity > 0) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const i = (y * canvasWidth + x) * 4;
        if (data[i + 3] === 0) continue;

        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const darken = Math.max(0, 1 - dist * dist * vignetteIntensity * 2);

        data[i] = Math.round(data[i] * darken);
        data[i + 1] = Math.round(data[i + 1] * darken);
        data[i + 2] = Math.round(data[i + 2] * darken);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply canvas mask modifier.
 */
function applyCanvasMask(
  ctx: CanvasRenderingContext2D,
  modifier: CanvasModifierInstance,
  params: Record<string, ModifierParamValue>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const shape = String(params.shape) || 'circle';
  const margin = Number(params.margin) || 0;
  const feather = Number(params.feather) || 0;

  const w = canvasWidth - margin * 2;
  const h = canvasHeight - margin * 2;
  if (w <= 0 || h <= 0) return;

  // Get current image data
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = (y * canvasWidth + x) * 4;
      if (data[i + 3] === 0) continue;

      // Normalized position relative to center
      const nx = (x - cx) / (w / 2);
      const ny = (y - cy) / (h / 2);

      let insideMask = false;
      let edgeDistance = 0;

      switch (shape) {
        case 'circle': {
          const dist = Math.sqrt(nx * nx + ny * ny);
          insideMask = dist <= 1;
          edgeDistance = 1 - dist;
          break;
        }
        case 'star': {
          // 5-pointed star
          const angle = Math.atan2(ny, nx);
          const r = Math.sqrt(nx * nx + ny * ny);
          const starR = 0.4 + 0.6 * Math.pow(Math.abs(Math.cos(2.5 * angle)), 2);
          insideMask = r <= starR;
          edgeDistance = starR - r;
          break;
        }
        case 'rounded_rect': {
          const cornerR = 0.2;
          const absNx = Math.abs(nx);
          const absNy = Math.abs(ny);
          if (absNx <= 1 - cornerR && absNy <= 1) {
            insideMask = true;
            edgeDistance = Math.min(1 - absNx, 1 - absNy);
          } else if (absNx <= 1 && absNy <= 1 - cornerR) {
            insideMask = true;
            edgeDistance = Math.min(1 - absNx, 1 - absNy);
          } else if (absNx <= 1 && absNy <= 1) {
            const cdx = absNx - (1 - cornerR);
            const cdy = absNy - (1 - cornerR);
            const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
            insideMask = cdist <= cornerR;
            edgeDistance = cornerR - cdist;
          }
          break;
        }
        case 'diamond': {
          const dist = Math.abs(nx) + Math.abs(ny);
          insideMask = dist <= 1;
          edgeDistance = 1 - dist;
          break;
        }
      }

      if (!insideMask) {
        // Clear pixel outside mask
        if (feather > 0) {
          // Feather: gradually reduce alpha
          data[i + 3] = 0;
        } else {
          data[i + 3] = 0;
        }
      } else if (feather > 0 && edgeDistance < feather / (w / 2)) {
        // Feather edge
        const alphaFactor = edgeDistance / (feather / (w / 2));
        data[i + 3] = Math.round(data[i + 3] * alphaFactor);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply all canvas modifiers from visible+enabled tracks.
 * This is called AFTER all part rendering and effect track rendering.
 */
export function applyCanvasModifiers(
  ctx: CanvasRenderingContext2D,
  canvasModifierTracks: CanvasModifierTrack[],
  currentFrame: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Process tracks in order
  for (const track of canvasModifierTracks) {
    if (!track.visible || !track.enabled) continue;

    // Process each modifier in the track
    for (const modifier of track.modifiers) {
      if (!modifier.enabled) continue;

      // Resolve params (interpolate keyframes if any)
      const params = resolveCanvasModifierParams(track, modifier, currentFrame);

      switch (modifier.type) {
        case 'outline_emphasis':
          applyOutlineEmphasis(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'color_lut':
          applyColorLut(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'pixel_zoom':
          applyPixelZoom(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'bloom':
          applyBloom(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'scanlines':
          applyScanlines(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
        case 'canvas_mask':
          applyCanvasMask(ctx, modifier, params, canvasWidth, canvasHeight);
          break;
      }
    }
  }
}
