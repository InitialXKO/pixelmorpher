// 人偶兜底探针（行为，走真实消费路径 generateRenderPlan → mannequinInstructions）：
// ① 开关关 → 空；② 子有精灵 → 只给无精灵的根出人偶；
// ③ 子无精灵 → 根+子各一段，子段起止 = 根关节→子关节（长 ≈ socket 偏移长）；
// ④ attachment.jointWidth=20 → 子段终点半径 10（首选口径）；
// ⑤ 不可见节点 → 不出人偶。
import { generateRenderPlan, capsuleTangents } from '../src/lib/unified-render';
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

// ⑥ 手脚延伸：无精灵四肢链末端叶子（腕/踝）伸手掌/脚掌 + 拇指
const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(name, name);
  n.id = id;
  (n.transform as any).variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};
const link = (parent: ReturnType<typeof mkNode>, node: ReturnType<typeof mkNode>, dx: number, dy: number) => {
  const sockId = `sock_${node.id}`;
  parent.children = [...(parent.children ?? []), node.id];
  parent.sockets = [...(parent.sockets ?? []), {
    id: sockId, name: node.name, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(dx), y: pxToSub(dy), z: 0 },
  } as never];
  node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as never;
};
const pelvis = mkNode('mq2_pelvis', 'pelvis');
const uarm = mkNode('mq2_uarm', 'upper_arm_L', pelvis.id);
const farm = mkNode('mq2_farm', 'forearm_L', uarm.id);
const wrist = mkNode('mq2_wrist', 'wrist_L', farm.id);
const thigh = mkNode('mq2_thigh', 'thigh_R', pelvis.id);
const shin = mkNode('mq2_shin', 'shin_R', thigh.id);
const ankle = mkNode('mq2_ankle', 'ankle_R', shin.id);
const headN = mkNode('mq2_head', 'head', pelvis.id);
link(pelvis, uarm, -20, 30);
link(uarm, farm, 0, 30);
link(farm, wrist, 0, 30);
link(pelvis, thigh, 15, 40);
link(thigh, shin, 0, 35);
link(shin, ankle, 0, 35);
link(pelvis, headN, 0, -55);
const nodes2 = Object.fromEntries([pelvis, uarm, farm, wrist, thigh, shin, ankle, headN].map((n) => [n.id, n]));
const character2 = {
  id: 'mqchar2', name: '手脚测试', nodes: nodes2, rootNodeId: pelvis.id, sprites: {},
  costumeSets: [], activeCostumeSetId: undefined, direction: 6, latitude: 0,
} as unknown as Character;
const plan2 = () => generateRenderPlan(character2, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {},
  undefined, undefined, undefined, undefined, undefined, true);
const mq2 = plan2().mannequinInstructions ?? [];
const ext = mq2.filter((m) => m.extremity);
const segLenOf = (m: (typeof mq2)[number]) =>
  Math.hypot(subToPx(m.x2) - subToPx(m.x1), subToPx(m.y2) - subToPx(m.y1));
