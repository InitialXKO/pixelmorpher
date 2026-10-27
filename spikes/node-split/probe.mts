// 节点拆分研究探针（spike 本地，不进产品）：
//  甲路（切断）：精灵网格按骨轴垂面切两半 + cropGridToContent + plug
//    重算的像素守恒与插头对位；
//  乙路（快照弯曲）：已拆分骨架（S→M→E，M 无精灵）+ M 挂手工构造的
//    蒙皮快照（合并图 = S 精灵、plug 移到 M 关节）时，渲染计划是否
//    认领 S、给 M 出带 snapshotSkin 的合并指令、E 照常；并直接对
//    applySnapshotBend 验弯曲带内外的像素行为；
//  IK：声明 2bone 的链在插入中间关节（2 骨变 3 骨）后如何解（实走 FABRIK 兜底，见断言）。
import { createDefaultNode, createDefaultCostumePiece, pxToSub, subToPx, projectToView } from '../../src/lib/unified-types';
import type { Character, Node, Sprite, IKChain, PixelGrid } from '../../src/lib/unified-types';
import { generateRenderPlan, computeWorldTransforms } from '../../src/lib/unified-render';
import { cropGridToContent } from '../../src/lib/bake/skeleton-mapper';
import { applySnapshotBend } from '../../src/lib/skin/mesh-skin';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

const W = 512;
const mkNode = (id: string, name: string, parentId?: string): Node => {
  const n = createDefaultNode(name, name);
  n.id = id;
  (n.transform as any).variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const attach = (n: Node, sid: string, extra?: object) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 }, ...extra } as never;
};

// ============ 乙路：快照弯曲 ============
// 竖直臂：root → S（上臂，精灵 16×64 竖条 plug (8,2)）→ M（拆分新关节，
// 无精灵，30px 处）→ E（前臂，精灵 12×30）。M 的 attachment 挂快照：
// 合并图 = S 精灵的副本、plug 移到 M 关节在图内位置 (8, 32)。
const root = mkNode('root', 'torso');
const S = mkNode('S', 'upper_arm', root.id);
const M = mkNode('M', 'upper_arm_mid', S.id);
const E = mkNode('E', 'fore_arm', M.id);
root.children = [S.id]; S.children = [M.id]; M.children = [E.id];
root.sockets = [sock('s_S', 0, -40)];
S.sockets = [sock('s_M', 0, 30)];
M.sockets = [sock('s_E', 0, 30)];
attach(S, 's_S'); attach(E, 's_E');

const armGrid: PixelGrid = Array.from({ length: 64 }, () => Array(16).fill('#cc3333'));
const sprS: Sprite = { id: 'sprS', name: 'arm', width: 16, height: 64, data: armGrid, plug: { x: pxToSub(8), y: pxToSub(2) } } as Sprite;
const sprMerged: Sprite = { id: 'sprMerged', name: 'arm_merged', width: 16, height: 64, data: armGrid, plug: { x: pxToSub(8), y: pxToSub(32) } } as Sprite;
const foreGrid: PixelGrid = Array.from({ length: 30 }, () => Array(12).fill('#3366cc'));
const sprE: Sprite = { id: 'sprE', name: 'fore', width: 12, height: 30, data: foreGrid, plug: { x: pxToSub(6), y: pxToSub(2) } } as Sprite;
const pieceS = createDefaultCostumePiece('upper_arm'); pieceS.sprites = { 6: { spriteId: sprS.id } } as never;
const pieceE = createDefaultCostumePiece('fore_arm'); pieceE.sprites = { 6: { spriteId: sprE.id } } as never;
S.slot = pieceS as never; E.slot = pieceE as never;
attach(M, 's_M', {
  allowSkinning: true,
  skinningSnapshot: {
    spriteId: sprMerged.id, frame: 0, direction: 6,
    baseAngle: 0, parentBaseAngle: 0, axisX: 0, axisY: 1, radius: 12, curve: 'smoothstep',
  },
});
(M.transform as any).angle = 40; // 拆分关节弯 40°

