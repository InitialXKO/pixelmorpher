// 草图捕姿朝向探针（行为）：朝向改变时关节点位/归属/解算与主渲染同源。
// 回归点（修复前实测）：全员东向时解算画布误差 16.7px、仅根改向时
// 关节点位偏 190px 且归属失败、节点转向开时解算画布误差 48.1px、
// facingAngle=315 时关节点位偏 34.9px——根源是对话框三处没跟朝向：
// 关节点位逐节点 variantIndex 投影（主渲染为根向单一投影）、FK 没
// 传 geometryDirection/没施偏航、笔触目标没做逆投影换算。
import { assignSketchStrokes, bakeSketchPose, sketchDisplayFrame } from '../src/lib/sketch-pose';
import {
  computeWorldTransforms, facingYawDeltaRad, rotateWorldTransformsForYaw,
} from '../src/lib/unified-render';
import {
  createDefaultNode, projectToView, pxToSub, subToPx, worldToViewBasis,
  type Character, type DirectionIndex, type IKChain,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const W = 512, H = 512;
const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  if (parentId) n.parentId = parentId;
  return n;
};
const attach = (n: ReturnType<typeof mkNode>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};

function buildChar(dirAll: DirectionIndex, rootDir?: DirectionIndex, facingAngle?: number) {
  const root = mkNode('d_root', 'torso');
  const arm = mkNode('d_arm', 'upper_arm_R', root.id);
  const fore = mkNode('d_fore', 'lower_arm_R', arm.id);
  const hand = mkNode('d_hand', 'hand_R', fore.id);
  root.children = [arm.id]; arm.children = [fore.id]; fore.children = [hand.id];
  // 根→臂用 2D socket（无 offset3D）：偏移按几何基准朝向映射到 3D，
  // 节点转向开关开/关时 FK 位置真会变（判别 geometryDirection 是否同源）
  root.sockets = [{
    id: 's_arm', name: 's_arm',
    basePosition: { x: pxToSub(-30), y: pxToSub(0) }, directionOffsets: {},
  } as never];
  // 段沿父 frame 的 +Y 走骨（真实骨骼形态：关节沿骨骼主轴推进）。
  // 注：沿局部 X 走骨的段在侧向（0/4）会落到视图深度轴上，共享求
  // 解器的 (angle, tilt) 反解对这类段构造性不可达（主渲染 IK 同
  // 口径，实测回放偏 19.8px）——那是求解器参数化边界、非捕姿层
  // 问题，本探针不覆盖，见交付报告附带发现。
  arm.sockets = [{
    id: 's_fore', name: 's_fore', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(0), y: pxToSub(35), z: pxToSub(-6) },
  } as never];
  fore.sockets = [{
    id: 's_hand', name: 's_hand', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(0), y: pxToSub(30), z: pxToSub(4) },
  } as never];
  attach(arm, 's_arm'); attach(fore, 's_fore'); attach(hand, 's_hand');
  for (const n of [root, arm, fore, hand]) (n.transform as { variantIndex: number }).variantIndex = dirAll;
  if (rootDir !== undefined) (root.transform as { variantIndex: number }).variantIndex = rootDir;
  const chain: IKChain = {
    id: 'chain_d_arm', name: '右臂', rootNodeId: arm.id, endNodeId: hand.id,
    target: { x: 0, y: 0 }, enabled: false, solver: '2bone',
  } as IKChain;
  const character = {
    id: 'skdir', name: '捕姿朝向测试',
    nodes: { [root.id]: root, [arm.id]: arm, [fore.id]: fore, [hand.id]: hand },
    rootNodeId: root.id, sprites: {}, costumeSets: [], activeCostumeSetId: undefined,
    direction: 6, latitude: 0, ikChains: [chain], ...(facingAngle !== undefined ? { facingAngle } : {}),
  } as unknown as Character;
  return { character, chain };
}

/** 主渲染口径（独立照 generateRenderPlan 实现）：geoDir FK → 根向 → 偏航 → 单一投影 */
function referenceCanvas(character: Character, geoDir?: DirectionIndex) {
  const wt = computeWorldTransforms(character, 0, W, H, 12, undefined, undefined, undefined, geoDir);
  const dir = (wt.get(character.rootNodeId)?.variantIndex ?? 6) as DirectionIndex;
  const yaw = geoDir === undefined && character.facingAngle !== undefined
    ? facingYawDeltaRad(character.facingAngle, dir) : 0;
  if (yaw !== 0) rotateWorldTransformsForYaw(wt, yaw, geoDir);
  const map = new Map<string, { x: number; y: number }>();
  for (const [id, t] of wt) {
    const p = projectToView(t.worldX, t.worldY, t.worldZ, dir);
    map.set(id, { x: subToPx(p.canvasX) + W / 2, y: subToPx(p.canvasY) + H / 2 });
  }
  return { map, dir, yaw };
}

