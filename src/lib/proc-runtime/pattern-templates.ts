// ============================================================
// 表面模式模板库：模板 = 一张存好的表面 DAG + 暴露参数定义。
// 用户面孔（默认 UI）：选模板 → 调参数。图本体与用户自拼的图同格
// （SurfaceGraph），可在图编辑器里展开修改后另存为新模板。
// 参数经 graph.params 注入，节点参数以 "$key" 引用。
// ============================================================

import type { SurfaceGraph, SurfaceGraphNode, SurfaceGraphWrite } from '../unified-types';

export interface PatternParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export interface PatternTemplate {
  id: string;
  name: string;
  cluster: string;
  params: PatternParamDef[];
  graph: SurfaceGraph;
}

type N = SurfaceGraphNode;
const n = (id: string, op: string, inputs?: Record<string, string>, params?: Record<string, number | string>): N =>
  ({ id, op, inputs, params });
const w = (from: string, slot: number, extra?: Partial<SurfaceGraphWrite>): SurfaceGraphWrite =>
  ({ from, slot, ...extra });
const P = (key: string, label: string, min: number, max: number, step: number, def: number): PatternParamDef =>
  ({ key, label, min, max, step, def });

function graph(nodes: N[], writes: SurfaceGraphWrite[]): SurfaceGraph {
  return { version: 1, nodes, writes, params: {} };
}

/** 常用底：形状内全覆盖写出（作 writes[0]） */
const baseIn = (slot: number): N[] => [n('in', 'inside')];

