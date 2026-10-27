// 笔触建角（借 PoseSketcher 笔触生成算法）：一笔躯干主轴 + 四笔四肢
// → pixelmorpher 骨骼节点树。落点/切分用其附录 A 常数：躯干笔长 = 3
// 单位（头 1 + 躯干 2），沿弧长落头/颈/腰，肩/髋横偏 {.4,.15}/{.3,.15}；
// 肢内切分肘 .40/腕 .84、膝 .40/踝 .85（占肢笔长）；缺笔肢体按
// A 势比例（臂 2.6/腿 3.2 单位）直生。静态偏移按 Socket/offset3D 口径
// 写（角色空间、全局像素、Y-down），初始姿态归零。
import {
  createDefaultNode, projectToView, pxToSub, subToPx,
  type Character, type IKChain, type Node,
} from './unified-types';
import { pointAtDistance, polylineLength, type Pt } from './arc-length';

export type { Pt };

export interface StrokeBuildInput {
  /** 躯干主轴笔触（画布 px，Y-down）：起笔在头侧、收笔在腰侧 */
  torso: Pt[];
  armL?: Pt[];
  armR?: Pt[];
  legL?: Pt[];
  legR?: Pt[];
}

export interface StrokeBuildResult {
  /** 关节落点（角色空间 px，原点 = 画布中心入参 center） */
  joints: Record<string, Pt>;
  /** 节点表（可直接写入 Character.nodes） */
  nodes: Record<string, Node>;
  rootNodeId: string;
  /** 笔触起笔吸附结果（limb key → 是否吸附到肩/髋热区） */
  snapped: Record<string, boolean>;
  /** 顺手配的四条 IK 链（镜像 IKChainEditor 建链口径：2bone、默认禁用、
   * 目标 = 静止姿态尖端位、尖端长不写死走动态解析） */
  ikChains: IKChain[];
}

const SUB = (v: number) => pxToSub(v);

/** 躯干落点 + 肩/髋派生点（角色空间） */
export function strokeTorsoJoints(torso: Pt[]): Record<string, Pt> {
  const len = polylineLength(torso);
  const s = len / 3; // 每单位 px（头高）
  const at = (units: number) => {
    const p = pointAtDistance(torso, units * s);
    return { x: p.x, y: p.y };
  };
  const tangentAt = (units: number) => {
    const p = pointAtDistance(torso, units * s);
    return { x: Math.cos(p.angle), y: Math.sin(p.angle) };
  };
  const headCenter = at(0.5);
  const neckTop = at(1.0);
  const neckBottom = at(1.5);
  const midTorso = at(2.25);
  const waist = at(3.0);
  // 肩：颈下附近（1.35 单位）横偏 .4、沿轴 .15（自颈上向下）
  const shBase = at(1.35);
  const shTan = tangentAt(1.35);
  const perp = { x: -shTan.y, y: shTan.x }; // t=(0,1) 时 perp=(-1,0) = 屏幕左
  const shoulder = (sign: number): Pt => ({
    x: shBase.x + perp.x * 0.4 * s * sign + shTan.x * 0.15 * s,
    y: shBase.y + perp.y * 0.4 * s * sign + shTan.y * 0.15 * s,
  });
  // 角色左侧 = 正面视图的屏幕右（sign -1）；右侧 = 屏幕左（sign +1）
  const shoulderL = shoulder(-1);
  const shoulderR = shoulder(1);
  // 髋：腰点横偏 .3、沿轴向上 .15
  const hip = (sign: number): Pt => ({
    x: waist.x + perp.x * 0.3 * s * sign - shTan.x * 0.15 * s,
    y: waist.y + perp.y * 0.3 * s * sign - shTan.y * 0.15 * s,
  });
  const hipL = hip(-1);
  const hipR = hip(1);
  return {
    headCenter, neckTop, neckBottom, midTorso, waist,
    shoulderL, shoulderR, hipL, hipR,
  };
}

