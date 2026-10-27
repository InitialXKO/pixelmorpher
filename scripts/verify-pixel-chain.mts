// ============================================================
// 像素链进包探针：
// P 组 — 孪生对拍：编辑器 evaluateBlueprint（sprite_source → 算子
//   → screen，drawToScreen 捕获）vs PIXEL_SRC evalPixelChain，
//   逐格比对（21 算子 × 参数变体 × 两帧）。
// Q 组 — 链语义：gate 直通、禁用节点、多节链、数值接线驱动参数。
// C 组 — convert 提取：像素链进包、costume 链点名不进、参数化
//   部件点名不进、范围外算子点名不进。
// T 组 — 模板接线：PIXEL_SRC 注入、像素作业函数在位。
// ============================================================
import { evaluateBlueprint } from '../src/lib/blueprint/eval';
import { createPixelRuntime } from '../src/lib/proc-runtime/pixel-src';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { createDefaultCostumePiece } from '../src/lib/unified-types';

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}

// ---------- 夹具网格：14×12，多色团块 + 内部空洞 + 孤点 ----------
function fixtureGrid(): (string | null)[][] {
  const W = 14, H = 12;
  const g: (string | null)[][] = Array.from({ length: H }, () => Array(W).fill(null));
  const cols = ['#cc3333', '#3366cc', '#33aa55', '#ddaa22'];
  for (let y = 2; y < 10; y++) {
    for (let x = 2; x < 12; x++) {
      if ((x === 2 || x === 11) && (y === 2 || y === 9)) continue; // 圆角缺口
      g[y][x] = cols[(x + y) % 4];
    }
  }
  g[5][6] = null; g[5][7] = null; // 内部空洞（holeFill 目标）
  g[0][0] = '#ffffff'; // 孤点（cleanup 目标）
  g[11][13] = '#111111';
  g[1][12] = '#3366cc'; g[1][13] = '#3366cc'; // 二连块
  return g;
}

function norm(g: (string | null)[][] | null | undefined): string {
  if (!g) return '<null>';
  return g.map((row) => row.map((c) => (c ? c.toLowerCase() : '.')).join(' ')).join('\n');
}
function gridsEqual(a: (string | null)[][] | null, b: (string | null)[][] | null): boolean {
  return norm(a) === norm(b);
}

// 编辑器路：蓝图 sprite_source → op(s) → screen
function editorChain(
  ops: Array<{ id: string; type: string; params?: Record<string, unknown>; inputs?: Record<string, unknown> }>,
  grid: (string | null)[][],
  frame: number,
  frameRate: number,
): (string | null)[][] | null {
  const nodes: any[] = [{ id: 'src', type: 'sprite_source', inputs: {}, params: {} }];
  let prev = 'src';
  for (const op of ops) {
    nodes.push({
      id: op.id, type: op.type, params: op.params ?? {},
      inputs: { pixels: { nodeId: prev, output: 'pixels' }, ...(op.inputs ?? {}) },
    });
    prev = op.id;
  }
  nodes.push({ id: 'scr', type: 'screen', inputs: { pixels: { nodeId: prev, output: 'pixels' } }, params: {} });
  let captured: (string | null)[][] | null | undefined;
  const graph = { version: 1 as const, nodes, edges: [], outputId: 'scr' } as never;
  evaluateBlueprint(graph, {
    frame, frameRate, vars: {},
    spritePixels: grid,
    drawToScreen: (cmd: { pixels: (string | null)[][] }) => { captured = cmd.pixels; },
  } as never);
  return captured === undefined ? null : captured;
}

// 孪生路：迷你图（与 convert 输出同格式）
function twinChain(
  ops: Array<{ id: string; type: string; params?: Record<string, unknown>; inputs?: Record<string, unknown> }>,
  grid: (string | null)[][],
  frame: number,
  frameRate: number,
): (string | null)[][] | null {
  const rt = createPixelRuntime();
  const nodes: any[] = [{ id: 'src', type: 'sprite_source' }];
  let prev = 'src';
  for (const op of ops) {
    const inputs: Record<string, unknown> = { pixels: { n: prev, o: 'pixels' } };
    for (const [k, v] of Object.entries(op.inputs ?? {})) {
      const r = v as { nodeId?: string; output?: string; type?: string; value?: unknown };
      if (r && typeof r === 'object' && 'nodeId' in r) inputs[k] = { n: r.nodeId, o: r.output ?? 'out' };
      else if (r && typeof r === 'object' && r.type === 'number') inputs[k] = { v: r.value };
      else if (r && typeof r === 'object' && r.type === 'string') inputs[k] = { s: r.value };
    }
    nodes.push({ id: op.id, type: op.type, params: op.params ?? {}, inputs });
    prev = op.id;
  }
  return rt.evalPixelChain(nodes as never, prev, { pixels: grid, frame, frameRate } as never);
}

