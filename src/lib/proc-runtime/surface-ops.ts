// ============================================================
// 表面 DAG 算子规格表（模式编辑器方言）：与 bake-src 求值器的
// op 集合对齐（探针 H7 校验）。分类借亚历山大十五属性组织：
// 场源 / 组合 / 作用域（坐标修饰）/ 参数暴露在编辑器侧完成。
// ============================================================

import type { SurfaceGraphNode } from '../unified-types';

export interface OpParamSpec {
  key: string;
  label: string;
  def: number | string;
  min?: number;
  max?: number;
  step?: number;
  /** 给定则渲染为下拉（字符串参数，如 kind/axis/mode） */
  enum?: string[];
}

export interface OpSpec {
  op: string;
  label: string;
  cat: '场源' | '单元' | '组合' | '作用域' | '生成';
  /** 输入口名（顺序即编辑器展示序）；作用域算子的 in/b 为子图口 */
  ports: string[];
  /** 是否坐标修饰（作用域框语义，编辑器以缩进+紫框呈现） */
  scope?: boolean;
  params: OpParamSpec[];
}

const num = (key: string, label: string, def: number, min = -99, max = 99, step = 0.5): OpParamSpec =>
  ({ key, label, def, min, max, step });
const en = (key: string, label: string, def: string, options: string[]): OpParamSpec =>
  ({ key, label, def, enum: options });

