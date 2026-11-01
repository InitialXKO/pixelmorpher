// ============================================================
// 飘字（text pop）：位图字 + 弹出包络的共享核心
//
// pixelfx 的 ui 类效果（伤害数字/暴击字/连击计数）分流归运行时包
// 界面层：本模块是编辑器预览与包内播放共用的同一套语义——
// 5×7 点阵字表、包络函数（砸入过冲 → 升起 → 淡出）、文字度量与
// 光栅化（逐字落点）。包内 runtime-template.ts 里有一份逐式对应
// 的 JS 孪生（FX_TEXT_POP_*），探针 verify-ui-text 逐值对拍。
//
// 字形说明：5×7 点阵是通用点阵字规范（老式点阵屏/LCD 字形惯例），
// 本表字形按该规范逐字自绘、行位串编码为本仓自有格式；未使用
// pixelfx 的字体数据（其 Patch Pixel 字体不在 MIT 授权范围内）。
// ============================================================

import type { ModifierParamValue } from './types';

/** 字形宽/高（字形像素）与字距（前进量 = 宽 + 1 间隔） */
export const TEXT_POP_FONT_W = 5;
export const TEXT_POP_FONT_H = 7;
export const TEXT_POP_ADVANCE = 6;

/**
 * 字表：每字形 7 行 × 5 列，'1' 为墨点。自绘字形，见文件头说明。
 * 空格为全空字形（仍占一个前进量）。
 */
export const TEXT_POP_GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01101'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '+': ['00000', '00100', '00100', '01110', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '*': ['00000', '10101', '01110', '10101', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/** 取字形：小写归大写，未知字符回落 '?'。 */
export function textPopGlyph(ch: string): string[] {
  return (
    TEXT_POP_GLYPHS[ch] ??
    TEXT_POP_GLYPHS[ch.toUpperCase()] ??
    TEXT_POP_GLYPHS['?']!
  );
}

/** 文字宽度（字形像素单位）：每字 ADVANCE，末字不带间隔。空串为 0。 */
export function measureTextPopUnits(text: string): number {
  if (!text) return 0;
  return text.length * TEXT_POP_ADVANCE - 1;
}

/**
 * 光栅化：返回整串文字的全部墨点（字形像素坐标，x 向右、y 向下，
 * 原点在文字块左上角）。渲染端按 fontPixel 缩放并平移到锚点即可。
 */
export function rasterTextPop(text: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let cx = 0;
  for (const ch of text) {
    const glyph = textPopGlyph(ch);
    for (let row = 0; row < TEXT_POP_FONT_H; row++) {
      const line = glyph[row]!;
      for (let col = 0; col < TEXT_POP_FONT_W; col++) {
        if (line[col] === '1') pts.push({ x: cx + col, y: row });
      }
    }
    cx += TEXT_POP_ADVANCE;
  }
  return pts;
}

// ---- 包络 ----

export interface TextPopEnvelopeOptions {
  /** 总时长（秒） */
  durationSec: number;
  /** 总升起距离（画布 px，向上） */
  risePx: number;
  /** 砸入过冲开关：开 = 大幅过冲（暴击字），关 = 小幅弹入 */
  slam: boolean;
}

export interface TextPopEnvelope {
  active: boolean;
  /** 字号倍率（1 = 参数 scale 本身） */
  scaleMul: number;
  /** 已升起距离（px，向上为正） */
  riseNow: number;
  /** 不透明度 0..1 */
  alpha: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 飘字包络（与 pixelfx damage-number 同族：砸入 → 升起 → 淡出）。
 * t = 事件开始后的秒数。关键点（探针锁死）：
 * - t<0 或 t>=duration：inactive。
 * - 砸入段 ts = min(slam?0.14:0.07, duration×0.5)：scaleMul 由
 *   1+amp（amp = slam?1.1:0.35）按 (1-u)^3 衰减到 1，u = t/ts。
 * - 升起：risePx × easeOutQuad(min(t/(duration×0.7),1))，70% 时程升满。
 * - alpha：0.03s 内淡入（极短，近似瞬间出现），60% 时程前保持 1，
 *   其后线性淡出到 duration 末为 0。
 */
export function textPopEnvelope(
  tSec: number,
  opts: TextPopEnvelopeOptions,
): TextPopEnvelope {
  const duration = Math.max(0.01, opts.durationSec || 0);
  if (!(tSec >= 0) || tSec >= duration) {
    return { active: false, scaleMul: 1, riseNow: 0, alpha: 0 };
  }
  const amp = opts.slam ? 1.1 : 0.35;
  const ts = Math.min(opts.slam ? 0.14 : 0.07, duration * 0.5);
  const u = clamp01(tSec / ts);
  const scaleMul = 1 + amp * Math.pow(1 - u, 3);
  const r = clamp01(tSec / (duration * 0.7));
  const riseNow = (opts.risePx || 0) * (1 - (1 - r) * (1 - r));
  const fadeInDur = Math.min(0.03, duration * 0.1);
  const fadeIn = fadeInDur > 0 ? clamp01(tSec / fadeInDur) : 1;
  const fadeOutStart = duration * 0.6;
  const fadeOut =
    tSec <= fadeOutStart
      ? 1
      : 1 - (tSec - fadeOutStart) / (duration - fadeOutStart);
  return {
    active: true,
    scaleMul,
    riseNow,
    alpha: clamp01(fadeIn * fadeOut),
  };
}

// ---- 事件参数 ----

/** 飘字事件（= text_pop 轨道上的一个关键帧的 params）的规范形态。 */
export interface TextPopEvent {
  text: string;
  /** 锚点：char = 角色中心偏移（y 向上）；canvas = 画布像素坐标（y 向下，与笔触点同口径） */
  anchor: 'char' | 'canvas';
  x: number;
  y: number;
  color: string;
  /** 一个字形像素的边长（画布 px，未乘包络倍率） */
  scale: number;
  risePx: number;
  durationSec: number;
  slam: boolean;
}

/** 新建事件的缺省参数（以 params 袋形态存进关键帧）。 */
export const TEXT_POP_DEFAULT_PARAMS: Record<string, ModifierParamValue> = {
  text: '100',
  anchor: 'char',
  x: 0,
  y: 24,
  color: '#ffffff',
  scale: 2,
  risePx: 18,
  durationSec: 0.9,
  slam: true,
};

/** params 袋 → 规范事件（缺省兜底与渲染端 num() 同口径）。 */
export function normalizeTextPopEvent(
  params: Record<string, ModifierParamValue> | undefined | null,
): TextPopEvent {
  const p = params ?? {};
  const num = (v: ModifierParamValue | undefined, d: number) =>
    v === undefined || v === null || !Number.isFinite(Number(v))
      ? d
      : Number(v);
  const d = TEXT_POP_DEFAULT_PARAMS;
  return {
    text: p.text !== undefined && p.text !== null ? String(p.text) : String(d.text),
    anchor: p.anchor === 'canvas' ? 'canvas' : 'char',
    x: num(p.x, Number(d.x)),
    y: num(p.y, Number(d.y)),
    color:
      p.color !== undefined && p.color !== null && String(p.color) !== ''
        ? String(p.color)
        : String(d.color),
    scale: Math.max(0.25, num(p.scale, Number(d.scale))),
    risePx: num(p.risePx, Number(d.risePx)),
    durationSec: Math.max(0.05, num(p.durationSec, Number(d.durationSec))),
    slam:
      p.slam === undefined || p.slam === null
        ? Boolean(d.slam)
        : p.slam === true || p.slam === 'true',
  };
}
