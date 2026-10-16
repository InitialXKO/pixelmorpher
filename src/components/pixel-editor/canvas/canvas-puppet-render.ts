/**
 * canvas-puppet-render.ts — Character skeleton overlay rendering for PixelCanvas.
 * Migrated from Puppet model to new Character model.
 * Extracted from the main render function to keep file sizes manageable.
 */

import { computeSpriteEndPoint, spritePivotX, spritePivotY } from './canvas-utils';
import type { RenderContext } from './canvas-render-helpers';
import type { Character, Node } from '@/lib/unified-types';
import { pxToSub, subToPx } from '@/lib/unified-types';

// ============================================================
// Puppet skeleton overlay visualization
// ============================================================

export interface PuppetSkeletonOverlayParams {
  shouldRender: boolean;
  /** 新模型：Character 数组（替代 PuppetSkeleton[]） */
  characters: Character[];
  activePuppetSkeletonId: string | null;
  selectedNodeId: string | null;
  animationClips: import('@/lib/types').AnimationClip[];
  sprites: import('@/lib/unified-types').Sprite[];
}

export function renderPuppetSkeletonOverlay(rc: RenderContext, params: PuppetSkeletonOverlayParams) {
  const { shouldRender, characters, activePuppetSkeletonId, selectedNodeId, animationClips, sprites: parts } = params;
  if (!shouldRender || characters.length === 0) return;

  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY, currentFrame } = rc;

  for (const character of characters) {
    const isActive = character.id === activePuppetSkeletonId;
    const nodes = Object.values(character.nodes);

    // Build parent map from attachment (new model)
    const parentMap = new Map<string, { parentId: string; socketId: string }>();
    for (const node of nodes) {
      if (node.attachment?.type === 'socket' && node.attachment.parentSocketId) {
        const socketId = node.attachment.parentSocketId;
        const parentNode = nodes.find(n => n.sockets.some(s => s.id === socketId));
        if (parentNode) parentMap.set(node.id, { parentId: parentNode.id, socketId });
      }
    }

    // Compute world positions recursively (SubPixel units throughout;
    // converted to pixels via subToPx at draw time)
    const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
    const centerX = pxToSub(canvasWidth / 2);
    const centerY = pxToSub(canvasHeight / 2);

    function computeNodeWorldPosOverlay(nodeId: string, parentWorldX: number, parentWorldY: number, parentWorldAngle: number): void {
      const node = character.nodes[nodeId];
      if (!node) return;

      // 新模型：使用 rest pose（transform），不做关键帧插值
      // 单位：全 SubPixel（node.transform.x/y、socket.basePosition 均为 SubPixel）
      const angle = node.transform.angle ?? 0;
      const offsetX = node.transform.x ?? 0;
      const offsetY = node.transform.y ?? 0;

      let worldX: number;
      let worldY: number;

      const isSocketAttached = node.attachment?.type === 'socket';
      if (!isSocketAttached) {
        worldX = Math.round(centerX + offsetX);
        worldY = Math.round(centerY + offsetY);
      } else {
        const parentInfo = parentMap.get(node.id);
        if (parentInfo) {
          const parentPos = worldPositions.get(parentInfo.parentId);
          if (parentPos) {
            const parentNode = character.nodes[parentInfo.parentId];
            const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
            if (socket && parentNode) {
              const parentAngleRad = (parentPos.angle * Math.PI) / 180;
              const cosA = Math.cos(parentAngleRad);
              const sinA = Math.sin(parentAngleRad);
              const socketWorldX = parentPos.x + (socket.basePosition.x * cosA - socket.basePosition.y * sinA);
              const socketWorldY = parentPos.y + (socket.basePosition.x * sinA + socket.basePosition.y * cosA);
              // offset 在父节点局部空间，需按父节点角度旋转（与主渲染一致）
              const rotatedOffsetX = offsetX * cosA - offsetY * sinA;
              const rotatedOffsetY = offsetX * sinA + offsetY * cosA;
              worldX = Math.round(socketWorldX + rotatedOffsetX);
              worldY = Math.round(socketWorldY + rotatedOffsetY);
            } else {
              worldX = Math.round(parentPos.x + offsetX);
              worldY = Math.round(parentPos.y + offsetY);
            }
          } else {
            worldX = Math.round(centerX + offsetX);
            worldY = Math.round(centerY + offsetY);
          }
        } else {
          worldX = Math.round(centerX + offsetX);
          worldY = Math.round(centerY + offsetY);
        }
      }

      const worldAngle = parentWorldAngle + angle;
      worldPositions.set(node.id, { x: worldX, y: worldY, angle: worldAngle });

      for (const childNode of nodes) {
        if (childNode.attachment?.type === 'socket' && parentMap.get(childNode.id)?.parentId === node.id) {
          computeNodeWorldPosOverlay(childNode.id, worldX, worldY, worldAngle);
        }
      }
    }

    for (const node of nodes) {
      if (node.attachment?.type !== 'socket') computeNodeWorldPosOverlay(node.id, centerX, centerY, 0);
    }

    // Draw connections (lines from parent sockets to child positions)
    for (const node of nodes) {
      if (node.attachment?.type !== 'socket') continue;
      const parentInfo = parentMap.get(node.id);
      if (!parentInfo) continue;
      const parentPos = worldPositions.get(parentInfo.parentId);
      const childPos = worldPositions.get(node.id);
      if (!parentPos || !childPos) continue;

      const parentNode = character.nodes[parentInfo.parentId];
      const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
      if (!socket || !parentNode) continue;

      const parentAngleRad = (parentPos.angle * Math.PI) / 180;
      const cosA = Math.cos(parentAngleRad);
      const sinA = Math.sin(parentAngleRad);
      const socketWorldX = parentPos.x + (socket.basePosition.x * cosA - socket.basePosition.y * sinA);
      const socketWorldY = parentPos.y + (socket.basePosition.x * sinA + socket.basePosition.y * cosA);

      const socketScreenX = panX + subToPx(socketWorldX) * zoom;
      const socketScreenY = panY + subToPx(socketWorldY) * zoom;
      const childScreenX = panX + subToPx(childPos.x) * zoom;
      const childScreenY = panY + subToPx(childPos.y) * zoom;

      ctx.save();
      ctx.strokeStyle = isActive ? '#88ff88' : '#448844';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(socketScreenX, socketScreenY);
      ctx.lineTo(childScreenX, childScreenY);
      ctx.stroke();
      ctx.restore();
    }

    // Draw node positions
    for (const node of nodes) {
      if (!node.visible) continue;
      const pos = worldPositions.get(node.id);
      if (!pos) continue;

      const screenX = panX + subToPx(pos.x) * zoom;
      const screenY = panY + subToPx(pos.y) * zoom;
      const isSelected = node.id === selectedNodeId;

      ctx.save();
      ctx.fillStyle = isSelected ? '#ff8844' : (isActive ? '#88ff88' : '#668866');
      ctx.beginPath();
      ctx.arc(screenX, screenY, isSelected ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : '#000000';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      if (isSelected || isActive) {
        const rad = (pos.angle * Math.PI) / 180;
        const lineLen = 12;
        ctx.strokeStyle = isSelected ? '#ff8844' : '#88ff88';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(screenX + Math.cos(rad) * lineLen, screenY + Math.sin(rad) * lineLen);
        ctx.stroke();
      }

      if (zoom >= 4) {
        ctx.fillStyle = isSelected ? '#ff8844' : '#aaaaaa';
        ctx.font = '9px sans-serif';
        ctx.fillText(node.name, screenX + 8, screenY - 4);
      }

      // Socket positions
      for (const socket of node.sockets) {
        const socketAngleRad = (pos.angle * Math.PI) / 180;
        const cosA2 = Math.cos(socketAngleRad);
        const sinA2 = Math.sin(socketAngleRad);
        const socketWX = pos.x + (socket.basePosition.x * cosA2 - socket.basePosition.y * sinA2);
        const socketWY = pos.y + (socket.basePosition.x * sinA2 + socket.basePosition.y * cosA2);
        const socketSX = panX + subToPx(socketWX) * zoom;
        const socketSY = panY + subToPx(socketWY) * zoom;

        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(socketSX, socketSY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // End point indicator for child nodes (new model: use node.sprite)
      // plug 是 SubPixel，转像素后与 width/height（像素）一致计算
      const nodeSprite = node.sprite;
      if (nodeSprite && node.attachment?.type === 'socket') {
        const endLocal = computeSpriteEndPoint(
          nodeSprite.width, nodeSprite.height,
          nodeSprite.plug ? subToPx(nodeSprite.plug.x) : 0,
          nodeSprite.plug ? subToPx(nodeSprite.plug.y) : 0
        );
        const endRad = (pos.angle * Math.PI) / 180;
        const endCosA = Math.cos(endRad);
        const endSinA = Math.sin(endRad);
        const endWX = pos.x + pxToSub(endLocal.x * endCosA - endLocal.y * endSinA);
        const endWY = pos.y + pxToSub(endLocal.x * endSinA + endLocal.y * endCosA);
        const endSX = panX + subToPx(endWX) * zoom;
        const endSY = panY + subToPx(endWY) * zoom;

        const dSize = isSelected ? 5 : 3;
        ctx.fillStyle = isSelected ? '#ff4488' : (isActive ? '#44aaff' : '#446688');
        ctx.beginPath();
        ctx.moveTo(endSX, endSY - dSize);
        ctx.lineTo(endSX + dSize, endSY);
        ctx.lineTo(endSX, endSY + dSize);
        ctx.lineTo(endSX - dSize, endSY);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      ctx.restore();
    }
  }
}

// ============================================================
// Pivot crosshair for selected part
// ============================================================

export function renderPivotCrosshair(
  rc: RenderContext,
  selectedPart: import('@/lib/unified-types').Sprite | null,
  getInterpolatedTranslateOffset: (partId: string, frame: number) => { offsetX: number; offsetY: number },
) {
  if (!selectedPart) return;
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY, currentFrame } = rc;

  const offsetX = canvasWidth / 2;
  const offsetY = canvasHeight / 2;

  let pivotScreenX = panX + offsetX * zoom;
  let pivotScreenY = panY + offsetY * zoom;

  const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id!, currentFrame);
  pivotScreenX += txOff * zoom;
  pivotScreenY += tyOff * zoom;

  const crossSize = Math.max(8, zoom * 2);

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pivotScreenX - crossSize, pivotScreenY);
  ctx.lineTo(pivotScreenX + crossSize, pivotScreenY);
  ctx.moveTo(pivotScreenX, pivotScreenY - crossSize);
  ctx.lineTo(pivotScreenX, pivotScreenY + crossSize);
  ctx.stroke();

  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pivotScreenX - crossSize, pivotScreenY);
  ctx.lineTo(pivotScreenX + crossSize, pivotScreenY);
  ctx.moveTo(pivotScreenX, pivotScreenY - crossSize);
  ctx.lineTo(pivotScreenX, pivotScreenY + crossSize);
  ctx.stroke();

  ctx.fillStyle = '#ff3333';
  ctx.beginPath();
  ctx.arc(pivotScreenX, pivotScreenY, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Part bounding box highlight
  const partScreenX = panX + (offsetX - spritePivotX(selectedPart) + 0) * zoom;
  const partScreenY = panY + (offsetY - spritePivotY(selectedPart) + 0) * zoom;
  const partScreenW = selectedPart.width * zoom;
  const partScreenH = selectedPart.height * zoom;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(partScreenX, partScreenY, partScreenW, partScreenH);
  ctx.setLineDash([]);
  ctx.restore();
}