export const SURFACE_OP_SPECS: OpSpec[] = [
  // ---- 场源（叶） ----
  { op: 'const', label: '常数', cat: '场源', ports: [], params: [num('v', '值', 1, -9, 9, 0.05)] },
  { op: 'inside', label: '形状内', cat: '场源', ports: [], params: [] },
  { op: 'dist', label: '带符号距离', cat: '场源', ports: [], params: [] },
  { op: 'h', label: '归一深度', cat: '场源', ports: [], params: [] },
  { op: 'u01', label: '横坐标 0..1', cat: '场源', ports: [], params: [] },
  { op: 'v01', label: '纵坐标 0..1', cat: '场源', ports: [], params: [] },
  { op: 'px', label: '横坐标 px', cat: '场源', ports: [], params: [] },
  { op: 'py', label: '纵坐标 px', cat: '场源', ports: [], params: [] },
  { op: 'facing', label: '朝向光', cat: '场源', ports: [], params: [num('deg', '角度', -45, -180, 180, 5)] },
  { op: 'noise', label: '值噪声', cat: '场源', ports: [], params: [num('f', '频率', 0.25, 0.01, 1.5, 0.01), num('seed', '种子', 0, 0, 99, 1)] },
  { op: 'blob', label: '团块噪声', cat: '场源', ports: [], params: [num('f', '频率', 0.06, 0.005, 0.4, 0.005), num('seed', '种子', 0, 0, 99, 1), num('contrast', '对比', 1.2, 0.2, 3, 0.1)] },
  { op: 'stripes', label: '条纹', cat: '场源', ports: [], params: [en('axis', '轴', 'y', ['x', 'y', 'd']), num('f', '周期', 4, 0.5, 30, 0.5), num('duty', '占空', 0.5, 0, 1, 0.05), num('ph', '相位', 0, 0, 1, 0.05)] },
  { op: 'checker', label: '棋盘', cat: '场源', ports: [], params: [num('cw', '格宽', 4, 1, 30, 0.5), num('ch', '格高', 4, 1, 30, 0.5)] },
  { op: 'grad', label: '线性渐变', cat: '场源', ports: [], params: [en('axis', '轴', 'y', ['x', 'y']), num('flip', '翻转', 0, 0, 1, 1)] },
  { op: 'cyl', label: '柱面渐变', cat: '场源', ports: [], params: [num('k', '曲率', 1.2, 0.1, 4, 0.1)] },
  { op: 'rings', label: '同心环', cat: '场源', ports: [], params: [num('cx', '心 x', 0, -60, 60, 1), num('cy', '心 y', 0, -60, 60, 1), num('f', '环距', 5, 0.5, 30, 0.5)] },
  { op: 'voronoi', label: 'Voronoi', cat: '场源', ports: [], params: [num('f', '胞大小', 6, 1.5, 30, 0.5), num('seed', '种子', 0, 0, 99, 1), en('mode', '模式', 'edge', ['edge', 'id'])] },
  { op: 'focal', label: '焦点场（强中心）', cat: '场源', ports: [], params: [num('cx', '心 x', 0, -60, 60, 1), num('cy', '心 y', 0, -60, 60, 1), num('r', '半径', 8, 0.5, 60, 0.5), num('w', '环宽', 1.5, 0.3, 10, 0.25), en('mode', '模式', 'spot', ['spot', 'ring'])] },
  { op: 'voidF', label: '留白场（虚空）', cat: '场源', ports: [], params: [num('cx', '心 x', 0, -60, 60, 1), num('cy', '心 y', 0, -60, 60, 1), num('r', '半径', 8, 0, 60, 0.5), num('soft', '软边', 3, 0.5, 20, 0.5)] },
  { op: 'edgeProx', label: '边界邻近（边界）', cat: '场源', ports: [], params: [num('w', '带宽', 3, 0.3, 20, 0.25)] },
  // ---- 单元（repeat 作用域内） ----
  { op: 'cellU', label: '单元横位', cat: '单元', ports: [], params: [] },
  { op: 'cellV', label: '单元纵位', cat: '单元', ports: [], params: [] },
  { op: 'cellHash', label: '单元哈希', cat: '单元', ports: [], params: [] },
  { op: 'cellRand', label: '单元哈希 2', cat: '单元', ports: [], params: [] },
  { op: 'cellParity', label: '单元奇偶', cat: '单元', ports: [], params: [] },
  {
    op: 'cellShape', label: '单元形状', cat: '单元', ports: [],
    params: [
      en('kind', '形状', 'rect', ['rect', 'bevelRect', 'circle', 'ring', 'hex', 'slat', 'scallop']),
      num('gap', '间隙', 0.4, 0, 4, 0.1), num('bevel', '倒角', 2, 0, 12, 0.5),
      num('th', '粗细', 1.8, 0.6, 8, 0.2), num('arc', '弧度', 0, -1, 1, 0.1),
      en('dir', '方向', 'y', ['x', 'y']),
    ],
  },
  // ---- 生成 ----
  {
    op: 'vine', label: '藤蔓路径（生成）', cat: '生成', ports: [],
    params: [num('seed', '种子', 3, 0, 99, 1), num('step', '步长', 3.5, 1, 10, 0.5), num('leafEvery', '叶距', 8, 2, 30, 1), num('w0', '根粗', 1.5, 0.3, 5, 0.1), num('w1', '梢细', 0.7, 0.1, 3, 0.1)],
  },
  // ---- 组合 ----
  { op: 'add', label: '加', cat: '组合', ports: ['a', 'b'], params: [] },
  { op: 'sub', label: '减', cat: '组合', ports: ['a', 'b'], params: [] },
  { op: 'mul', label: '乘', cat: '组合', ports: ['a', 'b'], params: [] },
  { op: 'min', label: '取小', cat: '组合', ports: ['a', 'b'], params: [] },
  { op: 'max', label: '取大', cat: '组合', ports: ['a', 'b'], params: [] },
  { op: 'len', label: '向量长度', cat: '组合', ports: ['a', 'b'], params: [] },
  { op: 'invert', label: '反相', cat: '组合', ports: ['in'], params: [] },
  { op: 'abs', label: '绝对值', cat: '组合', ports: ['in'], params: [] },
  { op: 'clamp', label: '钳制', cat: '组合', ports: ['in'], params: [num('lo', '下限', 0, -9, 9, 0.05), num('hi', '上限', 1, -9, 9, 0.05)] },
  { op: 'mix', label: '混合', cat: '组合', ports: ['a', 'b', 't'], params: [] },
  { op: 'threshold', label: '阈值', cat: '组合', ports: ['in'], params: [num('at', '阈值', 0.5, -9, 9, 0.05), num('soft', '软边', 0, 0, 2, 0.05)] },
  { op: 'levelBand', label: '等值带（取边）', cat: '组合', ports: ['in'], params: [num('level', '等值', 0, -9, 9, 0.25), num('w', '带宽', 1, 0.05, 10, 0.1)] },
  { op: 'remap', label: '重映射（对比）', cat: '组合', ports: ['in'], params: [num('lo', '低', 0, -2, 2, 0.05), num('hi', '高', 1, -2, 3, 0.05), num('gamma', '伽马', 1, 0.05, 4, 0.05), num('steps', '阶梯（0=关）', 0, 0, 9, 1)] },
  { op: 'weave', label: '编织交锁', cat: '组合', ports: ['a', 'b'], params: [num('cw', '编宽', 5, 1, 30, 0.5), num('ch', '编高', 5, 1, 30, 0.5)] },
  // ---- 作用域（坐标修饰） ----
  {
    op: 'repeat', label: '重复（作用域）', cat: '作用域', ports: ['in', 'b'], scope: true,
    params: [num('cw', '单元宽', 10, 1, 60, 0.5), num('ch', '单元高', 8, 1, 60, 0.5), num('alt', '交替偏移', 0, 0, 1, 0.05), num('seed', '种子', 0, 0, 99, 1), num('jit', '抖动', 0, 0, 5, 0.1), num('rot', '旋转抖动', 0, 0, 1.5, 0.05)],
  },
  {
    op: 'repeatPolar', label: '极坐标重复（作用域）', cat: '作用域', ports: ['in'], scope: true,
    params: [num('seg', '扇区数', 10, 2, 48, 1), num('arcW', '弧宽', 6, 1, 30, 0.5), num('r0', '内径', 0, 0, 60, 0.5), num('seed', '种子', 0, 0, 99, 1)],
  },
  {
    op: 'warp', label: '扭曲（作用域）', cat: '作用域', ports: ['in', 'fx', 'fy'], scope: true,
    params: [num('amp', '幅度', 3, 0, 15, 0.25)],
  },
  {
    op: 'mirror', label: '镜像折叠（作用域）', cat: '作用域', ports: ['in'], scope: true,
    params: [en('axis', '轴', 'x', ['x', 'y']), num('at', '折线', 0, -60, 60, 0.5)],
  },
  {
    op: 'rotate', label: '旋转（作用域）', cat: '作用域', ports: ['in'], scope: true,
    params: [num('deg', '角度', 45, -180, 180, 1)],
  },
  {
    op: 'overlay2', label: '自我叠印·回声（作用域）', cat: '作用域', ports: ['in'], scope: true,
    params: [num('k', '缩放', 2.2, 1.05, 6, 0.05), num('w', '回声权重', 0.8, 0, 1.5, 0.05)],
  },
  { op: 'blur', label: '平滑', cat: '作用域', ports: ['in'], scope: true, params: [num('r', '半径', 1, 0.4, 4, 0.2)] },
  { op: 'fadeEdge', label: '边缘溶入', cat: '作用域', ports: ['in'], scope: true, params: [num('w', '溶宽', 2, 0.2, 12, 0.25)] },
];

