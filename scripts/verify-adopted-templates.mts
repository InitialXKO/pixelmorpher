// verify-adopted-templates.mts — pixelfx 对照收录模板探针（bun 运行）
// 口径：新模板逐个断言——存在且簇对；动态模板自设键 ⊆ 参数接口、
// 归一化幂等（取值在合法钳制内）、配方段确已启用、经双挂载解析可
// 解析；表面模板节点 op 全合法、引用完整、$ 参数有定义、可展开
// （无警告）且可烘焙求值不抛、烘焙非退化（≥2 内部档位，与
// verify-proc-runtime G3 同口径）。
import {
  DYNAMIC_PATTERN_TEMPLATES, DYNAMIC_PARAM_DEFS, defaultDynamicParams,
  normalizeDynamicParams, findDynamicTemplate, createDynamicInstance,
  resolveDynamicPatterns, type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';
import { PATTERN_TEMPLATES, instantiatePattern } from '../src/lib/proc-runtime/pattern-templates';
import { SURFACE_OP_SPECS } from '../src/lib/proc-runtime/surface-ops';
import { expandSurfaceGraph, subgraphLibraryOf } from '../src/lib/proc-runtime/graph-expand';
import { createSurfaceBaker } from '../src/lib/proc-runtime/bake-src';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// ---------- 动态 ----------
check('动态模板总数 40（原 22 + 收录 18）', DYNAMIC_PATTERN_TEMPLATES.length === 40, `实际 ${DYNAMIC_PATTERN_TEMPLATES.length}`);

const ifaceKeys = new Set(Object.keys(defaultDynamicParams()));
check('DYNAMIC_PARAM_DEFS 键全在参数接口内',
  DYNAMIC_PARAM_DEFS.every((d) => ifaceKeys.has(d.key)));

type SegExpect = Partial<Record<'flame' | 'blob' | 'env' | 'arc' | 'orbit' | 'glow' | 'emit', boolean>>;
const NEW_DYNAMIC: { name: string; cluster: string; seg: SegExpect; extra?: (p: DynamicPatternParams) => boolean; extraLabel?: string }[] = [
  { name: '篝火', cluster: '元素', seg: { flame: true, emit: true, glow: true } },
  { name: '火把', cluster: '元素', seg: { flame: true, emit: true, glow: true } },
  { name: '蜡烛', cluster: '元素', seg: { flame: true, emit: true, glow: true } },
  { name: '冰霜新星', cluster: '战斗', seg: { env: true, emit: true, glow: true }, extra: (p) => p.envMode === 'ripple', extraLabel: '环境段为涟漪环' },
  { name: '蓄力', cluster: '战斗', seg: { emit: true, arc: true, glow: true }, extra: (p) => p.emitMode === 'gather' && p.arcMode === 'arc' && p.arcFlicker >= 20, extraLabel: '汇聚发射 + 高闪小电弧' },
  { name: '法阵', cluster: '辅助', seg: { arc: true, emit: true, glow: true }, extra: (p) => p.arcMode === 'glyph', extraLabel: '弧线为法阵模式' },
  { name: '藤蔓缠绕', cluster: '战斗', seg: { arc: true, glow: true, emit: false }, extra: (p) => p.arcMode === 'vine', extraLabel: '弧线为藤蔓模式' },
  { name: '燃烧状态', cluster: '状态', seg: { flame: true, emit: true, glow: true } },
  { name: '中毒状态', cluster: '状态', seg: { blob: true, emit: true } },
  { name: '眩晕状态', cluster: '状态', seg: { orbit: true, emit: true }, extra: (p) => p.particleShape === 'star', extraLabel: '星形粒子' },
  { name: '睡眠状态', cluster: '状态', seg: { emit: true, glow: true } },
  { name: '冰冻状态', cluster: '状态', seg: { emit: true, glow: true } },
  { name: '细雨', cluster: '氛围', seg: { env: true, emit: false }, extra: (p) => p.envMode === 'fall', extraLabel: '环境段为坠落' },
  { name: '落雪', cluster: '氛围', seg: { env: true, emit: false }, extra: (p) => p.envMode === 'drift', extraLabel: '环境段为漂浮' },
  { name: '萤火', cluster: '氛围', seg: { env: true, emit: false }, extra: (p) => p.envMode === 'drift', extraLabel: '环境段为漂浮' },
  { name: '枪口焰', cluster: '战斗', seg: { emit: true, glow: true }, extra: (p) => p.life <= 0.3 && p.particleShape === 'star' && p.source === 'plug', extraLabel: '插头短生命星形高率' },
  { name: '烟花', cluster: '氛围', seg: { emit: true, glow: true }, extra: (p) => p.buoy < 0 && p.particleShape === 'star' && p.rampEnabled, extraLabel: '负浮力坠落 + 星形 + 坡道' },
  { name: '链式闪电', cluster: '战斗', seg: { arc: true, emit: true, glow: true }, extra: (p) => p.arcBranches === 3 && p.arcTarget === '', extraLabel: '单实例多段退形：分叉拉满、无双锚（接力靠多实例挂载）' },
];

const segFlag = (p: DynamicPatternParams, seg: keyof SegExpect): boolean => ({
  flame: p.flameEnabled, blob: p.blobEnabled, env: p.envEnabled,
  arc: p.arcEnabled, orbit: p.orbitEnabled, glow: p.glowEnabled, emit: p.emitEnabled,
}[seg]);

for (const exp of NEW_DYNAMIC) {
  const t = findDynamicTemplate(exp.name);
  check(`动态「${exp.name}」存在且簇=${exp.cluster}`, !!t && t.cluster === exp.cluster);
  if (!t) continue;
  const def = defaultDynamicParams();
  const diffKeys = (Object.keys(t.params) as (keyof DynamicPatternParams)[])
    .filter((k) => JSON.stringify(t.params[k]) !== JSON.stringify(def[k]));
  check(`动态「${exp.name}」自设键全合法`, diffKeys.every((k) => ifaceKeys.has(k)),
    `异常键 ${diffKeys.filter((k) => !ifaceKeys.has(k)).join(',')}`);
  check(`动态「${exp.name}」归一化幂等（取值合法）`,
    JSON.stringify(normalizeDynamicParams(t.params)) === JSON.stringify(t.params));
  for (const [seg, want] of Object.entries(exp.seg)) {
    check(`动态「${exp.name}」段 ${seg}=${want}`, segFlag(t.params, seg as keyof SegExpect) === want);
  }
  if (exp.extra) check(`动态「${exp.name}」${exp.extraLabel}`, exp.extra(t.params));
  const resolved = resolveDynamicPatterns([createDynamicInstance(exp.name, t.params)]);
  check(`动态「${exp.name}」可解析`, resolved.length === 1 && resolved[0].instance.templateName === exp.name);
}

// ---------- 表面 ----------
check('表面模板总数 56（原 53 + 收录 3）', PATTERN_TEMPLATES.length === 56, `实际 ${PATTERN_TEMPLATES.length}`);

const opSet = new Set(SURFACE_OP_SPECS.map((s) => s.op));
const baker = createSurfaceBaker();
const shape = { kind: 'rect', size: [40, 32] as [number, number], roundness: 0.15 };
const lib = subgraphLibraryOf(PATTERN_TEMPLATES);

const NEW_SURFACE: { id: string; name: string; cluster: string; animated: boolean }[] = [
  { id: 'portal-tex', name: '传送门', cluster: '动态', animated: true },
  { id: 'toxic-pool-tex', name: '毒潭', cluster: '动态', animated: true },
  { id: 'frost-tex', name: '霜纹', cluster: '自然', animated: false },
];

for (const exp of NEW_SURFACE) {
  const t = PATTERN_TEMPLATES.find((x) => x.id === exp.id);
  check(`表面「${exp.name}」存在且簇=${exp.cluster}`, !!t && t.name === exp.name && t.cluster === exp.cluster);
  if (!t) continue;
  check(`表面「${exp.name}」节点 op 全合法`, t.graph.nodes.every((nd) => opSet.has(nd.op)),
    `异常 ${t.graph.nodes.filter((nd) => !opSet.has(nd.op)).map((nd) => nd.op).join(',')}`);
  const ids = new Set(t.graph.nodes.map((nd) => nd.id));
  check(`表面「${exp.name}」引用完整`,
    t.graph.nodes.every((nd) => Object.values(nd.inputs ?? {}).every((r) => ids.has(r)))
    && t.graph.writes.every((wr) => ids.has(wr.from)));
  const paramKeys = new Set(t.params.map((p) => p.key));
  const dollarOk = (JSON.stringify(t.graph.nodes).match(/"\$[a-zA-Z]+"/g) ?? [])
    .every((s) => { const k = s.slice(2, -1); return paramKeys.has(k) || k === 'phase' || k === 'phaseDeg'; });
  check(`表面「${exp.name}」$ 参数全有定义`, dollarOk);
  check(`表面「${exp.name}」动画规格=${exp.animated}`, !!t.graph.animation === exp.animated);
  const g0 = instantiatePattern(t);
  const { graph: g, warnings } = expandSurfaceGraph(g0, lib);
  check(`表面「${exp.name}」展开无警告`, warnings.length === 0, warnings.join('；'));
  for (const phase of exp.animated ? [0, 0.5] : [undefined]) {
    let tiers = new Set<number>();
    let threw = '';
    try {
      const tile = baker.compileTileDAG(shape, g, undefined, phase);
      for (let i = 0; i < tile.data.length; i += 4) {
        const v = tile.data[i];
        if (v <= 7) tiers.add(v);
      }
    } catch (e) { threw = String(e); }
    check(`表面「${exp.name}」求值不抛且非退化（phase=${phase}）`, !threw && tiers.size >= 2,
      threw || `档位 ${[...tiers].join(',')}`);
  }
}

console.log(`\n收录模板探针：${pass} 过 / ${fail} 败`);
process.exit(fail ? 1 : 0);
