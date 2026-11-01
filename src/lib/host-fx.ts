// ============================================================
// 宿主后处理段（动态模式新段）：以部件「当前帧像素」为输入的
// 后处理——本体即画布类效果（pixelfx 的受击闪红/故障切片/
// 传送逐行写回/瓦解/石化面层都属此类）。与发光段（在宿主像素
// 之外叠光）不同，本段直接改写宿主像素本身：染色/闪刷/切片/
// 逐行显隐/瓦解/面层爬升六种模式，全是 (像素, t, 种子) 的纯
// 函数，无跨帧状态。段解析沿置换/残影口径：多实例只取第一个
// 启用（firstHostFxParams）。消费两端：编辑器在 unified-render
// 部件像素定稿（修改器/像素链/蒙皮/置换全过完）后、成画布前
// 接入；运行时包在部件片元着色器以同一套公式应用（侧车数据
// 纹理供参，见 runtime-template 的 uHostSide），核心另有
// DYNAMIC_SRC 孪生 dynHostFxApply 与本文件逐式对应、探针逐
// 像素对拍（scripts/verify-host-fx.mts）。
//
// 通则：只动 alpha>0 的源像素——不无中生有造像素。例外是
// 语义本身即位移/显隐的模式：slice 把已有像素横移（边界钳
// 制，边缘像素复制）、rows/dissolve 把像素清掉。其余模式
// （tint/flash/creep）只改已有像素的颜色、alpha 原样。
// ============================================================

import type { PixelGrid } from './unified-types';

export type HostFxMode = 'none' | 'tint' | 'flash' | 'slice' | 'rows' | 'dissolve' | 'creep';

/** 核心只依赖这组字段（DynamicPatternParams 的子集，结构兼容） */
export interface HostFxParamsLike {
  hostFxEnabled: boolean;
  hostFxMode: HostFxMode | string;
  hostFxColor: string;
  hostFxStrength: number;
  hostFxHz: number;
  hostFxSlicePx: number;
  hostFxPhase: number;
}

export const HOST_FX_MODES: HostFxMode[] = ['none', 'tint', 'flash', 'slice', 'rows', 'dissolve', 'creep'];

/** FNV 哈希（与 dynamic-patterns 的 displaceHash01 / DYNAMIC_SRC
 * 的 dynHash01 同一混合式，逐值一致） */
