// ============================================================
// PixelMorpher - 骨骼映射器（2D 端）
// 输入：双遍 ID 缓冲烘焙结果 → 按 bone 拆分 → 裁剪 → Node/Sprite/Character
// ============================================================

import type { TwoPassBakeData } from './threejs-baker-twopass';
import { decodeBoneMask64 } from './threejs-baker-twopass';
import type { PartName } from './threejs-baker-sixpart';
import { medianCut, nearestPaletteIndex } from './threejs-baker';
import { rgbaToHexOrNull } from '../engine/utils';
import { directionFolder } from '../sprite-folder';
import { guardCharacterBoneAxes } from '../bone-axis-guard';
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
  /** 视角纬度（度）：undefined/0=基纬度套；±45/±90=全角度模式的额外套（±90 只有 direction 0） */
  latitude?: number;
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
  /** 所属部件（六部件拆分填；双遍无此概念则为空） */
  part?: PartName;
}

export interface SplitOptions {
  /** 裁剪 padding 系数，默认 1.35 */
  padding?: number;
  /** 最小裁剪边长，默认 10 */
  minCrop?: number;
  /** 调色板颜色数，默认 16 */
  paletteSize?: number;
  /**
   * 小碎片清理：每骨骼每方向的归属掩码里，除最大连通域外面积小于此值的
   * 连通域整域清除（ID 噪声产生的孤点）。默认 4；设 0 关闭。
   * 眼/眉/口等小部件骨骼（名字命中 isProtectedDetailBone）豁免不清。
   */
  fragmentMinArea?: number;
}

/** 小部件豁免名单：这些骨骼的细节本身就小而独立，碎片清理会误伤 */
const PROTECTED_DETAIL_RE = /eye|brow|lash|mouth|lip|tooth|teeth|tongue|pupil|瞳|目|眼|眉|睫|口|嘴|唇|舌|歯/;
export function isProtectedDetailBone(name: string): boolean {
  return PROTECTED_DETAIL_RE.test(name.toLowerCase());
}

/**
 * 清理归属掩码里的小碎片连通域（8 连通）：保留最大域，其余面积 < minArea
 * 的整域从 mask 清除。就地修改 mask，返回清除的像素数。
 */
