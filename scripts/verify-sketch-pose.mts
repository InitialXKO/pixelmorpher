// 草图捕姿探针（行为）：笔触归属 → IK 解算 → 落帧后末端到位。
import { assignSketchStrokes, bakeSketchPose, chainJointIds } from '../src/lib/sketch-pose';
import { computeWorldTransforms } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, projectToView, pxToSub, subToPx,
  worldToViewBasis,
  type Character, type IKChain, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const charId = 'sk1';
const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  if (parentId) n.parentId = parentId;
  return n;
};
const root = mkNode(`node_${charId}_root`, 'torso');
(root.transform as any).variantIndex = 6;
const arm = mkNode(`node_${charId}_arm`, 'upper_arm_R', root.id);
const fore = mkNode(`node_${charId}_fore`, 'lower_arm_R', arm.id);
const hand = mkNode(`node_${charId}_hand`, 'hand_R', fore.id);
root.children = [arm.id];
arm.children = [fore.id];
fore.children = [hand.id];
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
root.sockets = [sock('s_arm', -30, 0)];
arm.sockets = [sock('s_fore', -35, 0)];
fore.sockets = [sock('s_hand', -30, 0)];
const attach = (n: ReturnType<typeof mkNode>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};
attach(arm, 's_arm'); attach(fore, 's_fore'); attach(hand, 's_hand');
// 手节点挂 8×8 精灵（plug 在底部 → IK 尖端长 1px，末端误差可验）
const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill('#cc6633'));
const sprHand: Sprite = { id: 'spr_hand', name: 'hand', width: 8, height: 8, data: grid, plug: { x: pxToSub(4), y: pxToSub(7) } } as Sprite;
const piece = createDefaultCostumePiece('hand_R');
piece.sprites = { 6: { spriteId: sprHand.id } } as never;
hand.slot = piece as never;

