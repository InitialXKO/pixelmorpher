// ============================================================
// 堆叠挂载：把六部件烘焙产出的肢体切片（角色空间，一骨一摞）挂
// 到映射后角色对应骨骼节点的服装件上——宿主就是这节肢体自己的
// 节点，与 2D 拆分出的肢体 1:1 对齐（六部件只是烘焙分组）。
//
// 局部口径（关键）：SpriteStack 的局部坐标与子节点 socket 的
// offset3D 同一待遇——以宿主关节为原点、角色空间分量直接作局部
// 分量，呈现端用节点当帧世界帧施加。于是静止帧的姿态规范化
// （垂臂摆回的肩 ∓90° 等）与动画都自动跟随，与平面精灵、子关节
// 落点严格同源。此前用静止帧世界帧求逆换算：摆回角在挂载时被
// 抵消、呈现时又只按当帧帧施加，摞停留在烘焙垂下姿态，与已经
// 摆回的节点/子关节脱节（手臂精灵与节点对不上），已废。
// 层图落全局精灵表：一摞一夹（folder = 堆叠/<骨骼名>），出生标签
// origin 只在此时写（烘焙来源），复用不追加（精灵管理定案）。
// ============================================================

import {
  pxToSub,
  type Character,
  type PixelGrid,
  type Sprite,
  type SpriteStack,
} from '../unified-types';
import { rgbaToHexOrNull } from '../engine/utils';
import type { PartStackSlice } from './threejs-baker-sixpart';

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
 * 把肢体切片挂到角色。直接修改传入的 character 与 sprites
 * （调用方在一次性写入 store 之前调用）。返回成功挂载的肢体数
 * 与层图总数；宿主节点/服装件缺失的肢体跳过并计数于 skipped。
 */
export function attachBoneStacks(
  character: Character,
  sprites: Record<string, Sprite>,
  boneStacks: Map<number, PartStackSlice>,
  characterId: string,
  characterName: string,
): { attached: number; layerSprites: number; skipped: number } {
  const activeSet =
    character.costumeSets?.find((cs) => cs.id === character.activeCostumeSetId) ??
    character.costumeSets?.[0];
  if (!activeSet) return { attached: 0, layerSprites: 0, skipped: boneStacks.size };

  let attached = 0;
  let layerSprites = 0;
  let skipped = 0;
  for (const [boneIndex, entry] of boneStacks) {
    const hostNodeId = `node_${characterId}_${entry.rootBoneIndex}`;
    const node = character.nodes[hostNodeId];
    const piece = node?.slot ? activeSet.pieces[node.slot.slotKey] : undefined;
    if (!node || !piece) { skipped++; continue; }

    // 关节为原点：切片原点（根侧端面中心）相对关节的偏移即局部原点；
    // 轴向/u/v 的角色空间分量直接作局部分量（见文件头口径）
    const unit = (v: { x: number; y: number; z: number }) => {
      const l = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    };
    const originLocal = {
      x: entry.sliced.origin.x - entry.jointChar.x,
      y: entry.sliced.origin.y - entry.jointChar.y,
      z: entry.sliced.origin.z - entry.jointChar.z,
    };

    const label = entry.rootBoneName;
    const layerSpriteIds: string[] = [];
    entry.sliced.layers.forEach((layer, k) => {
      const id = `spr_stack_${characterId}_b${boneIndex}_${k}`;
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
      origin: originLocal,
      axis: unit(entry.sliced.axis),
      uAxis: unit(entry.sliced.uAxis),
      vAxis: unit(entry.sliced.vAxis),
    };
    piece.stack = stack;
    attached++;
  }
  return { attached, layerSprites, skipped };
}
