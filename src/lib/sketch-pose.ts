// 草图捕姿（借 PoseSketcher 一笔画姿态的交互）：画布草图笔触 →
// 归属 IK 链（起笔吸附链根/链尾关节）→ 目标点经既有 IK 口径
// （solveChainIKOverrides，与渲染同一求解）解算 → 落成当前帧
// angle/tilt 关键帧（只写这两轨，其余通道不动，同链烘焙先例）。
import {
  computeWorldTransforms, solveChainIKOverrides,
} from './unified-render';
import {
  projectToView, pxToSub, subToPx,
  type Character, type IKChain, type Node,
} from './unified-types';
import type { Pt } from './arc-length';

export interface SketchAssignment {
  chainId: string;
  /** 目标（原点中心世界空间 px） */
  target3D: { x: number; y: number; z: number };
  /** 笔触自链的哪一端起笔（root = 正向画，end = 自末端反向画） */
  fromEnd: boolean;
}

/** 链的关节 id 序列 root→end */
export function chainJointIds(character: Character, chain: IKChain): string[] {
  const ids: string[] = [];
  let cur: string | undefined = chain.endNodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    ids.unshift(cur);
    if (cur === chain.rootNodeId) break;
    cur = character.nodes[cur]?.parentId;
  }
  return ids[0] === chain.rootNodeId ? ids : [];
}

/**
 * 笔触归属：每笔起笔点吸附最近的链根/链尾关节（阈值内）；目标 =
 * 笔触另一端。坐标口径：入参 strokes 与 joints 均为画布 px（含中心）。
 */
export function assignSketchStrokes(
  character: Character,
  strokes: readonly (readonly Pt[])[],
  jointCanvas: ReadonlyMap<string, Pt>,
  canvasWidth: number,
  canvasHeight: number,
  endWorldZ: ReadonlyMap<string, number>,
  snapRadius = 56,
): { assignments: SketchAssignment[]; missed: number } {
  const chains = character.ikChains ?? [];
  const assignments: SketchAssignment[] = [];
  const usedChains = new Set<string>();
  let missed = 0;
  for (const stroke of strokes) {
    if (stroke.length < 2) { missed++; continue; }
    const start = stroke[0]!;
    const end = stroke[stroke.length - 1]!;
    let best: { chain: IKChain; fromEnd: boolean; dist: number } | null = null;
    for (const chain of chains) {
      if (usedChains.has(chain.id)) continue;
      const ids = chainJointIds(character, chain);
      if (ids.length < 2) continue;
      const rootPos = jointCanvas.get(chain.rootNodeId);
      const endPos = jointCanvas.get(chain.endNodeId);
      if (rootPos) {
        const d = Math.hypot(start.x - rootPos.x, start.y - rootPos.y);
        if (!best || d < best.dist) best = { chain, fromEnd: false, dist: d };
      }
      if (endPos) {
        const d = Math.hypot(start.x - endPos.x, start.y - endPos.y);
        if (!best || d < best.dist) best = { chain, fromEnd: true, dist: d };
      }
    }
    if (!best || best.dist > snapRadius) { missed++; continue; }
    usedChains.add(best.chain.id);
    // 目标恒为笔触末端：起笔端只是抓取锚点（链根或链尾的当前位），
    // 笔尖落点才是末端关节要去的地方（与对方起笔吸附同一语义）。
    const targetCanvas = end;
    assignments.push({
      chainId: best.chain.id,
      fromEnd: best.fromEnd,
      target3D: {
        x: targetCanvas.x - canvasWidth / 2,
        y: targetCanvas.y - canvasHeight / 2,
        z: endWorldZ.get(best.chain.id) ?? 0,
      },
    });
  }
  return { assignments, missed };
}

export interface SketchBakeResult {
  /** 更新后的节点表（仅命中链节点被改，可整体写回 Character.nodes） */
  nodes: Record<string, Node>;
  /** 每条命中链末端关节与目标的落点误差 px */
  endError: Record<string, number>;
  appliedChainIds: string[];
}

function upsertTrackPoint(
  node: Node,
  trackName: 'angle' | 'tilt',
  frame: number,
  value: number,
): Node {
  const track = node.tracks?.[trackName] ?? { keyframes: [], interpolation: 'linear' as const };
  const kfs = track.keyframes.filter((k) => k.frame !== frame);
  kfs.push({ frame, value });
  kfs.sort((a, b) => a.frame - b.frame);
  return { ...node, tracks: { ...node.tracks, [trackName]: { ...track, keyframes: kfs } } };
}

/**
 * 解算 + 落帧：FK 首遍（链全停用）→ 逐链 solveChainIKOverrides →
 * angle/tilt 写当前帧关键帧 → 重算 FK 验误差。
 */
export function bakeSketchPose(
  character: Character,
  assignments: readonly SketchAssignment[],
  frame: number,
  frameRate: number,
  canvasWidth: number,
  canvasHeight: number,
): SketchBakeResult {
  const chainsById = new Map((character.ikChains ?? []).map((c) => [c.id, c]));
  // 首遍 FK：全部链停用，避免既有 IK 覆写污染基准位姿
  const fkChar: Character = {
    ...character,
    ikChains: (character.ikChains ?? []).map((c) => ({ ...c, enabled: false })),
  };
  const fk = computeWorldTransforms(fkChar, frame, canvasWidth, canvasHeight, frameRate);
  const overrides = new Map<string, { angle: number; tilt: number }>();
  const applied: string[] = [];
  for (const a of assignments) {
    const chain = chainsById.get(a.chainId);
    if (!chain) continue;
    const withTarget: IKChain = {
      ...chain,
      target3D: a.target3D,
      // 保持投影镜像不变式（旧义 target 字段同步）
      target: (() => {
        const rootT = fk.get(chain.rootNodeId);
        const dir = rootT?.variantIndex ?? 6;
        const p = projectToView(pxToSub(a.target3D.x), pxToSub(a.target3D.y), pxToSub(a.target3D.z), dir);
        return { x: subToPx(p.canvasX) + canvasWidth / 2, y: subToPx(p.canvasY) + canvasHeight / 2 };
      })(),
    };
    const before = overrides.size;
    solveChainIKOverrides(fkChar, withTarget, fk, canvasWidth, canvasHeight, frame, frameRate, undefined, undefined, overrides);
    if (overrides.size > before || [...overrides.keys()].some((id) => chainJointIds(character, chain).includes(id))) {
      applied.push(chain.id);
    }
  }
  // 落帧（仅 angle/tilt 两轨）
  const nodes: Record<string, Node> = { ...character.nodes };
  for (const [nodeId, ov] of overrides) {
    const node = nodes[nodeId];
    if (!node) continue;
    nodes[nodeId] = upsertTrackPoint(upsertTrackPoint(node, 'angle', frame, ov.angle), 'tilt', frame, ov.tilt);
  }
  // 验误差：以落帧后的角色在该帧重算 FK，量末端关节与目标距离
  const solvedChar: Character = { ...fkChar, nodes };
  const solved = computeWorldTransforms(solvedChar, frame, canvasWidth, canvasHeight, frameRate);
  const endError: Record<string, number> = {};
  for (const a of assignments) {
    const chain = chainsById.get(a.chainId);
    if (!chain) continue;
    const t = solved.get(chain.endNodeId);
    if (!t) continue;
    endError[chain.id] = Math.hypot(
      subToPx(t.worldX) - a.target3D.x,
      subToPx(t.worldY) - a.target3D.y,
      subToPx(t.worldZ) - a.target3D.z,
    );
  }
  return { nodes, endError, appliedChainIds: applied };
}
