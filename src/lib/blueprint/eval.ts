// ============================================================
// Blueprint 求值器 — IR 图 → 每帧变换
// 拓扑排序后按序求值，无环（UI 层禁止成环）
// ============================================================

import type {
  BlueprintGraph,
  BlueprintNode,
  BlueprintEvalContext,
  BlueprintValue,
  BlueprintInput,
} from './ir';
import { asNumber, isRef, num, pixels as pixelsVal, asPixels } from './ir';
import { computeGaitTransform } from '../engine/animation-handlers/shared-helpers';
import { evalExpression } from '../expression-parser';
import type { ModifierParamValue, PartAnimationModifier } from '../types';

/**
 * Cubic-bezier 缓动求值（借鉴 keyframe-engine）。
 * 给定 x (0-1) 和控制点，返回缓动后的 y。
 * 使用牛顿迭代法求解。
 */
function cubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  // 牛顿迭代求 t
  let t = x;
  for (let i = 0; i < 8; i++) {
    const cx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
    const dx = 3 * x1 * (1 - t) * (1 - t) + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
    if (Math.abs(dx) < 1e-6) break;
    const diff = cx - x;
    t -= diff / dx;
    t = Math.max(0, Math.min(1, t));
    if (Math.abs(diff) < 1e-6) break;
  }
  // 由 t 求 y
  return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
}

/** 节点求值函数签名 */
type NodeEvaluator = (
  node: BlueprintNode,
  inputs: Record<string, BlueprintValue>,
  ctx: BlueprintEvalContext,
) => Record<string, BlueprintValue>;

// ---- 像素颜色辅助函数 ----
function parseHex(color: string): [number, number, number] | null {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m || !m[1]) return null;
  const hex = m[1];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 颜色混合：mixColor(a, b, t) = a*(1-t) + b*t */
function mixColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex(
    ca[0] * (1 - t) + cb[0] * t,
    ca[1] * (1 - t) + cb[1] * t,
    ca[2] * (1 - t) + cb[2] * t,
  );
}

/** LUT 预设变换 */
function applyLutPreset(color: string, preset: string): string {
  const c = parseHex(color);
  if (!c) return color;
  let [r, g, b] = c;
  switch (preset) {
    case 'grayscale':
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return toHex(lum, lum, lum);
    case 'sepia':
      return toHex(
        Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b),
        Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b),
        Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b),
      );
    case 'invert':
      return toHex(255 - r, 255 - g, 255 - b);
    case 'warm':
      return toHex(Math.min(255, r * 1.1), g, Math.max(0, b * 0.9));
    case 'cool':
      return toHex(Math.max(0, r * 0.9), g, Math.min(255, b * 1.1));
    default:
      return color;
  }
}

