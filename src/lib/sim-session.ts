// ============================================================
// 链摆实时模拟会话层（D6 乙路）：链的状态只能顺序步进得到。
// 本层持有每角色一份步进状态 + 每片段起点的初始状态缓存：
// 片段起点状态 = 该帧平结算的链关节位（零初速初始化，与运行
// 时包「表演起点初始化」同口径）；顺序播放逐帧步进；scrub
// 跳帧 = 取片段起点初始状态顺演到目标帧。编辑（角色对象变化）
// 使全部缓存失效（纪元 = 角色对象身份，同 clamp-session）。
// 步进输入只读平结算（computeWorldTransforms 无 ctx 的结果）：
// 每步取当帧链根世界位 + 当帧各段段长（链节点自身平移/拉伸
// 轨道逐帧影响段长，与烘焙同口径）。步进结果折算成本地角增量
// 经 SimContext 注入结算——世界段向与解出段向重合，与烘焙
// 折算同构（chainLocalAngleDeltas）。
// ============================================================
import { computeWorldTransforms, type SimContext } from './unified-render';
import {
  createChainSimState, cloneChainSimState, stepChainSim,
  chainLocalAngleDeltas, realtimeChainDefs,
  type ChainSimState, type ChainSimDef,
} from './sim/verlet-chain';
import { subToPx, type Character } from './unified-types';
import type { AnimationClip } from './types';

export interface SimSessionOpts {
  canvasWidth: number;
  canvasHeight: number;
  frameRate?: number;
}

type ChainStates = Map<string, ChainSimState>;

interface SessionEntry {
  epochObj: Character;
  /** rootId → 活状态（已步进到 steppedTo 帧） */
  live: ChainStates;
  steppedTo: number;
  /** 片段起点帧 → 该起点的初始状态集（由该帧平结算现建） */
  clipStarts: Map<number, ChainStates>;
  /** 活状态当前帧的平结算关节（折算参考用）：rootId → 关节位 */
  liveRef: Map<string, { x: number; y: number }[]>;
}

const sessions = new Map<string, SessionEntry>();

function cloneStates(states: ChainStates): ChainStates {
  const out: ChainStates = new Map();
  for (const [k, v] of states) out.set(k, cloneChainSimState(v));
  return out;
}

function jointsFromMap(
  map: Map<string, { worldX: unknown; worldY: unknown }>,
  chainNodeIds: string[],
): { x: number; y: number }[] {
  return chainNodeIds.map((id) => {
    const t = map.get(id);
    return t
      ? { x: subToPx(t.worldX as never), y: subToPx(t.worldY as never) }
      : { x: 0, y: 0 };
  });
}

function lengthsOf(joints: { x: number; y: number }[]): number[] {
  const ls: number[] = [];
  for (let i = 0; i + 1 < joints.length; i++) {
    ls.push(Math.hypot(joints[i + 1].x - joints[i].x, joints[i + 1].y - joints[i].y));
  }
  return ls;
}

interface ChainJob { rootId: string; def: ChainSimDef }

