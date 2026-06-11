/**
 * Helper: render joint discs between parent-child puppet node connections.
 * Extracted from renderPuppetNodes to reduce cyclomatic complexity.
 *
 * Draws filled circles at each parent-child connection point,
 * with latitude-based scaling for pseudo-3D depth.
 */

import type { PuppetSkeleton } from '../../types';
import { snapToPixel } from '../../store/puppet-slice';
import type { WorldTransform } from './types';

/**
 * Render joint discs for all plug-socket connections in the skeleton.
 */
export function renderJointDiscs(
  ctx: CanvasRenderingContext2D,
  skeleton: PuppetSkeleton,
  worldTransforms: Map<string, WorldTransform>,
  latitude: number,
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

    renderSingleJointDisc(ctx, parentWt, socket, parentNode, node, latitude);
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

  // Joint disc diameter = average of parent's bottom cross-section and child's top
  const diameter = Math.max(1, (parentNode.crossSectionBottom + childNode.crossSectionTop) / 2);
  if (diameter <= 0) return;

  // Latitude scaling: flatten discs into ellipses at higher latitudes
  const latitudeScaleY = latitude > 0 ? Math.max(0.3, 1 - latitude / 120) : 1;

  ctx.save();
  ctx.fillStyle = parentNode.color || '#888';
  ctx.beginPath();
  ctx.ellipse(socketWorldX, socketWorldY, Math.max(1, diameter / 2), Math.max(1, (diameter / 2) * latitudeScaleY), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
