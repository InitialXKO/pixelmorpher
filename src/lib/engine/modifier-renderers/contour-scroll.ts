// ============================================================
// PixelMorpher - Contour Scroll Modifier Renderer
// ============================================================

import type { PixelGrid, ModifierParamValue } from '../../types';
import { lerpColor } from '../color-utils';
import { modifierGuard, elapsedSeconds } from './shared';

function extractContourChain(pixels: PixelGrid): { x: number; y: number }[] {
  const h = pixels.length;
  const w = pixels[0]?.length || 0;
  const contour: { x: number; y: number }[] = [];
  const visited = new Set<string>();

  // Find all edge pixels (non-null pixels adjacent to null or boundary)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y][x] === null) continue;
      let isEdge = false;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || pixels[ny][nx] === null) {
          isEdge = true;
          break;
        }
      }
      if (isEdge) contour.push({ x, y });
    }
  }

  // Sort by angle from centroid to create a rough chain
  if (contour.length > 2) {
    let cx = 0, cy = 0;
    for (const p of contour) { cx += p.x; cy += p.y; }
    cx /= contour.length; cy /= contour.length;
    contour.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  }

  return contour;
}

/** V9.1: Apply contour scroll — scrolling colored texture band along the outline contour */
export function applyContourScroll(
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

  const scrollSpeed = Number(params.scrollSpeed ?? 40);
  const direction = String(params.scrollDirection || 'cw');
  const bandWidth = Number(params.bandWidth ?? 3);
  const colorA = String(params.colorA || '#ffffff');
  const colorB = String(params.colorB || '#000000');
  const blendWithOriginal = Boolean(params.blendWithOriginal ?? true);
  const outlineThickness = Number(params.outlineThickness ?? 2);

  if (scrollSpeed === 0) return pixels;

  const elapsed = elapsedSeconds(currentFrame, frameRate);
  const offset = scrollSpeed * elapsed * weight * (direction === 'ccw' ? -1 : 1);

  // Extract contour
  const contour = extractContourChain(pixels);
  if (contour.length === 0) return pixels;

  const result: PixelGrid = pixels.map(row => [...row]);

  // P1: Two-pass Manhattan distance transform — O(W×H) instead of O(W×H×C)
  // Simultaneously propagate distance and nearest contour index
  const INF = w + h + 1;
  const distMap: number[][] = Array.from({ length: h }, () => Array(w).fill(INF));
  const idxMap: number[][] = Array.from({ length: h }, () => Array(w).fill(-1));

  // Seed: mark contour pixels with distance 0 and their own index
  for (let i = 0; i < contour.length; i++) {
    const { x, y } = contour[i];
    distMap[y][x] = 0;
    idxMap[y][x] = i;
  }

  // Forward pass (top-left → bottom-right)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y][x] === null) continue;
      // Check 4-connected neighbors that have already been visited
      if (y > 0 && pixels[y - 1][x] !== null && distMap[y - 1][x] + 1 < distMap[y][x]) {
        distMap[y][x] = distMap[y - 1][x] + 1;
        idxMap[y][x] = idxMap[y - 1][x];
      }
      if (x > 0 && pixels[y][x - 1] !== null && distMap[y][x - 1] + 1 < distMap[y][x]) {
        distMap[y][x] = distMap[y][x - 1] + 1;
        idxMap[y][x] = idxMap[y][x - 1];
      }
    }
  }

  // Backward pass (bottom-right → top-left)
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      if (pixels[y][x] === null) continue;
      if (y < h - 1 && pixels[y + 1][x] !== null && distMap[y + 1][x] + 1 < distMap[y][x]) {
        distMap[y][x] = distMap[y + 1][x] + 1;
        idxMap[y][x] = idxMap[y + 1][x];
      }
      if (x < w - 1 && pixels[y][x + 1] !== null && distMap[y][x + 1] + 1 < distMap[y][x]) {
        distMap[y][x] = distMap[y][x + 1] + 1;
        idxMap[y][x] = idxMap[y][x + 1];
      }
    }
  }

  // Apply scrolling texture along contour using distance and index from transform
  const contourLen = contour.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y][x] === null) continue;
      const dist = distMap[y][x];
      if (dist > outlineThickness + bandWidth) continue;

      const nearestIdx = idxMap[y][x];
      if (nearestIdx < 0) continue; // no contour found (shouldn't happen for non-null pixels near contour)

      // Scroll the index
      const scrolledIdx = ((nearestIdx + offset) % contourLen + contourLen) % contourLen;
      // Band pattern: alternate colors based on scrolled position
      const bandPos = (scrolledIdx / bandWidth) % 2;
      const texColor = bandPos < 1 ? colorA : colorB;

      if (dist <= outlineThickness) {
        // On the contour: apply texture color
        if (blendWithOriginal) {
          result[y][x] = lerpColor(pixels[y][x]!, texColor, 0.7 * weight);
        } else {
          result[y][x] = weight >= 1 ? texColor : lerpColor(pixels[y][x]!, texColor, weight);
        }
      } else {
        // Near contour: fade texture influence
        const fadeDist = outlineThickness + bandWidth;
        const influence = Math.max(0, 1 - (dist - outlineThickness) / (fadeDist - outlineThickness));
        if (influence > 0) {
          result[y][x] = lerpColor(result[y][x]!, texColor, influence * 0.3 * weight);
        }
      }
    }
  }

  return result;
}