function parity(name: string, ops: Array<{ id: string; type: string; params?: Record<string, unknown>; inputs?: Record<string, unknown> }>) {
  for (const frame of [0, 37]) {
    const grid = fixtureGrid();
    const a = editorChain(ops, grid, frame, 12);
    const b = twinChain(ops, grid, frame, 12);
    check(`P ${name} f${frame}`, gridsEqual(a, b),
      a === null || b === null ? `editor=${a === null ? 'null' : 'grid'} twin=${b === null ? 'null' : 'grid'}` : 'grid diff');
  }
}

// ---------- P 组：21 算子 ----------
parity('color_replace 默认替换', [{ id: 'op', type: 'color_replace', params: { sourceColor: '#cc3333', targetColor: '#ff00ff', tolerance: 10 } }]);
parity('color_replace 容差大', [{ id: 'op', type: 'color_replace', params: { sourceColor: '#3366cc', targetColor: '#000000', tolerance: 200 } }]);
parity('outline 实线', [{ id: 'op', type: 'outline', params: { thickness: 1, color: '#101010' } }]);
parity('outline 粗边渐变', [{ id: 'op', type: 'outline', params: { thickness: 2, color: '#202020', outlineMode: 'gradient', lightAngle: 90 } }]);
parity('outline 内嵌', [{ id: 'op', type: 'outline', params: { thickness: 1, color: '#ff0000', edgesOnly: false, outlineMode: 'darken', directions: '4' } }]);
parity('cleanup 默认', [{ id: 'op', type: 'cleanup', params: {} }]);
parity('cleanup minSize3', [{ id: 'op', type: 'cleanup', params: { minSize: 3 } }]);
parity('dither 默认', [{ id: 'op', type: 'dither', params: {} }]);
parity('dither bayer8', [{ id: 'op', type: 'dither', params: { pattern: 'bayer8' } }]);
parity('pixel_displace 默认', [{ id: 'op', type: 'pixel_displace', params: {} }]);
parity('pixel_displace 强', [{ id: 'op', type: 'pixel_displace', params: { intensity: 3, frequency: 0.3 } }]);
parity('mirror', [{ id: 'op', type: 'mirror', params: {} }]);
parity('flip', [{ id: 'op', type: 'flip', params: {} }]);
parity('cylinder_rotate 60', [{ id: 'op', type: 'cylinder_rotate', params: { angle: 60 } }]);
parity('cylinder_rotate 平滑延伸', [{ id: 'op', type: 'cylinder_rotate', params: { angle: 130, smooth: true, backFill: 'extend', radiusShrinkRatio: 0.8 } }]);
parity('cylinder_rotate 斜投影', [{ id: 'op', type: 'cylinder_rotate', params: { angle: 45, projection: 'oblique', backFill: 'cyclic' } }]);
parity('sphere_rotate 分段', [{ id: 'op', type: 'sphere_rotate', params: { angle: 70 } }]);
parity('sphere_rotate 墨卡托', [{ id: 'op', type: 'sphere_rotate', params: { angle: 120, mode: 'mercator', backFill: 'extend' } }]);
parity('sphere_rotate 无填充', [{ id: 'op', type: 'sphere_rotate', params: { angle: 200, mode: 'mercator', backFill: 'none', centerX: 2, centerY: -1 } }]);
parity('bend 弧', [{ id: 'op', type: 'bend', params: { curvature: 0.5 } }]);
parity('bend S 竖', [{ id: 'op', type: 'bend', params: { curvature: 0.4, bendMode: 's_curve', direction: 'vertical', phaseSpeed: 2, smoothSampling: true } }]);
parity('bend 鱼尾无补洞', [{ id: 'op', type: 'bend', params: { curvature: 0.6, bendMode: 'fishtail', holeFill: 'none' } }]);
parity('elliptical 默认', [{ id: 'op', type: 'elliptical_compress', params: {} }]);
parity('elliptical 保面积各向异性', [{ id: 'op', type: 'elliptical_compress', params: { compressRatio: 0.5, preserveArea: true, anisotropy: 0.6, compressAxis: 'both' } }]);
parity('dumbbell 默认', [{ id: 'op', type: 'dumbbell_stretch', params: {} }]);
parity('dumbbell 竖相位', [{ id: 'op', type: 'dumbbell_stretch', params: { direction: 'vertical', phaseSpeed: 3, neckRatio: 0.3, endRatio: 1.5 } }]);
parity('pillow 默认', [{ id: 'op', type: 'pillow_stretch', params: {} }]);
parity('pillow 线性负', [{ id: 'op', type: 'pillow_stretch', params: { bulgeAmount: -0.5, falloffCurve: 'linear', radiusX: 80, radiusY: 60 } }]);
parity('hyperbolic 默认', [{ id: 'op', type: 'hyperbolic_stretch', params: {} }]);
parity('hyperbolic 横向不对称', [{ id: 'op', type: 'hyperbolic_stretch', params: { direction: 'horizontal', intensity: 0.9, asymmetry: 0.5, phaseSpeed: 1 } }]);
parity('ring_ripple 默认', [{ id: 'op', type: 'ring_ripple', params: {} }]);
parity('ring_ripple 螺旋平滑', [{ id: 'op', type: 'ring_ripple', params: { rippleMode: 'spiral', amplitude: 4, frequency: 0.3, smoothSampling: true } }]);
parity('local_inflate 默认', [{ id: 'op', type: 'local_inflate', params: {} }]);
parity('local_inflate 指定中心', [{ id: 'op', type: 'local_inflate', params: { centerX: 7, centerY: 6, radius: 6, strength: 3, falloff: 2 } }]);
parity('heat_flame 默认', [{ id: 'op', type: 'heat_flame', params: {} }]);
parity('crystal_cage 默认', [{ id: 'op', type: 'crystal_cage', params: {} }]);
parity('void_vortex 默认', [{ id: 'op', type: 'void_vortex', params: {} }]);
parity('ground_wave 默认', [{ id: 'op', type: 'ground_wave', params: {} }]);
parity('sword_ring 默认', [{ id: 'op', type: 'sword_ring', params: {} }]);

