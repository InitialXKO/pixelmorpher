// ============================================================
// PixelMorpher - 骨骼映射器（2D 端）
// 输入：双遍 ID 缓冲烘焙结果 → 按 bone 拆分 → 裁剪 → Node/Sprite/Character
// ============================================================

import type { TwoPassBakeData } from './threejs-baker-twopass';
import { medianCut, nearestPaletteIndex } from './threejs-baker';
import { rgbaToHexOrNull } from '../engine/utils';
import {
  pxToSub,
  createDefaultNode,
  createDefaultCostumePiece,
  type Character,
  type Node,
  type Sprite,
  type PixelGrid,
  type DirectionIndex,
  type Socket,
  type CostumePiece,
} from '../unified-types';

// ---- 处理后的单 bone 单方向 ----
export interface ProcessedBoneDirection {
  direction: DirectionIndex;
  grid: PixelGrid;
  width: number;
  height: number;
  /** 裁剪框在整图中的原点（top-down 像素） */
  cropX: number;
  cropY: number;
  /** 关节在整图中的像素（top-down） */
  jointX: number;
  jointY: number;
  /** 关节在裁剪图中的像素（= plug） */
  plugX: number;
  plugY: number;
}

export interface ProcessedBone {
  boneIndex: number;
  boneName: string;
  parentIndex: number | null;
  directions: ProcessedBoneDirection[]; // 有效方向（有像素的）
}

export interface SplitOptions {
  /** 裁剪 padding 系数，默认 1.35 */
  padding?: number;
  /** 最小裁剪边长，默认 10 */
  minCrop?: number;
  /** 调色板颜色数，默认 16 */
  paletteSize?: number;
}

/**
 * 按 bone ID 拆分双遍结果。
 * 每 bone 每方向：像素 = pass0(ID==bone) ∪ pass1(ID==bone)，完整无洞。
 * 裁剪：以关节为中心，半经 = max(关节到 bbox 各角距离) * padding。
 */
