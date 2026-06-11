/**
 * canvas-puppet-render.ts — Puppet skeleton overlay rendering for PixelCanvas.
 * Extracted from the main render function to keep file sizes manageable.
 */

import { computeSpriteEndPoint } from './canvas-utils';
import type { RenderContext } from './canvas-render-helpers';
import type { PuppetSkeleton, PuppetNode, PuppetNodeKeyframe, PuppetCharacter } from '@/lib/types';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-render';

// ============================================================
// Puppet skeleton overlay visualization
// ============================================================

export interface PuppetSkeletonOverlayParams {
  shouldRender: boolean;
  puppetSkeletons: PuppetSkeleton[];
  activePuppetSkeletonId: string | null;
  selectedPuppetNodeId: string | null;
  puppetCharacters: PuppetCharacter[];
  animationClips: import('@/lib/types').AnimationClip[];
  parts: import('@/lib/types').Part[];
}

export function renderPuppetSkeletonOverlay(rc: RenderContext, params: PuppetSkeletonOverlayParams) {
  const { shouldRender, puppetSkeletons, activePuppetSkeletonId, selectedPuppetNodeId, puppetCharacters, animationClips, parts } = params;
  if (!shouldRender || puppetSkeletons.length === 0) return;

  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY, currentFrame } = rc;

  for (const skeleton of puppetSkeletons) {
    const isActive = skeleton.id === activePuppetSkeletonId;

    const character = puppetCharacters.find(c => c.puppetSkeletonId === skeleton.id);
    const clip = character ? animationClips.find(c => c.isPuppetClip && c.puppetCharacterId === character.id) : null;
    const keyframes = clip?.puppetNodeKeyframes ?? [];

    // Pre-index keyframes by nodeId
    const kfByNode = new Map<string, PuppetNodeKeyframe[]>();
    for (const kf of keyframes) {
      const arr = kfByNode.get(kf.nodeId) || [];
      arr.push(kf);
      kfByNode.set(kf.nodeId, arr);
    }

    // Build parent map
    const parentMap = new Map<string, { parentId: string; socketId: string }>();
    for (const node of skeleton.nodes) {
      if (node.plug) {
        const parentNode = skeleton.nodes.find(n => n.sockets.some(s => s.id === node.plug!.socketId));
        if (parentNode) parentMap.set(node.id, { parentId: parentNode.id, socketId: node.plug.socketId });
      }
    }

    // Compute world positions recursively
    const worldPositions = new Map<string, { x: number; y: number; angle: number }>();
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    function computeNodeWorldPosOverlay(nodeId: string, parentWorldX: number, parentWorldY: number, parentWorldAngle: number): void {
      const node = skeleton.nodes.find(n => n.id === nodeId);
      if (!node) return;

      const nodeKfs = kfByNode.get(node.id) || [];
      let angle = node.angle;
      let offsetX = node.offsetX;
      let offsetY = node.offsetY;

      if (nodeKfs.length > 0) {
        const sorted = [...nodeKfs].sort((a, b) => a.frame - b.frame);
        let prevKf: PuppetNodeKeyframe | null = null;
        let nextKf: PuppetNodeKeyframe | null = null;
        for (const kf of sorted) {
          if (kf.frame <= currentFrame) prevKf = kf;
          if (kf.frame > currentFrame && !nextKf) nextKf = kf;
        }
        if (prevKf) {
          angle = prevKf.angle ?? node.angle;
          offsetX = prevKf.offsetX ?? node.offsetX;
          offsetY = prevKf.offsetY ?? node.offsetY;
          if (nextKf && prevKf.frame !== nextKf.frame) {
            const t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
            offsetX = (prevKf.offsetX ?? node.offsetX) + ((nextKf.offsetX ?? node.offsetX) - (prevKf.offsetX ?? node.offsetX)) * t;
            offsetY = (prevKf.offsetY ?? node.offsetY) + ((nextKf.offsetY ?? node.offsetY) - (prevKf.offsetY ?? node.offsetY)) * t;
          }
        }
      }

      let worldX: number;
      let worldY: number;

      if (!node.plug) {
        worldX = Math.round(centerX + offsetX);
        worldY = Math.round(centerY + offsetY);
      } else {
        const parentInfo = parentMap.get(node.id);
        if (parentInfo) {
          const parentPos = worldPositions.get(parentInfo.parentId);
          if (parentPos) {
            const parentNode = skeleton.nodes.find(n => n.id === parentInfo.parentId);
            const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
            if (socket && parentNode) {
              const parentAngleRad = (parentPos.angle * Math.PI) / 180;
              const cosA = Math.cos(parentAngleRad);
              const sinA = Math.sin(parentAngleRad);
              const socketWorldX = parentPos.x + (socket.localX * cosA - socket.localY * sinA);
              const socketWorldY = parentPos.y + (socket.localX * sinA + socket.localY * cosA);
              worldX = Math.round(socketWorldX + offsetX);
              worldY = Math.round(socketWorldY + offsetY);
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

      for (const childNode of skeleton.nodes) {
        if (childNode.plug && parentMap.get(childNode.id)?.parentId === node.id) {
          computeNodeWorldPosOverlay(childNode.id, worldX, worldY, worldAngle);
        }
      }
    }

    for (const node of skeleton.nodes) {
      if (!node.plug) computeNodeWorldPosOverlay(node.id, centerX, centerY, 0);
    }

    // Draw connections (lines from parent sockets to child positions)
    for (const node of skeleton.nodes) {
      if (!node.plug) continue;
      const parentInfo = parentMap.get(node.id);
      if (!parentInfo) continue;
      const parentPos = worldPositions.get(parentInfo.parentId);
      const childPos = worldPositions.get(node.id);
      if (!parentPos || !childPos) continue;

      const parentNode = skeleton.nodes.find(n => n.id === parentInfo.parentId);
      const socket = parentNode?.sockets.find(s => s.id === parentInfo.socketId);
      if (!socket || !parentNode) continue;

      const parentAngleRad = (parentPos.angle * Math.PI) / 180;
      const cosA = Math.cos(parentAngleRad);
      const sinA = Math.sin(parentAngleRad);
      const socketWorldX = parentPos.x + (socket.localX * cosA - socket.localY * sinA);
      const socketWorldY = parentPos.y + (socket.localX * sinA + socket.localY * cosA);

      const socketScreenX = panX + socketWorldX * zoom;
      const socketScreenY = panY + socketWorldY * zoom;
      const childScreenX = panX + childPos.x * zoom;
      const childScreenY = panY + childPos.y * zoom;

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
    for (const node of skeleton.nodes) {
      if (!node.visible) continue;
      const pos = worldPositions.get(node.id);
      if (!pos) continue;

      const screenX = panX + pos.x * zoom;
      const screenY = panY + pos.y * zoom;
      const isSelected = node.id === selectedPuppetNodeId;

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
        const socketWX = pos.x + (socket.localX * cosA2 - socket.localY * sinA2);
        const socketWY = pos.y + (socket.localX * sinA2 + socket.localY * cosA2);
        const socketSX = panX + socketWX * zoom;
        const socketSY = panY + socketWY * zoom;

        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(socketSX, socketSY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // End point indicator for child nodes
      const nodePart = resolvePuppetNodeSprite(node, skeleton.currentDirection,
        character?.activeCostumeSetId ? character.costumeSets.find(cs => cs.id === character.activeCostumeSetId) ?? null : null,
        parts);
      if (nodePart && node.plug) {
        const endLocal = computeSpriteEndPoint(nodePart.width, nodePart.height, nodePart.pivotX, nodePart.pivotY);
        const endRad = (pos.angle * Math.PI) / 180;
        const endCosA = Math.cos(endRad);
        const endSinA = Math.sin(endRad);
        const endWX = pos.x + endLocal.x * endCosA - endLocal.y * endSinA;
        const endWY = pos.y + endLocal.x * endSinA + endLocal.y * endCosA;
        const endSX = panX + endWX * zoom;
        const endSY = panY + endWY * zoom;

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
  selectedPart: import('@/lib/types').Part | null,
  getInterpolatedTranslateOffset: (partId: string, frame: number) => { offsetX: number; offsetY: number },
) {
  if (!selectedPart) return;
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY, currentFrame } = rc;

  const offsetX = canvasWidth / 2;
  const offsetY = canvasHeight / 2;

  let pivotScreenX = panX + offsetX * zoom;
  let pivotScreenY = panY + offsetY * zoom;

  const { offsetX: txOff, offsetY: tyOff } = getInterpolatedTranslateOffset(selectedPart.id, currentFrame);
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
  const partScreenX = panX + (offsetX - selectedPart.pivotX + (selectedPart.offsetX || 0)) * zoom;
  const partScreenY = panY + (offsetY - selectedPart.pivotY + (selectedPart.offsetY || 0)) * zoom;
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
