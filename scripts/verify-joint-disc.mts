// 关节盘直径探针（行为，走真实消费路径 generateRenderPlan → discInstructions）：
// attachment.jointWidth 是渲染端首选直径来源（RigPanel 直径控件写的就是它）：
// ① 手动值 9 → 盘直径 9；② 改成 3.5 → 3.5（手动盖过截面）；
// ③ 删除 jointWidth → 截面回退 7；⑤ 无截面 → 4；④ autoJointDisc 关 → 不出盘。
import { generateRenderPlan } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const charId = 'discchar';
const root = createDefaultNode('root', 'root');
root.id = `node_${charId}_0`;
// 角色朝向 6 由根节点 transform.variantIndex 承载（编辑器/导入同口径），
// 渲染计划的 currentDirection 取它——夹具必须设，否则解析到方向 0 无图
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
piece.crossSections = [{ id: 'plug', mode: 'inside', diameter: 7 }] as never;
child.slot = piece as never;

const character = {
  id: charId, name: '盘测试', nodes: { [root.id]: root, [child.id]: child },
  rootNodeId: root.id, sprites: {},
  costumeSets: [{ id: 'cs1', name: '默认', pieces: { limb: piece } }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
} as unknown as Character;
const sprites: Record<string, Sprite> = { [spr.id]: spr };

const plan = () => generateRenderPlan(character, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites);

// ③ 无 jointWidth：截面回退（修活后）→ plug 截面直径 7
let discs = plan().discInstructions;
ok(discs.length === 1 && discs[0]!.diameter === 7, `自动：盘直径 = 截面 7（实际 ${discs[0]?.diameter}）`);
// ⑤ 无 jointWidth 且无截面 → 最终回退 4
piece.crossSections = [] as never;
discs = plan().discInstructions;
ok(discs.length === 1 && discs[0]!.diameter === 4, `自动无截面：盘直径 = 4（实际 ${discs[0]?.diameter}）`);
piece.crossSections = [{ id: 'plug', mode: 'inside', diameter: 7 }] as never;
// ① 手动 9
(child.attachment as any).jointWidth = 9;
discs = plan().discInstructions;
ok(discs.length === 1 && discs[0]!.diameter === 9, `手动 9：盘直径 = 9（实际 ${discs[0]?.diameter}）`);
// ② 手动 3.5 盖过截面
(child.attachment as any).jointWidth = 3.5;
discs = plan().discInstructions;
ok(discs.length === 1 && discs[0]!.diameter === 3.5, `手动 3.5：盘直径 = 3.5（实际 ${discs[0]?.diameter}）`);
// ④ 关开关不出盘
delete (child.attachment as any).jointWidth;
(child.attachment as any).autoJointDisc = false;
discs = plan().discInstructions;
ok(discs.length === 0, `关自动生成：不出盘（实际 ${discs.length}）`);

console.log(fails === 0 ? 'JOINT DISC PROBE PASS' : `JOINT DISC PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
