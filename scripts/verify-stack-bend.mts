// 堆叠接缝插值旋转探针：
//  单元（computeStackOps）：静止位（增量为零）与无 bend 逐值一致；
//  根端弯曲带内层角单调趋近本帧、带外与刚性逐值一致；尖端层绕
//  摞尖端点送向子侧、带外不变；key 随弯曲变化；短摞双带钳制不炸。
//  集成（stackBendForNode + computeRestWorldTransforms）：轨道把
//  中段节点 tilt 拉起时，bend 自动取到父/子两侧关节，带内算子与
//  刚性不同；第 0 帧（静止位）算子与无 bend 一致。
import { computeStackOps, type StackBend, type StackOpsResult } from '../src/lib/stack-render';
import { computeRestWorldTransforms, computeWorldTransforms, stackBendForNode } from '../src/lib/unified-render';
import {
  createDefaultNode, pxToSub, rotMatU, MAT3_IDENTITY,
} from '../src/lib/unified-types';
import type { Character, Node, Sprite, SpriteStack } from '../src/lib/unified-types';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;

const layerSprites: Sprite[] = [];
for (let i = 0; i < 10; i++) {
  layerSprites.push({ id: `L${i}`, width: 8, height: 8, plug: { x: pxToSub(4), y: pxToSub(4) }, data: [] } as unknown as Sprite);
}
const stack: SpriteStack = {
  layerSpriteIds: layerSprites.map((s) => s.id),
  layerThickness: 4,
  origin: { x: 0, y: 0, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  uAxis: { x: 1, y: 0, z: 0 },
  vAxis: { x: 0, y: 0, z: 1 },
} as SpriteStack;

/** 逐层层心（合成图偏移前坐标）：按层聚合 slab 子步算子后取平均 */
const centersOf = (res: StackOpsResult): { x: number; y: number }[] => {
  const acc = new Map<number, { x: number; y: number; n: number }>();
  for (const op of res.ops) {
    const a = acc.get(op.layer) ?? { x: 0, y: 0, n: 0 };
    a.x += op.tr[4] - res.pivotX + 4 * op.tr[0] + 4 * op.tr[2];
    a.y += op.tr[5] - res.pivotY + 4 * op.tr[1] + 4 * op.tr[3];
    a.n++;
    acc.set(op.layer, a);
  }
  return [...acc.entries()].sort((p, q) => p[0] - q[0]).map(([, v]) => ({ x: v.x / v.n, y: v.y / v.n }));
};
const tiltOf = (c: { x: number; y: number }, dist: number) => (Math.acos(Math.max(-1, Math.min(1, c.y / dist))) * 180) / Math.PI;
const I = MAT3_IDENTITY;

// ---------- (a) 静止位：bend 增量为零 → 与无 bend 逐值一致 ----------
{
  const bend: StackBend = {
    restFrame: I, restAngle: 0,
    parent: { frame: I, angle: 0, restFrame: I, restAngle: 0 },
    child: { frame: I, angle: 0, restFrame: I, restAngle: 0 },
  };
  const base = computeStackOps(stack, layerSprites, I, 0);
  const bent = computeStackOps(stack, layerSprites, I, 0, 45, bend);
  ok(JSON.stringify(base.ops) === JSON.stringify(bent.ops), '(a) 静止位 ops 与无 bend 逐值一致');
  ok(base.key === bent.key, '(a) 静止位 key 不变');
}

// ---------- (b) 根端弯曲：父不动、本节点 tilt 50° ----------
{
  const selfFrame = rotMatU(50);
  const base = computeStackOps(stack, layerSprites, selfFrame, 0);
  const bend: StackBend = {
    restFrame: I, restAngle: 0,
    parent: { frame: I, angle: 0, restFrame: I, restAngle: 0 },
  };
  const bent = computeStackOps(stack, layerSprites, selfFrame, 0, 45, bend);
  const cb = centersOf(base);
  const ct = centersOf(bent);
  const th = ct.map((c, l) => tiltOf(c, (l + 0.5) * 4));
  ok(th[0] < th[1] && th[1] < th[2] && th[2] < th[3], `(b) 带内层角单调趋近本帧 (${th.slice(0, 4).map((v) => v.toFixed(1)).join(' < ')})`);
  const expect0 = 50 * (0.58333 * 0.58333 * (3 - 2 * 0.58333));
  ok(near(th[0], expect0, 1.5), `(b) 首层角 ≈ 50·smoothstep(14/24)=${expect0.toFixed(1)}（实 ${th[0].toFixed(1)}）`);
  ok(near(th[3], 50, 0.6), `(b) 带外层（距根 14 ≥ 带宽 12）角 = 50（实 ${th[3].toFixed(1)}）`);
  ok(near(ct[3].y, cb[3].y, 1e-6) && near(ct[9].y, cb[9].y, 1e-6), '(b) 带外层心与刚性逐值一致');
  ok(ct[0].y > cb[0].y + 0.2, '(b) 首层层心被拉回父侧');
  ok(base.key !== bent.key, '(b) key 随弯曲变化');
}

// ---------- (c) 尖端弯曲：本节点不动、子节点 tilt −40° ----------
{
  const base = computeStackOps(stack, layerSprites, I, 0);
  const bend: StackBend = {
    restFrame: I, restAngle: 0,
    child: { frame: rotMatU(-40), angle: 0, restFrame: I, restAngle: 0 },
  };
  const bent = computeStackOps(stack, layerSprites, I, 0, 45, bend);
  const cb = centersOf(base);
  const ct = centersOf(bent);
  ok(near(ct[0].y, cb[0].y, 1e-9) && near(ct[5].y, cb[5].y, 1e-9), '(c) 带外层（距尖 ≥ 带宽）与刚性逐值一致');
  ok(ct[9].y > cb[9].y + 0.03, `(c) 末层层心绕尖端点送向子侧（刚性 ${cb[9].y.toFixed(2)} → 弯曲 ${ct[9].y.toFixed(2)}）`);
  const lastBase = base.ops.filter((o) => o.layer === 9)[0];
  const lastBent = bent.ops.filter((o) => o.layer === 9)[0];
  ok(lastBent.tr[3] < lastBase.tr[3] - 0.1, '(c) 末层层图基随弯曲转动');
}

// ---------- (e) 短摞双带钳制 ----------
{
  const shortStack = { ...stack, layerSpriteIds: stack.layerSpriteIds.slice(0, 4) };
  const bend: StackBend = {
    restFrame: I, restAngle: 0,
    parent: { frame: I, angle: 0, restFrame: I, restAngle: 0 },
    child: { frame: rotMatU(-40), angle: 0, restFrame: I, restAngle: 0 },
  };
  const bent = computeStackOps(shortStack, layerSprites.slice(0, 4), rotMatU(50), 0, 45, bend);
  const ct = centersOf(bent);
  ok(bent.ops.length > 0 && ct.every((c) => isFinite(c.x) && isFinite(c.y)), '(e) 短摞双带（12+12 > 长 16）钳制后算子有限');
  const th0 = tiltOf(ct[0], 2);
  ok(th0 > 0 && th0 < 50, `(e) 首层角落在两端增量之间（实 ${th0.toFixed(1)}）`);
}

// ---------- (f) 集成：轨道 tilt → stackBendForNode 自动取关节 ----------
{
  const sock = (id: string, x: number, y: number) => ({
    id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
  });
  const mkNode = (id: string, name: string, parentId?: string): Node => {
    const n = createDefaultNode(id, name);
    n.transform.variantIndex = 2;
    if (parentId) n.parentId = parentId;
    return n;
  };
  const R = mkNode('R', 'root');
  const A = mkNode('A', 'upper', 'R');
  const B = mkNode('B', 'fore', 'A');
  R.children = ['A']; A.children = ['B'];
  R.sockets = [sock('sA', 0, 0)] as never;
  A.sockets = [sock('sB', 0, 40)] as never;
  A.attachment = { type: 'socket', parentSocketId: 'sA', plug: { x: 0, y: 0 } } as never;
  B.attachment = { type: 'socket', parentSocketId: 'sB', plug: { x: 0, y: 0 } } as never;
  A.tracks = { tilt: { keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 50 }], interpolation: 'linear' } } as never;
  const ch = {
    id: 'ch', name: 'ch', nodes: { R, A, B }, rootNodeId: 'R',
    sprites: {}, costumeSets: [], activeCostumeSetId: '', direction: 2, latitude: 0, ikChains: [],
  } as unknown as Character;

  const rest = computeRestWorldTransforms(ch, 2);
  const now = computeWorldTransforms(ch, 10, 512, 512, 12);
  const bend = stackBendForNode(A, stack, now, rest);
  ok(!!bend && !!bend.parent && !!bend.child, '(f) stackBendForNode 取到父（根端）与子（尖端，关节贴摞尖端）两侧');
  const nowA = now.get('A')!;
  const rigid = computeStackOps(stack, layerSprites, nowA.worldFrame, nowA.worldAngle);
  const bent = computeStackOps(stack, layerSprites, nowA.worldFrame, nowA.worldAngle, 45, bend);
  const cr = centersOf(rigid);
  const ct = centersOf(bent);
  ok(Math.abs(ct[0].y - cr[0].y) > 0.05 || Math.abs(ct[1].y - cr[1].y) > 0.05, '(f) tilt 50° 时根端带内层心偏离刚性');
  ok(near(ct[9].y, cr[9].y, 1e-6), '(f) 远离两端带的层与刚性一致（子随父刚性、无相对增量）');

  const now0 = computeWorldTransforms(ch, 0, 512, 512, 12);
  const bend0 = stackBendForNode(A, stack, now0, rest);
  const now0A = now0.get('A')!;
  const ops0 = computeStackOps(stack, layerSprites, now0A.worldFrame, now0A.worldAngle, 45, bend0);
  const ops0Rigid = computeStackOps(stack, layerSprites, now0A.worldFrame, now0A.worldAngle);
  ok(ops0.key === ops0Rigid.key, '(f) 第 0 帧（静止位）key 与无 bend 一致');
  const c0 = centersOf(ops0);
  const c0r = centersOf(ops0Rigid);
  ok(c0.every((c, i) => near(c.y, c0r[i].y, 1e-6)), '(f) 第 0 帧层心与无 bend 一致');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
