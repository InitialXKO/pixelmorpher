/**
 * Helper: render joint discs between parent-child puppet node connections.
 * Extracted from renderPuppetNodes to reduce cyclomatic complexity.
 *
 * Draws filled circles at each parent-child connection point,
 * with latitude-based scaling for pseudo-3D depth.
 *
 * 关节盘约定（与 unified 管线一致）：
 * - 调用方应在精灵绘制之前调用本函数，使关节盘被两侧精灵遮挡（透过轮廓开口可见）
 * - 颜色：plug.discColor 自定义 > 子节点精灵开口处众数颜色 > 父节点 color
 * - 大小：子节点 plug 侧开口宽度（getPlugJointWidth，与 carve 开口同源）
 */

import type { PuppetSkeleton, Part } from '../../types';
import { snapToPixel } from '../../store/puppet-slice';
import type { WorldTransform } from './types';
import { sampleJointDiscColor, getPlugJointWidth } from './puppet-joint-color';

/**
 * Render joint discs for all plug-socket connections in the skeleton.
 */
export function renderJointDiscs(
  ctx: CanvasRenderingContext2D,
  skeleton: PuppetSkeleton,
  worldTransforms: Map<string, WorldTransform>,
  latitude: number,
  parts: Part[],
): void {
  for (const node of skeleton.nodes) {
    if (!node.plug) continue;

    const parentNode = skeleton.nodes.find(n =>
      n.sockets.some(s => s.id === node.plug!.socketId)
    );
    if (!parentNode) continue;

    const parentWt = worldTransforms.get(parentNode.id);
    if (!parentWt) continue;

    const socket = parentNode.sockets.find(s => s.id === node.plug!.socketId);
    if (!socket) continue;

    renderSingleJointDisc(ctx, parentWt, socket, parentNode, node, latitude, parts);
  }
}

// ── Internal helpers ──────────────────────────────────────────

function renderSingleJointDisc(
  ctx: CanvasRenderingContext2D,
  parentWt: WorldTransform,
  socket: { localX: number; localY: number },
  parentNode: PuppetSkeleton['nodes'][0],
  childNode: PuppetSkeleton['nodes'][0],
  latitude: number,
  parts: Part[],
): void {
  const parentAngleRad = (parentWt.worldAngle * Math.PI) / 180;
  const cosA = Math.cos(parentAngleRad);
  const sinA = Math.sin(parentAngleRad);

  const socketWorldX = snapToPixel(
    parentWt.worldX + (socket.localX * cosA - socket.localY * sinA)
  );
  const socketWorldY = snapToPixel(
    parentWt.worldY + (socket.localX * sinA + socket.localY * cosA)
  );

  // 关节盘直径 = 子节点 plug 侧开口宽度（= carve 开口宽度，不再与 parent bottom 求平均）
  const childPart = parts.find((p) => p.id === childNode.spritePartId);
  const diameter = Math.max(
    1,
    getPlugJointWidth(childNode, childPart
      ? { width: childPart.width, height: childPart.height, pivotX: childPart.pivotX, pivotY: childPart.pivotY }
      : null),
  );
  if (diameter <= 0) return;

  // Latitude scaling: flatten discs into ellipses at higher latitudes
  const latitudeScaleY = latitude > 0 ? Math.max(0.3, 1 - latitude / 120) : 1;

  // 关节盘颜色约定：plug.discColor 自定义 > 子节点精灵开口处众数颜色 > 父节点 color
  let discColor = childNode.plug?.discColor ?? null;
  if (!discColor) {
    const childPart = parts.find(p => p.id === childNode.spritePartId);
    const px = childPart?.pixels;
    if (px && px.length > 0 && childNode.plug) {
      const openX = (childPart?.pivotX ?? 0) + childNode.plug.localX;
      const openY = (childPart?.pivotY ?? 0) + childNode.plug.localY;
      discColor = sampleJointDiscColor(px, openX, openY);
    }
  }
  if (!discColor) discColor = parentNode.color || '#888';

  ctx.save();
  ctx.fillStyle = discColor;
  ctx.beginPath();
  ctx.ellipse(socketWorldX, socketWorldY, Math.max(1, diameter / 2), Math.max(1, (diameter / 2) * latitudeScaleY), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
