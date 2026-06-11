/**
 * canvas-utils.ts — Pure utility functions for PixelCanvas.
 * No React or store dependencies.
 */

import type { PixelColor, Part } from '@/lib/types';

/** Catmull-Rom to Cubic Bezier conversion for smooth interpolation through all points */
export function catmullRomToBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  alpha: number = 0.5,
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } {
  const d1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
  const d2 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  const d3 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

  const sd1 = Math.pow(d1, alpha);
  const sd2 = Math.pow(d2, alpha);
  const sd3 = Math.pow(d3, alpha);

  const b1x = sd2 > 0 && sd1 + sd2 > 0
    ? p1.x + (sd2 * sd2 * (p2.x - p0.x) - sd1 * sd1 * (p3.x - p1.x)) / (3 * (sd1 + sd2))
    : p1.x;
  const b1y = sd2 > 0 && sd1 + sd2 > 0
    ? p1.y + (sd2 * sd2 * (p2.y - p0.y) - sd1 * sd1 * (p3.y - p1.y)) / (3 * (sd1 + sd2))
    : p1.y;
  const b2x = sd2 > 0 && sd2 + sd3 > 0
    ? p2.x - (sd2 * sd2 * (p3.x - p1.x) - sd3 * sd3 * (p2.x - p0.x)) / (3 * (sd2 + sd3))
    : p2.x;
  const b2y = sd2 > 0 && sd2 + sd3 > 0
    ? p2.y - (sd2 * sd2 * (p3.y - p1.y) - sd3 * sd3 * (p2.y - p0.y)) / (3 * (sd2 + sd3))
    : p2.y;

  return { cp1x: b1x, cp1y: b1y, cp2x: b2x, cp2y: b2y };
}

/** Evaluate a cubic bezier curve at parameter t */
export function evaluateBezier(
  p0: number, cp1: number, cp2: number, p1: number, t: number,
): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * cp1 + 3 * mt * t * t * cp2 + t * t * t * p1;
}

/** Draw a diamond marker at a point */
export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  strokeColor: string,
) {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Check if a pixel coordinate is inside a part's bounding box */
export function isPixelInPart(
  px: number,
  py: number,
  part: Part,
  offsetX: number,
  offsetY: number,
  translateOffsetX: number = 0,
  translateOffsetY: number = 0,
): boolean {
  const left = offsetX - part.pivotX + (part.offsetX || 0) + translateOffsetX;
  const top = offsetY - part.pivotY + (part.offsetY || 0) + translateOffsetY;
  return px >= left && px < left + part.width && py >= top && py < top + part.height;
}

/** Douglas-Peucker path simplification algorithm */
export function simplifyPath(
  points: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPath(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

/** Perpendicular distance from a point to a line segment */
function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }

  const numerator = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return numerator / Math.sqrt(lenSq);
}

/** Get the pixel color at a canvas coordinate from a part */
export function getPixelAt(
  px: number,
  py: number,
  part: Part,
  offsetX: number,
  offsetY: number,
  translateOffsetX: number = 0,
  translateOffsetY: number = 0,
): PixelColor {
  const localX = px - (offsetX - part.pivotX + (part.offsetX || 0) + translateOffsetX);
  const localY = py - (offsetY - part.pivotY + (part.offsetY || 0) + translateOffsetY);
  if (localX < 0 || localX >= part.width || localY < 0 || localY >= part.height) return null;
  return part.pixels[localY]?.[localX] ?? null;
}

/** Bresenham line algorithm for smooth drawing between two points */
export function getLinePixels(
  x0: number, y0: number, x1: number, y1: number,
): Array<{ x: number; y: number }> {
  const pixels: Array<{ x: number; y: number }> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    pixels.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return pixels;
}

/** Point-in-polygon test (ray casting algorithm) */
export function pointInPolygon(
  px: number,
  py: number,
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Compute the "end point" (末端) of a sprite in local coordinates */
export function computeSpriteEndPoint(
  width: number, height: number, pivotX: number, pivotY: number,
): { x: number; y: number } {
  const edgeCenters = [
    { x: -pivotX, y: -pivotY + height / 2 },
    { x: width - pivotX, y: -pivotY + height / 2 },
    { x: -pivotX + width / 2, y: -pivotY },
    { x: -pivotX + width / 2, y: height - pivotY },
  ];
  let maxDistSq = 0;
  let endLocal = { x: 0, y: 0 };
  for (const ec of edgeCenters) {
    const distSq = ec.x * ec.x + ec.y * ec.y;
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      endLocal = ec;
    }
  }
  return endLocal;
}

/** Check if current tool is a stroke-based tool */
export function isStrokeToolCheck(tool: string): boolean {
  return tool === 'motion_blur_brush' || tool === 'glow_brush' || tool === 'particle_brush' || tool === 'afterimage_brush';
}

/** Get cursor style based on current tool */
export function getCursorStyle(tool: string, spaceHeld: boolean): string {
  if (spaceHeld) return 'grab';
  switch (tool) {
    case 'select': return 'default';
    case 'brush':
    case 'eraser':
    case 'fill':
    case 'eyedropper':
    case 'trajectory':
    case 'crop':
    case 'motion_blur_brush':
    case 'glow_brush':
    case 'particle_brush':
    case 'afterimage_brush':
    case 'bone':
    case 'ik':
    case 'weight_paint':
    case 'lasso':
    case 'magic_wand':
    case 'puppet':
    case 'smart_select':
    case 'inpaint':
      return 'crosshair';
    case 'move': return 'move';
    default: return 'default';
  }
}
