// 小参考合集探针（行为）：弧长工具 + 人偶衣物色区 + 空气透视雾量。
import {
  polylineLength, pointAtDistance, pointAtRatio, splitChainAtDistance, splitChainAtRatio,
} from '../src/lib/arc-length';
import { generateRenderPlan } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- 弧长工具 ----
const line = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];
ok(near(polylineLength(line), 70), '总长 70');
const mid = pointAtDistance(line, 50);
ok(near(mid.x, 30) && near(mid.y, 20), `弧长 50 处 = (30,20)（实际 ${mid.x},${mid.y}）`);
const over = pointAtDistance(line, 90);
ok(near(over.x, 30) && near(over.y, 60), `超尾外推 = (30,60)（实际 ${over.x},${over.y}）`);
const neg = pointAtDistance(line, -5);
ok(near(neg.x, 0) && near(neg.y, 0), '负弧长取首点');
const byRatio = pointAtRatio(line, 0.5);
ok(near(byRatio.x, 30) && near(byRatio.y, 5), '比例 0.5 处 = (30,5)');
const [h1, t1] = splitChainAtRatio(line, 0.5);
ok(near(polylineLength(h1), 35) && near(polylineLength(t1), 35), `比例切链：两段各 35（实际 ${polylineLength(h1)}/${polylineLength(t1)}）`);
ok(near(h1[h1.length - 1]!.x, t1[0]!.x) && near(h1[h1.length - 1]!.y, t1[0]!.y), '切链：切点共享');
const [h2, t2] = splitChainAtDistance(line, 30);
ok(h2.length === 2 && near(h2[1]!.x, 30) && near(h2[1]!.y, 0), '在拐点切：前段恰到拐点、无重复点');
ok(t2.length === 2 && near(polylineLength(t2), 40), '在拐点切：后段 = 拐点→尾');

// ---- 衣物色区（走 generateRenderPlan 真实路径） ----
const charId = 'clothchar';
const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  if (parentId) n.parentId = parentId;
  return n;
};
const root = mkNode(`node_${charId}_root`, 'torso');
(root.transform as any).variantIndex = 6;
const arm = mkNode(`node_${charId}_arm`, 'arm_L', root.id);
const fore = mkNode(`node_${charId}_fore`, 'forearm_L', arm.id);
const leg = mkNode(`node_${charId}_leg`, 'leg_L', root.id);
const shin = mkNode(`node_${charId}_shin`, 'shin_L', leg.id);
root.children = [arm.id, leg.id];
arm.children = [fore.id];
leg.children = [shin.id];
const sock = (id: string, x: number, y: number, z = 0) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: pxToSub(z) },
});
root.sockets = [sock('s_arm', 40, 0), sock('s_leg', 0, 40)];
arm.sockets = [sock('s_fore', 40, 0)];
leg.sockets = [sock('s_shin', 0, 40)];
const attach = (n: ReturnType<typeof mkNode>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};
attach(arm, 's_arm'); attach(fore, 's_fore'); attach(leg, 's_leg'); attach(shin, 's_shin');
const nodes = { [root.id]: root, [arm.id]: arm, [fore.id]: fore, [leg.id]: leg, [shin.id]: shin };
const character = {
  id: charId, name: '衣物测试', nodes, rootNodeId: root.id, sprites: {},
  costumeSets: [], activeCostumeSetId: null, direction: 6, latitude: 0,
} as unknown as Character;

const planFx = (fx?: { sleeveRatio?: number; pantsRatio?: number; fogStrength?: number }) =>
  generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {},
    undefined, undefined, undefined, undefined, undefined, true, fx);

let mq = planFx({ sleeveRatio: 0.5, pantsRatio: 0.25 }).mannequinInstructions ?? [];
const byId = (id: string) => mq.find((m) => m.nodeId === id);
ok(mq.filter((m) => m.nodeId === root.id).every((m) => m.clothRatio === undefined), '袖口/裤腰：链根挂接段（归躯干）不染色');
ok(near(byId(arm.id)?.clothRatio ?? -1, 0.5), `袖口 50%：肩→肘段（归肩）染一半（实际 ${byId(arm.id)?.clothRatio}）`);
ok(near(byId(leg.id)?.clothRatio ?? -1, 0.25), `裤腰 25%：髋→膝段（归髋）染 1/4（实际 ${byId(leg.id)?.clothRatio}）`);
mq = planFx({ sleeveRatio: 0, pantsRatio: 0 }).mannequinInstructions ?? [];
ok(mq.every((m) => m.clothRatio === undefined), '比例 0：全段不染色');
mq = planFx(undefined).mannequinInstructions ?? [];
ok(mq.every((m) => m.clothRatio === undefined), '无 editorFx：不染色');

// ---- 空气透视（深度不同的两精灵节点） ----
const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill('#3366cc'));
const sprNear: Sprite = { id: 'spr_near', name: 'near', width: 8, height: 8, data: grid, plug: { x: pxToSub(4), y: pxToSub(7) } } as Sprite;
const sprFar: Sprite = { id: 'spr_far', name: 'far', width: 8, height: 8, data: grid, plug: { x: pxToSub(4), y: pxToSub(7) } } as Sprite;
const pieceNear = createDefaultCostumePiece('near');
pieceNear.sprites = { 6: { spriteId: sprNear.id } } as never;
const pieceFar = createDefaultCostumePiece('far');
pieceFar.sprites = { 6: { spriteId: sprFar.id } } as never;
const nearNode = mkNode(`node_${charId}_near`, 'near', root.id);
const farNode = mkNode(`node_${charId}_far`, 'far', root.id);
root.children = [...root.children, nearNode.id, farNode.id];
root.sockets = [...root.sockets, sock('s_near', 20, 0, 0), sock('s_far', -20, 0, 60)];
attach(nearNode, 's_near'); attach(farNode, 's_far');
nearNode.slot = pieceNear as never;
farNode.slot = pieceFar as never;
const char2 = {
  ...character,
  nodes: { ...nodes, [nearNode.id]: nearNode, [farNode.id]: farNode },
  costumeSets: [{ id: 'cs1', name: '默认', pieces: { near: pieceNear, far: pieceFar } }],
  activeCostumeSetId: 'cs1',
} as unknown as Character;
const sprites2: Record<string, Sprite> = { [sprNear.id]: sprNear, [sprFar.id]: sprFar };
const plan2 = generateRenderPlan(char2, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites2,
  undefined, undefined, undefined, undefined, undefined, false, { fogStrength: 1 });
const fogOf = (id: string) => plan2.nodeInstructions.find((i) => i.nodeId === id)?.fogAmount;
ok(plan2.nodeInstructions.length >= 2, `雾：两节点出指令（实际 ${plan2.nodeInstructions.length}）`);
const fNear = fogOf(nearNode.id), fFar = fogOf(farNode.id);
ok(fNear !== undefined && fFar !== undefined, '雾：两节点都有雾量');
if (fNear !== undefined && fFar !== undefined) {
  ok(Math.abs(fNear - fFar) > 0.01, `雾：深度不同雾量不同（近 ${fNear.toFixed(3)} / 远 ${fFar.toFixed(3)}）`);
  ok(Math.max(fNear, fFar) <= 0.85 + 1e-9 && Math.min(fNear, fFar) >= 0, '雾：雾量在 [0, 0.85] 内（强度 1）');
}
const plan3 = generateRenderPlan(char2, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites2);
ok(plan3.nodeInstructions.every((i) => i.fogAmount === undefined), '雾：强度缺省时不写雾量');

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