export function splitByBoneId(
  bake: TwoPassBakeData,
  opts: SplitOptions = {},
): Map<number, ProcessedBone> {
  const padding = opts.padding ?? 1.35;
  const minCrop = opts.minCrop ?? 10;
  const paletteSize = opts.paletteSize ?? 16;
  const W = bake.width;
  const H = bake.height;

  // 有效 bone 颜色表（用于解码容错）
  const validColors = new Map<string, number>();
  for (const b of bake.bones) {
    const v = b.index + 1;
    const r = v & 0xff, g = (v >> 8) & 0xff, bl = (v >> 16) & 0xff;
    validColors.set(`${r},${g},${bl}`, b.index);
  }
  const decodeRobust = (r: number, g: number, b: number): number => {
    const key = `${r},${g},${b}`;
    const exact = validColors.get(key);
    if (exact !== undefined) return exact;
    if (r === 0 && g === 0 && b === 0) return -1;
    // 边界混合像素：找最近的有效色
    let best = -1;
    let bestD = 40 * 40 * 3; // 阈值
    for (const [k, idx] of validColors) {
      const [vr, vg, vb] = k.split(',').map(Number);
      const d = (r - vr) ** 2 + (g - vg) ** 2 + (b - vb) ** 2;
      if (d < bestD) { bestD = d; best = idx; }
    }
    return best;
  };

  const result = new Map<number, ProcessedBone>();
  // boneIndex → ProcessedBone（累积 8 方向）
  // parentIndex 重映射到有效父 bone（合并后父级可能被并掉，如手指的父是另一节手指）
  const merge = bake.merge;
  for (const b of bake.bones) {
    let pIdx = b.parentIndex;
    if (merge && pIdx !== null && pIdx !== undefined) {
      const effP = merge.effectiveIndex[pIdx] ?? pIdx;
      const effSelf = merge.effectiveIndex[b.index] ?? b.index;
      // 有效父不能是自己（防环）；若父被并入自己，则视为无父（根）
      pIdx = effP === effSelf ? null : effP;
    }
    result.set(b.index, {
      boneIndex: b.index,
      boneName: b.name,
      parentIndex: pIdx,
      directions: [],
    });
  }

  for (let d = 0; d < 8; d++) {
    const front = bake.groups.find((g) => g.direction === d && g.pass === 0)!;
    const back = bake.groups.find((g) => g.direction === d && g.pass === 1)!;

    // 一遍扫描，按 bone 累积 mask + 颜色
    const perBone = new Map<number, { rgba: Uint8ClampedArray; mask: Uint8Array; count: number }>();
    for (let p = 0; p < W * H; p++) {
      const o = p * 4;
      let bi = decodeRobust(front.idPixels[o], front.idPixels[o + 1], front.idPixels[o + 2]);
      let src = front.colorPixels;
      if (bi < 0) {
        bi = decodeRobust(back.idPixels[o], back.idPixels[o + 1], back.idPixels[o + 2]);
        src = back.colorPixels;
      }
      if (bi < 0) continue;
      // 透明像素跳过（颜色无意义）
      if (src[o + 3] <= 8) continue;
      let e = perBone.get(bi);
      if (!e) {
        e = { rgba: new Uint8ClampedArray(W * H * 4), mask: new Uint8Array(W * H), count: 0 };
        perBone.set(bi, e);
      }
      e.mask[p] = 1;
      e.count++;
      e.rgba[o] = src[o];
      e.rgba[o + 1] = src[o + 1];
      e.rgba[o + 2] = src[o + 2];
      e.rgba[o + 3] = 255;
    }

    // 每 bone 裁剪
    for (const [bi, e] of perBone) {
      const bone = bake.bones[bi];
      const pb = result.get(bi)!;
      // bbox
      let minX = W, maxX = -1, minY = H, maxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (e.mask[y * W + x]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) continue; // 无像素
      const jx = bone.jointPixels[d].x;
      const jy = bone.jointPixels[d].y;
      // 以关节为中心的最大半经
      const hx = Math.max(Math.abs(minX - jx), Math.abs(maxX - jx), 1) * padding;
      const hy = Math.max(Math.abs(minY - jy), Math.abs(maxY - jy), 1) * padding;
      let half = Math.max(hx, hy, minCrop / 2);
      // clamp 到图内（保持关节居中，允许边缘截断）
      half = Math.min(half, Math.min(jx, jy, W - jx, H - jy, W / 2, H / 2));
      half = Math.max(half, 2);
      const x0 = Math.round(jx - half);
      const y0 = Math.round(jy - half);
      const cw = Math.round(half * 2);
      const ch = Math.round(half * 2);

      // 提取裁剪区
      const crop = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const sx = x0 + x, sy = y0 + y;
          const so = (sy * W + sx) * 4;
          const do_ = (y * cw + x) * 4;
          if (sx < 0 || sx >= W || sy < 0 || sy >= H || !e.mask[sy * W + sx]) {
            crop[do_ + 3] = 0;
            continue;
          }
          crop[do_] = e.rgba[so];
          crop[do_ + 1] = e.rgba[so + 1];
          crop[do_ + 2] = e.rgba[so + 2];
          crop[do_ + 3] = 255;
        }
      }

      // 量化
      const palette = medianCut(crop, paletteSize);
      const grid: PixelGrid = [];
      for (let y = 0; y < ch; y++) {
        const row: (string | null)[] = [];
        for (let x = 0; x < cw; x++) {
          const o = (y * cw + x) * 4;
          row.push(rgbaToHexOrNull(crop[o], crop[o + 1], crop[o + 2], crop[o + 3]));
        }
        grid.push(row);
      }
      // 量化后重写（保持 palette 一致性）——直接在 grid 上做
      if (palette.length > 0) {
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const c = grid[y][x];
            if (!c) continue;
            const r = parseInt(c.slice(1, 3), 16);
            const g = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            const idx = nearestPaletteIndex(r, g, b, palette);
            const p = palette[idx];
            const hex = '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
            grid[y][x] = hex;
          }
        }
      }

      const plugX = jx - x0;
      const plugY = jy - y0;
      pb.directions.push({
        direction: d as DirectionIndex,
        grid,
        width: cw,
        height: ch,
        cropX: x0,
        cropY: y0,
        jointX: jx,
        jointY: jy,
        plugX,
        plugY,
      });
    }
  }

  // 删掉 8 方向全空的 bone
  for (const [bi, pb] of [...result]) {
    if (pb.directions.length === 0) result.delete(bi);
  }
  return result;
}