// ---------- Q 组：链语义 ----------
{
  // Q1 gate=0 直通
  const ops = [{ id: 'g', type: 'const', params: { value: 0 } },
    { id: 'op', type: 'outline', params: { thickness: 2, color: '#000000' }, inputs: { gate: { nodeId: 'g', output: 'out' } } }];
  const grid = fixtureGrid();
  const a = editorChain(ops.slice(1).map((o) => ({ ...o, inputs: { gate: { nodeId: 'g', output: 'out' } } })), grid, 0, 12);
  // 编辑器路需要 const 节点在图中：重走完整 ops
  const aFull = (() => {
    const nodes: any[] = [{ id: 'src', type: 'sprite_source', inputs: {}, params: {} },
      { id: 'g', type: 'const', inputs: {}, params: { value: 0 } },
      { id: 'op', type: 'outline', params: { thickness: 2, color: '#000000' }, inputs: { pixels: { nodeId: 'src', output: 'pixels' }, gate: { nodeId: 'g', output: 'out' } } },
      { id: 'scr', type: 'screen', inputs: { pixels: { nodeId: 'op', output: 'pixels' } }, params: {} }];
    let captured: (string | null)[][] | undefined;
    evaluateBlueprint({ version: 1, nodes, edges: [], outputId: 'scr' } as never,
      { frame: 0, frameRate: 12, vars: {}, spritePixels: grid, drawToScreen: (c: any) => { captured = c.pixels; } } as never);
    return captured ?? null;
  })();
  const rt = createPixelRuntime();
  const b = rt.evalPixelChain([
    { id: 'src', type: 'sprite_source' },
    { id: 'g', type: 'const', params: { value: 0 } },
    { id: 'op', type: 'outline', params: { thickness: 2, color: '#000000' }, inputs: { pixels: { n: 'src', o: 'pixels' }, gate: { n: 'g', o: 'out' } } },
  ] as never, 'op', { pixels: grid, frame: 0, frameRate: 12 } as never);
  check('Q1 gate=0 像素直通', gridsEqual(aFull, b) && gridsEqual(b, grid), `eq=${gridsEqual(aFull, b)} passthrough=${gridsEqual(b, grid)}`);
  void a;
}
{
  // Q2 禁用节点：编辑器口径 = 像素节点直通（与 gate 同），两边输出原图
  const grid = fixtureGrid();
  const a = editorChain([{ id: 'op', type: 'outline', params: { thickness: 1, color: '#000000', enabled: false } }], grid, 0, 12);
  const b = twinChain([{ id: 'op', type: 'outline', params: { thickness: 1, color: '#000000', enabled: false } }], grid, 0, 12);
  check('Q2 禁用像素节点直通', gridsEqual(a, b) && gridsEqual(b, grid), `eq=${gridsEqual(a, b)} passthrough=${gridsEqual(b, grid)}`);
}
{
  // Q3 两节链：outline → color_replace
  parity('Q3 两节链', [
    { id: 'o1', type: 'outline', params: { thickness: 1, color: '#123123' } },
    { id: 'o2', type: 'color_replace', params: { sourceColor: '#123123', targetColor: '#fedcba', tolerance: 5 } },
  ]);
}
{
  // Q4 数值接线：waveform 驱动 ring_ripple 的 amplitude
  const mk = (twin: boolean) => {
    if (!twin) {
      const nodes: any[] = [
        { id: 'src', type: 'sprite_source', inputs: {}, params: {} },
        { id: 'tm', type: 'time', inputs: {}, params: {} },
        { id: 'wv', type: 'waveform', inputs: { t: { nodeId: 'tm', output: 'out' } }, params: { waveform: 'sine', amplitude: 2, baseValue: 3, period: 0.5 } },
        { id: 'op', type: 'ring_ripple', params: {}, inputs: { pixels: { nodeId: 'src', output: 'pixels' }, amplitude: { nodeId: 'wv', output: 'out' } } },
        { id: 'scr', type: 'screen', inputs: { pixels: { nodeId: 'op', output: 'pixels' } }, params: {} },
      ];
      let captured: (string | null)[][] | undefined;
      evaluateBlueprint({ version: 1, nodes, edges: [], outputId: 'scr' } as never,
        { frame: 5, frameRate: 12, vars: {}, spritePixels: fixtureGrid(), drawToScreen: (c: any) => { captured = c.pixels; } } as never);
      return captured ?? null;
    }
    const rt = createPixelRuntime();
    return rt.evalPixelChain([
      { id: 'src', type: 'sprite_source' },
      { id: 'tm', type: 'time' },
      { id: 'wv', type: 'waveform', params: { waveform: 'sine', amplitude: 2, baseValue: 3, period: 0.5 }, inputs: { t: { n: 'tm', o: 'out' } } },
      { id: 'op', type: 'ring_ripple', params: {}, inputs: { pixels: { n: 'src', o: 'pixels' }, amplitude: { n: 'wv', o: 'out' } } },
    ] as never, 'op', { pixels: fixtureGrid(), frame: 5, frameRate: 12 } as never);
  };
  check('Q4 waveform 接线驱动 amplitude', gridsEqual(mk(false), mk(true)));
}
{
  // Q5 空源（无精灵）：编辑器 screen 以空网格上屏，两边都是 []
  const a = editorChain([{ id: 'op', type: 'mirror', params: {} }], null as never, 0, 12);
  const rt = createPixelRuntime();
  const b = rt.evalPixelChain([{ id: 'src', type: 'sprite_source' }, { id: 'op', type: 'mirror', inputs: { pixels: { n: 'src', o: 'pixels' } } }] as never, 'op', { frame: 0, frameRate: 12 } as never);
  check('Q5 无源断链空网格上屏', Array.isArray(a) && a.length === 0 && Array.isArray(b) && b.length === 0,
    `editor=${JSON.stringify(a)?.length} twin=${JSON.stringify(b)?.length}`);
}

