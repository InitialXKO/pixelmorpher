// 写侧全挂 slot 探针（用户裁决：所有写侧必须写 node.slot）：
// ① 主要建角色路径产出的每个节点都有 slot（slotKey = 节点 id，
//    与全部按节点 id 写件的写侧同键）；拆分/克隆等再加工路径的
//    slot 语义保持各自既有口径（拆分 mid 键、克隆 @ 重映射键）。
// ② 存量形状（无 slot 节点）经 backfillNodeSlots 补挂后：每节点
//    有 slot、pieces 逐字不变、渲染解析与补挂前一致；烘焙线自造
//    键不被覆盖。③ 补挂幂等。④ 工程读入（importProjectFile）与
//    历史快照同样被补挂。
import {
  createDefaultNode, createDefaultCharacter, createDefaultCostumePiece,
  backfillNodeSlots, pxToSub, type Character, type Node, type Sprite,
} from '../src/lib/unified-types';
import { useProjectStore } from '../src/lib/store';
import { buildSkeletonFromStrokes } from '../src/lib/stroke-build';
import { generateClothGrid } from '../src/lib/sim/cloth-bake';
import { generateHairStrands } from '../src/lib/sim/strand-bake';
import { splitNodeSegment } from '../src/lib/node-split';
import { cloneSubtreeTransposed } from '../src/lib/clone-transpose';
import { generateRenderPlan } from '../src/lib/unified-render';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const allSlotted = (nodes: Record<string, Node>, keyOf: (n: Node) => string = (n) => n.id) =>
  Object.values(nodes).every((n) => !!n.slot && n.slot.slotKey === keyOf(n));

// ---------- ①a 工厂 ----------
{
  const n = createDefaultNode('n1', '节点');
  ok(!!n.slot && n.slot.slotKey === 'n1', '①a createDefaultNode 出生带 slot（slotKey=节点 id）');
  const ch = createDefaultCharacter('c1', '角色');
  ok(allSlotted(ch.nodes), '①a createDefaultCharacter 根节点带 slot');
}

// ---------- ①b store 建角色/加节点 ----------
{
  const ps = useProjectStore.getState();
  const ch0 = ps.addUnifiedCharacter('挂牌探针角色');
  ok(allSlotted(ch0.nodes), '①b addUnifiedCharacter 占位根带 slot');
  const added = ps.addUnifiedNode(ch0.id, '新肢', {
    attachment: { type: 'fixed', fixedOffset: { x: 0, y: 0 }, inheritRotation: true },
  });
  const cur = useProjectStore.getState().unifiedCharacters[ch0.id]!;
  ok(!!cur.nodes[added.id]?.slot && cur.nodes[added.id]!.slot!.slotKey === added.id,
    '①b addUnifiedNode 新节点带 slot（slotKey=新节点 id）');
}

// ---------- ①c 火柴人建骨架 ----------
{
  const torso = [{ x: 100, y: 20 }, { x: 100, y: 110 }, { x: 100, y: 200 }];
  const armL = [{ x: 124, y: 110 }, { x: 160, y: 130 }, { x: 170, y: 190 }, { x: 200, y: 200 }];
  const res = buildSkeletonFromStrokes({ torso, armL }, { characterId: 'sb1', center: { x: 100, y: 110 } });
  ok(Object.keys(res.nodes).length === 15 && allSlotted(res.nodes),
    `①c stroke-build 15 节点全带 slot（实际 ${Object.keys(res.nodes).length}）`);
}

// ---------- ①d 布料/毛发网格生成 ----------
{
  const cloth = generateClothGrid('root', 3, 3, 10, 10);
  ok(Object.keys(cloth.nodes).length === 9 && allSlotted(cloth.nodes), '①d 布料网格节点全带 slot');
  const hair = generateHairStrands('root', 3, 3);
  ok(Object.keys(hair.nodes).length === 9 && allSlotted(hair.nodes), '①d 毛发束节点全带 slot');
}

