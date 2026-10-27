// IK 尖端长探针（行为）：缺省尖端长走末关节「当前精灵」解析
// （plug→底端），不再恒回退末段骨长。两处同口径：求解器
// solveChainIKOverrides（经 computeWorldTransforms）与 resolveSpriteTipLength。
import { computeWorldTransforms, resolveSpriteTipLength } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, frameYAxisWorld, pxToSub, subToPx,
  type Character, type IKChain, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const charId = 'tip1';
const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  if (parentId) n.parentId = parentId;
  return n;
};
const root = mkNode(`node_${charId}_root`, 'torso');
const arm = mkNode(`node_${charId}_arm`, 'upper_arm_R', root.id);
const fore = mkNode(`node_${charId}_fore`, 'lower_arm_R', arm.id);
const hand = mkNode(`node_${charId}_hand`, 'hand_R', fore.id);
// 真实角色每个节点的朝向都随角色方向写入（setUnifiedDirection 全节点）
// ——尖端解析按末关节自身朝向取精灵，故夹具须全节点同朝向
for (const n of [root, arm, fore, hand]) (n.transform as any).variantIndex = 6;
root.children = [arm.id];
arm.children = [fore.id];
fore.children = [hand.id];
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
root.sockets = [sock('s_arm', -30, 0)];
arm.sockets = [sock('s_fore', -35, 0)];
fore.sockets = [sock('s_hand', -30, 0)]; // 末段骨长 30
const attach = (n: ReturnType<typeof mkNode>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};
attach(arm, 's_arm'); attach(fore, 's_fore'); attach(hand, 's_hand');
// 手精灵 20 高、plug 在 y=4 → 精灵尖端长 = 16（与末段骨长 30 明显不同）
const grid: (string | null)[][] = Array.from({ length: 20 }, () => Array(8).fill('#cc6633'));
const sprHand: Sprite = { id: 'spr_hand', name: 'hand', width: 8, height: 20, data: grid, plug: { x: pxToSub(4), y: pxToSub(4) } } as Sprite;
const piece = createDefaultCostumePiece('hand_R');
piece.sprites = { 6: { spriteId: sprHand.id } } as never;
hand.slot = piece as never;
const sprites: Record<string, Sprite> = { [sprHand.id]: sprHand };

const chain: IKChain = {
  id: 'chain_arm_R', name: '右臂', rootNodeId: arm.id, endNodeId: hand.id,
  target: { x: 0, y: 0 }, enabled: false, solver: '2bone', // 无 tipLength → 走动态解析
} as IKChain;
const character = {
  id: charId, name: '尖端测试',
  nodes: { [root.id]: root, [arm.id]: arm, [fore.id]: fore, [hand.id]: hand },
  rootNodeId: root.id, sprites, costumeSets: [{ id: 'cs1', name: '默认', pieces: { hand_R: piece } }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0, ikChains: [chain],
} as unknown as Character;

// 1) 解析函数直测：当前精灵 → 16；无精灵表 → undefined（走回退）
ok(resolveSpriteTipLength(character, hand.id, 6, sprites) === 16, '解析：手精灵尖端长 = 20 − plug 4 = 16');
ok(resolveSpriteTipLength(character, hand.id, 6, {}) === 16, '解析：传入空表不遮角色自带表 → 仍 16');
ok(resolveSpriteTipLength({ ...character, sprites: {} } as Character, hand.id, 6, {}) === undefined, '解析：两表皆无精灵 → undefined（回退）');
ok(resolveSpriteTipLength(character, fore.id, 6, sprites) === undefined, '解析：无精灵节点 → undefined');

// 2) 求解器：目标 = 静止尖端位（按精灵尖端长 16 构造）→ 启用后姿态不动；
//    若求解器错用末段骨长 30，末关节会被拉偏 ~14px
const W = 512;
const fk = computeWorldTransforms(character, 0, W, W, 12);
const handT = fk.get(hand.id)!;
const yAxis = frameYAxisWorld(handT.worldFrame, 6);
const target3D = {
  x: subToPx(handT.worldX) + yAxis.x * 16,
  y: subToPx(handT.worldY) + yAxis.y * 16,
  z: subToPx(handT.worldZ) + yAxis.z * 16,
};
const enabled = {
  ...character,
  ikChains: [{ ...chain, enabled: true, target3D }],
} as unknown as Character;
const solved = computeWorldTransforms(enabled, 0, W, W, 12);
const sh = solved.get(hand.id)!;
const drift = Math.hypot(subToPx(sh.worldX - handT.worldX), subToPx(sh.worldY - handT.worldY));
ok(drift < 2, `求解器按精灵尖端长 16 求解：手关节漂移 ${drift.toFixed(2)}px < 2（错用 30 会漂 ~14）`);

// 3) 显式 tipLength 仍优先：写 30 并把目标按 30 构造 → 同样不动
const target30 = {
  x: subToPx(handT.worldX) + yAxis.x * 30,
  y: subToPx(handT.worldY) + yAxis.y * 30,
  z: subToPx(handT.worldZ) + yAxis.z * 30,
};
const enabled30 = {
  ...character,
  ikChains: [{ ...chain, enabled: true, tipLength: 30, target3D: target30 }],
} as unknown as Character;
const solved30 = computeWorldTransforms(enabled30, 0, W, W, 12);
const sh30 = solved30.get(hand.id)!;
const drift30 = Math.hypot(subToPx(sh30.worldX - handT.worldX), subToPx(sh30.worldY - handT.worldY));
ok(drift30 < 2, `显式 tipLength=30 优先于精灵解析：漂移 ${drift30.toFixed(2)}px < 2`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