// ---------- C 组：convert 提取 ----------
function chainBlueprint(extraNodes: any[] = [], opType = 'outline'): any {
  return {
    version: 1,
    nodes: [
      { id: 'src', type: 'sprite_source', inputs: {}, params: {} },
      ...extraNodes,
      { id: 'op', type: opType, inputs: { pixels: { nodeId: 'src', output: 'pixels' } }, params: { thickness: 1, color: '#0a0a0a' } },
      { id: 'scr', type: 'screen', inputs: { pixels: { nodeId: 'op', output: 'pixels' } }, params: {} },
    ],
    edges: [], outputId: 'scr',
  };
}
function spriteChar(blueprint: any): any {
  const grid = [
    ['#cc3333', '#3366cc', null, '#33aa55'],
    ['#3366cc', null, '#33aa55', '#cc3333'],
    [null, '#33aa55', '#cc3333', '#3366cc'],
  ];
  const spr = {
    id: 'gspr', width: 4, height: 3,
    plug: { x: 0, y: 0 },
    data: grid,
    directions: { 2: { spriteId: 'gspr', mirror: false } },
  };
  const node = {
    id: 'gem', name: '宝石', role: 'bone',
    slot: { slotKey: 'gem' },
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [], children: [],
    blueprint,
  };
  return {
    id: 'chPx', name: '像素链测试',
    nodes: { gem: node },
    rootNodeIds: ['gem'],
    sprites: { gspr: spr },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } } }],
    activeCostumeSetId: 'set1',
    variants: {},
  };
}
{
  const pkg = convertCharacterToRuntimePackage(spriteChar(chainBlueprint()));
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('C1 精灵部件像素链进包', !!gem?.pixelGraph && gem.pixelGraph.out === 'op'
    && gem.pixelGraph.nodes.some((n) => n.type === 'outline')
    && gem.pixelGraph.nodes.some((n) => n.type === 'sprite_source'),
    JSON.stringify(gem?.pixelGraph ?? null).slice(0, 120));
  check('C2 已进包的像素蓝图不再报「未进包」', !pkg.warnings.some((w) => w.includes('无 transform 输出') && w.includes('宝石')),
    pkg.warnings.filter((w) => w.includes('宝石')).join(' | '));
  // C3 包内链直接跑 = 编辑器同图同网格
  if (gem?.pixelGraph && gem.sprite) {
    const rt = createPixelRuntime();
    const viaPkg = rt.evalPixelChain(gem.pixelGraph.nodes as never, gem.pixelGraph.out,
      { pixels: gem.sprite.data, frame: 3, frameRate: 12 } as never);
    const viaEditor = editorChain([{ id: 'op', type: 'outline', params: { thickness: 1, color: '#0a0a0a' } }],
      gem.sprite.data as (string | null)[][], 3, 12);
    check('C3 包内链与编辑器逐格一致', gridsEqual(viaPkg, viaEditor));
  } else {
    check('C3 包内链与编辑器逐格一致', false, 'pixelGraph/sprite 缺失');
  }
}
{
  const bp = chainBlueprint([{ id: 'cst', type: 'costume', inputs: {}, params: {} }]);
  // costume 接进 pixels 路径：op 的输入改走 costume 的输出再回接
  bp.nodes.find((n: any) => n.id === 'op').inputs = { pixels: { nodeId: 'cst', output: 'pixels' } };
  bp.nodes.find((n: any) => n.id === 'cst').inputs = { pixels: { nodeId: 'src', output: 'pixels' } };
  const pkg = convertCharacterToRuntimePackage(spriteChar(bp));
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('C4 costume 链点名不进包', !gem?.pixelGraph
    && pkg.warnings.some((w) => w.includes('costume') && w.includes('未进包')),
    pkg.warnings.join(' | ').slice(0, 200));
}
{
  const pkg = convertCharacterToRuntimePackage(spriteChar(chainBlueprint([], 'texture_scroll')));
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('C5 范围外算子点名不进包', !gem?.pixelGraph
    && pkg.warnings.some((w) => w.includes('texture_scroll')),
    pkg.warnings.join(' | ').slice(0, 200));
}
{
  // 参数化部件带像素链蓝图：点名不进
  const ch = spriteChar(chainBlueprint());
  ch.costumeSets[0].pieces.gem = { nodeId: 'gem', zIndex: 0, parametric: createDefaultParametricAppearance() } as never;
  const pkg = convertCharacterToRuntimePackage(ch);
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('C6 参数化部件像素链点名不进', !!gem && !gem.pixelGraph
    && pkg.warnings.some((w) => w.includes('参数化部件 v1 不带像素链')),
    pkg.warnings.join(' | ').slice(0, 240));
}

// ---------- T 组：模板接线 ----------
{
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const pkg = convertCharacterToRuntimePackage(spriteChar(chainBlueprint()));
  const html = buildRuntimeHtml(pkg);
  check('T1 模板注入 PIXEL_SRC（evalPixelChain 在位）', html.includes('function evalPixelChain'));
  check('T2 模板含像素作业收集与执行', html.includes('pixelJobs.push') && html.includes('像素链执行'));
  check('T3 包 JSON 带 pixelGraph', html.includes('"pixelGraph"'));
  const pkg2 = convertCharacterToRuntimePackage(spriteChar(null));
  const html2 = buildRuntimeHtml(pkg2);
  check('T4 无链角色模板仍可构建', html2.includes('function evalPixelChain') && !html2.includes('"pixelGraph"'));
}

console.log(`verify-pixel-chain: ${pass} passed, ${fail} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
