// ============================================================
// 插件警告标签探针：导出警告点名插件节点时用注册标签（「插件:<名>」），
// 不用原始类型串 plugin_<id>_<名>。
// - 真注册路径：installPluginFromSource 装入假插件（修改器名「反相」），
//   其节点拼像素链、真跑 convertCharacterToRuntimePackage（缺省 drop 档），
//   断言整链拒绝警告里是（插件:反相）而非原始串；
// - 同一角色的表演图含该插件节点，断言表演段「含运行时不支持的节点」
//   点名同样走标签；
// - 对照：未注册的 plugin_ 类型无标签可查 → 回落原始串；
// - 对照：内置类型 particle 自带中文标签「粒子」，但警告必须逐字保留
//   原始串（helper 只对 plugin_ 前缀查标签，内置文案不被改写）；
// - helper 本体直断（全部点名点共用同一函数）。
// 证伪口径：把 nodeTypeDisplayName 改回恒等（return type）时，
// 标签断言（1/2/6）必须失败——已实测留痕于提交说明。
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
const { nodeTypeDisplayName } = await import('../src/lib/proc-runtime/graph-translate');
const { createDefaultCostumePiece } = await import('../src/lib/unified-types');

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}

// ---------- 假插件：修改器名「反相」（红色通道反相，内容与本探针无关） ----------
const PLUGIN_TYPE = 'plugin_labeltest_反相';
const pluginCode = [
  'return {',
  '  customModifiers: [{',
  "    name: '反相',",
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
  { id: 'labeltest', name: '标签测试', version: '1.0.0', description: '', author: 'probe' } as never, pluginCode) === true);

// ---------- helper 本体 ----------
check('helper：已注册插件类型 → 注册标签', nodeTypeDisplayName(PLUGIN_TYPE) === '插件:反相',
  nodeTypeDisplayName(PLUGIN_TYPE));
check('helper：未注册插件类型 → 回落原始串', nodeTypeDisplayName('plugin_ghosttest_xyz') === 'plugin_ghosttest_xyz');
check('helper：内置类型 particle 原样（不借其标签「粒子」）', nodeTypeDisplayName('particle') === 'particle');
check('helper：内置类型 bloom 原样', nodeTypeDisplayName('bloom') === 'bloom');
check('helper：普通内置类型原样', nodeTypeDisplayName('wobble') === 'wobble');

// ---------- 夹具：单节点精灵部件（照 verify-export-bake-plugin-chain 的生产形态） ----------
const GRID: (string | null)[][] = [
  ['#cc3333', '#3366cc', null, '#33aa55'],
  ['#3366cc', null, '#33aa55', '#cc3333'],
];
function spr(id: string, data: (string | null)[][]) {
  return { id, width: 4, height: 2, plug: { x: 0, y: 0 }, data, directions: { 2: { spriteId: id, mirror: false } } };
}
function chainBp(midType: string): unknown {
  return {
    version: 1, outputId: 'scr',
    nodes: [
      { id: 'src', type: 'sprite_source', inputs: {}, params: {} },
      { id: 'op', type: midType, inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: {} },
      { id: 'scr', type: 'screen', inputs: { pixels: { nodeId: 'op', output: 'pixels' } }, params: {} },
    ],
  };
}
function makeChar(blueprint: unknown, performances?: unknown): never {
  const node = {
    id: 'gem', name: '宝石', role: 'bone',
    slot: { slotKey: 'gem' },
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    blueprint,
  };
  return {
    id: 'chLabel', name: '标签测试',
    nodes: { gem: node },
    rootNodeIds: ['gem'],
    sprites: { gspr: spr('gspr', GRID) },
    costumeSets: [
      { id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } } },
    ],
    activeCostumeSetId: 'set1',
    variants: {},
    performances,
  } as never;
}
const chainWarningOf = (pkg: { warnings: string[] }) => pkg.warnings.find((w) => w.includes('整链未进包'));

// ---------- 真消费路径 1：像素链整链拒绝（已注册插件 → 标签） ----------
{
  const pkg = convertCharacterToRuntimePackage(makeChar(chainBp(PLUGIN_TYPE)), undefined, undefined);
  const w = chainWarningOf(pkg);
  check('像素链：整链拒绝警告存在', !!w, pkg.warnings.join(' | ').slice(0, 300));
  check('像素链：警告用注册标签（插件:反相）', !!w && w.includes('（插件:反相）不在运行时支持集'), w);
  check('像素链：警告不含原始类型串', !!w && !w.includes(PLUGIN_TYPE), w);
}

// ---------- 真消费路径 2：表演段 typeReport 点名（已注册插件 → 标签） ----------
{
  const perfGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 'out', type: 'transform', inputs: {}, params: {} },
      { id: 'op', type: PLUGIN_TYPE, inputs: {}, params: {} },
    ],
  };
  const perf = {
    id: 'p1', name: '试演', trigger: 'attack', duration: 1,
    envelopeIn: 0.05, envelopeOut: 0.15, mode: 'override',
    maskNodeIds: ['gem'], graphs: { gem: perfGraph }, enabled: true,
  };
  const pkg = convertCharacterToRuntimePackage(makeChar(null, [perf]), undefined, undefined);
  const w = pkg.warnings.find((x) => x.includes('含运行时不支持的节点'));
  check('表演段：不支持节点点名存在', !!w, pkg.warnings.join(' | ').slice(0, 300));
  check('表演段：点名用注册标签（插件:反相）', !!w && w.includes('含运行时不支持的节点：插件:反相'), w);
  check('表演段：点名不含原始类型串', !!w && !w.includes(PLUGIN_TYPE), w);
}

// ---------- 对照：未注册 plugin_ 类型 → 回落原始串 ----------
{
  const pkg = convertCharacterToRuntimePackage(makeChar(chainBp('plugin_ghosttest_xyz')), undefined, undefined);
  const w = chainWarningOf(pkg);
  check('未注册：整链拒绝警告存在', !!w, pkg.warnings.join(' | ').slice(0, 300));
  check('未注册：警告回落原始类型串', !!w && w.includes('（plugin_ghosttest_xyz）不在运行时支持集'), w);
}

// ---------- 对照：内置类型 particle → 文案逐字未变（不借标签） ----------
{
  const pkg = convertCharacterToRuntimePackage(makeChar(chainBp('particle')), undefined, undefined);
  const w = chainWarningOf(pkg);
  check('内置：整链拒绝警告存在', !!w, pkg.warnings.join(' | ').slice(0, 300));
  check('内置：警告逐字为原始串（particle）', !!w && w.includes('（particle）不在运行时支持集'), w);
  check('内置：警告未被改写成标签（粒子）', !!w && !w.includes('（粒子）'), w);
}

console.log(`\nverify-plugin-warning-labels: ${pass} passed, ${fail} failed`);
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
