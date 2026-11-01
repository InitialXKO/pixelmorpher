const LANDMARK_COLORS: Record<string, string> = {
  leftEye: '#60a5fa',  // 蓝
  rightEye: '#4ade80', // 绿
  nose: '#facc15',     // 黄
  mouth: '#f87171',    // 红
};

const LANDMARK_LABELS: Record<string, string> = {
  leftEye: '左眼',
  rightEye: '右眼',
  nose: '鼻',
  mouth: '嘴',
};


/**
 * canvas-render-helpers.ts — Standalone render sub-functions for PixelCanvas.
 * Each function draws a specific overlay or section onto the canvas context.
 * All functions are pure — they take ctx + params and draw without side effects.
 */

import { drawDiamond, catmullRomToBezier, evaluateBezier, computeSpriteEndPoint, spritePivotX, spritePivotY } from './canvas-utils';
import type { PuppetNode } from '@/lib/types';
import type { Sprite } from '@/lib/unified-types';
import { resolveRegionCells } from '@/lib/sprite-marks';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-utils';

// ============================================================
// Shared types for render parameters
// ============================================================

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  currentFrame: number;
}

// ============================================================
// 1. Grid overlay
// ============================================================

/** 网格透明度：随缩放单调淡入——zoom 4 起步为 0、8 及以上为 1。
 * 旧公式 (zoom-6)/4 在显示门（zoom≥4）内 [4,6) 段为负，globalAlpha
 * 负值被画布忽略、实际满格显示，且 6 处从 0 重来，非单调（审计域2）。 */
export function gridAlphaForZoom(zoom: number): number {
  return Math.max(0, Math.min(1, (zoom - 4) / 4));
}

export function renderGridOverlay(rc: RenderContext) {
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;
  if (zoom < 4) return;

  ctx.save();
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.globalAlpha = gridAlphaForZoom(zoom);

  const startX = panX;
  const startY = panY;
  const endX = panX + canvasWidth * zoom;
  const endY = panY + canvasHeight * zoom;

  for (let x = 0; x <= canvasWidth; x++) {
    const screenX = Math.floor(panX + x * zoom) + 0.5;
    if (screenX < 0 || screenX > ctx.canvas.width) continue;
    ctx.beginPath();
    ctx.moveTo(screenX, Math.max(0, startY));
    ctx.lineTo(screenX, Math.min(ctx.canvas.height, endY));
    ctx.stroke();
  }

  for (let y = 0; y <= canvasHeight; y++) {
    const screenY = Math.floor(panY + y * zoom) + 0.5;
    if (screenY < 0 || screenY > ctx.canvas.height) continue;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, startX), screenY);
    ctx.lineTo(Math.min(ctx.canvas.width, endX), screenY);
    ctx.stroke();
  }

  ctx.restore();
}

// ============================================================
// 2. Canvas border
// ============================================================

export function renderCanvasBorder(rc: RenderContext) {
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;
  ctx.save();
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 2;
  ctx.strokeRect(panX, panY, canvasWidth * zoom, canvasHeight * zoom);
  ctx.restore();
}

// ============================================================
// 3. Selection overlay and marching ants
// ============================================================

