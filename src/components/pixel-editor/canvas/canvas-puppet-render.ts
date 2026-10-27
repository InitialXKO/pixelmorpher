/**
 * canvas-puppet-render.ts — Character skeleton overlay rendering for PixelCanvas.
 * Migrated from Puppet model to new Character model.
 * Extracted from the main render function to keep file sizes manageable.
 */

import { computeSpriteEndPoint, spritePivotX, spritePivotY } from './canvas-utils';
import type { RenderContext } from './canvas-render-helpers';
import type { Character, Node } from '@/lib/unified-types';
import { pxToSub, subToPx, projectToView, rotateInViewPlane, resolveChainTarget3D, applyFrameRotation } from '@/lib/unified-types';
import { computeWorldTransforms, socketOffsetTo3D, geometryDirectionFromToggle, resolveNodeSpriteId, clampAnchorPoints } from '@/lib/unified-render';
import { peekClampFrozen } from '@/lib/clamp-session';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { DEFAULT_FACE_FEATURES, faceFeaturePoints, faceHalfWidths } from '@/lib/face-features';

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
  const geoDir = geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D);
  const worldTransforms = computeWorldTransforms(character, rc.currentFrame, rc.canvasWidth, rc.canvasHeight, undefined, undefined, undefined, undefined, geoDir);
  ctx.save();
  for (const chain of chains) {
    // 填充/解析按链根关节朝向（target 是该朝向画布平面上的点）；手柄绘制仍按末关节朝向投影
    const rootDir = geoDir ?? worldTransforms.get(chain.rootNodeId)?.variantIndex ?? 6;
    const t3 = resolveChainTarget3D(chain, rc.canvasWidth, rc.canvasHeight, rootDir);
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

/**
 * 钳制锚定 gizmo：触发几何（高度线/目标点/范围）+ 指定点当帧结算位
 * （空心）+ 冻结位（实心，生效时琥珀色）与两者连线。冻结位读会话层
 * 最近一次步进状态（peekClampFrozen），与主画布同源。
 */
export function renderClampAnchorGizmos(
  rc: { ctx: CanvasRenderingContext2D; canvasWidth: number; canvasHeight: number; zoom: number; panX: number; panY: number; currentFrame: number },
  character: Character,
): void {
  const anchors = character.clampAnchors?.filter((a) => a.enabled);
  if (!anchors || anchors.length === 0) return;
  const { ctx, zoom, panX, panY } = rc;
  const geoDir = geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D);
  const worldTransforms = computeWorldTransforms(character, rc.currentFrame, rc.canvasWidth, rc.canvasHeight, undefined, undefined, undefined, undefined, geoDir);
  const rootDir = geoDir ?? worldTransforms.get(character.rootNodeId)?.variantIndex ?? 6;
  const sprites = useProjectStore.getState().sprites ?? {};
  const frozen = peekClampFrozen(character.id);
  const toScreen = (x: number, y: number, z: number) => {
    const proj = projectToView(pxToSub(x), pxToSub(y), pxToSub(z), rootDir);
    return {
      x: panX + (rc.canvasWidth / 2 + subToPx(proj.canvasX)) * zoom,
      y: panY + (rc.canvasHeight / 2 + subToPx(proj.canvasY)) * zoom,
    };
  };
  ctx.save();
  ctx.font = '10px sans-serif';
  for (const anchor of anchors) {
    const settled = clampAnchorPoints(character, worldTransforms, anchor, sprites);
    const froz = frozen?.get(anchor.id);
    const engaged = !!froz;
    const main = engaged ? '#f59e0b' : '#38bdf8';
    // ---- 触发几何 ----
    ctx.strokeStyle = engaged ? 'rgba(245,158,11,0.85)' : 'rgba(56,189,248,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    const t = anchor.trigger;
    if (t.kind === 'height') {
      const a = toScreen(-rc.canvasWidth / 2, t.y, settled?.points[0].z ?? 0);
      const b = toScreen(rc.canvasWidth / 2, t.y, settled?.points[0].z ?? 0);
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(rc.canvasWidth, b.y); ctx.stroke();
    } else if (t.kind === 'point') {
      const c = toScreen(t.target.x, t.target.y, t.target.z);
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, t.radius * zoom), 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, 2, 0, Math.PI * 2); ctx.stroke();
    } else if (t.kind === 'range') {
      if (t.shape === 'rect' && t.rect) {
        const z = settled?.points[0].z ?? 0;
        const c1 = toScreen(t.rect.x, t.rect.y, z);
        const c2 = toScreen(t.rect.x + t.rect.w, t.rect.y + t.rect.h, z);
        ctx.strokeRect(Math.min(c1.x, c2.x), Math.min(c1.y, c2.y), Math.abs(c2.x - c1.x), Math.abs(c2.y - c1.y));
      } else if (t.shape === 'circle' && t.circle) {
        const c = toScreen(t.circle.x, t.circle.y, settled?.points[0].z ?? 0);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, t.circle.r * zoom), 0, Math.PI * 2); ctx.stroke();
      }
    } else if (t.kind === 'scene') {
      // scene 触发不在主画布呈示几何（裁决 4：去程序化预览面板看）
    }
    ctx.setLineDash([]);
    // ---- 指定点：结算位空心、冻结位实心、连线 ----
    if (settled) {
      settled.points.forEach((p, i) => {
        const sp = toScreen(p.x, p.y, p.z);
        ctx.strokeStyle = main;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.stroke();
        const fp = froz?.points[i];
        if (fp) {
          const fs = toScreen(fp.x, fp.y, fp.z);
          ctx.strokeStyle = 'rgba(245,158,11,0.7)';
          ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(fs.x, fs.y); ctx.stroke();
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath(); ctx.arc(fs.x, fs.y, 3.5, 0, Math.PI * 2); ctx.fill();
        }
      });
      const label = toScreen(settled.points[0].x, settled.points[0].y, settled.points[0].z);
      ctx.fillStyle = main;
      ctx.fillText(engaged ? `⚓ ${anchor.name}` : anchor.name, label.x + 8, label.y - 8);
    }
  }
  ctx.restore();
}

