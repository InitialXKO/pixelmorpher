// ============================================================
// 导出「烘焙」档 · 插件像素链探针：
// - 假插件经 plugin-manager 真注册路径装入（求值器进 EVALUATORS），
//   修改器 = 红色通道反相（手算 oracle 在本文件独立实现）。
// - drop / 缺省：含插件节点的链整链拒绝、代表图逐格不变、点名。
// - bake：代表图（生效集 part.sprite + 各集 __sprite 副本）被替换为
//   链求值结果（逐格对 oracle）、不挂 pixelGraph、出已烘交代。
// - bake + 帧相关链（wobble 光栅化平移随帧变）：仍拒 + 点名随帧变化。
// - bake + 未注册类型链：仍拒 + 点名无求值器。
// - bake + 全支持集链：不被烘焙接管，照常挂 pixelGraph。
// ============================================================

// localStorage 桩必须在导入 plugin-manager 前装好
const lsData = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (lsData.has(k) ? lsData.get(k)! : null),
  setItem: (k: string, v: string) => { lsData.set(k, String(v)); },
  removeItem: (k: string) => { lsData.delete(k); },
};

const { pluginManager } = await import('../src/lib/plugin-manager');
const { convertCharacterToRuntimePackage } = await import('../src/lib/proc-runtime/convert');
const { createDefaultCostumePiece } = await import('../src/lib/unified-types');

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}
function norm(g: (string | null)[][] | null | undefined): string {
  if (!g) return '<null>';
  return g.map((row) => row.map((c) => (c ? c.toLowerCase() : '.')).join(' ')).join('\n');
}
const gridsEqual = (a: (string | null)[][] | null | undefined, b: (string | null)[][] | null | undefined) => norm(a) === norm(b);

// ---------- 假插件：红色通道反相 ----------
const PLUGIN_TYPE = 'plugin_baketest_redinv';
const pluginCode = [
  'return {',
  '  customModifiers: [{',
  "    name: 'redinv',",
  '    params: [],',
  '    execute: (pixels) => pixels.map((row) => row.map((c) => {',
  '      if (c === null) return null;',
  "      const r = 255 - parseInt(c.slice(1, 3), 16);",
  "      return '#' + r.toString(16).padStart(2, '0') + c.slice(3);",
  '    })),',
  '  }],',
  '  cleanup: () => {},',
  '};',
].join('\n');
check('插件经真注册路径装入', pluginManager.installPluginFromSource(
  { id: 'baketest', name: '烘焙测试', version: '1.0.0', description: '', author: 'probe' } as never, pluginCode) === true);

// oracle：与插件同一变换的独立实现
function invRed(g: (string | null)[][]): (string | null)[][] {
  return g.map((row) => row.map((c) => {
    if (c === null) return null;
    const r = 255 - parseInt(c.slice(1, 3), 16);
    return '#' + r.toString(16).padStart(2, '0') + c.slice(3);
  }));
}

// ---------- 夹具：单节点精灵部件、两套服装集（不同图同尺寸） ----------
const GRID1: (string | null)[][] = [
  ['#cc3333', '#3366cc', null, '#33aa55'],
  ['#3366cc', null, '#33aa55', '#cc3333'],
  [null, '#33aa55', '#cc3333', '#3366cc'],
];
const GRID2: (string | null)[][] = [
  ['#102030', '#405060', '#708090', null],
  ['#a0b0c0', null, '#112233', '#445566'],
  ['#778899', '#99aabb', null, '#ddeeff'],
];
function spr(id: string, data: (string | null)[][]) {
  return { id, width: 4, height: 3, plug: { x: 0, y: 0 }, data, directions: { 2: { spriteId: id, mirror: false } } };
}
function makeChar(blueprint: unknown): never {
  const node = {
    id: 'gem', name: '宝石', role: 'bone',
    slot: { slotKey: 'gem' },
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    blueprint,
  };
  return {
    id: 'chBake', name: '烘焙测试',
    nodes: { gem: node },
    rootNodeIds: ['gem'],
    sprites: { gspr: spr('gspr', GRID1), gspr2: spr('gspr2', GRID2) },
    costumeSets: [
      { id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } } },
      { id: 'set2', name: '二套', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr2', mirror: false } } } } },
    ],
    activeCostumeSetId: 'set1',
    variants: {},
  } as never;
}
function chainBp(midNodes: unknown[]): unknown {
  const nodes: unknown[] = [{ id: 'src', type: 'sprite_source', inputs: {}, params: {} }];
  let prev = 'src';
  for (const n of midNodes as Array<{ id: string }>) { nodes.push(n); prev = n.id; }
  nodes.push({ id: 'scr', type: 'screen', inputs: { pixels: { nodeId: prev, output: 'pixels' } }, params: {} });
  return { version: 1, outputId: 'scr', nodes };
}
const pluginBp = () => chainBp([
  { id: 'op', type: PLUGIN_TYPE, inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: {} },
]);