const mkChar = (nodes: Record<string, Node>, pieces: Record<string, never>, sprites: Record<string, Sprite>, ikChains?: IKChain[]) => ({
  id: 'char', name: 'split-probe', nodes,
  rootNodeId: Object.values(nodes).find((n) => !n.parentId)?.id ?? 'root', sprites: {},
  costumeSets: [{ id: 'cs1', name: '默认', pieces }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0, ikChains,
} as unknown as Character);
const spritesAll: Record<string, Sprite> = { [sprS.id]: sprS, [sprMerged.id]: sprMerged, [sprE.id]: sprE };
const charB = mkChar(
  { [root.id]: root, [S.id]: S, [M.id]: M, [E.id]: E },
  { upper_arm: pieceS, fore_arm: pieceE } as never, spritesAll);
const planB = generateRenderPlan(charB, 0, W, W, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, spritesAll);
const insB = planB.nodeInstructions;
ok(!insB.some((i) => i.nodeId === S.id), '乙 S 被快照认领：不出自身指令（防双绘）');
const insM = insB.find((i) => i.nodeId === M.id) as unknown as { snapshotSkin?: { deltaAngle: number; jointY: number } } | undefined;
ok(!!insM?.snapshotSkin, '乙 M 出合并精灵指令（带 snapshotSkin）');
ok(Math.abs((insM?.snapshotSkin?.deltaAngle ?? 0) - 40) < 1.5, `乙 deltaAngle 跟 M 弯角（实际 ${insM?.snapshotSkin?.deltaAngle?.toFixed(1)}）`);
ok(insB.some((i) => i.nodeId === E.id), '乙 E 照常出自身精灵指令');
ok(!(planB.discInstructions ?? []).some((d) => (d as { nodeId?: string }).nodeId === M.id), '乙 M 的关节盘被快照抑制');

// applySnapshotBend 网格级：关节 (8,32)、轴 (0,1)、δ=90°、r=12：
// 近侧点 (8, 10)（t=−22 < −r）不动；远侧点 (8, 50)（t=+18 > r）绕关节
// 刚转 90° → 落到 (8 + (50−32), 32) = (26, 32) 一带
{
  const g: PixelGrid = Array.from({ length: 64 }, () => Array(64).fill(null));
  g[10]![24] = '#aaaaaa'; g[50]![24] = '#bbbbbb';
  const bent = applySnapshotBend(g, 24, 32, 0, 1, 90, 12, 'smoothstep');
  ok(bent[10]?.[24] === '#aaaaaa', '乙 弯曲带外近侧像素不动');
  ok(bent[50]?.[24] !== '#bbbbbb', '乙 弯曲带外远侧像素离原位');
  let found = false;
  for (let y = 0; y < 64 && !found; y++) for (let x = 0; x < 64; x++) if (bent[y]?.[x] === '#bbbbbb') found = Math.abs(Math.abs(x - 24) - 18) <= 2 && Math.abs(y - 32) <= 2;
  ok(found, '乙 远侧像素绕关节转 90°：落到关节水平线、距关节 18px');
}

// 对照：无快照时 S 出自身指令、M 无指令（刚性基线）
const M2 = mkNode('M', 'upper_arm_mid', S.id);
M2.children = [E.id];
attach(M2, 's_M');
const E2 = E; // 复用 E（parentId 仍写 M.id，同 id）
const charB0 = mkChar({ [root.id]: root, [S.id]: S, [M.id]: M2, [E.id]: E2 },
  { upper_arm: pieceS, fore_arm: pieceE } as never, spritesAll);
const planB0 = generateRenderPlan(charB0, 0, W, W, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, spritesAll);
ok(planB0.nodeInstructions.some((i) => i.nodeId === S.id), '对照 无快照：S 出自身指令');
ok(!planB0.nodeInstructions.some((i) => i.nodeId === M.id), '对照 无快照：M 无指令（精灵刚性、不跟远段）');

// ============ 甲路：切断算术 ============
{
  // 精灵局部：plug (8,2)，骨轴 +y，命中处关节在 (8,32)，切线 = 水平 y=32
  const src: PixelGrid = Array.from({ length: 64 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x >= 2 && x <= 13 ? '#cc3333' : null)));
  const cutY = 32;
  const nearHalf = src.slice(0, cutY);
  const farHalf = src.slice(cutY);
  const near = cropGridToContent(nearHalf, 0);
  const far = cropGridToContent(farHalf, 0);
  const count = (g: PixelGrid) => g.flat().filter((c) => c !== null).length;
  ok(count(near.grid) + count(far.grid) === count(src), `甲 切两半像素守恒（${count(near.grid)}+${count(far.grid)}=${count(src)}）`);
  const nearPlug = { x: 8 - near.cropX, y: 2 - near.cropY };
  ok(nearPlug.x === 6 && nearPlug.y === 2, `甲 近段 plug = 原 plug − 裁剪原点（实际 ${nearPlug.x},${nearPlug.y}）`);
  const farPlug = { x: 8 - far.cropX, y: cutY - cutY - far.cropY + 0 }; // far 局部：关节在 farHalf 的 (8, 0)
  const farJoint = { x: 8 - far.cropX, y: 0 - far.cropY };
  ok(farJoint.x === 6 && farJoint.y === 0, `甲 远段 plug = 新关节在图内位置（实际 ${farJoint.x},${farJoint.y}）`);
  void farPlug;
}

