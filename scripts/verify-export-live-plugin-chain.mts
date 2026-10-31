// ============================================================
// 导出「实时执行」档 · 插件像素链探针：
// - 假插件经 installPluginFromSource 真注册（修改器带参数 shift、
//   缺省 16，execute = 红通道加 shift），两个部件共用同一插件。
// - live：两部件 pixelGraph 都含插件节点、params 缺省已物化、
//   pkg.plugins 里该插件代码恰一份、代表图不被烘焙改动。
// - 包内等价：PLUGIN_BRIDGE_SRC（模板与探针共用同一份桥源码）编译
//   出的求值表经 createPixelRuntime 的 ctx.plugins 注入，输出逐格
//   等于编辑器桥对同一链的求值结果（并与手算 oracle 三方对齐）。
// - 三种回落各一：未安装（伪造类型）/ 已禁用（toggle 关）/
//   无源码（registerPlugin 函数对象直注册）→ 整链回落 drop 点名 +
//   按原因分开点名、pkg.plugins 不出现。
// - drop / bake 两档对同夹具行为与此前一致（拒绝 / 烘焙各归其位）。
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
const { createPixelRuntime, PLUGIN_BRIDGE_SRC } = await import('../src/lib/proc-runtime/pixel-src');
const { evaluateNodeOutput } = await import('../src/lib/blueprint/eval');
const { asPixels } = await import('../src/lib/blueprint/ir');
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

// ---------- 假插件：红通道加 shift（参数带缺省，验 params 物化） ----------
const PLUGIN_ID = 'livetest';
const PLUGIN_TYPE = 'plugin_livetest_redshift';
const pluginCode = [
  'return {',
  '  customModifiers: [{',
  "    name: 'redshift',",
  '    params: [{ name: "shift", label: "红移", type: "number", default: 16 }],',
  '    execute: (pixels, params) => {',
  '      const s = params && typeof params.shift === "number" ? params.shift : 0;',
  '      return pixels.map((row) => row.map((c) => {',
  '        if (c === null) return null;',
  "        const r = (parseInt(c.slice(1, 3), 16) + s) % 256;",
  "        return '#' + r.toString(16).padStart(2, '0') + c.slice(3);",
  '      }));',
  '    },',
  '  }],',
  '  cleanup: () => {},',
  '};',
].join('\n');
check('插件经真注册路径装入', pluginManager.installPluginFromSource(
  { id: PLUGIN_ID, name: '实时测试', version: '1.0.0', description: '', author: 'probe' } as never, pluginCode) === true);
check('getPluginSource 返回代码原文', pluginManager.getPluginSource(PLUGIN_ID) === pluginCode);

// oracle：与插件同一变换的独立实现
function shiftRed(g: (string | null)[][], s: number): (string | null)[][] {
  return g.map((row) => row.map((c) => {
    if (c === null) return null;
    const r = (parseInt(c.slice(1, 3), 16) + s) % 256;
    return '#' + r.toString(16).padStart(2, '0') + c.slice(3);
  }));
}

