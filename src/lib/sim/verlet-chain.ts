// ============================================================
// D6 一期：Verlet 绳/链烘焙（作者期模拟，spikes/simulation/
// PROPOSAL.md 甲路）。求解器只活在烘焙这一刻：驱动源 = 链根
// 节点的逐帧世界位姿（由现行 FK 机器采样），结果写回链上各
// 节点的 angle 轨道关键帧——播放端（编辑器/导出运行时）仍是
// 逐帧纯函数，零求解器。烘焙带指纹：驱动源/参数/链结构变化
// 后指纹对不上即视为过期，面板点名提示重烘（不静默沿用）。
// ============================================================

import type { Character, KeyframeTrack } from '../unified-types';
import { subToPx } from '../unified-types';
import { computeWorldTransforms } from '../unified-render';

export interface ChainBakeParams {
  gravity: number;   // px/s²，y 向下为正
  windX: number;     // px/s²
  damping: number;   // 0..0.2，速度保留 = 1 − damping
  iterations: number; // 距离约束迭代 1..24
}

export function defaultChainBakeParams(): ChainBakeParams {
  return { gravity: 980, windX: 0, damping: 0.02, iterations: 8 };
}

export interface ChainBakeRecord {
  fingerprint: string;
  fromFrame: number;
  toFrame: number;
  params: ChainBakeParams;
  chainNodeIds: string[];
  /** 烘焙时各节点的基准本地角（撤销烘焙时写回为常值关键帧） */
  baseLocals: number[];
}

/** 从 root 起沿子节点直走成链：每步取第一个子节点（多子时
 * 在返回 truncated=true 标明——链定义只认单链，多子属作者
 * 需要先整理结构的情况，不猜）。 */
export function collectChain(
  character: Character, rootId: string, maxLen = 12,
): { nodeIds: string[]; truncated: boolean } {
  const nodeIds: string[] = [];
  let truncated = false;
  let cur: string | undefined = rootId;
  while (cur && nodeIds.length < maxLen) {
    const node = character.nodes[cur];
    if (!node) break;
    nodeIds.push(cur);
    const kids = node.children ?? [];
    if (kids.length > 1) truncated = true;
    cur = kids[0];
  }
  return { nodeIds, truncated };
}

interface Pt { x: number; y: number; px: number; py: number }

/** Verlet 链求解（纯函数）：pins[f] = 第 f 帧的钉点（链根世界
 * 位置 px），lengths[f][i] = 第 f 帧第 i 段的约束长度（px，
 * 由参考姿态逐帧给出，容忍驱动源自身的伸缩）。init = 第 0 帧
 * 的参考关节位置。返回逐帧关节位置（含钉点）。 */
export function solveVerletChain(
  pins: { x: number; y: number }[],
  lengths: number[][],
  init: { x: number; y: number }[],
  params: ChainBakeParams,
  frameRate: number,
): { x: number; y: number }[][] {
  const n = init.length;
  const pts: Pt[] = init.map((q) => ({ x: q.x, y: q.y, px: q.x, py: q.y }));
  const dt = 1 / Math.max(1, frameRate);
  const keep = 1 - Math.max(0, Math.min(0.2, params.damping));
  const iters = Math.max(1, Math.min(24, Math.round(params.iterations)));
  const out: { x: number; y: number }[][] = [];
  for (let f = 0; f < pins.length; f++) {
    const pin = pins[f];
    pts[0].x = pin.x; pts[0].y = pin.y; pts[0].px = pin.x; pts[0].py = pin.y;
    // 第 0 帧 = 初始姿态原样（烘焙起点与作者姿态连续，不先迈一步）
    if (f === 0) { out.push(pts.map((p) => ({ x: p.x, y: p.y }))); continue; }
    for (let i = 1; i < n; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * keep;
      const vy = (p.y - p.py) * keep;
      p.px = p.x; p.py = p.y;
      p.x += vx + params.windX * dt * dt;
      p.y += vy + params.gravity * dt * dt;
    }
    for (let it = 0; it < iters; it++) {
      pts[0].x = pin.x; pts[0].y = pin.y;
      for (let i = 0; i + 1 < n; i++) {
        const a = pts[i], b = pts[i + 1];
        const want = lengths[f][i];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) { dx = 0; dy = 1; d = 1; }
        const diff = (d - want) / d;
        if (i === 0) {
          b.x -= dx * diff; b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
        }
      }
    }
    out.push(pts.map((p) => ({ x: p.x, y: p.y })));
  }
  return out;
}

