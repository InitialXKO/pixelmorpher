// ============================================================
// D6 二期：布料片烘焙。通道裁定（立项文档二期悬置项，本轮定）：
// 不新开变形通道——布料 = 一阵平行链（列）+ 列间横向/剪切
// 约束，烘焙结果仍写回各网格节点的 angle 轨道，播放端与
// 一期链摆完全同路（纯函数、无求解器）。网格节点由面板一键
// 生成（根节点下挂 C 列 × R 行骨骼链），求解时顶行钉在各列
// 根的逐帧参考位（驱动源），其余点 Verlet + 三向距离约束。
// ============================================================

import type { Character, KeyframeTrack, Node as UnifiedNode } from '../unified-types';
import {
  sampleReference, chainBakeFingerprint,
  type ChainBakeParams,
} from './verlet-chain';

export interface ClothBakeRecord {
  fingerprint: string;
  fromFrame: number;
  toFrame: number;
  params: ChainBakeParams;
  /** [列][行] 节点 id；行 0 = 列根（钉点） */
  gridIds: string[][];
  /** 与 gridIds 同序的基准本地角（撤销用） */
  baseLocals: number[][];
}

/** 在 root 下生成布料网格节点（纯数据组装，调用方一次写入）：
 * root 的子节点 = 各列列根，列内沿 children 串成链。新节点
 * 无精灵（骨骼点），本地偏移：列根沿 x 均布、链节沿 y 向下。 */
export function generateClothGrid(
  rootId: string, cols: number, rows: number, spacingX: number, spacingY: number,
): { nodes: Record<string, UnifiedNode>; gridIds: string[][] } {
  const nodes: Record<string, UnifiedNode> = {};
  const gridIds: string[][] = [];
  const mk = (id: string, parentId: string | undefined, x: number, y: number, children: string[]): UnifiedNode => ({
    id, name: id, parentId, role: 'bone',
    transform: { x, y, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children,
  } as unknown as UnifiedNode);
  for (let c = 0; c < cols; c++) {
    const col: string[] = [];
    for (let r = 0; r < rows; r++) {
      const id = `${rootId}_cloth_${c}_${r}`;
      col.push(id);
      const parentId = r === 0 ? rootId : col[r - 1];
      const x = r === 0 ? (c - (cols - 1) / 2) * spacingX : 0;
      const y = r === 0 ? 0 : spacingY;
      nodes[id] = mk(id, parentId, x, y, r + 1 < rows ? [`${rootId}_cloth_${c}_${r + 1}`] : []);
    }
    gridIds.push(col);
  }
  return { nodes, gridIds };
}

/** 按生成时的命名约定从角色数据里找回网格（列根 = root 的
 * 子节点中名为 `${root}_cloth_<列>_0` 者，列内沿 children 串）。 */
export function detectClothGrid(character: Character, rootId: string): string[][] | null {
  const root = character.nodes[rootId];
  if (!root) return null;
  const grid: string[][] = [];
  for (let c = 0; ; c++) {
    const first = `${rootId}_cloth_${c}_0`;
    if (!character.nodes[first]) break;
    const col: string[] = [];
    let cur: string | undefined = first;
    while (cur && character.nodes[cur]) {
      col.push(cur);
      cur = character.nodes[cur].children?.[0];
    }
    grid.push(col);
  }
  return grid.length > 0 && grid[0].length >= 2 ? grid : null;
}

interface Pt { x: number; y: number; px: number; py: number }

/** Verlet 布料求解（纯函数）：pins[f][c] = 第 f 帧第 c 列的钉点；
 * ref[f] = 第 f 帧参考网格（供约束长度与初值）；约束 = 纵向 +
 * 横向 + 双向剪切，长度逐帧取自参考（与链烘焙同口径）。 */
export function solveVerletCloth(
  pins: { x: number; y: number }[][],
  ref: { x: number; y: number }[][][],
  params: ChainBakeParams,
  frameRate: number,
): { x: number; y: number }[][][] {
  const cols = ref[0].length;
  const rows = ref[0][0].length;
  const pts: Pt[][] = ref[0].map((col) => col.map((q) => ({ x: q.x, y: q.y, px: q.x, py: q.y })));
  const dt = 1 / Math.max(1, frameRate);
  const keep = 1 - Math.max(0, Math.min(0.2, params.damping));
  const iters = Math.max(1, Math.min(24, Math.round(params.iterations)));
  const out: { x: number; y: number }[][][] = [];
  const seg = (a: Pt, b: Pt, want: number, aFixed: boolean, bFixed: boolean) => {
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    if (d < 1e-6) { dx = 0; dy = 1; d = 1; }
    const diff = (d - want) / d;
    if (aFixed && !bFixed) { b.x -= dx * diff; b.y -= dy * diff; }
    else if (!aFixed && bFixed) { a.x += dx * diff; a.y += dy * diff; }
    else if (!aFixed && !bFixed) {
      a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
      b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
    }
  };
  const dist = (f: number, c1: number, r1: number, c2: number, r2: number) =>
    Math.hypot(ref[f][c2][r2].x - ref[f][c1][r1].x, ref[f][c2][r2].y - ref[f][c1][r1].y);
  for (let f = 0; f < pins.length; f++) {
    for (let c = 0; c < cols; c++) {
      const pin = pins[f][c];
      pts[c][0].x = pin.x; pts[c][0].y = pin.y; pts[c][0].px = pin.x; pts[c][0].py = pin.y;
    }
    if (f === 0) { out.push(pts.map((col) => col.map((p) => ({ x: p.x, y: p.y })))); continue; }
    for (let c = 0; c < cols; c++) {
      for (let r = 1; r < rows; r++) {
        const p = pts[c][r];
        const vx = (p.x - p.px) * keep;
        const vy = (p.y - p.py) * keep;
        p.px = p.x; p.py = p.y;
        p.x += vx + params.windX * dt * dt;
        p.y += vy + params.gravity * dt * dt;
      }
    }
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < cols; c++) { pts[c][0].x = pins[f][c].x; pts[c][0].y = pins[f][c].y; }
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r + 1 < rows; r++) seg(pts[c][r], pts[c][r + 1], dist(f, c, r, c, r + 1), r === 0, false);
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c + 1 < cols; c++) seg(pts[c][r], pts[c + 1][r], dist(f, c, r, c + 1, r), r === 0, r === 0);
      }
      for (let c = 0; c + 1 < cols; c++) {
        for (let r = 0; r + 1 < rows; r++) {
          seg(pts[c][r], pts[c + 1][r + 1], dist(f, c, r, c + 1, r + 1), r === 0, false);
          seg(pts[c + 1][r], pts[c][r + 1], dist(f, c + 1, r, c, r + 1), r === 0, false);
        }
      }
    }
    out.push(pts.map((col) => col.map((p) => ({ x: p.x, y: p.y }))));
  }
  return out;
}

