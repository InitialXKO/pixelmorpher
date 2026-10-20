// 验证服装状态三层叠加：静态字段 → clip 状态轨道 → 状态蓝图
// A) 轨道层求值（resolveEffectiveCostumeState）
// B) 状态蓝图组装（evaluateCostumeState：params/接线优先/gate/enabled 短路/清除语义）
// C) 三层优先级合成
// D) pickClipStateKeyframes 归属规则
// E) generateRenderPlan 集成（轨道切换服装集/变体真实改变渲染精灵；无轨道时与静态一致）
import { resolveEffectiveCostumeState, resolveTrackCostumeState, pickClipStateKeyframes, generateRenderPlan } from '../src/lib/unified-render';
import { evaluateCostumeState } from '../src/lib/blueprint/eval';

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}

// ---------- A ----------
const baseChar: any = {
  activeCostumeSetId: 'csA',
  slotVariants: { leg: 'v1' },
  costumeSets: [],
  nodes: {},
};
const keys: any[] = [
  { frame: 10, slotChanges: { arm: 'v9' } },
  { frame: 5, costumeSetId: 'csB' },
  { frame: 15, slotChanges: { leg: null } },
];
const eff = (ch: any, f: number, kf?: any[]) => resolveEffectiveCostumeState(ch, f, 12, kf);
check('A1 f0 静态原样', eff(baseChar, 0, keys).costumeSetId === 'csA' && eq(eff(baseChar, 0, keys).slotVariants, { leg: 'v1' }), '');
check('A2 f4 键未到不生效', eff(baseChar, 4, keys).costumeSetId === 'csA', '');
check('A3 f5 集整覆（乱序键已排序）', eff(baseChar, 5, keys).costumeSetId === 'csB' && eq(eff(baseChar, 5, keys).slotVariants, { leg: 'v1' }), '');
check('A4 f10 逐槽叠加', eq(eff(baseChar, 10, keys).slotVariants, { leg: 'v1', arm: 'v9' }), '');
check('A5 f15 null 回基础（删指派）', eq(eff(baseChar, 15, keys).slotVariants, { arm: 'v9' }) && eff(baseChar, 99, keys).costumeSetId === 'csB', '');
check('A6 无轨道 = 静态', eff(baseChar, 30).costumeSetId === 'csA' && eq(eff(baseChar, 30).slotVariants, { leg: 'v1' }), '');
check('A7 求值不污染角色静态字段', baseChar.activeCostumeSetId === 'csA' && eq(baseChar.slotVariants, { leg: 'v1' }), '');

// ---------- B ----------
const csNode = (id: string, params: any, inputs: any = {}): any => ({ id, type: 'costume_state', inputs, params });
const graph = (nodes: any[]): any => ({ version: 1, nodes, outputId: nodes[nodes.length - 1].id });
const evalCS = (g: any) => evaluateCostumeState(g, { frame: 0, frameRate: 12, vars: {} } as any);

const g1 = graph([csNode('a', { setId: 'csC' }), csNode('b', { slot: 'arm', variant: 'vB' })]);
check('B1 params 组装', eq(evalCS(g1), { setId: 'csC', slotChanges: { arm: 'vB' } }), JSON.stringify(evalCS(g1)));
const g2 = graph([csNode('a', { slot: 'leg', clearVariant: 'true' })]);
check('B2 clearVariant → null', eq(evalCS(g2), { slotChanges: { leg: null } }), JSON.stringify(evalCS(g2)));
const g3 = graph([csNode('a', { setId: 'csParam' }, { setId: { type: 'string', value: 'csWired' } })]);
check('B3 接线 setId 优先于 params', evalCS(g3)?.setId === 'csWired', JSON.stringify(evalCS(g3)));
const g4 = graph([csNode('a', { setId: 'csX' }, { gate: { type: 'number', value: 0 } })]);
check('B4 gate=0 短路 → 无指令', evalCS(g4) === null, '');
const g5 = graph([csNode('a', { setId: 'csX', enabled: false })]);
check('B5 enabled=false 短路 → 无指令', evalCS(g5) === null, '');
const g6 = graph([csNode('a', {})]);
check('B6 空参数节点 → 无指令', evalCS(g6) === null, '');