// ---------- drop / 缺省：整链拒绝、图不变 ----------
for (const [label, opts] of [['缺省', undefined], ['drop', { bake: { pluginChain: 'drop' as const } }]] as const) {
  const pkg = convertCharacterToRuntimePackage(makeChar(pluginBp()), undefined, opts as never);
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check(`${label}：插件链不挂 pixelGraph`, !gem?.pixelGraph);
  check(`${label}：代表图逐格不变`, gridsEqual(gem?.sprite?.data as never, GRID1), norm(gem?.sprite?.data as never));
  check(`${label}：整链拒绝点名`, pkg.warnings.some((w) => w.includes(PLUGIN_TYPE) && w.includes('整链未进包')),
    pkg.warnings.join(' | ').slice(0, 200));
  check(`${label}：无已烘交代`, !pkg.warnings.some((w) => w.includes('已静态烘焙进包')));
}

// ---------- bake：代表图被链结果替换 ----------
{
  const pkg = convertCharacterToRuntimePackage(makeChar(pluginBp()), undefined, { bake: { pluginChain: 'bake' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('bake：不挂 pixelGraph（防二次施加）', !gem?.pixelGraph);
  check('bake：生效集代表图 = 链求值结果（逐格对 oracle）', gridsEqual(gem?.sprite?.data as never, invRed(GRID1)),
    norm(gem?.sprite?.data as never));
  const set2 = (pkg.costumes as Record<string, { __sprite?: Record<string, { data: (string | null)[][] }> }> )['set2'];
  check('bake：二套 __sprite 代表图 = 该集源图过链', gridsEqual(set2?.__sprite?.gem?.data, invRed(GRID2)),
    norm(set2?.__sprite?.gem?.data));
  const set1 = (pkg.costumes as Record<string, { __sprite?: Record<string, { data: (string | null)[][] }> }> )['set1'];
  check('bake：生效集 __sprite 副本同样已烘', gridsEqual(set1?.__sprite?.gem?.data, invRed(GRID1)),
    norm(set1?.__sprite?.gem?.data));
  check('bake：已烘交代 warning', pkg.warnings.some((w) => w.includes('已静态烘焙进包') && w.includes('运行时不再重算')),
    pkg.warnings.join(' | ').slice(0, 200));
  check('bake：不再有整链拒绝点名', !pkg.warnings.some((w) => w.includes(PLUGIN_TYPE) && w.includes('整链未进包')),
    pkg.warnings.join(' | ').slice(0, 200));
}

// ---------- bake + 帧相关链：仍拒、点名随帧变化 ----------
{
  const bp = chainBp([
    { id: 'op', type: PLUGIN_TYPE, inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: {} },
    { id: 'wob', type: 'wobble', inputs: { pixels: { nodeId: 'op', output: 'pixels' } }, params: { moveAmplitude: 3, period: 1, damping: 0 } },
  ]);
  const pkg = convertCharacterToRuntimePackage(makeChar(bp), undefined, { bake: { pluginChain: 'bake' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('帧相关链：不挂 pixelGraph', !gem?.pixelGraph);
  check('帧相关链：代表图不变（未半烘）', gridsEqual(gem?.sprite?.data as never, GRID1));
  check('帧相关链：点名随帧变化', pkg.warnings.some((w) => w.includes('仍未烘成') && w.includes('链随帧变化')),
    pkg.warnings.join(' | ').slice(0, 240));
}

// ---------- bake + 未注册类型：仍拒、点名无求值器 ----------
{
  const bp = chainBp([
    { id: 'op', type: 'plugin_ghost_nope', inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: {} },
  ]);
  const pkg = convertCharacterToRuntimePackage(makeChar(bp), undefined, { bake: { pluginChain: 'bake' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('未注册链：不挂 pixelGraph', !gem?.pixelGraph);
  check('未注册链：代表图不变', gridsEqual(gem?.sprite?.data as never, GRID1));
  check('未注册链：点名无求值器', pkg.warnings.some((w) => w.includes('仍未烘成') && w.includes('无求值器') && w.includes('plugin_ghost_nope')),
    pkg.warnings.join(' | ').slice(0, 240));
}

// ---------- bake + 全支持集链：不接管、照常挂 pixelGraph ----------
{
  const bp = chainBp([
    { id: 'op', type: 'outline', inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: { thickness: 1, color: '#0a0a0a' } },
  ]);
  const pkg = convertCharacterToRuntimePackage(makeChar(bp), undefined, { bake: { pluginChain: 'bake' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('支持集链：bake 档照常挂 pixelGraph', !!gem?.pixelGraph && gem.pixelGraph.out === 'op');
  check('支持集链：代表图不被烘焙改动', gridsEqual(gem?.sprite?.data as never, GRID1));
}

console.log(`\nverify-export-bake-plugin-chain: ${pass} passed, ${fail} failed`);
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
