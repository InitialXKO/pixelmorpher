// 节点命中挑选探针（行为，走真实消费路径 pickNodesAt）：
// A 像素归属：点在大精灵身上 → 选大精灵，哪怕另一个节点的关节更近；
//   点在小节点精灵上 → 选小节点；空地 → 谁都不选。
// B 无精灵胶囊：点在兜底胶囊段上 → 选该节点；段外远处 → 不选；
//   转位克隆后，点在转位后的段上 → 选克隆节点。
// C 细精灵胶囊：点在细精灵旁 2px → 胶囊兜底选中；远离 → 不选；
//   点在精灵像素上 → tier 0。
import { pickNodesAt } from '../src/lib/node-picking';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { cloneSubtreeTransposed } from '../src/lib/clone-transpose';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub, subToPx, projectToView,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const W = 512, H = 512;
const mkNode = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  (n.transform as any).variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const solidSprite = (id: string, w: number, h: number, plugX: number, plugY: number): Sprite => ({
  id, name: id, width: w, height: h,
  data: Array.from({ length: h }, () => Array(w).fill('#cc3333')),
  plug: { x: pxToSub(plugX), y: pxToSub(plugY) },
} as unknown as Sprite);
const pieceWith = (key: string, spr: Sprite) => {
  const p = createDefaultCostumePiece(key);
  p.sprites = { 6: { spriteId: spr.id } } as never;
  return p;
};
const mkChar = (id: string, nodes: Record<string, never>, pieces: Record<string, never>, sprites: Record<string, Sprite>) => ({
  id, name: id, nodes, rootNodeId: (Object.values(nodes)[0] as { id: string }).id,
  sprites: {}, costumeSets: [{ id: 'cs1', name: '默认', pieces }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0, ikChains: [],
} as unknown as Character);

// ---------- A：像素归属 ----------
const aRoot = mkNode('a_root', 'torso');
const aPlate = mkNode('a_plate', 'plate', aRoot.id);
const aDot = mkNode('a_dot', 'dot', aRoot.id);
aRoot.children = [aPlate.id, aDot.id];
aRoot.sockets = [sock('a_s_plate', 30, 0), sock('a_s_dot', 84, 54)];
aPlate.attachment = { type: 'socket', parentSocketId: 'a_s_plate', plug: { x: 0, y: 0 } } as never;
aDot.attachment = { type: 'socket', parentSocketId: 'a_s_dot', plug: { x: 0, y: 0 } } as never;
const sprPlate = solidSprite('spr_plate', 80, 80, 10, 10); // 关节 (286,256)，覆盖 [276,356]×[246,326]
const sprDot = solidSprite('spr_dot', 4, 4, 2, 2);          // 关节 (340,310)
const piecePlate = pieceWith('plate', sprPlate);
const pieceDot = pieceWith('dot', sprDot);
aPlate.slot = piecePlate as never;
aDot.slot = pieceDot as never;
const charA = mkChar('charA',
  { [aRoot.id]: aRoot, [aPlate.id]: aPlate, [aDot.id]: aDot } as never,
  { plate: piecePlate, dot: pieceDot } as never,
  { [sprPlate.id]: sprPlate, [sprDot.id]: sprDot });
const pickA = (x: number, y: number) => pickNodesAt([charA], x, y, { sprites: { [sprPlate.id]: sprPlate, [sprDot.id]: sprDot }, frame: 0, canvasWidth: W, canvasHeight: H });

let picks = pickA(350, 320); // 大板远角（离小点关节更近，旧距离口径会选小点）
ok(picks[0]?.node.id === aPlate.id && picks[0]?.tier === 0, `A1 点在大精灵远角 → 选大精灵（实际 ${picks[0]?.node.id}/tier ${picks[0]?.tier}）`);
picks = pickA(340, 310);     // 小点精灵上
ok(picks[0]?.node.id === aDot.id && picks[0]?.tier === 0, `A2 点在小精灵上 → 选小节点（实际 ${picks[0]?.node.id}）`);
picks = pickA(100, 100);     // 空地
ok(picks.length === 0, `A3 空地 → 无人选中（实际 ${picks.length}）`);

// ---------- B：无精灵胶囊 ----------
const bRoot = mkNode('b_root', 'torso');
const bArm = mkNode('b_arm', 'upper_arm_R', bRoot.id);
const bFore = mkNode('b_fore', 'lower_arm_R', bArm.id);
bRoot.children = [bArm.id];
bArm.children = [bFore.id];
bRoot.sockets = [sock('b_s_arm', -40, -20)];
bArm.sockets = [sock('b_s_fore', -35, 5)];
bArm.attachment = { type: 'socket', parentSocketId: 'b_s_arm', plug: { x: 0, y: 0 } } as never;
bFore.attachment = { type: 'socket', parentSocketId: 'b_s_fore', plug: { x: 0, y: 0 } } as never;
const charB = mkChar('charB',
  { [bRoot.id]: bRoot, [bArm.id]: bArm, [bFore.id]: bFore } as never, {} as never, {});
const pickB = (x: number, y: number, ch: Character = charB) => pickNodesAt([ch], x, y, { sprites: {}, frame: 0, canvasWidth: W, canvasHeight: H });

picks = pickB(198.5, 238.5); // 前臂段中点
ok(picks[0]?.node.id === bArm.id && picks[0]?.tier === 2, `B1 点在前臂段上 → 选上臂（段归起始关节，与精灵属主对齐；实际 ${picks[0]?.node.id}/tier ${picks[0]?.tier}）`);
picks = pickB(181, 241);     // 前臂关节正点
ok(picks[0]?.node.id === bFore.id && picks[0]?.tier === 2, `B1b 点在前臂关节上 → 选前臂自己（实际 ${picks[0]?.node.id}）`);
picks = pickB(198, 200);     // 段上方 38px
ok(picks.length === 0, `B2 胶囊外 → 无人选中（实际 ${picks.length}）`);
picks = pickB(256, 256);     // 根关节
ok(picks.some((p) => p.node.id === bRoot.id), 'B3 根关节处 → 根在候选内');

// 转位克隆：点在转位后的前臂段上 → 选克隆前臂
let seq = 0;
const cloned = cloneSubtreeTransposed(charB, bArm.id, 90, (p) => `${p}_c${seq++}`, { width: W, height: H })!;
const cloneForeId = cloned.character.nodes[cloned.newRootId]!.children[0]!;
const fkC = computeWorldTransforms(cloned.character, 0, W, H, 12);
const jp = (id: string) => {
  const wt = fkC.get(id)!;
  const pr = projectToView(wt.worldX, wt.worldY, wt.worldZ, 6);
  return { x: subToPx(pr.canvasX) + W / 2, y: subToPx(pr.canvasY) + H / 2 };
};
const cArm = jp(cloned.newRootId), cFore = jp(cloneForeId);
picks = pickB((cArm.x + cFore.x) / 2, (cArm.y + cFore.y) / 2, cloned.character);
ok(picks[0]?.node.id === cloned.newRootId && picks[0]?.tier === 2, `B4 点在转位后前臂段 → 选克隆上臂（段归起始关节；实际 ${picks[0]?.node.id}）`);

// ---------- C：细精灵胶囊 ----------
const cRoot = mkNode('c_root', 'torso');
const cHair = mkNode('c_hair', 'hair_strand', cRoot.id);
cRoot.children = [cHair.id];
cRoot.sockets = [sock('c_s_hair', 0, -56)];
cHair.attachment = { type: 'socket', parentSocketId: 'c_s_hair', plug: { x: 0, y: 0 } } as never;
const sprHair = solidSprite('spr_hair', 3, 30, 1, 0); // 关节 (256,200)，覆盖 x∈[255,258] y∈[200,230]
const pieceHair = pieceWith('hair', sprHair);
cHair.slot = pieceHair as never;
const charC = mkChar('charC',
  { [cRoot.id]: cRoot, [cHair.id]: cHair } as never,
  { hair: pieceHair } as never,
  { [sprHair.id]: sprHair });
const pickC = (x: number, y: number) => pickNodesAt([charC], x, y, { sprites: { [sprHair.id]: sprHair }, frame: 0, canvasWidth: W, canvasHeight: H });

picks = pickC(257, 215); // 精灵像素上
ok(picks[0]?.node.id === cHair.id && picks[0]?.tier === 0, `C1 点在细精灵像素上 → tier 0（实际 ${picks[0]?.node.id}/tier ${picks[0]?.tier}）`);
picks = pickC(260, 215); // 精灵右缘外 2px
ok(picks[0]?.node.id === cHair.id && picks[0]?.tier === 1, `C2 精灵旁 2px → 胶囊兜底 tier 1（实际 ${picks[0]?.node.id}/tier ${picks[0]?.tier}）`);
picks = pickC(270, 215); // 远离 12px
ok(!picks.some((p) => p.node.id === cHair.id), 'C3 远离细精灵 → 不选它');


// ---------- D：拾取编号图口径（绘制结果优先） ----------
// D1 编号图命中 plate（视觉最上层）→ 置顶，几何候选在其后、plate 不重复
picks = pickNodesAt([charA], 350, 320, { sprites: { [sprPlate.id]: sprPlate, [sprDot.id]: sprDot }, frame: 0, canvasWidth: W, canvasHeight: H, bufferNodeId: aRoot.id });
ok(picks[0]?.node.id === aRoot.id, `D1 编号图命中根 → 置顶（实际 ${picks[0]?.node.id}）`);
ok(picks.filter((p) => p.node.id === aRoot.id).length === 1, 'D1 根不重复出现');
// D2 编号图新鲜 + 读空（此处没画）→ 几何 tier 0 被压制：大精灵像素不产生候选
picks = pickNodesAt([charA], 350, 320, { sprites: { [sprPlate.id]: sprPlate, [sprDot.id]: sprDot }, frame: 0, canvasWidth: W, canvasHeight: H, bufferNodeId: null, bufferAuthoritative: true });
ok(!picks.some((p) => p.tier === 0), `D2 编号图新鲜读空 → 无 tier 0 候选（实际 ${picks.map((p) => p.tier).join(',')}）`);
// D3 编号图不新鲜 → 几何口径不变（A1 结论复现）
picks = pickNodesAt([charA], 350, 320, { sprites: { [sprPlate.id]: sprPlate, [sprDot.id]: sprDot }, frame: 0, canvasWidth: W, canvasHeight: H, bufferNodeId: null, bufferAuthoritative: false });
ok(picks[0]?.node.id === aPlate.id && picks[0]?.tier === 0, 'D3 编号图缺席 → 几何 tier 0 照常');
// D4 编号图命中一个几何上点不中的节点（像素链改过占据的情形）→ 仍置顶
picks = pickNodesAt([charA], 100, 100, { sprites: { [sprPlate.id]: sprPlate, [sprDot.id]: sprDot }, frame: 0, canvasWidth: W, canvasHeight: H, bufferNodeId: aPlate.id, bufferAuthoritative: true });
ok(picks[0]?.node.id === aPlate.id, `D4 空地点编号图命中 → 置顶该节点（实际 ${picks[0]?.node.id}）`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