// ---------- 夹具：两部件（gem 根 + orb 子）共用同一插件 ----------
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
function chainBp(nodeType: string, params: Record<string, unknown>): unknown {
  return {
    version: 1, outputId: 'scr',
    nodes: [
      { id: 'src', type: 'sprite_source', inputs: {}, params: {} },
      { id: 'op', type: nodeType, inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params },
      { id: 'scr', type: 'screen', inputs: { pixels: { nodeId: 'op', output: 'pixels' } }, params: {} },
    ],
  };
}
function makeChar(gemBp: unknown, orbBp: unknown = gemBp): never {
  const gem = {
    id: 'gem', name: '宝石', role: 'bone',
    slot: { slotKey: 'gem' },
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: ['orb'],
    blueprint: gemBp,
  };
  const orb = {
    id: 'orb', name: '宝珠', role: 'bone', parentId: 'gem',
    slot: { slotKey: 'orb' },
    transform: { x: 10, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    blueprint: orbBp,
  };
  return {
    id: 'chLive', name: '实时测试',
    nodes: { gem, orb },
    rootNodeIds: ['gem'],
    sprites: { gspr: spr('gspr', GRID1), ospr: spr('ospr', GRID2) },
    costumeSets: [
      {
        id: 'set1', name: '默认',
        pieces: {
          gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr', mirror: false } } },
          orb: { ...createDefaultCostumePiece('orb'), sprites: { 2: { spriteId: 'ospr', mirror: false } } },
        },
      },
    ],
    activeCostumeSetId: 'set1',
    variants: {},
  } as never;
}
// gem 的插件节点不带 shift（验缺省物化 16）；orb 显式带 32（验不覆写）
const gemBp = () => chainBp(PLUGIN_TYPE, {});
const orbBp = () => chainBp(PLUGIN_TYPE, { shift: 32 });

// ---------- ① live：两部件进包、源码恰一份、params 物化 ----------
const livePkg = convertCharacterToRuntimePackage(makeChar(gemBp(), orbBp()), undefined, { bake: { pluginChain: 'live' } });
{
  const gem = livePkg.parts.find((p) => p.key === 'gem');
  const orb = livePkg.parts.find((p) => p.key === 'orb');
  const gemOp = gem?.pixelGraph?.nodes.find((n) => n.type === PLUGIN_TYPE);
  const orbOp = orb?.pixelGraph?.nodes.find((n) => n.type === PLUGIN_TYPE);
  check('live：gem 挂 pixelGraph 且含插件节点', !!gemOp);
  check('live：orb 挂 pixelGraph 且含插件节点', !!orbOp);
  check('live：gem 插件节点 params 缺省已物化（shift=16）',
    (gemOp?.params as { shift?: unknown } | undefined)?.shift === 16,
    JSON.stringify(gemOp?.params));
  check('live：orb 插件节点显式 params 不被覆写（shift=32）',
    (orbOp?.params as { shift?: unknown } | undefined)?.shift === 32,
    JSON.stringify(orbOp?.params));
  check('live：pkg.plugins 恰一份该插件源码',
    Array.isArray(livePkg.plugins) && livePkg.plugins.length === 1
      && livePkg.plugins[0].id === PLUGIN_ID && livePkg.plugins[0].code === pluginCode,
    JSON.stringify(livePkg.plugins?.map((p) => p.id)));
  check('live：代表图未被烘焙改动', gridsEqual(gem?.sprite?.data as never, GRID1), norm(gem?.sprite?.data as never));
  check('live：无整链拒绝点名', !livePkg.warnings.some((w) => w.includes(PLUGIN_TYPE) && w.includes('整链未进包')),
    livePkg.warnings.join(' | ').slice(0, 200));
}

// ---------- ② 包内求值 == 编辑器桥求值 == oracle ----------
{
  const gem = livePkg.parts.find((p) => p.key === 'gem');
  const bridge = new Function(`${PLUGIN_BRIDGE_SRC}\nreturn { buildPluginNodeFns };`)() as {
    buildPluginNodeFns: (l: unknown) => { fns: Record<string, Function>; failed: string[] };
  };
  const { fns, failed } = bridge.buildPluginNodeFns(livePkg.plugins ?? []);
  check('桥：无加载失败', failed.length === 0, failed.join(','));
  check('桥：注册表含插件节点类型', typeof fns[PLUGIN_TYPE] === 'function');
  const rt = createPixelRuntime();
  const out = rt.evalPixelChain(gem!.pixelGraph!.nodes, gem!.pixelGraph!.out, {
    pixels: GRID1, plugins: fns, frame: 0, frameRate: 60,
  });
  const edOut = evaluateNodeOutput(gemBp() as never, 'op', {
    frame: 0, frameRate: 60, vars: {}, spritePixels: GRID1,
  } as never);
  const edGrid = edOut?.pixels ? asPixels(edOut.pixels as never) : null;
  check('包内求值与编辑器桥逐格一致', gridsEqual(out, edGrid), `pkg:\n${norm(out)}\neditor:\n${norm(edGrid)}`);
  check('包内求值与 oracle 逐格一致（shift=16）', gridsEqual(out, shiftRed(GRID1, 16)), norm(out));
}

// ---------- ③ 回落一：未安装（伪造类型） ----------
{
  const pkg = convertCharacterToRuntimePackage(makeChar(chainBp('plugin_ghost_nope', {})), undefined, { bake: { pluginChain: 'live' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('未装：不挂 pixelGraph', !gem?.pixelGraph);
  check('未装：drop 形态整链拒绝点名', pkg.warnings.some((w) => w.includes('plugin_ghost_nope') && w.includes('整链未进包')),
    pkg.warnings.join(' | ').slice(0, 240));
  check('未装：按原因点名未安装', pkg.warnings.some((w) => w.includes('未安装，未按实时执行进包')),
    pkg.warnings.join(' | ').slice(0, 240));
  check('未装：pkg.plugins 不出现', !pkg.plugins);
}

// ---------- ③ 回落二：已禁用 ----------
pluginManager.togglePlugin(PLUGIN_ID);
{
  const pkg = convertCharacterToRuntimePackage(makeChar(gemBp(), orbBp()), undefined, { bake: { pluginChain: 'live' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('禁用：不挂 pixelGraph', !gem?.pixelGraph);
  check('禁用：drop 形态整链拒绝点名（用注册标签）', pkg.warnings.some((w) => w.includes('（插件:redshift）不在运行时支持集') && w.includes('整链未进包')),
    pkg.warnings.join(' | ').slice(0, 240));
  check('禁用：按原因点名已禁用', pkg.warnings.some((w) => w.includes('插件〈实时测试〉已禁用，未按实时执行进包')),
    pkg.warnings.join(' | ').slice(0, 240));
  check('禁用：pkg.plugins 不出现', !pkg.plugins);
}
pluginManager.togglePlugin(PLUGIN_ID);

// ---------- ③ 回落三：无源码（编程式函数注册） ----------
check('编程式注册成功', pluginManager.registerPlugin(
  { id: 'progtest', name: '编程式', version: '1.0.0', description: '', author: 'probe' },
  () => ({ customModifiers: [{ name: 'redshift', params: [], execute: (px: (string | null)[][]) => px }] }),
) === true);
check('编程式注册无源码', pluginManager.getPluginSource('progtest') === undefined);
{
  const pkg = convertCharacterToRuntimePackage(makeChar(chainBp('plugin_progtest_redshift', {})), undefined, { bake: { pluginChain: 'live' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('无源码：不挂 pixelGraph', !gem?.pixelGraph);
  check('无源码：按原因点名', pkg.warnings.some((w) => w.includes('插件〈编程式〉以编程式注册、无源码可携带，未按实时执行进包')),
    pkg.warnings.join(' | ').slice(0, 240));
  check('无源码：pkg.plugins 不出现', !pkg.plugins);
}

// ---------- ④ drop / bake 对同夹具与此前一致 ----------
{
  const pkg = convertCharacterToRuntimePackage(makeChar(gemBp(), orbBp()), undefined, { bake: { pluginChain: 'drop' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('drop：插件链不挂 pixelGraph', !gem?.pixelGraph);
  check('drop：整链拒绝点名（用注册标签）', pkg.warnings.some((w) => w.includes('（插件:redshift）不在运行时支持集') && w.includes('整链未进包')));
  check('drop：pkg.plugins 不出现', !pkg.plugins);
}
{
  const pkg = convertCharacterToRuntimePackage(makeChar(gemBp(), orbBp()), undefined, { bake: { pluginChain: 'bake' } });
  const gem = pkg.parts.find((p) => p.key === 'gem');
  const orb = pkg.parts.find((p) => p.key === 'orb');
  check('bake：不挂 pixelGraph', !gem?.pixelGraph && !orb?.pixelGraph);
  check('bake：gem 代表图 = 编辑器桥求值（shift 缺省 16）', gridsEqual(gem?.sprite?.data as never, shiftRed(GRID1, 16)),
    norm(gem?.sprite?.data as never));
  check('bake：orb 代表图 = 编辑器桥求值（shift=32）', gridsEqual(orb?.sprite?.data as never, shiftRed(GRID2, 32)),
    norm(orb?.sprite?.data as never));
  check('bake：pkg.plugins 不出现', !pkg.plugins);
}

console.log(`\nverify-export-live-plugin-chain: ${pass} passed, ${fail} failed`);
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