const hand = ext.find((m) => m.extremity === 'hand');
const thumb = ext.find((m) => m.extremity === 'thumb');
const foot = ext.find((m) => m.extremity === 'foot');
ok(!!hand && hand.nodeId === wrist.id, `⑥ 腕叶子出手掌段（实际 extremities: ${ext.map((m) => m.extremity).join(',')}）`);
ok(!!foot && foot.nodeId === ankle.id, '⑥ 踝叶子出脚掌段');
ok(ext.length === 3, `⑥ 延伸段共 3（手+拇指+脚），非叶子不出（实际 ${ext.length}）`);
if (hand) {
  ok(Math.abs(segLenOf(hand) - 30 * (0.16 / 0.44)) < 1.5, `⑥ 手长 = 前臂 30×(0.16/0.44) ≈ 10.9（实际 ${segLenOf(hand).toFixed(1)}）`);
  const dx = subToPx(hand.x2) - subToPx(hand.x1), dy = subToPx(hand.y2) - subToPx(hand.y1);
  ok(Math.abs(dx) < 1 && dy > 0, '⑥ 手沿末段方向（向下）伸出');
  ok(hand.r2 < hand.r1, '⑥ 手末端半径收小');
}
if (thumb) {
  const along = subToPx(thumb.y2) - subToPx(thumb.y1);
  const perp = Math.abs(subToPx(thumb.x2) - subToPx(thumb.x1));
  ok(Math.abs(along - 10.9 * 0.3) < 1.5 && Math.abs(perp - 10.9 * 0.4) < 1.5,
    `⑥ 拇指：沿手向 0.3 + 法向 0.4（实际沿 ${along.toFixed(1)} / 法 ${perp.toFixed(1)}）`);
}
if (foot) {
  ok(Math.abs(segLenOf(foot) - 35 * (0.15 / 0.45)) < 1.5, `⑥ 脚长 = 小腿 35×(0.15/0.45) ≈ 11.7（实际 ${segLenOf(foot).toFixed(1)}）`);
}
// ⑦ 手指命名的叶子不延伸（指节末端不冒手掌）
(wrist as any).name = 'finger_L';
const ext2 = (plan2().mannequinInstructions ?? []).filter((m) => m.extremity);
ok(ext2.length === 1 && ext2[0]!.extremity === 'foot', `⑦ finger 叶子：只剩脚延伸（实际 ${ext2.map((m) => m.extremity).join(',')}）`);
(wrist as any).name = 'wrist_L';

// ⑧ 蛋形头 + 五官开关：头段（颈长 55）挂蛋形（长半轴 27.5 = 段长/2、
// 宽 = 长 ×0.7、中心 = 头关节）；五官参照关 → 无五官段，开 → 6 段
// 且眼在中心上方、嘴在眼下方、鼻居中
const plan2Fx = (faceGuide: boolean) => generateRenderPlan(character2, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {},
  undefined, undefined, undefined, undefined, undefined, true, { faceGuide });
const headIns = mq2.find((m) => m.nodeId === headN.id && !m.extremity);
ok(!!headIns?.head, '⑧ 头段挂蛋形头');
if (headIns?.head) {
  ok(Math.abs(headIns.head.a - 27.5) < 0.6, `⑧ 长半轴 = 颈段 55/2 = 27.5（实际 ${headIns.head.a.toFixed(1)}）`);
  ok(Math.abs(headIns.head.b - headIns.head.a * 0.7) < 0.6, `⑧ 宽半轴 = 长 ×0.7（实际 ${headIns.head.b.toFixed(1)}）`);
  ok(headIns.head.cx === headIns.x2 && headIns.head.cy === headIns.y2, '⑧ 蛋心 = 头关节');
  ok(headIns.faceSegs === undefined, '⑧ 五官参照关（缺省）：无五官段');
}
const headFx = (plan2Fx(true).mannequinInstructions ?? []).find((m) => m.nodeId === headN.id && !m.extremity);
ok(!!headFx?.faceSegs && headFx.faceSegs.length === 6, `⑧ 五官参照开：6 段五官（实际 ${headFx?.faceSegs?.length}）`);
if (headFx?.head && headFx.faceSegs) {
  const cy = subToPx(headFx.head.cy), cx = subToPx(headFx.head.cx);
  const midY = (s: (typeof headFx.faceSegs)[number]) => (subToPx(s.y1) + subToPx(s.y2)) / 2;
  const midX = (s: (typeof headFx.faceSegs)[number]) => (subToPx(s.x1) + subToPx(s.x2)) / 2;
  ok(midY(headFx.faceSegs[2]!) < cy, '⑧ 眼线在蛋心上方');
  ok(midY(headFx.faceSegs[5]!) > midY(headFx.faceSegs[2]!), '⑧ 嘴线在眼线下方');
  ok(Math.abs(midX(headFx.faceSegs[4]!) - cx) < 1.5, '⑧ 鼻居中');
}