// ---------- C ----------
const charBP: any = { ...baseChar, stateBlueprint: g1 };
check('C1 蓝图覆盖轨道：集 csC + arm vB，leg 保留静态', (() => {
  const e = eff(charBP, 10, keys);
  return e.costumeSetId === 'csC' && eq(e.slotVariants, { leg: 'v1', arm: 'vB' });
})(), JSON.stringify(eff(charBP, 10, keys)));
const charBP2: any = { ...baseChar, stateBlueprint: g2 };
check('C2 蓝图清除覆盖轨道/静态指派', eq(eff(charBP2, 10, keys).slotVariants, { arm: 'v9' }), JSON.stringify(eff(charBP2, 10, keys)));
const charBad: any = { ...baseChar, stateBlueprint: graph([{ id: 'x', type: 'nonexistent_node', inputs: {}, params: {} }]) };
check('C3 蓝图无有效指令 → 回落轨道层', eff(charBad, 10, keys).costumeSetId === 'csB', '');
check('C4 轨道层求值不含蓝图（UI 摘要/diff 口径）', (() => {
  const t = resolveTrackCostumeState(charBP, 10, keys);
  return t.costumeSetId === 'csB' && eq(t.slotVariants, { leg: 'v1', arm: 'v9' });
})(), JSON.stringify(resolveTrackCostumeState(charBP, 10, keys)));

// ---------- D ----------
const clips: any[] = [
  { id: 'c1', puppetCharacterId: 'char1', stateKeyframes: keys },
  { id: 'c2', puppetCharacterId: 'char2', stateKeyframes: [{ frame: 0, costumeSetId: 'csZ' }] },
  { id: 'c3', puppetCharacterId: 'char1' },
];
check('D1 激活+归属命中', pickClipStateKeyframes(clips, 'c1', 'char1') === keys, '');
check('D2 归属不符 → undefined', pickClipStateKeyframes(clips, 'c1', 'char2') === undefined, '');
check('D3 无激活 clip → undefined', pickClipStateKeyframes(clips, null, 'char1') === undefined, '');
check('D4 clip 无状态轨道 → undefined', pickClipStateKeyframes(clips, 'c3', 'char1') === undefined, '');

// ---------- E ----------
const sp = (id: string): any => ({ id, width: 2, height: 2, data: [[id]] });
const spriteTable: Record<string, any> = {};
for (const id of ['sprA', 'sprB', 'sprD']) spriteTable[id] = sp(id);
const ref = (id: string): any => ({ spriteId: id });
const pieceArm = (base: string, variantSprites?: any): any => ({
  slotKey: 'arm', fillColor: '#888',
  sprites: { 6: ref(base) },
  ...(variantSprites ? { variantSprites } : {}),
  scaleVariants: {}, mirrorMap: {}, crossSections: [],
});
const mkChar = (extra: any = {}): any => ({
  id: 'char1',
  name: 'T',
  rootNodeId: 'n1',
  nodes: {
    n1: {
      id: 'n1', name: 'n1', parentId: null, children: [],
      transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6 },
      tracks: {}, modifiers: [], sockets: [],
      attachment: { type: 'root' },
      slot: { slotKey: 'arm' },
      drawLayer: 'default', visible: true,
    },
  },
  costumeSets: [
    { id: 'csA', name: 'A', pieces: { arm: pieceArm('sprA', { vD: { 6: ref('sprD') } }) } },
    { id: 'csB', name: 'B', pieces: { arm: pieceArm('sprB') } },
  ],
  activeCostumeSetId: 'csA',
  directionDrawOrders: {},
  latitude: 0,
  sprites: {},
  createdAt: 0, updatedAt: 0,
  ...extra,
});
const spriteAt = (ch: any, frame: number, kf?: any[]): string | null => {
  const plan = generateRenderPlan(ch, frame, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, spriteTable, undefined, undefined, kf);
  const ins = plan.nodeInstructions.find((i: any) => i.nodeId === 'n1');
  return (ins?.sprite as any)?.id ?? null;
};
check('E1 无轨道 → 静态集 sprA', spriteAt(mkChar(), 0) === 'sprA', `=${spriteAt(mkChar(), 0)}`);
check('E2 轨道 f5 起换 csB', spriteAt(mkChar(), 4, keys) === 'sprA' && spriteAt(mkChar(), 5, keys) === 'sprB', `f4=${spriteAt(mkChar(), 4, keys)} f5=${spriteAt(mkChar(), 5, keys)}`);
check('E3 轨道指派变体 → 变体图 sprD', spriteAt(mkChar(), 0, [{ frame: 0, slotChanges: { arm: 'vD' } }]) === 'sprD', '');
check('E4 状态蓝图换集（无轨道）', spriteAt(mkChar({ stateBlueprint: graph([csNode('a', { setId: 'csB' })]) }), 0) === 'sprB', '');
check('E5 蓝图优先于轨道', spriteAt(mkChar({ stateBlueprint: graph([csNode('a', { setId: 'csB' })]) }), 0, [{ frame: 0, costumeSetId: 'csA' }]) === 'sprB', '');

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
