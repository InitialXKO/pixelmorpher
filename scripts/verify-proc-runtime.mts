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
  check('A2 预设含 edge 层（描边来自层程序）', hasEdge);
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
      params: { frames: '[0,60]', values: '[0,60]', interpolation: 'linear' },
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
      params: { amplitude: 30, period: 16 },
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
  // phase=4、period=16 → pendulum 相位 π/2 → 30°；units=main → angle=-30°=-π/6
  const out1 = evaluate(graph, { tFrame: 0, vars: { phase: 4 } });
  check('D1 行为图求值：phase 驱动 pendulum，角度换算 -π/6', Math.abs((out1.get('legL')?.angle ?? 0) - (-Math.PI / 6)) < 1e-9);
  const out2 = evaluate(graph, { tFrame: 0, vars: { phase: 12 } });
  check('D2 phase=12 → +π/6（反相）', Math.abs((out2.get('legL')?.angle ?? 0) - (Math.PI / 6)) < 1e-9);

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
      { id: 'k', type: 'keyframes', params: { frames: '[0,10]', values: '[3,7]', interpolation: 'linear' }, inputs: {} },
      { id: 'tr', type: 'transform', part: 'p', units: 'runtime' as const, dxFrom: { n: 'k' } },
    ],
  };
  check('D6 keyframes t=0 取首值 3（time 缺省）',
    evaluate(kfGraph, { tFrame: 0 }).get('p')?.dx === 3);
}

// ---------- E) 转换器 ----------
function makeNode(id: string, name: string, slotKey: string | null, parentId?: string): UnifiedNode {
  return {
    id, name, parentId,
    role: 'bone',
    slot: slotKey ? { slotKey } : undefined,
    transform: { x: 0, y: 0, angle: 0 },
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
  check('G1 模板数量 ≥ 12', PATTERN_TEMPLATES.length >= 12);
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

console.log(`\n程序化运行时接线校验全过（${passed} 项）`);