// ---------- ①e 节点拆分：M 的 slot 走拆分口径（mid 键），不是工厂默认键 ----------
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const grid = (w: number, h: number) => Array.from({ length: h }, () => Array(w).fill('#c63'));
const sprA: Sprite = {
  id: 'sprA', name: 'sprA', width: 48, height: 14, data: grid(48, 14),
  plug: { x: pxToSub(42), y: pxToSub(7) },
} as Sprite;
function splitFixture(active: boolean): Character {
  const R = createDefaultNode('R', 'torso');
  const S = createDefaultNode('S', 'upper_arm_R'); S.parentId = 'R';
  const E = createDefaultNode('E', 'hand_R'); E.parentId = 'S';
  for (const n of [R, S, E]) n.transform.variantIndex = 6;
  R.children = ['S']; S.children = ['E'];
  R.sockets = [sock('sS', -30, 0)]; S.sockets = [sock('sE', -40, 0)];
  S.attachment = { type: 'socket', parentSocketId: 'sS', plug: { x: 0, y: 0 } } as never;
  E.attachment = { type: 'socket', parentSocketId: 'sE', plug: { x: 0, y: 0 } } as never;
  const piece = createDefaultCostumePiece('S');
  piece.sprites = { 6: { spriteId: 'sprA' } } as never;
  return {
    id: 'sp1', name: 'sp1', nodes: { R, S, E }, rootNodeId: 'R', sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { S: piece } }],
    ...(active ? { activeCostumeSetId: 'set1' } : {}),
    direction: 6, latitude: 0,
  } as unknown as Character;
}
{
  const out = splitNodeSegment({ character: splitFixture(true), sprites: { sprA }, nodeId: 'S', childId: 'E', t: 0.5, direction: 6 });
  ok(out.ok, `①e 拆分成功（生效集）${out.ok ? '' : '：' + out.error}`);
  if (out.ok && out.character && out.midNodeId) {
    const M = out.character.nodes[out.midNodeId];
    ok(M.slot?.slotKey === 'S_mid', `①e 生效集拆分：M.slot = 拆分件键 S_mid（实际 ${M.slot?.slotKey}）`);
    ok(out.character.nodes['S']!.slot?.slotKey === 'S', '①e S2.slot 指向拆分后本段件（键 S）');
    const pieces = out.character.costumeSets[0]!.pieces;
    ok(!!pieces['S'] && !!pieces['S_mid'], '①e 生效集 pieces 同时有 S 与 S_mid');
  }
}
{
  const out = splitNodeSegment({ character: splitFixture(false), sprites: { sprA }, nodeId: 'S', childId: 'E', t: 0.5, direction: 6 });
  ok(out.ok, `①e 拆分成功（无生效集）${out.ok ? '' : '：' + out.error}`);
  if (out.ok && out.character && out.midNodeId) {
    const M = out.character.nodes[out.midNodeId];
    ok(M.slot?.slotKey === 'S_mid', `①e 无生效集：M.slot 仍按拆分口径补 S_mid（实际 ${M.slot?.slotKey}）`);
  }
}

// ---------- ①f 转位克隆：slotKey 按 @新 id 重映射、pieces 跟随 ----------
{
  const R = createDefaultNode('root', 'root');
  const A = createDefaultNode('arm', 'arm'); A.parentId = 'root';
  const B = createDefaultNode('hand', 'hand'); B.parentId = 'arm';
  R.children = ['arm']; A.children = ['hand'];
  const piece = createDefaultCostumePiece('arm');
  piece.sprites = { 6: { spriteId: 'sprA' } } as never;
  const ch = {
    id: 'cl1', name: 'cl1', nodes: { root: R, arm: A, hand: B }, rootNodeId: 'root', sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { arm: piece } }], activeCostumeSetId: 'set1',
    direction: 6, latitude: 0,
  } as unknown as Character;
  const res = cloneSubtreeTransposed(ch, 'arm', 0, undefined, undefined, { plain: true });
  ok(!!res, '①f 克隆成功');
  if (res) {
    const cloned = res.character.nodes[res.newRootId]!;
    ok(cloned.slot?.slotKey === `arm@${res.newRootId}`,
      `①f 克隆根 slotKey 重映射 arm@新id（实际 ${cloned.slot?.slotKey}）`);
    ok(!!res.character.costumeSets[0]!.pieces[`arm@${res.newRootId}`], '①f pieces 按新 slotKey 复制');
    ok(allSlotted(res.character.nodes, (n) => n.slot!.slotKey), '①f 克隆后全节点仍有 slot');
  }
}