/** 内置节点类型 */
export const EVALUATORS: Record<string, NodeEvaluator> = {
  // ---- 源 ----
  time: (_n, _i, ctx) => ({ out: num(ctx.frame) }),
  // timeGate: 时间范围门控
  // start/end: 生效帧范围（-1 表示无限制）
  // fadeIn/fadeOut: 淡入淡出帧数（smoothstep）
  timeGate: (n, i) => {
    const t = asNumber(i.t ?? num(0));
    const start = Number(n.params.start ?? -1);
    const end = Number(n.params.end ?? -1);
    const fadeIn = Math.max(0, Number(n.params.fadeIn ?? 0));
    const fadeOut = Math.max(0, Number(n.params.fadeOut ?? 0));
    
    // 范围外 → 0
    if (start >= 0 && t < start) return { out: num(0) };
    if (end >= 0 && t > end) return { out: num(0) };
    
    let w = 1;
    // 淡入
    if (start >= 0 && fadeIn > 0 && t < start + fadeIn) {
      const x = (t - start) / fadeIn;
      w *= x * x * (3 - 2 * x); // smoothstep
    }
    // 淡出
    if (end >= 0 && fadeOut > 0 && t > end - fadeOut) {
      const x = (end - t) / fadeOut;
      w *= x * x * (3 - 2 * x);
    }
    return { out: num(Math.max(0, Math.min(1, w))) };
  },
  const: (n) => ({ out: num(Number(n.params.value ?? 0)) }),
  var: (n, _i, ctx) => {
    const v = ctx.vars[String(n.params.name ?? '')] ?? n.params.default ?? 0;
    return { out: num(Number(v)) };
  },
  // 精灵源：从 eval 上下文取原始像素图（由渲染管线传入）
  sprite_source: (_n, _i, ctx): Record<string, BlueprintValue> => {
    const grid = (ctx as any).spritePixels;
    if (!grid) return {};
    return { pixels: pixelsVal(grid) };
  },

  // ---- 数学 ----
  add: (_n, i) => ({ out: num(asNumber(i.a ?? num(0)) + asNumber(i.b ?? num(0))) }),
  sub: (_n, i) => ({ out: num(asNumber(i.a ?? num(0)) - asNumber(i.b ?? num(0))) }),
  mul: (_n, i) => ({ out: num(asNumber(i.a ?? num(0)) * asNumber(i.b ?? num(1))) }),
  div: (_n, i) => {
    const b = asNumber(i.b ?? num(1));
    return { out: num(b !== 0 ? asNumber(i.a ?? num(0)) / b : 0) };
  },
  // blend: 按 mode 混合 a 和 b
  // - add: out = a + b
  // - multiply: out = a * b
  // - converge: out = a + b * exp(-speed * t)，新贡献随时间衰减
  blend: (n, i) => {
    const mode = String(n.params.mode ?? 'add');
    const a = asNumber(i.a ?? num(0));
    const b = asNumber(i.b ?? num(0));
    if (mode === 'multiply') {
      return { out: num(a * b) };
    } else if (mode === 'converge') {
      const t = asNumber(i.t ?? num(0));
      const speed = Number(n.params.convergeSpeed ?? 0.5);
      const factor = Math.exp(-speed * t);
      return { out: num(a + b * factor) };
    }
    // default: add
    return { out: num(a + b) };
  },
  // ---- 基础变换 ----
  translate: (n, i, ctx): Record<string, BlueprintValue> => {
    const offsetX = asNumber(i.offsetX ?? num(Number(n.params.offsetX ?? 0)));
    const offsetY = asNumber(i.offsetY ?? num(Number(n.params.offsetY ?? 0)));
    const result: Record<string, BlueprintValue> = {
      outX: num(offsetX), outY: num(offsetY),
      translateX: num(offsetX), translateY: num(offsetY),
    };
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  rotate: (n, i, ctx): Record<string, BlueprintValue> => {
    const angle = asNumber(i.angle ?? num(Number(n.params.angle ?? 0)));
    const result: Record<string, BlueprintValue> = {
      out: num(angle), outRotation: num(angle), rotation: num(angle),
    };
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  uniform_scale: (n, i, ctx): Record<string, BlueprintValue> => {
    const scale = asNumber(i.scale ?? num(Number(n.params.scale ?? 1)));
    const result: Record<string, BlueprintValue> = {
      out: num(scale), outScaleX: num(scale), outScaleY: num(scale),
      scaleX: num(scale), scaleY: num(scale),
    };
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  skew: (n, i, ctx): Record<string, BlueprintValue> => {
    const skewX = asNumber(i.skewX ?? num(Number(n.params.skewX ?? 0)));
    const skewY = asNumber(i.skewY ?? num(Number(n.params.skewY ?? 0)));
    // screen 暂不支持 skew，先输出数值（渲染器按需扩展）
    const result: Record<string, BlueprintValue> = {
      outX: num(skewX), outY: num(skewY), skewX: num(skewX), skewY: num(skewY),
    };
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  non_uniform_stretch: (n, i, ctx): Record<string, BlueprintValue> => {
    const scaleX = asNumber(i.scaleX ?? num(Number(n.params.scaleX ?? 1)));
    const scaleY = asNumber(i.scaleY ?? num(Number(n.params.scaleY ?? 1)));
    const result: Record<string, BlueprintValue> = {
      outScaleX: num(scaleX), outScaleY: num(scaleY),
      scaleX: num(scaleX), scaleY: num(scaleY),
    };
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  sin: (_n, i) => ({ out: num(Math.sin(asNumber(i.x ?? num(0)))) }),
  // waveform: 参数驱动波形发生器
  // params: waveform (sine/triangle/square/sawtooth/linear_ramp/exponential_decay/spring_oscillate/perlin_noise)
  //         amplitude, baseValue, endValue, period, phase, damping
  // keyframes: 参数关键帧插值
  // params: frames (JSON 数组，如 "[0,30,60]"), values (JSON 数组，如 "[10,50,10]")
  //         interpolation ('linear' | 'step')
  // 输入 t，输出插值后的值
  keyframes: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const interpolation = String(n.params.interpolation ?? 'linear');
    let frames: number[] = [];
    let values: number[] = [];
    try {
      frames = JSON.parse(String(n.params.frames ?? '[]'));
      values = JSON.parse(String(n.params.values ?? '[]'));
    } catch {
      return { out: num(0) };
    }
    if (frames.length === 0 || values.length === 0) return { out: num(0) };
    if (frames.length !== values.length) return { out: num(values[0] ?? 0) };
    
    // 排序（按帧）
    const pairs = frames.map((f, idx) => ({ f, v: values[idx]! })).sort((a, b) => a.f - b.f);
    
    // 边界：t 在第一个之前 → 第一个值；t 在最后一个之后 → 最后一个值（hold）
    if (t <= pairs[0]!.f) return { out: num(pairs[0]!.v) };
    if (t >= pairs[pairs.length - 1]!.f) return { out: num(pairs[pairs.length - 1]!.v) };
    
    // 找包围区间
    for (let k = 0; k < pairs.length - 1; k++) {
      const a = pairs[k]!;
      const b = pairs[k + 1]!;
      if (t >= a.f && t <= b.f) {
        if (interpolation === 'step' || b.f === a.f) {
          return { out: num(a.v) };
        }
        // linear
        const p = (t - a.f) / (b.f - a.f);
        return { out: num(a.v + (b.v - a.v) * p) };
      }
    }
    return { out: num(pairs[pairs.length - 1]!.v) };
  },
  waveform: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const waveform = String(n.params.waveform ?? 'sine');
    const amplitude = Number(n.params.amplitude ?? 1);
    const baseValue = Number(n.params.baseValue ?? 0);
    const endValue = Number(n.params.endValue ?? 1);
    const period = Math.max(1, Number(n.params.period ?? 30));
    const phaseDeg = Number(n.params.phase ?? 0);
    const phase = (phaseDeg * Math.PI) / 180;
    const damping = Number(n.params.damping ?? 0.1);
    
    const phaseT = (2 * Math.PI * t) / period + phase;
    let value = 0;
    
    switch (waveform) {
      case 'sine':
        value = baseValue + amplitude * Math.sin(phaseT);
        break;
      case 'triangle': {
        const p = ((t / period + phaseDeg / 360) % 1 + 1) % 1;
        value = baseValue + amplitude * (p < 0.5 ? 4 * p - 1 : 3 - 4 * p);
        break;
      }
      case 'square':
        value = baseValue + amplitude * (Math.sin(phaseT) >= 0 ? 1 : -1);
        break;
      case 'sawtooth': {
        const p = ((t / period + phaseDeg / 360) % 1 + 1) % 1;
        value = baseValue + amplitude * (2 * p - 1);
        break;
      }
      case 'linear_ramp': {
        // 从 baseValue 线性到 endValue，period 帧完成，之后保持 endValue
        const p = Math.min(1, Math.max(0, t / period));
        value = baseValue + (endValue - baseValue) * p;
        break;
      }
      case 'exponential_decay': {
        value = endValue + (baseValue - endValue) * Math.exp(-damping * t);
        break;
      }
      case 'spring_oscillate': {
        // 弹簧阻尼振荡
        value = baseValue + amplitude * Math.exp(-damping * t) * Math.cos(phaseT);
        break;
      }
      case 'perlin_noise': {
        // 简化版：用正弦叠加近似 Perlin
        value = baseValue + amplitude * (
          0.5 * Math.sin(phaseT) +
          0.3 * Math.sin(phaseT * 2.7 + 1.3) +
          0.2 * Math.sin(phaseT * 6.1 + 2.1)
        );
        break;
      }
      default:
        value = baseValue;
    }
    
    return { out: num(value) };
  },
  cos: (_n, i) => ({ out: num(Math.cos(asNumber(i.x ?? num(0)))) }),

  // ---- 缓动 ----
  // ease: cubic-bezier 缓动，输入 x (0-1)，输出缓动后的值
  // 借鉴 keyframe-engine 的 cubic-bezier 实现
  ease: (n, i) => {
    const x = Math.max(0, Math.min(1, asNumber(i.x ?? num(0))));
    const x1 = asNumber(i.x1 ?? num(Number(n.params.x1 ?? 0.25)));
    const y1 = asNumber(i.y1 ?? num(Number(n.params.y1 ?? 0.1)));
    const x2 = asNumber(i.x2 ?? num(Number(n.params.x2 ?? 0.25)));
    const y2 = asNumber(i.y2 ?? num(Number(n.params.y2 ?? 1)));
    return { out: num(cubicBezier(x, x1, y1, x2, y2)) };
  },

  // ---- 时间 ----
  // timeRemap: 时间重映射，输出 = (t * speed + offset)，可选循环
  // 借鉴 keyframe-engine 的 time remapping
  timeRemap: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const speed = asNumber(i.speed ?? num(Number(n.params.speed ?? 1)));
    const offset = asNumber(i.offset ?? num(Number(n.params.offset ?? 0)));
    const loop = n.params.loop === true || n.params.loop === 'true';
    const period = Math.max(1, Number(n.params.period ?? 0));
    let out = t * speed + offset;
    if (loop && period > 0) {
      out = ((out % period) + period) % period;
    }
    // ping-pong 模式
    const pingpong = n.params.pingpong === true || n.params.pingpong === 'true';
    if (pingpong && period > 0) {
      const cycle = ((out % (period * 2)) + period * 2) % (period * 2);
      out = cycle <= period ? cycle : period * 2 - cycle;
    }
    return { out: num(out) };
  },

  // ---- 跨节点引用（可选） ----
  // nodeRef: 读别的 PuppetNode 的 transform 输出
  // 用法：帽子跟随头 -> nodeRef(nodeId='head', output='rotation') -> mul(0.8) -> transform
  // 不用时不影响现有蓝图（ctx.nodeOutputs 为空时输出 0）
  nodeRef: (n, _i, ctx) => {
    const targetId = String(n.params.nodeId ?? '');
    const output = String(n.params.output ?? 'rotation');
    const outputs = ctx.nodeOutputs?.get(targetId);
    if (!outputs) return { out: num(0) };
    const v = outputs[output as keyof typeof outputs] ?? 0;
    return { out: num(v) };
  },

  // ---- 条件与状态（可选，用于抛接等时序切换） ----
  // switch: condition < 0.5 输出 a，否则输出 b
  switch: (_n, i) => {
    const cond = asNumber(i.condition ?? num(0));
    const a = i.a ?? num(0);
    const b = i.b ?? num(0);
    // 输出与输入同类型（number 或其他）
    return { out: cond < 0.5 ? a : b };
  },
  // step: x < edge 输出 0，否则输出 1（帧触发器）
  step: (n, i) => {
    const x = asNumber(i.x ?? num(0));
    const edge = asNumber(i.edge ?? num(Number(n.params.edge ?? 0)));
    return { out: num(x < edge ? 0 : 1) };
  },
  // hold: trigger 从 0 变 1 时冻结 input，之后一直输出冻结值
  // 用于抛接：冻结出手瞬间的手位置
  hold: (n, i, ctx) => {
    const input = i.input ?? num(0);
    const trigger = asNumber(i.trigger ?? num(0));
    const state = ctx.nodeState ?? new Map();
    const key = `hold_${n.id}`;
    const prev = state.get(key) as { held: BlueprintValue; prevTrigger: number } | undefined;
    const prevTrigger = prev?.prevTrigger ?? 0;
    // 上升沿：冻结当前输入
    if (prevTrigger < 0.5 && trigger >= 0.5) {
      state.set(key, { held: input, prevTrigger: trigger });
      if (ctx.nodeState) ctx.nodeState.set(key, { held: input, prevTrigger: trigger });
      return { out: input };
    }
    // 保持冻结值（如果有），否则直通
    if (prev) {
      state.set(key, { held: prev.held, prevTrigger: trigger });
      if (ctx.nodeState) ctx.nodeState.set(key, { held: prev.held, prevTrigger: trigger });
      return { out: prev.held };
    }
    if (ctx.nodeState) ctx.nodeState.set(key, { held: input, prevTrigger: trigger });
    return { out: input };
  },

  // ---- 程序化动画（复用老修改器语义） ----
  // pendulum: rotation = amplitude * sin(2π * t / period + phase)
  pendulum: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 30)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 16))));
    const phase = ((Number(n.params.phase ?? 0) * Math.PI) / 180);
    const value = num(amplitude * Math.sin((2 * Math.PI * t) / period + phase));
    // 同时返回 out (兼容旧蓝图) 和 outRotation (标准)
    const result: Record<string, BlueprintValue> = { out: value, outRotation: value };
    // 像素直通：若有像素输入，代表该变换应用于此像素流
    // 仅当 pixels 输出有后继连接时才输出（无连接不输出，避免浪费）
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  // breath: scale = 1 + amplitude * sin(2π * t / period)，与原 breathHandler 对齐
  breath: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 0.1)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 48))));
    const result: Record<string, BlueprintValue> = { out: num(1 + amplitude * Math.sin((2 * Math.PI * t) / period)) };
    // 仅当 pixels 输出有后继连接时才输出（无连接不输出，避免浪费）
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  // shake: translate = amplitude * (noise)
  shake: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 2)));
    // 确定性伪随机（帧相关）
    const r1 = Math.sin(t * 12.9898) * 43758.5453;
    const r2 = Math.sin(t * 78.233) * 12543.123;
    const nx = (r1 - Math.floor(r1)) * 2 - 1;
    const ny = (r2 - Math.floor(r2)) * 2 - 1;
    return {
      outX: num(nx * amplitude),
      outY: num(ny * amplitude),
    };
  },
  // float: translateY = -amplitude * (0.5 + 0.5*sin), rotation = tilt * sin
  // 与原 floatHandler 对齐
  float: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    // amplitude 为主，height 仅兼容旧蓝图
    const amplitude = asNumber(i.height ?? i.amplitude ?? num(Number(n.params.height ?? n.params.amplitude ?? 5)));
    const tilt = asNumber(i.tilt ?? num(Number(n.params.tilt ?? 3)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 32))));
    const phase = (2 * Math.PI * t) / period;
    const result: Record<string, BlueprintValue> = {
      outY: num(-amplitude * (0.5 + 0.5 * Math.sin(phase))),
      outRotation: num(tilt * Math.sin(phase)),
    };
    // 仅当 pixels 输出有后继连接时才输出（无连接不输出，避免浪费）
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  // wobble: rotation + translateX/Y，与原 wobbleHandler 对齐
  wobble: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    // amplitude 为主，angleAmplitude 仅兼容旧蓝图
    const angleAmp = asNumber(i.angleAmplitude ?? i.amplitude ?? num(Number(n.params.angleAmplitude ?? n.params.amplitude ?? 5)));
    const moveAmp = asNumber(i.moveAmplitude ?? num(Number(n.params.moveAmplitude ?? 2)));
    const damping = asNumber(i.damping ?? num(Number(n.params.damping ?? 0)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 16))));
    const phase = (2 * Math.PI * t) / period;
    const decay = Math.exp(-damping * t * 2 * Math.PI);
    const outX = moveAmp * Math.sin(phase + Math.PI / 3) * decay;
    const outY = moveAmp * Math.cos(phase + Math.PI / 3) * decay;
    const result: Record<string, BlueprintValue> = {
      outRotation: num(angleAmp * Math.sin(phase) * decay),
      outX: num(outX),
      outY: num(outY),
    };
    // 像素输出有后继连接时，光栅化平移（旋转暂不光栅化，仍走 screen）
    const connected = (ctx as any).pixelsOutputConnected?.has(n.id);
    if (i.pixels && connected) {
      const inputPixels = asPixels(i.pixels as BlueprintValue);
      if (inputPixels) {
        const dx = Math.round(outX);
        const dy = Math.round(outY);
        if (dx !== 0 || dy !== 0) {
          const h = inputPixels.length;
          const w = inputPixels[0]?.length ?? 0;
          const shifted: import('../types').PixelGrid = [];
          for (let y = 0; y < h; y++) {
            const row: (string | null)[] = [];
            for (let x = 0; x < w; x++) {
              const sx = x - dx;
              const sy = y - dy;
              row.push((sx >= 0 && sx < w && sy >= 0 && sy < h) ? (inputPixels[sy]?.[sx] ?? null) : null);
            }
            shifted.push(row);
          }
          result.pixels = pixelsVal(shifted);
        } else {
          result.pixels = i.pixels as BlueprintValue;
        }
      }
    }
    // 无后继连接时不输出 pixels
    return result;
  },

  // bounce: translateY = -amplitude * decay * sin²(π * withinBounce)，与原 bounceHandler 对齐
  bounce: (n, i, ctx): Record<string, BlueprintValue> => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.height ?? i.amplitude ?? num(Number(n.params.height ?? n.params.amplitude ?? 20)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 12))));
    const bounces = Math.max(1, asNumber(i.bounces ?? num(Number(n.params.bounces ?? 3))));
    const damping = asNumber(i.damping ?? num(Number(n.params.damping ?? 0.5)));
    const bounceT = (t % period) / (period / bounces);
    const bounceIndex = Math.floor((t % period) / (period / bounces));
    const withinBounce = bounceT - Math.floor(bounceT);
    const decay = Math.pow(1 - damping, bounceIndex);
    const result: Record<string, BlueprintValue> = { outY: num(-amplitude * decay * Math.pow(Math.sin(Math.PI * withinBounce), 2)) };
    // 仅当 pixels 输出有后继连接时才输出（无连接不输出，避免浪费）
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  // elastic: 弹性过冲，与原 elasticHandler 对齐
  elastic: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const offset = asNumber(i.offset ?? num(Number(n.params.offset ?? 20)));
    const overshoot = asNumber(i.overshoot ?? num(Number(n.params.overshoot ?? 0.3)));
    const damping = asNumber(i.damping ?? num(Number(n.params.damping ?? 0.5)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 16))));
    const phase = (2 * Math.PI * t) / period;
    const decay = Math.exp(-damping * t * 2 * Math.PI);
    const osc = 1 - Math.cos(phase) * decay * (1 + overshoot);
    const value = offset * osc;
    const axis = String(n.params.axis ?? 'y');
    const out: Record<string, BlueprintValue> = {};
    if (axis === 'x') out.outX = num(value);
    else if (axis === 'rotation') out.outRotation = num(value);
    else if (axis === 'scale') {
      const s = Math.max(0.01, 1 + value / 100);
      out.outScaleX = num(s);
      out.outScaleY = num(s);
    } else out.outY = num(value);
    return out;
  },
  // wheel: 圆形轨迹，与原 wheelHandler 简化版对齐（circular 模式）
  wheel: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const radiusX = asNumber(i.radiusX ?? num(Number(n.params.radiusX ?? 10)));
    const radiusY = asNumber(i.radiusY ?? num(Number(n.params.radiusY ?? 10)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 16))));
    const phaseRad = (Number(n.params.phase ?? 0) * Math.PI) / 180;
    const dir = n.params.direction === 'ccw' ? -1 : 1;
    const angle = dir * ((2 * Math.PI * t) / period) + phaseRad;
    return {
      outX: num(radiusX * Math.cos(angle)),
      outY: num(radiusY * Math.sin(angle)),
      outRotation: num(dir * (360 * t) / period),
    };
  },
  // noise: fbm 噪声，与原 noiseHandler 对齐（简化版）
  noise: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 5)));
    const targetProperty = String(n.params.targetProperty ?? 'translateY');
    // 简单伪噪声：多正弦叠加
    const v = amplitude * (
      0.5 * Math.sin(t * 0.7) +
      0.3 * Math.sin(t * 1.3 + 1.7) +
      0.2 * Math.sin(t * 2.9 + 4.1)
    );
    const out: Record<string, BlueprintValue> = {};
    if (targetProperty === 'translateX') out.outX = num(v);
    else if (targetProperty === 'rotation') out.outRotation = num(v);
    else if (targetProperty === 'scaleX' || targetProperty === 'scaleY') out.outScale = num(1 + v / 100);
    else out.outY = num(v);
    return out;
  },
  // wave: 波形，与原 waveHandler 对齐
  wave: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 5)));
    const frequency = asNumber(i.frequency ?? num(Number(n.params.frequency ?? 0.1)));
    const phase = (Number(n.params.phase ?? 0) * Math.PI) / 180;
    const waveType = String(n.params.waveType ?? 'sine');
    const targetProperty = String(n.params.targetProperty ?? 'translateY');
    const ph = 2 * Math.PI * frequency * t + phase;
    let v: number;
    switch (waveType) {
      case 'triangle': v = (2 / Math.PI) * Math.asin(Math.sin(ph)); break;
      case 'square': v = Math.sign(Math.sin(ph)); break;
      case 'sawtooth': v = 2 * ((ph / (2 * Math.PI)) % 1) - 1; break;
      default: v = Math.sin(ph);
    }
    v *= amplitude;
    const out: Record<string, BlueprintValue> = {};
    if (targetProperty === 'translateX') out.outX = num(v);
    else if (targetProperty === 'rotation') out.outRotation = num(v);
    else out.outY = num(v);
    return out;
  },
  // spring: 弹簧阻尼，与原 springHandler 对齐
  spring: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const stiffness = asNumber(i.stiffness ?? num(Number(n.params.stiffness ?? 0.3)));
    const damping = asNumber(i.damping ?? num(Number(n.params.damping ?? 0.1)));
    const mass = asNumber(i.mass ?? num(Number(n.params.mass ?? 1)));
    const restLength = asNumber(i.restLength ?? num(Number(n.params.restLength ?? 0)));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 10)));
    const targetProperty = String(n.params.targetProperty ?? 'translateY');
    const frameRate = ctx.frameRate || 12;
    const timeSec = t / frameRate;
    const omega = Math.sqrt(stiffness / mass);
    const gamma = damping / (2 * mass);
    const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
    const value = (restLength > 0 ? restLength : amplitude) * Math.exp(-gamma * timeSec) * Math.cos(dampedOmega * timeSec) + restLength;
    const out: Record<string, BlueprintValue> = {};
    if (targetProperty === 'translateX') out.outX = num(value);
    else if (targetProperty === 'rotation') out.outRotation = num(value);
    else out.outY = num(value);
    return out;
  },
  // jitter: 随机抖动，与原 jitterHandler 对齐
  jitter: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitudeX = asNumber(i.amplitudeX ?? num(Number(n.params.amplitudeX ?? 2)));
    const amplitudeY = asNumber(i.amplitudeY ?? num(Number(n.params.amplitudeY ?? 2)));
    const seed = Number(n.params.seed ?? 0);
    // 确定性伪随机
    const r1 = Math.sin((t + seed) * 12.9898) * 43758.5453;
    const r2 = Math.sin((t + seed) * 78.233) * 12543.123;
    const nx = (r1 - Math.floor(r1)) * 2 - 1;
    const ny = (r2 - Math.floor(r2)) * 2 - 1;
    return {
      outX: num(nx * amplitudeX),
      outY: num(ny * amplitudeY),
    };
  },
  // gait: 直接调原 computeGaitTransform，保证行为一致
  gait: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const period = Math.max(4, asNumber(i.period ?? num(Number(n.params.period ?? 24))));
    // normalizedT: 每 period 一周期
    const normalizedT = (t % period) / period;
    const result = computeGaitTransform({
      normalizedT,
      period,
      weight: 1,
      strideLength: Number(n.params.strideLength ?? 20),
      liftHeight: Number(n.params.liftHeight ?? 12),
      stanceRatio: Number(n.params.stanceRatio ?? 0.6),
      direction: String(n.params.direction ?? 'forward'),
      gaitStyle: String(n.params.gaitStyle ?? 'cartoon'),
      aerialRatio: Number(n.params.aerialRatio ?? 0.35),
      teardropAsymmetry: Number(n.params.teardropAsymmetry ?? 0.3),
      liftoffAngle: Number(n.params.liftoffAngle ?? -20),
      peakAngle: Number(n.params.peakAngle ?? 15),
      contactAngle: Number(n.params.contactAngle ?? 10),
      angleEasing: String(n.params.angleEasing ?? 'sine'),
      landBend: Number(n.params.landBend ?? 0.15),
      landBendDuration: Number(n.params.landBendDuration ?? 3),
      liftoffBend: Number(n.params.liftoffBend ?? 0.1),
      liftoffBendDuration: Number(n.params.liftoffBendDuration ?? 2),
    });
    return {
      outX: num(result.translateX ?? 0),
      outY: num(result.translateY ?? 0),
      outRotation: num(result.rotation ?? 0),
      outScaleX: num(result.scaleX ?? 1),
      outScaleY: num(result.scaleY ?? 1),
    };
  },
  // expression: 直接调原 evalExpression，保证行为一致
  expression: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = Number(n.params.amplitude ?? 10);
    const period = Math.max(2, Number(n.params.period ?? 16));
    const phase = Number(n.params.phase ?? 0);
    const vars = {
      t, f: t, period, phase, amplitude,
      fps: ctx.frameRate || 12,
      totalFrames: 24,
      PI: Math.PI, E: Math.E, TAU: Math.PI * 2,
    };
    try {
      const tx = evalExpression(String(n.params.expressionX || '0'), vars);
      const ty = evalExpression(String(n.params.expressionY || '0'), vars);
      const rot = evalExpression(String(n.params.expressionRotation || '0'), vars);
      const scaleVal = evalExpression(String(n.params.expressionScale || '1'), vars);
      const sx = Math.max(0.01, scaleVal);
      return {
        outX: num(tx),
        outY: num(ty),
        outRotation: num(rot),
        outScaleX: num(sx),
        outScaleY: num(sx),
      };
    } catch {
      return { outX: num(0), outY: num(0), outRotation: num(0), outScaleX: num(1), outScaleY: num(1) };
    }
  },

  // ---- 输出 ----
  // transform: 把各分量组合成最终变换
  transform: (_n, i) => ({
    translateX: num(asNumber(i.translateX ?? num(0))),
    translateY: num(asNumber(i.translateY ?? num(0))),
    rotation: num(asNumber(i.rotation ?? num(0))),
    scaleX: num(asNumber(i.scaleX ?? num(1))),
    scaleY: num(asNumber(i.scaleY ?? num(1))),
    zIndex: num(asNumber(i.zIndex ?? num(0))),
  }),

  // ---- 像素形变（蓝图内处理像素，由渲染管线传入像素并取回结果） ----
  texture_scroll: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyTextureScroll } = require('../engine/modifier-renderers/texture-scroll');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyTextureScroll(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  wave_deform: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    // 动态导入避免循环依赖
    const { applyWaveDeform } = require('../engine/modifier-renderers/wave-deform');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    // 从输入端口覆盖 params（蓝图连线优先）
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyWaveDeform(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1, 0, 0);
    return { pixels: pixelsVal(result) };
  },
  contour_scroll: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyContourScroll } = require('../engine/modifier-renderers/contour-scroll');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyContourScroll(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  reveal_hide: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyRevealHide } = require('../engine/modifier-renderers/reveal-hide');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyRevealHide(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  shatter_dissolve: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyShatterDissolve } = require('../engine/modifier-renderers/shatter-dissolve');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyShatterDissolve(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  annihilate: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyAnnihilate } = require('../engine/modifier-renderers/annihilate');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyAnnihilate(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  teleport: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyTeleport } = require('../engine/modifier-renderers/teleport');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyTeleport(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  crt_off: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyCrtOff } = require('../engine/modifier-renderers/crt-off');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyCrtOff(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  bend: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyBend } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyBend(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  elliptical_compress: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyEllipticalCompress } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyEllipticalCompress(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  dumbbell_stretch: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyDumbbellStretch } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyDumbbellStretch(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  pillow_stretch: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyPillowStretch } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyPillowStretch(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  hyperbolic_stretch: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyHyperbolicStretch } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyHyperbolicStretch(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  ring_ripple: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyRingRipple } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyRingRipple(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  local_inflate: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyLocalInflate } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't') params[k] = asNumber(v as BlueprintValue);
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyLocalInflate(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  // ---- 补齐的像素修改器：走 modifierRegistry ----
  color_replace: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('color_replace');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't' && k !== 'gate') params[k] = v;
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  outline: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('outline');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't' && k !== 'gate') params[k] = v;
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  dither: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('dither');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't' && k !== 'gate') params[k] = v;
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  pixel_displace: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('pixel_displace');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't' && k !== 'gate') params[k] = asNumber(v as BlueprintValue);
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  mirror: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('mirror');
    if (!handler) return {};
    const result = handler({}, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  flip: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('flip');
    if (!handler) return {};
    const result = handler({}, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  cylinder_rotate: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('cylinder_rotate');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't' && k !== 'gate') params[k] = v;
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  sphere_rotate: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('sphere_rotate');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k !== 'pixels' && k !== 't' && k !== 'gate') params[k] = v;
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  path_follow: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const { applyPathFollow } = require('../engine/modifier-renderers/geometric');
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    for (const [k, v] of Object.entries(i)) {
      if (k === 'pixels' || k === 't' || k === 'gate') continue;
      // path 是数组类型，直接传；其他转 number
      if (k === 'path') {
        const wired = v as BlueprintValue;
        if (wired && wired.type === 'array') params.path = wired.value;
      } else {
        params[k] = asNumber(v as BlueprintValue);
      }
    }
    // 静态 path 参数（数组）
    if (!params.path && Array.isArray(n.params.path)) {
      params.path = n.params.path;
    }
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const result = applyPathFollow(inputPixels, w, h, params, ctx.frame, ctx.frameRate, 1);
    return { pixels: pixelsVal(result) };
  },
  path_move: (n, i, ctx): Record<string, BlueprintValue> => {
    // 顺路径移动：输出位移和朝向（变换类，非像素）
    const getNum = (key: string, def: number): number => {
      const wired = i[key] as BlueprintValue | undefined;
      if (wired !== undefined) return asNumber(wired);
      const p = n.params[key];
      return typeof p === 'number' ? p : def;
    };
    const getPath = (): Array<{ x: number; y: number }> | null => {
      const wired = i.path as BlueprintValue | undefined;
      if (wired && wired.type === 'array' && Array.isArray(wired.value)) {
        return wired.value as Array<{ x: number; y: number }>;
      }
      const p = n.params.path;
      if (Array.isArray(p)) return p as Array<{ x: number; y: number }>;
      return null;
    };
    const path = getPath();
    if (!path || path.length < 2) return { outX: num(0), outY: num(0), outRotation: num(0) };

    const pathType = String(n.params.pathType ?? 'polyline');
    let progress = getNum('progress', 0);
    const mode = String(n.params.mode ?? 'orient');
    const loop = Boolean(n.params.loop ?? false);

    if (loop) {
      progress = ((progress % 1) + 1) % 1;
    } else {
      progress = Math.max(0, Math.min(1, progress));
    }

    // 采样路径点和切线
    const samplePath = (t: number): { x: number; y: number; tx: number; ty: number } => {
      if (pathType === 'bezier' && path.length >= 4) {
        // 找到对应的贝塞尔段
        const numSegs = Math.floor(path.length / 4);
        const segT = t * numSegs;
        const segIdx = Math.min(numSegs - 1, Math.floor(segT));
        const lt = segT - segIdx;
        const p0 = path[segIdx * 4]!, p1 = path[segIdx * 4 + 1]!, p2 = path[segIdx * 4 + 2]!, p3 = path[segIdx * 4 + 3]!;
        const mt = 1 - lt;
        const x = mt*mt*mt*p0.x + 3*mt*mt*lt*p1.x + 3*mt*lt*lt*p2.x + lt*lt*lt*p3.x;
        const y = mt*mt*mt*p0.y + 3*mt*mt*lt*p1.y + 3*mt*lt*lt*p2.y + lt*lt*lt*p3.y;
        const tx = 3*mt*mt*(p1.x-p0.x) + 6*mt*lt*(p2.x-p1.x) + 3*lt*lt*(p3.x-p2.x);
        const ty = 3*mt*mt*(p1.y-p0.y) + 6*mt*lt*(p2.y-p1.y) + 3*lt*lt*(p3.y-p2.y);
        const len = Math.sqrt(tx*tx + ty*ty) || 1;
        return { x, y, tx: tx/len, ty: ty/len };
      } else {
        // 多段线：按弧长
        const cumLen: number[] = [0];
        for (let k = 1; k < path.length; k++) {
          const dx = path[k]!.x - path[k-1]!.x;
          const dy = path[k]!.y - path[k-1]!.y;
          cumLen.push(cumLen[k-1]! + Math.sqrt(dx*dx + dy*dy));
        }
        const totalLen = cumLen[cumLen.length - 1] || 1;
        const targetLen = t * totalLen;
        let seg = 0;
        while (seg < cumLen.length - 2 && cumLen[seg + 1]! < targetLen) seg++;
        const segLen = (cumLen[seg + 1]! - cumLen[seg]!) || 1;
        const lt = (targetLen - cumLen[seg]!) / segLen;
        const x = path[seg]!.x + (path[seg + 1]!.x - path[seg]!.x) * lt;
        const y = path[seg]!.y + (path[seg + 1]!.y - path[seg]!.y) * lt;
        const tx = path[seg + 1]!.x - path[seg]!.x;
        const ty = path[seg + 1]!.y - path[seg]!.y;
        const len = Math.sqrt(tx*tx + ty*ty) || 1;
        return { x, y, tx: tx/len, ty: ty/len };
      }
    };

    const s = samplePath(progress);
    const outX = s.x;
    const outY = s.y;
    let outRotation = 0;
    if (mode === 'orient') {
      // 切线角度（度）
      outRotation = (Math.atan2(s.ty, s.tx) * 180) / Math.PI;
    }
    return { outX: num(outX), outY: num(outY), outRotation: num(outRotation) };
  },
  pixel_edit: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    // 从 modifierRegistry 取 pixel_edit 处理器
    const { modifierRegistry } = require('../engine/pixel-modifiers');
    const handler = modifierRegistry.get('pixel_edit');
    if (!handler) return {};
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.params)) params[k] = v;
    // 接线优先：i.brushCommands 覆盖静态 params.brushCommands
    if (i.brushCommands) {
      const wired = i.brushCommands as BlueprintValue;
      if (wired.type === 'array') params.brushCommands = wired.value;
    }
    const result = handler(params, inputPixels, ctx.frame);
    return { pixels: pixelsVal(result) };
  },
  // ---- 像素修改器（委托 modifierRegistry）----
  // 通用模板：从 registry 取处理器，输入像素 → 输出像素
  ...(['color_replace', 'cylinder_rotate', 'dither', 'flip', 'mirror', 'outline', 'pixel_displace', 'sphere_rotate'] as const).reduce((acc, type) => {
    acc[type] = ((n, i, ctx): Record<string, BlueprintValue> => {
      const inputPixels = asPixels(i.pixels as BlueprintValue);
      if (!inputPixels) return {};
      const { modifierRegistry } = require('../engine/pixel-modifiers');
      const handler = modifierRegistry.get(type);
      if (!handler) return { pixels: i.pixels as BlueprintValue }; // 无实现时直通
      const params: Record<string, any> = {};
      for (const [k, v] of Object.entries(n.params)) params[k] = v;
      for (const [k, v] of Object.entries(i)) {
        if (k !== 'pixels' && k !== 't' && k !== 'gate') {
          try { params[k] = asNumber(v as BlueprintValue); } catch { /* 忽略非数值 */ }
        }
      }
      const result = handler(params, inputPixels, ctx.frame);
      return { pixels: pixelsVal(result) };
    }) as NodeEvaluator;
    return acc;
  }, {} as Record<string, NodeEvaluator>),
  // ---- 像素特效：真实实现 ----
  // scanlines: 扫描线，每 lineSpacing 行压暗
  scanlines: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const spacing = Math.max(1, Math.round(Number(n.params.lineSpacing ?? 3)));
    const opacity = Math.max(0, Math.min(1, Number(n.params.lineOpacity ?? 0.3)));
    const result = inputPixels.map((row, y) => {
      if (y % spacing !== 0) return [...row];
      return row.map((px) => {
        if (!px) return px;
        // 压暗：与黑色按 opacity 混合
        return mixColor(px, '#000000', opacity);
      });
    });
    return { pixels: pixelsVal(result) };
  },
  // canvas_mask: 画布遮罩，按形状裁剪
  canvas_mask: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const shape = String(n.params.shape ?? 'rect');
    const margin = Math.max(0, Number(n.params.margin ?? 0));
    const feather = Math.max(0, Number(n.params.feather ?? 0));
    const cx = w / 2, cy = h / 2;
    const result = inputPixels.map((row, y) =>
      row.map((px, x) => {
        if (!px) return px;
        let inside = true;
        let dist = 0;
        if (shape === 'circle' || shape === 'ellipse') {
          const rx = w / 2 - margin, ry = h / 2 - margin;
          const dx = (x - cx) / Math.max(1, rx);
          const dy = (y - cy) / Math.max(1, ry);
          const d = Math.sqrt(dx * dx + dy * dy);
          inside = d <= 1;
          dist = d;
        } else {
          // rect
          inside = x >= margin && x < w - margin && y >= margin && y < h - margin;
        }
        if (!inside) return null;
        // feather 羽化：边缘渐隐（简化：暂不实现透明度渐变，直接保留）
        return px;
      })
    );
    return { pixels: pixelsVal(result) };
  },
  // pixel_zoom: 像素化缩放（最近邻）
  pixel_zoom: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const scale = Math.max(0.1, Number(n.params.scale ?? 2));
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const nh = Math.max(1, Math.round(h * scale));
    const nw = Math.max(1, Math.round(w * scale));
    const result: import('../types').PixelGrid = [];
    for (let y = 0; y < nh; y++) {
      const row: import('../types').PixelColor[] = [];
      const sy = Math.min(h - 1, Math.floor(y / scale));
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(w - 1, Math.floor(x / scale));
        row.push(inputPixels[sy]?.[sx] ?? null);
      }
      result.push(row);
    }
    return { pixels: pixelsVal(result) };
  },
  // color_lut: 全局颜色查找表（预设变换）
  color_lut: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const preset = String(n.params.preset ?? 'none');
    const intensity = Math.max(0, Math.min(1, Number(n.params.intensity ?? 1)));
    if (preset === 'none' || intensity === 0) return { pixels: i.pixels as BlueprintValue };
    const result = inputPixels.map((row) =>
      row.map((px) => {
        if (!px) return px;
        const transformed = applyLutPreset(px, preset);
        return mixColor(px, transformed, intensity);
      })
    );
    return { pixels: pixelsVal(result) };
  },
  // outline_emphasis: 轮廓强调，检测边缘并加粗/着色
  outline_emphasis: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const thickness = Math.max(1, Math.round(Number(n.params.thickness ?? 1)));
    const color = String(n.params.color ?? '#000000');
    // 找边缘：有像素但邻居无像素的位置
    const isEdge: boolean[][] = [];
    for (let y = 0; y < h; y++) {
      isEdge[y] = [];
      for (let x = 0; x < w; x++) {
        if (!inputPixels[y]?.[x]) { isEdge[y]![x] = false; continue; }
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1 && !edge; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h || !inputPixels[ny]?.[nx]) {
              edge = true;
            }
          }
        }
        isEdge[y]![x] = edge;
      }
    }
    const result = inputPixels.map((row, y) =>
      row.map((px, x) => {
        if (!px) return px;
        // 边缘像素 → 混入轮廓色
        if (isEdge[y]?.[x]) {
          return mixColor(px, color, 0.7);
        }
        return px;
      })
    );
    return { pixels: pixelsVal(result) };
  },
  // bloom: 泛光，亮部扩散
  bloom: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const threshold = Math.max(0, Math.min(255, Number(n.params.threshold ?? 200)));
    const radius = Math.max(1, Math.round(Number(n.params.radius ?? 2)));
    const intensity = Math.max(0, Math.min(1, Number(n.params.intensity ?? 0.5)));
    // 提取亮部
    const bright: boolean[][] = inputPixels.map((row) =>
      row.map((px) => {
        if (!px) return false;
        const c = parseHex(px);
        if (!c) return false;
        const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        return lum >= threshold;
      })
    );
    // 简单模糊扩散：亮部周围 radius 范围内加光
    const result = inputPixels.map((row, y) =>
      row.map((px, x) => {
        if (!px) return px;
        let glow = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && bright[ny]?.[nx]) {
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d <= radius) glow = Math.max(glow, 1 - d / (radius + 1));
            }
          }
        }
        if (glow > 0) {
          return mixColor(px, '#ffffff', glow * intensity);
        }
        return px;
      })
    );
    return { pixels: pixelsVal(result) };
  },
  // glow: 光晕，像素周围加指定颜色的光
  glow: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const radius = Math.max(1, Math.round(Number(n.params.radius ?? 3)));
    const color = String(n.params.color ?? '#ffff00');
    const intensity = Math.max(0, Math.min(1, Number(n.params.intensity ?? 0.5)));
    const result = inputPixels.map((row, y) =>
      row.map((px, x) => {
        // 只在透明像素上加光晕（已有像素保持）
        if (px) return px;
        let glow = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && inputPixels[ny]?.[nx]) {
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d <= radius) glow = Math.max(glow, 1 - d / (radius + 1));
            }
          }
        }
        // 光晕强度足够则显示颜色（按强度调暗）
        if (glow * intensity > 0.3) {
          const c = parseHex(color);
          if (c) {
            const dim = glow * intensity;
            return toHex(c[0] * dim, c[1] * dim, c[2] * dim);
          }
          return color;
        }
        return px;
      })
    );
    return { pixels: pixelsVal(result) };
  },
  // ---- 复杂系统（暂未实现：直通）----
  // afterimage: 残影，拖尾效果（按 angle 方向复制多份渐隐）
  afterimage: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const count = Math.max(1, Math.round(Number(n.params.count ?? 3)));
    const opacity = Math.max(0, Math.min(1, Number(n.params.opacity ?? 0.5)));
    const spacing = Math.round(Number(n.params.spacing ?? 4));
    const angleDeg = Number(n.params.angle ?? 180);
    const angleRad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    // 结果画布扩大以容纳拖尾（按方向计算包围盒）
    const maxOx = Math.abs(Math.round(dx * count * spacing));
    const maxOy = Math.abs(Math.round(dy * count * spacing));
    const nw = w + maxOx;
    const nh = h + maxOy;
    const offX = dx < 0 ? maxOx : 0;
    const offY = dy < 0 ? maxOy : 0;
    const result: import('../types').PixelGrid = [];
    for (let y = 0; y < nh; y++) {
      result.push(new Array(nw).fill(null));
    }
    // 原图 + 拖尾按角度方向渐隐
    for (let c = count; c >= 0; c--) {
      const ox = Math.round(dx * (count - c) * spacing) + offX;
      const oy = Math.round(dy * (count - c) * spacing) + offY;
      const fade = c === 0 ? 1 : opacity * (1 - c / (count + 1));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = inputPixels[y]?.[x];
          if (!px) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx >= 0 && nx < nw && ny >= 0 && ny < nh) {
            if (c === 0) {
              result[ny]![nx] = px;
            } else {
              const existing = result[ny]?.[nx];
              if (!existing) {
                result[ny]![nx] = mixColor(px, '#000000', 1 - fade);
              }
            }
          }
        }
      }
    }
    return { pixels: pixelsVal(result) };
  },
  // motion_blur: 运动模糊，按 angle 方向模糊
  motion_blur: (n, i): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    if (!inputPixels) return {};
    const h = inputPixels.length;
    const w = inputPixels[0]?.length ?? 0;
    const length = Math.max(1, Math.round(Number(n.params.length ?? 5)));
    const decay = Math.max(0, Math.min(1, Number(n.params.decay ?? 0.5)));
    const angleDeg = Number(n.params.angle ?? 180);
    const angleRad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    const result = inputPixels.map((row, y) =>
      row.map((px, x) => {
        if (!px) return px;
        // 按角度方向取 length 个像素混合
        let r = 0, g = 0, b = 0, total = 0;
        const c0 = parseHex(px);
        if (!c0) return px;
        for (let k = 0; k < length; k++) {
          const nx = Math.round(x - dx * k);
          const ny = Math.round(y - dy * k);
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) break;
          const npx = inputPixels[ny]?.[nx];
          if (!npx) continue;
          const nc = parseHex(npx);
          if (!nc) continue;
          const weight = Math.pow(decay, k);
          r += nc[0] * weight;
          g += nc[1] * weight;
          b += nc[2] * weight;
          total += weight;
        }
        if (total === 0) return px;
        return toHex(r / total, g / total, b / total);
      })
    );
    return { pixels: pixelsVal(result) };
  },
  // particle: 粒子，程序化生成粒子（按 angle 方向发射）
  particle: (n, i, ctx): Record<string, BlueprintValue> => {
    const inputPixels = asPixels(i.pixels as BlueprintValue);
    const h = inputPixels?.length ?? 32;
    const w = inputPixels?.[0]?.length ?? 32;
    const rate = Math.max(0, Number(n.params.rate ?? 10));
    const speed = Number(n.params.speed ?? 2);
    const angleDeg = Number(n.params.angle ?? 270);
    const angleRad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const life = Math.max(1, Number(n.params.life ?? 30));
    const color = String(n.params.color ?? '#ffffff');
    const gravity = Number(n.params.gravity ?? 0.1);
    const frame = ctx.frame;
    // 复制原图
    const result: import('../types').PixelGrid = inputPixels
      ? inputPixels.map((row) => [...row])
      : Array.from({ length: h }, () => new Array(w).fill(null));
    // 生成粒子：基于帧数的确定性伪随机，按 angle 方向发射
    const numParticles = Math.round(rate);
    for (let p = 0; p < numParticles; p++) {
      const seed = (p * 997 + Math.floor(frame / life) * 571) % 1000;
      const age = frame % life;
      const px0 = (seed * 13) % w;
      const py0 = (seed * 7) % h;
      // 粒子运动：按 angle 方向 + 重力（向下）
      // 扩散：垂直于发射方向加随机偏移
      const spread = Math.sin(seed * 3.7) * 0.5;
      const px = Math.round(px0 + (dirX * speed + -dirY * spread) * age * 0.3);
      const py = Math.round(py0 + (dirY * speed + dirX * spread) * age * 0.3 + gravity * age * age * 0.01);
      if (px >= 0 && px < result[0]!.length && py >= 0 && py < result.length) {
        const fade = 1 - age / life;
        if (fade > 0.3) {
          result[py]![px] = color;
        }
      }
    }
    return { pixels: pixelsVal(result) };
  },
  // simple_physics: 简单物理，整体位移（重力/弹性/阻尼）
  simple_physics: (n, i, ctx): Record<string, BlueprintValue> => {
    const gravity = Number(n.params.gravity ?? 0.5);
    const elasticity = Math.max(0, Math.min(1, Number(n.params.elasticity ?? 0.5)));
    const damping = Math.max(0, Math.min(1, Number(n.params.damping ?? 0.9)));
    const frame = ctx.frame;
    // 简化：计算 Y 方向位移（自由落体 + 弹性碰撞地面）
    // 假设地面在 y=100，初始 y=0
    const groundY = 100;
    let y = 0;
    let vy = 0;
    for (let f = 0; f < frame; f++) {
      vy += gravity;
      vy *= damping;
      y += vy;
      if (y >= groundY) {
        y = groundY;
        vy = -vy * elasticity;
      }
    }
    const result: Record<string, BlueprintValue> = {
      outY: num(y), translateY: num(y),
      outX: num(0), translateX: num(0),
    };
    if (i.pixels && (ctx as any).pixelsOutputConnected?.has(n.id)) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  // 上屏终点：接收像素图和变换，渲染到画布
  // 实际绘制由渲染管线通过 ctx.renderTarget 完成，此处仅收集参数
  screen: (n, i, ctx): Record<string, BlueprintValue> => {
    const hasPixelsInput = i.pixels !== undefined;
    const px = asPixels(i.pixels as BlueprintValue);
    const translateX = asNumber((i.translateX as BlueprintValue) ?? num(0));
    const translateY = asNumber((i.translateY as BlueprintValue) ?? num(0));
    const rotation = asNumber((i.rotation as BlueprintValue) ?? num(0));
    const scaleX = asNumber((i.scaleX as BlueprintValue) ?? num(1));
    const scaleY = asNumber((i.scaleY as BlueprintValue) ?? num(1));
    const skewX = asNumber((i.skewX as BlueprintValue) ?? num(0));
    const skewY = asNumber((i.skewY as BlueprintValue) ?? num(0));
    // 返回变换数值，供调用方读取（即使无像素也返回）
    const result: Record<string, BlueprintValue> = {
      translateX: num(translateX),
      translateY: num(translateY),
      rotation: num(rotation),
      scaleX: num(scaleX),
      scaleY: num(scaleY),
      skewX: num(skewX),
      skewY: num(skewY),
    };
    // 无像素输入：纯变换模式，不绘制
    if (!hasPixelsInput) return result;
    // 有像素输入：忠实绘制（即使为空像素也绘制）
    const cmd = {
      pixels: px ?? [],
      translateX, translateY, rotation, scaleX, scaleY, skewX, skewY,
    };
    // 若调用方提供了直接绘制回调，screen 即为绘制终点
    const drawToScreen = (ctx as any).drawToScreen as ((c: { pixels: import('../types').PixelGrid; translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number; skewX: number; skewY: number }) => void) | undefined;
    if (drawToScreen) {
      drawToScreen(cmd);
    } else {
      // 兼容：收集指令供调用方执行
      (ctx as any).renderCommands = (ctx as any).renderCommands ?? [];
      (ctx as any).renderCommands.push(cmd);
    }
    return result;
  },
};