export const PATTERN_TEMPLATES: PatternTemplate[] = [
  {
    id: 'scales', name: '鳞片', cluster: '重复',
    params: [
      P('cw', '鳞宽', 6, 18, 1, 10), P('ch', '鳞高', 5, 14, 1, 8),
      P('gap', '鳞间隙', 0, 1.5, 0.1, 0.4), P('shadow', '压盖阴影', 0, 1, 0.05, 0.6),
    ],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$ch', alt: 0.5, seed: 1 }),
      n('cs', 'cellShape', undefined, { kind: 'scallop', gap: '$gap' }),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 1.1 }),
      n('cv', 'cellV'),
      n('repCv', 'repeat', { in: 'cv' }, { cw: '$cw', ch: '$ch', alt: 0.5, seed: 1 }),
      n('lowBand', 'threshold', { in: 'repCv' }, { at: -0.45, soft: 0.25 }),
      n('inScale', 'threshold', { in: 'rep' }, { at: 0 }),
      n('shadowM', 'mul', { a: 'lowBand', b: 'inScale' }),
      n('shadowG', 'mul', { a: 'shadowM', b: 'shadowK' }),
      n('shadowK', 'const', undefined, { v: '$shadow' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('shadowG', 2, { at: 0.35 }),
      w('edge', 5, { at: 0.45 }),
    ]),
  },
  {
    id: 'brick', name: '墙砖', cluster: '重复',
    params: [
      P('cw', '砖长', 10, 24, 1, 16), P('ch', '砖高', 5, 12, 1, 7),
      P('gap', '砖缝', 0.3, 2, 0.1, 0.9), P('vary', '色差概率', 0, 1, 0.05, 0.4),
    ],
    graph: graph([
      ...baseIn(1),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$ch', alt: 0.5, seed: 2 }),
      n('cs', 'cellShape', undefined, { kind: 'rect', gap: '$gap' }),
      n('hashG', 'repeat', { in: 'hg' }, { cw: '$cw', ch: '$ch', alt: 0.5, seed: 2 }),
      n('hg', 'threshold', { in: 'hash' }, { at: 0.6 }),
      n('hash', 'cellHash'),
      n('varyG', 'mul', { a: 'hashG', b: 'varyK' }),
      n('varyK', 'const', undefined, { v: '$vary' }),
      n('inBrick', 'threshold', { in: 'rep' }, { at: 0 }),
      n('varyM', 'mul', { a: 'varyG', b: 'inBrick' }),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 0.8 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('varyM', 4, { at: 0.25 }),
      w('edge', 4, { at: 0.5 }),
    ]),
  },
  {
    id: 'mech', name: '科幻机甲面板', cluster: '重复',
    params: [
      P('cw', '板宽', 12, 30, 1, 20), P('ch', '板高', 10, 24, 1, 16),
      P('bevel', '倒角', 0, 6, 0.5, 3), P('gap', '板缝', 0.3, 2, 0.1, 0.8),
    ],
    graph: graph([
      ...baseIn(0),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$ch', alt: 0, seed: 4 }),
      n('cs', 'cellShape', undefined, { kind: 'bevelRect', gap: '$gap', bevel: '$bevel' }),
      n('tintG', 'repeat', { in: 'tg' }, { cw: '$cw', ch: '$ch', alt: 0, seed: 4 }),
      n('tg', 'threshold', { in: 'hash' }, { at: 0.55 }),
      n('hash', 'cellHash'),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 1 }),
      // 铆钉：单元四角小圆（距角点距离场）
      n('cu', 'cellU'), n('cv', 'cellV'),
      n('au', 'abs', { in: 'cu' }), n('av', 'abs', { in: 'cv' }),
      n('rivX', 'sub', { a: 'one', b: 'au' }), n('rivY', 'sub', { a: 'one', b: 'av' }),
      n('one', 'const', undefined, { v: 0.78 }),
      n('rivD', 'len', { a: 'rivX', b: 'rivY' }),
      n('riv', 'threshold', { in: 'rivD' }, { at: 0.16 }),
      n('repRiv', 'repeat', { in: 'riv' }, { cw: '$cw', ch: '$ch', alt: 0, seed: 4 }),
    ], [
      w('in', 0, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('tintG', 2, { at: 0.5 }),
      w('edge', 5, { at: 0.45 }),
      w('repRiv', 6, { at: 0.5 }),
    ]),
  },
  {
    id: 'grille', name: '散热格栅', cluster: '重复',
    params: [
      P('f', '栅距', 2.5, 7, 0.5, 4), P('duty', '栅宽占比', 0.3, 0.8, 0.05, 0.55),
      P('frame', '边框宽', 0.5, 3, 0.25, 1.5),
    ],
    graph: graph([
      ...baseIn(0),
      n('slats', 'stripes', undefined, { axis: 'x', f: '$f', duty: '$duty' }),
      n('frameB', 'levelBand', { in: 'sd' }, { level: 0, w: '$frame' }),
      n('sd', 'dist'),
    ], [
      w('in', 0, { at: 0.5 }),
      w('slats', 3, { at: 0.5 }),
      w('frameB', 4, { at: 0.4 }),
    ]),
  },
  {
    id: 'honeycomb', name: '蜂窝', cluster: '重复',
    params: [
      P('cw', '窝宽', 6, 14, 1, 9), P('gap', '壁厚', 0.3, 1.6, 0.1, 0.7),
    ],
    graph: graph([
      ...baseIn(5),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0.5, seed: 5 }),
      n('cs', 'cellShape', undefined, { kind: 'hex', gap: '$gap' }),
      n('deep', 'levelBand', { in: 'rep' }, { level: 2.2, w: 1.6 }),
    ], [
      w('in', 5, { at: 0.5 }),
      w('rep', 2, { at: 0 }),
      w('deep', 3, { at: 0.4 }),
    ]),
  },
  {
    id: 'chainmail', name: '锁子甲', cluster: '重复',
    params: [
      P('cw', '环距', 6, 13, 1, 9), P('th', '环粗', 1, 3, 0.25, 1.8),
    ],
    graph: graph([
      ...baseIn(1),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0.5, seed: 6 }),
      n('cs', 'cellShape', undefined, { kind: 'ring', gap: 0.2, th: '$th' }),
      n('hi', 'levelBand', { in: 'rep' }, { level: 0.4, w: 0.7 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('rep', 4, { at: 0 }),
      w('hi', 6, { at: 0.5 }),
    ]),
  },
  {
    id: 'gear', name: '放射齿纹', cluster: '重复',
    params: [
      P('seg', '齿数', 6, 24, 1, 12), P('arcW', '齿宽', 3, 10, 0.5, 6),
    ],
    graph: graph([
      ...baseIn(2),
      n('pol', 'repeatPolar', { in: 'par' }, { seg: '$seg', arcW: '$arcW', seed: 7 }),
      n('par', 'cellParity'),
      n('pol2', 'repeatPolar', { in: 'cs' }, { seg: '$seg', arcW: '$arcW', seed: 7 }),
      n('cs', 'cellShape', undefined, { kind: 'rect', gap: 0.5 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('pol2', 3, { at: 0 }),
      w('pol', 4, { at: 0.5 }),
    ]),
  },
  {
    id: 'cylinder', name: '圆柱', cluster: '着色',
    params: [P('k', '曲率', 0.6, 2.4, 0.1, 1.2)],
    graph: graph([
      n('cylF', 'cyl', undefined, { k: '$k' }),
    ], [
      { from: 'cylF', slot: 0, bump: { hi: 5, mid: 3, lo: 1 } },
    ]),
  },
  {
    id: 'barrel', name: '木桶', cluster: '着色',
    params: [
      P('hoops', '箍数', 1, 4, 1, 2), P('staves', '板条数', 4, 12, 1, 7),
    ],
    graph: graph([
      n('cylF', 'cyl', undefined, { k: 1.1 }),
      n('hoop', 'stripes', undefined, { axis: 'y', f: 9, duty: 0.16 }),
      n('stave', 'stripes', undefined, { axis: 'x', f: 6, duty: 0.08 }),
    ], [
      { from: 'cylF', slot: 0, bump: { hi: 4, mid: 3, lo: 2 } },
      w('stave', 2, { at: 0.5 }),
      w('hoop', 6, { at: 0.5 }),
    ]),
  },
  {
    id: 'wood', name: '木纹', cluster: '自然',
    params: [
      P('grain', '纹距', 2.5, 6, 0.5, 3.5), P('warp', '扭曲', 0, 6, 0.5, 3),
      P('knots', '结眼密度', 0, 1, 0.1, 0.4),
    ],
    graph: graph([
      ...baseIn(3),
      n('nz', 'noise', undefined, { f: 0.08, seed: 8 }),
      n('bandsF', 'stripes', undefined, { axis: 'y', f: '$grain', duty: 0.32 }),
      n('w1', 'warp', { in: 'bandsF', fx: 'nz', fy: 'nz2' }, { amp: '$warp' }),
      n('nz2', 'noise', undefined, { f: 0.05, seed: 21 }),
      n('ring', 'rings', undefined, { cx: 3, cy: -2, f: 2.2 }),
      n('ringB', 'levelBand', { in: 'ring' }, { level: 0.5, w: 0.3 }),
      n('knotG', 'mul', { a: 'ringB', b: 'knotK' }),
      n('knotK', 'const', undefined, { v: '$knots' }),
    ], [
      w('in', 3, { at: 0.5 }),
      w('w1', 2, { at: 0.5 }),
      w('knotG', 1, { at: 0.3 }),
    ]),
  },
  {
    id: 'canopy', name: '树冠', cluster: '自然',
    params: [
      P('scale', '团大小', 0.03, 0.12, 0.01, 0.06), P('thresh', '团密度', 0.35, 0.65, 0.05, 0.5),
    ],
    graph: graph([
      ...baseIn(1),
      n('bl', 'blob', undefined, { f: '$scale', seed: 9, contrast: 1.2 }),
      n('gate', 'threshold', { in: 'bl' }, { at: '$thresh', soft: 0.08 }),
      n('edgeB', 'levelBand', { in: 'bl' }, { level: '$thresh', w: 0.1 }),
      n('topG', 'grad', undefined, { axis: 'y', flip: 1 }),
      n('topM', 'mul', { a: 'gate', b: 'topG' }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('gate', 3, { at: 0.5 }),
      w('topM', 4, { at: 0.55 }),
      w('edgeB', 5, { at: 0.45 }),
    ]),
  },
  {
    id: 'steel', name: '工业钢板', cluster: '工业',
    params: [
      P('cw', '板宽', 18, 40, 2, 28), P('wear', '磨损', 0, 1, 0.05, 0.45),
      P('rust', '锈斑', 0, 1, 0.05, 0.3),
    ],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 11 }),
      n('cs', 'cellShape', undefined, { kind: 'bevelRect', gap: 0.7, bevel: 1.5 }),
      n('bl', 'blob', undefined, { f: 0.09, seed: 12, contrast: 1.1 }),
      n('rustG0', 'threshold', { in: 'bl' }, { at: 0.62, soft: 0.05 }),
      n('rustG', 'mul', { a: 'rustG0', b: 'rustK' }),
      n('rustK', 'const', undefined, { v: '$rust' }),
      n('scr', 'noise', undefined, { f: 0.6, seed: 13 }),
      n('scrG0', 'threshold', { in: 'scr' }, { at: 0.78 }),
      n('scrG', 'mul', { a: 'scrG0', b: 'wearK' }),
      n('wearK', 'const', undefined, { v: '$wear' }),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 0.9 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('rustG', 1, { at: 0.3 }),
      w('scrG', 4, { at: 0.3 }),
      w('edge', 0, { at: 0.5 }),
    ]),
  },
  {
    id: 'gradY', name: '纵向渐变', cluster: '基础',
    params: [P('flip', '翻转（0=上亮）', 0, 1, 1, 0)],
    graph: graph([
      n('g', 'grad', undefined, { axis: 'y', flip: '$flip' }),
    ], [
      { from: 'g', slot: 0, bump: { hi: 1, mid: 2, lo: 3 } },
    ]),
  },
];

/** 实例化：深克隆图 + 参数取默认值（graph.params） */
export function instantiatePattern(t: PatternTemplate): SurfaceGraph {
  const g = JSON.parse(JSON.stringify(t.graph)) as SurfaceGraph;
  g.params = {};
  for (const p of t.params) g.params[p.key] = p.def;
  return g;
}

export function patternTemplateByName(name: string | undefined): PatternTemplate | undefined {
  return PATTERN_TEMPLATES.find((t) => t.name === name);
}