/** 一条肢体笔触 → [根关节（吸附后）, 中关节, 末关节, 尖端] */
export function strokeLimbJoints(
  stroke: Pt[] | undefined,
  rootJoint: Pt,
  midRatio: number,
  endRatio: number,
  fallbackDir: Pt,
  fallbackLen: number,
  snapRadius: number,
): { pts: [Pt, Pt, Pt, Pt]; snapped: boolean } {
  if (stroke && stroke.length >= 2 && polylineLength(stroke) > 4) {
    const start = stroke[0]!;
    const snapped = Math.hypot(start.x - rootJoint.x, start.y - rootJoint.y) <= snapRadius;
    const len = polylineLength(stroke);
    const atR = (r: number) => {
      const p = pointAtDistance(stroke, len * r);
      return { x: p.x, y: p.y };
    };
    return {
      pts: [{ ...rootJoint }, atR(midRatio), atR(endRatio), { ...stroke[stroke.length - 1]! }],
      snapped,
    };
  }
  // 缺笔：自根关节沿 fallback 方向按比例直生
  const p = (r: number): Pt => ({
    x: rootJoint.x + fallbackDir.x * fallbackLen * r,
    y: rootJoint.y + fallbackDir.y * fallbackLen * r,
  });
  return { pts: [{ ...rootJoint }, p(midRatio), p(endRatio), p(1)], snapped: false };
}

/**
 * 笔触 → 骨骼节点树。center = 画布坐标→角色空间的原点（画布中心）。
 * 树形：pelvis（根，腰点）→ torso（颈下点）→ head / upper_arm×2；
 * pelvis → upper_leg×2；肢链 upper→lower→hand/foot。
 */
