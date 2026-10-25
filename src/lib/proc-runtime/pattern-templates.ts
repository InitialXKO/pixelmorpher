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
  /** 子图命名输出（输出名 → 图内节点 id）：被 ref 算子引用时用；
   * 缺省 main = 首条写出的 from（见 graph-expand） */
  outputs?: Record<string, string>;
}

type N = SurfaceGraphNode;
const n = (id: string, op: string, inputs?: Record<string, string>, params?: Record<string, number | string>): N =>
  ({ id, op, inputs, params });
const w = (from: string, slot: number, extra?: Partial<SurfaceGraphWrite>): SurfaceGraphWrite =>
  ({ from, slot, ...extra });
const P = (key: string, label: string, min: number, max: number, step: number, def: number): PatternParamDef =>
  ({ key, label, min, max, step, def });

function graph(
  nodes: N[],
  writes: SurfaceGraphWrite[],
  animation?: { cycleSec: number; frames: number },
): SurfaceGraph {
  return { version: 1, nodes, writes, params: {}, ...(animation ? { animation } : {}) };
}

/** 常用底：形状内全覆盖写出（作 writes[0]） */
const baseIn = (slot: number): N[] => [n('in', 'inside')];

export const PATTERN_TEMPLATES: PatternTemplate[] = [
  {
    id: 'scales', name: '鳞片', cluster: '重复',
    outputs: { main: 'rep', shadow: 'shadowG', edge: 'edge' },
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
    // outputs.main = 扭曲后的纹线场（被 ref 组装时用，如木地板；
    // 缺省 main 会落到首条写出的 in 场 = 常量，组装即退化）
    outputs: { main: 'w1' },
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
  {
    id: 'roof', name: '屋顶平瓦', cluster: '重复',
    params: [
      P('cw', '瓦宽', 8, 16, 1, 11), P('ch', '瓦高', 6, 12, 1, 9), P('gap', '瓦缝', 0.3, 1.5, 0.1, 0.7),
    ],
    graph: graph([
      ...baseIn(1),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$ch', alt: 0.5, seed: 15 }),
      n('cs', 'cellShape', undefined, { kind: 'scallop', gap: '$gap', arc: -0.6 }),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 0.9 }),
      n('cv', 'cellV'),
      n('repCv', 'repeat', { in: 'cv' }, { cw: '$cw', ch: '$ch', alt: 0.5, seed: 15 }),
      n('lip', 'threshold', { in: 'repCv' }, { at: -0.6, soft: 0.2 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('lip', 2, { at: 0.4 }),
      w('edge', 4, { at: 0.5 }),
    ]),
  },
  {
    id: 'grass', name: '草地', cluster: '自然',
    params: [
      P('cw', '草簇距', 3, 7, 0.5, 4.5), P('rough', '粗糙（抖动）', 0, 1, 0.1, 0.6),
    ],
    graph: graph([
      ...baseIn(1),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: 6, alt: 0.5, seed: 16, jit: '$rough', rot: 0.35 }),
      n('cs', 'cellShape', undefined, { kind: 'slat', dir: 'y', th: 1.4, gap: 0.2 }),
      n('tip', 'levelBand', { in: 'rep' }, { level: 1.2, w: 1 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('tip', 5, { at: 0.45 }),
    ]),
  },
  {
    id: 'water', name: '水面', cluster: '自然',
    params: [
      P('f', '波距', 3, 8, 0.5, 5), P('warp', '波纹扭曲', 0, 5, 0.5, 2.5),
    ],
    graph: graph([
      ...baseIn(2),
      n('nz', 'noise', undefined, { f: 0.1, seed: 17 }),
      n('wv', 'stripes', undefined, { axis: 'y', f: '$f', duty: 0.4 }),
      n('ww', 'warp', { in: 'wv', fx: 'nz', fy: 'nz' }, { amp: '$warp' }),
      n('crestB', 'levelBand', { in: 'nz' }, { level: 0.62, w: 0.25 }),
      n('crest', 'mul', { a: 'ww', b: 'crestB' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('ww', 3, { at: 0.5 }),
      w('crest', 0, { at: 0.5, ch: 'glint' }),
    ]),
  },
  {
    id: 'marble', name: '大理石', cluster: '自然',
    params: [
      P('warp', '纹路扭曲', 2, 9, 0.5, 5.5), P('vein', '纹宽', 0.2, 0.6, 0.05, 0.35),
    ],
    graph: graph([
      ...baseIn(5),
      n('nz', 'blob', undefined, { f: 0.05, seed: 18, contrast: 1.4 }),
      n('bandsF', 'stripes', undefined, { axis: 'd', f: 7, duty: 0.5 }),
      n('w1', 'warp', { in: 'bandsF', fx: 'nz', fy: 'nz' }, { amp: '$warp' }),
      n('veinB', 'levelBand', { in: 'w1' }, { level: 0.5, w: '$vein' }),
      n('shade', 'remap', { in: 'nz' }, { lo: 0.3, hi: 0.75 }),
      n('shadeG', 'threshold', { in: 'shade' }, { at: 0.72, soft: 0.1 }),
    ], [
      w('in', 5, { at: 0.5 }),
      w('shadeG', 4, { at: 0.5 }),
      w('veinB', 2, { at: 0.42 }),
    ]),
  },
  {
    id: 'camo', name: '迷彩', cluster: '自然',
    params: [
      P('scale', '斑大小', 0.04, 0.11, 0.01, 0.07),
    ],
    graph: graph([
      ...baseIn(2),
      n('b1', 'blob', undefined, { f: '$scale', seed: 19, contrast: 1.3 }),
      n('g1', 'threshold', { in: 'b1' }, { at: 0.52, soft: 0.06 }),
      n('b2', 'blob', undefined, { f: '$scale', seed: 43, contrast: 1.3 }),
      n('g2', 'threshold', { in: 'b2' }, { at: 0.58, soft: 0.06 }),
      n('b3', 'blob', undefined, { f: '$scale', seed: 71, contrast: 1.2 }),
      n('g3', 'threshold', { in: 'b3' }, { at: 0.64, soft: 0.06 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('g1', 3, { at: 0.5 }),
      w('g2', 4, { at: 0.5 }),
      w('g3', 1, { at: 0.5 }),
    ]),
  },
  {
    id: 'clouds', name: '云层', cluster: '自然',
    params: [
      P('scale', '云团大小', 0.03, 0.09, 0.01, 0.05), P('thresh', '云密度', 0.4, 0.62, 0.02, 0.5),
    ],
    graph: graph([
      ...baseIn(6),
      n('bl', 'blob', undefined, { f: '$scale', seed: 20, contrast: 1.15 }),
      n('gate', 'threshold', { in: 'bl' }, { at: '$thresh', soft: 0.09 }),
      n('botG', 'grad', undefined, { axis: 'y' }),
      n('botM', 'mul', { a: 'gate', b: 'botG' }),
      n('edgeB', 'levelBand', { in: 'bl' }, { level: '$thresh', w: 0.09 }),
    ], [
      w('in', 6, { at: 0.5 }),
      w('gate', 5, { at: 0.5 }),
      w('botM', 4, { at: 0.6 }),
      w('edgeB', 3, { at: 0.4 }),
    ]),
  },
  {
    id: 'rock', name: '岩石', cluster: '自然',
    params: [
      P('f', '岩块大小', 5, 11, 1, 8),
    ],
    graph: graph([
      ...baseIn(3),
      n('vor', 'voronoi', undefined, { f: '$f', seed: 22, mode: 'edge' }),
      n('crack', 'levelBand', { in: 'vor' }, { level: 0, w: 0.8 }),
      n('vorId', 'voronoi', undefined, { f: '$f', seed: 22, mode: 'id' }),
      n('tint', 'threshold', { in: 'vorId' }, { at: 0.5 }),
    ], [
      w('in', 3, { at: 0.5 }),
      w('tint', 2, { at: 0.5 }),
      w('crack', 1, { at: 0.45 }),
    ]),
  },
  {
    id: 'lava', name: '熔岩裂纹', cluster: '自然',
    params: [
      P('f', '裂块大小', 5, 11, 1, 7.5),
    ],
    graph: graph([
      ...baseIn(0),
      n('vor', 'voronoi', undefined, { f: '$f', seed: 23, mode: 'edge' }),
      n('crack', 'levelBand', { in: 'vor' }, { level: 0, w: 1 }),
      n('core', 'levelBand', { in: 'vor' }, { level: 0, w: 0.45 }),
    ], [
      w('in', 0, { at: 0.5 }),
      w('crack', 6, { at: 0.45 }),
      w('core', 0, { at: 0.5, ch: 'glint' }),
    ]),
  },
  {
    id: 'leather', name: '皮革', cluster: '自然',
    params: [
      P('f', '纹孔大小', 3.5, 7, 0.5, 5),
    ],
    graph: graph([
      ...baseIn(3),
      n('vor', 'voronoi', undefined, { f: '$f', seed: 24, mode: 'edge' }),
      n('pore', 'levelBand', { in: 'vor' }, { level: 0, w: 0.55 }),
      n('soft', 'blur', { in: 'pore' }, { r: 0.8 }),
    ], [
      w('in', 3, { at: 0.5 }),
      w('soft', 2, { at: 0.4 }),
    ]),
  },
  {
    id: 'woven', name: '藤编', cluster: '重复',
    params: [
      P('cw', '编距', 3.5, 7, 0.5, 5),
    ],
    graph: graph([
      ...baseIn(2),
      n('sa', 'stripes', undefined, { axis: 'x', f: '$cw', duty: 0.82 }),
      n('sb', 'stripes', undefined, { axis: 'y', f: '$cw', duty: 0.82 }),
      n('wv', 'weave', { a: 'sa', b: 'sb' }, { cw: '$cw', ch: '$cw' }),
      n('wvHi', 'threshold', { in: 'wv' }, { at: 0.9 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('wv', 3, { at: 0.4 }),
      w('wvHi', 4, { at: 0.5 }),
    ]),
  },
  {
    id: 'vine', name: '藤蔓', cluster: '自然',
    params: [
      P('seed', '藤蔓种子', 1, 40, 1, 5), P('w0', '茎粗', 0.8, 2.6, 0.2, 1.5),
    ],
    graph: graph([
      ...baseIn(2),
      n('vn', 'vine', undefined, { seed: '$seed', w0: '$w0', w1: 0.7, step: 3.5, leafEvery: 8 }),
      n('edge', 'levelBand', { in: 'vn' }, { level: 0, w: 0.7 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('vn', 3, { at: 0 }),
      w('edge', 5, { at: 0.45 }),
    ]),
  },
  {
    id: 'medallion', name: '回声徽章', cluster: '着色',
    params: [
      P('seg', '花瓣数', 6, 16, 1, 10), P('echo', '回声权重', 0.3, 1, 0.05, 0.75),
    ],
    graph: graph([
      ...baseIn(1),
      n('pol', 'repeatPolar', { in: 'cs' }, { seg: '$seg', arcW: 7, seed: 26 }),
      n('cs', 'cellShape', undefined, { kind: 'scallop', gap: 0.6 }),
      n('echoed', 'overlay2', { in: 'pol' }, { k: 2.1, w: '$echo' }),
      n('ring', 'focal', undefined, { mode: 'ring', r: 11, w: 1.2 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('echoed', 3, { at: 0 }),
      w('ring', 5, { at: 0.4 }),
    ]),
  },
  // ==========================================================
  // 构件子图（cluster 构件）：小而专的场源，供父模板以 ref
  // 组合（方向甲子图实例化）。每件声明 outputs.main 指向其
  // 场节点；单独应用时也有可读的写出。
  // ==========================================================
  {
    id: 'part-rivets', name: '构件·铆钉阵', cluster: '构件',
    outputs: { main: 'rep' },
    params: [P('cw', '钉距', 10, 30, 1, 16), P('gap', '钉间隙', 0, 9, 0.1, 5.5)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 21 }),
      n('cs', 'cellShape', undefined, { kind: 'circle', gap: '$gap' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 0, { bump: { hi: 5, mid: 3, lo: 2 } }),
    ]),
  },
  {
    id: 'part-holes', name: '构件·孔阵', cluster: '构件',
    outputs: { main: 'rep' },
    params: [P('cw', '孔距', 8, 24, 1, 13), P('gap', '孔间隙', 0, 8, 0.1, 4.5)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 23 }),
      n('cs', 'cellShape', undefined, { kind: 'circle', gap: '$gap' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 0, { bump: { hi: 2, mid: 3, lo: 5 } }),
    ]),
  },
  {
    id: 'part-cracks', name: '构件·裂纹网', cluster: '构件',
    outputs: { main: 'band' },
    params: [P('f', '胞大小', 3, 16, 0.5, 7), P('w', '裂宽', 0.4, 3, 0.1, 1.1)],
    graph: graph([
      ...baseIn(2),
      n('vor', 'voronoi', undefined, { f: '$f', seed: 22, mode: 'edge' }),
      n('band', 'levelBand', { in: 'vor' }, { level: 0, w: '$w' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('band', 4, { at: 0.35 }),
    ]),
  },
  {
    id: 'part-grain', name: '构件·颗粒噪点', cluster: '构件',
    outputs: { main: 'nz' },
    params: [P('f', '频率', 0.2, 1.2, 0.05, 0.65), P('seed', '种子', 0, 99, 1, 5)],
    graph: graph([
      ...baseIn(2),
      n('nz', 'noise', undefined, { f: '$f', seed: '$seed' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('nz', 4, { at: 0.22 }),
    ]),
  },
  {
    id: 'part-wear', name: '构件·边缘磨损', cluster: '构件',
    outputs: { main: 'wearF' },
    params: [P('amt', '磨损量', 0, 1, 0.05, 0.6), P('w', '磨损带宽', 0.5, 5, 0.1, 2)],
    graph: graph([
      ...baseIn(2),
      n('dist', 'dist'),
      n('edge', 'levelBand', { in: 'dist' }, { level: 0, w: '$w' }),
      n('nz', 'noise', undefined, { f: 0.35, seed: 17 }),
      n('gate', 'threshold', { in: 'nz' }, { at: 0.45, soft: 0.1 }),
      n('wear0', 'mul', { a: 'edge', b: 'gate' }),
      n('wearF', 'mul', { a: 'wear0', b: 'amtK' }),
      n('amtK', 'const', undefined, { v: '$amt' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('wearF', 4, { at: 0.35 }),
    ]),
  },
  {
    id: 'part-panel', name: '构件·面板分格', cluster: '构件',
    outputs: { main: 'lines' },
    params: [P('cw', '格宽', 14, 44, 1, 26)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 29 }),
      n('cs', 'cellShape', undefined, { kind: 'rect', gap: 0.5 }),
      n('lines', 'levelBand', { in: 'rep' }, { level: 0, w: 0.8 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0.1 }),
      // 线场在像素中心采样下峰值常 <0.45，阈值 0.15 才画得出（审计实测）
      w('lines', 0, { at: 0.15 }),
    ]),
  },
  {
    id: 'part-diamond', name: '构件·菱格', cluster: '构件',
    outputs: { main: 'rot' },
    params: [P('cw', '格距', 10, 30, 1, 17)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 31 }),
      n('cs', 'cellShape', undefined, { kind: 'rect', gap: 1.1 }),
      n('rot', 'rotate', { in: 'rep' }, { deg: 45 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rot', 3, { at: 0 }),
    ]),
  },
  {
    id: 'part-blob', name: '构件·斑团', cluster: '构件',
    outputs: { main: 'bl' },
    params: [P('f', '团块频率', 0.03, 0.3, 0.01, 0.14), P('seed', '种子', 0, 99, 1, 41)],
    graph: graph([
      ...baseIn(2),
      n('bl', 'blob', undefined, { f: '$f', seed: '$seed', contrast: 0.8 }),
      n('blT', 'threshold', { in: 'bl' }, { at: 0.62, soft: 0.04 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('bl', 3, { at: 0 }),
      w('blT', 5, { at: 0.3 }),
    ]),
  },
  // ==========================================================
  // 组合父模板：以 ref 拼构件 + 本地图合成（展开后自包含）
  // ==========================================================
  {
    id: 'armor', name: '装甲钢板', cluster: '工业',
    params: [
      P('cw', '板宽', 18, 44, 2, 30), P('rust', '锈量', 0, 1, 0.05, 0.35),
    ],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 11 }),
      n('cs', 'cellShape', undefined, { kind: 'bevelRect', gap: 0.7, bevel: 1.5 }),
      n('riv', 'ref', undefined, { ref: 'part-rivets', cw: 18 }),
      n('wear', 'ref', undefined, { ref: 'part-wear' }),
      n('blob', 'ref', undefined, { ref: 'part-blob', seed: 7, f: 0.09 }),
      n('rustT', 'threshold', { in: 'blob' }, { at: 0.6, soft: 0.08 }),
      n('rustG', 'mul', { a: 'rustT', b: 'rustK' }),
      n('rustK', 'const', undefined, { v: '$rust' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('riv', 0, { bump: { hi: 5, mid: 3, lo: 2 } }),
      w('rustG', 1, { at: 0.3 }),
      w('wear', 4, { at: 0.35 }),
    ]),
  },
  {
    id: 'mech-pro', name: '精密机甲板', cluster: '工业',
    params: [P('grain', '颗粒感', 0, 0.4, 0.02, 0.16)],
    graph: graph([
      ...baseIn(2),
      n('lines', 'ref', undefined, { ref: 'part-panel', cw: 24 }),
      n('riv', 'ref', undefined, { ref: 'part-rivets', cw: 16, gap: 5.2 }),
      n('gr', 'ref', undefined, { ref: 'part-grain', seed: 8 }),
      n('grG', 'mul', { a: 'gr', b: 'grK' }),
      n('grK', 'const', undefined, { v: '$grain' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('lines', 0, { at: 0.15 }),
      w('riv', 5, { at: 0.35 }),
      w('grG', 3, { at: 0.1 }),
    ]),
  },
  {
    id: 'stone-floor', name: '石板地砖', cluster: '建筑',
    params: [P('cw', '砖宽', 22, 48, 2, 34), P('crack', '裂纹量', 0, 1, 0.05, 0.5)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 37 }),
      n('cs', 'cellShape', undefined, { kind: 'bevelRect', gap: 1.2, bevel: 2.5 }),
      n('cr', 'ref', undefined, { ref: 'part-cracks', f: 9 }),
      n('crG', 'mul', { a: 'cr', b: 'crK' }),
      n('crK', 'const', undefined, { v: '$crack' }),
      n('gr', 'ref', undefined, { ref: 'part-grain', seed: 3, f: 0.4 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('crG', 4, { at: 0.3 }),
      w('gr', 1, { at: 0.16 }),
    ]),
  },
  {
    id: 'quilt', name: '菱格软包', cluster: '织物',
    params: [P('cw', '格距', 12, 30, 1, 19)],
    graph: graph([
      ...baseIn(2),
      n('dia', 'ref', undefined, { ref: 'part-diamond', cw: '$cw' }),
      n('gr', 'ref', undefined, { ref: 'part-grain', seed: 12, f: 0.5 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('dia', 3, { at: 0 }),
      w('dia', 0, { bump: { hi: 4, mid: 3, lo: 2 } }),
      w('gr', 4, { at: 0.12 }),
    ]),
  },
  // 批次 1 · C 组（Pixel Composer 映射）：木地板 = 木纹 + 面板分格组装
  {
    id: 'wood-floor', name: '木地板', cluster: '建筑',
    params: [P('cw', '板宽', 14, 44, 1, 26), P('grain', '纹距', 2.5, 6, 0.5, 3.5)],
    graph: graph([
      ...baseIn(3),
      n('wd', 'ref', undefined, { ref: 'wood', grain: '$grain', warp: 3, knots: 0.25 }),
      n('pl', 'ref', undefined, { ref: 'part-panel', cw: '$cw' }),
    ], [
      w('in', 3, { at: 0.5 }),
      w('wd', 2, { at: 0.55 }),
      // 分格线场（levelBand）峰值约 0.2–0.4，阈值须压低才画得出
      w('pl', 0, { at: 0.15 }),
    ]),
  },
  // 星空：高频噪声阈值成星点（像素尺度下单像素星即正解），两层亮度
  {
    id: 'starfield', name: '星空', cluster: '自然',
    params: [P('density', '星密度', 0.85, 0.98, 0.01, 0.93), P('seed', '种子', 0, 99, 1, 7)],
    graph: graph([
      ...baseIn(1),
      n('nz1', 'noise', undefined, { f: 0.85, seed: '$seed' }),
      n('st1', 'threshold', { in: 'nz1' }, { at: '$density', soft: 0.02 }),
      n('nz2', 'noise', undefined, { f: 0.45, seed: 31 }),
      n('st2', 'threshold', { in: 'nz2' }, { at: 0.965, soft: 0.02 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('st1', 3, { at: 0.5 }),
      w('st2', 4, { at: 0.55 }),
    ]),
  },
  // 点阵：均匀圆点阵（ tonal 半调需「以场调制单元尺寸」通道，现有算子无此口）
  {
    id: 'dot-matrix', name: '点阵', cluster: '重复',
    params: [P('cw', '点距', 4, 12, 0.5, 6), P('gap', '点径间隙', 0.2, 2.5, 0.1, 0.9)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 5 }),
      n('cs', 'cellShape', undefined, { kind: 'circle', gap: '$gap' }),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 0.7 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0.5 }),
      w('edge', 0, { at: 0.4 }),
    ]),
  },
  // 点阵半调：圆 SDF × 明暗场（归一深度）后定阈值写出——点径随
  // 明暗涨缩（亮处大、暗处灭），不需要新算子，靠图组合实现调制
  {
    id: 'halftone', name: '点阵半调', cluster: '重复',
    params: [P('cw', '点距', 4, 12, 0.5, 6), P('depth', '调制深度', 0, 1, 0.05, 0.85)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 5 }),
      n('cs', 'cellShape', undefined, { kind: 'circle', gap: 0.4 }),
      n('hf', 'h'),
      n('one', 'const', undefined, { v: 1 }),
      n('invh', 'sub', { a: 'one', b: 'hf' }),
      n('dk', 'mul', { a: 'invh', b: 'dkK' }),
      n('dkK', 'const', undefined, { v: '$depth' }),
      n('bright', 'sub', { a: 'one', b: 'dk' }),
      n('gain', 'mul', { a: 'rep', b: 'bright' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('gain', 3, { at: 0.3 }),
      w('gain', 4, { at: 1.1 }),
    ]),
  },
  // 人字纹：repeat 奇偶旋转（(行+列) 奇偶交替转 90°）+ 长条单元
  {
    id: 'herringbone', name: '人字纹', cluster: '织物',
    params: [P('cw', '条长', 8, 20, 1, 12), P('th', '条宽', 1.2, 4.5, 0.2, 2.4)],
    graph: graph([
      ...baseIn(2),
      n('rep', 'repeat', { in: 'cs' }, { cw: '$cw', ch: '$cw', alt: 0, seed: 9, prot: 90 }),
      n('cs', 'cellShape', undefined, { kind: 'slat', dir: 'x', th: '$th', gap: 0.4 }),
      n('edge', 'levelBand', { in: 'rep' }, { level: 0, w: 0.7 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rep', 3, { at: 0 }),
      w('edge', 0, { at: 0.15 }),
    ]),
  },
  // 焦散纹（近似）：双层 Voronoi 边场叠成的网状亮纹，无专用焦散噪声
  {
    id: 'caustics', name: '焦散纹（近似）', cluster: '自然',
    params: [P('scale', '胞大小', 3, 10, 0.5, 5.5), P('seed', '种子', 0, 99, 1, 13)],
    graph: graph([
      ...baseIn(1),
      n('v1', 'voronoi', undefined, { f: '$scale', seed: '$seed', mode: 'edge' }),
      n('v2', 'voronoi', undefined, { f: 7.5, seed: 47, mode: 'edge' }),
      n('web', 'max', { a: 'v1', b: 'v2' }),
      n('glow', 'remap', { in: 'web' }, { lo: 0.35, hi: 1, gamma: 1.6, steps: 0 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('glow', 3, { at: 0.55 }),
      w('v1', 4, { at: 0.5 }),
    ]),
  },
  {
    id: 'vent-pro', name: '重型散热板', cluster: '工业',
    params: [P('cw', '孔距', 9, 20, 1, 13)],
    graph: graph([
      ...baseIn(2),
      n('holes', 'ref', undefined, { ref: 'part-holes', cw: '$cw' }),
      n('lines', 'ref', undefined, { ref: 'part-panel', cw: 30 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('holes', 3, { at: 0 }),
      w('holes', 0, { bump: { hi: 2, mid: 3, lo: 5 } }),
      w('lines', 4, { at: 0.3 }),
    ]),
  },
  {
    id: 'rune-stone', name: '符文石碑', cluster: '自然',
    params: [P('r', '符环半径', 6, 18, 0.5, 11)],
    graph: graph([
      ...baseIn(2),
      n('bl', 'blob', undefined, { f: 0.05, seed: 31, contrast: 1.2 }),
      n('rock', 'remap', { in: 'bl' }, { lo: 0.25, hi: 0.75 }),
      n('ring', 'focal', undefined, { mode: 'ring', r: '$r', w: 1.1 }),
      n('cr', 'ref', undefined, { ref: 'part-cracks', f: 12, w: 0.7 }),
      n('wear', 'ref', undefined, { ref: 'part-wear', amt: 0.4 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rock', 3, { at: 0 }),
      w('ring', 5, { at: 0.4 }),
      w('cr', 4, { at: 0.25 }),
      w('wear', 1, { at: 0.2 }),
    ]),
  },
  {
    id: 'camo-urban', name: '都市迷彩', cluster: '自然',
    params: [P('scale', '团块尺度', 0.5, 2, 0.1, 1)],
    graph: graph([
      ...baseIn(2),
      n('b1', 'ref', undefined, { ref: 'part-blob', seed: 41, f: 0.09 }),
      n('b2', 'ref', undefined, { ref: 'part-blob', seed: 97, f: 0.11 }),
      n('t1', 'threshold', { in: 'b1' }, { at: 0.55, soft: 0.03 }),
      n('t2', 'threshold', { in: 'b2' }, { at: 0.6, soft: 0.03 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('t1', 3, { at: 0 }),
      w('t2', 1, { at: 0.15 }),
    ]),
  },
  {
    id: 'carbon', name: '碳纤维编织', cluster: '工业',
    params: [P('f', '编织密度', 2, 9, 0.5, 4.5)],
    graph: graph([
      ...baseIn(2),
      n('sa', 'stripes', undefined, { axis: 'x', f: '$f', duty: 0.82 }),
      n('sb', 'stripes', undefined, { axis: 'y', f: '$f', duty: 0.82 }),
      n('wv', 'weave', { a: 'sa', b: 'sb' }, { cw: '$f', ch: '$f' }),
      n('gr', 'ref', undefined, { ref: 'part-grain', seed: 19, f: 0.9 }),
      n('grG', 'mul', { a: 'gr', b: 'grK' }),
      n('grK', 'const', undefined, { v: 0.1 }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('wv', 3, { at: 0 }),
      w('wv', 0, { bump: { hi: 4, mid: 3, lo: 2 } }),
      w('grG', 4, { at: 0.08 }),
    ]),
  },
  // ---- 动态表面（D1）：图带 animation 规格，相位经 $phase/$phaseDeg 注入。
  // 无缝口径：条纹 ph 吃 $phase（每圈滑一整周期）、rotate 吃 $phaseDeg
  // （转满 360° 恒等），循环点逐像素无跳变；溶解为阈值扫过全程、
  // 圈末复原（溶解类效果的固有口径）。
  {
    id: 'flow-water', name: '流动水面', cluster: '动态',
    params: [
      P('f', '波距', 3, 8, 0.5, 5), P('warp', '波纹扭曲', 0, 5, 0.5, 2.5),
    ],
    graph: graph([
      ...baseIn(2),
      n('nz', 'noise', undefined, { f: 0.1, seed: 17 }),
      n('wv', 'stripes', undefined, { axis: 'y', f: '$f', duty: 0.4, ph: '$phase' }),
      n('ww', 'warp', { in: 'wv', fx: 'nz', fy: 'nz' }, { amp: '$warp' }),
      n('crestB', 'levelBand', { in: 'nz' }, { level: 0.62, w: 0.25 }),
      n('crest', 'mul', { a: 'ww', b: 'crestB' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('ww', 3, { at: 0.5 }),
      w('crest', 0, { at: 0.5, ch: 'glint' }),
    ], { cycleSec: 2.4, frames: 12 }),
  },
  {
    id: 'flame-tex', name: '火焰纹理', cluster: '动态',
    params: [
      P('f', '焰带距', 3, 9, 0.5, 5.5), P('warp', '焰形扭曲', 0, 6, 0.5, 3.5),
    ],
    graph: graph([
      ...baseIn(1),
      n('nz', 'blob', undefined, { f: 0.09, seed: 23, contrast: 1.3 }),
      n('bands', 'stripes', undefined, { axis: 'y', f: '$f', duty: 0.55, ph: '$phase' }),
      n('ww', 'warp', { in: 'bands', fx: 'nz', fy: 'nz' }, { amp: '$warp' }),
      n('shade', 'grad', undefined, { axis: 'y' }),
      n('hot', 'mul', { a: 'ww', b: 'shade' }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('ww', 4, { at: 0.5 }),
      w('hot', 5, { at: 0.35 }),
      w('hot', 0, { at: 0.65, ch: 'glint' }),
    ], { cycleSec: 1.6, frames: 12 }),
  },
  {
    id: 'aurora-tex', name: '极光带', cluster: '动态',
    params: [
      P('f', '光带距', 4, 12, 0.5, 7), P('warp', '飘移扭曲', 0, 7, 0.5, 4),
    ],
    graph: graph([
      ...baseIn(1),
      n('nz', 'blob', undefined, { f: 0.06, seed: 29, contrast: 1.2 }),
      n('bands', 'stripes', undefined, { axis: 'x', f: '$f', duty: 0.45, ph: '$phase' }),
      n('ww', 'warp', { in: 'bands', fx: 'nz', fy: 'nz' }, { amp: '$warp' }),
      n('gv', 'grad', undefined, { axis: 'y' }),
      n('gate', 'levelBand', { in: 'gv' }, { level: 0.5, w: 0.85 }),
      n('body', 'mul', { a: 'ww', b: 'gate' }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('body', 4, { at: 0.5 }),
      w('body', 0, { at: 0.75, ch: 'glint' }),
    ], { cycleSec: 5, frames: 20 }),
  },
  {
    id: 'swirl-rune', name: '旋转法阵', cluster: '动态',
    params: [
      P('seg', '扇区数', 4, 24, 1, 10), P('arcW', '弧宽', 3, 12, 0.5, 6),
    ],
    graph: graph([
      ...baseIn(2),
      n('rp', 'repeatPolar', { in: 'cs' }, { seg: '$seg', arcW: '$arcW', r0: 2, seed: 31 }),
      n('cs', 'cellShape', undefined, { kind: 'ring', gap: 0.3, th: 2.2 }),
      n('rot', 'rotate', { in: 'rp' }, { deg: '$phaseDeg' }),
      n('core', 'focal', undefined, { cx: 0, cy: 0, r: 5, w: 1.2, mode: 'ring' }),
    ], [
      w('in', 2, { at: 0.5 }),
      w('rot', 4, { at: 0 }),
      w('core', 0, { at: 0.45, ch: 'glint' }),
    ], { cycleSec: 6, frames: 24 }),
  },
  {
    id: 'dissolve-tex', name: '溶解纹理', cluster: '动态',
    params: [
      P('scale', '蚀斑大小', 0.04, 0.14, 0.01, 0.08),
    ],
    graph: graph([
      ...baseIn(1),
      n('bl', 'blob', undefined, { f: '$scale', seed: 37, contrast: 1.35 }),
      n('body', 'threshold', { in: 'bl' }, { at: '$phase', soft: 0.05 }),
      n('edge', 'levelBand', { in: 'bl' }, { level: '$phase', w: 0.14 }),
      n('ash', 'threshold', { in: 'bl' }, { at: 0.8, soft: 0.05 }),
    ], [
      w('in', 1, { at: 0.5 }),
      w('body', 3, { at: 0.5 }),
      w('ash', 4, { at: 0.5 }),
      w('edge', 5, { at: 0.4 }),
    ], { cycleSec: 3, frames: 16 }),
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