export function hostFxHash01(...nums: number[]): number {
  let h = 2166136261;
  for (const n of nums) {
    h ^= (n | 0) + 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 16777619);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 实例 id → 种子（与 DYNAMIC_SRC 的 dynSeedOf 同一 31 倍乘
 * 字符串哈希；消费端两端同式，保证噪声/带向一致） */
export function hostFxSeedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

/** 种子归约：压进 5 位十进制内——运行时包经 RGBA32F 侧车传
 * 种子，float32 装不下完整 32 位整数哈希，先归约再传可精确
 * 表示；核心内也做同一归约，编辑器传原始种子结果一致。 */
export function hostFxSeedEff(seed: number): number {
  return ((seed % 100000) + 100000) % 100000;
}

/** 正弦脉冲 0..1（与形变段 dynamicDeformAt 同一波形口径） */
export function hostFxPulseAt(p: HostFxParamsLike, tSec: number): number {
  return (Math.sin(2 * Math.PI * ((p.hostFxHz || 0) * tSec + (p.hostFxPhase || 0))) + 1) / 2;
}

/** 周期进度 0..1：frac(t × Hz + 相位) */
export function hostFxProgressAt(p: HostFxParamsLike, tSec: number): number {
  const raw = (p.hostFxHz || 0) * tSec + (p.hostFxPhase || 0);
  return ((raw % 1) + 1) % 1;
}

function hostFxRgbOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return [122, 79, 208]; // 缺省 #7a4fd0
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 段解析：多实例只取第一个启用（hostFxEnabled 且模式非 none），
 * 与置换/残影同口径。返回的是入参列表中的原对象（消费端可据
 * 引用反查实例取种子）。 */
export function firstHostFxParams<T extends HostFxParamsLike>(
  list: readonly T[],
): T | null {
  for (const p of list) {
    if (p && p.hostFxEnabled && p.hostFxMode && p.hostFxMode !== 'none') return p;
  }
  return null;
}

/**
 * 核心：src = RGBA 行优先（行 0 = 图顶，y 向下），返回新数组，
 * 不改输入。seed 为任意整数（内归约）。模式语义见文件头与各
 * 分支注释；全部公式与 DYNAMIC_SRC 的 dynHostFxApply 逐式对应。
 */
export function applyHostFxToRgba(
  src: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  p: HostFxParamsLike,
  tSec: number,
  seed: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  if (!p.hostFxEnabled || !p.hostFxMode || p.hostFxMode === 'none' || w <= 0 || h <= 0) return out;
  const mode = p.hostFxMode;
  const strength = Math.max(0, Math.min(1, p.hostFxStrength || 0));
  const seedEff = hostFxSeedEff(seed);
  const [hr, hg, hb] = hostFxRgbOf(p.hostFxColor);
  const pulse = hostFxPulseAt(p, tSec);
  const prog = hostFxProgressAt(p, tSec);

  if (mode === 'tint') {
    // 染色：目标色按宿主明度调制（目标色自身明度归一到宿主明
    // 度——保住宿主的明暗结构、只换色相家族），再按 strength
    // 混合。目标色近黑（明度≈0）时无从归一，直接用目标色。
    const hLum = (0.2126 * hr + 0.7152 * hg + 0.0722 * hb) / 255;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (src[o + 3]! <= 0) continue;
      const lum = (0.2126 * src[o]! + 0.7152 * src[o + 1]! + 0.0722 * src[o + 2]!) / 255;
      const k = hLum > 0.001 ? lum / hLum : 0;
      const tr = hLum > 0.001 ? clamp255(hr * k) : hr;
      const tg = hLum > 0.001 ? clamp255(hg * k) : hg;
      const tb = hLum > 0.001 ? clamp255(hb * k) : hb;
      out[o] = src[o]! + (tr - src[o]!) * strength;
      out[o + 1] = src[o + 1]! + (tg - src[o + 1]!) * strength;
      out[o + 2] = src[o + 2]! + (tb - src[o + 2]!) * strength;
    }
    return out;
  }

  if (mode === 'flash') {
    // 闪刷：全像素向白色混合，量 = 脉冲 × strength（受击闪白/
    // 通电闪烁的本体帧）。
    const k = pulse * strength;
    if (k <= 0) return out;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (src[o + 3]! <= 0) continue;
      out[o] = src[o]! + (255 - src[o]!) * k;
      out[o + 1] = src[o + 1]! + (255 - src[o + 1]!) * k;
      out[o + 2] = src[o + 2]! + (255 - src[o + 2]!) * k;
    }
    return out;
  }

  if (mode === 'slice') {
    // 切片：水平行带（带高 3px）整带横移。带方向由带号哈希定
    // （半数带左、半数带右），位移量 = 方向 × slicePx × 脉冲窗
    // 口（脉冲门控：波谷静止、波峰全量）。后向采样 + 边界钳制
    // （出界读边缘像素）。同时做 RGB 分色：R 取位移后 +1px 处、
    // B 取 −1px 处（分色不随窗口缩放，是切片的恒定伴随）。
    // alpha 与 G 取位移后本位采样——空像素不造色，颜色只来自
    // 已有像素的搬移。
    const bandH = 3;
    for (let y = 0; y < h; y++) {
      const band = Math.floor(y / bandH);
      const dir = hostFxHash01(band, seedEff, 913) < 0.5 ? -1 : 1;
      const off = Math.round(dir * (p.hostFxSlicePx || 0) * pulse);
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const clampX = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v);
        const base = (y * w + clampX(x - off)) * 4;
        if (src[base + 3]! <= 0) { out[o + 3] = 0; continue; }
        const rSrc = (y * w + clampX(x - off + 1)) * 4;
        const bSrc = (y * w + clampX(x - off - 1)) * 4;
        out[o] = src[rSrc]!;
        out[o + 1] = src[base + 1]!;
        out[o + 2] = src[bSrc + 2]!;
        out[o + 3] = src[base + 3]!;
      }
    }
    return out;
  }

  if (mode === 'rows') {
    // 逐行显隐（写回式）：行 y 可见 iff (y/h) < 进度 p，随 p
    // 推进自上而下逐行出现。硬切：strength 不参与（已出现行
    // 立即全不透明，不做恢复渐变——与 pixelfx 逐行涂回同义）。
    for (let y = 0; y < h; y++) {
      if (y / h < prog) continue;
      for (let x = 0; x < w; x++) out[(y * w + x) * 4 + 3] = 0;
    }
    return out;
  }

  if (mode === 'dissolve') {
    // 瓦解：逐像素哈希噪声 n 对阈值 T = p × (1 + strength)：
    // n > T 清 alpha（像素碎掉）；幸存像素里 T − n < 0.08 的
    // 是瓦解前沿，染宿主色作发光边。p 走满时 T ≥ 1、无像素
    // 被清（n < 1 恒成立）——一个周期 = 从全瓦解到全复原。
    const T = prog * (1 + strength);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (src[o + 3]! <= 0) continue;
        const n = hostFxHash01(x, y, seedEff);
        if (n > T) { out[o + 3] = 0; continue; }
        if (T - n < 0.08) { out[o] = hr; out[o + 1] = hg; out[o + 2] = hb; }
      }
    }
    return out;
  }

  if (mode === 'creep') {
    // 面层爬升（石化/霜冻/诅咒蔓延）：覆盖自底向上推进，覆盖
    // 行 = (y/h) ≥ 1 − p 的全部行（等价 y ≥ ceil((1−p)·h)，
    // 记该首行为边界行）。覆盖区像素换成宿主色、按逐像素噪
    // 声三阶调明暗（0.55/0.8/1.05——面层自身的斑驳）；边界行
    // 整行染发光色（宿主色向白混 0.45）作蔓延前沿。未覆盖区
    // 原样，alpha 全程不动。
    const edgeY = Math.ceil((1 - prog) * h);
    for (let y = 0; y < h; y++) {
      if (y < edgeY) continue;
      const isEdge = y === edgeY;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (src[o + 3]! <= 0) continue;
        if (isEdge) {
          out[o] = hr + (255 - hr) * 0.45;
          out[o + 1] = hg + (255 - hg) * 0.45;
          out[o + 2] = hb + (255 - hb) * 0.45;
        } else {
          const n = hostFxHash01(x, y, seedEff);
          const shade = n < 1 / 3 ? 0.55 : n < 2 / 3 ? 0.8 : 1.05;
          out[o] = clamp255(hr * shade);
          out[o + 1] = clamp255(hg * shade);
          out[o + 2] = clamp255(hb * shade);
        }
      }
    }
    return out;
  }

  return out;
}