/** 某帧的模拟上下文（编辑器主画布用）。无实时链返回 undefined。 */
export function editorSimContextFor(
  character: Character,
  frame: number,
  clips: AnimationClip[] | undefined,
  opts: SimSessionOpts,
): SimContext | undefined {
  const defs = realtimeChainDefs(character);
  if (defs.length === 0) return undefined;
  const frameRate = opts.frameRate;
  let entry = sessions.get(character.id);
  if (!entry || entry.epochObj !== character) {
    entry = {
      epochObj: character, live: new Map(), steppedTo: -1,
      clipStarts: new Map(), liveRef: new Map(),
    };
    sessions.set(character.id, entry);
  }
  const jobs: ChainJob[] = defs.map((d) => ({ rootId: d.rootId, def: d.def }));

  const plainAt = (f: number) =>
    computeWorldTransforms(character, f, opts.canvasWidth, opts.canvasHeight, frameRate);

  /** 在帧 f 的平结算上建初始状态集（片段起点语义） */
  const buildInitial = (f: number): ChainStates => {
    const map = plainAt(f);
    const out: ChainStates = new Map();
    for (const job of jobs) {
      out.set(job.rootId, createChainSimState(jointsFromMap(map, job.def.chainNodeIds)));
    }
    return out;
  };
  /** 把活状态步进一帧到 f（读当帧平结算：根位 + 当帧段长） */
  const stepOnce = (f: number) => {
    const map = plainAt(f);
    entry!.liveRef = new Map();
    for (const job of jobs) {
      const joints = jointsFromMap(map, job.def.chainNodeIds);
      entry!.liveRef.set(job.rootId, joints);
      const st = entry!.live.get(job.rootId);
      if (st) stepChainSim(st, joints[0], lengthsOf(joints), job.def.params, frameRate ?? 12);
    }
    entry!.steppedTo = f;
  };
  /** 定位 frame 所在片段起点（无片段覆盖时以 0 为起点） */
  const clipStartOf = (f: number): number => {
    const sorted = [...(clips ?? [])].sort((a, b) => a.startFrame - b.startFrame);
    const clip = sorted.find((c) => f >= c.startFrame && f <= c.endFrame);
    return clip ? clip.startFrame : 0;
  };
  /** 从片段起点初始状态重建活状态并顺演到 frame */
  const rebuildTo = (f: number) => {
    const start = clipStartOf(f);
    let snap = entry!.clipStarts.get(start);
    if (!snap) {
      snap = buildInitial(start);
      entry!.clipStarts.set(start, snap);
    }
    entry!.live = cloneStates(snap);
    entry!.steppedTo = start;
    entry!.liveRef = new Map();
    { // 起点帧的折算参考 = 起点平结算
      const map = plainAt(start);
      for (const job of jobs) entry!.liveRef.set(job.rootId, jointsFromMap(map, job.def.chainNodeIds));
    }
    while (entry!.steppedTo < f) stepOnce(entry!.steppedTo + 1);
  };

  if (entry.steppedTo !== frame) {
    if (entry.steppedTo === frame - 1 && entry.live.size > 0) {
      stepOnce(frame);
    } else {
      rebuildTo(frame);
    }
  }

  const angleDeltas = new Map<string, number>();
  for (const job of jobs) {
    const st = entry.live.get(job.rootId);
    const ref = entry.liveRef.get(job.rootId);
    if (!st || !ref) continue;
    const solved = st.pts.map((p) => ({ x: p.x, y: p.y }));
    const locals = chainLocalAngleDeltas(solved, ref);
    job.def.chainNodeIds.forEach((id, i) => {
      if (locals[i]) angleDeltas.set(id, (angleDeltas.get(id) ?? 0) + locals[i]);
    });
  }
  // 有实时链即返回 ctx（起始帧增量全零时为空表，语义 = 本帧无摆动
  // 增量，与「无实时链」的 undefined 区分开）
  return { angleDeltas };
}

/** 测试/独立入口：从 fromFrame 的平结算初始化，顺序步进到
 * toFrame，返回各链状态（不碰编辑器会话）。 */
export function steppedSimStates(
  character: Character,
  fromFrame: number,
  toFrame: number,
  opts: SimSessionOpts,
): ChainStates {
  const defs = realtimeChainDefs(character);
  const frameRate = opts.frameRate;
  const map0 = computeWorldTransforms(character, fromFrame, opts.canvasWidth, opts.canvasHeight, frameRate);
  const states: ChainStates = new Map();
  for (const { rootId, def } of defs) {
    states.set(rootId, createChainSimState(jointsFromMap(map0, def.chainNodeIds)));
  }
  for (let f = fromFrame + 1; f <= toFrame; f++) {
    const map = computeWorldTransforms(character, f, opts.canvasWidth, opts.canvasHeight, frameRate);
    for (const { rootId, def } of defs) {
      const joints = jointsFromMap(map, def.chainNodeIds);
      const st = states.get(rootId);
      if (st) stepChainSim(st, joints[0], lengthsOf(joints), def.params, frameRate ?? 12);
    }
  }
  return states;
}