/** 参考采样：把链上节点的 angle 轨道钉在基准值（fromFrame 处
 * 的本地角）后逐帧 FK，得到参考关节位置与各节点参考世界角。
 * 这定义了「没有链摆时链该在哪」，烘焙量是相对它的增量。 */
export function sampleReference(
  character: Character,
  chainNodeIds: string[],
  fromFrame: number,
  toFrame: number,
  frameRate: number,
): { joints: { x: number; y: number }[][]; worldAngles: number[][]; baseLocals: number[] } {
  const baseLocals = chainNodeIds.map((id) => {
    const tr = character.nodes[id]?.tracks?.angle;
    if (tr && tr.keyframes.length > 0) {
      // 基准 = fromFrame 处的插值角：用单帧 FK 前先简化取最近关键帧值
      let v = character.nodes[id].transform.angle ?? 0;
      for (const kf of tr.keyframes) if (kf.frame <= fromFrame) v = kf.value;
      return v;
    }
    return character.nodes[id]?.transform.angle ?? 0;
  });
  const refChar: Character = {
    ...character,
    nodes: Object.fromEntries(Object.values(character.nodes).map((n) => {
      const idx = chainNodeIds.indexOf(n.id);
      if (idx < 0) return [n.id, n];
      const base = baseLocals[idx];
      return [n.id, {
        ...n,
        tracks: {
          ...n.tracks,
          angle: { keyframes: [{ frame: 0, value: base }], interpolation: 'linear' as const },
        },
      }];
    })),
  } as Character;
  const joints: { x: number; y: number }[][] = [];
  const worldAngles: number[][] = [];
  for (let f = fromFrame; f <= toFrame; f++) {
    const map = computeWorldTransforms(refChar, f, 800, 800, frameRate);
    joints.push(chainNodeIds.map((id) => {
      const w = map.get(id);
      return w ? { x: subToPx(w.worldX), y: subToPx(w.worldY) } : { x: 0, y: 0 };
    }));
    worldAngles.push(chainNodeIds.map((id) => map.get(id)?.worldAngle ?? 0));
  }
  return { joints, worldAngles, baseLocals };
}

/** 烘焙指纹：链结构 + 参数 + 帧窗 + 参考关节采样（0.5px 量化）
 * 的哈希。任一输入变了指纹即变 —— 过期判定只认它。 */
export function chainBakeFingerprint(
  chainNodeIds: string[],
  params: ChainBakeParams,
  fromFrame: number,
  toFrame: number,
  refJoints: { x: number; y: number }[][],
): string {
  let h = 2166136261;
  const mix = (num: number) => {
    h ^= (num | 0) + 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 16777619);
  };
  for (const id of chainNodeIds) for (let i = 0; i < id.length; i++) mix(id.charCodeAt(i));
  mix(Math.round(params.gravity * 10)); mix(Math.round(params.windX * 10));
  mix(Math.round(params.damping * 1000)); mix(params.iterations);
  mix(fromFrame); mix(toFrame);
  for (const row of refJoints) for (const q of row) { mix(Math.round(q.x * 2)); mix(Math.round(q.y * 2)); }
  h ^= h >>> 13; h = Math.imul(h, 16777619); h ^= h >>> 16;
  return (h >>> 0).toString(16);
}

export interface ChainBakeResult {
  record: ChainBakeRecord;
  /** nodeId → 新 angle 轨道（帧窗内的关键帧已换成烘焙值，窗外保留） */
  angleTracks: Record<string, KeyframeTrack>;
}

