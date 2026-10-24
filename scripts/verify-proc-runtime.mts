// 程序化运行时接线校验（纯逻辑，无 DOM/WebGL）：
// A) 参数化外观 preset 形状（compileTile mask 约定：255 外 / R 档位）
// B) 表演图采样翻译（度→弧度取负、dy 取负、含不支持节点仍可翻译）
// C) 行为图结构翻译（节点 1:1 进包、gait 点名不支持、通道丢弃点名）
// D) 运行时求值器语义（与主系统 eval 对齐：pendulum/var/hold/nodeRef/曲线）
// E) 转换器：参数化 piece 进包、行为图按 slotKey 进包、表演烘焙、warnings 点名
import assert from 'node:assert/strict';
import type { Character, UnifiedNode } from '../src/lib/unified-types';
import type { BlueprintGraph } from '../src/lib/blueprint/ir';
import { SURFACE_PRESETS } from '../src/lib/proc-runtime/surfaces';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { translatePerformanceGraph, translateBehaviorGraph } from '../src/lib/proc-runtime/graph-translate';
import { dialectOf } from '../src/lib/proc-runtime/dialect';
import { createRuntimeEvaluator } from '../src/lib/proc-runtime/eval-src';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultCostumePiece } from '../src/lib/unified-types';
import { createSurfaceBaker } from '../src/lib/proc-runtime/bake-src';
import { PATTERN_TEMPLATES, instantiatePattern } from '../src/lib/proc-runtime/pattern-templates';
import type { SurfaceGraph } from '../src/lib/unified-types';

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log('✓', name);
}

// ---------- A) preset 形状约定 ----------
{
  const layers = SURFACE_PRESETS['纵向渐变']();
  const first = layers[0];
  check('A1 预设首层是 inside 全覆盖（slot=最暗档 1）', 'mask' in first && first.mask.m === 'inside' && first.slot === 1);
  const hasEdge = layers.some((l) => 'mask' in l && l.mask.m === 'edge');
  check('A2 预设不含 edge 层（甲：描边归 OUTLINE 枚举，层程序只管面内）', !hasEdge);
  const bumpLayers = SURFACE_PRESETS['穹光（bump）']();
  check('A3 穹光预设含 bumpForm 层（连续公式烘焙为档位）', bumpLayers.some((l) => 'bumpForm' in l && l.bumpForm === 'dome'));
  const appearance = createDefaultParametricAppearance();
  check('A4 默认外观带四枚举字段', 'light' in appearance && 'outline' in appearance && 'rim' in appearance && 'glint' in appearance);
}

// ---------- B) 表演图采样翻译 ----------
const spinGraph: BlueprintGraph = {
  version: 1,
  outputId: 'out',
  nodes: [
    { id: 't', type: 'time', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
    {
      id: 'kf', type: 'keyframes',
      inputs: { t: { nodeId: 't', output: 'out' } },
      params: { frames: '[0,1]', values: '[0,60]', interpolation: 'linear' },
      ui: { x: 0, y: 0 },
    },
    { id: 'pm', type: 'pixelate', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
    {
      id: 'out', type: 'transform',
      inputs: { rotation: { nodeId: 'kf', output: 'out' } },
      params: {}, ui: { x: 0, y: 0 },
    },
  ],
};
{
  const res = translatePerformanceGraph(spinGraph, 'torso', 1, 'p_');
  check('B1 含不支持节点（pixelate）时表演图仍可采样翻译', res.ok);
  check('B2 方言报告 pixelate=unsupported、keyframes=direct', res.typeReport.pixelate === 'unsupported' && res.typeReport.keyframes === 'direct');
  const curve = res.nodes.find((n) => n.type === 'curve');
  check('B3 采样产出曲线节点', !!curve && curve.type === 'curve');
  if (curve && curve.type === 'curve') {
    const end = curve.points[curve.points.length - 1];
    check('B4 曲线末值 = -60 度 → -π/3 弧度', Math.abs(end[1] - (-Math.PI / 3)) < 0.02);
  }
  const tr = res.nodes.find((n) => n.type === 'transform');
  check('B5 transform.units=runtime（采样路已换算）', !!tr && tr.type === 'transform' && tr.units === 'runtime');
}

// ---------- C) 行为图结构翻译 ----------
const gaitBehaviorGraph: BlueprintGraph = {
  version: 1,
  outputId: 'out',
  nodes: [
    { id: 'ph', type: 'var', inputs: {}, params: { name: 'phase', default: 0 }, ui: { x: 0, y: 0 } },
    {
      id: 'pend', type: 'pendulum',
      inputs: { t: { nodeId: 'ph', output: 'out' } },
      params: { amplitude: 30, period: 1 },
      ui: { x: 0, y: 0 },
    },
    { id: 'g', type: 'gait', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
    {
      id: 'out', type: 'transform',
      inputs: {
        rotation: { nodeId: 'pend', output: 'outRotation' },
        translateZ: { nodeId: 'pend', output: 'out' },
      },
      params: {}, ui: { x: 0, y: 0 },
    },
  ],
};
{
  check('C1 方言按语境分：pendulum 在行为=direct、在表演=sample', dialectOf('pendulum', 'behavior') === 'direct' && dialectOf('pendulum', 'performance') === 'sample');
  check('C2 方言：gait 行为=unsupported、nodeRef 行为=direct', dialectOf('gait', 'behavior') === 'unsupported' && dialectOf('nodeRef', 'behavior') === 'direct');
  const res = translateBehaviorGraph(gaitBehaviorGraph, 'legL', 'b_', (id) => id);
  check('C3 行为图结构翻译成功（有 transform 输出）', res.ok);
  const pend = res.nodes.find((n) => n.id === 'b_pend');
  check('C4 pendulum 节点 1:1 进包且连边已加前缀', !!pend && pend.type === 'pendulum'
    && (pend as { inputs?: Record<string, { n: string }> }).inputs?.t?.n === 'b_ph');
  check('C5 gait 节点点名不支持', res.warnings.some((w) => w.includes('gait') && w.includes('不支持')));
  check('C6 translateZ 通道点名丢弃', res.warnings.some((w) => w.includes('translateZ')));
  const tr = res.nodes.find((n) => n.type === 'transform');
  check('C7 transform.units=main 且 angleFrom 指 pendulum.outRotation',
    !!tr && tr.type === 'transform' && tr.units === 'main' && tr.angleFrom?.n === 'b_pend' && tr.angleFrom?.o === 'outRotation');
}

// ---------- D) 运行时求值器语义 ----------
{
  const evaluate = createRuntimeEvaluator();
  const res = translateBehaviorGraph(gaitBehaviorGraph, 'legL', 'b_', (id) => id);
  const graph = { context: 'behavior' as const, nodes: res.nodes };
  // phase=0.25 圈、period=1 圈 → pendulum 相位 π/2 → 30°；units=main → angle=-30°=-π/6
  const out1 = evaluate(graph, { tSec: 0, vars: { phase: 0.25 } });
  check('D1 行为图求值：phase 驱动 pendulum，角度换算 -π/6', Math.abs((out1.get('legL')?.angle ?? 0) - (-Math.PI / 6)) < 1e-9);
  const out2 = evaluate(graph, { tSec: 0, vars: { phase: 0.75 } });
  check('D2 phase=0.75 圈 → +π/6（反相）', Math.abs((out2.get('legL')?.angle ?? 0) - (Math.PI / 6)) < 1e-9);

  // hold：trigger 上升沿冻结
  const holdGraph = {
    context: 'behavior' as const,
    nodes: [
      { id: 'v', type: 'var', params: { name: 'x' }, inputs: {} },
      { id: 'trig', type: 'var', params: { name: 'go' }, inputs: {} },
      { id: 'h', type: 'hold', params: {}, inputs: { input: { n: 'v' }, trigger: { n: 'trig' } } },
      { id: 'tr', type: 'transform', part: 'p', units: 'main' as const, dxFrom: { n: 'h' } },
    ],
  };
  const state = new Map();
  const r1 = evaluate(holdGraph, { vars: { x: 5, go: 0 }, nodeState: state });
  const r2 = evaluate(holdGraph, { vars: { x: 9, go: 1 }, nodeState: state });
  const r3 = evaluate(holdGraph, { vars: { x: 99, go: 0 }, nodeState: state });
  check('D3 hold 未触发直通 / 触发冻结 / 触发后保持',
    r1.get('p')?.dx === 5 && r2.get('p')?.dx === 9 && r3.get('p')?.dx === 9);

  // nodeRef：读 nodeOutputs（主系统单位直通，进 transform 才换算）
  const refGraph = {
    context: 'behavior' as const,
    nodes: [
      { id: 'nr', type: 'nodeRef', params: { nodeId: 'head', output: 'rotation' }, inputs: {} },
      { id: 'tr', type: 'transform', part: 'hat', units: 'main' as const, angleFrom: { n: 'nr' } },
    ],
  };
  const nodeOutputs = new Map([['head', { rotation: 20, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }]]);
  const r4 = evaluate(refGraph, { nodeOutputs });
  check('D4 nodeRef 读上一遍输出 20° → -π/9', Math.abs((r4.get('hat')?.angle ?? 0) - (-20 * Math.PI / 180)) < 1e-9);

  // 表演曲线图（采样产物）在同一求值器上
  const perfRes = translatePerformanceGraph(spinGraph, 'torso', 1, 'p_');
  const perfOut = evaluate({ context: 'performance', nodes: perfRes.nodes }, { u: 1 });
  check('D5 表演图 u=1 → angle=-π/3（与采样口径一致）', Math.abs((perfOut.get('torso')?.angle ?? 0) - (-Math.PI / 3)) < 0.02);

  // keyframes 边界钳制（主系统语义）
  const kfGraph = {
    context: 'behavior' as const,
    nodes: [
      { id: 'k', type: 'keyframes', params: { frames: '[0,0.5]', values: '[3,7]', interpolation: 'linear' }, inputs: {} },
      { id: 'tr', type: 'transform', part: 'p', units: 'runtime' as const, dxFrom: { n: 'k' } },
    ],
  };
  check('D6 keyframes t=0 取首值 3（time 缺省）',
    evaluate(kfGraph, { tSec: 0 }).get('p')?.dx === 3);
}

// ---------- E) 转换器 ----------
function makeNode(id: string, name: string, slotKey: string | null, parentId?: string): UnifiedNode {
  return {
    id, name, parentId,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0, variantIndex: 2, stretch: 1 },
    attachment: { type: 'fixed' },
    sockets: [],
    tracks: {},
    modifiers: [],
    children: [],
    sprite: undefined as never,
  } as unknown as UnifiedNode;
}
{
  const ch = {
    id: 'ch1', name: '测试骑士',
    nodes: {
      torso: makeNode('torso', '躯干', 'torso'),
      hat: makeNode('hat', '帽子', null, 'torso'),
      arm: makeNode('arm', '手臂', null, 'torso'),
    },
    rootNodeId: 'torso',
    rootNodeIds: ['torso'],
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: {
        torso: { nodeId: 'torso', zIndex: 0, parametric: createDefaultParametricAppearance() },
        arm: { ...createDefaultCostumePiece('arm'), parametric: createDefaultParametricAppearance() },
      },
    }],
    activeCostumeSetId: 'set1',
    variants: { '0': '东', '2': '西' },
    behaviorGraphs: { torso: gaitBehaviorGraph, hat: gaitBehaviorGraph, arm: gaitBehaviorGraph },
    performances: [{
      id: 'perf1', name: '斩击', trigger: 'attack', duration: 1, enabled: true,
      mode: 'override', envelopeIn: 0.1, envelopeOut: 0.2,
      maskNodeIds: ['torso'], graphs: { torso: spinGraph },
    }],
  } as unknown as Character;

  const pkg = convertCharacterToRuntimePackage(ch);
  check('E1 包格式标识', pkg.format === 'procedural-pixel-runtime-1');
  check('E2 参数化部件进包', pkg.parts.some((p) => p.key === 'torso' && p.base.shapeKind === 'rect'));
  const graphs = pkg.behavior.graphs;
  check('E3 行为图按 slotKey 进包', !!graphs.torso && graphs.torso.context === 'behavior');
  check('E4 行为图含结构翻译的 pendulum 节点', graphs.torso.nodes.some((n) => n.type === 'pendulum'));
  check('E5 表演进包且触发键映射 KeyJ', pkg.performances.length === 1 && (pkg.performances[0] as { triggerKey?: string }).triggerKey === 'KeyJ');
  const perfNodes = pkg.performances[0].graph.nodes;
  check('E6 表演图 context=performance 且含曲线', pkg.performances[0].graph.context === 'performance' && perfNodes.some((n) => n.type === 'curve'));
  check('E7 无 slot 节点（帽子）的行为图以 nodeId 为键进包（产品回退口径）', 'hat' in graphs);
  check('E10 无 slot 节点（手臂）的参数化件以 nodeId 为键进包', pkg.parts.some((p) => p.key === 'arm'));
  check('E11 无 slot 节点（手臂）的行为图进包', 'arm' in graphs);
  check('E12 无「有参数化外观但无对应节点」误报', !pkg.warnings.some((w) => w.includes('无对应节点')));
  check('E8 变体：部件带西向(2)空覆盖（走统一镜像）', pkg.parts.some((p) => p.key === 'torso' && p.variants && 2 in p.variants));

  const empty = convertCharacterToRuntimePackage({
    id: 'e', name: '空', nodes: {}, rootNodeIds: [], costumeSets: [], variants: {},
  } as unknown as Character);
  check('E9 空角色行为图为空对象（不报错）', Object.keys(empty.behavior.graphs).length === 0);
}