/**
 * 五官参照叠画：选中节点（带 faceFeatures 或 faceTurn）头部框 + 点位线段。
 * 头部框 = 该节点当前精灵的绘制框（原点 + plug 反推中心，随世界角旋转）；
 * 点位按 node.faceFeatures（缺省标准三庭）+ node.faceTurn 现算转面压缩。
 */
export function renderFaceGuideOverlay(
  rc: { ctx: CanvasRenderingContext2D; canvasWidth: number; canvasHeight: number; zoom: number; panX: number; panY: number; currentFrame: number },
  character: Character,
  nodeId: string | null,
): void {
  if (!nodeId) return;
  const node = character.nodes[nodeId];
  if (!node || (!node.faceFeatures && !node.faceTurn)) return;
  const { ctx, zoom, panX, panY } = rc;
  const geoDir = geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D);
  const worldTransforms = computeWorldTransforms(character, rc.currentFrame, rc.canvasWidth, rc.canvasHeight, undefined, undefined, undefined, undefined, geoDir);
  const wt = worldTransforms.get(nodeId);
  if (!wt) return;
  const rootNode = character.nodes[character.rootNodeId];
  const dir = (rootNode?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const sprites = useProjectStore.getState().sprites ?? {};
  const spriteId = resolveNodeSpriteId(character, nodeId, dir, sprites);
  const sprite = spriteId ? sprites[spriteId] : undefined;
  if (!sprite) return;

  // 局部偏移（精灵像素空间）→ 世界 → 投影 → 屏幕（与主渲染同口径）
  const projWorld = (lx: number, ly: number) => {
    const r = applyFrameRotation(wt.worldFrame, lx, ly, 0, dir);
    const p = projectToView(
      (wt.worldX + pxToSub(r.x)) as import('@/lib/unified-types').SubPixel,
      (wt.worldY + pxToSub(r.y)) as import('@/lib/unified-types').SubPixel,
      (wt.worldZ + pxToSub(r.z)) as import('@/lib/unified-types').SubPixel,
      dir,
    );
    return {
      x: panX + (rc.canvasWidth / 2 + subToPx(p.canvasX)) * zoom,
      y: panY + (rc.canvasHeight / 2 + subToPx(p.canvasY)) * zoom,
    };
  };
  const plugX = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
  const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  const bw = sprite.width, bh = sprite.height;
  // 精灵框四角在精灵像素空间以 plug 为原点：左上 = (−plugX, −plugY)
  const toScreen = (fx: number, fy: number) => projWorld(fx * bw - plugX, fy * bh - plugY);

  const fp = node.faceFeatures ?? DEFAULT_FACE_FEATURES;
  const yaw = node.faceTurn?.yaw ?? 0;
  const pitch = node.faceTurn?.pitch ?? 0;
  const pts = faceFeaturePoints(fp, yaw, pitch);
  const hw = faceHalfWidths(fp, yaw);

  ctx.save();
  // 头部框
  ctx.strokeStyle = 'rgba(148,163,184,0.75)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  const c00 = toScreen(0, 0), c10 = toScreen(1, 0), c11 = toScreen(1, 1), c01 = toScreen(0, 1);
  ctx.moveTo(c00.x, c00.y); ctx.lineTo(c10.x, c10.y); ctx.lineTo(c11.x, c11.y); ctx.lineTo(c01.x, c01.y); ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  // 点位线段
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  const segDraw = (p: { x: number; y: number }, halfW: number) => {
    const a = toScreen(p.x - halfW, p.y), b = toScreen(p.x + halfW, p.y);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = toScreen(p.x, p.y);
    ctx.beginPath(); ctx.arc(c.x, c.y, 2, 0, Math.PI * 2); ctx.fillStyle = '#22d3ee'; ctx.fill();
  };
  segDraw(pts.browL, hw.eye * 0.8); segDraw(pts.browR, hw.eye * 0.8);
  segDraw(pts.eyeL, hw.eye); segDraw(pts.eyeR, hw.eye);
  segDraw(pts.noseBase, hw.nose);
  segDraw(pts.mouth, hw.mouth);
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
    const worldTransforms = computeWorldTransforms(character, currentFrame, canvasWidth, canvasHeight, undefined, undefined, undefined, undefined, geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D));
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
