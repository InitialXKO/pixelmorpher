// 草图捕姿（借 PoseSketcher 一笔画姿态的交互）：画布草图笔触 →
// 归属 IK 链（起笔吸附链根/链尾关节）→ 目标点经既有 IK 口径
// （solveChainIKOverrides，与渲染同一求解）解算 → 落成当前帧
// angle/tilt 关键帧（只写这两轨，其余通道不动，同链烘焙先例）。
import {
  computeWorldTransforms, facingYawDeltaRad, resolveSpriteTipLength,
  rotateWorldTransformsForYaw, solveChainIKOverrides, type WorldTransform,
} from './unified-render';
import {
  frameYAxisWorld, projectToView, pxToSub, subToPx, viewBasisToWorld,
  worldToViewBasis, type Character, type DirectionIndex, type IKChain,
  type Node, type Sprite,
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

export interface SketchDisplayFrame {
  /** 关节点位（工程画布 px，含中心）——与主画布底图逐点同源 */
  canvas: Map<string, Pt>;
  /** 每条链末端关节在显示口径下的视图深度 d（px）：笔触目标换算
   * 时保持此深度（笔尖在平行于视面的平面内拖动） */
  endDepth: Map<string, number>;
  /** 全角色单一投影方向 = 根节点世界变换的 variantIndex（主渲染口径） */
  direction: DirectionIndex;
  /** 连续偏航增量（弧度）：主渲染在几何基准关闭且 facingAngle
   * 存在时对世界变换施加的同一旋转；解算空间不含此旋转，目标
   * 换算时须逆转回来 */
  yawDeltaRad: number;
  /** 本次计算实际用的世界变换（已含偏航旋转，与底图同源） */
  worldTransforms: Map<string, WorldTransform>;
}

/**
 * 对话框显示帧：与主渲染 generateRenderPlan 完全同源的取位口径——
 * computeWorldTransforms 带同一 geometryDirection、全角色按根节点
 * variantIndex 单一方向投影、facingAngle 偏航同条件施加。此前对话
 * 框裸调 FK 且逐节点各按各的 variantIndex 投影：改根朝向时肢体
 * 节点还停在旧方向（金圈与精灵错位可达百余 px）、开节点转向或
 * 连续偏航时底图动而关节点位不动。
 */
export function sketchDisplayFrame(
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  frameRate: number,
  geometryDirection?: DirectionIndex,
): SketchDisplayFrame {
  const wt = computeWorldTransforms(
    character, frame, canvasWidth, canvasHeight, frameRate,
    undefined, undefined, undefined, geometryDirection,
  );
  const direction = (wt.get(character.rootNodeId)?.variantIndex ?? 6) as DirectionIndex;
  const yawDeltaRad = geometryDirection === undefined && character.facingAngle !== undefined
    ? facingYawDeltaRad(character.facingAngle, direction)
    : 0;
  if (yawDeltaRad !== 0) rotateWorldTransformsForYaw(wt, yawDeltaRad, geometryDirection);
  const canvas = new Map<string, Pt>();
  for (const [id, t] of wt) {
    const p = projectToView(t.worldX, t.worldY, t.worldZ, direction);
    canvas.set(id, { x: subToPx(p.canvasX) + canvasWidth / 2, y: subToPx(p.canvasY) + canvasHeight / 2 });
  }
  const endDepth = new Map<string, number>();
  for (const chain of character.ikChains ?? []) {
    const end = wt.get(chain.endNodeId);
    if (!end) continue;
    endDepth.set(chain.id, worldToViewBasis(
      subToPx(end.worldX), subToPx(end.worldY), subToPx(end.worldZ), direction,
    ).d);
  }
  return { canvas, endDepth, direction, yawDeltaRad, worldTransforms: wt };
}

/**
 * 笔触归属：每笔起笔点吸附最近的链根/链尾关节（阈值内）；目标 =
 * 笔触另一端。坐标口径：入参 strokes 与 joints 均为画布 px（含中心）。
 * 目标换算（画布 → 解算世界）：按显示方向逆投影（viewBasisToWorld，
 * 与 resolveChainTarget3D 同一换算），深度保持末端关节当前视图深
 * 度；显示帧带偏航时再逆转偏航回到解算空间。此前直接把画布 x/y
 * 当世界 x/y、z 塞世界 Z——只在南向（6）时与逆投影逐值重合，换
 * 朝向后解算落点在画布上偏出十余 px（3D 自报误差却很小，因为求
 * 解器在错误目标上自洽）。
 */
export function assignSketchStrokes(
  character: Character,
  strokes: readonly (readonly Pt[])[],
  jointCanvas: ReadonlyMap<string, Pt>,
  canvasWidth: number,
  canvasHeight: number,
  endViewDepth: ReadonlyMap<string, number>,
  view: { direction: DirectionIndex; yawDeltaRad?: number },
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
    const disp = viewBasisToWorld(
      targetCanvas.x - canvasWidth / 2,
      targetCanvas.y - canvasHeight / 2,
      endViewDepth.get(best.chain.id) ?? 0,
      view.direction,
    );
    let target3D = disp;
    const yaw = view.yawDeltaRad ?? 0;
    if (yaw !== 0) {
      // 显示世界 = 解算世界绕竖直轴 +yaw（rotateWorldTransformsForYaw
      // 的 x/z 公式），目标回到解算空间须逆转 −yaw
      const c = Math.cos(yaw), s = Math.sin(yaw);
      target3D = { x: disp.x * c - disp.z * s, y: disp.y, z: disp.x * s + disp.z * c };
    }
    assignments.push({
      chainId: best.chain.id,
      fromEnd: best.fromEnd,
      target3D,
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
  // 几何基准朝向（编辑器节点转向开关）：与渲染同一参数——FK、求解
  // 器内部的段向还原/目标解析、验误差 FK 全部同源；不传 = 现行口径。
  geometryDirection?: DirectionIndex,
): SketchBakeResult {
  const chainsById = new Map((character.ikChains ?? []).map((c) => [c.id, c]));
  // 首遍 FK：全部链停用，避免既有 IK 覆写污染基准位姿
  const fkChar: Character = {
    ...character,
    ikChains: (character.ikChains ?? []).map((c) => ({ ...c, enabled: false })),
  };
  const fk = computeWorldTransforms(fkChar, frame, canvasWidth, canvasHeight, frameRate, undefined, undefined, undefined, geometryDirection);
  const overrides = new Map<string, { angle: number; tilt: number }>();
  const applied: string[] = [];
  for (const a of assignments) {
    const chain = chainsById.get(a.chainId);
    if (!chain) continue;
    const withTarget: IKChain = {
      ...chain,
      target3D: a.target3D,
      // 保持投影镜像不变式（旧义 target 字段同步）：投影方向与求解
      // 器内部的目标解析方向（dir0）同源
      target: (() => {
        const rootT = fk.get(chain.rootNodeId);
        const dir = geometryDirection ?? rootT?.variantIndex ?? 6;
        const p = projectToView(pxToSub(a.target3D.x), pxToSub(a.target3D.y), pxToSub(a.target3D.z), dir);
        return { x: subToPx(p.canvasX) + canvasWidth / 2, y: subToPx(p.canvasY) + canvasHeight / 2 };
      })(),
    };
    const jointIds = chainJointIds(character, chain);
    const beforeVals = new Map(jointIds.map((id) => [id, overrides.get(id)]));
    solveChainIKOverrides(fkChar, withTarget, fk, canvasWidth, canvasHeight, frame, frameRate, undefined, undefined, overrides, geometryDirection, 0);
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
  const solved = computeWorldTransforms(solvedChar, frame, canvasWidth, canvasHeight, frameRate, undefined, undefined, undefined, geometryDirection);
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
    // 尖端长解析与 frame 朝向基与求解器内部同口径（geometryDirection 优先）
    const endDir = geometryDirection ?? endT.variantIndex ?? 6;
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
    const rootDir = geometryDirection ?? rootT?.variantIndex ?? 6;
    const p = projectToView(pxToSub(tip.x), pxToSub(tip.y), pxToSub(tip.z), rootDir);
    chainTargets[chainId] = {
      target3D: tip,
      target: { x: subToPx(p.canvasX) + canvasWidth / 2, y: subToPx(p.canvasY) + canvasHeight / 2 },
    };
  }
  return { nodes, endError, appliedChainIds: applied, chainTargets };
}
