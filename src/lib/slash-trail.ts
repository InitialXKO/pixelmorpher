/**
 * 刀光·轨迹带生成器（SlashFanSpec.mode === 'trail'）。
 *
 * 轨迹来源是消费端采样好的位姿点列：消费端在片段/表演窗内逐时
 * 刻取锚点（刃根 anchorNodeId）与刃尖（tipNodeId）的位姿，把两
 * 点的世界/画布坐标采样成 SlashTrailSample 点列（按时间升序）
 * 传进来。本文件只做几何与着色：不读工程状态、不算位姿。
 *
 * 窗口节奏与扇面共用 slashWindow（头部先展开、尾部后收走）：
 * 样本时间 = 下标/(n−1)，窗口 [tail, head] 取样本时间轴上的子
 * 序列（两端按时间线性插值补点），子序列相邻点围成的四边形带
 * 即当帧可见的轨迹带。带内归一坐标：u = 窗口内时间位置
 * （0 = 尾端、1 = 头端），s = 跨向位置（0 = 刃根侧、1 = 刃尖
 * 侧）。着色与扇面同族：跨向软边、亮度随 u 增、颜色按 (1−s)
 * 查调色板并混尾部加红（与 slash-fan 的 colIdx 式同源）。
 *
 * 帧布局（trailFrameLayout）：plug = 首样本刃根点；帧盒 =
 * 用户盒（spec.w×spec.h、以 plug 为中心）∪ 全部样本点紧包围
 * 盒（+2px 边距）——与扇面「并集不裁」同口径，帧内坐标 =
 * 世界坐标 − 盒左上。
 */

import {
  type SlashFanSpec,
  slashPaletteRgb,
  slashWindow,
} from './slash-fan';