export function filterSmallMaskComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 4,
): number {
  if (minArea <= 1 || width <= 0 || height <= 0) return 0;
  const total = width * height;
  const labels = new Int32Array(total).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  let largest = -1;
  let largestSize = 0;
  for (let s = 0; s < total; s++) {
    if (!mask[s] || labels[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.length = 0;
    stack.push(s);
    labels[s] = id;
    while (stack.length > 0) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const y = (p / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] && labels[q] < 0) { labels[q] = id; stack.push(q); }
        }
      }
    }
    sizes.push(size);
    if (size > largestSize) { largestSize = size; largest = id; }
  }
  let removed = 0;
  for (let p = 0; p < total; p++) {
    const id = labels[p];
    if (id >= 0 && id !== largest && sizes[id] < minArea) {
      mask[p] = 0;
      removed++;
    }
  }
  return removed;
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
  // 64 位掩码：lo = idPixels（字节 0..3）、hi = idPixelsHi（字节 4..7），o = 像素字节偏移
  const decodeBones = (lo: Uint8ClampedArray, hi: Uint8ClampedArray | undefined, o: number): number[] => {
    const out: number[] = [];
    const bytes = [
      lo[o]!, lo[o + 1]!, lo[o + 2]!, lo[o + 3]!,
      hi ? hi[o]! : 0, hi ? hi[o + 1]! : 0, hi ? hi[o + 2]! : 0, hi ? hi[o + 3]! : 0,
    ];
    for (const ci of decodeBoneMask64(bytes)) {
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

  // （纬度,方向）对迭代：基纬度 8 向 + 全角度额外纬度（±90 只有方向 0）
  const pairKeys: Array<{ lat: number; d: number }> = [];
  {
    const seen = new Set<string>();
    for (const g of bake.groups) {
      const lat = g.latitude ?? 0;
      const key = `${lat}|${g.direction}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairKeys.push({ lat, d: g.direction });
      }
    }
  }
  for (const { lat, d } of pairKeys) {
    const front = bake.groups.find((g) => g.direction === d && g.pass === 0 && (g.latitude ?? 0) === lat)!;
    const back = bake.groups.find((g) => g.direction === d && g.pass === 1 && (g.latitude ?? 0) === lat)!;

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
    // back 补充：同一像素 front 已给某 bone 时不覆盖（front 优先），只补该 bone 缺的像素
    const addPixelBack = (bi0: number, src: Uint8ClampedArray, o: number, p: number) => {
      let bi = bi0;
      if (merge) bi = merge.effectiveIndex[bi] ?? bi;
      const e = perBone.get(bi);
      if (e && e.mask[p]) return;
      addPixel(bi0, src, o, p);
    };
    for (let p = 0; p < W * H; p++) {
      const o = p * 4;
      // 并集语义（与烘焙文件头一致：像素 = pass0 ∪ pass1）：两遍独立归属。
      // 旧逻辑 front 非空就不看 back——被遮挡的远侧肢体在 front 全被遮挡者
      // 占住，其像素只存在于 back 遍，被整批丢弃（侧面方向远侧小臂/手全缺）。
      // 透明像素跳过（颜色无意义），两遍各自判定。
      if (front.colorPixels[o + 3] > 8) {
        for (const bi of decodeBones(front.idPixels, front.idPixelsHi, o)) {
          addPixel(bi, front.colorPixels, o, p);
        }
      }
      if (back.colorPixels[o + 3] > 8) {
        for (const bi of decodeBones(back.idPixels, back.idPixelsHi, o)) {
          addPixelBack(bi, back.colorPixels, o, p);
        }
      }
    }

    // 每 bone 裁剪
    for (const [bi, e] of perBone) {
      const bone = bake.bones[bi];
      const pb = result.get(bi)!;
      // 小碎片清理（裁 bbox 前，免得孤点撑大裁剪框）；小部件骨骼豁免
      if (!isProtectedDetailBone(bone.name)) {
        filterSmallMaskComponents(e.mask, W, H, opts.fragmentMinArea ?? 4);
      }
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
      const jp0 = front.jointPixels?.[bi] ?? bone.jointPixels[d];
      const jx = jp0.x;
      const jy = jp0.y;
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
        latitude: lat,
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

/** PixelGrid 最近邻缩放（单烘图与主烘焙图做像素密度对齐用） */
export function scaleGridNearest(grid: PixelGrid, scale: number): PixelGrid {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  if (w === 0 || h === 0 || !(scale > 0)) return grid;
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const out: PixelGrid = [];
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    const row: (string | null)[] = [];
    for (let x = 0; x < nw; x++) {
      row.push(grid[sy][Math.min(w - 1, Math.floor(x / scale))]);
    }
    out.push(row);
  }
  return out;
}

/** PixelGrid 紧包围盒裁剪（非透明像素 + padding，与主烘焙裁剪同口径） */
export function cropGridToContent(
  grid: PixelGrid,
  padding = 2,
): { grid: PixelGrid; cropX: number; cropY: number } {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] !== null) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { grid, cropX: 0, cropY: 0 };
  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(w - 1, maxX + padding);
  const y1 = Math.min(h - 1, maxY + padding);
  const out: PixelGrid = [];
  for (let y = y0; y <= y1; y++) out.push(grid[y].slice(x0, x1 + 1));
  return { grid: out, cropX: x0, cropY: y0 };
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
/**
 * 实测关节开口宽度（= 关节盘直径，全局像素）：取规范方向（6 南，缺省取第一个）
 * 精灵在 plug 行 ±2 行内、以 plug 为中心的连续不透明段（plug 点透明时取该行
 * 最长段）的最大值。无可测像素返回 null。
 */
/** 关节开口实测（全局像素）：plug 行 ±2 内、以 plug 为中心的连续不透明段
 * （plug 点透明时取该行最长段）的最大值。无可测像素返回 null。
 * 烘焙导入与编辑器「重新生成关节盘」共用同一量法。 */
export function measureOpeningWidth(grid: PixelGrid, plugX: number, plugY: number): number | null {
  const cy = Math.round(plugY);
  const cx = Math.round(plugX);
  let best = 0;
  for (let y = Math.max(0, cy - 2); y <= Math.min(grid.length - 1, cy + 2); y++) {
    const row = grid[y];
    if (!row || row.length === 0) continue;
    let run = 0;
    if (cx >= 0 && cx < row.length && row[cx]) {
      run = 1;
      for (let x = cx - 1; x >= 0 && row[x]; x--) run++;
      for (let x = cx + 1; x < row.length && row[x]; x++) run++;
    } else {
      let cur = 0;
      for (const c of row) {
        cur = c ? cur + 1 : 0;
        if (cur > run) run = cur;
      }
    }
    if (run > best) best = run;
  }
  return best > 0 ? best : null;
}

function measureJointOpeningWidth(pb: ProcessedBone): number | null {
  const dir = pb.directions.find((d) => d.direction === 6 && (d.latitude ?? 0) === 0) ?? pb.directions[0];
  if (!dir) return null;
  return measureOpeningWidth(dir.grid, dir.plugX, dir.plugY);
}

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

    // Transform 归零：姿态层初始 0，静态 3D 偏移存 Socket.offset3D（选项 A）
    // （旧逻辑把 joint3D 差值写 transform，与姿态混在一起，抽象错误）
    node.transform.x = 0;
    node.transform.y = 0;
    node.transform.z = 0;
    // 根节点 transform 保持 (0,0,0)

    // T-pose 摆回（甲案）：手臂是垂下烘焙的（局部偏移竖直向下），链根节点（肩）写 ∓90°
    // 基础角度，把整条臂链在南向视平面里转回水平（精灵与子关节同角旋转，保持对位）；
    // 与模型原始姿势解耦：角度只由肩关节在模型中心的左/右侧决定（+X 侧 -90°，-X 侧 +90°）
    if (!isRoot && (pb.part === 'armL' || pb.part === 'armR') && pb.joint3D) {
      const parentPb = processed.get(pb.parentIndex!);
      if (parentPb && parentPb.part !== pb.part) {
        node.transform.angle = pb.joint3D.x >= 0 ? -90 : 90;
      }
    }

    // attachment：plug 用方向 0 的（各方向 sprite.plug 自己带）
    // 注意：无方向的父骨骼占位（directions 为空）没有 plug，用零值
    const d0 = pb.directions.find((d) => d.direction === 0 && (d.latitude ?? 0) === 0) ?? pb.directions[0];
    if (isRoot) {
      node.attachment = { type: 'fixed', fixedOffset: { x: 0, y: 0 } };
    } else {
      const parentPb = processed.get(pb.parentIndex!);
      const socketId = `sock_${characterId}_${pb.parentIndex}_${pb.boneIndex}`;
      // plug 置零：sprite.plug 已是关节在精灵内的位置（jx-x0），再加 attachment.plug 会双重偏移
      // 节点原点经 transform 已在关节处，无需额外偏移
      node.attachment = {
        type: 'socket',
        parentSocketId: socketId,
        plug: { x: 0, y: 0 },
      };
      void parentPb;
    }

    // slot + 8 方向 sprites
    const slotKey = `slot_${characterId}_${pb.boneIndex}`;
    const piece = createDefaultCostumePiece(slotKey, '#ffffff');
    for (const dir of pb.directions) {
      const dirLat = dir.latitude ?? 0;
      const spriteId = dirLat === 0
        ? `spr_${characterId}_${pb.boneIndex}_${dir.direction}`
        : `spr_${characterId}_${pb.boneIndex}_lat${dirLat}_${dir.direction}`;
      const sprite: Sprite = {
        id: spriteId,
        name: dirLat === 0 ? `${pb.boneName} d${dir.direction}` : `${pb.boneName} lat${dirLat} d${dir.direction}`,
        width: dir.width,
        height: dir.height,
        data: dir.grid,
        plug: { x: pxToSub(dir.plugX), y: pxToSub(dir.plugY) },
        // 可逆性：记录分部件与全局的尺度差，渲染时换算
        partCameraHalf: dir.cameraHalf,
        globalCameraHalf: dir.globalCameraHalf ?? 1.0,
        // 出生方向归档（sprite-folder）：烘焙时按方向落夹
        folder: directionFolder(dir.direction) ?? undefined,
        // 出生标签（Q1 定案）：只在烘焙时写入，复用不追加
        origin: { characterId, boneName: pb.boneName },
      };
      sprites[spriteId] = sprite;
      if (dirLat === 0) {
        piece.sprites[dir.direction] = { spriteId };
      } else {
        (piece.latitudeSprites ??= {})[dirLat] ??= {};
        piece.latitudeSprites[dirLat][dir.direction] = { spriteId };
      }
    }
    pieces[slotKey] = piece;
    node.slot = piece;

    // 关节盘直径数据（无条件写入）：socket 连接 + 有精灵 + 实测到开口宽度时，
    // 把直径写入 attachment.jointWidth 与 piece 的 'plug' 截面——渲染端出盘时
    // 首选 jointWidth、其次截面。是否出盘由 plug 属性 autoJointDisc 决定
    // （默认开），不在导入端控制。
    if (!isRoot && pb.directions.length > 0) {
      const w = measureJointOpeningWidth(pb);
      if (w !== null) {
        if (node.attachment.type === 'socket') node.attachment.jointWidth = w;
        piece.crossSections.push({ id: 'plug', mode: 'inside', diameter: w });
      }
    }

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
    // 选项 A：Socket 存 3D 静态偏移（父关节→子关节），Transform 存姿态（初始 0）
    // 3D 偏移 = joint3D 差值（全局像素，Y 取反：Y-up→Y-down）
    if (pb.joint3D && parentPb.joint3D) {
      const cdir = pb.directions.find((d) => d.direction === 6 && (d.latitude ?? 0) === 0) ?? pb.directions[0];
      const gch = cdir?.globalCameraHalf ?? 1.0;
      const bw = pb.bakeWidth ?? 128;
      const scale = (bw / 2) / gch;
      const isArmChainInternal =
        (pb.part === 'armL' || pb.part === 'armR') && parentPb.part === pb.part;
      if (isArmChainInternal) {
        // T-pose（甲案）：臂链内偏移拉直为纯向下（局部系），只保留 3D 骨长；
        // 摆回水平靠链根节点（肩）的 ∓90° 基础角度，精灵与关节同角旋转对位不变
        const len = Math.hypot(
          pb.joint3D.x - parentPb.joint3D.x,
          pb.joint3D.y - parentPb.joint3D.y,
          pb.joint3D.z - parentPb.joint3D.z,
        );
        socket.offset3D = { x: 0, y: pxToSub(len * scale), z: 0 };
      } else {
        socket.offset3D = {
          x: pxToSub((pb.joint3D.x - parentPb.joint3D.x) * scale),
          y: pxToSub(-(pb.joint3D.y - parentPb.joint3D.y) * scale), // Y-up→Y-down（画布坐标）
          z: pxToSub((pb.joint3D.z - parentPb.joint3D.z) * scale),
        };
      }
    }
    // 2D 偏移按全帧关节差逐方向计算（子关节 − 父关节，全局像素口径：
    // jointX × cameraHalf 统一跨部件尺度，与裁剪框无关；SubPixel 存储）。
    // offset3D 存在时渲染走 3D 分层、这些值不参与；joint3D 缺失的骨骼
    // 数据靠它们对位——此前一律写零，子节点会塌到父关节（审计 F-34/D11）。
    const offsetFor = (d: DirectionIndex): { x: number; y: number } | null => {
      const pdir = parentPb.directions.find((pd) => pd.direction === d && (pd.latitude ?? 0) === 0)
        ?? parentPb.directions.find((pd) => pd.direction === d);
      if (!pdir) return null;
      const cdir = pb.directions.find((cd) => cd.direction === d && (cd.latitude ?? 0) === (pdir.latitude ?? 0))
        ?? pb.directions.find((cd) => cd.direction === d && (cd.latitude ?? 0) === 0)
        ?? pb.directions.find((cd) => cd.direction === d);
      if (!cdir) return null;
      return {
        x: pxToSub(cdir.jointX * cdir.cameraHalf - pdir.jointX * pdir.cameraHalf),
        y: pxToSub(cdir.jointY * cdir.cameraHalf - pdir.jointY * pdir.cameraHalf),
      };
    };
    const allDirs = new Set<DirectionIndex>([
      ...parentPb.directions.map((pd) => pd.direction),
      ...pb.directions.map((cd) => cd.direction),
    ]);
    for (const d of allDirs) {
      const off = offsetFor(d);
      if (off) socket.directionOffsets[d] = off;
    }
    // 基准位置 = 规范方向（6 南）的偏移，缺失时退任意已算方向，再缺失为零
    socket.basePosition = socket.directionOffsets[6]
      ?? socket.directionOffsets[0]
      ?? Object.values(socket.directionOffsets)[0]
      ?? { x: 0, y: 0 };
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

  // 骨轴守卫（数据入口）：臂链已由上方 T-pose 摆回（甲案）拉直、
  // 其余主干多为竖直段，预期零改动；尾/裙摆等横向骨段若落进
  // IK 反解奇异带在此改轴（静止几何不变），与读入规范化同守卫。
  guardCharacterBoneAxes(character, sprites);

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

/**
 * 图层装配（乙）：先按基底图层（像素最多的一层）走 mapBonesToNodes 建骨骼树，
 * 其余图层逐层建成子节点，挂在所属骨骼节点的专用 socket 下（offset3D 全零、
 * 变换归零 → 与骨骼节点同帧同位），画序 = 骨骼 zIndex + 层序小数（同深度桶内
 * 按 authoredZ 分先后，不越过下一层级）。图层精灵的 plug 与骨骼精灵同注册
 * （关节全帧坐标 − 各自裁剪原点），叠加后逐像素对位。
 */
export function mapBonesToNodesLayered(
  processed: Map<number, ProcessedBoneLayered>,
  characterId: string,
  characterName: string,
): MappedImport {
  // 基底图层选择：像素最多者（同数取画序靠前）
  const baseOf = (pb: ProcessedBoneLayered): ProcessedBoneLayer | undefined => {
    let best: ProcessedBoneLayer | undefined;
    for (const l of pb.layers) {
      if (!best || l.pixelCount > best.pixelCount
        || (l.pixelCount === best.pixelCount && l.rank < best.rank)) best = l;
    }
    return best;
  };
  const merged = new Map<number, ProcessedBone>();
  for (const [bi, pb] of processed) {
    merged.set(bi, { ...pb, directions: baseOf(pb)?.directions ?? [] });
  }
  const mapped = mapBonesToNodes(merged, characterId, characterName);
  const nodes = mapped.character.nodes;
  const sprites = mapped.sprites;
  const pieces = mapped.character.costumeSets[0]?.pieces ?? {};
  let extraNodes = 0;

  const sorted = [...processed.values()].sort((a, b) => a.boneIndex - b.boneIndex);
  for (const pb of sorted) {
    if (pb.layers.length < 2) continue;
    const base = baseOf(pb)!;
    const boneNodeId = `node_${characterId}_${pb.boneIndex}`;
    const boneNode = nodes[boneNodeId];
    if (!boneNode) continue;
    const byRank = [...pb.layers].sort((a, b) => a.rank - b.rank);
    for (const layer of byRank) {
      if (layer === base) continue;
      const rankPos = byRank.indexOf(layer);
      const nodeId = `node_${characterId}_${pb.boneIndex}_layer${layer.layerIndex}`;
      const node = createDefaultNode(nodeId, `${pb.boneName}·${layer.label}`);
      node.parentId = boneNodeId;
      node.transform.variantIndex = 6 as any;
      node.transform.x = 0;
      node.transform.y = 0;
      node.transform.z = 0;
      node.zIndex = (boneNode.zIndex ?? 0) + (rankPos + 1) / (byRank.length + 1);
      const socketId = `sock_${characterId}_${pb.boneIndex}_layer${layer.layerIndex}`;
      node.attachment = {
        type: 'socket',
        parentSocketId: socketId,
        plug: { x: 0, y: 0 },
      };
      boneNode.sockets.push({
        id: socketId,
        name: `${pb.boneName}·${layer.label}`,
        basePosition: { x: 0, y: 0 },
        directionOffsets: {},
        offset3D: { x: 0, y: 0, z: 0 },
      });
      boneNode.children.push(nodeId);

      const slotKey = `slot_${characterId}_${pb.boneIndex}_layer${layer.layerIndex}`;
      const piece = createDefaultCostumePiece(slotKey, '#ffffff');
      for (const dir of layer.directions) {
        const dirLat = dir.latitude ?? 0;
        const spriteId = dirLat === 0
          ? `spr_${characterId}_${pb.boneIndex}_layer${layer.layerIndex}_${dir.direction}`
          : `spr_${characterId}_${pb.boneIndex}_layer${layer.layerIndex}_lat${dirLat}_${dir.direction}`;
        const sprite: Sprite = {
          id: spriteId,
          name: dirLat === 0
            ? `${pb.boneName}·${layer.label} d${dir.direction}`
            : `${pb.boneName}·${layer.label} lat${dirLat} d${dir.direction}`,
          width: dir.width,
          height: dir.height,
          data: dir.grid,
          plug: { x: pxToSub(dir.plugX), y: pxToSub(dir.plugY) },
          partCameraHalf: dir.cameraHalf,
          globalCameraHalf: dir.globalCameraHalf ?? 1.0,
          folder: directionFolder(dir.direction) ?? undefined,
          origin: { characterId, boneName: pb.boneName },
        };
        sprites[spriteId] = sprite;
        if (dirLat === 0) {
          piece.sprites[dir.direction] = { spriteId };
        } else {
          (piece.latitudeSprites ??= {})[dirLat] ??= {};
          piece.latitudeSprites[dirLat][dir.direction] = { spriteId };
        }
      }
      pieces[slotKey] = piece;
      node.slot = piece;
      nodes[nodeId] = node;
      extraNodes++;
    }
  }
  mapped.stats = {
    bones: mapped.stats.bones,
    nodes: mapped.stats.nodes + extraNodes,
    sprites: Object.keys(sprites).length,
  };
  return mapped;
}

// ---- 六部件 2D 拆分 ----

import type { SixPartBakeData } from './threejs-baker-sixpart';
import { ALL_PARTS } from './threejs-baker-sixpart';


/** 关节分段只用于臂/腿部件：躯干等部件的破洞填充靠 ID 遍把遮挡
 * 片元改写成本部件一侧的接通骨骼、再经重锚叠回主图，归属必须走
 * ID 掩码；臂腿无此依赖，直接在部件精灵上按关节分段更简单。 */
const LIMB_SEGMENT_PARTS: ReadonlySet<string> = new Set(['armL', 'armR', 'legL', 'legR']);

/**
 * 关节分段归属（仅臂/腿）：直接在部件精灵上按关节位置分段——
 * 段 = 父关节→子关节连线（归父骨骼），每像素归离它最近的段；
 * 末节骨骼（无子骨骼）沿入向（父关节→本关节方向）延长一段作
 * 自己的段，关节处分界即过关节的垂面。等距时先出现的段优先
 * （真实段排在延长段之前，关节处归父段）。返回逐像素的有效
 * 骨骼下标（-1 = 无归属）。单有效骨骼时全部不透明像素归该骨骼。
 */
function segmentPartOwners(
  g: { colorPixels: Uint8ClampedArray; jointPixels?: Record<number, { x: number; y: number }> },
  partBones: readonly number[],
  bake: SixPartBakeData,
  W: number,
  H: number,
): Int32Array {
  const owners = new Int32Array(W * H).fill(-1);
  const merge = bake.merge;
  const effOf = (b: number) => (merge ? (merge.effectiveIndex[b] ?? b) : b);
  const effSet: number[] = [];
  const jpOf = new Map<number, { x: number; y: number }>();
  for (const gi of partBones) {
    const e = effOf(gi);
    if (!jpOf.has(e)) { effSet.push(e); const jp = g.jointPixels?.[gi]; if (jp) jpOf.set(e, jp); }
    if (gi === e) { const jp = g.jointPixels?.[gi]; if (jp) jpOf.set(e, jp); }
  }
  if (effSet.length === 0) return owners;
  const paintAll = (e: number) => {
    for (let p = 0; p < W * H; p++) if (g.colorPixels[p * 4 + 3] > 8) owners[p] = e;
  };
  if (effSet.length === 1) { paintAll(effSet[0]!); return owners; }
  const boneByIndex = new Map(bake.bones.map((b) => [b.index, b]));
  const effParentOf = (e: number): number | null => {
    let p = boneByIndex.get(e)?.parentIndex ?? null;
    while (p !== null && effOf(p) === e) p = boneByIndex.get(p)?.parentIndex ?? null;
    if (p === null) return null;
    const ep = effOf(p);
    return ep !== e && effSet.includes(ep) ? ep : null;
  };
  const hasChild = new Set<number>();
  for (const e of effSet) { const par = effParentOf(e); if (par !== null) hasChild.add(par); }
  interface Seg { ax: number; ay: number; bx: number; by: number; owner: number }
  const segs: Seg[] = [];
  const stubs: Seg[] = [];
  for (const e of effSet) {
    const par = effParentOf(e);
    const je = jpOf.get(e);
    if (par !== null) {
      const jp = jpOf.get(par);
      if (jp && je) segs.push({ ax: jp.x, ay: jp.y, bx: je.x, by: je.y, owner: par });
    }
    if (!hasChild.has(e) && je) {
      let dx = 0, dy = -1;
      if (par !== null) {
        const jp = jpOf.get(par);
        if (jp) { dx = je.x - jp.x; dy = je.y - jp.y; }
      }
      const l = Math.hypot(dx, dy);
      if (l > 1e-6) { dx /= l; dy /= l; }
      const L = W + H;
      stubs.push({ ax: je.x, ay: je.y, bx: je.x + dx * L, by: je.y + dy * L, owner: e });
    }
  }
  const all = [...segs, ...stubs];
  if (all.length === 0) { paintAll(effSet[0]!); return owners; }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (g.colorPixels[p * 4 + 3] <= 8) continue;
      let best = Infinity;
      let owner = -1;
      for (const sg of all) {
        const abx = sg.bx - sg.ax, aby = sg.by - sg.ay;
        const len2 = abx * abx + aby * aby;
        let t = len2 > 0 ? ((x - sg.ax) * abx + (y - sg.ay) * aby) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (sg.ax + abx * t), dy = y - (sg.ay + aby * t);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; owner = sg.owner; }
      }
      owners[p] = owner;
    }
  }
  return owners;
}

/**
 * 按六部件拆分。归属两种口径：臂/腿在部件精灵上按关节分段
 * （segmentPartOwners）；其余部件读块内 ID 掩码（破洞填充的遮挡
 * 片元归属靠它）→ 映射到全局 bone → 累积像素 → 裁剪。
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
    // 64 位掩码：lo = idPixels（字节 0..3）、hi = idPixelsHi（字节 4..7），o = 像素字节偏移
    const decodeBones = (lo: Uint8ClampedArray, hi: Uint8ClampedArray | undefined, o: number): number[] => {
      const out: number[] = [];
      const bytes = [
        lo[o]!, lo[o + 1]!, lo[o + 2]!, lo[o + 3]!,
        hi ? hi[o]! : 0, hi ? hi[o + 1]! : 0, hi ? hi[o + 2]! : 0, hi ? hi[o + 3]! : 0,
      ];
      for (const li of decodeBoneMask64(bytes)) {
        const gi = localToGlobal[li];
        if (gi !== undefined) out.push(gi);
      }
      return out;
    };

    // （纬度,方向）对迭代（同 splitByBoneId）
    const partPairs: Array<{ lat: number; d: number }> = [];
    {
      const seen = new Set<string>();
      for (const x of bake.groups) {
        if (x.part !== part) continue;
        const lat = x.latitude ?? 0;
        const key = `${lat}|${x.direction}`;
        if (!seen.has(key)) {
          seen.add(key);
          partPairs.push({ lat, d: x.direction });
        }
      }
    }
    for (const { lat, d } of partPairs) {
      const g = bake.groups.find((x) => x.part === part && x.direction === d && (x.latitude ?? 0) === lat);
      if (!g) continue;
      const perBone = new Map<number, { rgba: Uint8ClampedArray; mask: Uint8Array; count: number; contrib: Map<number, number> }>();
      const addPixel = (bi0: number, o: number, p: number) => {
        let bi = bi0;
        // 合并映射：手指等并入手
        if (merge) bi = merge.effectiveIndex[bi] ?? bi;
        let e = perBone.get(bi);
        if (!e) {
          e = { rgba: new Uint8ClampedArray(W * H * 4), mask: new Uint8Array(W * H), count: 0, contrib: new Map() };
          perBone.set(bi, e);
        }
        e.contrib.set(bi0, (e.contrib.get(bi0) ?? 0) + 1);
        e.mask[p] = 1;
        e.count++;
        e.rgba[o] = g.colorPixels[o];
        e.rgba[o + 1] = g.colorPixels[o + 1];
        e.rgba[o + 2] = g.colorPixels[o + 2];
        e.rgba[o + 3] = 255;
      };
      const segOwners = LIMB_SEGMENT_PARTS.has(part)
        ? segmentPartOwners(g, localToGlobal, bake, W, H)
        : null;
      for (let p = 0; p < W * H; p++) {
        const o = p * 4;
        if (g.colorPixels[o + 3] <= 8) continue; // 透明跳过
        if (segOwners) {
          const bi = segOwners[p]!;
          if (bi >= 0) addPixel(bi, o, p);
          continue;
        }
        if (!g.idPixels) {
          // 单节点部件：无 ID 图，所有非透明像素归唯一有效骨骼
          const localToGlobal = bake.partBoneMap[part];
          const gi0 = localToGlobal?.[0];
          if (gi0 === undefined) continue;
          addPixel(gi0, o, p);
        } else {
          const bones = decodeBones(g.idPixels, g.idPixelsHi, o);
          if (bones.length === 0) continue;
          for (const bi of bones) addPixel(bi, o, p);
        }
      }

      // 每 bone 裁剪（与 splitByBoneId 同逻辑）
      for (const [bi, e] of perBone) {
        const bone = bake.bones[bi];
        const pb = result.get(bi)!;
        // 小碎片清理（同 splitByBoneId）；小部件骨骼豁免
        if (!isProtectedDetailBone(bone.name)) {
          filterSmallMaskComponents(e.mask, W, H, opts.fragmentMinArea ?? 4);
        }
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
        const exist = pb.directions.find((dd) => dd.direction === d && (dd.latitude ?? 0) === lat);
        // 重复条目（同 bone 同方向已有主图）：本帧像素多来自被合并进 bi 的贡献骨骼
        // （如锁骨并入躯干单元），以像素最多的贡献骨骼为锚在本帧重建，后文重锚叠回主图
        let domBi = bi;
        if (exist) {
          let best = -1;
          for (const [cbi, n] of e.contrib) {
            if (n > best) { best = n; domBi = cbi; }
          }
        }
        const jp = g.jointPixels?.[domBi] ?? (exist ? bake.bones[domBi] : bone).jointPixels[d];
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

        // 重复条目不再整批丢弃：跨部件帧里属于本骨骼（多为合并进来的贡献骨骼，
        // 如锁骨归躯干单元但几何在手臂部件）的像素在主图里可能正是缺口
        //（躯干帧中它只是候选、被方向线门控切掉一部分）。按锚关节的 3D 偏移
        // 重锚后叠回主图，只填透明处；主图画布不扩张，超出部分裁掉。
        if (exist) {
          const domJoint = bake.bones[domBi].joint3D;
          const biJoint = bone.joint3D;
          if (domJoint && biJoint) {
            const loopAng = (((d + 2) % 8) / 8) * Math.PI * 2;
            const cosA = Math.cos(loopAng);
            const sinA = Math.sin(loopAng);
            const dx = domJoint.x - biJoint.x;
            const dy = domJoint.y - biJoint.y;
            const dz = domJoint.z - biJoint.z;
            const rx = dx * cosA + dz * sinA;
            const ry = dy;
            const rz = -dx * sinA + dz * cosA;
            // 相机基（与烘焙同式：相机在中心 + (0, half·0.25, 4) 看向中心；
            // right=(1,0,0)，up=(0, zz, -zy)）——倾斜差异为二阶小量，取主图 half
            const hP = exist.cameraHalf;
            const nn = Math.hypot(0.25 * hP, 4);
            const zy = (0.25 * hP) / nn;
            const zz = 4 / nn;
            const deltaPxX = rx * (W / 2);
            const deltaPxY = -(ry * zz - rz * zy) * (W / 2);
            const dupPlugX = (jx - x0) * g.cameraHalf;
            const dupPlugY = (jy - y0) * g.cameraHalf;
            const offX = Math.round(exist.plugX - dupPlugX + deltaPxX);
            const offY = Math.round(exist.plugY - dupPlugY + deltaPxY);
            let filled = 0;
            for (let y = 0; y < grid.length; y++) {
              const ty = y + offY;
              if (ty < 0 || ty >= exist.grid.length) continue;
              for (let x = 0; x < grid[y].length; x++) {
                const c = grid[y][x];
                if (!c) continue;
                const tx = x + offX;
                if (tx < 0 || tx >= exist.grid[ty].length) continue;
                if (exist.grid[ty][tx] === null) {
                  exist.grid[ty][tx] = c;
                  filled++;
                }
              }
            }
          }
          continue;
        }
        if (!pb.part) pb.part = part; // 部件归属（导入时臂链 T-pose 摆回用；首个添加方为归属部件）
        pb.directions.push({
          direction: d as DirectionIndex,
          latitude: lat,
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

/** 图层拆分结果：一根骨骼按（材质组视图）分出的若干层，每层一套方向精灵 */
export interface ProcessedBoneLayer {
  /** 部件内视图号（= partLayers 里的下标） */
  layerIndex: number;
  key: string;
  label: string;
  /** 画序（0 = 最远、先画），来自烘焙的深度中位数 rank */
  rank: number;
  /** 全部方向归属像素总数（装配端选基底图层用） */
  pixelCount: number;
  directions: ProcessedBoneDirection[];
}

export interface ProcessedBoneLayered extends ProcessedBone {
  layers: ProcessedBoneLayer[];
}

/**
 * 图层拆分（乙：进木偶装配）：与 splitSixParts 同一像素归属/裁剪/调色口径，
 * 只是归属多一维——（骨骼 × 图层）。layerPixels 的 R=视图号+1；R=0 的像素
 * （候选填充等无图层归属）并入视图 0 层。骨骼合并、碎片清理、跨部件帧重锚
 * 叠回等规则与 splitSixParts 一致（[split-debug] 诊断块不复制）。
 */
export function splitSixPartsLayered(
  bake: SixPartBakeData,
  opts: SplitOptions = {},
): Map<number, ProcessedBoneLayered> {
  const padding = opts.padding ?? 1.35;
  void padding;
  const paletteSize = opts.paletteSize ?? 16;
  const W = bake.width;
  const H = bake.height;

  const result = new Map<number, ProcessedBoneLayered>();
  const merge = bake.merge;
  const effectiveSet = new Set<number>();
  for (const b of bake.bones) {
    const eff = merge ? (merge.effectiveIndex[b.index] ?? b.index) : b.index;
    effectiveSet.add(eff);
  }
  for (const b of bake.bones) {
    if (!effectiveSet.has(b.index)) continue;
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
      worldToPixels: undefined,
      layers: [],
    });
  }
  const layerOf = (pb: ProcessedBoneLayered, part: PartName, vi: number): ProcessedBoneLayer => {
    let l = pb.layers.find((x) => x.layerIndex === vi);
    if (!l) {
      const meta = bake.partLayers?.[part]?.[vi];
      l = {
        layerIndex: vi,
        key: meta?.key ?? `${part}|${vi}`,
        label: meta?.label ?? `材质${vi + 1}`,
        rank: meta?.rank ?? vi,
        pixelCount: 0,
        directions: [],
      };
      pb.layers.push(l);
    }
    return l;
  };

  for (const part of ALL_PARTS) {
    const localToGlobal = bake.partBoneMap[part];
    if (!localToGlobal || localToGlobal.length === 0) continue;
    const decodeBones = (lo: Uint8ClampedArray, hi: Uint8ClampedArray | undefined, o: number): number[] => {
      const out: number[] = [];
      const bytes = [
        lo[o]!, lo[o + 1]!, lo[o + 2]!, lo[o + 3]!,
        hi ? hi[o]! : 0, hi ? hi[o + 1]! : 0, hi ? hi[o + 2]! : 0, hi ? hi[o + 3]! : 0,
      ];
      for (const li of decodeBoneMask64(bytes)) {
        const gi = localToGlobal[li];
        if (gi !== undefined) out.push(gi);
      }
      return out;
    };

    const partPairs: Array<{ lat: number; d: number }> = [];
    {
      const seen = new Set<string>();
      for (const x of bake.groups) {
        if (x.part !== part) continue;
        const lat = x.latitude ?? 0;
        const key = `${lat}|${x.direction}`;
        if (!seen.has(key)) {
          seen.add(key);
          partPairs.push({ lat, d: x.direction });
        }
      }
    }
    for (const { lat, d } of partPairs) {
      const g = bake.groups.find((x) => x.part === part && x.direction === d && (x.latitude ?? 0) === lat);
      if (!g) continue;
      type Acc = { bi: number; vi: number; rgba: Uint8ClampedArray; mask: Uint8Array; count: number; contrib: Map<number, number> };
      const perEntry = new Map<string, Acc>();
      const addPixel = (bi0: number, vi: number, o: number, p: number) => {
        let bi = bi0;
        if (merge) bi = merge.effectiveIndex[bi] ?? bi;
        const key = `${bi}|${vi}`;
        let e = perEntry.get(key);
        if (!e) {
          e = { bi, vi, rgba: new Uint8ClampedArray(W * H * 4), mask: new Uint8Array(W * H), count: 0, contrib: new Map() };
          perEntry.set(key, e);
        }
        e.contrib.set(bi0, (e.contrib.get(bi0) ?? 0) + 1);
        e.mask[p] = 1;
        e.count++;
        e.rgba[o] = g.colorPixels[o];
        e.rgba[o + 1] = g.colorPixels[o + 1];
        e.rgba[o + 2] = g.colorPixels[o + 2];
        e.rgba[o + 3] = 255;
      };
      const segOwners = LIMB_SEGMENT_PARTS.has(part)
        ? segmentPartOwners(g, localToGlobal, bake, W, H)
        : null;
      for (let p = 0; p < W * H; p++) {
        const o = p * 4;
        if (g.colorPixels[o + 3] <= 8) continue;
        const rawLayer = g.layerPixels ? g.layerPixels[o] : 0;
        const vi = rawLayer > 0 ? rawLayer - 1 : 0;
        if (segOwners) {
          const bi = segOwners[p]!;
          if (bi >= 0) addPixel(bi, vi, o, p);
          continue;
        }
        if (!g.idPixels) {
          const gi0 = localToGlobal?.[0];
          if (gi0 === undefined) continue;
          addPixel(gi0, vi, o, p);
        } else {
          const bones = decodeBones(g.idPixels, g.idPixelsHi, o);
          if (bones.length === 0) continue;
          for (const bi of bones) addPixel(bi, vi, o, p);
        }
      }

      for (const e of perEntry.values()) {
        const bone = bake.bones[e.bi];
        const pb = result.get(e.bi)!;
        if (!isProtectedDetailBone(bone.name)) {
          filterSmallMaskComponents(e.mask, W, H, opts.fragmentMinArea ?? 4);
        }
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
        const layer = layerOf(pb, part, e.vi);
        layer.pixelCount += e.count;
        const exist = layer.directions.find((dd) => dd.direction === d && (dd.latitude ?? 0) === lat);
        let domBi = e.bi;
        if (exist) {
          let best = -1;
          for (const [cbi, n] of e.contrib) {
            if (n > best) { best = n; domBi = cbi; }
          }
        }
        const jp = g.jointPixels?.[domBi] ?? (exist ? bake.bones[domBi] : bone).jointPixels[d];
        if (!jp) continue;
        const jx = jp.x;
        const jy = jp.y;
        const pad = 2;
        let x0 = Math.max(0, Math.floor(minX - pad));
        let y0 = Math.max(0, Math.floor(minY - pad));
        let x1 = Math.min(W, Math.ceil(maxX + pad));
        let y1 = Math.min(H, Math.ceil(maxY + pad));
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
        const cwN = Math.max(1, Math.round(cw * g.cameraHalf));
        const chN = Math.max(1, Math.round(ch * g.cameraHalf));
        const grid: PixelGrid = [];
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
              const pc = palette[idx];
              grid[y][x] = '#' + [pc[0], pc[1], pc[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
            }
          }
        }

        if (exist) {
          const domJoint = bake.bones[domBi].joint3D;
          const biJoint = bone.joint3D;
          if (domJoint && biJoint) {
            const loopAng = (((d + 2) % 8) / 8) * Math.PI * 2;
            const cosA = Math.cos(loopAng);
            const sinA = Math.sin(loopAng);
            const dx = domJoint.x - biJoint.x;
            const dy = domJoint.y - biJoint.y;
            const dz = domJoint.z - biJoint.z;
            const rx = dx * cosA + dz * sinA;
            const ry = dy;
            const rz = -dx * sinA + dz * cosA;
            const hP = exist.cameraHalf;
            const nn = Math.hypot(0.25 * hP, 4);
            const zy = (0.25 * hP) / nn;
            const zz = 4 / nn;
            const deltaPxX = rx * (W / 2);
            const deltaPxY = -(ry * zz - rz * zy) * (W / 2);
            const dupPlugX = (jx - x0) * g.cameraHalf;
            const dupPlugY = (jy - y0) * g.cameraHalf;
            const offX = Math.round(exist.plugX - dupPlugX + deltaPxX);
            const offY = Math.round(exist.plugY - dupPlugY + deltaPxY);
            for (let y = 0; y < grid.length; y++) {
              const ty = y + offY;
              if (ty < 0 || ty >= exist.grid.length) continue;
              for (let x = 0; x < grid[y].length; x++) {
                const c = grid[y][x];
                if (!c) continue;
                const tx = x + offX;
                if (tx < 0 || tx >= exist.grid[ty].length) continue;
                if (exist.grid[ty][tx] === null) {
                  exist.grid[ty][tx] = c;
                }
              }
            }
          }
          continue;
        }
        if (!pb.part) pb.part = part;
        layer.directions.push({
          direction: d as DirectionIndex,
          latitude: lat,
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

  const referencedParents = new Set<number>();
  for (const pb of result.values()) {
    if (pb.parentIndex !== null && pb.parentIndex !== undefined) {
      referencedParents.add(pb.parentIndex);
    }
  }
  for (const [bi, pb] of [...result]) {
    const totalDirs = pb.layers.reduce((n, l) => n + l.directions.length, 0);
    if (totalDirs === 0 && !referencedParents.has(bi)) {
      result.delete(bi);
      continue;
    }
    pb.layers = pb.layers.filter((l) => l.directions.length > 0);
    pb.layers.sort((a, b) => a.rank - b.rank);
    const d6 = pb.layers.flatMap((l) => l.directions).find((dd) => dd.direction === 6)
      ?? pb.layers[0]?.directions[0];
    if (d6 && d6.cameraHalf > 0) pb.worldToPixels = (W / 2) / d6.cameraHalf;
  }
  return result;
}

// ---- 单骨骼 2D 拆分 ----