// ============ IK：插入中间关节后 2bone 链 ============
{
  const r = mkNode('ik_root', 'torso');
  const a = mkNode('ik_a', 'upper_arm_R', r.id);
  const f = mkNode('ik_f', 'lower_arm_R', a.id);
  const h = mkNode('ik_h', 'hand_R', f.id);
  r.children = [a.id]; a.children = [f.id]; f.children = [h.id];
  r.sockets = [sock('s_a', -30, 0)]; a.sockets = [sock('s_f', -35, 0)]; f.sockets = [sock('s_h', -30, 0)];
  attach(a, 's_a'); attach(f, 's_f'); attach(h, 's_h');
  const chain: IKChain = {
    id: 'ikc', name: 'arm', rootNodeId: a.id, endNodeId: h.id,
    target: { x: 0, y: 0 }, enabled: true, solver: '2bone',
    target3D: { x: -80, y: 30, z: 0 },
  } as IKChain;
  const handPos = (ch: Character) => {
    const wt = computeWorldTransforms(ch, 0, W, W, 12);
    const w = wt.get(h.id)!;
    const p = projectToView(w.worldX, w.worldY, w.worldZ, 6);
    return { x: subToPx(p.canvasX), y: subToPx(p.canvasY), mAngle: 0 };
  };
  const nodes0 = { [r.id]: r, [a.id]: a, [f.id]: f, [h.id]: h };
  const ch0 = mkChar(nodes0 as never, {} as never, {}, [chain]);
  const p0 = handPos(ch0);
  const target = { x: -80, y: 30 };
  const err0 = Math.hypot(p0.x - target.x, p0.y - target.y);
  // 插入 M：a→M→f（a 的 socket 改指 M 的新 socket，f 改挂 M）
  const m = mkNode('ik_m', 'upper_arm_mid', a.id);
  m.children = [f.id];
  (f as Node).parentId = m.id;
  a.children = [m.id];
  a.sockets = [sock('s_m', -18, 0)];
  m.sockets = [sock('s_f2', -17, 0)];
  attach(m, 's_m'); attach(f, 's_f2');
  const ch1 = mkChar({ ...nodes0, [m.id]: m } as never, {} as never, {}, [chain]);
  const fk1 = computeWorldTransforms(ch1, 0, W, W, 12);
  const w1 = fk1.get(h.id)!;
  const pp = projectToView(w1.worldX, w1.worldY, w1.worldZ, 6);
  const err1 = Math.hypot(subToPx(pp.canvasX) - target.x, subToPx(pp.canvasY) - target.y);
  let relM = (fk1.get(m.id)?.worldAngle ?? 0) - (fk1.get(a.id)?.worldAngle ?? 0);
  while (relM > 180) relM -= 360; while (relM < -180) relM += 360;
  console.log(`  IK 参考：2 骨链末端误差 ${err0.toFixed(1)}px；插中间关节（3 骨）后 ${err1.toFixed(1)}px；M 相对角 ${relM.toFixed(1)}°`);
  ok(Math.abs(relM) > 90, `IK 关键发现：链声明 2bone 但段数（含尖端）≠2、实际走无极向约束的 FABRIK，把插入的中间关节折叠 ${relM.toFixed(0)}°（末端仍达目标附近）——正解是求解按段数匹配，未立项前拆分工具对链内段设防`);
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
