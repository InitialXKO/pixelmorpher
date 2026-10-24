// verify-draw-order.mts — 主渲染画序探针（bun 运行）
// 口径：排序 = 投影深度（主键）→ 作者 zIndex（次键）→ 生成序（稳定）。
// 纯 2D 时各节点深度应恒为同一常量（2D 偏移沿视平面右向量映射、与深度
// 轴正交），画序由作者 zIndex 决定，不退化为层级遍历序；3D 出平面时
// 深度重新接管，压过作者 zIndex。
import {
  createDefaultCharacter,
  createDefaultNode,
  createDefaultCostumePiece,
  createDefaultSocket,
  pxToSub,
  type Character,
  type DirectionIndex,
  type Sprite,
} from '../src/lib/unified-types';
import { generateRenderPlan } from '../src/lib/unified-render';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}

function makeSprite(id: string): Sprite {
  const data: string[][] = Array.from({ length: 4 }, () => Array(4).fill('#cc3333'));
  return { id, name: id, width: 4, height: 4, data, plug: { x: pxToSub(2), y: pxToSub(2) } } as unknown as Sprite;
}

const SPRITES: Record<string, Sprite> = { sA: makeSprite('sA'), sB: makeSprite('sB'), sC: makeSprite('sC') };

// 三个子节点 A/B/C（树序 A,B,C），各自有槽位+全方向精灵。
// 放置走产品 2D 的真实通道：父节点 socket 的 2D 偏移（按朝向映射到视
// 平面内），子节点 socket 挂接、transform 归零——transform 的 x/y/z 是
// 3D 姿态通道，不当布局用（T2 正是用 transform.z 造出平面外深度）。
function buildChar(z: Record<string, number>): Character {
  const ch = createDefaultCharacter('c', '画序测试');
  const root = ch.nodes[ch.rootNodeId]!;
  const pieces: Record<string, ReturnType<typeof createDefaultCostumePiece>> = {};
  const sockPos: Record<string, [number, number]> = { A: [-24, 0], B: [0, 10], C: [24, 0] };
  for (const [id, key] of [['A', 'sA'], ['B', 'sB'], ['C', 'sC']] as const) {
    const node = createDefaultNode(id, id);
    (node as unknown as { parentId: string }).parentId = ch.rootNodeId;
    node.zIndex = z[id]!;
    const sockId = `sock_${id}`;
    const [sx, sy] = sockPos[id]!;
    root.sockets.push(createDefaultSocket(sockId, sockId, pxToSub(sx), pxToSub(sy)));
    node.attachment = { type: 'socket', parentSocketId: sockId, plug: { x: 0, y: 0 } } as unknown as typeof node.attachment;
    const piece = createDefaultCostumePiece(id);
    for (let d = 0; d < 8; d++) piece.sprites[d as DirectionIndex] = { spriteId: key };
    node.slot = piece;
    pieces[id] = piece;
    ch.nodes[id] = node;
    root.children.push(id);
  }
  ch.costumeSets = [{ id: 'cs', name: '默认', pieces } as unknown as Character['costumeSets'][number]];
  ch.activeCostumeSetId = 'cs';
  return ch;
}

function planFor(ch: Character, dir: DirectionIndex) {
  ch.nodes[ch.rootNodeId]!.transform.variantIndex = dir;
  return generateRenderPlan(
    ch, 0, 200, 200,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    SPRITES,
  );
}

const orderOf = (ch: Character, dir: DirectionIndex) =>
  planFor(ch, dir).sortedInstructions.map((i) => i.nodeId).join(',');

// ---- T1：纯 2D，八方向都由作者 zIndex 决定（树序 A,B,C；zIndex A=30,B=10,C=20 → B,C,A）----
{
  const ch = buildChar({ A: 30, B: 10, C: 20 });
  for (let d = 0; d < 8; d++) {
    const dir = d as DirectionIndex;
    check(`T1 方向${dir} 画序=zIndex序`, orderOf(ch, dir) === 'B,C,A');
    const depths = planFor(ch, dir).sortedInstructions.map((i) => i.zIndex);
    const spread = Math.max(...depths) - Math.min(...depths);
    check(`T1 方向${dir} 深度恒同（散布<1e-6）`, spread < 1e-6);
  }
  const ins = planFor(ch, 6).sortedInstructions;
  check('T1 authoredZ 已带入指令', ins.every((i) => i.authoredZ === ch.nodes[i.nodeId]!.zIndex));
}

// ---- T2：3D 出平面（transform.z）时深度接管，压过作者 zIndex ----
// A 作者最前(30)但 z=-40 在后；B 作者最后(10)但 z=+40 在前；南向 depth=worldZ → 期望 A,C,B
{
  const ch = buildChar({ A: 30, B: 10, C: 20 });
  ch.nodes['A']!.transform.z = pxToSub(-40);
  ch.nodes['B']!.transform.z = pxToSub(40);
  check('T2 南向深度优先于 zIndex', orderOf(ch, 6) === 'A,C,B');
  const depths = planFor(ch, 6).sortedInstructions.map((i) => i.zIndex);
  check('T2 深度确有散布', Math.max(...depths) - Math.min(...depths) > 100);
}

// ---- T3：zIndex 全同 → 稳定回落生成序（树序）----
{
  const ch = buildChar({ A: 0, B: 0, C: 0 });
  check('T3 同 zIndex 保持树序', orderOf(ch, 6) === 'A,B,C');
}

console.log(`verify-draw-order: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
