/**
 * canvas-puppet-render.ts — Character skeleton overlay rendering for PixelCanvas.
 * Migrated from Puppet model to new Character model.
 * Extracted from the main render function to keep file sizes manageable.
 */

import { computeSpriteEndPoint, spritePivotX, spritePivotY } from './canvas-utils';
import type { RenderContext } from './canvas-render-helpers';
import type { Character, Node } from '@/lib/unified-types';
import { pxToSub, subToPx, projectToView, rotateInViewPlane, resolveChainTarget3D } from '@/lib/unified-types';
import { computeWorldTransforms, socketOffsetTo3D } from '@/lib/unified-render';
import { useProjectStore } from '@/lib/store';

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

/**
 * 在骨架覆盖层上绘制 IK 目标手柄
 * 坐标：静态求解目标 target3D（原点中心世界空间）按链末关节当前朝向投影到 2D，再加画布中心
 */
export function renderIKTargetHandles(
  rc: { ctx: CanvasRenderingContext2D; canvasWidth: number; canvasHeight: number; zoom: number; panX: number; panY: number; currentFrame: number },
  character: Character,
): void {
  const chains = character.ikChains?.filter((c) => c.enabled);
  if (!chains || chains.length === 0) return;
  const { ctx, zoom, panX, panY } = rc;
  const worldTransforms = computeWorldTransforms(character, rc.currentFrame, rc.canvasWidth, rc.canvasHeight);
  ctx.save();
  for (const chain of chains) {
    const t3 = resolveChainTarget3D(chain, rc.canvasWidth, rc.canvasHeight);
    const dir = worldTransforms.get(chain.endNodeId)?.variantIndex ?? 6;
    const proj = projectToView(pxToSub(t3.x), pxToSub(t3.y), pxToSub(t3.z), dir);
    const sx = panX + (rc.canvasWidth / 2 + subToPx(proj.canvasX)) * zoom;
    const sy = panY + (rc.canvasHeight / 2 + subToPx(proj.canvasY)) * zoom;
    // 准星
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    const r = 8;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - r - 4, sy); ctx.lineTo(sx - r + 2, sy);
    ctx.moveTo(sx + r - 2, sy); ctx.lineTo(sx + r + 4, sy);
    ctx.moveTo(sx, sy - r - 4); ctx.lineTo(sx, sy - r + 2);
    ctx.moveTo(sx, sy + r - 2); ctx.lineTo(sx, sy + r + 4);
    ctx.stroke();
    // 链名
    ctx.fillStyle = '#00ff88';
    ctx.font = '10px sans-serif';
    ctx.fillText(chain.name, sx + r + 6, sy - r - 2);
  }
  ctx.restore();
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
    // 直接复用主渲染的 computeWorldTransforms，保证与主画布完全一致（不再重复造轮子）
    // 主渲染：3D 世界坐标（原点中心）→ generateRenderPlan 投影到 2D（+画布中心）
    const worldTransforms = computeWorldTransforms(character, currentFrame, canvasWidth, canvasHeight);
    const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
    const centerX = pxToSub(canvasWidth / 2);
    const centerY = pxToSub(canvasHeight / 2);
    // 与主渲染 generateRenderPlan:938 一致：用根节点的 variantIndex 作为当前朝向
    const rootNodeForDir = character.nodes[character.rootNodeId];
    const currentDirection = (rootNodeForDir?.transform.variantIndex ?? 0) as 0|1|2|3|4|5|6|7;
    for (const [nodeId, wt] of worldTransforms) {
      // 投影到 2D（与主渲染 generateRenderPlan:1374 一致），再加画布中心（:1377-1378）
      const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, currentDirection);
      const finalX = proj.canvasX + centerX;
      const finalY = proj.canvasY + centerY;
      worldPositions.set(nodeId, { x: finalX, y: finalY, angle: wt.worldAngle });
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

      // 插槽点：与渲染器同一口径——socketOffsetTo3D → 视平面旋转 → 投影 + 画布中心
      // （此前：2D directionOffsets 自算，不认 offset3D，3D 角色下插槽点塌到父节点）
      const parentWt = worldTransforms.get(parentInfo.parentId)!; // 与 parentPos 同源，必有
      const s3 = socketOffsetTo3D(socket, parentWt.variantIndex);
      const rotSock = rotateInViewPlane(s3.x, s3.y, s3.z, parentWt.worldAngle, parentWt.variantIndex);
      const projSock = projectToView(
        parentWt.worldX + pxToSub(rotSock.x),
        parentWt.worldY + pxToSub(rotSock.y),
        parentWt.worldZ + pxToSub(rotSock.z),
        currentDirection,
      );
      const socketWorldX = projSock.canvasX + centerX;
      const socketWorldY = projSock.canvasY + centerY;

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

      // Socket positions（与渲染器同一口径：socketOffsetTo3D → 视平面旋转 → 投影 + 画布中心）
      const nodeWt = worldTransforms.get(node.id)!; // 与 pos 同源，必有
      for (const socket of node.sockets) {
        const s3d = socketOffsetTo3D(socket, nodeWt.variantIndex);
        const rotDot = rotateInViewPlane(s3d.x, s3d.y, s3d.z, nodeWt.worldAngle, nodeWt.variantIndex);
        const projDot = projectToView(
          nodeWt.worldX + pxToSub(rotDot.x),
          nodeWt.worldY + pxToSub(rotDot.y),
          nodeWt.worldZ + pxToSub(rotDot.z),
          currentDirection,
        );
        const socketWX = projDot.canvasX + centerX;
        const socketWY = projDot.canvasY + centerY;
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
  getInterpolatedTranslateOffset: (spriteId: string, frame: number) => { offsetX: number; offsetY: number },
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