// ---------- ②③ 存量补挂 ----------
function stockCharacter(): Character {
  const root = createDefaultNode('root', 'root');
  root.id = 'node_stock_0';
  (root.transform as any).variantIndex = 6;
  const limb = createDefaultNode('limb', '左臂');
  limb.id = 'node_stock_1'; limb.parentId = root.id;
  const bare = createDefaultNode('bare', '裸节点');
  bare.id = 'node_stock_2'; bare.parentId = root.id;
  const bake = createDefaultNode('bake', '烘焙节点');
  bake.id = 'node_stock_3'; bake.parentId = root.id;
  // 存量形状：root/limb/bare 无 slot；bake 带烘焙线自造键（不许被覆盖）
  delete (root as any).slot;
  delete (limb as any).slot;
  delete (bare as any).slot;
  bake.slot = createDefaultCostumePiece('slot_stock_9_bake');
  root.children = [limb.id, bare.id, bake.id];
  root.sockets = [1, 2, 3].map((i) => ({
    id: `sock_${i}`, name: `s${i}`, basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: pxToSub(20 * i), y: pxToSub(6 * i), z: 0 },
  }));
  limb.attachment = { type: 'socket', parentSocketId: 'sock_1', plug: { x: 0, y: 0 } } as never;
  bare.attachment = { type: 'socket', parentSocketId: 'sock_2', plug: { x: 0, y: 0 } } as never;
  bake.attachment = { type: 'socket', parentSocketId: 'sock_3', plug: { x: 0, y: 0 } } as never;
  const piece = createDefaultCostumePiece(limb.id);
  piece.sprites = { 6: { spriteId: 'spr_stock' } } as never;
  return {
    id: 'stock1', name: '存量角色',
    nodes: { [root.id]: root, [limb.id]: limb, [bare.id]: bare, [bake.id]: bake },
    rootNodeId: root.id, sprites: {},
    costumeSets: [{ id: 'cs_stock', name: '存量集', pieces: { [limb.id]: piece } }],
    activeCostumeSetId: 'cs_stock', direction: 6, latitude: 0,
  } as unknown as Character;
}
const sprStock: Sprite = {
  id: 'spr_stock', name: '存量精灵', width: 10, height: 10,
  data: Array.from({ length: 10 }, () => Array(10).fill('#3366cc')),
  plug: { x: pxToSub(5), y: pxToSub(9) },
} as Sprite;
const planOf = (ch: Character) => generateRenderPlan(ch, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { [sprStock.id]: sprStock },
  undefined, undefined, undefined, undefined, undefined, true);
{
  const ch = stockCharacter();
  const chars: Record<string, Character> = { stock1: ch };
  const piecesBefore = JSON.stringify(ch.costumeSets);
  const before = planOf(ch);
  const limbInsBefore = before.nodeInstructions.find((i) => i.nodeId === 'node_stock_1');
  const mqBefore = (before.mannequinInstructions ?? []).map((m) => m.nodeId).sort().join(',');
  ok(!!limbInsBefore, '② 前提：存量形状下抠图部位本就出精灵指令（读侧回退在职）');

  const changed = backfillNodeSlots(chars);
  ok(changed === true, '② 补挂报告有改动');
  ok(!!ch.nodes['node_stock_0']!.slot && !!ch.nodes['node_stock_1']!.slot && !!ch.nodes['node_stock_2']!.slot,
    '② 无 slot 节点全补挂');
  ok(ch.nodes['node_stock_1']!.slot!.slotKey === 'node_stock_1', '② 补挂键 = 节点 id');
  ok(ch.nodes['node_stock_3']!.slot!.slotKey === 'slot_stock_9_bake', '② 烘焙线自造键原样保留');
  ok(JSON.stringify(ch.costumeSets) === piecesBefore, '② pieces 数据逐字不变');

  const after = planOf(ch);
  const limbInsAfter = after.nodeInstructions.find((i) => i.nodeId === 'node_stock_1');
  ok(!!limbInsAfter && limbInsAfter.sprite?.id === limbInsBefore!.sprite?.id,
    '② 补挂后精灵指令一致（同精灵）');
  const mqAfter = (after.mannequinInstructions ?? []).map((m) => m.nodeId).sort().join(',');
  ok(mqAfter === mqBefore, `② 补挂后兜底胶囊集合一致（前 ${mqBefore} / 后 ${mqAfter}）`);

  const snapshot = JSON.stringify(chars);
  const changed2 = backfillNodeSlots(chars);
  ok(changed2 === false && JSON.stringify(chars) === snapshot, '③ 补挂幂等（再跑无改动、数据不变）');
}

// ---------- ④ 工程读入 + 历史快照补挂 ----------
{
  const stock = stockCharacter();
  const file = {
    version: '3.1',
    project: {
      id: 'p_stock', name: '存量工程', sprites: {},
      unifiedCharacters: { stock1: stock },
      animationClips: [], totalFrames: 24, frameRate: 12, canvasWidth: 256, canvasHeight: 256,
    },
    history: [{
      description: '旧快照', timestamp: 1,
      snapshot: JSON.stringify({ unifiedCharacters: { stock1: stockCharacter() } }),
    }],
  };
  useProjectStore.getState().importProjectFile(file as never);
  const st = useProjectStore.getState();
  // 键口径：补挂节点 slotKey=节点 id；烘焙节点保留自造键 slot_stock_9_bake
  const keyOk = (nodes: Record<string, Node>) => Object.values(nodes).every((n) =>
    !!n.slot && n.slot.slotKey === (n.id === 'node_stock_3' ? 'slot_stock_9_bake' : n.id));
  const imported = st.unifiedCharacters['stock1']!;
  ok(!!imported && keyOk(imported.nodes), '④ importProjectFile：导入角色全节点带 slot');
  const snapChars = JSON.parse(st.undoStack[st.undoStack.length - 1]!.snapshot).unifiedCharacters;
  ok(!!snapChars?.stock1 && keyOk(snapChars.stock1.nodes), '④ 历史快照内角色同样补挂');
}

console.log(fails === 0 ? 'ALWAYS SLOT PROBE PASS' : `ALWAYS SLOT PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
