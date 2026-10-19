// ============================================================
// PixelMorpher - 骨骼映射器（2D 端）
// 输入：双遍 ID 缓冲烘焙结果 → 按 bone 拆分 → 裁剪 → Node/Sprite/Character
// ============================================================

import type { TwoPassBakeData } from './threejs-baker-twopass';
import { decodeBoneMask } from './threejs-baker-twopass';
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
  /** 关节在整图中的像素（top-down，未归一化） */
  jointX: number;
  jointY: number;
  /** 关节在裁剪图中的像素（= plug，已 ×cameraHalf 归一化） */
  plugX: number;
  plugY: number;
  /** 相机半宽（归一化系数），用于跨部件 joint 坐标统一尺度 */
  cameraHalf: number;
}

export interface ProcessedBone {
  boneIndex: number;
  boneName: string;
  parentIndex: number | null;
  directions: ProcessedBoneDirection[]; // 有效方向（有像素的）
  /** 3D 关节坐标（归一化模型空间，用于 3D 节点位置） */
  joint3D?: { x: number; y: number; z: number };
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

  // 位掩码解码：compact 紧凑索引 → 合并后全局 bone
  // （与 threejs-baker-twopass.ts assignBoneVertexColors 的 compact 映射一致：排序保证顺序相同）
  const effSet = new Set<number>();
  const merge0 = bake.merge;
  for (const b of bake.bones) effSet.add(merge0 ? (merge0.effectiveIndex[b.index] ?? b.index) : b.index);
  const effList = [...effSet].sort((a, b) => a - b);
  // 返回合并后全局 bone index 列表（[] = 背景）
  const decodeBones = (r: number, g: number, b: number): number[] => {
    const out: number[] = [];
    for (const ci of decodeBoneMask(r, g, b)) {
      const gi = effList[ci];
      if (gi !== undefined) out.push(gi);
    }
    return out;
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
      joint3D: b.joint3D,
    });
  }

  for (let d = 0; d < 8; d++) {
    const front = bake.groups.find((g) => g.direction === d && g.pass === 0)!;
    const back = bake.groups.find((g) => g.direction === d && g.pass === 1)!;

    // 一遍扫描，按 bone 累积 mask + 颜色（位掩码：像素同时归属多个 bones）
    const perBone = new Map<number, { rgba: Uint8ClampedArray; mask: Uint8Array; count: number }>();
    const addPixel = (bi0: number, src: Uint8ClampedArray, o: number, p: number) => {
      let bi = bi0;
      // 合并映射（幂等：ID 已是合并后索引）
      if (merge) bi = merge.effectiveIndex[bi] ?? bi;
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
    };
    for (let p = 0; p < W * H; p++) {
      const o = p * 4;
      let bones = decodeBones(front.idPixels[o], front.idPixels[o + 1], front.idPixels[o + 2]);
      let src = front.colorPixels;
      if (bones.length === 0) {
        bones = decodeBones(back.idPixels[o], back.idPixels[o + 1], back.idPixels[o + 2]);
        src = back.colorPixels;
      }
      if (bones.length === 0) continue;
      // 透明像素跳过（颜色无意义）
      if (src[o + 3] <= 8) continue;
      for (const bi of bones) addPixel(bi, src, o, p);
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
      // 紧包围盒裁剪（+2px padding），plug 存偏移
      const pad2 = 2;
      let x0 = Math.max(0, Math.floor(minX - pad2));
      let y0 = Math.max(0, Math.floor(minY - pad2));
      let x1 = Math.min(W, Math.ceil(maxX + pad2));
      let y1 = Math.min(H, Math.ceil(maxY + pad2));
      // 确保关节在裁剪框内
      x0 = Math.min(x0, Math.floor(jx));
      y0 = Math.min(y0, Math.floor(jy));
      x1 = Math.max(x1, Math.ceil(jx) + 1);
      y1 = Math.max(y1, Math.ceil(jy) + 1);
      const cw = x1 - x0;
      const ch = y1 - y0;

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
        cameraHalf: 1,
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

    // 3D 位置：X/Y 由 socket 承担（2D 烘焙像素尺度，与精灵对齐），
    // 节点 transform 只保留 Z（深度），避免 X/Y 双重计数导致错位。
    // （六部件各部件相机尺度不一，joint3D 整模归一化无法与 socket 对齐，故 X/Y 必须走 socket）
    if (!isRoot && pb.joint3D) {
      const parentPb = processed.get(pb.parentIndex!);
      const pj = parentPb?.joint3D;
      if (pj) {
        node.transform.x = 0;
        node.transform.y = 0;
        node.transform.z = pxToSub((pb.joint3D.z - pj.z) * 64);
      }
    }
    // 根节点 transform 保持 (0,0,0)

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
      // 注意 Y 轴：烘焙图是 top-down，2D 世界 Y 向下；SubPixel 同样向下为正
      // 跨部件归一化：jointX/Y 是各部件独立相机下的像素，需 ×cameraHalf 统一到整模尺度再相减
      const ox = cdir.jointX * cdir.cameraHalf - pdir.jointX * pdir.cameraHalf;
      const oy = cdir.jointY * cdir.cameraHalf - pdir.jointY * pdir.cameraHalf;
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

// ---- 六部件 2D 拆分 ----

import type { SixPartBakeData } from './threejs-baker-sixpart';
import { ALL_PARTS } from './threejs-baker-sixpart';

/**
 * 按六部件的块内 ID 拆分。
 * 每部件每方向：读块内 ID（局部）→ 映射到全局 bone → 累积像素 → 裁剪。
 * 输出与 splitByBoneId 同格式（ProcessedBone），下游 mapBonesToNodes 不用改。
 */
export function splitSixParts(
  bake: SixPartBakeData,
  opts: SplitOptions = {},
): Map<number, ProcessedBone> {
  const padding = opts.padding ?? 1.35;
  const minCrop = opts.minCrop ?? 10;
  const paletteSize = opts.paletteSize ?? 16;
  const W = bake.width;
  const H = bake.height;

  const result = new Map<number, ProcessedBone>();
  const merge = bake.merge;
  for (const b of bake.bones) {
    let pIdx = b.parentIndex;
    if (merge && pIdx !== null && pIdx !== undefined) {
      const effP = merge.effectiveIndex[pIdx] ?? pIdx;
      const effSelf = merge.effectiveIndex[b.index] ?? b.index;
      pIdx = effP === effSelf ? null : effP;
    }
    result.set(b.index, {
      boneIndex: b.index,
      boneName: b.name,
      parentIndex: pIdx,
      directions: [],
      joint3D: b.joint3D,
    });
  }

  for (const part of ALL_PARTS) {
    const localToGlobal = bake.partBoneMap[part];
    if (!localToGlobal || localToGlobal.length === 0) continue;
    // 位掩码解码：局部索引位 → 全局 bone（[] = 背景）
    const decodeBones = (r: number, g: number, b: number): number[] => {
      const out: number[] = [];
      for (const li of decodeBoneMask(r, g, b)) {
        const gi = localToGlobal[li];
        if (gi !== undefined) out.push(gi);
      }
      return out;
    };

    for (let d = 0; d < 8; d++) {
      const g = bake.groups.find((x) => x.part === part && x.direction === d);
      if (!g) continue;
      const perBone = new Map<number, { rgba: Uint8ClampedArray; mask: Uint8Array; count: number }>();
      const addPixel = (bi0: number, o: number, p: number) => {
        let bi = bi0;
        // 合并映射：手指等并入手
        if (merge) bi = merge.effectiveIndex[bi] ?? bi;
        let e = perBone.get(bi);
        if (!e) {
          e = { rgba: new Uint8ClampedArray(W * H * 4), mask: new Uint8Array(W * H), count: 0 };
          perBone.set(bi, e);
        }
        e.mask[p] = 1;
        e.count++;
        e.rgba[o] = g.colorPixels[o];
        e.rgba[o + 1] = g.colorPixels[o + 1];
        e.rgba[o + 2] = g.colorPixels[o + 2];
        e.rgba[o + 3] = 255;
      };
      for (let p = 0; p < W * H; p++) {
        const o = p * 4;
        const bones = decodeBones(g.idPixels[o], g.idPixels[o + 1], g.idPixels[o + 2]);
        if (bones.length === 0) continue;
        if (g.colorPixels[o + 3] <= 8) continue; // 透明跳过
        for (const bi of bones) addPixel(bi, o, p);
      }

      // 每 bone 裁剪（与 splitByBoneId 同逻辑）
      for (const [bi, e] of perBone) {
        const bone = bake.bones[bi];
        // 诊断：记录每个 bone 在哪个 part 被 push（查 3 重复来源）
        if (bone.name.toLowerCase().includes('hips')) {
          console.log(`[splitSixParts] push hips: part=${part} dir=${d} bone=${bone.name} bi=${bi} count=${e.count}`);
        }
        const pb = result.get(bi)!;
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
        if (maxX < 0) continue;
        const jp = bone.jointPixels[d];
        if (!jp) continue;
        const jx = jp.x;
        const jy = jp.y;
        // 紧包围盒裁剪（+2px padding），plug 存偏移
        const pad = 2;
        let x0 = Math.max(0, Math.floor(minX - pad));
        let y0 = Math.max(0, Math.floor(minY - pad));
        let x1 = Math.min(W, Math.ceil(maxX + pad));
        let y1 = Math.min(H, Math.ceil(maxY + pad));
        // 确保关节在裁剪框内
        x0 = Math.min(x0, Math.floor(jx));
        y0 = Math.min(y0, Math.floor(jy));
        x1 = Math.max(x1, Math.ceil(jx) + 1);
        y1 = Math.max(y1, Math.ceil(jy) + 1);
        const cw = x1 - x0;
        const ch = y1 - y0;

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

        const palette = medianCut(crop, paletteSize);
        // 尺寸归一化：按 cameraHalf 缩放到整模像素空间
        const cwN = Math.max(1, Math.round(cw * g.cameraHalf));
        const chN = Math.max(1, Math.round(ch * g.cameraHalf));
        const grid: PixelGrid = [];
        // 最近邻下采样（若 cwN==cw 则 1:1）
        for (let y = 0; y < chN; y++) {
          const row: (string | null)[] = [];
          const sy = Math.min(ch - 1, Math.floor((y * ch) / chN));
          for (let x = 0; x < cwN; x++) {
            const sx = Math.min(cw - 1, Math.floor((x * cw) / cwN));
            const o = (sy * cw + sx) * 4;
            row.push(rgbaToHexOrNull(crop[o], crop[o + 1], crop[o + 2], crop[o + 3]));
          }
          grid.push(row);
        }
        if (palette.length > 0) {
          for (let y = 0; y < chN; y++) {
            for (let x = 0; x < cwN; x++) {
              const c = grid[y][x];
              if (!c) continue;
              const r = parseInt(c.slice(1, 3), 16);
              const gg = parseInt(c.slice(3, 5), 16);
              const b = parseInt(c.slice(5, 7), 16);
              const idx = nearestPaletteIndex(r, gg, b, palette);
              const p = palette[idx];
              grid[y][x] = '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
            }
          }
        }

        // 去重：同 bone 同 direction 只保留第一张（torso 主，armL/armR 泄漏的 50px 忽略）
        // 2D 流程：1 骨骼 1 方向 1 图，不叠加多 part
        if (pb.directions.some((dd) => dd.direction === d)) {
          console.log(`[splitSixParts] skip duplicate hips: part=${part} dir=${d} (already have)`);
          continue;
        }
        pb.directions.push({
          direction: d as DirectionIndex,
          grid,
          width: cwN,
          height: chN,
          cropX: x0,
          cropY: y0,
          jointX: jx,
          jointY: jy,
          plugX: (jx - x0) * g.cameraHalf,
          plugY: (jy - y0) * g.cameraHalf,
          cameraHalf: g.cameraHalf,
        });
      }
    }
  }

  // 删掉 8 方向全空的 bone
  for (const [bi, pb] of [...result]) {
    if (pb.directions.length === 0) result.delete(bi);
  }
  return result;
}