export function buildSkeletonFromStrokes(
  input: StrokeBuildInput,
  opts: { characterId: string; center: Pt; canvasSize?: { w: number; h: number } },
): StrokeBuildResult {
  const rel = (p: Pt): Pt => ({ x: p.x - opts.center.x, y: p.y - opts.center.y });
  const torsoLen = polylineLength(input.torso);
  const s = torsoLen / 3;
  const tj = strokeTorsoJoints(input.torso);
  const snapRadius = 0.6 * s;

  const downOut = (sign: number): Pt => {
    const a = (55 * Math.PI) / 180;
    return { x: sign * Math.cos(a), y: Math.sin(a) };
  };
  // 角色左 = 屏幕右：左臂 fallback 朝屏幕右下
  const armL = strokeLimbJoints(input.armL, tj.shoulderL, 0.4, 0.84, downOut(1), 2.6 * s, snapRadius);
  const armR = strokeLimbJoints(input.armR, tj.shoulderR, 0.4, 0.84, downOut(-1), 2.6 * s, snapRadius);
  const legDown = (sign: number): Pt => ({ x: sign * 0.08, y: 1 });
  const legL = strokeLimbJoints(input.legL, tj.hipL, 0.4, 0.85, legDown(1), 3.2 * s, snapRadius);
  const legR = strokeLimbJoints(input.legR, tj.hipR, 0.4, 0.85, legDown(-1), 3.2 * s, snapRadius);

  const J: Record<string, Pt> = {
    pelvis: rel(tj.waist),
    torso: rel(tj.neckBottom),
    head: rel(tj.neckTop),
    upper_arm_L: rel(armL.pts[0]), lower_arm_L: rel(armL.pts[1]), hand_L: rel(armL.pts[2]),
    upper_arm_R: rel(armR.pts[0]), lower_arm_R: rel(armR.pts[1]), hand_R: rel(armR.pts[2]),
    upper_leg_L: rel(legL.pts[0]), lower_leg_L: rel(legL.pts[1]), foot_L: rel(legL.pts[2]),
    upper_leg_R: rel(legR.pts[0]), lower_leg_R: rel(legR.pts[1]), foot_R: rel(legR.pts[2]),
  };

  const cid = opts.characterId;
  const nodes: Record<string, Node> = {};
  const mk = (key: string, name: string, parentKey?: string): Node => {
    const node = createDefaultNode(`node_${cid}_${key}`, name);
    if (parentKey) node.parentId = nodes[parentKey]!.id;
    nodes[key] = node;
    return node;
  };
  const pelvis = mk('pelvis', 'pelvis');
  const torso = mk('torso', 'torso', 'pelvis');
  mk('head', 'head', 'torso');
  mk('upper_arm_L', 'upper_arm_L', 'torso');
  mk('lower_arm_L', 'lower_arm_L', 'upper_arm_L');
  mk('hand_L', 'hand_L', 'lower_arm_L');
  mk('upper_arm_R', 'upper_arm_R', 'torso');
  mk('lower_arm_R', 'lower_arm_R', 'upper_arm_R');
  mk('hand_R', 'hand_R', 'lower_arm_R');
  mk('upper_leg_L', 'upper_leg_L', 'pelvis');
  mk('lower_leg_L', 'lower_leg_L', 'upper_leg_L');
  mk('foot_L', 'foot_L', 'lower_leg_L');
  mk('upper_leg_R', 'upper_leg_R', 'pelvis');
  mk('lower_leg_R', 'lower_leg_R', 'upper_leg_R');
  mk('foot_R', 'foot_R', 'lower_leg_R');
  // children 反向登记
  for (const n of Object.values(nodes)) {
    if (n.parentId) {
      const parent = Object.values(nodes).find((p) => p.id === n.parentId)!;
      parent.children = [...parent.children, n.id];
    }
  }
  // Socket/offset3D：子关节 − 父关节（角色空间全局像素，Y-down）
  const parentKeyOf: Record<string, string> = {
    torso: 'pelvis', head: 'torso',
    upper_arm_L: 'torso', lower_arm_L: 'upper_arm_L', hand_L: 'lower_arm_L',
    upper_arm_R: 'torso', lower_arm_R: 'upper_arm_R', hand_R: 'lower_arm_R',
    upper_leg_L: 'pelvis', lower_leg_L: 'upper_leg_L', foot_L: 'lower_leg_L',
    upper_leg_R: 'pelvis', lower_leg_R: 'upper_leg_R', foot_R: 'lower_leg_R',
  };
  for (const [key, parentKey] of Object.entries(parentKeyOf)) {
    const node = nodes[key]!;
    const parent = nodes[parentKey]!;
    const sockId = `sock_${key}`;
    parent.sockets = [...parent.sockets, {
      id: sockId, name: key, basePosition: { x: 0, y: 0 }, directionOffsets: {},
      offset3D: {
        x: SUB(J[key]!.x - J[parentKey]!.x),
        y: SUB(J[key]!.y - J[parentKey]!.y),
        z: 0,
      },
    }];
    node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as Node['attachment'];
  }
  // 根：位移到腰点（角色空间），朝向正面 6，姿态其余归零
  pelvis.transform = {
    ...pelvis.transform,
    x: SUB(J.pelvis!.x), y: SUB(J.pelvis!.y),
    variantIndex: 6 as Node['transform']['variantIndex'],
  };

  // Character.nodes 以 node.id 为键（全仓口径），内部短键在此转正
  const nodesById: Record<string, Node> = {};
  for (const n of Object.values(nodes)) nodesById[n.id] = n;

  // 顺手配链：四条肢链（2bone、默认禁用，同 IKChainEditor 建链口径）。
  // 目标 = 静止姿态的尖端位：末关节 + 其 frame 的 +Y 轴 × 尖端长；
  // 静止姿态 frame +Y = 角色空间 +Y（向下），无精灵时尖端长 = 末段骨长。
  // tipLength 不写死：启用后走动态解析（有精灵时按精灵 plug→底端）。
  const canvas = opts.canvasSize ?? { w: opts.center.x * 2, h: opts.center.y * 2 };
  const mkChain = (key: string, rootKey: string, midKey: string, endKey: string): IKChain => {
    const end = J[endKey]!, mid = J[midKey]!;
    const lastSeg = Math.hypot(end.x - mid.x, end.y - mid.y);
    const tip = { x: end.x, y: end.y + lastSeg, z: 0 };
    const proj = projectToView(pxToSub(tip.x), pxToSub(tip.y), 0, 6);
    return {
      id: `ik_${key}`,
      name: `${rootKey} → ${endKey}`,
      rootNodeId: nodes[rootKey]!.id,
      endNodeId: nodes[endKey]!.id,
      target: { x: subToPx(proj.canvasX) + canvas.w / 2, y: subToPx(proj.canvasY) + canvas.h / 2 },
      target3D: tip,
      solver: '2bone',
      bendDir: 1,
      enabled: false,
    };
  };
  const ikChains = [
    mkChain('arm_L', 'upper_arm_L', 'lower_arm_L', 'hand_L'),
    mkChain('arm_R', 'upper_arm_R', 'lower_arm_R', 'hand_R'),
    mkChain('leg_L', 'upper_leg_L', 'lower_leg_L', 'foot_L'),
    mkChain('leg_R', 'upper_leg_R', 'lower_leg_R', 'foot_R'),
  ];

  return {
    joints: J,
    nodes: nodesById,
    rootNodeId: pelvis.id,
    snapped: { armL: armL.snapped, armR: armR.snapped, legL: legL.snapped, legR: legR.snapped },
    ikChains,
  };
}

/** 组装完整 Character（供向导创建后写入 store） */
export function buildCharacterFromStrokes(
  input: StrokeBuildInput,
  opts: { characterId: string; name: string; center: Pt; canvasSize?: { w: number; h: number } },
): { character: Partial<Character>; result: StrokeBuildResult } {
  const result = buildSkeletonFromStrokes(input, opts);
  return {
    character: {
      name: opts.name,
      nodes: result.nodes,
      rootNodeId: result.rootNodeId,
      ikChains: result.ikChains,
    },
    result,
  };
}
