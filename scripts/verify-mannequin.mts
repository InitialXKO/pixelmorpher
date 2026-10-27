// 人偶兜底探针（行为，走真实消费路径 generateRenderPlan → mannequinInstructions）：
// ① 开关关 → 空；② 子有精灵 → 只给无精灵的根出人偶；
// ③ 子无精灵 → 根+子各一段，子段起止 = 根关节→子关节（长 ≈ socket 偏移长）；
// ④ attachment.jointWidth=20 → 子段终点半径 10（首选口径）；
// ⑤ 不可见节点 → 不出人偶。
import { generateRenderPlan } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub, subToPx,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const charId = 'mqchar';
const root = createDefaultNode('root', 'root');
root.id = `node_${charId}_0`;
(root.transform as any).variantIndex = 6;
const child = createDefaultNode('limb', 'limb');
child.id = `node_${charId}_1`;
child.parentId = root.id;
root.children = [child.id];
root.sockets = [{
  id: 'sock_1', name: 'limb', basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(30), y: pxToSub(10), z: 0 },
}];
child.attachment = { type: 'socket', parentSocketId: 'sock_1', plug: { x: 0, y: 0 } } as never;

const grid: (string | null)[][] = Array.from({ length: 12 }, () => Array(12).fill('#cc3333'));
const spr: Sprite = {
  id: 'spr_limb_6', name: 'limb d6', width: 12, height: 12, data: grid,
  plug: { x: pxToSub(6), y: pxToSub(11) },
} as Sprite;
const piece = createDefaultCostumePiece('limb');
piece.sprites = { 6: { spriteId: spr.id } } as never;
child.slot = piece as never;

const character = {
  id: charId, name: '人偶测试', nodes: { [root.id]: root, [child.id]: child },
  rootNodeId: root.id, sprites: {},
  costumeSets: [{ id: 'cs1', name: '默认', pieces: { limb: piece } }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
} as unknown as Character;
const sprites: Record<string, Sprite> = { [spr.id]: spr };

const plan = (flag?: boolean) => generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites,
  undefined, undefined, undefined, undefined, undefined, flag);

// ① 开关关 → 空
let mq = plan(false).mannequinInstructions ?? [];
ok(mq.length === 0, `① 开关关：无人偶（实际 ${mq.length}）`);
mq = plan(undefined).mannequinInstructions ?? [];
ok(mq.length === 0, `① 开关缺省：无人偶（实际 ${mq.length}）`);

// ② 子有精灵：只根出人偶（根无精灵、无父 → 起止同点）
mq = plan(true).mannequinInstructions ?? [];
ok(mq.length === 1 && mq[0]!.nodeId === root.id, `② 子有精灵：仅根出人偶（实际 ${mq.map((m) => m.nodeId).join(',')}）`);
ok(mq[0]!.x1 === mq[0]!.x2 && mq[0]!.y1 === mq[0]!.y2, '② 根人偶起止同点（无父连接段）');

// ③ 子无精灵：两段；子段起点 == 根关节、长 ≈ |(30,10)| ≈ 31.6
piece.sprites = {} as never;
mq = plan(true).mannequinInstructions ?? [];
ok(mq.length === 2, `③ 子无精灵：两段人偶（实际 ${mq.length}）`);
const rootMq = mq.find((m) => m.nodeId === root.id)!;
const childMq = mq.find((m) => m.nodeId === child.id)!;
ok(!!rootMq && !!childMq, '③ 根/子人偶齐全');
if (rootMq && childMq) {
  ok(childMq.x1 === rootMq.x2 && childMq.y1 === rootMq.y2, '③ 子段起点 == 根关节');
  const len = Math.hypot(subToPx(childMq.x2) - subToPx(childMq.x1), subToPx(childMq.y2) - subToPx(childMq.y1));
  ok(Math.abs(len - Math.hypot(30, 10)) < 1.5, `③ 子段长 ≈ 31.6（实际 ${len.toFixed(1)}）`);
  const expectR = Math.min(16, Math.max(1.5, Math.hypot(30, 10) * 0.16));
  ok(Math.abs(childMq.r2 - expectR) < 0.01, `③ 无 jointWidth：半径 = 段长×0.16 = ${expectR.toFixed(2)}（实际 ${childMq.r2.toFixed(2)}）`);
}

// ④ jointWidth=20 → r2 = 10
(child.attachment as any).jointWidth = 20;
mq = plan(true).mannequinInstructions ?? [];
const childMq4 = mq.find((m) => m.nodeId === child.id)!;
ok(!!childMq4 && childMq4.r2 === 10, `④ jointWidth 20 → 终点半径 10（实际 ${childMq4?.r2}）`);
delete (child.attachment as any).jointWidth;

// ⑤ 不可见 → 不出
(child as any).visible = false;
mq = plan(true).mannequinInstructions ?? [];
ok(mq.length === 1 && mq[0]!.nodeId === root.id, `⑤ 子不可见：仅根（实际 ${mq.length}）`);
(child as any).visible = true;

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