export const SURFACE_OP_SPEC_MAP = new Map(SURFACE_OP_SPECS.map((s) => [s.op, s]));
export const SURFACE_OP_CATS = [...new Set(SURFACE_OP_SPECS.map((s) => s.cat))];

export function createSurfaceNode(op: string, id: string): SurfaceGraphNode {
  const spec = SURFACE_OP_SPEC_MAP.get(op);
  const params: Record<string, number | string> = {};
  for (const p of spec?.params ?? []) params[p.key] = p.def;
  return { id, op, inputs: {}, params };
}

let nodeSeq = 0;
export function nextSurfaceNodeId(existing: Set<string>): string {
  let id = '';
  do {
    nodeSeq += 1;
    id = `n${nodeSeq}`;
  } while (existing.has(id));
  return id;
}

// ---- v2 画布自动布局：按拓扑深度分列；作用域子图递归排进框内 ----
export interface SurfaceLayout {
  pos: Record<string, { x: number; y: number }>;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

export const SURFACE_NODE_W = 164;
export const SURFACE_NODE_H = 62;

export function surfaceScopeParentMap(graph: { nodes: SurfaceGraphNode[] }): Map<string, string> {
  const parent = new Map<string, string>();
  for (const nd of graph.nodes) {
    const spec = SURFACE_OP_SPEC_MAP.get(nd.op);
    if (!spec?.scope) continue;
    for (const port of spec.ports) {
      const child = nd.inputs?.[port];
      if (child) parent.set(child, nd.id);
    }
  }
  return parent;
}

export function computeSurfaceLayout(graph: { nodes: SurfaceGraphNode[] }): SurfaceLayout {
  const byId = new Map(graph.nodes.map((x) => [x.id, x]));
  const scopeParent = surfaceScopeParentMap(graph);
  const childrenOf = new Map<string, string[]>();
  for (const [child, p] of scopeParent) {
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(child);
  }
  // 拓扑深度（全部输入边，含作用域子图边；环保护）
  const depthMemo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const nd = byId.get(id);
    let d = 0;
    for (const t of Object.values(nd?.inputs ?? {})) d = Math.max(d, depth(t, seen) + 1);
    depthMemo.set(id, d);
    return d;
  };

  const pos: Record<string, { x: number; y: number }> = {};
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};

  // 在 (x, y) 处放一个节点；若是作用域节点，递归把子图排进框内并回填框矩形。返回占位高。
  const place = (id: string, x: number, y: number): number => {
    pos[id] = { x, y };
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return SURFACE_NODE_H;
    kids.forEach((kid, i) => {
      const colX = x + 12 + (i % 2) * (SURFACE_NODE_W + 10);
      const rowY = y + 30 + Math.floor(i / 2) * (SURFACE_NODE_H + 10);
      place(kid, colX, rowY);
    });
    const rows = Math.ceil(kids.length / 2);
    const fw = Math.max(SURFACE_NODE_W + 24, (Math.min(2, kids.length)) * (SURFACE_NODE_W + 10) + 14);
    const fh = 30 + rows * (SURFACE_NODE_H + 10) + 6;
    frames[id] = { x, y, w: fw, h: fh };
    return fh;
  };

  // 主集合（无作用域父）按深度分列，列内纵向堆叠（作用域节点按框高占位）
  const mains = graph.nodes.filter((x) => !scopeParent.has(x.id)).map((x) => x.id);
  const byDepth = new Map<number, string[]>();
  for (const id of mains) {
    const d = depth(id, new Set());
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }
  for (const [d, colIds] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    let y = 36;
    for (const id of colIds) {
      const h = place(id, 36 + d * 216, y);
      y += h + 14;
    }
  }
  // 兜底：任何未放置节点（环等）堆到右侧
  let fx = 36 + (Math.max(0, ...[...byDepth.keys()]) + 1) * 216;
  let fy = 36;
  for (const nd of graph.nodes) {
    if (!pos[nd.id]) {
      pos[nd.id] = { x: fx, y: fy };
      fy += SURFACE_NODE_H + 14;
    }
  }
  return { pos, frames };
}