/** 执行一次布料烘焙（纯计算）：参考采样（全网格节点 angle 钉
 * 基准）→ 网格求解 → 逐节点按下行段增量折回本地 angle。
 * 末行节点无下行段，世界增量取上一行增量（刚性延续，同链）。 */
export function bakeClothSwing(
  character: Character,
  gridIds: string[][],
  params: ChainBakeParams,
  fromFrame: number,
  toFrame: number,
  frameRate: number,
): { record: ClothBakeRecord; angleTracks: Record<string, KeyframeTrack> } {
  const cols = gridIds.length;
  const rows = gridIds[0].length;
  const flat = gridIds.flat();
  const ref = sampleReference(character, flat, fromFrame, toFrame, frameRate);
  const frames = toFrame - fromFrame + 1;
  const refGrid: { x: number; y: number }[][][] = [];
  const pins: { x: number; y: number }[][] = [];
  for (let f = 0; f < frames; f++) {
    const grid: { x: number; y: number }[][] = [];
    for (let c = 0; c < cols; c++) {
      const col: { x: number; y: number }[] = [];
      for (let r = 0; r < rows; r++) col.push(ref.joints[f][c * rows + r]);
      grid.push(col);
    }
    refGrid.push(grid);
    pins.push(grid.map((col) => col[0]));
  }
  const solved = solveVerletCloth(pins, refGrid, params, frameRate);
  // 世界增量 Δ[c][r][f]：下行段向之差；末行取上一行增量
  const delta: number[][][] = [];
  for (let c = 0; c < cols; c++) {
    delta.push([]);
    for (let r = 0; r < rows; r++) {
      delta[c].push([]);
      for (let f = 0; f < frames; f++) {
        if (r + 1 < rows) {
          const segA = Math.atan2(solved[f][c][r + 1].y - solved[f][c][r].y, solved[f][c][r + 1].x - solved[f][c][r].x);
          const segR = Math.atan2(refGrid[f][c][r + 1].y - refGrid[f][c][r].y, refGrid[f][c][r + 1].x - refGrid[f][c][r].x);
          let d = ((segA - segR) * 180) / Math.PI;
          if (d > 180) d -= 360; else if (d < -180) d += 360;
          delta[c][r].push(d);
        } else {
          delta[c][r].push(rows >= 2 ? delta[c][r - 1][f] : 0);
        }
      }
    }
  }
  const angleTracks: Record<string, KeyframeTrack> = {};
  const baseLocals: number[][] = [];
  for (let c = 0; c < cols; c++) {
    baseLocals.push([]);
    for (let r = 0; r < rows; r++) {
      const id = gridIds[c][r];
      const base = ref.baseLocals[c * rows + r];
      baseLocals[c].push(base);
      const old = character.nodes[id]?.tracks?.angle;
      const kfs = (old?.keyframes ?? []).filter((kf) => kf.frame < fromFrame || kf.frame > toFrame);
      for (let f = 0; f < frames; f++) {
        const parentDelta = r === 0 ? 0 : delta[c][r - 1][f];
        const v = base + delta[c][r][f] - parentDelta;
        kfs.push({ frame: fromFrame + f, value: Math.round(v * 100) / 100 });
      }
      kfs.sort((a, b) => a.frame - b.frame);
      angleTracks[id] = { keyframes: kfs, interpolation: old?.interpolation ?? 'linear' };
    }
  }
  const fingerprint = chainBakeFingerprint(flat, params, fromFrame, toFrame, ref.joints);
  return {
    record: { fingerprint, fromFrame, toFrame, params: { ...params }, gridIds, baseLocals },
    angleTracks,
  };
}

/** 指纹新鲜度（与链烘焙同口径：重采样参考再算指纹比对） */
export function isClothBakeFresh(
  character: Character,
  record: ClothBakeRecord,
  frameRate: number,
): boolean {
  const flat = record.gridIds.flat();
  const ref = sampleReference(character, flat, record.fromFrame, record.toFrame, frameRate);
  return chainBakeFingerprint(flat, record.params, record.fromFrame, record.toFrame, ref.joints) === record.fingerprint;
}