// ============================================================
// Stroke cursor indicator
// ============================================================

export function renderStrokeCursorIndicator(
  rc: RenderContext,
  isDrawing: boolean,
  tool: string,
  isStrokeTool: boolean,
  lastPixel: { x: number; y: number } | null,
) {
  if (!isDrawing || !isStrokeTool || !lastPixel) return;
  const { ctx, zoom, panX, panY } = rc;

  const screenX = panX + lastPixel.x * zoom;
  const screenY = panY + lastPixel.y * zoom;

  ctx.save();
  if (tool === 'motion_blur_brush') ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
  else if (tool === 'glow_brush') ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
  else if (tool === 'particle_brush') ctx.strokeStyle = 'rgba(255, 128, 0, 0.6)';
  else ctx.strokeStyle = 'rgba(128, 0, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(screenX + zoom / 2, screenY + zoom / 2, zoom * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// Dev FPS counter
// ============================================================

export function renderFpsCounter(
  ctx: CanvasRenderingContext2D,
  fpsDisplay: string,
) {
  if (!fpsDisplay) return;
  ctx.save();
  ctx.font = '10px monospace';
  ctx.fillStyle = 'rgba(0,255,0,0.7)';
  ctx.fillText(fpsDisplay, 4, 12);
  ctx.restore();
}