const chain: IKChain = {
  id: 'chain_arm_R', name: '右臂', rootNodeId: arm.id, endNodeId: hand.id,
  target: { x: 0, y: 0 }, enabled: false, solver: '2bone', tipLength: 1,
} as IKChain;
const character = {
  id: charId, name: '捕姿测试', nodes: { [root.id]: root, [arm.id]: arm, [fore.id]: fore, [hand.id]: hand },
  rootNodeId: root.id, sprites: {}, costumeSets: [{ id: 'cs1', name: '默认', pieces: { hand_R: piece } }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0, ikChains: [chain],
} as unknown as Character;

const W = 512, H = 512;
const fk = computeWorldTransforms(character, 0, W, H, 12);
const jointCanvas = new Map<string, { x: number; y: number }>();
const endZ = new Map<string, number>(); // 南向 6 下视图深度 == worldZ
for (const [id, t] of fk) {
  const p = projectToView(t.worldX, t.worldY, t.worldZ, 6);
  jointCanvas.set(id, { x: subToPx(p.canvasX) + W / 2, y: subToPx(p.canvasY) + H / 2 });
}
{
  const et = fk.get(hand.id)!;
  endZ.set(chain.id, worldToViewBasis(subToPx(et.worldX), subToPx(et.worldY), subToPx(et.worldZ), 6).d);
}
ok(chainJointIds(character, chain).length === 3, '链关节序列 root→end 共 3 节点');

const shoulderC = jointCanvas.get(arm.id)!;
const handC = jointCanvas.get(hand.id)!;
// 笔触：自肩起笔，划向右下（目标点）
const target = { x: shoulderC.x + 15, y: shoulderC.y + 40 }; // 肩→目标 ≈60px < 链长 65，可达
const stroke = [shoulderC, { x: shoulderC.x + 8, y: shoulderC.y + 22 }, target];
const { assignments, missed } = assignSketchStrokes(character, [stroke], jointCanvas, W, H, endZ, { direction: 6 });
ok(assignments.length === 1 && missed === 0, '笔触归属到右臂链');
ok(assignments[0]!.fromEnd === false, '自链根起笔（正向）');
ok(Math.abs(assignments[0]!.target3D.x - (target.x - W / 2)) < 0.01, '目标 = 笔触末端（原点中心口径）');

// 反向笔：自手腕起笔向外划 → 同样归属，目标 = 笔触末端
const strokeRev = [handC, { x: handC.x + 10, y: handC.y + 30 }, { x: handC.x + 20, y: handC.y + 70 }];
const rev = assignSketchStrokes(character, [strokeRev], jointCanvas, W, H, endZ, { direction: 6 });
ok(rev.assignments.length === 1 && rev.assignments[0]!.fromEnd === true, '自链尾起笔也能归属（反向）');
ok(Math.abs(rev.assignments[0]!.target3D.y - (strokeRev[2]!.y - H / 2)) < 0.01, '反向笔目标 = 笔触末端');

// 远离所有关节的笔触 → 未命中
const farStroke = [{ x: 10, y: 480 }, { x: 60, y: 500 }];
const far = assignSketchStrokes(character, [farStroke], jointCanvas, W, H, endZ, { direction: 6 });
ok(far.assignments.length === 0 && far.missed === 1, '无吸附的笔触计未命中');

const res = bakeSketchPose(character, assignments, 0, 12, W, H);
ok(res.appliedChainIds.includes(chain.id), '烘焙应用了右臂链');
const err = res.endError[chain.id]!;
ok(err < 3, `落帧后末端关节误差 ${err.toFixed(2)}px < 3（尖端 1px 在内）`);
for (const id of [arm.id, fore.id]) {
  const n = res.nodes[id]!;
  ok((n.tracks?.angle?.keyframes ?? []).some((k) => k.frame === 0), `${id === arm.id ? '肩' : '肘'}节点 angle 轨在 0 帧落点`);
}
ok((res.nodes[root.id]!.tracks?.angle?.keyframes.length ?? 0) === 0, '链外节点（躯干）未落帧');
// 原角色不被修改（返回新节点表）
ok((character.nodes[arm.id]!.tracks?.angle?.keyframes.length ?? 0) === 0, '入参角色未被原地修改');

// ===== 夹具 B：真实缺省形态——无精灵、链无 tipLength（火柴人同款）=====
// 回归点：求解器缺省把尖端（末关节再伸一个末段骨长）送到目标，
// 捕姿若不覆写尖端长，末端关节会差整整一个前臂长（30px）到不了位。
const bRoot = mkNode('node_sk2_root', 'torso');
(bRoot.transform as any).variantIndex = 6;
const bArm = mkNode('node_sk2_arm', 'upper_arm_R', bRoot.id);
const bFore = mkNode('node_sk2_fore', 'lower_arm_R', bArm.id);
const bHand = mkNode('node_sk2_hand', 'hand_R', bFore.id);
bRoot.children = [bArm.id];
bArm.children = [bFore.id];
bFore.children = [bHand.id];
bRoot.sockets = [sock('sb_arm', -30, 0)];
bArm.sockets = [sock('sb_fore', -35, 0)];
bFore.sockets = [sock('sb_hand', -30, 0)];
attach(bArm, 'sb_arm'); attach(bFore, 'sb_fore'); attach(bHand, 'sb_hand');
const chainB: IKChain = {
  id: 'chain_sk2_arm', name: '右臂B', rootNodeId: bArm.id, endNodeId: bHand.id,
  target: { x: 0, y: 0 }, enabled: false, solver: '2bone',
} as IKChain;
const charB = {
  id: 'sk2', name: '捕姿测试B', nodes: { [bRoot.id]: bRoot, [bArm.id]: bArm, [bFore.id]: bFore, [bHand.id]: bHand },
  rootNodeId: bRoot.id, sprites: {}, costumeSets: [], activeCostumeSetId: undefined,
  direction: 6, latitude: 0, ikChains: [chainB],
} as unknown as Character;
const fkB = computeWorldTransforms(charB, 0, W, H, 12);
const jointCanvasB = new Map<string, { x: number; y: number }>();
const endZB = new Map<string, number>();
for (const [id, t] of fkB) {
  const p = projectToView(t.worldX, t.worldY, t.worldZ, 6);
  jointCanvasB.set(id, { x: subToPx(p.canvasX) + W / 2, y: subToPx(p.canvasY) + H / 2 });
}
{
  const et = fkB.get(bHand.id)!;
  endZB.set(chainB.id, worldToViewBasis(subToPx(et.worldX), subToPx(et.worldY), subToPx(et.worldZ), 6).d);
}
const shoulderB = jointCanvasB.get(bArm.id)!;
const targetB = { x: shoulderB.x + 15, y: shoulderB.y + 40 };
const strokeB = [shoulderB, { x: shoulderB.x + 8, y: shoulderB.y + 22 }, targetB];
const asgB = assignSketchStrokes(charB, [strokeB], jointCanvasB, W, H, endZB, { direction: 6 });
ok(asgB.assignments.length === 1, 'B 笔触归属到无尖端长链');
const resB = bakeSketchPose(charB, asgB.assignments, 0, 12, W, H);
const errB = resB.endError[chainB.id]!;
ok(errB < 2, `B 无精灵/无尖端长：末端关节误差 ${errB.toFixed(2)}px < 2（旧语义会差约 30）`);
const ctB = resB.chainTargets[chainB.id];
ok(!!ctB, 'B 产出链目标同步值');
if (ctB) {
  const tipDist = Math.hypot(ctB.target3D.x - (targetB.x - W / 2), ctB.target3D.y - (targetB.y - H / 2));
  ok(Math.abs(tipDist - 30) < 3, `B 链目标 = 关节落点再伸末段 30（实际距落点 ${tipDist.toFixed(1)}）`);
  // 启用链 + 同步目标再渲染：末端关节仍应落在笔触点（不被旧目标弹回）
  const charBOn = {
    ...charB, nodes: resB.nodes,
    ikChains: [{ ...chainB, enabled: true, target3D: ctB.target3D, target: ctB.target }],
  } as unknown as Character;
  const fkOn = computeWorldTransforms(charBOn, 0, W, H, 12);
  const endOn = fkOn.get(bHand.id)!;
  const errOn = Math.hypot(subToPx(endOn.worldX) - (targetB.x - W / 2), subToPx(endOn.worldY) - (targetB.y - H / 2));
  ok(errOn < 3, `B 启用链渲染一致性：末端误差 ${errOn.toFixed(2)}px < 3`);
}

// ===== 夹具 C：不可达目标——误差如实报短缺，不假装到位 =====
const targetC = { x: shoulderB.x, y: shoulderB.y + 120 }; // 距肩 120 > 链长 65
const strokeC = [shoulderB, { x: shoulderB.x, y: shoulderB.y + 60 }, targetC];
const asgC = assignSketchStrokes(charB, [strokeC], jointCanvasB, W, H, endZB, { direction: 6 });
const resC = bakeSketchPose(charB, asgC.assignments, 0, 12, W, H);
const errC = resC.endError[chainB.id]!;
ok(resC.appliedChainIds.includes(chainB.id) && Math.abs(errC - 55) < 4,
  `C 不可达：误差 ${errC.toFixed(1)}px ≈ 短缺 55（120 − 链长 65）`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