// ⑨ 两端粗细：切线几何（切点在两圆上、切线到两圆心距离 = 各半径、
// 对轴对称）+ 指令起点半径取父关节 jointWidth/2
const tg = capsuleTangents(0, 0, 10, 40, 0, 4);
ok(!!tg, '⑨ 切线几何存在');
if (tg) {
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  ok(Math.abs(dist(tg.t1a, { x: 0, y: 0 }) - 10) < 1e-6, '⑨ 切点在圆 1 上');
  ok(Math.abs(dist(tg.t2a, { x: 40, y: 0 }) - 4) < 1e-6, '⑨ 切点在圆 2 上');
  const lineDist = (p: { x: number; y: number }) =>
    Math.abs((tg.t2a.y - tg.t1a.y) * p.x - (tg.t2a.x - tg.t1a.x) * p.y + tg.t2a.x * tg.t1a.y - tg.t2a.y * tg.t1a.x)
    / dist(tg.t1a, tg.t2a);
  ok(Math.abs(lineDist({ x: 0, y: 0 }) - 10) < 1e-6, '⑨ 切线距圆心 1 = r1（相切）');
  ok(Math.abs(lineDist({ x: 40, y: 0 }) - 4) < 1e-6, '⑨ 切线距圆心 2 = r2（相切）');
  ok(Math.abs(tg.t1a.y + tg.t1b.y) < 1e-6, '⑨ 两侧切点对轴对称');
  ok(Math.abs(tg.beta - Math.acos(6 / 40)) < 1e-9, '⑨ beta = acos((r1−r2)/d)');
}
ok(capsuleTangents(5, 5, 8, 5, 5, 3) === null, '⑨ 同心返回 null（执行端走退化圆）');
(root.attachment as any) = { type: 'socket', jointWidth: 24 };
const childMq9 = (plan(true).mannequinInstructions ?? []).find((m) => m.nodeId === child.id);
ok(!!childMq9 && childMq9.r1 === 12, `⑨ 子段起点半径 = 父 jointWidth/2 = 12（实际 ${childMq9?.r1}）`);

// ⑩ 手脚/头跟末端节点自身旋转：转腕/踝/头节点 90°（关节位置不变），
// 延伸方向/蛋长轴必须跟着转约 90°（此前方向取自段几何、纹丝不动）
const dirOf = (m: (typeof mq2)[number]) => {
  const dx = subToPx(m.x2) - subToPx(m.x1), dy = subToPx(m.y2) - subToPx(m.y1);
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};
const hand0 = (plan2().mannequinInstructions ?? []).find((m) => m.extremity === 'hand')!;
const foot0 = (plan2().mannequinInstructions ?? []).find((m) => m.extremity === 'foot')!;
const head0 = (plan2().mannequinInstructions ?? []).find((m) => m.nodeId === headN.id && !m.extremity)!;
(wrist.transform as any).angle = 90;
(ankle.transform as any).angle = 90;
(headN.transform as any).angle = 90;
const mq10 = plan2().mannequinInstructions ?? [];
const hand1 = mq10.find((m) => m.extremity === 'hand')!;
const foot1 = mq10.find((m) => m.extremity === 'foot')!;
const head1 = mq10.find((m) => m.nodeId === headN.id && !m.extremity)!;
const dotH = Math.abs(dirOf(hand0).x * dirOf(hand1).x + dirOf(hand0).y * dirOf(hand1).y);
const dotF = Math.abs(dirOf(foot0).x * dirOf(foot1).x + dirOf(foot0).y * dirOf(foot1).y);
ok(!!hand1 && dotH < 0.35, `⑩ 转腕 90°：手延伸方向跟着转（与原方向 |dot| ${dotH.toFixed(2)} < 0.35）`);
ok(!!foot1 && dotF < 0.35, `⑩ 转踝 90°：脚延伸方向跟着转（|dot| ${dotF.toFixed(2)} < 0.35）`);
ok(Math.abs(segLenOf(hand1) - segLenOf(hand0)) < 1.5, '⑩ 手长不随旋转变');
if (head0?.head && head1?.head) {
  let dAng = Math.abs(head1.head.angleRad - head0.head.angleRad) % Math.PI;
  if (dAng > Math.PI / 2) dAng = Math.PI - dAng;
  const deg = (dAng * 180) / Math.PI;
  ok(deg > 80 && deg < 100, `⑩ 转头 90°：蛋长轴跟着转 ${deg.toFixed(0)}°`);
} else {
  ok(false, '⑩ 头蛋形缺失');
}
(wrist.transform as any).angle = 0;
(ankle.transform as any).angle = 0;
(headN.transform as any).angle = 0;

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
