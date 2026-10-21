// ============================================================
// PixelMorpher - 蒙皮快照捕获
// 把子节点与父节点在当前帧姿态下合并渲染成一张精灵（冻结姿态），
// 之后子节点旋转时对合并精灵网格弯曲（见 skin/mesh-skin 的
// applySnapshotBend 与 unified-render 的快照认领）。
// 姿态口径：interpolateNodeKeyframes（动画面板读数同源）写入克隆
// 角色后走 generateRenderPlan + executeRenderPlan 只渲父/子两节点。
// 仅浏览器环境（需要 Canvas）。
// ============================================================

import type { Character, Sprite, SkinningSnapshot, DirectionIndex } from '../unified-types';
import { pxToSub, subToPx } from '../unified-types';
import { generateRenderPlan, executeRenderPlan, computeWorldTransforms } from '../unified-render';
import { interpolateNodeKeyframes } from '../engine/render-helpers/puppet-keyframe-interpolation';
import { rgbaToHexOrNull } from '../engine/utils';

export interface SkinningCaptureResult {
  sprite: Sprite;
  snapshot: SkinningSnapshot;
}

function norm180(a: number): number {
  let r = a;
  while (r > 180) r -= 360;
  while (r < -180) r += 360;
  return r;
}

/**
 * 捕获蒙皮快照。失败（无父节点/无像素/非浏览器）返回 null。
 * 注意：捕获会把合并精灵作为新精灵返回，调用方负责写入全局精灵表
 * 并把 snapshot 写回节点 attachment.skinningSnapshot。
 */
export function captureSkinningSnapshot(
  character: Character,
  nodeId: string,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  globalSprites: Record<string, Sprite>,
): SkinningCaptureResult | null {
  if (typeof document === 'undefined') return null;
  const node = character.nodes[nodeId];
  if (!node || node.attachment?.type !== 'socket' || !node.parentId) return null;
  const parent = character.nodes[node.parentId];
  if (!parent) return null;

  // 克隆 + 当前帧姿态（关键帧插值写入 transform，与面板读数同源）
  const clone: Character = JSON.parse(JSON.stringify(character));
  const interpolated = interpolateNodeKeyframes(character, frame);
  for (const n of Object.values(clone.nodes)) {
    const iv = interpolated.get(n.id);
    if (!iv) continue;
    if (typeof iv.angle === 'number') n.transform.angle = iv.angle;
    if (typeof iv.stretch === 'number') n.transform.stretch = iv.stretch;
    if (typeof iv.x === 'number') n.transform.x = iv.x;
    if (typeof iv.y === 'number') n.transform.y = iv.y;
    if (typeof (iv as { tilt?: number }).tilt === 'number') n.transform.tilt = (iv as { tilt?: number }).tilt;
  }
  // 只渲父/子与父的祖先链；清掉一切既有快照与关节盘（渲原始双精灵）
  const keep = new Set<string>([nodeId, parent.id]);
  let anc = parent.parentId ? clone.nodes[parent.parentId] : undefined;
  while (anc) {
    keep.add(anc.id);
    anc = anc.parentId ? clone.nodes[anc.parentId] : undefined;
  }
  for (const n of Object.values(clone.nodes)) {
    if (!keep.has(n.id)) n.visible = false;
    if (n.attachment) {
      n.attachment = { ...n.attachment, skinningSnapshot: undefined };
    }
  }
  const cloneChild = clone.nodes[nodeId];
  if (cloneChild.attachment) {
    cloneChild.attachment = { ...cloneChild.attachment, autoJointDisc: false };
  }

  const plan = generateRenderPlan(
    clone, frame, canvasWidth, canvasHeight,
    'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    globalSprites,
  );
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
  const img = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;

  // 裁剪到不透明包围盒
  let minX = canvasWidth, maxX = -1, minY = canvasHeight, maxY = -1;
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      if (img[(y * canvasWidth + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const grid: (string | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < w; x++) {
      const o = ((minY + y) * canvasWidth + (minX + x)) * 4;
      row.push(rgbaToHexOrNull(img[o], img[o + 1], img[o + 2], img[o + 3]));
    }
    grid.push(row);
  }

  // 关节画布位置 = 子节点指令的 worldX/worldY（sprite.plug 落点，同渲染口径）
  const childInstr = plan.nodeInstructions.find((i) => i.nodeId === nodeId);
  if (!childInstr) return null;
  const jointCanvasX = subToPx(childInstr.worldX);
  const jointCanvasY = subToPx(childInstr.worldY);
  const jointX = jointCanvasX - minX;
  const jointY = jointCanvasY - minY;

  // 角度与朝向（克隆的当前帧世界变换）
  const worldTransforms = computeWorldTransforms(clone, frame, canvasWidth, canvasHeight);
  const childWt = worldTransforms.get(nodeId);
  const parentWt = worldTransforms.get(parent.id);
  const rootWt = worldTransforms.get(clone.rootNodeId);
  if (!childWt || !parentWt) return null;
  const baseAngle = norm180(childWt.worldAngle - parentWt.worldAngle);
  const thC = (childWt.worldAngle * Math.PI) / 180;
  const spriteId = `spr_skin_${nodeId}_${Date.now()}`;
  const sprite: Sprite = {
    id: spriteId,
    name: `蒙皮快照 ${node.name}`,
    width: w,
    height: h,
    data: grid,
    plug: { x: pxToSub(jointX), y: pxToSub(jointY) },
  };
  const snapshot: SkinningSnapshot = {
    spriteId,
    frame,
    direction: (rootWt?.variantIndex ?? 0) as DirectionIndex,
    baseAngle,
    parentBaseAngle: parentWt.worldAngle,
    // 子肢体轴向 = 子局部 +Y 轴（骨骼主轴）在画布系的指向（y-down 旋转）
    axisX: -Math.sin(thC),
    axisY: Math.cos(thC),
    radius: 12,
    curve: 'smoothstep',
  };
  return { sprite, snapshot };
}
