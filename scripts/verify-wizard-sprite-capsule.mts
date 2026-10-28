// 向导抠图精灵→兜底胶囊 bug 复现探针（行为，走真实消费路径 generateRenderPlan）：
// 角色与服装数据按装配向导写侧的真实产物形状构造——
//   · 节点按存量形状构造：createDefaultNode 现已出生自带 slot（写侧挂牌
//     裁决），夹具显式删掉以模拟补挂前的存量工程——读侧回退是兜底，
//     对存量形状必须仍成立；
//   · 向导建工作服装并设为生效（RefAssemblyWizard 建集 + activeCostumeSetId）；
//   · 抠图关联写侧（MaskBrushOverlay）：键 = node.slot?.slotKey ?? nodeId → 无 slot 即节点 id，
//     值 = pieces[键].sprites[根节点 variantIndex] = { spriteId }。
// 断言：该部位出精灵指令、不出兜底胶囊；真无精灵节点与「有槽位但集内无件」
// 节点仍出胶囊（兜底本职不误伤）；无 slot 节点的变体指派（DressPanel 按
// slotKey ?? nodeId 写入）渲染端能查到。
import { generateRenderPlan } from '../src/lib/unified-render';
import {
  createDefaultNode, createDefaultCostumePiece, pxToSub,
  type Character, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const charId = 'wizchar';
const root = createDefaultNode('root', 'root');
root.id = `node_${charId}_0`;
(root.transform as any).variantIndex = 6;
const limb = createDefaultNode('limb', '左臂');
limb.id = `node_${charId}_1`;
limb.parentId = root.id;
const bare = createDefaultNode('bare', '裸节点');
bare.id = `node_${charId}_2`;
bare.parentId = root.id;
const ghost = createDefaultNode('ghost', '空槽节点');
ghost.id = `node_${charId}_3`;
ghost.parentId = root.id;
// 存量形状：删掉工厂默认 slot（root/limb/bare 回到补挂前的无 slot 态）
delete (root as any).slot;
delete (limb as any).slot;
delete (bare as any).slot;
// 有 slot 定义、但生效集内没有对应件 → 仍应兜底（回退查无件不许凭空出图）
ghost.slot = createDefaultCostumePiece('ghost_slot') as never;
root.children = [limb.id, bare.id, ghost.id];
root.sockets = [1, 2, 3].map((i) => ({
  id: `sock_${i}`, name: `s${i}`, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(20 * i), y: pxToSub(6 * i), z: 0 },
}));
limb.attachment = { type: 'socket', parentSocketId: 'sock_1', plug: { x: 0, y: 0 } } as never;
bare.attachment = { type: 'socket', parentSocketId: 'sock_2', plug: { x: 0, y: 0 } } as never;
ghost.attachment = { type: 'socket', parentSocketId: 'sock_3', plug: { x: 0, y: 0 } } as never;

const grid = (c: string) => Array.from({ length: 10 }, () => Array(10).fill(c));
const spr: Sprite = {
  id: 'spr_mask_limb', name: '遮罩_左臂', width: 10, height: 10, data: grid('#3366cc'),
  plug: { x: pxToSub(5), y: pxToSub(9) },
} as Sprite;
const sprV: Sprite = {
  id: 'spr_mask_limb_v1', name: '遮罩_左臂_变体', width: 10, height: 10, data: grid('#cc6633'),
  plug: { x: pxToSub(5), y: pxToSub(9) },
} as Sprite;

// 向导写侧的真实形状：键 = 节点 id（无 slot 回退），方向 = 根 variantIndex(6)
const piece = createDefaultCostumePiece(limb.id);
piece.sprites = { 6: { spriteId: spr.id } } as never;
piece.variantSprites = { v1: { 6: { spriteId: sprV.id } } } as never;

const character = {
  id: charId, name: '向导测试', nodes: { [root.id]: root, [limb.id]: limb, [bare.id]: bare, [ghost.id]: ghost },
  rootNodeId: root.id, sprites: {},
  costumeSets: [{ id: 'cs_wiz', name: '向导测试（装配）', pieces: { [limb.id]: piece } }],
  activeCostumeSetId: 'cs_wiz', direction: 6, latitude: 0,
} as unknown as Character;
const sprites: Record<string, Sprite> = { [spr.id]: spr, [sprV.id]: sprV };

const plan = (ch: Character) => generateRenderPlan(ch, 0, 256, 256, 'pixel-perfect', 12,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sprites,
  undefined, undefined, undefined, undefined, undefined, true);

// ⓪ 形状守卫：确实是向导产物形状（无 slot、件键=节点 id、生效集已设）
ok((limb as any).slot === undefined, '⓪ 向导节点无 slot 字段');
ok(Object.keys((character as any).costumeSets[0].pieces)[0] === limb.id, '⓪ 件键 = 节点 id');

const p = plan(character);
const insOf = (id: string) => p.nodeInstructions.find((i) => i.nodeId === id);
const mqOf = (id: string) => (p.mannequinInstructions ?? []).filter((m) => m.nodeId === id);

// ① 抠图部位：出精灵指令且是抠出的那张精灵
const limbIns = insOf(limb.id);
ok(!!limbIns, `① 抠图部位有精灵指令（实际指令节点：${p.nodeInstructions.map((i) => i.nodeId).join(',') || '无'}）`);
ok(limbIns?.sprite?.id === spr.id, `① 指令精灵 = 抠图精灵（实际 ${limbIns?.sprite?.id ?? '无'}）`);
// ② 抠图部位：不出兜底胶囊
ok(mqOf(limb.id).length === 0, `② 抠图部位无兜底胶囊（实际 ${mqOf(limb.id).length}）`);
// ③ 真无精灵节点：仍兜底
ok(!insOf(bare.id) && mqOf(bare.id).length > 0, '③ 真无精灵节点仍出兜底胶囊');
// ④ 有槽位但集内无件：仍兜底（回退查无件不许出图）
ok(!insOf(ghost.id) && mqOf(ghost.id).length > 0, '④ 空槽节点仍出兜底胶囊');

// ⑤ 变体指派（写入键 = 节点 id）渲染端可达：指派 v1 后指令精灵变变体图
const charV = { ...(character as any), slotVariants: { [limb.id]: 'v1' } } as unknown as Character;
const pv = plan(charV);
const limbInsV = pv.nodeInstructions.find((i) => i.nodeId === limb.id);
ok(limbInsV?.sprite?.id === sprV.id, `⑤ 变体指派生效（实际 ${limbInsV?.sprite?.id ?? '无'}）`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