// ---------- F) 表面 DAG 烘焙语义 ----------
{
  const baker = createSurfaceBaker();
  const shape = { kind: 'rect', size: [36, 28] as [number, number], roundness: 0.1 };
  const tiersOf = (data: Uint8Array) => {
    const s = new Set<number>();
    for (let i = 0; i < data.length; i += 4) s.add(data[i]);
    return s;
  };
  const scales = PATTERN_TEMPLATES.find((t) => t.id === 'scales')!;
  const g1 = instantiatePattern(scales);
  const t1 = baker.compileTileDAG(shape, g1);
  const tiers1 = tiersOf(t1.data);
  check('F1 鳞片烘焙多档位（含鳞体 3 与亮边 5）', tiers1.has(3) && tiers1.has(5) && tiers1.has(2));
  const t1b = baker.compileTileDAG(shape, instantiatePattern(scales));
  check('F2 同图重复烘焙逐字节确定', Buffer.from(t1.data).equals(Buffer.from(t1b.data)));
  const g2 = instantiatePattern(scales);
  g2.params!.cw = 16;
  const t2 = baker.compileTileDAG(shape, g2);
  check('F3 模板参数生效（鳞宽 10→16 图案变化）', !Buffer.from(t1.data).equals(Buffer.from(t2.data)));
  const wood = PATTERN_TEMPLATES.find((t) => t.id === 'wood')!;
  const gw = instantiatePattern(wood);
  const tw = baker.compileTileDAG(shape, gw);
  const gw0 = instantiatePattern(wood);
  gw0.params!.warp = 0;
  const tw0 = baker.compileTileDAG(shape, gw0);
  check('F4 warp 坐标扭曲生效（木纹 warp=3 与 warp=0 不同）', !Buffer.from(tw.data).equals(Buffer.from(tw0.data)));
  check('F5 木纹含纹线档 2 与结眼档 1 或纹线', tiersOf(tw.data).has(2));
}

// ---------- G) 模板库全量校验 ----------
{
  const baker = createSurfaceBaker();
  const shape = { kind: 'rect', size: [40, 32] as [number, number], roundness: 0.15 };
  check('G1 模板数量 ≥ 22', PATTERN_TEMPLATES.length >= 22);
  for (const t of PATTERN_TEMPLATES) {
    const g = instantiatePattern(t);
    const ids = new Set(g.nodes.map((x) => x.id));
    const refsOk = g.nodes.every((x) => Object.values(x.inputs ?? {}).every((r) => ids.has(r)))
      && g.writes.every((x) => ids.has(x.from));
    const paramKeys = new Set(t.params.map((p) => p.key));
    const dollarOk = JSON.stringify(g.nodes).match(/"\$[a-zA-Z]+"/g)?.every((s) => paramKeys.has(s.slice(2, -1))) ?? true;
    check(`G2 模板 ${t.name}：引用完整 + $参数有定义`, refsOk && dollarOk);
    const tile = baker.compileTileDAG(shape, g);
    const tiers = new Set<number>();
    let rangeOk = true;
    for (let i = 0; i < tile.data.length; i += 4) {
      const v = tile.data[i];
      if (!((v >= 0 && v <= 7) || v === 254 || v === 255)) rangeOk = false;
      if (v <= 7) tiers.add(v);
    }
    check(`G3 模板 ${t.name}：烘焙非退化（≥2 内部档位、值域合法）`, rangeOk && tiers.size >= 2);
  }
  // 转换器透传 surfaceGraph
  const appWithGraph = { ...createDefaultParametricAppearance(), surfaceGraph: instantiatePattern(PATTERN_TEMPLATES.find((t) => t.id === 'scales')!) };
  const ch2 = {
    id: 'ch2', name: '图角色',
    nodes: { torso: makeNode('torso', '躯干', 'torso') },
    rootNodeIds: ['torso'],
    costumeSets: [{ id: 's', name: '默认', pieces: { torso: { ...createDefaultCostumePiece('torso'), parametric: appWithGraph } } }],
    activeCostumeSetId: 's', variants: {},
  } as unknown as Character;
  const pkg2 = convertCharacterToRuntimePackage(ch2);
  check('G4 转换器把 surfaceGraph 透传进包', !!(pkg2.parts[0]?.base as { surfaceGraph?: SurfaceGraph }).surfaceGraph);
}

// ---------- H) 十五属性算子语义 ----------
{
  const baker = createSurfaceBaker();
  const shape = { kind: 'rect', size: [36, 28] as [number, number], roundness: 0.1 };
  // mirror 局部对称：镜像折叠后的瓦片左右对称
  const mirrorGraph: SurfaceGraph = {
    version: 1, nodes: [
      { id: 'in', op: 'inside' },
      { id: 'st', op: 'stripes', params: { axis: 'x', f: 5, duty: 0.45 } },
      { id: 'nz', op: 'noise', params: { f: 0.3, seed: 3 } },
      { id: 'mixv', op: 'mul', inputs: { a: 'st', b: 'nz' } },
      { id: 'mir', op: 'mirror', inputs: { in: 'mixv' }, params: { axis: 'x', at: 0 } },
      { id: 'gate', op: 'threshold', inputs: { in: 'mir' }, params: { at: 0.2 } },
    ],
    writes: [{ from: 'in', slot: 2, at: 0.5 }, { from: 'gate', slot: 4, at: 0.5 }],
  };
  const tm = baker.compileTileDAG(shape, mirrorGraph);
  let symmetric = true;
  for (let j = 0; j < tm.h && symmetric; j++) {
    for (let i = 2; i < tm.cx; i++) {
      const a = tm.data[(j * tm.w + i) * 4];
      const b = tm.data[(j * tm.w + (2 * tm.cx - i)) * 4];
      if (a !== b) { symmetric = false; break; }
    }
  }
  check('H1 mirror 局部对称：瓦片左右逐像素对称', symmetric);
  // weave 交锁与 stripes 不同且多档
  const woven = PATTERN_TEMPLATES.find((t) => t.id === 'woven')!;
  const tw = baker.compileTileDAG(shape, instantiatePattern(woven));
  const wTiers = new Set<number>();
  for (let i = 0; i < tw.data.length; i += 4) if (tw.data[i] <= 7) wTiers.add(tw.data[i]);
  check('H2 weave 编织模板多档位（交锁生效）', wTiers.has(3) && wTiers.has(4));
  // glint 通道：水面模板产生 0/255 并存的 G 通道
  const water = PATTERN_TEMPLATES.find((t) => t.id === 'water')!;
  const twt = baker.compileTileDAG(shape, instantiatePattern(water));
  let g0 = false, g255 = false;
  for (let i = 0; i < twt.data.length; i += 4) {
    if (twt.data[i + 1] === 0) g0 = true;
    if (twt.data[i + 1] === 255) g255 = true;
  }
  check('H3 水面 DAG glint 通道写出生效（G 有 0 有 255）', g0 && g255);
  // 藤蔓模板：茎叶档 + 亮边
  const vine = PATTERN_TEMPLATES.find((t) => t.id === 'vine')!;
  const tv = baker.compileTileDAG({ kind: 'rect', size: [28, 40], roundness: 0.1 }, instantiatePattern(vine));
  const vTiers = new Set<number>();
  for (let i = 0; i < tv.data.length; i += 4) if (tv.data[i] <= 7) vTiers.add(tv.data[i]);
  check('H4 藤蔓路径发生器烘焙出茎叶档 3', vTiers.has(3));
  // AB 交替：repeat 双程序奇偶行不同
  const abGraph: SurfaceGraph = {
    version: 1, nodes: [
      { id: 'in', op: 'inside' },
      { id: 'csA', op: 'cellShape', params: { kind: 'rect', gap: 0.5 } },
      { id: 'csB', op: 'cellShape', params: { kind: 'circle', gap: 0.5 } },
      { id: 'rep', op: 'repeat', inputs: { in: 'csA', b: 'csB' }, params: { cw: 10, ch: 8, seed: 1 } },
    ],
    writes: [{ from: 'in', slot: 1, at: 0.5 }, { from: 'rep', slot: 3, at: 0 }],
  };
  const aGraph: SurfaceGraph = {
    ...abGraph,
    nodes: abGraph.nodes.map((x) => x.id === 'rep' ? { ...x, inputs: { in: 'csA' } } : x),
  };
  const tab = baker.compileTileDAG(shape, abGraph);
  const ta = baker.compileTileDAG(shape, aGraph);
  check('H5 repeat AB 交替与单程序结果不同（B 程序在奇数行生效）', !Buffer.from(tab.data).equals(Buffer.from(ta.data)));
  // repeat 抖动生效
  const jitGraph: SurfaceGraph = {
    ...aGraph,
    nodes: aGraph.nodes.map((x) => x.id === 'rep' ? { ...x, params: { ...x.params, jit: 1.5 } } : x),
  };
  const tj = baker.compileTileDAG(shape, jitGraph);
  check('H6 repeat 单元抖动（粗糙度）改变图案', !Buffer.from(tj.data).equals(Buffer.from(ta.data)));
}

// ---------- H7) 编辑器规格表与求值器对齐 ----------
{
  const { SURFACE_OP_SPECS } = await import('../src/lib/proc-runtime/surface-ops');
  const { BAKE_SRC } = await import('../src/lib/proc-runtime/bake-src');
  const missing = SURFACE_OP_SPECS.filter((s) => !BAKE_SRC.includes(`case '${s.op}'`)).map((s) => s.op);
  check(`H7 规格表算子在求值器中全部存在（缺失：${missing.join(',') || '无'}）`, missing.length === 0);
  check('H7b 规格表算子数 ≥ 40', SURFACE_OP_SPECS.length >= 40);
}

// ---------- H8) v2 画布自动布局 ----------
{
  const { computeSurfaceLayout, surfaceScopeParentMap, SURFACE_NODE_W, SURFACE_NODE_H } = await import('../src/lib/proc-runtime/surface-ops');
  const g = instantiatePattern(PATTERN_TEMPLATES.find((t) => t.id === 'mech')!);
  const l1 = computeSurfaceLayout(g);
  const l2 = computeSurfaceLayout(g);
  check('H8a 布局确定性（两次结果一致）', JSON.stringify(l1) === JSON.stringify(l2));
  check('H8b 每个节点都有坐标', g.nodes.every((x) => !!l1.pos[x.id]));
  const parents = surfaceScopeParentMap(g);
  let contained = true;
  for (const [child, p] of parents) {
    const f = l1.frames[p];
    const cp = l1.pos[child];
    if (!f || !cp) { contained = false; break; }
    if (cp.x < f.x || cp.y < f.y || cp.x + SURFACE_NODE_W > f.x + f.w + 1 || cp.y + SURFACE_NODE_H > f.y + f.h + 1) { contained = false; break; }
  }
  check('H8c 作用域子图落在框内', contained && parents.size > 0);
}