/** 执行一次烘焙（纯计算，不改 character）：采样参考 → 求解 →
 * 把逐帧段方向增量折回各节点的本地 angle 关键帧。 */
export function bakeChainSwing(
  character: Character,
  chainNodeIds: string[],
  params: ChainBakeParams,
  fromFrame: number,
  toFrame: number,
  frameRate: number,
): ChainBakeResult {
  const ref = sampleReference(character, chainNodeIds, fromFrame, toFrame, frameRate);
  const pins = ref.joints.map((row) => row[0]);
  const lengths = ref.joints.map((row) => {
    const ls: number[] = [];
    for (let i = 0; i + 1 < row.length; i++) {
      ls.push(Math.hypot(row[i + 1].x - row[i].x, row[i + 1].y - row[i].y));
    }
    return ls;
  });
  const solved = solveVerletChain(pins, lengths, ref.joints[0], params, frameRate);
  const frames = toFrame - fromFrame + 1;
  const n = chainNodeIds.length;
  // 逐帧、逐节点的世界角增量：节点 i 的世界角决定第 i 段的段向，
  // 故 Δ_i = 解出段向 − 参考段向；末节点无自有段，世界增量取
  // 上一段的增量（刚性延续，本地角因此保持基准）。
  const worldDelta: number[][] = [];
  for (let fi = 0; fi < frames; fi++) {
    const row: number[] = [];
    for (let ci = 0; ci < n; ci++) {
      if (ci + 1 < n) {
        const segA = Math.atan2(
          solved[fi][ci + 1].y - solved[fi][ci].y, solved[fi][ci + 1].x - solved[fi][ci].x);
        const segR = Math.atan2(
          ref.joints[fi][ci + 1].y - ref.joints[fi][ci].y,
          ref.joints[fi][ci + 1].x - ref.joints[fi][ci].x);
        let d = ((segA - segR) * 180) / Math.PI;
        if (d > 180) d -= 360; else if (d < -180) d += 360;
        row.push(d);
      } else {
        row.push(n >= 2 ? row[ci - 1] : 0);
      }
    }
    worldDelta.push(row);
  }
  // 本地角 = 基准本地角 + 本节点世界增量 − 父节点世界增量
  const angleTracks: Record<string, KeyframeTrack> = {};
  for (let ci = 0; ci < n; ci++) {
    const id = chainNodeIds[ci];
    const old = character.nodes[id]?.tracks?.angle;
    const kfs = (old?.keyframes ?? []).filter((kf) => kf.frame < fromFrame || kf.frame > toFrame);
    for (let fi = 0; fi < frames; fi++) {
      const v = ref.baseLocals[ci] + worldDelta[fi][ci] - (ci > 0 ? worldDelta[fi][ci - 1] : 0);
      kfs.push({ frame: fromFrame + fi, value: Math.round(v * 100) / 100 });
    }
    kfs.sort((a, b) => a.frame - b.frame);
    angleTracks[id] = { keyframes: kfs, interpolation: old?.interpolation ?? 'linear' };
  }
  const fingerprint = chainBakeFingerprint(chainNodeIds, params, fromFrame, toFrame, ref.joints);
  return {
    record: {
      fingerprint, fromFrame, toFrame, params: { ...params },
      chainNodeIds: [...chainNodeIds], baseLocals: [...ref.baseLocals],
    },
    angleTracks,
  };
}

/** 按当前状态重算指纹，与存档比对：true = 烘焙仍新鲜。 */
export function isChainBakeFresh(
  character: Character,
  record: ChainBakeRecord,
  frameRate: number,
): boolean {
  const ref = sampleReference(character, record.chainNodeIds, record.fromFrame, record.toFrame, frameRate);
  const fp = chainBakeFingerprint(record.chainNodeIds, record.params, record.fromFrame, record.toFrame, ref.joints);
  return fp === record.fingerprint;
}