/** 拓扑排序（Kahn 算法） */
function topoSort(graph: BlueprintGraph): BlueprintNode[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of graph.nodes) {
    for (const input of Object.values(n.inputs)) {
      if (isRef(input) && nodeMap.has(input.nodeId)) {
        adj.get(input.nodeId)!.push(n.id);
        inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: BlueprintNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(nodeMap.get(id)!);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  // 有环则返回已排序部分（UI 层应禁止成环）
  return sorted;
}

/** 求值整图，返回 transform */
export function evaluateBlueprint(
  graph: BlueprintGraph,
  ctx: BlueprintEvalContext,
): {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  zIndex: number;
  pixels?: import('../types').PixelGrid;
} {
  const sorted = topoSort(graph);
  const values = new Map<string, Record<string, BlueprintValue>>();

  // 预计算：哪些节点的 pixels 输出有后继连接
  // 变换节点仅在 pixels 输出被连接时才光栅化变换到像素
  const pixelsOutputConnected = new Set<string>();
  for (const node of graph.nodes) {
    for (const input of Object.values(node.inputs)) {
      if (isRef(input) && (input.output ?? 'out') === 'pixels') {
        pixelsOutputConnected.add(input.nodeId);
      }
    }
  }
  (ctx as any).pixelsOutputConnected = pixelsOutputConnected;

  for (const node of sorted) {
    const evaluator = EVALUATORS[node.type];
    if (!evaluator) continue;

    // 短路开关：enabled=false 时跳过节点逻辑
    // - 像素节点：直通输入像素（bypass）
    // - 变换节点：输出空（不贡献变换）
    if (node.params.enabled === false) {
      const pixelsInput = node.inputs.pixels;
      if (pixelsInput && isRef(pixelsInput)) {
        const src = values.get(pixelsInput.nodeId);
        const pixels = src?.[pixelsInput.output ?? 'pixels'];
        values.set(node.id, pixels !== undefined ? { pixels } : {});
      } else {
        values.set(node.id, {});
      }
      continue;
    }

    // 解析输入：字面值直接用，连边从已求值节点取
    const resolvedInputs: Record<string, BlueprintValue> = {};
    for (const [port, input] of Object.entries(node.inputs)) {
      if (isRef(input)) {
        const src = values.get(input.nodeId);
        resolvedInputs[port] = src?.[input.output ?? 'out'] ?? num(0);
      } else {
        resolvedInputs[port] = input as BlueprintValue;
      }
    }

    // 时间门控：gate 输入 < 0.5 时 bypass（像素节点直通，变换节点输出空）
    const gateVal = resolvedInputs.gate;
    if (gateVal !== undefined && asNumber(gateVal) < 0.5) {
      const pixelsInput = node.inputs.pixels;
      if (pixelsInput && isRef(pixelsInput)) {
        const src = values.get(pixelsInput.nodeId);
        const pixels = src?.[pixelsInput.output ?? 'pixels'];
        values.set(node.id, pixels !== undefined ? { pixels } : {});
      } else {
        values.set(node.id, {});
      }
      continue;
    }

    try {
      values.set(node.id, evaluator(node, resolvedInputs, ctx));
    } catch {
      // 单个节点失败不影响整图
      values.set(node.id, {});
    }
  }

  const out = values.get(graph.outputId);
  const pixelsOut = out?.pixels;
  return {
    translateX: out?.translateX ? asNumber(out.translateX) : 0,
    translateY: out?.translateY ? asNumber(out.translateY) : 0,
    rotation: out?.rotation ? asNumber(out.rotation) : 0,
    scaleX: out?.scaleX ? asNumber(out.scaleX) : 1,
    scaleY: out?.scaleY ? asNumber(out.scaleY) : 1,
    skewX: out?.skewX ? asNumber(out.skewX) : 0,
    skewY: out?.skewY ? asNumber(out.skewY) : 0,
    zIndex: out?.zIndex ? asNumber(out.zIndex) : 0,
    // screen 节点的 pixels 输出（如果有）
    pixels: pixelsOut && pixelsOut.type === 'pixels' ? pixelsOut.grid : undefined,
  };
}

/** 注册自定义节点类型（插件/扩展用） */
export function registerBlueprintNodeType(type: string, evaluator: NodeEvaluator): void {
  EVALUATORS[type] = evaluator;
}

/**
 * 求值指定节点的输出（用于节点预览）
 * 返回该节点所有输出端口的值
 */
export function evaluateNodeOutput(
  graph: BlueprintGraph,
  nodeId: string,
  ctx: BlueprintEvalContext,
): Record<string, BlueprintValue> | null {
  const sorted = topoSort(graph);
  const values = new Map<string, Record<string, BlueprintValue>>();

  const pixelsOutputConnected = new Set<string>();
  for (const node of graph.nodes) {
    for (const input of Object.values(node.inputs)) {
      if (isRef(input) && (input.output ?? 'out') === 'pixels') {
        pixelsOutputConnected.add(input.nodeId);
      }
    }
  }
  (ctx as any).pixelsOutputConnected = pixelsOutputConnected;

  for (const node of sorted) {
    const evaluator = EVALUATORS[node.type];
    if (!evaluator) continue;
    if (node.params.enabled === false) {
      const pixelsInput = node.inputs.pixels;
      if (pixelsInput && isRef(pixelsInput)) {
        const src = values.get(pixelsInput.nodeId);
        const pixels = src?.[pixelsInput.output ?? 'pixels'];
        values.set(node.id, pixels !== undefined ? { pixels } : {});
      } else {
        values.set(node.id, {});
      }
      continue;
    }
    const resolvedInputs: Record<string, BlueprintValue> = {};
    for (const [port, input] of Object.entries(node.inputs)) {
      if (isRef(input)) {
        const src = values.get(input.nodeId);
        resolvedInputs[port] = src?.[input.output ?? 'out'] ?? num(0);
      } else {
        resolvedInputs[port] = input as BlueprintValue;
      }
    }
    const gateVal = resolvedInputs.gate;
    if (gateVal !== undefined && asNumber(gateVal) < 0.5) {
      const pixelsInput = node.inputs.pixels;
      if (pixelsInput && isRef(pixelsInput)) {
        const src = values.get(pixelsInput.nodeId);
        const pixels = src?.[pixelsInput.output ?? 'pixels'];
        values.set(node.id, pixels !== undefined ? { pixels } : {});
      } else {
        values.set(node.id, {});
      }
      continue;
    }
    try {
      values.set(node.id, evaluator(node, resolvedInputs, ctx));
    } catch {
      values.set(node.id, {});
    }
    // 找到目标节点就提前返回（后面的节点不需要算）
    if (node.id === nodeId) {
      return values.get(nodeId) ?? null;
    }
  }
  return values.get(nodeId) ?? null;
}

/** 列出所有内置节点类型（UI  palette 用） */
export function listBlueprintNodeTypes(): string[] {
  return Object.keys(EVALUATORS);
}

/** 节点类型的中文友好名 */
export const BLUEPRINT_NODE_LABELS: Record<string, string> = {
  // 源
  time: '时间',
  timeGate: '时间门',
  const: '常量',
  var: '变量',
  // 数学
  add: '加',
  sub: '减',
  mul: '乘',
  div: '除',
  blend: '混合',
  sin: '正弦',
  waveform: '波形',
  keyframes: '关键帧',
  cos: '余弦',
  // 缓动
  ease: '缓动',
  // 时间
  timeRemap: '时间重映射',
  // 跨节点
  nodeRef: '引用节点',
  // 条件与状态
  switch: '条件切换',
  step: '帧触发',
  hold: '冻结',
  // 程序化动画
  translate: '平移',
  rotate: '旋转',
  uniform_scale: '均匀缩放',
  skew: '倾斜',
  non_uniform_stretch: '非均匀拉伸',
  pendulum: '钟摆',
  breath: '呼吸',
  shake: '抖动',
  float: '漂浮',
  wobble: '摇摆',
  bounce: '弹跳',
  elastic: '弹性',
  wheel: '转轮',
  noise: '噪声',
  wave: '波形',
  spring: '弹簧',
  jitter: '抖动',
  gait: '步态',
  expression: '表达式',
  // 输出
  transform: '变换输出',
  // 像素修改器
  texture_scroll: '纹理滚动',
  wave_deform: '波形变形',
  contour_scroll: '轮廓滚动',
  reveal_hide: '显现/隐藏',
  shatter_dissolve: '碎裂消散',
  annihilate: '湮灭',
  teleport: '传送',
  crt_off: 'CRT 关闭',
  bend: '弯曲',
  elliptical_compress: '椭圆压缩',
  dumbbell_stretch: '哑铃拉伸',
  pillow_stretch: '枕形拉伸',
  hyperbolic_stretch: '双曲拉伸',
  ring_ripple: '环形波纹',
  // 新增补全
  color_replace: '颜色替换',
  cylinder_rotate: '圆柱旋转',
  dither: '抖动',
  flip: '翻转',
  mirror: '镜像',
  outline: '轮廓',
  pixel_displace: '像素位移',
  sphere_rotate: '球面旋转',
  pixel_edit: '像素编辑',
  afterimage: '残影',
  bloom: '泛光',
  glow: '光晕',
  motion_blur: '运动模糊',
  outline_emphasis: '轮廓强调',
  scanlines: '扫描线',
  color_lut: '颜色查找表',
  canvas_mask: '画布遮罩',
  pixel_zoom: '像素缩放',
  particle: '粒子',
  simple_physics: '简单物理',
};

export function getBlueprintNodeLabel(type: string): string {
  return BLUEPRINT_NODE_LABELS[type] ?? type;
}

// ============================================================
// 像素节点求值器 — 输入/输出 PixelGrid
// 用于蓝图中的像素修改器节点（texture_scroll 等）
// ============================================================

// 像素节点类型集合（汇点：只接受数值输入，不输出）
const PIXEL_NODE_TYPES = new Set([
  'texture_scroll', 'wave_deform', 'contour_scroll', 'reveal_hide',
  'shatter_dissolve', 'annihilate', 'teleport', 'crt_off',
  'bend', 'elliptical_compress', 'dumbbell_stretch',
  'pillow_stretch', 'hyperbolic_stretch', 'ring_ripple',
]);


/**
 * 从蓝图中提取像素修改器配置
 * 像素节点是汇点：接受数值输入（驱动 params），不输出
 * 返回 PartAnimationModifier[]，供渲染管线应用
 */
export function extractPixelModifiers(
  graph: BlueprintGraph,
  ctx: BlueprintEvalContext,
): PartAnimationModifier[] {
  const sorted = topoSort(graph);
  const values = new Map<string, Record<string, BlueprintValue>>();
  const result: PartAnimationModifier[] = [];

  // 先求值所有数值节点（复用主求值逻辑）
  for (const node of sorted) {
    const evaluator = EVALUATORS[node.type];
    if (!evaluator) continue;
    const resolvedInputs: Record<string, BlueprintValue> = {};
    for (const [port, input] of Object.entries(node.inputs)) {
      if (isRef(input)) {
        const srcVals = values.get(input.nodeId);
        const v = srcVals?.[input.output ?? 'out'];
        if (v !== undefined) resolvedInputs[port] = v;
      } else if (input !== undefined) {
        resolvedInputs[port] = input as BlueprintValue;
      }
    }
    try {
      values.set(node.id, evaluator(node, resolvedInputs, ctx));
    } catch {
      // 忽略求值失败的节点
    }
  }

  // 提取像素节点，合并 inputs 覆盖 params
  for (const node of sorted) {
    if (!isPixelBlueprintNode(node.type)) continue;
    const nodeVals = values.get(node.id) ?? {};
    const params: Record<string, ModifierParamValue> = { ...node.params };

    // inputs 中的数值覆盖同名 params（实现 A：蓝图驱动像素参数）
    for (const [port, input] of Object.entries(node.inputs)) {
      if (port === 't') continue; // t 是时间，不覆盖
      const v = isRef(input)
        ? values.get(input.nodeId)?.[input.output ?? 'out']
        : (input as BlueprintValue);
      if (v !== undefined) {
        params[port] = asNumber(v);
      }
    }

    result.push({
      id: node.id,
      type: node.type as any,
      enabled: true,
      collapsed: false,
      params,
      startFrame: -1,
      endFrame: -1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    } as PartAnimationModifier);
  }

  return result;
}

/** 检查是否为像素节点类型 */
export function isPixelBlueprintNode(type: string): boolean {
  return PIXEL_NODE_TYPES.has(type);
}
