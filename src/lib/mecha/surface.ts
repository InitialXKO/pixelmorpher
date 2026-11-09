// 表面材质集成层：把模式库的表面模板（pattern-templates）按
// 精灵剪影烘焙成绩位图，再按档位倍率贴回精灵颜色。
//
// 档位语义与运行时调色板同序：0 描边 / 1 暗 / 2 本 / 3 亮 /
// 4 高光 / 5 强调（强亮）/ 6 次强调（压暗）。2 = 本调 ×1.0
// 不动原色；其余档按与本调的明暗关系给倍率。glint（闪光）
// 像素在档位倍率之外再提亮。
//
// 调用分层：材质条目钉模板名 + 参数 → 本层烘焙贴图；分格
// 不归材质（部件自有缝模式），铆钉由模板内的铆钉模式沿边
// 生成（part-rivets），本层不另画。
import { createSurfaceBaker } from '../proc-runtime/bake-src';
import { PATTERN_TEMPLATES, instantiatePattern } from '../proc-runtime/pattern-templates';
import { expandSurfaceGraph, graphHasRefs, subgraphLibraryOf } from '../proc-runtime/graph-expand';
import type { MechaSpriteData } from './parts';

export interface SurfaceChoice {
  /** pattern-templates 的模板 id（如 'mech-pro' / 'steel'） */
  template: string;
  /** 模板参数覆盖（键 = 模板参数 id） */
  params?: Record<string, number>;
}

/** 档位 → 颜色倍率（2 = 本调不动） */
export const SURFACE_SLOT_MULT = [0.62, 0.82, 1.0, 1.16, 1.34, 1.5, 0.72];
/** 闪光像素的额外提亮 */
export const SURFACE_GLINT_MULT = 1.3;

const baker = createSurfaceBaker();
const graphCache = new Map<string, ReturnType<typeof instantiatePattern>>();

function graphFor(choice: SurfaceChoice) {
  const key = choice.template + '|' + JSON.stringify(choice.params ?? {});
  let g = graphCache.get(key);
  if (g) return g;
  const t = PATTERN_TEMPLATES.find((x) => x.id === choice.template);
  if (!t) return null;
  g = instantiatePattern(t);
  if (choice.params) for (const [k, v] of Object.entries(choice.params)) g.params[k] = v;
  if (graphHasRefs(g)) g = expandSurfaceGraph(g, subgraphLibraryOf(PATTERN_TEMPLATES)).graph;
  graphCache.set(key, g);
  return g;
}

/** 把表面材质贴到精灵上（原地改 rgba，返回同一精灵）。 */
export function applySurface(spr: MechaSpriteData, choice: SurfaceChoice): MechaSpriteData {
  const g = graphFor(choice);
  if (!g) return spr;
  const { width: w, height: h, rgba } = spr;
  const solid = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) solid[p] = rgba[p * 4 + 3] > 0 ? 1 : 0;
  const out = baker.compileTileDAGRaster(
    { w, h, plugX: spr.plug?.x ?? w / 2, plugY: spr.plug?.y ?? h / 2, solid }, g, 0);
  // 烘焙输出坐标（源头注释与产品消费方 main-canvas 同口径）：
  // 输出 = 原图四周 pad M=2px、且内部上下翻转过——精灵像素
  // (x, y) 对应输出 (x + M, M + (h − 1 − y))。cx/cy 是输出
  // 网格中心、不是 plug，别拿来做偏移。
  const M = 2;
  // glint 通道只在图里真有 glint 写出时有效；没有时 G 恒
  // 255 是「无闪光信息」的哨兵值，不能当闪光读。
  const hasGlint = g.writes.some((wr) => (wr as { ch?: string }).ch === 'glint');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      if (rgba[si + 3] === 0) continue;
      const oi = ((M + (h - 1 - y)) * out.w + (x + M)) * 4;
      const slot = out.data[oi];
      if (slot >= 128) continue; // 254/255 = 轮廓外编码
      let m = SURFACE_SLOT_MULT[slot] ?? 1;
      if (hasGlint && out.data[oi + 1] > 0) m *= SURFACE_GLINT_MULT;
      if (m === 1) continue;
      rgba[si] = Math.min(255, rgba[si] * m);
      rgba[si + 1] = Math.min(255, rgba[si + 1] * m);
      rgba[si + 2] = Math.min(255, rgba[si + 2] * m);
    }
  }
  return spr;
}
