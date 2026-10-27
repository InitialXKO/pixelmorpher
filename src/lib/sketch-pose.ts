// 草图捕姿（借 PoseSketcher 一笔画姿态的交互）：画布草图笔触 →
// 归属 IK 链（起笔吸附链根/链尾关节）→ 目标点经既有 IK 口径
// （solveChainIKOverrides，与渲染同一求解）解算 → 落成当前帧
// angle/tilt 关键帧（只写这两轨，其余通道不动，同链烘焙先例）。
import {
  computeWorldTransforms, resolveSpriteTipLength, solveChainIKOverrides,
} from './unified-render';
import {
  frameYAxisWorld, projectToView, pxToSub, subToPx,
  type Character, type IKChain, type Node, type Sprite,
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
  /** 命中链的新目标（确认写入时须同步写回链上）：取解算后姿态的
   * 尖端位（末关节 + frame×尖端长，与渲染 IK 同口径）——启用中的
   * 链若不更新目标，渲染会按旧目标再解算、把落帧姿势弹回去 */
  chainTargets: Record<string, { target3D: { x: number; y: number; z: number }; target: { x: number; y: number } }>;
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
 * 落点语义 = 末端关节落在笔触末端：求解器缺省把「尖端」（末关节
 * 沿 frame 再伸一个尖端长）送到目标，捕姿须以尖端长覆写 0 调用，
 * 否则末端关节会差一个尖端长（无精灵时 = 末段骨长）到不了位。
 */
export function bakeSketchPose(
  character: Character,
  assignments: readonly SketchAssignment[],
  frame: number,
  frameRate: number,
  canvasWidth: number,
  canvasHeight: number,
  globalSprites?: Record<string, Sprite>,
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
    const jointIds = chainJointIds(character, chain);
    const beforeVals = new Map(jointIds.map((id) => [id, overrides.get(id)]));
    solveChainIKOverrides(fkChar, withTarget, fk, canvasWidth, canvasHeight, frame, frameRate, undefined, undefined, overrides, undefined, 0);
    // 本链算没算上：看本链关节的覆写是否新增或变值（不能看全局
    // size/keys——先命中的链会把后面的链误报成已应用）
    const changed = jointIds.some((id) => {
      const now = overrides.get(id);
      const before = beforeVals.get(id);
      return now !== undefined && (before === undefined || before.angle !== now.angle || before.tilt !== now.tilt);
    });
    if (changed) applied.push(chain.id);
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
  // 链目标同步值：解算后姿态的尖端位（尖端长按渲染求解器同口径
  // 解析：链显式值 > 当前精灵 > 末段骨长），确认写入时同步回链上，
  // 启用中的链渲染再解算时目标即此处、姿势不弹回
  const chainTargets: SketchBakeResult['chainTargets'] = {};
  for (const chainId of applied) {
    const chain = chainsById.get(chainId);
    if (!chain) continue;
    const endT = solved.get(chain.endNodeId);
    if (!endT) continue;
    const endDir = endT.variantIndex ?? 6;
    let tipLen = chain.tipLength ?? 0;
    if (tipLen <= 0) tipLen = resolveSpriteTipLength(solvedChar, chain.endNodeId, endDir, globalSprites) ?? 0;
    if (tipLen <= 0) {
      const ids = chainJointIds(character, chain);
      const prevT = ids.length >= 2 ? solved.get(ids[ids.length - 2]) : undefined;
      if (prevT) {
        tipLen = Math.hypot(
          subToPx(endT.worldX) - subToPx(prevT.worldX),
          subToPx(endT.worldY) - subToPx(prevT.worldY),
          subToPx(endT.worldZ) - subToPx(prevT.worldZ),
        );
      }
    }
    const yAxis = frameYAxisWorld(endT.worldFrame, endDir);
    const tip = {
      x: subToPx(endT.worldX) + yAxis.x * tipLen,
      y: subToPx(endT.worldY) + yAxis.y * tipLen,
      z: subToPx(endT.worldZ) + yAxis.z * tipLen,
    };
    const rootT = solved.get(chain.rootNodeId);
    const rootDir = rootT?.variantIndex ?? 6;
    const p = projectToView(pxToSub(tip.x), pxToSub(tip.y), pxToSub(tip.z), rootDir);
    chainTargets[chainId] = {
      target3D: tip,
      target: { x: subToPx(p.canvasX) + canvasWidth / 2, y: subToPx(p.canvasY) + canvasHeight / 2 },
    };
  }
  return { nodes, endError, appliedChainIds: applied, chainTargets };
}