// ---------- I) 注入作用域同名冲突守卫 ----------
{
  const { BAKE_SRC } = await import('../src/lib/proc-runtime/bake-src');
  const { readFileSync } = await import('node:fs');
  const tpl = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  const fnNames = (s: string) => new Set([...s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const bakeNames = fnNames(BAKE_SRC);
  const tplNames = fnNames(tpl);
  const overlap = [...bakeNames].filter((x) => tplNames.has(x));
  check(`I1 BAKE_SRC 与模板顶层函数无同名（冲突：${overlap.join(',') || '无'}）`, overlap.length === 0);
  const baker = createSurfaceBaker();
  const tri = baker.compileTileDAG(
    { kind: 'poly', size: [30, 26], points: [[-12, 10], [12, 10], [0, -11]], pivot: [0, 0] },
    instantiatePattern(PATTERN_TEMPLATES.find((t) => t.id === 'scales')!),
  );
  let inner = 0;
  for (let i = 0; i < tri.data.length; i += 4) if (tri.data[i] <= 7) inner++;
  check('I2 poly 形状 DAG 烘焙非退化（改名后 sdSegmentB/pointInPolygonB 正常）', inner > 80);
}

// ---------- J) 主画布参数化适配 ----------
{
  const { buildParametricSprite, PARAMETRIC_MIRROR_DIRECTIONS } = await import('../src/lib/proc-runtime/main-canvas');
  const { SURFACE_PRESETS, createDefaultParametricAppearance } = await import('../src/lib/proc-runtime/surfaces');
  const { PALETTES } = await import('../src/lib/proc-runtime/palettes');
  const { pxToSub } = await import('../src/lib/unified-types');
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const appJ = {
    ...createDefaultParametricAppearance(),
    palette: 'shirt',
    shape: { kind: 'rect' as const, size: [20, 14] as [number, number], roundness: 0 },
    surface: SURFACE_PRESETS['纵向渐变'](),
    surfaceName: '纵向渐变',
  };
  const spr = buildParametricSprite(appJ, 'torso');
  check('J1 层程序外观烘焙出 Sprite（尺寸 = 形状 + 4 边距）', !!spr && spr.width === 24 && spr.height === 18);
  check('J2 centerOffset=0 时 plug 在瓦片中心', !!spr && spr.plug?.x === pxToSub(12) && spr.plug?.y === pxToSub(9));
  const sprOff = buildParametricSprite({ ...appJ, centerOffset: [3, 0] }, 'torso');
  check('J3 centerOffset +3 → plug 左移 3px', !!sprOff && sprOff.plug?.x === pxToSub(9));
  const outlineHex = hex(PALETTES.shirt[0]);
  const colCenter = (g: NonNullable<typeof spr>) => {
    const col = g.data.map((r) => r[Math.floor(g.width / 2)]);
    const filled = col.filter((c) => c !== null);
    // 剥掉两端描边色（预设自带 outlineDark + OUTLINE 外环），取内侧渐变两端
    let a = 0, b = filled.length - 1;
    while (a < filled.length && filled[a] === outlineHex) a++;
    while (b >= 0 && filled[b] === outlineHex) b--;
    return { top: filled[a], bottom: filled[b] };
  };
  const cc = spr ? colCenter(spr) : { top: null, bottom: null };
  check('J4 渐变朝向：剥描边后产品空间顶 = 暗档 pal[1]、底 = 亮档 pal[3]（烘焙空间翻回）',
    cc.top === hex(PALETTES.shirt[1]) && cc.bottom === hex(PALETTES.shirt[3]));
  const spr2 = buildParametricSprite(appJ, 'torso');
  check('J5 缓存命中同一对象', spr === spr2);
  const appDag = { ...appJ, surfaceGraph: instantiatePattern(PATTERN_TEMPLATES.find((t) => t.id === 'scales')!) };
  const sprDag = buildParametricSprite(appDag, 'torso');
  const colors = new Set<string>();
  sprDag?.data.forEach((r) => r.forEach((c) => { if (c) colors.add(c); }));
  check('J6 DAG 外观烘焙出多色 Sprite（鳞片）', !!sprDag && colors.size >= 3);
  check('J7 镜像方向集 = 西半向 3/4/5', PARAMETRIC_MIRROR_DIRECTIONS.has(4) && PARAMETRIC_MIRROR_DIRECTIONS.has(3)
    && PARAMETRIC_MIRROR_DIRECTIONS.has(5) && !PARAMETRIC_MIRROR_DIRECTIONS.has(0) && !PARAMETRIC_MIRROR_DIRECTIONS.has(6));
}

// ---------- K) 甲：预设不焊暗边，描边归 OUTLINE 枚举 ----------
{
  const { SURFACE_PRESETS, SURFACE_PRESET_NAMES, createDefaultParametricAppearance } = await import('../src/lib/proc-runtime/surfaces');
  const { buildParametricSprite } = await import('../src/lib/proc-runtime/main-canvas');
  const { PALETTES } = await import('../src/lib/proc-runtime/palettes');
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const welded = SURFACE_PRESET_NAMES.filter((name) =>
    SURFACE_PRESETS[name]().some((l) => 'mask' in l && l.mask.m === 'edge' && l.slot === 0));
  check(`K1 全部层预设无焊死边缘压暗层（命中：${welded.join(',') || '无'}）`, welded.length === 0);
  const base = {
    ...createDefaultParametricAppearance(),
    palette: 'shirt',
    shape: { kind: 'rect' as const, size: [20, 14] as [number, number], roundness: 0 },
  };
  const countPal0 = (spr: { data: (string | null)[][] } | null) =>
    spr ? spr.data.flat().filter((c) => c === hex(PALETTES.shirt[0])).length : -1;
  const sprNone = buildParametricSprite({ ...base, outline: 0 }, 'k-none');
  const sprOuter = buildParametricSprite({ ...base, outline: 1 }, 'k-outer');
  check('K2 outline=NONE 时全图无 pal[0] 像素（真无框）', countPal0(sprNone) === 0);
  check('K3 outline=OUTER 时外环出现 pal[0] 像素（枚举管辖描边）', countPal0(sprOuter) > 10);
}

// ---------- L) 运行时跟进：三档合成/外延进包 + 动态双挂载进包 + DYNAMIC_SRC 对齐 ----------
{
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const { createDynamicRuntime, DYNAMIC_SRC } = await import('../src/lib/proc-runtime/dynamic-src');
  const { BAKE_SRC } = await import('../src/lib/proc-runtime/bake-src');
  const { RUNTIME_EVAL_SRC } = await import('../src/lib/proc-runtime/eval-src');
  const { createDynamicInstance, defaultDynamicParams, dynamicDeformAt, findDynamicTemplate } = await import('../src/lib/dynamic-patterns');
  const { pxToSub } = await import('../src/lib/unified-types');

  const grid5: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#3366aa'));
  const sprite5 = { width: 5, height: 5, data: grid5, plug: { x: pxToSub(1), y: pxToSub(2) } };
  const heatParams = { ...defaultDynamicParams(), ...(findDynamicTemplate('挤压冒热气')?.params ?? {}), rate: 12 };
  const torsoPiece = createDefaultCostumePiece('torso');
  torsoPiece.parametric = {
    ...createDefaultParametricAppearance(),
    composite: 'overlay', haloWidth: 2,
  } as never;
  (torsoPiece.sprites as Record<number, unknown>)[2] = sprite5;
  const torsoPiece2 = createDefaultCostumePiece('torso');
  torsoPiece2.parametric = torsoPiece.parametric;
  torsoPiece2.dynamicPatterns = [createDynamicInstance('覆盖', { ...heatParams, rate: 99 }, '身体')];
  const helmPiece = createDefaultCostumePiece('helm');
  helmPiece.parametric = { ...createDefaultParametricAppearance(), composite: 'silhouette' } as never;

  const ch = {
    id: 'chL', name: '运行时跟进',
    nodes: {
      torso: { ...makeNode('torso', '躯干', 'torso'), dynamicPatterns: [createDynamicInstance('热气', heatParams, '身体')] },
      helm: makeNode('helm', '头盔', 'helm', 'torso'),
      cape: { ...makeNode('cape', '披风', null, 'torso'), dynamicPatterns: [createDynamicInstance('x', heatParams, '氛围')] },
    },
    rootNodeId: 'torso',
    rootNodeIds: ['torso'],
    costumeSets: [
      { id: 'set1', name: '默认', pieces: { torso: torsoPiece, helm: helmPiece } },
      { id: 'set2', name: '替换', pieces: { torso: torsoPiece2 } },
    ],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;

  const pkg = convertCharacterToRuntimePackage(ch);
  const torso = pkg.parts.find((p) => p.key === 'torso');
  check('L1 composite 进包', torso?.base.composite === 'overlay');
  check('L2 haloWidth 进包', torso?.base.haloWidth === 2);
  check('L3 底图精灵进包（东向 5×5，plug 还原为 px）',
    torso?.base.baseSprite?.w === 5 && torso?.base.baseSprite?.h === 5
    && torso?.base.baseSprite?.plug[0] === 1 && torso?.base.baseSprite?.plug[1] === 2);
  check('L4 节点动态进包（默认集解析）', torso?.dynamic?.length === 1 && torso?.dynamic?.[0]?.params.rate === 12);
  const dyn2 = (pkg.costumes['set2'] as { __dynamic?: Record<string, { params: { rate: number } }[]> }).__dynamic;
  check('L5 换装集 __dynamic 同位覆盖', dyn2?.['torso']?.[0]?.params.rate === 99);
  check('L6 defaultCostume = 生效集', pkg.defaultCostume === 'set1');
  check('L7 孤儿动态点名 warning（无参数化外观的披风）',
    pkg.warnings.some((w) => w.includes('动态效果') && w.includes('cape')));
  check('L8 silhouette 无底图点名 warning', pkg.warnings.some((w) => w.includes('helm') && w.includes('独立生成')));

  const dyn = createDynamicRuntime() as unknown as {
    dynDeformAt: (p: never, t: number) => { sx: number; sy: number; amount: number };
    dynContour: (t: never) => unknown[];
    dynSimulate: (i: never, t: never, f: number, fr: number, l: string, s: string) => { alpha: number }[];
  };
  const dTs = dynamicDeformAt(heatParams, 0.31);
  const dRt = dyn.dynDeformAt(heatParams as never, 0.31);
  check('L9 形变脉冲与产品侧一致', Math.abs(dTs.sx - dRt.sx) < 1e-9 && Math.abs(dTs.sy - dRt.sy) < 1e-9 && Math.abs(dTs.amount - dRt.amount) < 1e-9);
  const tileData = new Uint8Array(5 * 5 * 4);
  for (let q = 0; q < 25; q++) tileData[q * 4] = 2;
  const tile5 = { w: 5, h: 5, cx: 2, cy: 2, data: tileData };
  check('L10 运行时轮廓 5×5 = 16 点', dyn.dynContour(tile5 as never).length === 16);
  const tileData20 = new Uint8Array(20 * 20 * 4);
  for (let q = 0; q < 400; q++) tileData20[q * 4] = 2;
  const tile20 = { w: 20, h: 20, cx: 10, cy: 10, data: tileData20 };
  const instRt = { slot: '身体', params: heatParams };
  const s1 = dyn.dynSimulate(instRt as never, tile20 as never, 30, 60, 'back', 'torso');
  const s2 = dyn.dynSimulate(instRt as never, tile20 as never, 30, 60, 'back', 'torso');
  check('L11 运行时模拟确定性且有粒子', s1.length > 0 && JSON.stringify(s1) === JSON.stringify(s2));
  check('L12 运行时粒子 alpha 不超上限', s1.every((p) => p.alpha >= 0 && p.alpha <= heatParams.alpha + 1e-9));

  const fnNames = (s: string) => new Set([...s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const { readFileSync } = await import('node:fs');
  const tplText = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
  const dynNames = fnNames(DYNAMIC_SRC);
  const collisions = [...dynNames].filter((x) => fnNames(tplText).has(x) || fnNames(BAKE_SRC).has(x) || fnNames(RUNTIME_EVAL_SRC).has(x));
  check(`L13 DYNAMIC_SRC 与模板/BAKE/EVAL 无同名冲突（${collisions.join(',') || '无'}）`, collisions.length === 0);
  const html = buildRuntimeHtml(pkg);
  check('L14 导出 HTML 含动态模拟与底图采样接线',
    html.includes('dynSimulate(') && html.includes('uBase') && html.includes('bakeResolvedTile') && html.includes('__dynamic'));

  // 帧率进包 + 实例 id 保留（种子对齐）：粒子帧量化基数与编辑器同口径
  check('L15 包带工程帧率（convert 入参直达包字段）',
    convertCharacterToRuntimePackage(ch, undefined, { frameRate: 8 }).frameRate === 8 && pkg.frameRate === 12);
  check('L16 运行时动态实例保留 id（createDynamicInstance 的 dyn_ 前缀）',
    typeof torso?.dynamic?.[0]?.id === 'string' && (torso?.dynamic?.[0]?.id ?? '').startsWith('dyn_'));
  check('L17 模板粒子帧量化用包帧率（不再写死 60）',
    html.includes('EMBEDDED.frameRate') && !html.includes('elapsed * 60'));
  // 两套模拟逐值对齐：同一实心网格（产品吃精灵、运行时吃等价瓦片）、
  // 同参数、同帧、同帧率、同种子（部件键 + 实例 id）→ 粒子逐项相等
  {
    const { simulateDynamicParticles } = await import('../src/lib/dynamic-pattern-sim');
    const grid20: (string | null)[][] = Array.from({ length: 20 }, () => Array(20).fill('#3366aa'));
    const sprite20 = { width: 20, height: 20, data: grid20, plug: { x: pxToSub(10), y: pxToSub(10) } };
    const instEq = { id: 'dyn_eq_1', slot: '身体', enabled: true, params: heatParams };
    // 帧 30 恰逢形变脉冲谷底（两边同为零粒子），故多帧断言 + 至少一帧非空作见证
    let eqAll = true, eqWitness = 0;
    for (const f of [30, 60, 90, 120, 200, 300]) {
      const prod = simulateDynamicParticles(
        { instance: instEq, origin: 'node' } as never, sprite20 as never, f, 8, false, 'back', 'torso');
      const rt = dyn.dynSimulate(
        { id: 'dyn_eq_1', slot: '身体', params: heatParams } as never, tile20 as never, f, 8, 'back', 'torso');
      if (JSON.stringify(prod) !== JSON.stringify(rt)) eqAll = false;
      if (prod.length > 0) eqWitness++;
    }
    check('L18 运行时模拟与产品模拟逐值一致（同网格/参数/帧/帧率/种子）',
      eqAll && eqWitness >= 3);
  }
}

// ---------- M) 精灵部件进包 ----------
{
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const { createDynamicInstance, defaultDynamicParams } = await import('../src/lib/dynamic-patterns');
  const { pxToSub } = await import('../src/lib/unified-types');
  const grid5: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#aa5533'));
  const sprite5 = { width: 5, height: 5, data: grid5, plug: { x: pxToSub(2), y: pxToSub(4) } };
  const dynParams = { ...defaultDynamicParams(), rate: 12 };

  const skirt1 = createDefaultCostumePiece('skirt');
  (skirt1.sprites as Record<number, unknown>)[2] = sprite5;
  const skirt2 = createDefaultCostumePiece('skirt');
  (skirt2.sprites as Record<number, unknown>)[2] = sprite5;
  skirt2.dynamicPatterns = [createDynamicInstance('覆盖', { ...dynParams, rate: 77 }, '氛围')];
  const torsoP1 = createDefaultCostumePiece('torso');
  torsoP1.parametric = createDefaultParametricAppearance();
  const torsoP2 = createDefaultCostumePiece('torso');
  (torsoP2.sprites as Record<number, unknown>)[2] = sprite5;

  const ch = {
    id: 'chM', name: '精灵部件',
    nodes: {
      torso: makeNode('torso', '躯干', 'torso'),
      skirt: { ...makeNode('skirt', '裙子', 'skirt', 'torso'), dynamicPatterns: [createDynamicInstance('氛围实例', dynParams, '氛围')] },
    },
    rootNodeIds: ['torso'],
    costumeSets: [
      { id: 'set1', name: '默认', pieces: { torso: torsoP1, skirt: skirt1 } },
      { id: 'set2', name: '替换', pieces: { torso: torsoP2, skirt: skirt2 } },
    ],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;

  const pkg = convertCharacterToRuntimePackage(ch);
  const skirt = pkg.parts.find((p) => p.key === 'skirt');
  check('M1 精灵部件进包（spriteKind + 东向网格）', skirt?.spriteKind === true && skirt?.sprite?.w === 5 && skirt?.sprite?.h === 5);
  check('M2 精灵部件动态进包且无孤儿 warning', skirt?.dynamic?.length === 1
    && !pkg.warnings.some((w) => w.includes('动态效果') && w.includes('skirt')));
  const sp2 = (pkg.costumes['set2'] as { __sprite?: Record<string, { w: number }> }).__sprite;
  const sp1 = (pkg.costumes['set1'] as { __sprite?: Record<string, { w: number }> }).__sprite;
  check('M3 参数化槽位在无参数化的服装集回落精灵', sp2?.['torso']?.w === 5 && sp1?.['torso'] === undefined);
  const dyn2 = (pkg.costumes['set2'] as { __dynamic?: Record<string, { params: { rate: number } }[]> }).__dynamic;
  check('M4 精灵部件逐集动态覆盖进 __dynamic', dyn2?.['skirt']?.[0]?.params.rate === 77);
  const html = buildRuntimeHtml(pkg);
  check('M5 导出 HTML 含直贴图瓦片路径', html.includes('spriteTileOf') && html.includes('vMisc.w > 2.5'));
}

// ---------- N) 跟随开关进包 ----------
{
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const followGraph = (followMode?: 'prev' | 'same'): any => ({
    version: 1, outputId: 'out', ...(followMode ? { followMode } : {}),
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {} },
      { id: 'out', type: 'transform', inputs: {}, params: {} },
    ],
  });
  const mkCh = (followMode?: 'prev' | 'same'): any => ({
    id: 'chN', name: '跟随开关',
    nodes: { torso: makeNode('torso', '躯干', 'torso') },
    rootNodeIds: ['torso'],
    costumeSets: [{ id: 'set1', name: '默认', pieces: { torso: { nodeId: 'torso', zIndex: 0, parametric: createDefaultParametricAppearance() } } }],
    activeCostumeSetId: 'set1',
    variants: {},
    behaviorGraphs: { torso: followGraph(followMode) },
  });
  const pkgSame = convertCharacterToRuntimePackage(mkCh('same') as Character);
  check('N1 followMode=same 进包为 follow: same', (pkgSame.behavior.graphs['torso'] as { follow?: string }).follow === 'same');
  const pkgDef = convertCharacterToRuntimePackage(mkCh(undefined) as Character);
  check('N2 缺省不写 follow（运行时按 prev 解释）', (pkgDef.behavior.graphs['torso'] as { follow?: string }).follow === undefined);
  const html = buildRuntimeHtml(pkgSame);
  check('N3 模板含跟随 A/B 两遍求值', html.includes('runBehaviorPass') && html.includes("follow || 'prev'"));
}

// ---------- O) 精灵引用指向工程级全局表（整件不显示事故回归） ----------
// 事故：装配角色的服装件精灵全是 SpriteRef、指向工程级 sprites 表，
// 角色自带表为空；转换器只查角色表 → 引用全部落空 → 精灵部件整件不进包。
{
  const { pxToSub } = await import('../src/lib/unified-types');
  const grid5: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#3366aa'));
  const extSprite = { width: 5, height: 5, data: grid5, plug: { x: pxToSub(2), y: pxToSub(4) } };
  const cloakPiece = createDefaultCostumePiece('cloak');
  // 只存方向 0（装配服装常态）且为引用形式
  (cloakPiece.sprites as Record<number, unknown>)[0] = { spriteId: 'ext1' };
  const ch = {
    id: 'chO', name: '全局表引用',
    nodes: { cloak: makeNode('cloak', '披风', 'cloak') },
    rootNodeIds: ['cloak'],
    sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { cloak: cloakPiece } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;

  const pkgNoTable = convertCharacterToRuntimePackage(ch);
  check('O1 不传全局表时引用落空（复现事故）', !pkgNoTable.parts.some((p) => p.key === 'cloak'));
  const pkg = convertCharacterToRuntimePackage(ch, { ext1: extSprite } as never);
  const cloak = pkg.parts.find((p) => p.key === 'cloak');
  check('O2 传全局表后精灵部件进包（且方向 0 代表图回落生效）', cloak?.spriteKind === true && cloak?.sprite?.w === 5);
  const sp = (pkg.costumes['set1'] as { __sprite?: Record<string, { w: number }> }).__sprite;
  check('O3 逐集 __sprite 同步带上', sp?.['cloak']?.w === 5);
}

// ---------- P) 节点蓝图进包：变换通道按行为口径（单独/与行为图求和/像素图跳过/修改器生成图） ----------
{
  const pendulumGraph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
      { id: 'pm', type: 'pendulum', inputs: { t: { nodeId: 't', output: 'out' } }, params: { amplitude: 30, period: 0.267 }, ui: { x: 0, y: 0 } },
      { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'pm', output: 'out' } }, params: {}, ui: { x: 0, y: 0 } },
    ],
  };
  const constGraph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 'c', type: 'const', inputs: {}, params: { value: 10 }, ui: { x: 0, y: 0 } },
      { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'c', output: 'out' } }, params: {}, ui: { x: 0, y: 0 } },
    ],
  };
  const pixelGraph: BlueprintGraph = {
    version: 1, outputId: 'tx',
    nodes: [
      { id: 'tx', type: 'texture_scroll', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
    ],
  };
  const piece = (slot: string) => ({ ...createDefaultCostumePiece(slot), parametric: createDefaultParametricAppearance() });
  const ch = {
    id: 'chP', name: '节点蓝图进包',
    nodes: {
      arm: { ...makeNode('arm', '手臂', 'arm'), blueprint: pendulumGraph },
      leg: { ...makeNode('leg', '腿', 'leg'), blueprint: pendulumGraph },
      cape: { ...makeNode('cape', '披风', 'cape'), blueprint: pixelGraph },
      hat: { ...makeNode('hat', '帽子', 'hat'), modifiers: [{ id: 'm1', type: 'pendulum', enabled: true, params: { amplitude: 20, period: 0.267 } }] },
    },
    rootNodeIds: ['arm', 'leg', 'cape', 'hat'],
    sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { arm: piece('arm'), leg: piece('leg'), cape: piece('cape'), hat: piece('hat') } }],
    activeCostumeSetId: 'set1',
    variants: {},
    behaviorGraphs: { leg: constGraph },
  } as unknown as Character;

  const pkg = convertCharacterToRuntimePackage(ch);
  const evaluate = createRuntimeEvaluator();
  const ctx4 = { tSec: 0.267 / 4, vars: { t: 0.267 / 4, phase: 0, moveX: 0, speed01: 0, grounded: 1 } };
  check('P1 只有节点蓝图的节点也进包', !!pkg.behavior.graphs['arm']);
  const armOut = evaluate(pkg.behavior.graphs['arm'] as never, ctx4 as never);
  check('P2 节点蓝图摆锤在运行时求值（t=周期/4 → -30°）', Math.abs((armOut.get('arm')?.angle ?? 0) - (-30 * Math.PI / 180)) < 0.01);
  check('P3 行为图+节点蓝图合并含求和节点', (pkg.behavior.graphs['leg']?.nodes ?? []).some((n) => n.type === 'add'));
  const legOut = evaluate(pkg.behavior.graphs['leg'] as never, ctx4 as never);
  check('P4 合并后求和生效（10° + 摆锤 30° = -40°）', Math.abs((legOut.get('leg')?.angle ?? 0) - (-40 * Math.PI / 180)) < 0.01);
  check('P5 像素类节点蓝图不进包且 warning 点名', !pkg.behavior.graphs['cape'] && pkg.warnings.some((w) => w.includes('节点蓝图「披风」') && w.includes('无 transform 输出')));
  check('P6 修改器生成图（无 blueprint 字段）也进包', !!pkg.behavior.graphs['hat']);
  const hatOut = evaluate(pkg.behavior.graphs['hat'] as never, ctx4 as never);
  check('P7 修改器摆锤幅值 20 生效（t=周期/4 → -20°）', Math.abs((hatOut.get('hat')?.angle ?? 0) - (-20 * Math.PI / 180)) < 0.01);
}

