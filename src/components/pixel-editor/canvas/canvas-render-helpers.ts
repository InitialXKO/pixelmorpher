/**
 * canvas-render-helpers.ts — Standalone render sub-functions for PixelCanvas.
 * Each function draws a specific overlay or section onto the canvas context.
 * All functions are pure — they take ctx + params and draw without side effects.
 */

import { drawDiamond, catmullRomToBezier, evaluateBezier, computeSpriteEndPoint } from './canvas-utils';
import type { Part, Skeleton, Bone, TrajectoryCurvePoint, PuppetSkeleton, PuppetNode, PuppetNodeKeyframe, PuppetCharacter } from '@/lib/types';
import { computeBoneTransforms } from '@/lib/engine';
import { resolvePuppetNodeSprite } from '@/lib/engine/puppet-render';

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

export function renderGridOverlay(rc: RenderContext) {
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;
  if (zoom < 8) return;

  ctx.save();
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.globalAlpha = Math.min(1, (zoom - 6) / 4);

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
): number {
  if (selectionMask.size === 0) return marchOffset;

  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(panX, panY, canvasWidth * zoom, canvasHeight * zoom);

  for (const key of selectionMask) {
    const [sx, sy] = key.split(',');
    const px = parseInt(sx, 10);
    const py = parseInt(sy, 10);
    ctx.clearRect(panX + px * zoom, panY + py * zoom, zoom, zoom);
  }

  const newOffset = (marchOffset + 0.5) % 8;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -newOffset;

  for (const key of selectionMask) {
    const [sx, sy] = key.split(',');
    const px = parseInt(sx, 10);
    const py = parseInt(sy, 10);
    const isBoundary =
      !selectionMask.has(`${px - 1},${py}`) ||
      !selectionMask.has(`${px + 1},${py}`) ||
      !selectionMask.has(`${px},${py - 1}`) ||
      !selectionMask.has(`${px},${py + 1}`);

    if (isBoundary) {
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

export interface SamOverlayParams {
  currentMask: Float32Array | null;
  maskShape: [number, number] | null;
}

export function renderSamMaskOverlay(rc: RenderContext, sam: SamOverlayParams) {
  if (!sam.currentMask || !sam.maskShape) return;
  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY } = rc;
  const [maskH, maskW] = sam.maskShape;
  const mask = sam.currentMask;

  ctx.save();
  ctx.globalAlpha = 0.4;
  for (let my = 0; my < maskH; my++) {
    for (let mx = 0; mx < maskW; mx++) {
      const value = mask[my * maskW + mx];
      if (value >= 0.5) {
        const cx = Math.floor((mx / maskW) * canvasWidth);
        const cy = Math.floor((my / maskH) * canvasHeight);
        ctx.fillStyle = 'rgba(33, 116, 144, 0.6)';
        ctx.fillRect(panX + cx * zoom, panY + cy * zoom, zoom, zoom);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

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
// 8. Bone overlay visualization
// ============================================================

export interface BoneOverlayParams {
  skeletons: Skeleton[];
  showSkeletons: boolean;
  selectedBoneId: string | null;
  activeSkeletonId: string | null;
}

export function renderBoneOverlay(rc: RenderContext, params: BoneOverlayParams) {
  const { skeletons, showSkeletons, selectedBoneId, activeSkeletonId } = params;
  if (!showSkeletons || skeletons.length === 0) return;

  const { ctx, zoom, panX, panY, currentFrame } = rc;

  for (const skeleton of skeletons) {
    if (!skeleton.visible) continue;

    const boneTransforms = computeBoneTransforms(skeleton, currentFrame);
    const isActive = skeleton.id === activeSkeletonId;

    for (const bone of skeleton.bones) {
      if (!bone.visible) continue;
      const isSelected = bone.id === selectedBoneId;

      const transform = boneTransforms.get(bone.id);
      const headCanvasX = transform ? transform.headX : bone.headX;
      const headCanvasY = transform ? transform.headY : bone.headY;
      const tailCanvasX = transform ? transform.tailX : bone.tailX;
      const tailCanvasY = transform ? transform.tailY : bone.tailY;

      const headScreenX = panX + headCanvasX * zoom;
      const headScreenY = panY + headCanvasY * zoom;
      const tailScreenX = panX + tailCanvasX * zoom;
      const tailScreenY = panY + tailCanvasY * zoom;

      ctx.save();
      ctx.strokeStyle = isSelected ? '#ff8844' : (isActive ? bone.color : '#666666');
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(headScreenX, headScreenY);
      ctx.lineTo(tailScreenX, tailScreenY);
      ctx.stroke();

      // Diamond at midpoint
      const midX = (headScreenX + tailScreenX) / 2;
      const midY = (headScreenY + tailScreenY) / 2;
      const dx = tailScreenX - headScreenX;
      const dy = tailScreenY - headScreenY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = -dy / len * 4;
        const ny = dx / len * 4;
        ctx.fillStyle = isSelected ? '#ff8844' : (isActive ? bone.color : '#666666');
        ctx.beginPath();
        ctx.moveTo(midX + nx, midY + ny);
        ctx.lineTo(tailScreenX, tailScreenY);
        ctx.lineTo(midX - nx, midY - ny);
        ctx.lineTo(headScreenX, headScreenY);
        ctx.closePath();
        ctx.fill();
      }

      // Head joint
      ctx.fillStyle = isSelected ? '#ffffff' : '#ffcc00';
      ctx.beginPath();
      ctx.arc(headScreenX, headScreenY, isSelected ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Tail joint
      ctx.fillStyle = isSelected ? '#ffffff' : '#88ccff';
      ctx.beginPath();
      ctx.arc(tailScreenX, tailScreenY, isSelected ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      // Bone name
      if (zoom >= 4) {
        ctx.fillStyle = isSelected ? '#ff8844' : '#aaaaaa';
        ctx.font = '10px sans-serif';
        ctx.fillText(bone.name, headScreenX + 8, headScreenY - 4);
      }

      // IK target
      for (const constraint of bone.constraints) {
        if (constraint.type === 'ik_solver') {
          const pose = skeleton.poses.find(p => p.boneId === bone.id && p.frame === currentFrame);
          const targetCanvasX = pose?.ikTargetX ?? constraint.targetX;
          const targetCanvasY = pose?.ikTargetY ?? constraint.targetY;
          const targetScreenX = panX + targetCanvasX * zoom;
          const targetScreenY = panY + targetCanvasY * zoom;

          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 2;
          const crossSize = 6;
          ctx.beginPath();
          ctx.moveTo(targetScreenX - crossSize, targetScreenY);
          ctx.lineTo(targetScreenX + crossSize, targetScreenY);
          ctx.moveTo(targetScreenX, targetScreenY - crossSize);
          ctx.lineTo(targetScreenX, targetScreenY + crossSize);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(targetScreenX, targetScreenY, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }
}

// ============================================================
// 9. Weight paint overlay visualization
// ============================================================

export interface WeightPaintParams {
  showWeightPaint: boolean;
  weightPaintBoneId: string | null;
  skeletons: Skeleton[];
  parts: Part[];
  getInterpolatedTranslateOffset: (partId: string, frame: number) => { offsetX: number; offsetY: number };
}

export function renderWeightPaintOverlay(rc: RenderContext, params: WeightPaintParams) {
  const { showWeightPaint, weightPaintBoneId, skeletons, parts, getInterpolatedTranslateOffset } = params;
  if (!showWeightPaint || !weightPaintBoneId) return;

  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY, currentFrame } = rc;

  for (const skeleton of skeletons) {
    const bone = skeleton.bones.find(b => b.id === weightPaintBoneId);
    if (!bone) continue;

    for (const binding of bone.boundParts) {
      const part = parts.find(p => p.id === binding.partId);
      if (!part || !part.visible) continue;

      const offsetX = canvasWidth / 2;
      const offsetY = canvasHeight / 2;
      const { offsetX: partOffsetX, offsetY: partOffsetY } = getInterpolatedTranslateOffset(part.id, currentFrame);

      const partScreenX = panX + (offsetX - part.pivotX + (part.offsetX || 0) + partOffsetX) * zoom;
      const partScreenY = panY + (offsetY - part.pivotY + (part.offsetY || 0) + partOffsetY) * zoom;
      const partScreenW = part.width * zoom;
      const partScreenH = part.height * zoom;

      const alpha = binding.weight * 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = bone.color;
      ctx.fillRect(partScreenX, partScreenY, partScreenW, partScreenH);
      ctx.restore();
    }
  }
}

// ============================================================
// 10. Trajectory visualization
// ============================================================

export interface TrajectoryOverlayParams {
  showTrajectories: boolean;
  trajectories: import('@/lib/types').Trajectory[];
  selectedPartId: string | null;
  editMode: string;
  trajectorySnap: boolean;
  totalFrames: number;
}

export function renderTrajectoryOverlay(rc: RenderContext, params: TrajectoryOverlayParams) {
  const { showTrajectories, trajectories, selectedPartId, editMode, trajectorySnap, totalFrames } = params;
  if (!showTrajectories) return;

  const { ctx, canvasWidth, canvasHeight, zoom, panX, panY, currentFrame } = rc;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  for (const traj of trajectories) {
    if (!traj.visible || traj.points.length === 0) continue;

    const isSelected = traj.partId === selectedPartId;
    const curveColor = isSelected ? '#00ffaa' : '#ff8800';
    const pointColor = isSelected ? '#00ffdd' : '#ffaa44';
    const highlightColor = '#ff3366';

    // Trajectory snap visualization
    if (trajectorySnap && isSelected && traj.points.length > 0) {
      const currentPt = traj.points.find(p => p.frame === currentFrame);
      if (currentPt) {
        const snappedX = Math.round(currentPt.x);
        const snappedY = Math.round(currentPt.y);
        if (snappedX !== currentPt.x || snappedY !== currentPt.y) {
          // Note: actual snap mutation is done in interaction handler, here we just render
        }
      } else {
        let prevPt: TrajectoryCurvePoint | null = null;
        let nextPt: TrajectoryCurvePoint | null = null;
        for (let i = 0; i < traj.points.length - 1; i++) {
          if (currentFrame >= traj.points[i].frame && currentFrame <= traj.points[i + 1].frame) {
            prevPt = traj.points[i];
            nextPt = traj.points[i + 1];
            break;
          }
        }
        if (prevPt && nextPt) {
          const frameRange = nextPt.frame - prevPt.frame;
          const t = frameRange > 0 ? (currentFrame - prevPt.frame) / frameRange : 0;
          const interpX = prevPt.x + (nextPt.x - prevPt.x) * t;
          const interpY = prevPt.y + (nextPt.y - prevPt.y) * t;

          let nearestDist = Infinity;
          let nearestPt: TrajectoryCurvePoint | null = null;
          for (const pt of traj.points) {
            const dist = Math.sqrt(Math.pow(interpX - pt.x, 2) + Math.pow(interpY - pt.y, 2));
            if (dist < nearestDist) { nearestDist = dist; nearestPt = pt; }
          }
          if (nearestPt && nearestDist <= 2) {
            const snapScreenX = panX + (centerX + nearestPt.x) * zoom;
            const snapScreenY = panY + (centerY + nearestPt.y) * zoom;
            ctx.save();
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(snapScreenX, snapScreenY, 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#00ffff';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('SNAP', snapScreenX, snapScreenY - 12);
            ctx.restore();
          }
        }
      }
    }

    // Convert trajectory points to screen coordinates
    const screenPoints = traj.points.map((pt) => ({
      x: panX + (centerX + pt.x) * zoom,
      y: panY + (centerY + pt.y) * zoom,
      frame: pt.frame,
      rotation: pt.rotation,
    }));

    if (screenPoints.length < 2) {
      const pt = screenPoints[0];
      const isCurrentFrame = pt.frame === currentFrame;
      drawDiamond(ctx, pt.x, pt.y, isCurrentFrame ? 7 : 5, isCurrentFrame ? highlightColor : pointColor, '#ffffff');
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`F${pt.frame}`, pt.x, pt.y - 10);
      ctx.restore();
      continue;
    }

    // Draw bezier curve
    ctx.save();
    ctx.strokeStyle = curveColor;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.globalAlpha = isSelected ? 0.9 : 0.5;

    const polylinePoints: { x: number; y: number }[] = [];
    const bezierSegments: { cp1x: number; cp1y: number; cp2x: number; cp2y: number }[] = [];

    for (let i = 0; i < screenPoints.length - 1; i++) {
      const p0 = i > 0 ? screenPoints[i - 1] : screenPoints[i];
      const p1 = screenPoints[i];
      const p2 = screenPoints[i + 1];
      const p3 = i < screenPoints.length - 2 ? screenPoints[i + 2] : screenPoints[i + 1];

      let bez = catmullRomToBezier({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }, { x: p3.x, y: p3.y });

      const curvePt = traj.points[i];
      const nextCurvePt = traj.points[i + 1];
      const hasCustomCp1 = curvePt && (curvePt.cp1x !== 0 || curvePt.cp1y !== 0);
      const hasCustomCp2 = nextCurvePt && (nextCurvePt.cp2x !== 0 || nextCurvePt.cp2y !== 0);

      if (hasCustomCp1) bez = { ...bez, cp1x: p1.x + curvePt.cp1x * zoom, cp1y: p1.y + curvePt.cp1y * zoom };
      if (hasCustomCp2) bez = { ...bez, cp2x: p2.x + nextCurvePt.cp2x * zoom, cp2y: p2.y + nextCurvePt.cp2y * zoom };

      bezierSegments.push(bez);
      const steps = 20;
      for (let s = 0; s <= steps; s++) {
        const st = s / steps;
        polylinePoints.push({ x: evaluateBezier(p1.x, bez.cp1x, bez.cp2x, p2.x, st), y: evaluateBezier(p1.y, bez.cp1y, bez.cp2y, p2.y, st) });
      }
    }

    if (polylinePoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(polylinePoints[0].x, polylinePoints[0].y);
      for (let i = 1; i < polylinePoints.length; i++) ctx.lineTo(polylinePoints[i].x, polylinePoints[i].y);
      ctx.stroke();
    }

    // Control point handles in trajectory_edit mode
    if (editMode === 'trajectory_edit' && isSelected) {
      for (let i = 0; i < bezierSegments.length; i++) {
        const seg = bezierSegments[i];
        const p1 = screenPoints[i];
        const p2 = screenPoints[i + 1];
        const curvePt = traj.points[i];
        const nextCurvePt = traj.points[i + 1];
        const hasCustomCp1 = curvePt && (curvePt.cp1x !== 0 || curvePt.cp1y !== 0);
        const hasCustomCp2 = nextCurvePt && (nextCurvePt.cp2x !== 0 || nextCurvePt.cp2y !== 0);

        ctx.strokeStyle = hasCustomCp1 ? 'rgba(255, 200, 50, 0.6)' : 'rgba(0, 255, 170, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(seg.cp1x, seg.cp1y); ctx.stroke();
        ctx.fillStyle = hasCustomCp1 ? 'rgba(255, 200, 50, 0.8)' : 'rgba(0, 255, 170, 0.6)';
        ctx.beginPath(); ctx.arc(seg.cp1x, seg.cp1y, hasCustomCp1 ? 5 : 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = hasCustomCp1 ? 'rgba(255, 200, 50, 1)' : 'rgba(0, 255, 170, 0.8)';
        ctx.lineWidth = 1; ctx.stroke();

        ctx.strokeStyle = hasCustomCp2 ? 'rgba(255, 200, 50, 0.6)' : 'rgba(0, 255, 170, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(seg.cp2x, seg.cp2y); ctx.stroke();
        ctx.fillStyle = hasCustomCp2 ? 'rgba(255, 200, 50, 0.8)' : 'rgba(0, 255, 170, 0.6)';
        ctx.beginPath(); ctx.arc(seg.cp2x, seg.cp2y, hasCustomCp2 ? 5 : 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = hasCustomCp2 ? 'rgba(255, 200, 50, 1)' : 'rgba(0, 255, 170, 0.8)';
        ctx.lineWidth = 1; ctx.stroke();
      }
    }

    ctx.restore();

    // Diamond markers at trajectory points
    for (const pt of screenPoints) {
      const isCurrentFrame = pt.frame === currentFrame;
      drawDiamond(ctx, pt.x, pt.y, isCurrentFrame ? 7 : 5, isCurrentFrame ? highlightColor : pointColor, '#ffffff');
      ctx.save();
      ctx.fillStyle = isCurrentFrame ? '#ffffff' : 'rgba(255,255,255,0.6)';
      ctx.font = `${isCurrentFrame ? 'bold ' : ''}10px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`F${pt.frame}`, pt.x, pt.y - (isCurrentFrame ? 7 : 5) - 4);
      if (isSelected && Math.abs(pt.rotation) > 0.1) {
        ctx.fillStyle = 'rgba(255,150,100,0.7)';
        ctx.fillText(`${Math.round(pt.rotation)}°`, pt.x, pt.y + (isCurrentFrame ? 7 : 5) + 12);
      }
      ctx.restore();
    }

    // Direction arrows
    if (isSelected && polylinePoints.length > 10) {
      ctx.save();
      ctx.fillStyle = curveColor;
      ctx.globalAlpha = 0.6;
      const arrowInterval = Math.floor(polylinePoints.length / 4);
      for (let a = arrowInterval; a < polylinePoints.length - 2; a += arrowInterval) {
        const pt = polylinePoints[a];
        const nextPt = polylinePoints[a + 2];
        if (!nextPt) continue;
        const angle = Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x);
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(4, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }
}