// ---- Character 组装 ----

export interface MappedImport {
  character: Character;
  /** 全局精灵表条目 */
  sprites: Record<string, Sprite>;
  stats: { bones: number; nodes: number; sprites: number };
}

/** RGBA → PixelGrid（直接转 hex，不再量化；输入应已量化） */
export function rgbaToGrid(pixels: Uint8ClampedArray, width: number, height: number): PixelGrid {
  const grid: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      row.push(rgbaToHexOrNull(pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3]));
    }
    grid.push(row);
  }
  return grid;
}

/** PixelGrid 顺时针 90°（无损） */
function rotateGrid90CW(grid: PixelGrid): PixelGrid {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const out: PixelGrid = [];
  for (let x = 0; x < w; x++) {
    const row: (string | null)[] = [];
    for (let y = h - 1; y >= 0; y--) row.push(grid[y][x]);
    out.push(row);
  }
  return out;
}

/**
 * 将单肢体重烘的竖直 limb 图旋转对齐到原始姿态。
 * 竖直烘焙的 distal 恒朝图像下方（+y）；目标是原始姿态的 limb 方向（父关节→子关节）。
 * 只做最近 90° 的无损旋转（T-pose 下肢体非横即竖，足够）。
 * @param grid 以关节为中心的重烘图（关节在中心）
 * @param restDirX/restDirY 原始姿态 limb 方向（2D，父→子，top-down 像素坐标）
 */
export function alignLimbToRest(grid: PixelGrid, restDirX: number, restDirY: number): PixelGrid {
  const len = Math.hypot(restDirX, restDirY);
  if (len < 1e-6) return grid;
  // 目标角 − 当前角（当前 distal 朝 +y，即 90°）
  const theta = Math.atan2(restDirY, restDirX) - Math.PI / 2;
  const k = Math.round(theta / (Math.PI / 2));
  const steps = ((k % 4) + 4) % 4;
  let g = grid;
  for (let i = 0; i < steps; i++) g = rotateGrid90CW(g);
  return g;
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || 'bone';
}

/**
 * bone → Node 树 + Sprite 表。
 * - Node 世界位置 = 关节位置；sprite.plug = 裁剪图中的关节像素。
 * - 父 socket 偏移 = 子关节在父裁剪图中的投影 − 父 plug（逐方向）。
 */