// ---------- Q) 发光段：选区（取色/标记）+ 权重场 + 进包 + 模板着色 ----------
{
  const { glowMaskCells, glowField, glowPulseAt, encodeGlowMask, packBytesBase64, defaultDynamicParams } = await import('../src/lib/dynamic-patterns');
  const { createDynamicInstance } = await import('../src/lib/dynamic-patterns');
  const grid = [
    ['#111111', '#2ea8ff', '#111111', null],
    ['#111111', '#2ea8ff', '#111111', '#111111'],
    [null, '#111111', '#111111', '#111111'],
  ] as never;
  const colorParams = { ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color' as const, glowPick: '#2EA8FF', glowHalo: 1 };
  const cells = glowMaskCells(colorParams, grid);
  check('Q1 取色选区精确命中同色像素（不分大小写、透明不选）', !!cells && cells[1] === 1 && cells[5] === 1 && cells[0] === 0 && cells[3] === 0);
  const field = glowField(colorParams, grid);
  const atF = (f: { field: Float32Array; w: number; padX: number; padY: number }, x: number, y: number) =>
    f.field[(y + f.padY) * f.w + (x + f.padX)];
  check('Q2 权重场：选区内 1、柔光圈一层衰减到 0.5', !!field && atF(field, 1, 0) === 1 && Math.abs(atF(field, 0, 0) - 0.5) < 1e-6 && atF(field, 3, 0) === 0);
  check('Q2b 场带外扩边距（圈宽 1 → pad 1、尺寸 6×5）', !!field && field.padX === 1 && field.padY === 1 && field.w === 6 && field.h === 5);
  check('Q3 呼吸脉冲：相位 0 时 t=0 为 0.5、glowHz=1 时 t=0.25s 达峰值', glowPulseAt({ ...colorParams, glowHz: 1 }, 0) === 0.5 && Math.abs(glowPulseAt({ ...colorParams, glowHz: 1 }, 0.25) - 1) < 1e-9);
  const maskData = encodeGlowMask([[true, false], [false, true]]);
  const markedParams = { ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'marked' as const, glowMask: maskData, glowHalo: 0 };
  const mcells = glowMaskCells(markedParams, [['#000000', '#000000'], ['#000000', '#000000']] as never);
  check('Q4 手动标记掩码打包往返一致', !!mcells && mcells[0] === 1 && mcells[1] === 0 && mcells[3] === 1);
  check('Q5 字节 base64 编码形状', packBytesBase64(new Uint8Array([0, 127, 255, 64])) === 'AH//QA');

  // 进包：精灵部件挂发光实例（节点挂载），场与逐集 __glow 都在
  const spr = {
    id: 'gspr', width: 4, height: 3,
    plug: { x: 0 as never, y: 0 as never },
    data: grid,
    directions: { 2: { spriteId: 'gspr', mirror: false } },
  } as never;
  const glowInst = createDynamicInstance('辉光呼吸', {
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#2ea8ff', glowHalo: 1, glowHz: 0.7, emitEnabled: false,
  }, '辉光');
  const ch = {
    id: 'chQ', name: '发光测试',
    nodes: { gem: { ...makeNode('gem', '宝石', 'gem'), dynamicPatterns: [glowInst] } },
    rootNodeIds: ['gem'],
    sprites: { gspr: spr },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;
  const pkg = convertCharacterToRuntimePackage(ch);
  const gem = pkg.parts.find((p) => p.key === 'gem');
  check('Q6 精灵部件发光场进包（space=sprite，含外扩边距）', !!gem?.glow && gem.glow.space === 'sprite' && gem.glow.w === 6 && gem.glow.h === 5 && gem.glow.padX === 1 && gem.glow.padY === 1);
  check('Q7 逐集 __glow 同步带上', !!(pkg.costumes['set1'] as { __glow?: Record<string, unknown> }).__glow?.['gem']);
  const emptyInst = createDynamicInstance('辉光呼吸', {
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#ffffff', emitEnabled: false,
  }, '辉光');
  const ch2 = {
    ...ch, id: 'chQ2',
    nodes: { gem: { ...makeNode('gem', '宝石', 'gem'), dynamicPatterns: [emptyInst] } },
  } as unknown as Character;
  const pkg2 = convertCharacterToRuntimePackage(ch2);
  check('Q8 选区为空时不进包且 warning 点名', !pkg2.parts.find((p) => p.key === 'gem')?.glow
    && pkg2.warnings.some((x) => x.includes('发光段') && x.includes('选区为空')));
  const tolGrid = [['#2ea8ff', '#2fa0f0', '#ff0000', null]] as never;
  const tolCells = glowMaskCells({ ...colorParams, glowTolerance: 0.05 }, tolGrid);
  check('Q10 容差 0.05 选住近色（距离约 0.039）、不选远色', !!tolCells && tolCells[0] === 1 && tolCells[1] === 1 && tolCells[2] === 0 && tolCells[3] === 0);
  const exactCells = glowMaskCells({ ...colorParams, glowTolerance: 0 }, tolGrid);
  check('Q11 容差 0 仍是精确同色', !!exactCells && exactCells[0] === 1 && exactCells[1] === 0);
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const html = buildRuntimeHtml(pkg);
  check('Q9 模板含发光着色接线（uGlow/applyGlow/iGlowA）', html.includes('uGlow') && html.includes('applyGlow') && html.includes('iGlowA'));
  check('Q12 模板含第三组发光参数（iGlowC）', html.includes('iGlowC'));

  // 多实例进包：4 个发光实例 → 前 2 独立通道、第 3 个起合并进 B 通道
  const grid4 = [['#ff0000', '#00ff00'], ['#0000ff', '#ffff00']] as never;
  const spr4 = {
    id: 'gspr4', width: 2, height: 2, plug: { x: 0 as never, y: 0 as never }, data: grid4,
    directions: { 2: { spriteId: 'gspr4', mirror: false } },
  } as never;
  const mkGlow = (pick: string, slot: string) => createDynamicInstance('辉光呼吸', {
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: pick, glowHalo: 0, emitEnabled: false,
  }, slot);
  const ch4 = {
    id: 'chQ4', name: '多发光',
    nodes: {
      gem: {
        ...makeNode('gem', '宝石', 'gem'),
        dynamicPatterns: [mkGlow('#ff0000', '辉光一'), mkGlow('#00ff00', '辉光二'), mkGlow('#0000ff', '辉光三'), mkGlow('#ffff00', '辉光四')],
      },
    },
    rootNodeIds: ['gem'],
    sprites: { gspr4: spr4 },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gspr4', mirror: false } } } } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;
  const pkg4 = convertCharacterToRuntimePackage(ch4);
  const glow4 = pkg4.parts.find((p) => p.key === 'gem')?.glow;
  const bytes4 = glow4 ? Buffer.from(glow4.data, 'base64') : null;
  check('Q13 四实例进包：第 1/2 独立、第 3 起合并进第三通道', !!bytes4
    && bytes4[0 * 3 + 0] === 255 && bytes4[1 * 3 + 1] === 255
    && bytes4[2 * 3 + 2] === 255 && bytes4[3 * 3 + 2] === 255
    && bytes4[0 * 3 + 1] === 0 && bytes4[0 * 3 + 2] === 0);
  check('Q14 超 3 个时点名按所选组并入（不是丢弃）', pkg4.warnings.some((x) => x.includes('按各自所选的发光组并入')));
  // 第 4 个改选第 1 组 → 它的选区（黄）并入 R 通道，不再进 B 通道
  const mkGlowF = (pick: string, slot: string, follow?: number) => createDynamicInstance('辉光呼吸', {
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: pick, glowHalo: 0, emitEnabled: false,
    ...(follow !== undefined ? { glowFollowGroup: follow } : {}),
  }, slot);
  const ch5 = {
    ...ch4, id: 'chQ5',
    nodes: {
      gem: {
        ...makeNode('gem', '宝石', 'gem'),
        dynamicPatterns: [mkGlowF('#ff0000', '辉光一'), mkGlowF('#00ff00', '辉光二'), mkGlowF('#0000ff', '辉光三'), mkGlowF('#ffff00', '辉光四', 0)],
      },
    },
  } as unknown as Character;
  const pkg5 = convertCharacterToRuntimePackage(ch5);
  const glow5 = pkg5.parts.find((p) => p.key === 'gem')?.glow;
  const bytes5 = glow5 ? Buffer.from(glow5.data, 'base64') : null;
  check('Q15 第 4 个选第 1 组：黄选区并入 R 通道、B 通道只剩蓝', !!bytes5
    && bytes5[3 * 3 + 0] === 255 && bytes5[3 * 3 + 2] === 0 && bytes5[2 * 3 + 2] === 255);

  // 辉光形状：单像素选区 + 圈宽 2，各形状的印章衰减几何
  const grid9 = Array.from({ length: 9 }, (_, y) =>
    Array.from({ length: 9 }, (_, x) => (x === 4 && y === 4 ? '#2ea8ff' : '#111111'))) as never;
  const shapeField = (shape: string, over: Record<string, unknown> = {}) => glowField({
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#2ea8ff',
    glowHalo: 2, glowShape: shape, ...over,
  } as never, grid9);
  const at = (f: { field: Float32Array; w: number; padX: number; padY: number } | null, x: number, y: number) =>
    f ? f.field[(y + f.padY) * f.w + (x + f.padX)] : -1;
  const nearV = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const fSq = shapeField('square');
  check('Q16 方形（缺省）：对角与正交同圈同值', nearV(at(fSq, 6, 4), 1 / 3) && nearV(at(fSq, 6, 6), 1 / 3));
  const fCi = shapeField('circle');
  check('Q17 圆形：欧氏距离衰减、对角 2.83 超出圈宽归零', nearV(at(fCi, 6, 4), 1 / 3) && at(fCi, 6, 6) === 0 && nearV(at(fCi, 5, 5), 1 - Math.SQRT2 / 3));
  const fSt = shapeField('star');
  check('Q18 十字星形：轴向伸长（0.444）、对角收短归零', nearV(at(fSt, 6, 4), 1 - (2 / 1.2) / 3) && at(fSt, 5, 5) === 0);
  const fFl = shapeField('flame');
  check('Q19 焰形：向上伸长（3 格外仍有 0.444）、向下压短、向上收尖', nearV(at(fFl, 4, 1), 1 - (3 / 1.8) / 3) && at(fFl, 4, 6) === 0 && at(fFl, 6, 2) === 0);
  const kernel = encodeGlowMask([[false, false, false], [true, true, true], [false, false, false]]);
  const fCu = shapeField('custom', { glowHalo: 0, glowShapeKernel: kernel });
  check('Q20 自定义印章：只沿所画轮廓盖（横向有、纵向无），圈宽为 0 也生效', at(fCu, 3, 4) === 1 && at(fCu, 5, 4) === 1 && at(fCu, 4, 3) === 0 && at(fCu, 4, 5) === 0);
  const fStar2 = shapeField('star', { glowStarReach: 2 });
  const fFlame3 = shapeField('flame', { glowFlameReach: 3 });
  check('Q21 伸长可调：星形伸长 2 时轴向 2 格 = 2/3、焰形伸长 3 时上方 4 格 = 5/9',
    nearV(at(fStar2, 6, 4), 2 / 3) && nearV(at(fFlame3, 4, 0), 5 / 9));
  const fFlameS = shapeField('flame', { glowAngleDeg: 90 });
  check('Q22 精灵基准方向：焰形主方向指南时焰尖朝下', nearV(at(fFlameS, 4, 7), 1 - (3 / 1.8) / 3) && at(fFlameS, 4, 1) === 0);
  const fFlameW = glowField({
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#2ea8ff',
    glowHalo: 2, glowShape: 'flame', glowAngleDeg: 270, glowAngleSpace: 'world',
  } as never, grid9, 90);
  check('Q23 世界基准方向：精灵转 90° 时焰尖仍朝西（世界向不变）',
    nearV(at(fFlameW, 1, 4), 1 - (3 / 1.8) / 3) && at(fFlameW, 7, 4) === 0 && at(fFlameW, 4, 1) === 0);
  const cornerGrid = [['#ff0000', null, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]] as never;
  const fCorner = glowField({
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#ff0000', glowHalo: 2, glowShape: 'square',
  } as never, cornerGrid);
  check('Q24 辉光溢出包围盒：角上选区的场扩到网格外（左上角外 2 格 = 1/3）',
    !!fCorner && fCorner.padX === 2 && Math.abs(fCorner.field[0] - 1 / 3) < 1e-6);
  check('Q25 模板含方向基准接线（iGlowSpace/fetchGlow）', html.includes('iGlowSpace') && html.includes('fetchGlow'));

  // 轨道采样烘焙：增量曲线合成一条「轨道」表演（add 模式，T 键）
  const mkTrackChar = (nodeOver: Record<string, unknown>) => ({
    id: 'chT', name: '轨道测试',
    nodes: { arm: { ...makeNode('arm', '手臂', 'arm'), ...nodeOver } },
    rootNodeId: 'arm',
    rootNodeIds: ['arm'],
    sprites: { gspr: spr },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { arm: { ...createDefaultCostumePiece('arm'), sprites: { 2: { spriteId: 'gspr', mirror: false } } } } }],
    activeCostumeSetId: 'set1',
    variants: {},
  }) as unknown as Character;
  const pkgT = convertCharacterToRuntimePackage(mkTrackChar({
    tracks: {
      angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 10 }, { frame: 12, value: 100 }] },
      x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 192 }] },
      tilt: { interpolation: 'step', keyframes: [{ frame: 0, value: 5 }] },
    },
  }));
  const perfT = pkgT.performances.find((p) => (p as { id?: string }).id === 'tracks') as unknown as {
    mode: string; triggerKey: string; duration: number; mask: string[];
    graph: { nodes: Array<{ type: string; points?: [number, number][] }> };
  } | undefined;
  const curvesT = (perfT?.graph.nodes ?? []).filter((n) => n.type === 'curve');
  check('Q26 轨道进包：合成「轨道」表演（add/KeyT/时长=帧数÷12/掩码=轨道节点）',
    !!perfT && perfT.mode === 'add' && perfT.triggerKey === 'KeyT' && Math.abs(perfT.duration - 1) < 1e-9
    && perfT.mask.join() === 'arm' && curvesT.length === 2);
  const angCurve = curvesT.find((c) => Math.abs((c.points?.[1]?.[1] ?? 0) + Math.PI / 2) < 0.01);
  const dxCurve = curvesT.find((c) => Math.abs((c.points?.[1]?.[1] ?? 0) + 12) < 1e-9);
  check('Q27 轨道曲线是相对第 0 帧的世界增量（角度 10→100 的增量 90°→-π/2、x 经北向投影 192 Sub→-12px）',
    !!angCurve && Math.abs(angCurve.points?.[0]?.[1] ?? 0) < 1e-9 && !!dxCurve);
  check('Q28 tilt 轨道无对应通道被点名', pkgT.warnings.some((w) => w.includes('tilt') && w.includes('未进包')));
  const pkgT2 = convertCharacterToRuntimePackage(mkTrackChar({
    tracks: { angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: 0 }] } },
  }));
  check('Q29 与静态姿态无差异的轨道不进包且被点名',
    !pkgT2.performances.some((p) => (p as { id?: string }).id === 'tracks')
    && pkgT2.warnings.some((w) => w.includes('无姿态贡献')));
  const pkgT3 = convertCharacterToRuntimePackage(mkTrackChar({
    tracks: {
      angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: 30 }] },
      stretch: { interpolation: 'linear', keyframes: [{ frame: 0, value: 1 }, { frame: 6, value: 1 }] },
      scaleX: { interpolation: 'linear', keyframes: [{ frame: 0, value: 1 }] },
    },
  }));
  check('Q30 不支持通道的关键帧恒等于静态值时不点名（空转不算损失）',
    pkgT3.performances.some((p) => (p as { id?: string }).id === 'tracks')
    && !pkgT3.warnings.some((w) => w.includes('stretch') || w.includes('scaleX')));
  // 父轨道带动子孙：子节点无本地轨道，世界增量曲线也必须进包
  const chPC = {
    id: 'chPC', name: '父子轨道',
    nodes: {
      arm: { ...makeNode('arm', '手臂', 'arm'), children: ['hand'], tracks: {
        angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 12, value: 90 }] },
      } },
      hand: { ...makeNode('hand', '手', 'hand', 'arm'), transform: { x: 160, y: 0, angle: 0, variantIndex: 2, stretch: 1 } },
    },
    rootNodeId: 'arm',
    rootNodeIds: ['arm'],
    sprites: { gspr: spr },
    costumeSets: [{ id: 'set1', name: '默认', pieces: {
      arm: { ...createDefaultCostumePiece('arm'), sprites: { 2: { spriteId: 'gspr', mirror: false } } },
      hand: { ...createDefaultCostumePiece('hand'), sprites: { 2: { spriteId: 'gspr', mirror: false } } },
    } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;
  const pkgPC = convertCharacterToRuntimePackage(chPC);
  const perfPC = pkgPC.performances.find((p) => (p as { id?: string }).id === 'tracks') as unknown as {
    mask: string[]; graph: { nodes: Array<{ type: string; part?: string; points?: [number, number][] }> };
  } | undefined;
  const handTr = perfPC?.graph.nodes.find((n) => n.type === 'transform' && n.part === 'hand') as unknown as
    { angleFrom?: { n: string }; dxFrom?: { n: string }; dyFrom?: { n: string } } | undefined;
  const curveById = new Map((perfPC?.graph.nodes ?? []).filter((n) => n.type === 'curve').map((n) => [(n as { id: string }).id, n.points]));
  const endV = (ref?: { n: string }) => { const pts = ref ? curveById.get(ref.n) : undefined; return pts ? pts[pts.length - 1][1] : NaN; };
  // 部件摆放走视平面投影：东向（dir 0）时横坐标取世界 Z、不是世界 X
  const pkgEast = convertCharacterToRuntimePackage(mkTrackChar({
    transform: { x: 160, y: 32, angle: 0, variantIndex: 0, stretch: 1 },
  }));
  const armEast = pkgEast.parts.find((p) => p.key === 'arm');
  check('Q32 部件 pivot 经 projectToView 投影（东向：横轴=世界 Z=0、纵轴=世界 Y）',
    !!armEast && Math.abs(armEast.base.pivot[0]) < 1e-9 && Math.abs(armEast.base.pivot[1] + 2) < 1e-9);
  // 代表精灵取显示方向（根节点朝向 0=东），不是写死的 2（北）：同槽位
  // 同时有 0 向大图与 2 向小图时必须取 0 向（尺寸/plug 都是那张的）
  const sprBig = { id: 'sprBig', width: 10, height: 8, plug: { x: 64, y: 32 },
    data: Array.from({ length: 8 }, () => Array(10).fill('#112233')) } as never;
  const sprSmall = { id: 'sprSmall', width: 4, height: 3, plug: { x: 16, y: 16 },
    data: Array.from({ length: 3 }, () => Array(4).fill('#445566')) } as never;
  const chHome = {
    id: 'chHome', name: '显示方向',
    nodes: { arm: { ...makeNode('arm', '手臂', 'arm'), transform: { x: 0, y: 0, angle: 0, variantIndex: 0, stretch: 1 } } },
    rootNodeId: 'arm',
    sprites: { sprBig, sprSmall },
    costumeSets: [{ id: 'set1', name: '默认', pieces: {
      arm: { ...createDefaultCostumePiece('arm'), sprites: {
        0: { spriteId: 'sprBig', mirror: false },
        2: { spriteId: 'sprSmall', mirror: false },
      } },
    } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;
  const pkgHome = convertCharacterToRuntimePackage(chHome);
  const armHome = pkgHome.parts.find((p) => p.key === 'arm');
  check('Q33 代表精灵取显示方向的图（0 向 10x8/plug(4,2)，不是 2 向小图）且变体键=显示方向',
    !!armHome?.sprite && armHome.sprite.w === 10 && armHome.sprite.h === 8
    && armHome.sprite.plug[0] === 4 && armHome.sprite.plug[1] === 2
    && Object.keys(armHome.variants).join() === '0');
  check('Q31 父轨道带动子节点：子节点（无本地轨道）也进掩码且带世界增量曲线',
    !!perfPC && perfPC.mask.includes('hand') && !!handTr
    && Math.abs(endV(handTr.angleFrom) + Math.PI / 2) < 0.01
    && Math.abs(endV(handTr.dxFrom) - 10) < 0.3
    && Math.abs(endV(handTr.dyFrom) - 10) < 0.3);
}

// ---------- R) 时间单位统一（丙）：图内时间一律秒、相位圈数，包内图不带 fps ----------
{
  const pendulumGraph: BlueprintGraph = {
    version: 1, outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {}, ui: { x: 0, y: 0 } },
      { id: 'pm', type: 'pendulum', inputs: { t: { nodeId: 't', output: 'out' } }, params: { amplitude: 30, period: 2 }, ui: { x: 0, y: 0 } },
      { id: 'out', type: 'transform', inputs: { rotation: { nodeId: 'pm', output: 'out' } }, params: {}, ui: { x: 0, y: 0 } },
    ],
  };
  const piece = (slot: string) => ({ ...createDefaultCostumePiece(slot), parametric: createDefaultParametricAppearance() });
  const ch = {
    id: 'chR', name: '时间单位',
    nodes: { arm: { ...makeNode('arm', '手臂', 'arm'), blueprint: pendulumGraph } },
    rootNodeIds: ['arm'],
    sprites: {},
    costumeSets: [{ id: 'set1', name: '默认', pieces: { arm: piece('arm') } }],
    activeCostumeSetId: 'set1',
    variants: {},
  } as unknown as Character;
  const pkg = convertCharacterToRuntimePackage(ch, undefined, { frameRate: 8 });
  const g = pkg.behavior.graphs['arm'] as { fps?: number; nodes: Array<{ type: string; params?: { period?: number } }> } | undefined;
  check('Q34 包内图不带 fps 字段且周期以秒原样进包（period=2）', g !== undefined && g.fps === undefined
    && g.nodes.find((n) => n.type === 'pendulum')?.params?.period === 2);
  const evaluate = createRuntimeEvaluator();
  const vars = { t: 0, phase: 0, moveX: 0, speed01: 0, grounded: 1 };
  // 模板口径：tSec = 秒。周期 2 秒的摆锤在 0.5 秒处满幅（与主画布工程帧率 8 的第 4 帧一致）
  const outHalf = evaluate(pkg.behavior.graphs['arm'] as never, { tSec: 0.5, vars } as never);
  check('Q35 tSec=0.5 处摆锤满幅（与主画布工程帧率第 4 帧一致）',
    Math.abs((outHalf.get('arm')?.angle ?? 0) - (-30 * Math.PI / 180)) < 0.01);
  // 产品对照：同一蓝图在主系统以 frame=4/frameRate=8 求值（t=0.5 秒）也是 30°
  const { evaluateBlueprint } = await import('../src/lib/blueprint/eval');
  const prod = evaluateBlueprint(pendulumGraph as never, { frame: 4, frameRate: 8, vars: {} } as never);
  check('Q36 产品口径对照成立（frame=4/帧率 8 → t=0.5 秒 → rotation 30°）', Math.abs(prod.rotation - 30) < 0.01);
}

// ---------- S) 发光片元重算：解析形状存掩码+印章参数，片元与主画布逐格一致 ----------
{
  const { glowField, defaultDynamicParams, createDynamicInstance, encodeGlowMask } = await import('../src/lib/dynamic-patterns');
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  // 片元算法镜像（与 runtime-template 的 glowStampW/glowChannelF 逐式对应）
  const stampW = (st: { shape: number; halo: number; reach: number }, cosP: number, sinP: number, dx: number, dy: number): number => {
    const halo = st.halo, reach = st.reach;
    if (halo <= 0) return dx === 0 && dy === 0 ? 1 : 0;
    if (st.shape === 0) { const r = Math.max(Math.abs(dx), Math.abs(dy)); return r <= halo ? 1 - r / (halo + 1) : 0; }
    if (st.shape === 1) { const d = Math.hypot(dx, dy); return d <= halo ? 1 - d / (halo + 1) : 0; }
    const lx = dx * cosP + dy * sinP, ly = -dx * sinP + dy * cosP;
    if (st.shape === 2) {
      const d = Math.hypot(lx, ly);
      if (d <= 0) return 1;
      const axis = Math.abs(Math.cos(2 * Math.atan2(ly, lx)));
      const f = 0.45 + (reach - 0.45) * Math.pow(axis, 1.5);
      const dEff = d / f;
      return dEff <= halo ? 1 - dEff / (halo + 1) : 0;
    }
    const dxs = ly < 0 ? lx * (1 + (-ly) * 0.3) : lx;
    const dys = ly < 0 ? ly / reach : ly * 1.7;
    const d = Math.hypot(dxs, dys);
    return d <= halo ? 1 - d / (halo + 1) : 0;
  };
  const channelF = (st: { shape: number; halo: number; angleDeg: number; reach: number }, world: boolean,
    maskAt: (x: number, y: number) => boolean, vRot: number, gx: number, gy: number): number => {
    const mainDeg = st.angleDeg - (world ? -vRot * 180 / Math.PI : 0);
    const phiDeg = st.shape === 2 ? mainDeg : mainDeg - 270;
    const phi = phiDeg * Math.PI / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
    const R = st.shape > 1 ? Math.ceil(st.halo * st.reach) + 1 : st.halo;
    let f = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const w = stampW(st, cosP, sinP, dx, dy);
      if (w > 0 && maskAt(gx - dx, gy - dy)) f = Math.max(f, w);
    }
    return f;
  };
  const gridS = Array.from({ length: 9 }, (_, y) =>
    Array.from({ length: 9 }, (_, x) => ((x === 4 && y === 4) || (x === 6 && y === 2) ? '#2ea8ff' : '#111111'))) as never;
  const sprS = {
    id: 'gsprS', width: 9, height: 9, plug: { x: 0 as never, y: 0 as never }, data: gridS,
    directions: { 2: { spriteId: 'gsprS', mirror: false } },
  } as never;
  const mkCharS = (insts: unknown[]) => ({
    id: 'chS', name: '片元重算',
    nodes: { gem: { ...makeNode('gem', '宝石', 'gem'), dynamicPatterns: insts } },
    rootNodeIds: ['gem'],
    sprites: { gsprS: sprS },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gsprS', mirror: false } } } } }],
    activeCostumeSetId: 'set1',
    variants: {},
  }) as unknown as Character;
  const mkInstS = (over: Record<string, unknown>) => createDynamicInstance('辉光呼吸', {
    ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: '#2ea8ff', emitEnabled: false, ...over,
  } as never, '辉光');
  const shapeCode: Record<string, number> = { square: 0, circle: 1, star: 2, flame: 3 };
  const cases: [string, Record<string, unknown>][] = [
    ['方形/精灵基准', { glowShape: 'square', glowHalo: 2 }],
    ['圆形/世界基准', { glowShape: 'circle', glowHalo: 2, glowAngleDeg: 100, glowAngleSpace: 'world' }],
    ['星形/世界基准', { glowShape: 'star', glowHalo: 2, glowStarReach: 2, glowAngleDeg: 45, glowAngleSpace: 'world' }],
    ['焰形/世界基准', { glowShape: 'flame', glowHalo: 3, glowFlameReach: 2.5, glowAngleDeg: 200, glowAngleSpace: 'world' }],
    ['星形/圈宽0/世界基准', { glowShape: 'star', glowHalo: 0, glowAngleSpace: 'world' }],
    ['焰形/精灵基准', { glowShape: 'flame', glowHalo: 1, glowAngleDeg: 90 }],
  ];
  let sBad = 0;
  for (const [label, over] of cases) {
    const pkgS = convertCharacterToRuntimePackage(mkCharS([mkInstS(over)]));
    const partS = pkgS.parts.find((x) => x.key === 'gem');
    const entry = partS?.glow;
    const st = entry?.stamps?.[0];
    const resolved = partS?.dynamic?.[0]?.params as never as Record<string, unknown>;
    if (!entry || !st || st.shape !== shapeCode[over.glowShape as string]) { sBad++; console.log('  S 形状代码不符:', label, JSON.stringify(st)); continue; }
    const bytes = Buffer.from(entry.data, 'base64');
    const maskAt = (x: number, y: number) => {
      const bx = x + entry.padX, by = y + entry.padY;
      return bx >= 0 && by >= 0 && bx < entry.w && by < entry.h && bytes[(by * entry.w + bx) * 3] > 127;
    };
    const world = (resolved.glowAngleSpace as string) === 'world';
    for (const theta of [0, 40, -75, 160]) {
      const truth = glowField(resolved as never, gridS as never, theta);
      if (!truth) { sBad++; continue; }
      const vRot = -theta * Math.PI / 180;
      for (let gy = -6; gy < 15; gy++) for (let gx = -6; gx < 15; gx++) {
        const mine = channelF(st, world, maskAt, vRot, gx, gy);
        const tx = gx + truth.padX, ty = gy + truth.padY;
        const t = tx >= 0 && ty >= 0 && tx < truth.w && ty < truth.h ? truth.field[ty * truth.w + tx] : 0;
        if (Math.abs(mine - t) > 1e-6) sBad++;
      }
    }
  }
  check('S1 解析形状×基准×多角度：片元重算与主画布 glowField 逐格一致', sBad === 0);
  // 掩码语义：选中格 255、印章边缘格（场权重在 0..1 之间）存 0（不是烘焙场）
  {
    const pkgS = convertCharacterToRuntimePackage(mkCharS([mkInstS({ glowShape: 'star', glowHalo: 2, glowStarReach: 2 })]));
    const entry = pkgS.parts.find((x) => x.key === 'gem')?.glow;
    const bytes = entry ? Buffer.from(entry.data, 'base64') : null;
    const atB = (x: number, y: number) => (entry && bytes ? bytes[((y + entry.padY) * entry.w + (x + entry.padX)) * 3] : -1);
    check('S2 解析形状通道存选区掩码（选中=255、边缘=0）', atB(4, 4) === 255 && atB(5, 4) === 0 && atB(3, 3) === 0);
  }
  // 自绘印章 → 烘焙场通道：字节与 glowField 权重逐格相等
  {
    const kernel = encodeGlowMask([[false, true, false], [true, true, true], [false, true, false]]);
    const inst = mkInstS({ glowShape: 'custom', glowShapeKernel: kernel, glowHalo: 0 });
    const pkgS = convertCharacterToRuntimePackage(mkCharS([inst]));
    const partS = pkgS.parts.find((x) => x.key === 'gem');
    const entry = partS?.glow;
    const resolved = partS?.dynamic?.[0]?.params as never;
    const truth = glowField(resolved, gridS as never, 0);
    const bytes = entry ? Buffer.from(entry.data, 'base64') : null;
    let ok = !!entry && entry.stamps?.[0]?.shape === 4 && !!truth && !!bytes;
    if (ok && entry && truth && bytes) {
      for (let gy = 0; gy < 9 && ok; gy++) for (let gx = 0; gx < 9; gx++) {
        const expect = Math.round(Math.max(0, Math.min(1, truth.field[(gy + truth.padY) * truth.w + (gx + truth.padX)])) * 255);
        if (bytes[((gy + entry.padY) * entry.w + (gx + entry.padX)) * 3] !== expect) { ok = false; break; }
      }
    }
    check('S3 自绘印章通道存烘焙场（形状代码 4、字节与权重场逐格相等）', ok);
  }
  // 同通道并入：参数一致 → 掩码并集+重算；参数不一致 → 烘焙场
  {
    const mkF = (pick: string, over: Record<string, unknown>, slot: string) => createDynamicInstance('辉光呼吸', {
      ...defaultDynamicParams(), glowEnabled: true, glowMaskSource: 'color', glowPick: pick, emitEnabled: false, glowFollowGroup: 0, ...over,
    } as never, slot);
    const gridM = [['#ff0000', '#00ff00'], ['#0000ff', '#ffff00']] as never;
    const sprM = { id: 'gsprM', width: 2, height: 2, plug: { x: 0 as never, y: 0 as never }, data: gridM, directions: { 2: { spriteId: 'gsprM', mirror: false } } } as never;
    const mkCharM = (insts: unknown[]) => ({
      id: 'chSM', name: '并入', nodes: { gem: { ...makeNode('gem', '宝石', 'gem'), dynamicPatterns: insts } },
      rootNodeIds: ['gem'], sprites: { gsprM: sprM },
      costumeSets: [{ id: 'set1', name: '默认', pieces: { gem: { ...createDefaultCostumePiece('gem'), sprites: { 2: { spriteId: 'gsprM', mirror: false } } } } }],
      activeCostumeSetId: 'set1', variants: {},
    }) as unknown as Character;
    const homo = convertCharacterToRuntimePackage(mkCharM([
      mkF('#ff0000', { glowShape: 'square', glowHalo: 1 }, '辉光一'), mkF('#00ff00', { glowShape: 'square', glowHalo: 1 }, '辉光二'),
      mkF('#0000ff', { glowShape: 'square', glowHalo: 1 }, '辉光三'), mkF('#ffff00', { glowShape: 'square', glowHalo: 1 }, '辉光四'),
    ]));
    const homoEntry = homo.parts.find((x) => x.key === 'gem')?.glow;
    check('S4 同通道并入且参数一致 → 掩码并集（形状代码 0、两选区都在 R 通道）',
      homoEntry?.stamps?.[0]?.shape === 0 && !!homoEntry
      && Buffer.from(homoEntry.data, 'base64')[((0 + homoEntry.padY) * homoEntry.w + (0 + homoEntry.padX)) * 3] === 255
      && Buffer.from(homoEntry.data, 'base64')[((1 + homoEntry.padY) * homoEntry.w + (1 + homoEntry.padX)) * 3] === 255);
    const hetero = convertCharacterToRuntimePackage(mkCharM([
      mkF('#ff0000', { glowShape: 'square', glowHalo: 1 }, '辉光一'), mkF('#00ff00', { glowShape: 'square', glowHalo: 1 }, '辉光二'),
      mkF('#0000ff', { glowShape: 'square', glowHalo: 1 }, '辉光三'), mkF('#ffff00', { glowShape: 'circle', glowHalo: 1 }, '辉光四'),
    ]));
    check('S5 同通道并入但参数不一致 → 烘焙场（形状代码 4）',
      hetero.parts.find((x) => x.key === 'gem')?.glow?.stamps?.[0]?.shape === 4);
  }
  const htmlS = buildRuntimeHtml(convertCharacterToRuntimePackage(mkCharS([mkInstS({ glowShape: 'star', glowHalo: 1 })])));
  check('S6 模板含印章重算接线且旧旋转采样已除', htmlS.includes('glowChannelF') && htmlS.includes('glowStampW') && htmlS.includes('iGlowStampA') && !htmlS.includes('vec2 ow'));
}


// ---------- T) 片段段表演 + 运行时状态机 ----------
{
  const { buildRuntimeHtml } = await import('../src/lib/proc-runtime/runtime-template');
  const gridT = [
    ['#2ea8ff', '#2ea8ff', '#2ea8ff', '#2ea8ff'],
    ['#2ea8ff', '#2ea8ff', '#2ea8ff', '#2ea8ff'],
    ['#2ea8ff', '#2ea8ff', '#2ea8ff', '#2ea8ff'],
  ] as never;
  const sprT = {
    id: 'gsprT', width: 4, height: 3,
    plug: { x: 0 as never, y: 0 as never },
    data: gridT,
    directions: { 2: { spriteId: 'gsprT', mirror: false } },
  } as never;
  const mkSegChar = (nodeOver: Record<string, unknown>) => ({
    id: 'chT', name: '段表演测试',
    nodes: { arm: { ...makeNode('arm', '手臂', 'arm'), ...nodeOver } },
    rootNodeId: 'arm',
    rootNodeIds: ['arm'],
    sprites: { gsprT: sprT },
    costumeSets: [{ id: 'set1', name: '默认', pieces: { arm: { ...createDefaultCostumePiece('arm'), sprites: { 2: { spriteId: 'gsprT', mirror: false } } } } }],
    activeCostumeSetId: 'set1',
    variants: {},
  }) as unknown as Character;
  const triTracks = {
    angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: 60 }, { frame: 12, value: 0 }] },
  };
  const clipOf = (over: Record<string, unknown>) => ({
    id: 'clipA', name: '挥手', puppetCharacterId: 'chT', startFrame: 3, endFrame: 8, loop: true,
    stateKeyframes: [], ...over,
  }) as never;
  const pkgSeg = convertCharacterToRuntimePackage(
    mkSegChar({ tracks: triTracks }), undefined,
    { frameRate: 12, totalFrames: 24, clips: [clipOf({})] },
  );
  const seg = pkgSeg.performances.find((p) => (p as { id?: string }).id === 'clip_clipA') as unknown as {
    duration: number; loop?: boolean; trigger?: string; mask: string[];
    graph: { nodes: Array<{ type: string; points?: [number, number][] }> };
  } | undefined;
  check('T1 片段窗烘成段表演（trigger=clip/时长=窗长÷帧率/loop 随片段）',
    !!seg && seg.trigger === 'clip' && Math.abs(seg.duration - 0.5) < 1e-9 && seg.loop === true && seg.mask.join() === 'arm');
  const segCurves = (seg?.graph.nodes ?? []).filter((n) => n.type === 'curve');
  const peak = segCurves.flatMap((c) => c.points ?? []).find(([x, y]) => Math.abs(x - 0.5) < 0.01 && Math.abs(y + Math.PI / 6) < 0.02);
  check('T2 段曲线是窗内相对增量（窗首帧为零点、窗中点=第 6 帧相对第 3 帧的 +30°）',
    segCurves.length > 0 && Math.abs(segCurves[0].points?.[0]?.[1] ?? 9) < 1e-9 && !!peak);
  const pkgFlat = convertCharacterToRuntimePackage(
    mkSegChar({ tracks: triTracks }), undefined,
    { frameRate: 12, totalFrames: 24, clips: [clipOf({ id: 'clipB', name: '静止段', startFrame: 14, endFrame: 20, loop: false })] },
  );
  check('T3 窗内无姿态变化的片段不生成段表演且点名',
    !pkgFlat.performances.some((p) => (p as { id?: string }).id === 'clip_clipB')
    && pkgFlat.warnings.some((w) => w.includes('静止段') && w.includes('未生成段表演')));
  const pkgForeign = convertCharacterToRuntimePackage(
    mkSegChar({ tracks: triTracks }), undefined,
    { frameRate: 12, totalFrames: 24, clips: [clipOf({ puppetCharacterId: 'someone-else' })] },
  );
  check('T4 归属他人的片段不进本角色包', !pkgForeign.performances.some((p) => (p as { id?: string }).id === 'clip_clipA'));

  const sm = pkgSeg.stateMachine;
  check('T5 默认状态机进包（initial=idle、三常驻态、每表演一个表演状态）',
    !!sm && sm.initial === 'idle'
    && ['idle', 'move', 'air'].every((id) => sm.states.some((s) => s.id === id && !s.performanceId))
    && sm.states.some((s) => s.performanceId === 'clip_clipA')
    && sm.states.some((s) => s.performanceId === 'tracks'));
  check('T6 默认机转移表（腾空由 grounded=0 从任意态进入、idle 与 move 由 speed01 互转）',
    !!sm && sm.transitions.some((t) => t.from === '*' && t.to === 'air' && t.when.some((c) => c.var === 'grounded' && c.op === 'eq' && c.value === 0))
    && sm.transitions.some((t) => t.from === 'idle' && t.to === 'move')
    && sm.transitions.some((t) => t.from === 'move' && t.to === 'idle'));

  const customChar = {
    ...mkSegChar({ tracks: triTracks }),
    stateMachine: {
      version: 1, initial: 'move',
      states: [{ id: 'move' }, { id: 'perf:ghost', performanceId: 'no-such-perf' }],
      transitions: [],
    },
  } as unknown as Character;
  const pkgCustom = convertCharacterToRuntimePackage(customChar, undefined, { frameRate: 12, totalFrames: 24 });
  check('T7 作者状态机直通；悬空表演引用降为常驻并点名',
    pkgCustom.stateMachine?.initial === 'move'
    && pkgCustom.stateMachine?.states.find((s) => s.id === 'perf:ghost')?.performanceId === undefined
    && pkgCustom.warnings.some((w) => w.includes('不在包内')));

  const pkgZ = convertCharacterToRuntimePackage(mkSegChar({
    tracks: {
      angle: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 6, value: 30 }] },
      zIndex: { interpolation: 'step', keyframes: [{ frame: 2, value: 5 }] },
    },
  }));
  check('T8 zIndex 轨偏离静态值被点名为未进包', pkgZ.warnings.some((w) => w.includes('zIndex') && w.includes('未进包')));

  const htmlT = buildRuntimeHtml(pkgSeg);
  check('T9 模板含状态机与宿主接口（procRuntime/smUpdate/enterPerformance）',
    htmlT.includes('window.procRuntime') && htmlT.includes('smUpdate') && htmlT.includes('enterPerformance'));
  check('T10 模板含事件出口与循环回绕（perfend/perfstart/loop）',
    htmlT.includes("'perfend'") && htmlT.includes("'perfstart'") && htmlT.includes('act.perf.loop'));
  check('T11 包内嵌状态机数据（stateMachine 序列化进页面）', htmlT.includes('"stateMachine"'));
  check('T12 状态机回落与停表演接线（smPickResident 按信号重推、stopPerf/stopAll/procRuntime.stop、触发键缺失时按钮不带空括号）',
    htmlT.includes('function smPickResident') && htmlT.includes('function stopPerf') && htmlT.includes('function stopAllPerfs')
    && htmlT.includes('stop: function') && htmlT.includes('停表演')
    && htmlT.includes('perf.triggerKey ?') && !htmlT.includes("perf.triggerKey || ''"));
  // T13 语法门：模板是 TS 字面量里的 JS，tsc 不解析它；标记探针也拦不住断裂。
  // 故直接对生成的页面抽脚本做解析（只解析不执行，EMBEDDED 等运行时名字不影响解析）。
  let scriptParseError: string | null = null;
  try {
    const s = htmlT.indexOf('<script>') + '<script>'.length;
    const e = htmlT.indexOf('</script>');
    new Function(htmlT.slice(s, e));
  } catch (err) { scriptParseError = err instanceof Error ? err.message : String(err); }
  check('T13 生成页面内嵌脚本可解析（模板字面量语法门，防游离括号类断裂）', scriptParseError === null, scriptParseError ?? '');
  // T14 属性预算门：WebGL 只保证 16 个顶点属性；顶点着色器声明数与最大 location 必须守住 0-15。
  const vsStart = htmlT.indexOf('layout(location=0) in vec2 aCorner');
  const vsEnd = htmlT.indexOf('void main(){', vsStart);
  const vsLocs = [...htmlT.slice(vsStart, vsEnd).matchAll(/layout\(location=(\d+)\)/g)].map((m) => +m[1]);
  check('T14 顶点着色器属性数≤16 且最大 location≤15（防属性超限致着色器编译失败）',
    vsLocs.length === 16 && Math.max(...vsLocs) === 15, `locs=${vsLocs.join(',')}`);
  // T15 setVar 通用变量行为门：从模板源码抽 setVar 真身与每帧 hostVars 构造，在桩环境真执行。
  // 静态标记证明不了三件事：通用变量真进表、保留名真拒收、并入时计算值真覆盖。
  {
    const { readFileSync } = await import('node:fs');
    const tplSrc = readFileSync(new URL('../src/lib/proc-runtime/runtime-template.ts', import.meta.url), 'utf8');
    const extractBalanced = (src: string, marker: string): string => {
      const start = src.indexOf(marker);
      if (start < 0) return '';
      let depth = 0; let inStr: string | null = null;
      for (let j = src.indexOf('{', start); j < src.length; j++) {
        const ch = src[j];
        if (inStr) { if (ch === '\\') j++; else if (ch === inStr) inStr = null; continue; }
        if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
      }
      return '';
    };
    const setVarText = extractBalanced(tplSrc, 'setVar: function (name, value)').replace(/^setVar:\s*/, '');
    let sv: any = null; let svErr = '';
    try {
      sv = new Function(`
        let hostMoveX = null; let autoWalk = false; const hostCustomVars = {};
        const setVar = ${setVarText};
        const out = {};
        out.generic = setVar('rage', 1) === true && hostCustomVars.rage === 1;
        out.coerce = setVar('rage', '2.5') === true && hostCustomVars.rage === 2.5;
        out.reserved = setVar('grounded', 0) === false && !('grounded' in hostCustomVars)
          && setVar('phase', 1) === false && setVar('t', 1) === false && setVar('speed01', 1) === false;
        out.nan = setVar('rage', 'abc') === false && hostCustomVars.rage === 2.5;
        out.del = setVar('rage', null) === true && !('rage' in hostCustomVars);
        out.moveX = setVar('moveX', 0.5) === true && hostMoveX === 0.5;
        out.autoWalk = setVar('autoWalk', 1) === true && autoWalk === true;
        return out;
      `)();
    } catch (err) { svErr = err instanceof Error ? err.message : String(err); }
    check('T15a setVar 行为：通用变量进表/字符串转数/保留名拒收/NaN 拒收/null 删除/moveX 与 autoWalk 旧通道不变',
      !!sv && Object.values(sv).every(Boolean), svErr || JSON.stringify(sv));
    const hvStart = tplSrc.indexOf('const hostVars = Object.assign({}, hostCustomVars,');
    const hvStmt = hvStart >= 0 ? tplSrc.slice(hvStart, tplSrc.indexOf('});', hvStart) + 3) : '';
    let hv: any = null; let hvErr = '';
    try {
      hv = new Function(`
        const hostCustomVars = { rage: 5, grounded: 0 };
        const behaviorT = 1.2, phaseAcc = 0.5, ix = 0;
        const char = { onGround: true };
        ${hvStmt}
        return hostVars;
      `)();
    } catch (err) { hvErr = err instanceof Error ? err.message : String(err); }
    check('T15b hostVars 并入：通用变量可读、逐帧计算值覆盖同名（预置 grounded=0 仍以本帧 1 为准）',
      !!hv && hv.rage === 5 && hv.grounded === 1 && hv.t === 1.2 && hv.moveX === 0 && hv.speed01 === 0,
      hvErr || JSON.stringify(hv));
    check('T15c 生成页面含通用变量表接线', htmlT.includes('hostCustomVars[name] = num') && htmlT.includes('Object.assign({}, hostCustomVars,'));
  }
}

console.log(`\n程序化运行时接线校验全过（${passed} 项）`);