// ---- 编辑器 PixelGrid 适配（网格格 = #rrggbb | null，恒不透
// 明语义：pixelsToCanvas 对非空格一律 alpha=255 落画布）。本
// 段核心的 alpha 只有 0/255 两态被网格消费（dissolve/rows 清
// 零 → null），往返无损。 ----

export function pixelGridToRgba(grid: readonly (readonly (string | null)[])[]): {
  data: Uint8ClampedArray; w: number; h: number;
} {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = grid[y]!;
    for (let x = 0; x < w; x++) {
      const c = row[x];
      if (!c) continue;
      const m = /^#([0-9a-fA-F]{6})$/.exec(c);
      if (!m) continue;
      const o = (y * w + x) * 4;
      data[o] = parseInt(m[1].slice(0, 2), 16);
      data[o + 1] = parseInt(m[1].slice(2, 4), 16);
      data[o + 2] = parseInt(m[1].slice(4, 6), 16);
      data[o + 3] = 255;
    }
  }
  return { data, w, h };
}

export function rgbaToPixelGrid(data: Uint8ClampedArray | Uint8Array, w: number, h: number): PixelGrid {
  const grid: PixelGrid = new Array(h);
  const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  for (let y = 0; y < h; y++) {
    const row: (string | null)[] = new Array(w);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      row[x] = data[o + 3]! <= 0
        ? null
        : `#${hex2(data[o]!)}${hex2(data[o + 1]!)}${hex2(data[o + 2]!)}`;
    }
    grid[y] = row;
  }
  return grid;
}
