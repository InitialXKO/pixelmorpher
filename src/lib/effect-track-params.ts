// ============================================================
// PixelMorpher - 效果轨关键帧参数表（编辑器侧单一口径）
// ============================================================
// 五类覆盖层效果（glow / particle / afterimage / pixel_displace /
// motion_blur）的参数字段集、缺省值与读法，以两端消费端实际读取
// 为准：编辑器 engine/effect-render.ts 的 renderEffectTrackFrame
// 与包内 runtime-template.ts 的 fxRenderSet 逐项同字段、同缺省。
// 建帧播种（store/effect-slice）与关键帧编辑对话框都以本表为
// 准——每个字段都写得进去、读得回来；不存在此表的类型其关键帧
// params 只能恒为 {}、渲染走写死回落（审计 F-05）。
//
// 数值读法与包内 num() 同口径：仅缺失 / null / 非有限才回缺省，
// 0 是有效值原样生效（旧 `Number(p) || 缺省` 会把 0 顶替成缺省，
// 预览与导出不一致——画布修改器侧 numParam 已立此口径，审计
// F-29/E1 要求效果轨侧同修）。颜色读法与包内 `P.color || 缺省`
// 同口径：缺失 / null / 空串才回缺省（旧 `String(p) || 缺省` 对
// 缺失值得到字符串 'undefined'、永不回落）。
//
// text_pop 的事件参数自成一表（lib/text-pop.ts），本模块的
// effectKeyframeDefaultParams / effectKeyframeEditorParams 对
// 六类统一分发，调用方不再按类型分支。

import type { EffectType, ModifierParamValue } from './types';
import { TEXT_POP_DEFAULT_PARAMS } from './text-pop';

export type OverlayEffectType = Exclude<EffectType, 'text_pop'>;

export interface EffectParamFieldDef {
  key: string;
  kind: 'number' | 'color';
  defaultValue: number | string;
}

/** 五类覆盖层效果的参数字段表（顺序 = 对话框编辑顺序）。 */
export const EFFECT_PARAM_FIELDS: Record<OverlayEffectType, EffectParamFieldDef[]> = {
  glow: [
    { key: 'radius', kind: 'number', defaultValue: 3 },
    { key: 'color', kind: 'color', defaultValue: '#ffff00' },
    { key: 'intensity', kind: 'number', defaultValue: 0.5 },
  ],
  particle: [
    { key: 'rate', kind: 'number', defaultValue: 10 },
    { key: 'speed', kind: 'number', defaultValue: 2 },
    { key: 'life', kind: 'number', defaultValue: 10 },
    { key: 'color', kind: 'color', defaultValue: '#ff8800' },
    { key: 'gravity', kind: 'number', defaultValue: 0.5 },
  ],
  afterimage: [
    { key: 'count', kind: 'number', defaultValue: 3 },
    { key: 'opacity', kind: 'number', defaultValue: 0.3 },
    { key: 'spacing', kind: 'number', defaultValue: 5 },
  ],
  pixel_displace: [
    { key: 'intensity', kind: 'number', defaultValue: 2 },
    { key: 'frequency', kind: 'number', defaultValue: 0.1 },
  ],
  motion_blur: [
    { key: 'length', kind: 'number', defaultValue: 5 },
    { key: 'decay', kind: 'number', defaultValue: 0.5 },
  ],
};

type ParamBag = Record<string, ModifierParamValue>;

/** 数值参数读法（与包内 num() 同口径）：缺失/null/非有限才回缺省，0 原样生效。 */
export function numEffectParam(
  params: ParamBag | undefined | null,
  key: string,
  fallback: number,
): number {
  const v = params?.[key];
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 颜色参数读法（与包内 `P.color || 缺省` 同口径）：缺失/null/空串才回缺省。 */
export function colorEffectParam(
  params: ParamBag | undefined | null,
  key: string,
  fallback: string,
): string {
  const v = params?.[key];
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

/** 建帧播种：按轨类型给出全字段缺省 params（每次返回新对象）。 */
export function effectKeyframeDefaultParams(
  type: EffectType | undefined | null,
): ParamBag {
  if (!type) return {};
  if (type === 'text_pop') return { ...TEXT_POP_DEFAULT_PARAMS };
  const fields = EFFECT_PARAM_FIELDS[type as OverlayEffectType];
  if (!fields) return {};
  const out: ParamBag = {};
  for (const f of fields) out[f.key] = f.defaultValue as ModifierParamValue;
  return out;
}

/**
 * 对话框编辑底表：类型缺省垫底 + 关键帧已有值覆盖——全字段都出现
 * 在编辑列表里（含存量 {} 关键帧），已有值（含显式 0）不被缺省顶替。
 */
export function effectKeyframeEditorParams(
  type: EffectType | undefined | null,
  params: ParamBag | undefined | null,
): ParamBag {
  return { ...effectKeyframeDefaultParams(type), ...(params ?? {}) };
}