function maxDiff(a: Map<string, { x: number; y: number }>, b: Map<string, { x: number; y: number }>) {
  let m = 0;
  for (const [id, p] of a) {
    const q = b.get(id); if (!q) continue;
    m = Math.max(m, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return m;
}

/** 一笔全程：显示帧归属 → 解算 → 落帧后按主渲染口径量末端画布误差 */
function strokeAndMeasure(character: Character, chain: IKChain, geoDir?: DirectionIndex) {
  const disp = sketchDisplayFrame(character, 0, W, H, 12, geoDir);
  const ref = referenceCanvas(character, geoDir);
  const shoulder = ref.map.get(chain.rootNodeId)!;
  const target = { x: shoulder.x + 15, y: shoulder.y + 40 };
  const stroke = [shoulder, { x: shoulder.x + 8, y: shoulder.y + 22 }, target];
  const asg = assignSketchStrokes(character, [stroke], disp.canvas, W, H, disp.endDepth,
    { direction: disp.direction, yawDeltaRad: disp.yawDeltaRad });
  if (asg.assignments.length !== 1) return { disp, ref, assigned: false, canvasErr: Infinity, target3D: null };
  const res = bakeSketchPose(character, asg.assignments, 0, 12, W, H, undefined, geoDir);
  const solvedChar = { ...character, nodes: res.nodes } as Character;
  const refSolved = referenceCanvas(solvedChar, geoDir);
  const endC = refSolved.map.get(chain.endNodeId)!;
  return {
    disp, ref, assigned: true,
    canvasErr: Math.hypot(endC.x - target.x, endC.y - target.y),
    target3D: asg.assignments[0]!.target3D,
  };
}

// ===== 场景 1：基线全员南向 6（与旧行为逐点一致） =====
{
  const { character, chain } = buildChar(6);
  const disp = sketchDisplayFrame(character, 0, W, H, 12);
  const fk = computeWorldTransforms(character, 0, W, H, 12);
  let m = 0;
  for (const [id, t] of fk) {
    const p = projectToView(t.worldX, t.worldY, t.worldZ, 6);
    const q = disp.canvas.get(id)!;
    m = Math.max(m, Math.hypot(q.x - (subToPx(p.canvasX) + W / 2), q.y - (subToPx(p.canvasY) + H / 2)));
  }
  ok(m < 1e-6, `基线6：显示帧与旧裸 FK+南向投影逐点一致（偏差 ${m.toExponential(1)}）`);
  const r = strokeAndMeasure(character, chain);
  ok(r.assigned && r.canvasErr < 1.5, `基线6：一笔解算画布末端误差 ${r.canvasErr.toFixed(2)}px < 1.5`);
}

// ===== 场景 2：全员东向 0（目标逆投影换算） =====
{
  const { character, chain } = buildChar(0);
  const r = strokeAndMeasure(character, chain);
  ok(maxDiff(r.disp.canvas, r.ref.map) < 0.01, '东向0：关节点位与主渲染逐点一致');
  ok(r.disp.direction === 0, '东向0：显示方向 = 根朝向 0');
  ok(r.assigned, '东向0：笔触归属成功');
  // 朴素换算（画布 x/y 直当世界 x/y、z=世界 Z）与新换算必须明显不同——证明换算真做了
  const fk = computeWorldTransforms(character, 0, W, H, 12);
  const endW = fk.get(chain.endNodeId)!;
  const shoulder = r.ref.map.get(chain.rootNodeId)!;
  const naive = { x: shoulder.x + 15 - W / 2, y: shoulder.y + 40 - H / 2, z: subToPx(endW.worldZ) };
  const dNaive = r.target3D ? Math.hypot(r.target3D.x - naive.x, r.target3D.y - naive.y, r.target3D.z - naive.z) : 0;
  ok(dNaive > 5, `东向0：目标经逆投影换算（与朴素换算差 ${dNaive.toFixed(1)}px）`);
  ok(r.canvasErr < 1.5, `东向0：一笔解算画布末端误差 ${r.canvasErr.toFixed(2)}px < 1.5（修复前 16.7）`);
}

// ===== 场景 3：仅根改北向 2、肢体仍 6（根向单一投影） =====
{
  const { character, chain } = buildChar(6, 2);
  const r = strokeAndMeasure(character, chain);
  ok(maxDiff(r.disp.canvas, r.ref.map) < 0.01, `仅根2：关节点位与主渲染逐点一致（修复前偏 190px）`);
  ok(r.assigned, '仅根2：笔触归属成功（修复前未命中）');
  ok(r.canvasErr < 1.5, `仅根2：一笔解算画布末端误差 ${r.canvasErr.toFixed(2)}px < 1.5`);
}

// ===== 场景 4：节点转向开（geometryDirection=6）、全员东向 0 =====
{
  const { character, chain } = buildChar(0);
  const withGeo = sketchDisplayFrame(character, 0, W, H, 12, 6);
  const noGeo = sketchDisplayFrame(character, 0, W, H, 12);
  ok(maxDiff(withGeo.canvas, noGeo.canvas) > 1, '转向开：几何基准真改变了关节点位（夹具判别力）');
  const r = strokeAndMeasure(character, chain, 6);
  ok(maxDiff(r.disp.canvas, r.ref.map) < 0.01, '转向开：关节点位与主渲染（同 geoDir）逐点一致');
  ok(r.canvasErr < 1.5, `转向开：一笔解算画布末端误差 ${r.canvasErr.toFixed(2)}px < 1.5（修复前 48.1）`);
}

// ===== 场景 5：南向 6 + facingAngle=315（连续偏航） =====
{
  const { character, chain } = buildChar(6, undefined, 315);
  const r = strokeAndMeasure(character, chain);
  ok(Math.abs(r.disp.yawDeltaRad - Math.PI / 4) < 1e-9, '偏航：显示帧偏航增量 = 45°');
  ok(maxDiff(r.disp.canvas, r.ref.map) < 0.01, `偏航：关节点位与主渲染逐点一致（修复前偏 34.9px）`);
  ok(r.canvasErr < 1.5, `偏航：一笔解算画布末端误差 ${r.canvasErr.toFixed(2)}px < 1.5`);
  // 深度口径 sanity：endDepth 应等于显示口径下末端的视图深度
  const endT = r.disp.worldTransforms.get(chain.endNodeId)!;
  const dExpect = worldToViewBasis(subToPx(endT.worldX), subToPx(endT.worldY), subToPx(endT.worldZ), r.disp.direction).d;
  ok(Math.abs((r.disp.endDepth.get(chain.id) ?? NaN) - dExpect) < 1e-9, '偏航：链末端视图深度与显示帧同源');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
