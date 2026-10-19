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
  /** 整模相机半宽（归一化单位），用于渲染时换算到全局尺度（可逆性：记录尺度差） */
  globalCameraHalf?: number;
}

export interface ProcessedBone {
  boneIndex: number;
  boneName: string;
  parentIndex: number | null;
  directions: ProcessedBoneDirection[]; // 有效方向（有像素的）
  /** 3D 关节坐标（世界单位，未归一化，用于 3D 节点位置） */
  joint3D?: { x: number; y: number; z: number };
  /** 世界单位→像素的全局系数（= 64 * normalization.scale），用于 joint3D 转像素 */
  worldToPixels?: number;
  /** 烘焙图像尺寸（像素），用于全局尺度换算 */
  bakeWidth?: number;
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
 * 回填 normToPixels（可逆性原则）：
 * 记录 bake 时的数值转换：normToPixels = (图像尺寸/2) / cameraHalf，
 * 使 joint3D（归一化单位）→像素 的转换可逆，不靠猜测的 64。
 * 注意：cameraHalf 本身已是归一化单位（pbox 由归一化坐标构建），故分母不再乘 scale。
 */
function fillWorldToPixels(
  result: Map<number, ProcessedBone>,
  W: number,
  _scale: number, // 保留参数占位（历史签名），实际不再使用
): void {
  for (const pb of result.values()) {
    const d6 = pb.directions.find((d) => d.direction === 6) ?? pb.directions[0];
    if (d6 && d6.cameraHalf > 0) {
      pb.worldToPixels = (W / 2) / d6.cameraHalf;
    }
  }
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
      bakeWidth: W,
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

  // 删掉 8 方向全空的 bone，但保留有子节点的父骨骼（避免子变孤儿归原点）
  // 先收集所有被引用的 parentIndex
  const referencedParents = new Set<number>();
  for (const pb of result.values()) {
    if (pb.parentIndex !== null && pb.parentIndex !== undefined) {
      referencedParents.add(pb.parentIndex);
    }
  }
  for (const [bi, pb] of [...result]) {
    if (pb.directions.length === 0 && !referencedParents.has(bi)) {
      result.delete(bi);
    }
  }
  // 回填 worldToPixels（可逆性：记录 bake 时的转换系数）
  fillWorldToPixels(result, W, bake.normalization.scale);
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
    // 3D 烘焙角色默认朝向南（6），与烘焙时的规范方向一致
    // （主渲染 currentDirection = rootTransform.variantIndex ?? 0，默认东会导致侧视投影错位）
    node.transform.variantIndex = 6 as any;

    // children
    node.children = sorted
      .filter((c) => c.parentIndex === pb.boneIndex)
      .map((c) => nodeIdByBone.get(c.boneIndex)!);

    // 3D 位置（可逆性原则，全局统一尺度）：
    // 直接用 joint3D（归一化 3D 真值）差值，三轴同源，不再经 2D 反推。
    // 换算：pixels = normalized * (W/2) / globalCameraHalf，其中 globalCameraHalf=1.0（整模归一化到[-1,1]）。
    // 记录的转换：bake.globalCameraHalf 在烘焙时记录，split 透传到 direction，导入时使用，全程可逆。
    if (!isRoot) {
      const parentPb = processed.get(pb.parentIndex!);
      if (pb.joint3D && parentPb?.joint3D) {
        // 取子骨骼 South 方向的 globalCameraHalf（各方向一致；回退 1.0）
        const cdir = pb.directions.find((d) => d.direction === 6) ?? pb.directions[0];
        const gch = cdir?.globalCameraHalf ?? 1.0;
        const bw = pb.bakeWidth ?? 128;
        const scale = (bw / 2) / gch; // (W/2)/globalCameraHalf，全局统一尺度
        node.transform.x = pxToSub((pb.joint3D.x - parentPb.joint3D.x) * scale);
        // Y 取反：joint3D.y 是 Three.js Y-up，画布是 Y-down（原点左上）
        node.transform.y = pxToSub(-(pb.joint3D.y - parentPb.joint3D.y) * scale);
        node.transform.z = pxToSub((pb.joint3D.z - parentPb.joint3D.z) * scale);
      } else {
        // 回退：无 3D 数据时用 South 视图 2D 差值（保证不归零，覆盖层 2D 逻辑可用）
        const cdir6 = pb.directions.find((d) => d.direction === 6);
        const pdir6 = parentPb?.directions.find((d) => d.direction === 6);
        if (cdir6 && pdir6) {
          const scaleRatio = pdir6.cameraHalf / cdir6.cameraHalf;
          node.transform.x = pxToSub(cdir6.jointX - pdir6.jointX * scaleRatio);
          node.transform.y = pxToSub(cdir6.jointY - pdir6.jointY * scaleRatio);
        } else {
          node.transform.x = 0;
          node.transform.y = 0;
        }
        node.transform.z = 0;
      }
    }
    // 根节点 transform 保持 (0,0,0)

    // attachment：plug 用方向 0 的（各方向 sprite.plug 自己带）
    // 注意：无方向的父骨骼占位（directions 为空）没有 plug，用零值
    const d0 = pb.directions.find((d) => d.direction === 0) ?? pb.directions[0];
    if (isRoot) {
      node.attachment = { type: 'fixed', fixedOffset: { x: 0, y: 0 } };
    } else {
      const parentPb = processed.get(pb.parentIndex!);
      const socketId = `sock_${characterId}_${pb.parentIndex}_${pb.boneIndex}`;
      node.attachment = {
        type: 'socket',
        parentSocketId: socketId,
        plug: d0 ? { x: pxToSub(d0.plugX), y: pxToSub(d0.plugY) } : { x: 0, y: 0 },
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
        // 可逆性：记录分部件与全局的尺度差，渲染时换算
        partCameraHalf: dir.cameraHalf,
        globalCameraHalf: dir.globalCameraHalf ?? 1.0,
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
    // 可逆性原则：节点 transform 已含完整的 3D 位移（X/Y 来自 South 视图 2D 差值，Z 来自 joint3D），
    // socket 置零避免双重计数。2D 回退时渲染器用 directionOffsets[dir]??basePosition，零值即无偏移。
    for (const pdir of parentPb.directions) {
      const d = pdir.direction;
      const off = { x: 0, y: 0 };
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
  // 只为有效（代表）骨骼建 ProcessedBone：合并掉的骨骼不单独拆分
  // （2D 只拆四肢等需要关节的部位；头/躯干合并为单节点，不按骨骼切分）
  const effectiveSet = new Set<number>();
  for (const b of bake.bones) {
    const eff = merge ? (merge.effectiveIndex[b.index] ?? b.index) : b.index;
    effectiveSet.add(eff);
  }
  for (const b of bake.bones) {
    if (!effectiveSet.has(b.index)) continue; // 被合并掉的骨骼跳过
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
      bakeWidth: W,
      // 可逆性：记录世界→像素的转换系数 = (图像尺寸/2) / (cameraHalf * scale)
      // cameraHalf 取 South 方向的值（各方向同部件相机，理论一致）；directions 填充后再回填
      worldToPixels: undefined, // 占位，directions 就绪后在下方回填
    });
  }
  // 回填 worldToPixels（需 directions 就绪，故在像素循环后）

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
        if (g.colorPixels[o + 3] <= 8) continue; // 透明跳过
        if (!g.idPixels) {
          // 单节点部件：无 ID 图，所有非透明像素归唯一有效骨骼
          const localToGlobal = bake.partBoneMap[part];
          const gi0 = localToGlobal?.[0];
          if (gi0 === undefined) continue;
          const bi = merge ? (merge.effectiveIndex[gi0] ?? gi0) : gi0;
          addPixel(bi, o, p);
        } else {
          const bones = decodeBones(g.idPixels[o], g.idPixels[o + 1], g.idPixels[o + 2]);
          if (bones.length === 0) continue;
          for (const bi of bones) addPixel(bi, o, p);
        }
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
          globalCameraHalf: bake.globalCameraHalf,
        });
      }
    }
  }

  // 删掉 8 方向全空的 bone，但保留有子节点的父骨骼（避免子变孤儿归原点）
  const referencedParents = new Set<number>();
  for (const pb of result.values()) {
    if (pb.parentIndex !== null && pb.parentIndex !== undefined) {
      referencedParents.add(pb.parentIndex);
    }
  }
  for (const [bi, pb] of [...result]) {
    if (pb.directions.length === 0 && !referencedParents.has(bi)) {
      result.delete(bi);
    }
  }
  // 回填 worldToPixels（可逆性：记录 bake 时的转换系数）
  fillWorldToPixels(result, W, bake.normalization.scale);
  return result;
}

// ---- 单骨骼 2D 拆分 ----
