// ============================================================
// 堆叠挂载：把六部件烘焙产出的部件切片（角色空间）挂到映射后
// 角色的服装件上。
//
// 关键变换：切片的 origin/axis/u/v 在角色空间（全局像素），
// SpriteStack 要的是宿主节点局部坐标。用渲染端自己的
// computeWorldTransforms 在静止帧算出宿主节点的世界帧与位置，
// 以其逆（旋转转置）把点与方向变进节点局部——与呈现端严格
// 同源，mapper 的各种规范化（臂链拉直等）自动一致，不另算一份。
// 层图落全局精灵表：一摞一夹（folder = 堆叠/<部件>），出生标签
// origin 只在此时写（烘焙来源），复用不追加（精灵管理定案）。
// ============================================================

import {
  mat3Apply,
  mat3Transpose,
  pxToSub,
  subToPx,
  worldToViewBasis,
  type Character,
  type PixelGrid,
  type Sprite,
  type SpriteStack,
} from '../unified-types';
import { computeWorldTransforms } from '../unified-render';
import { rgbaToHexOrNull } from '../engine/utils';
import type { PartStackSlice } from './threejs-baker-sixpart';
import type { PartName } from './bone-topology';

const PART_LABEL: Partial<Record<PartName, string>> = {
  head: '头',
  torso: '躯干',
  armL: '左臂',
  armR: '右臂',
  legL: '左腿',
  legR: '右腿',
  tail: '尾',
  props: '道具',
};

/** RGBA 字节流 → PixelGrid（与普通烘焙精灵同一转换口径） */
function rgbaToGrid(rgba: Uint8ClampedArray, w: number, h: number): PixelGrid {
  const grid: PixelGrid = [];
  for (let y = 0; y < h; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      row.push(rgbaToHexOrNull(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!));
    }
    grid.push(row);
  }
  return grid;
}

/**
 * 把部件切片挂到角色。直接修改传入的 character 与 sprites
 * （调用方在一次性写入 store 之前调用）。返回成功挂载的部件数
 * 与层图总数；宿主节点/服装件缺失的部件跳过并计数于 skipped。
 */
export function attachPartStacks(
  character: Character,
  sprites: Record<string, Sprite>,
  partStacks: Map<PartName, PartStackSlice>,
  characterId: string,
  characterName: string,
): { attached: number; layerSprites: number; skipped: number } {
  const activeSet =
    character.costumeSets?.find((cs) => cs.id === character.activeCostumeSetId) ??
    character.costumeSets?.[0];
  if (!activeSet) return { attached: 0, layerSprites: 0, skipped: partStacks.size };

  // 静止帧世界变换（帧 0、变换归零 = mapper 的静止姿态）
  const worldTransforms = computeWorldTransforms(character, 0, 1024, 1024);

  let attached = 0;
  let layerSprites = 0;
  let skipped = 0;
  for (const [part, entry] of partStacks) {
    const hostNodeId = `node_${characterId}_${entry.rootBoneIndex}`;
    const node = character.nodes[hostNodeId];
    const piece = node?.slot ? activeSet.pieces[node.slot.slotKey] : undefined;
    const wt = worldTransforms.get(hostNodeId);
    if (!node || !piece || !wt) { skipped++; continue; }

    const dir = wt.variantIndex;
    const inv = mat3Transpose(wt.worldFrame);
    // 角色空间点 → 节点局部：先到朝向基坐标、减节点位置、再逆帧旋转
    const nodeBasis = worldToViewBasis(subToPx(wt.worldX), subToPx(wt.worldY), subToPx(wt.worldZ), dir);
    const toLocalPoint = (p: { x: number; y: number; z: number }) => {
      const b = worldToViewBasis(p.x, p.y, p.z, dir);
      const r = mat3Apply(inv, b.h - nodeBasis.h, b.y - nodeBasis.y, b.d - nodeBasis.d);
      return { x: r.h, y: r.y, z: r.d };
    };
    const toLocalDir = (p: { x: number; y: number; z: number }) => {
      const b = worldToViewBasis(p.x, p.y, p.z, dir);
      const r = mat3Apply(inv, b.h, b.y, b.d);
      const v = { x: r.h, y: r.y, z: r.d };
      const l = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    };

    const label = PART_LABEL[part] ?? part;
    const layerSpriteIds: string[] = [];
    entry.sliced.layers.forEach((layer, k) => {
      const id = `spr_stack_${characterId}_${part}_${k}`;
      const sprite: Sprite = {
        id,
        name: `${characterName}_${label}_层${k}`,
        width: layer.width,
        height: layer.height,
        data: rgbaToGrid(layer.rgba, layer.width, layer.height),
        plug: { x: pxToSub(layer.plugX), y: pxToSub(layer.plugY) },
        folder: `堆叠/${label}`,
        origin: { characterId, boneName: entry.rootBoneName },
      };
      sprites[id] = sprite;
      layerSpriteIds.push(id);
      layerSprites++;
    });

    const stack: SpriteStack = {
      layerSpriteIds,
      layerThickness: entry.sliced.layerThickness,
      origin: toLocalPoint(entry.sliced.origin),
      axis: toLocalDir(entry.sliced.axis),
      uAxis: toLocalDir(entry.sliced.uAxis),
      vAxis: toLocalDir(entry.sliced.vAxis),
    };
    piece.stack = stack;
    attached++;
  }
  return { attached, layerSprites, skipped };
}