/** 与 slash-fan 的 smooth01 同式复刻（该文件未导出此工具） */
function smooth01(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** 轨迹样本：某一时刻刃根（a）与刃尖（b）的世界/画布坐标 */
export interface SlashTrailSample {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** 轨迹带有效帧布局（语义同扇面 SlashFrameLayout） */
export interface SlashTrailLayout {
  w: number;
  h: number;
  /** 帧内 plug 坐标（未镜像参照系；镜像帧 plug 横坐标 = w − plugX） */
  plugX: number;
  plugY: number;
}

/**
 * 有效帧布局 = 用户盒 ∪ 样本紧包围盒（+2px 边距），plug = 首
 * 样本刃根点。样本为空时退化为以原点为中心的用户盒（仅布局
 * 占位，generateTrailFrame 对 <2 样本直接返回 null）。
 */
export function trailFrameLayout(
  spec: SlashFanSpec,
  samples: readonly SlashTrailSample[],
): SlashTrailLayout {
  const outW = Math.max(4, Math.round(spec.w));
  const outH = Math.max(4, Math.round(spec.h));
  const plugWx = samples.length > 0 ? samples[0]!.ax : 0;
  const plugWy = samples.length > 0 ? samples[0]!.ay : 0;
  let x0 = plugWx - outW / 2, x1 = plugWx + outW / 2;
  let y0 = plugWy - outH / 2, y1 = plugWy + outH / 2;
  for (const s of samples) {
    if (s.ax - 2 < x0) x0 = s.ax - 2;
    if (s.bx - 2 < x0) x0 = s.bx - 2;
    if (s.ax + 2 > x1) x1 = s.ax + 2;
    if (s.bx + 2 > x1) x1 = s.bx + 2;
    if (s.ay - 2 < y0) y0 = s.ay - 2;
    if (s.by - 2 < y0) y0 = s.by - 2;
    if (s.ay + 2 > y1) y1 = s.ay + 2;
    if (s.by + 2 > y1) y1 = s.by + 2;
  }
  const ox = Math.floor(x0), oy = Math.floor(y0);
  return {
    w: Math.ceil(x1) - ox,
    h: Math.ceil(y1) - oy,
    plugX: plugWx - ox,
    plugY: plugWy - oy,
  };
}

export interface SlashTrailFrame {
  /** RGBA，行主序，y 向下（与画布/精灵图同向） */
  data: Uint8ClampedArray;
  w: number;
  h: number;
  plugX: number;
  plugY: number;
}

/** 窗口子序列的一点：时刻 t（样本时间轴 0–1）+ 插值出的刃根/刃尖 */
interface TrailPoint {
  t: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** 在样本点列上按时间 t 线性插值出刃根/刃尖（t 钳 [0, 1]） */
function sampleAt(samples: readonly SlashTrailSample[], t: number): TrailPoint {
  const n = samples.length;
  const ft = Math.min(1, Math.max(0, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(ft));
  const f = ft - i;
  const s0 = samples[i]!, s1 = samples[i + 1]!;
  return {
    t,
    ax: s0.ax + (s1.ax - s0.ax) * f,
    ay: s0.ay + (s1.ay - s0.ay) * f,
    bx: s0.bx + (s1.bx - s0.bx) * f,
    by: s0.by + (s1.by - s0.by) * f,
  };
}

/**
 * 三角形点内判定 + (t, s) 重心插值。顶点各带 (t, s) 属性
 * （t = 样本时刻、s = 跨向位置）；退化（零面积）三角形返回 null。
 * 四边形拆成的两只三角形在对角线两端属性相同，故属性场在
 * 对角线上连续。
 */
function triHit(
  wx: number, wy: number,
  x0: number, y0: number, t0: number, s0: number,
  x1: number, y1: number, t1: number, s1: number,
  x2: number, y2: number, t2: number, s2: number,
): { t: number; s: number } | null {
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(d) < 1e-9) return null;
  const w0 = ((y1 - y2) * (wx - x2) + (x2 - x1) * (wy - y2)) / d;
  const w1 = ((y2 - y0) * (wx - x2) + (x0 - x2) * (wy - y2)) / d;
  const w2 = 1 - w0 - w1;
  if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) return null;
  return {
    t: w0 * t0 + w1 * t1 + w2 * t2,
    s: w0 * s0 + w1 * s1 + w2 * s2,
  };
}

/** 相邻两样本围成的四边形 (a_k, b_k, b_{k+1}, a_{k+1}) 点内判定 */
function quadHit(
  p0: TrailPoint, p1: TrailPoint, wx: number, wy: number,
): { t: number; s: number } | null {
  const minx = Math.min(p0.ax, p0.bx, p1.ax, p1.bx);
  const maxx = Math.max(p0.ax, p0.bx, p1.ax, p1.bx);
  const miny = Math.min(p0.ay, p0.by, p1.ay, p1.by);
  const maxy = Math.max(p0.ay, p0.by, p1.ay, p1.by);
  if (wx < minx || wx > maxx || wy < miny || wy > maxy) return null;
  return (
    triHit(wx, wy,
      p0.ax, p0.ay, p0.t, 0,
      p0.bx, p0.by, p0.t, 1,
      p1.bx, p1.by, p1.t, 1) ??
    triHit(wx, wy,
      p0.ax, p0.ay, p0.t, 0,
      p1.bx, p1.by, p1.t, 1,
      p1.ax, p1.ay, p1.t, 0)
  );
}

/**
 * 生成进度 p（0–1）处的一帧轨迹带；样本 <2 返回 null。
 * mirrored 时在 layout 帧内水平翻转（plugX → w − plugX），与
 * 扇面镜像口径一致。窗口为空（tail ≥ head）时返回全透明帧。
 */
export function generateTrailFrame(
  spec: SlashFanSpec,
  samples: readonly SlashTrailSample[],
  p: number,
  mirrored = false,
): SlashTrailFrame | null {
  const n = samples.length;
  if (n < 2) return null;
  const lay = trailFrameLayout(spec, samples);
  const outW = lay.w, outH = lay.h;
  const data = new Uint8ClampedArray(outW * outH * 4);
  const palette = slashPaletteRgb(spec);
  const softRad = Math.max(0.01, spec.softRad);

  const { head, tail } = slashWindow(p);
  const t0 = Math.max(0, tail), t1 = Math.min(1, head);
  if (t1 > t0) {
    // 窗口子序列：两端插值补点 + 窗内全体样本
    const pts: TrailPoint[] = [sampleAt(samples, t0)];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      if (t > t0 && t < t1) pts.push({ t, ...samples[i]! });
    }
    pts.push(sampleAt(samples, t1));
    const winLen = Math.max(0.001, t1 - t0);
    // 帧内坐标 → 世界坐标的原点偏移（帧内 plug 对回世界 plug）
    const ox = samples[0]!.ax - lay.plugX;
    const oy = samples[0]!.ay - lay.plugY;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const wx = x + 0.5 + ox, wy = y + 0.5 + oy;
        // 遍历相邻样本四边形，多段命中取 u 最大（时间最晚）一段
        let bestU = -1, bestS = 0;
        for (let k = 0; k + 1 < pts.length; k++) {
          const hit = quadHit(pts[k]!, pts[k + 1]!, wx, wy);
          if (!hit) continue;
          const u = (hit.t - t0) / winLen;
          if (u > bestU) { bestU = u; bestS = hit.s; }
        }
        if (bestU < 0) continue;
        const u = Math.min(1, Math.max(0, bestU));
        const s = Math.min(1, Math.max(0, bestS));
        // 跨向软边：刃根/刃尖两边向内渐隐（与扇面径向软边同族）
        const edge = smooth01(Math.min(s, 1 - s) / softRad);
        if (edge < 0.02) continue;
        const bright = edge * (0.35 + 0.65 * Math.pow(u, 0.55));
        // 颜色：按 (1−s) 查调色板、尾部加红（与扇面 colIdx 同式）
        let colIdx = Math.floor((1 - s) * palette.length);
        colIdx += Math.floor((1 - u) * 2.2);
        if (colIdx > palette.length - 1) colIdx = palette.length - 1;
        if (colIdx < 0) colIdx = 0;
        const rgb = palette[colIdx]!;
        const a8 = (bright * 255) | 0;
        if (a8 < 1) continue;
        const o = (y * outW + x) * 4;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = a8;
      }
    }
  }

  if (mirrored) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < (outW >> 1); x++) {
        const a = (y * outW + x) * 4;
        const b = (y * outW + (outW - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) {
          const tmp = data[a + k]!;
          data[a + k] = data[b + k]!;
          data[b + k] = tmp;
        }
      }
    }
  }
  return {
    data,
    w: outW,
    h: outH,
    plugX: mirrored ? outW - lay.plugX : lay.plugX,
    plugY: lay.plugY,
  };
}
