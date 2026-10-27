// 草图捕姿探针（行为）：笔触归属 → IK 解算 → 落帧后末端到位。
import { assignSketchStrokes, bakeSketchPose, chainJointIds } from '../src/lib/sketch-pose';
import { computeWorldTransforms } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, projectToView, pxToSub, subToPx,
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
const endZ = new Map<string, number>();
for (const [id, t] of fk) {
  const p = projectToView(t.worldX, t.worldY, t.worldZ, 6);
  jointCanvas.set(id, { x: subToPx(p.canvasX) + W / 2, y: subToPx(p.canvasY) + H / 2 });
}
endZ.set(chain.id, subToPx(fk.get(hand.id)!.worldZ));
ok(chainJointIds(character, chain).length === 3, '链关节序列 root→end 共 3 节点');

const shoulderC = jointCanvas.get(arm.id)!;
const handC = jointCanvas.get(hand.id)!;
// 笔触：自肩起笔，划向右下（目标点）
const target = { x: shoulderC.x + 15, y: shoulderC.y + 40 }; // 肩→目标 ≈60px < 链长 65，可达
const stroke = [shoulderC, { x: shoulderC.x + 8, y: shoulderC.y + 22 }, target];
const { assignments, missed } = assignSketchStrokes(character, [stroke], jointCanvas, W, H, endZ);
ok(assignments.length === 1 && missed === 0, '笔触归属到右臂链');
ok(assignments[0]!.fromEnd === false, '自链根起笔（正向）');
ok(Math.abs(assignments[0]!.target3D.x - (target.x - W / 2)) < 0.01, '目标 = 笔触末端（原点中心口径）');

// 反向笔：自手腕起笔向外划 → 同样归属，目标 = 笔触末端
const strokeRev = [handC, { x: handC.x + 10, y: handC.y + 30 }, { x: handC.x + 20, y: handC.y + 70 }];
const rev = assignSketchStrokes(character, [strokeRev], jointCanvas, W, H, endZ);
ok(rev.assignments.length === 1 && rev.assignments[0]!.fromEnd === true, '自链尾起笔也能归属（反向）');
ok(Math.abs(rev.assignments[0]!.target3D.y - (strokeRev[2]!.y - H / 2)) < 0.01, '反向笔目标 = 笔触末端');

// 远离所有关节的笔触 → 未命中
const farStroke = [{ x: 10, y: 480 }, { x: 60, y: 500 }];
const far = assignSketchStrokes(character, [farStroke], jointCanvas, W, H, endZ);
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

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