export function renderSelectionOverlay(
  rc: RenderContext,
  selectionMask: Set<string>,
  marchOffset: number,
  offsetX: number = 0,
  offsetY: number = 0,
): number {
  if (selectionMask.size === 0) return marchOffset;

  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(panX, panY, canvasWidth * zoom, canvasHeight * zoom);

  for (const key of selectionMask) {
    const [sx, sy] = key.split(',');
    const px = parseInt(sx, 10) + offsetX;
    const py = parseInt(sy, 10) + offsetY;
    ctx.clearRect(panX + px * zoom, panY + py * zoom, zoom, zoom);
  }

  const newOffset = (marchOffset + 0.5) % 8;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -newOffset;

  for (const key of selectionMask) {
    const [sx, sy] = key.split(',');
    // 边界判定在 mask 自身坐标系里做，绘制时再加偏移
    const lx = parseInt(sx, 10);
    const ly = parseInt(sy, 10);
    const isBoundary =
      !selectionMask.has(`${lx - 1},${ly}`) ||
      !selectionMask.has(`${lx + 1},${ly}`) ||
      !selectionMask.has(`${lx},${ly - 1}`) ||
      !selectionMask.has(`${lx},${ly + 1}`);

    if (isBoundary) {
      const px = lx + offsetX;
      const py = ly + offsetY;
      ctx.strokeRect(panX + px * zoom, panY + py * zoom, zoom, zoom);
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
  return newOffset;
}

// ============================================================
// 4. SAM mask overlay
// ============================================================

// ============================================================
// 5. Lasso path preview
// ============================================================

export function renderLassoPreview(
  rc: RenderContext,
  lassoPath: { x: number; y: number }[],
) {
  if (lassoPath.length <= 1) return;
  const { ctx, zoom, panX, panY } = rc;

  ctx.save();
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  const firstPoint = lassoPath[0];
  ctx.moveTo(panX + firstPoint.x * zoom + zoom / 2, panY + firstPoint.y * zoom + zoom / 2);
  for (let i = 1; i < lassoPath.length; i++) {
    const p = lassoPath[i];
    ctx.lineTo(panX + p.x * zoom + zoom / 2, panY + p.y * zoom + zoom / 2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ============================================================
// 6. Hand-drawn trajectory preview
// ============================================================

export function renderHandDrawnTrajectoryPreview(
  rc: RenderContext,
  path: { x: number; y: number }[],
) {
  if (path.length <= 1) return;
  const { ctx, zoom, panX, panY } = rc;

  ctx.save();
  ctx.strokeStyle = '#ff66ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  const firstPt = path[0];
  ctx.moveTo(panX + firstPt.x * zoom + zoom / 2, panY + firstPt.y * zoom + zoom / 2);
  for (let i = 1; i < path.length; i++) {
    const p = path[i];
    ctx.lineTo(panX + p.x * zoom + zoom / 2, panY + p.y * zoom + zoom / 2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff66ff';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`手绘轨迹 (${path.length}点)`, panX + firstPt.x * zoom, panY + firstPt.y * zoom - 8);
  ctx.restore();
}

// ============================================================
// 7. Crop rectangle preview
// ============================================================

export function renderCropPreview(
  rc: RenderContext,
  cropRect: { x1: number; y1: number; x2: number; y2: number } | null,
) {
  if (!cropRect) return;
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;

  const rx = Math.min(cropRect.x1, cropRect.x2);
  const ry = Math.min(cropRect.y1, cropRect.y2);
  const rw = Math.abs(cropRect.x2 - cropRect.x1) + 1;
  const rh = Math.abs(cropRect.y2 - cropRect.y1) + 1;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(panX, panY, canvasWidth * zoom, ry * zoom);
  ctx.fillRect(panX, panY + (ry + rh) * zoom, canvasWidth * zoom, (canvasHeight - ry - rh) * zoom);
  ctx.fillRect(panX, panY + ry * zoom, rx * zoom, rh * zoom);
  ctx.fillRect(panX + (rx + rw) * zoom, panY + ry * zoom, (canvasWidth - rx - rw) * zoom, rh * zoom);

  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(panX + rx * zoom, panY + ry * zoom, rw * zoom, rh * zoom);
  ctx.setLineDash([]);

  const handleSize = 6;
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(panX + rx * zoom - handleSize / 2, panY + ry * zoom - handleSize / 2, handleSize, handleSize);
  ctx.fillRect(panX + (rx + rw) * zoom - handleSize / 2, panY + ry * zoom - handleSize / 2, handleSize, handleSize);
  ctx.fillRect(panX + rx * zoom - handleSize / 2, panY + (ry + rh) * zoom - handleSize / 2, handleSize, handleSize);
  ctx.fillRect(panX + (rx + rw) * zoom - handleSize / 2, panY + (ry + rh) * zoom - handleSize / 2, handleSize, handleSize);

  ctx.fillStyle = '#ff6b6b';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${rw}×${rh}`, panX + (rx + rw / 2) * zoom, panY + (ry + rh) * zoom + 14);
  ctx.restore();
}

// ============================================================

export function renderMarkOverlay(
  rc: RenderContext,
  sprite: import('@/lib/unified-types').Sprite,
  offsetX: number,
  offsetY: number,
  selectedMarkId: string | null,
  drag: { markId: string; working: import('@/lib/unified-types').SpriteMark; paintCells?: Uint8Array } | null,
): void {
  const raw = sprite.marks ?? [];
  if (raw.length === 0 && !drag) return;
  const marks = drag
    ? [...raw.filter((m) => m.id !== drag.markId), drag.working]
    : raw;
  const { ctx, zoom, panX, panY } = rc;
  const W = sprite.width, H = sprite.height;
  const toScreen = (nx: number, ny: number) => ({
    x: panX + (nx * W + offsetX) * zoom,
    y: panY + (ny * H + offsetY) * zoom,
  });
  ctx.save();
  for (const m of marks) {
    const selected = m.id === selectedMarkId;
    const color = selected ? '#facc15' : '#ff50b4';
    if (m.kind === 'region') {
      const cells = drag && drag.markId === m.id && drag.paintCells
        ? drag.paintCells
        : resolveRegionCells(sprite, m.name, sprite.data);
      if (cells) {
        ctx.fillStyle = selected ? 'rgba(250,204,21,0.4)' : 'rgba(255,80,180,0.35)';
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!cells[y * W + x]) continue;
            const sx = panX + (x + offsetX) * zoom;
            const sy = panY + (y + offsetY) * zoom;
            ctx.fillRect(sx, sy, Math.max(1, zoom), Math.max(1, zoom));
          }
        }
      }
      continue;
    }
    if (m.kind === 'value') continue;
    if (m.kind === 'direction') {
      const c = toScreen(0.5, 0.5);
      const len = Math.min(W, H) * 0.3 * zoom;
      const rad = (m.angleDeg * Math.PI) / 180;
      const tx = c.x + Math.cos(rad) * len;
      const ty = c.y + Math.sin(rad) * len;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, zoom * 0.4);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `${Math.max(9, 10 * zoom * 0.5)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(m.name, tx + 3, ty + 3);
      continue;
    }
    // point / vector
    const a = toScreen(m.x, m.y);
    const r = Math.max(3, 4 * zoom * 0.5);
    if (m.kind === 'vector') {
      const t = toScreen(m.x + m.dx, m.y + m.dy);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, zoom * 0.4);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      // 箭头
      const ang = Math.atan2(t.y - a.y, t.x - a.x);
      const ah = Math.max(5, zoom * 1.2);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x - ah * Math.cos(ang - 0.45), t.y - ah * Math.sin(ang - 0.45));
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x - ah * Math.cos(ang + 0.45), t.y - ah * Math.sin(ang + 0.45));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(a.x, a.y, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(9, 10 * zoom * 0.5)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(m.name, a.x + r + 3, a.y + 3);
  }
  ctx.restore();
}

/**
 * 在 sprite_edit 模式下绘制已标注的特征点。
 * landmarks 为相对坐标 0~1；offsetX/Y 为精灵在画布上的偏移（居中绘制约定）。
 */
export function renderLandmarkOverlay(
  rc: RenderContext,
  landmarks: import('@/lib/unified-types').SpriteLandmarks | undefined,
  spriteWidth: number,
  spriteHeight: number,
  offsetX: number,
  offsetY: number,
): void {
  if (!landmarks) return;
  const { ctx, zoom, panX, panY } = rc;

  ctx.save();
  for (const key of ['leftEye', 'rightEye', 'nose', 'mouth'] as const) {
    const pt = landmarks[key];
    if (!pt) continue;
    const px = pt.x * spriteWidth + offsetX;
    const py = pt.y * spriteHeight + offsetY;
    const sx = panX + px * zoom;
    const sy = panY + py * zoom;
    const r = Math.max(3, 4 * zoom * 0.5);

    // 外圈白边 + 彩色圆点
    ctx.beginPath();
    ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = LANDMARK_COLORS[key];
    ctx.fill();
    // 标签
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(9, 10 * zoom * 0.5)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(LANDMARK_LABELS[key], sx + r + 3, sy + 3);
  }
  ctx.restore();
}