export function mapBonesToNodes(
  processed: Map<number, ProcessedBone>,
  characterId: string,
  characterName: string,
): MappedImport {
  const nodes: Record<string, Node> = {};
  const sprites: Record<string, Sprite> = {};
  const pieces: Record<string, CostumePiece> = {};
  const nodeIdByBone = new Map<number, string>();

  // 先建所有 node（无层级）
  const sorted = [...processed.values()].sort((a, b) => a.boneIndex - b.boneIndex);
  for (const pb of sorted) {
    const nodeId = `node_${characterId}_${pb.boneIndex}`;
    nodeIdByBone.set(pb.boneIndex, nodeId);
  }

  // root = 第一个 parentIndex 为 null 的 bone
  let rootBone = sorted.find((p) => p.parentIndex === null) ?? sorted[0];
  const rootNodeId = nodeIdByBone.get(rootBone.boneIndex)!;

  for (const pb of sorted) {
    const nodeId = nodeIdByBone.get(pb.boneIndex)!;
    const isRoot = pb.boneIndex === rootBone.boneIndex;
    const node = createDefaultNode(nodeId, pb.boneName);
    node.parentId = isRoot ? undefined : nodeIdByBone.get(pb.parentIndex!);

    // children
    node.children = sorted
      .filter((c) => c.parentIndex === pb.boneIndex)
      .map((c) => nodeIdByBone.get(c.boneIndex)!);

    // attachment：plug 用方向 0 的（各方向 sprite.plug 自己带）
    const d0 = pb.directions.find((d) => d.direction === 0) ?? pb.directions[0];
    if (isRoot) {
      node.attachment = { type: 'fixed', fixedOffset: { x: 0, y: 0 } };
    } else {
      const parentPb = processed.get(pb.parentIndex!);
      const socketId = `sock_${characterId}_${pb.parentIndex}_${pb.boneIndex}`;
      node.attachment = {
        type: 'socket',
        parentSocketId: socketId,
        plug: { x: pxToSub(d0.plugX), y: pxToSub(d0.plugY) },
      };
      void parentPb;
    }

    // slot + 8 方向 sprites
    const slotKey = `slot_${characterId}_${pb.boneIndex}`;
    const piece = createDefaultCostumePiece(slotKey, '#ffffff');
    for (const dir of pb.directions) {
      const spriteId = `spr_${characterId}_${pb.boneIndex}_${dir.direction}`;
      const sprite: Sprite = {
        id: spriteId,
        name: `${pb.boneName} d${dir.direction}`,
        width: dir.width,
        height: dir.height,
        data: dir.grid,
        plug: { x: pxToSub(dir.plugX), y: pxToSub(dir.plugY) },
      };
      sprites[spriteId] = sprite;
      piece.sprites[dir.direction] = { spriteId };
    }
    pieces[slotKey] = piece;
    node.slot = piece;

    nodes[nodeId] = node;
  }

  // 父 socket：子关节 − 父关节（全帧 2D 坐标，与裁剪框无关；重烘不改变关节几何）
  for (const pb of sorted) {
    if (pb.parentIndex === null || pb.boneIndex === rootBone.boneIndex) continue;
    const parentPb = processed.get(pb.parentIndex);
    if (!parentPb) continue;
    const parentNode = nodes[nodeIdByBone.get(pb.parentIndex)!];
    const socketId = `sock_${characterId}_${pb.parentIndex}_${pb.boneIndex}`;
    const socket: Socket = {
      id: socketId,
      name: pb.boneName,
      basePosition: { x: 0, y: 0 },
      directionOffsets: {},
    };
    for (const pdir of parentPb.directions) {
      const d = pdir.direction;
      const cdir = pb.directions.find((x) => x.direction === d);
      if (!cdir) continue;
      // 注意 Y 轴：烘焙图是 top-down，2D 世界 Y 向下；SubPixel 同样向下为正，直接相减即可
      const ox = cdir.jointX - pdir.jointX;
      const oy = cdir.jointY - pdir.jointY;
      const off = { x: pxToSub(ox), y: pxToSub(oy) };
      if (d === 0) socket.basePosition = off;
      socket.directionOffsets[d] = off;
    }
    parentNode.sockets.push(socket);
  }

  // zIndex：层级越深越大（子画在父上）
  const depthOf = (bi: number): number => {
    let d = 0;
    let cur = processed.get(bi);
    while (cur && cur.parentIndex !== null && processed.has(cur.parentIndex)) {
      d++;
      cur = processed.get(cur.parentIndex);
    }
    return d;
  };
  for (const pb of sorted) {
    nodes[nodeIdByBone.get(pb.boneIndex)!].zIndex = depthOf(pb.boneIndex);
  }

  const csId = `cs_${characterId}_bake`;
  const character: Character = {
    id: characterId,
    name: characterName,
    rootNodeId,
    nodes,
    costumeSets: [{ id: csId, name: 'Baked', pieces }],
    activeCostumeSetId: csId,
    directionDrawOrders: {},
    latitude: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return {
    character,
    sprites,
    stats: {
      bones: sorted.length,
      nodes: sorted.length,
      sprites: Object.keys(sprites).length,
    },
  };
}
