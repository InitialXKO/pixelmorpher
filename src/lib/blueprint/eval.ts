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

/** 内置节点类型 */
const EVALUATORS: Record<string, NodeEvaluator> = {
  // ---- 源 ----
  time: (_n, _i, ctx) => ({ out: num(ctx.frame) }),
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
  sin: (_n, i) => ({ out: num(Math.sin(asNumber(i.x ?? num(0)))) }),
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
    if (i.pixels) result.pixels = i.pixels as BlueprintValue;
    return result;
  },
  // breath: scale = 1 + amplitude * sin(2π * t / period)，与原 breathHandler 对齐
  breath: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const amplitude = asNumber(i.amplitude ?? num(Number(n.params.amplitude ?? 0.1)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 48))));
    return { out: num(1 + amplitude * Math.sin((2 * Math.PI * t) / period)) };
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
  // float: translateY = -height * (0.5 + 0.5*sin), rotation = tilt * sin
  // 与原 floatHandler 对齐
  float: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const height = asNumber(i.height ?? num(Number(n.params.height ?? 5)));
    const tilt = asNumber(i.tilt ?? num(Number(n.params.tilt ?? 3)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 32))));
    const phase = (2 * Math.PI * t) / period;
    return {
      outY: num(-height * (0.5 + 0.5 * Math.sin(phase))),
      outRotation: num(tilt * Math.sin(phase)),
    };
  },
  // wobble: rotation + translateX/Y，与原 wobbleHandler 对齐
  wobble: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const angleAmp = asNumber(i.angleAmplitude ?? num(Number(n.params.angleAmplitude ?? 5)));
    const moveAmp = asNumber(i.moveAmplitude ?? num(Number(n.params.moveAmplitude ?? 2)));
    const damping = asNumber(i.damping ?? num(Number(n.params.damping ?? 0)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 16))));
    const phase = (2 * Math.PI * t) / period;
    const decay = Math.exp(-damping * t * 2 * Math.PI);
    return {
      outRotation: num(angleAmp * Math.sin(phase) * decay),
      outX: num(moveAmp * Math.sin(phase + Math.PI / 3) * decay),
      outY: num(moveAmp * Math.cos(phase + Math.PI / 3) * decay),
    };
  },

  // bounce: translateY = -height * decay * sin²(π * withinBounce)，与原 bounceHandler 对齐
  bounce: (n, i, ctx) => {
    const t = asNumber(i.t ?? num(ctx.frame));
    const height = asNumber(i.height ?? num(Number(n.params.height ?? 20)));
    const period = Math.max(2, asNumber(i.period ?? num(Number(n.params.period ?? 12))));
    const bounces = Math.max(1, asNumber(i.bounces ?? num(Number(n.params.bounces ?? 3))));
    const damping = asNumber(i.damping ?? num(Number(n.params.damping ?? 0.5)));
    const bounceT = (t % period) / (period / bounces);
    const bounceIndex = Math.floor((t % period) / (period / bounces));
    const withinBounce = bounceT - Math.floor(bounceT);
    const decay = Math.pow(1 - damping, bounceIndex);
    return { outY: num(-height * decay * Math.pow(Math.sin(Math.PI * withinBounce), 2)) };
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
  texture_scroll: () => ({}),
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
  contour_scroll: () => ({}),
  reveal_hide: () => ({}),
  shatter_dissolve: () => ({}),
  annihilate: () => ({}),
  teleport: () => ({}),
  crt_off: () => ({}),
  bend: () => ({}),
  elliptical_compress: () => ({}),
  dumbbell_stretch: () => ({}),
  pillow_stretch: () => ({}),
  hyperbolic_stretch: () => ({}),
  ring_ripple: () => ({}),
  pixel_edit: () => ({}),
  // 上屏终点：接收像素图和变换，渲染到画布
  // 实际绘制由渲染管线通过 ctx.renderTarget 完成，此处仅收集参数
  screen: (n, i, ctx): Record<string, BlueprintValue> => {
    const px = asPixels(i.pixels as BlueprintValue);
    if (!px) return {};
    // 将渲染指令存入 ctx，供渲染管线读取
    (ctx as any).renderCommands = (ctx as any).renderCommands ?? [];
    (ctx as any).renderCommands.push({
      pixels: px,
      translateX: asNumber((i.translateX as BlueprintValue) ?? num(0)),
      translateY: asNumber((i.translateY as BlueprintValue) ?? num(0)),
      rotation: asNumber((i.rotation as BlueprintValue) ?? num(0)),
      scaleX: asNumber((i.scaleX as BlueprintValue) ?? num(1)),
      scaleY: asNumber((i.scaleY as BlueprintValue) ?? num(1)),
    });
    return {};
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
  zIndex: number;
} {
  const sorted = topoSort(graph);
  const values = new Map<string, Record<string, BlueprintValue>>();

  for (const node of sorted) {
    const evaluator = EVALUATORS[node.type];
    if (!evaluator) continue;

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

    try {
      values.set(node.id, evaluator(node, resolvedInputs, ctx));
    } catch {
      // 单个节点失败不影响整图
      values.set(node.id, {});
    }
  }

  const out = values.get(graph.outputId);
  return {
    translateX: out?.translateX ? asNumber(out.translateX) : 0,
    translateY: out?.translateY ? asNumber(out.translateY) : 0,
    rotation: out?.rotation ? asNumber(out.rotation) : 0,
    scaleX: out?.scaleX ? asNumber(out.scaleX) : 1,
    scaleY: out?.scaleY ? asNumber(out.scaleY) : 1,
    zIndex: out?.zIndex ? asNumber(out.zIndex) : 0,
  };
}

/** 注册自定义节点类型（插件/扩展用） */
export function registerBlueprintNodeType(type: string, evaluator: NodeEvaluator): void {
  EVALUATORS[type] = evaluator;
}

/** 列出所有内置节点类型（UI  palette 用） */
export function listBlueprintNodeTypes(): string[] {
  return Object.keys(EVALUATORS);
}

/** 节点类型的中文友好名 */
export const BLUEPRINT_NODE_LABELS: Record<string, string> = {
  // 源
  time: '时间',
  const: '常量',
  var: '变量',
  // 数学
  add: '加',
  sub: '减',
  mul: '乘',
  div: '除',
  sin: '正弦',
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
