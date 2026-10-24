// ============================================================
// PixelMorpher - Unified Animation Resolver
// ============================================================
// Resolves animation data for the unified render pipeline:
//
// 1. Modifier parameter keyframes: step/linear/bezier interpolation
//    of modifier parameters across frames
// 2. ParamDriver evaluation: waveform-driven parameter automation
//    (sine, square, triangle, sawtooth, noise, bounce, spring, custom)
// 3. Animation variable context: topological evaluation of
//    variable dependency graph
// 4. Combined resolution: merge keyframe interpolation results
//    with ParamDriver outputs
//
// This module is the unified replacement for the old split system:
// - Old renderFrame's resolveKeyframeModifierParams()
// - Old param-driver.ts's resolveModifierParams() + applyParamDrivers()
// - Old animation-state.ts's resolveAnimModifierParams()
//
// All modifier parameter animation now flows through this single module,
// whether the modifier is on a Node, a CostumePiece, or a GlobalModifier.
// ============================================================

import type {
  ModifierInstance,
  ModifierParamKeyframe,
  ModifierParamValue,
  ParamDriver,
  ParamDriverWaveform,
  ParamSource,
  AnimationVariable,
  InterpolationMode,
  Point,
} from './unified-types';

// H4/H5: 复用主路径的真实 dispatch（animation-dispatch.ts），而不是在这里
// 维护第二套参数名/公式。之前这里读 frequency/decay/speed 等错误参数名，
// 且只实现了 7 种 modifier，其余静默无效果。
import { computeAnimationModifierTransform as computeRealAnimationModifierTransform } from './engine/animation-dispatch';
import { buildVariableContext as buildRealVariableContext } from './engine/param-driver';
import type { ModifierInstance as StoreModifierInstance } from './types';

// ============================================================
// 1. Modifier Parameter Keyframe Resolution
// ============================================================

/**
 * Resolve all parameters for a modifier at the given frame.
 * Combines base params with paramKeyframe interpolation and ParamDriver evaluation.
 *
 * Resolution order (later overrides earlier):
 * 1. Base params (modifier.params)
 * 2. ParamKeyframe interpolation (step/linear/bezier between keyframes)
 * 3. ParamDriver evaluation (waveform-driven overrides)
 */
function resolveModifierParamsAtFrame(
  modifier: ModifierInstance,
  frame: number,
  variableContext?: VariableContext,
): Record<string, ModifierParamValue> {
  // Start with base params
  let params = { ...modifier.params };

  // Apply paramKeyframe interpolation
  if (modifier.paramKeyframes && modifier.paramKeyframes.length > 0) {
    params = interpolateParamKeyframes(
      modifier.paramKeyframes,
      params,
      frame,
    );
  }

  // Apply ParamDriver evaluation (drivers override keyframe results)
  if (modifier.paramDrivers && modifier.paramDrivers.length > 0) {
    params = applyParamDrivers(
      modifier.paramDrivers,
      params,
      frame,
      variableContext,
    );
  }

  return params;
}

/**
 * Interpolate modifier parameter keyframes at the given frame.
 * Follows the same interpolation model as KeyframeTrack:
 * - step: hold previous keyframe's params
 * - linear: lerp numeric params, midpoint switch for non-numeric
 * - bezier: eased interpolation for numeric params
 */
function interpolateParamKeyframes(
  keyframes: ModifierParamKeyframe[],
  baseParams: Record<string, ModifierParamValue>,
  frame: number,
): Record<string, ModifierParamValue> {
  if (keyframes.length === 0) return baseParams;

  // Sort keyframes by frame
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Before first keyframe: use base params
  if (frame < sorted[0].frame) return baseParams;

  // At or after last keyframe: hold last keyframe values
  if (frame >= sorted[sorted.length - 1].frame) {
    return { ...baseParams, ...sorted[sorted.length - 1].params };
  }

  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    if (frame >= sorted[i].frame && frame < sorted[i + 1].frame) {
      const mode = sorted[i + 1].interpolation ?? 'step';

      switch (mode) {
        case 'step':
          return { ...baseParams, ...sorted[i].params };

        case 'linear': {
          const t = (frame - sorted[i].frame) / (sorted[i + 1].frame - sorted[i].frame);
          return interpolateParamsLinear(baseParams, sorted[i].params, sorted[i + 1].params, t);
        }

        case 'bezier': {
          const t = (frame - sorted[i].frame) / (sorted[i + 1].frame - sorted[i].frame);
          const cp1 = sorted[i].bezierCP1 ?? { x: 0.33, y: 0 };
          const cp2 = sorted[i + 1].bezierCP2 ?? { x: 0.66, y: 1 };
          return interpolateParamsBezier(baseParams, sorted[i].params, sorted[i + 1].params, t, cp1, cp2);
        }

        default:
          return { ...baseParams, ...sorted[i].params };
      }
    }
  }

  return baseParams;
}

/**
 * Linear interpolation between two param sets.
 * Numeric params are lerped; non-numeric params switch at t=0.5.
 * Params missing from one set fade towards base values.
 */
function interpolateParamsLinear(
  baseParams: Record<string, ModifierParamValue>,
  fromParams: Record<string, ModifierParamValue>,
  toParams: Record<string, ModifierParamValue>,
  t: number,
): Record<string, ModifierParamValue> {
  const result: Record<string, ModifierParamValue> = { ...baseParams };
  const allKeys = new Set([...Object.keys(fromParams), ...Object.keys(toParams)]);

  for (const key of allKeys) {
    const fromVal = fromParams[key];
    const toVal = toParams[key];

    if (fromVal !== undefined && toVal !== undefined) {
      // Both present: interpolate
      result[key] = lerpParamValue(fromVal, toVal, t);
    } else if (fromVal !== undefined) {
      // Only 'from': fade out towards base (or default 0)
      const baseVal = baseParams[key];
      const defaultVal = typeof fromVal === 'number' ? 0 : fromVal;
      result[key] = lerpParamValue(fromVal, (baseVal ?? defaultVal) as ModifierParamValue, t);
    } else if (toVal !== undefined) {
      // Only 'to': fade in from base (or default 0)
      const baseVal = baseParams[key];
      const defaultVal = typeof toVal === 'number' ? 0 : toVal;
      result[key] = lerpParamValue((baseVal ?? defaultVal) as ModifierParamValue, toVal, t);
    }
  }

  return result;
}

/**
 * Bezier-eased interpolation between two param sets.
 * Uses cubic bezier easing for numeric params, midpoint switch for non-numeric.
 */
function interpolateParamsBezier(
  baseParams: Record<string, ModifierParamValue>,
  fromParams: Record<string, ModifierParamValue>,
  toParams: Record<string, ModifierParamValue>,
  t: number,
  cp1: Point,
  cp2: Point,
): Record<string, ModifierParamValue> {
  const result: Record<string, ModifierParamValue> = { ...baseParams };
  const allKeys = new Set([...Object.keys(fromParams), ...Object.keys(toParams)]);

  // Solve bezier easing for time fraction
  const easedT = solveCubicBezierEasing(cp1.x, cp2.x, t);
  const easedY = evaluateBezierY(cp1.x, cp1.y, cp2.x, cp2.y, easedT);

  for (const key of allKeys) {
    const fromVal = fromParams[key];
    const toVal = toParams[key];

    if (fromVal !== undefined && toVal !== undefined) {
      if (typeof fromVal === 'number' && typeof toVal === 'number') {
        result[key] = fromVal + easedY * (toVal - fromVal);
      } else {
        // Non-numeric: switch at eased midpoint
        result[key] = easedY < 0.5 ? fromVal : toVal;
      }
    } else if (fromVal !== undefined) {
      const baseVal = baseParams[key];
      const defaultVal = typeof fromVal === 'number' ? 0 : fromVal;
      if (typeof fromVal === 'number' && typeof (baseVal ?? defaultVal) === 'number') {
        result[key] = fromVal + easedY * (((baseVal ?? defaultVal) as number) - fromVal);
      } else {
        result[key] = fromVal;
      }
    } else if (toVal !== undefined) {
      const baseVal = baseParams[key];
      const defaultVal = typeof toVal === 'number' ? 0 : toVal;
      if (typeof toVal === 'number' && typeof (baseVal ?? defaultVal) === 'number') {
        result[key] = ((baseVal ?? defaultVal) as number) + easedY * (toVal - ((baseVal ?? defaultVal) as number));
      } else {
        result[key] = easedY < 0.5 ? (baseVal ?? defaultVal) as ModifierParamValue : toVal;
      }
    }
  }

  return result;
}

/**
 * Lerp a single param value. Numeric values are interpolated;
 * non-numeric values switch at t=0.5.
 */
function lerpParamValue(from: ModifierParamValue, to: ModifierParamValue, t: number): ModifierParamValue {
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * t;
  }
  // Non-numeric: switch at midpoint
  return t < 0.5 ? from : to;
}

// ---- Cubic Bezier Helpers (duplicated from unified-render.ts to avoid circular imports) ----

function solveCubicBezierEasing(cp1x: number, cp2x: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (Math.abs(cp1x - 1 / 3) < 1e-6 && Math.abs(cp2x - 2 / 3) < 1e-6) return t;

  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = evalBezierX(cp1x, cp2x, s) - t;
    const dx = evalBezierXDeriv(cp1x, cp2x, s);
    if (Math.abs(dx) < 1e-12) break;
    const sNew = s - x / dx;
    if (Math.abs(sNew - s) < 1e-8) return sNew;
    s = sNew;
  }

  let lo = 0, hi = 1;
  s = t;
  for (let i = 0; i < 20; i++) {
    const x = evalBezierX(cp1x, cp2x, s);
    if (Math.abs(x - t) < 1e-8) return s;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

function evaluateBezierY(cp1x: number, cp1y: number, cp2x: number, cp2y: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * cp1y + 3 * ms * s * s * cp2y + s * s * s;
}

function evalBezierX(cp1x: number, cp2x: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * cp1x + 3 * ms * s * s * cp2x + s * s * s;
}

function evalBezierXDeriv(cp1x: number, cp2x: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * cp1x + 6 * ms * s * (cp2x - cp1x) + 3 * s * s * (1 - cp2x);
}

// ============================================================
// 2. ParamDriver Evaluation
// ============================================================

/**
 * Apply ParamDriver evaluations to modifier parameters.
 * Drivers override keyframe-interpolated values for their target params.
 */
function applyParamDrivers(
  drivers: ParamDriver[],
  params: Record<string, ModifierParamValue>,
  frame: number,
  variableContext?: VariableContext,
): Record<string, ModifierParamValue> {
  const result = { ...params };

  for (const driver of drivers) {
    if (!driver.enabled) continue;

    // Check frame range
    const value = evaluateDriver(driver, frame, variableContext);
    if (value !== undefined) {
      result[driver.targetParam] = value;
    }
  }

  return result;
}

/**
 * Evaluate a single ParamDriver at the given frame.
 * Returns the computed value for the driver's target parameter.
 */
function evaluateDriver(
  driver: ParamDriver,
  frame: number,
  variableContext?: VariableContext,
): number | undefined {
  if (!driver.enabled) return undefined;

  // Resolve source for amplitude/base frequency
  const phase = resolveDriverSource(driver, frame, variableContext);

  // Compute waveform value
  const waveformValue = evaluateWaveform(
    driver.waveform,
    driver.frequency,
    driver.amplitude,
    driver.phase + phase,
    driver.offset,
    frame,
  );

  return waveformValue;
}

/**
 * Resolve a driver's source value (constant, node property, or variable).
 * Returns a phase offset based on the source.
 */
function resolveDriverSource(
  driver: ParamDriver,
  _frame: number,
  variableContext?: VariableContext,
): number {
  if (!driver.source) return 0;

  switch (driver.source.type) {
    case 'constant':
      return driver.source.value;
    case 'variable':
      if (variableContext) {
        return variableContext.values[driver.source.variableName] ?? 0;
      }
      return 0;
    case 'node_angle':
    case 'node_stretch':
      // These require access to node world transforms, which are not
      // available at the driver resolution stage. In the full pipeline,
      // these would be resolved after world transform computation.
      // For now, return 0 as a placeholder.
      return 0;
    default:
      return 0;
  }
}

/**
 * Evaluate a waveform at the given frame.
 * All waveforms are normalized to produce values in the range
 * [offset - amplitude, offset + amplitude].
 *
 * @param waveform - Waveform type
 * @param frequency - Cycles per second (Hz)
 * @param amplitude - Peak deviation from offset
 * @param phase - Phase offset in radians
 * @param offset - Center value
 * @param frame - Current frame number
 */
function evaluateWaveform(
  waveform: ParamDriverWaveform,
  frequency: number,
  amplitude: number,
  phase: number,
  offset: number,
  frame: number,
): number {
  // Convert frame to time in seconds (assume 12fps default; caller should adjust)
  const t = frame;
  const freq = Math.max(0.001, frequency); // Prevent zero frequency
  const omega = 2 * Math.PI * freq;

  switch (waveform) {
    case 'sine':
      return offset + amplitude * Math.sin(omega * t + phase);

    case 'square':
      return offset + amplitude * (Math.sin(omega * t + phase) >= 0 ? 1 : -1);

    case 'triangle': {
      const p = ((omega * t + phase) / (2 * Math.PI)) % 1;
      const tri = 4 * Math.abs(p - 0.5) - 1; // -1 to 1 triangle wave
      return offset + amplitude * tri;
    }

    case 'sawtooth': {
      const p = ((omega * t + phase) / (2 * Math.PI)) % 1;
      return offset + amplitude * (2 * p - 1); // -1 to 1 sawtooth
    }

    case 'noise': {
      // Seeded pseudo-random noise: hash the frame + phase
      const seed = Math.floor(t + phase * 100);
      const noise = seededNoise(seed);
      return offset + amplitude * (noise * 2 - 1); // -1 to 1
    }

    case 'bounce': {
      // Bouncing ball: parabolic arcs
      const p = ((omega * t + phase) / (2 * Math.PI)) % 1;
      const bounce = Math.abs(Math.sin(Math.PI * p)); // 0→1→0 parabola
      return offset + amplitude * (1 - bounce); // Bounce down from offset
    }

    case 'spring': {
      // Damped spring oscillation
      const damping = 0.95; // Default damping factor
      const p = ((omega * t + phase) / (2 * Math.PI));
      const decay = Math.pow(damping, p);
      return offset + amplitude * decay * Math.sin(omega * t + phase);
    }

    case 'custom':
      // Custom waveform: fall back to sine
      return offset + amplitude * Math.sin(omega * t + phase);

    default:
      return offset;
  }
}

/**
 * Simple seeded noise function (integer hash).
 * Returns a value in [0, 1].
 */
function seededNoise(seed: number): number {
  let h = seed | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b | 0;
  h = (h >> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff;
}

// ============================================================
// 3. Animation Variable Context
// ============================================================

/**
 * Variable context: maps variable names to their evaluated values.
 * Built by topologically sorting variables based on their dependencies
 * and evaluating them in order.
 */
export interface VariableContext {
  values: Record<string, number>;
}

const EMPTY_VARIABLE_CONTEXT: VariableContext = { values: {} };

/**
 * Build a variable context from animation variables.
 * Performs topological sort to resolve dependencies,
 * then evaluates each variable in order.
 *
 * @param variables - Animation variables with optional writer drivers
 * @param frame - Current frame number
 */
export function buildVariableContext(
  variables: AnimationVariable[],
  frame: number,
  allActiveDrivers: ParamDriver[] = [],
  frameRate: number = 12,
): VariableContext {
  if (variables.length === 0) return EMPTY_VARIABLE_CONTEXT;

  // H6: 委托给主路径的真实实现（拓扑排序 + writer 求值 + accumulator 支持）。
  // 之前这里三遍循环都只写 v.value，ParamDriver 驱动的变量恒为默认值且静默失效。
  // LiveAdapter 透传的 paramDrivers 在运行时就是 store 形状，直接可用。
  const storeVars = variables.map((v) => ({
    id: v.id,
    name: v.name,
    scope: 'global' as const,
    writerDriverId: v.writerDriverId ?? '',
    defaultValue: v.defaultValue ?? v.value,
    mode: 'value' as const,
  }));
  const realCtx = buildRealVariableContext(
    storeVars,
    allActiveDrivers as unknown as import('./types').ParamDriver[],
    frame,
    undefined,
    frameRate,
  );
  const values: Record<string, number> = {};
  for (const v of variables) {
    const val = realCtx.get(v.id);
    values[v.name] = val ?? v.value;
  }
  return { values };
}

/**
 * Get an empty variable context (no variables defined).
 */
export function getEmptyVariableContext(): VariableContext {
  return EMPTY_VARIABLE_CONTEXT;
}

/**
 * store 形 AnimationVariable（types.ts）→ 渲染管线形（unified-types）的共同映射。
 * 此前 renderPuppetViaUnifiedPipeline / renderUnifiedCharactersToCanvas 各自内联了一份。
 */
export function mapStoreAnimationVariables(
  vars: import('./types').AnimationVariable[] | undefined,
): AnimationVariable[] | undefined {
  if (!vars) return undefined;
  return vars.map((v) => ({
    id: v.id,
    name: v.name,
    value: (v as { defaultValue?: number }).defaultValue ?? 0,
    min: 0,
    max: 100,
    writerDriverId: (v as { writerDriverId?: string }).writerDriverId,
    defaultValue: (v as { defaultValue?: number }).defaultValue ?? 0,
  }));
}

/**
 * 蓝图 ctx.vars 适配：变量名 → 当前帧求值（buildVariableContext，含 writer 驱动）。
 * 蓝图 var 节点按名读 ctx.vars——此前所有求值入口都传 {}，var 节点恒回退自身默认值；
 * 统一从这里注入。无变量时返回空对象（行为与旧现状一致）。
 */
export function buildBlueprintVars(
  variables: AnimationVariable[] | undefined,
  frame: number,
  allActiveDrivers: ParamDriver[] = [],
  frameRate: number = 12,
): Record<string, number> {
  if (!variables || variables.length === 0) return {};
  return buildVariableContext(variables, frame, allActiveDrivers, frameRate).values;
}

// ============================================================
// 4. Combined Resolution for Render Pipeline
// ============================================================

/**
 * Resolved modifier: a ModifierInstance with its params resolved
 * for a specific frame. This is the output of the full resolution
 * pipeline and is ready for application during rendering.
 */
export interface ResolvedModifier {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, ModifierParamValue>;
  coordinateMode?: string;
  blendMode?: string;
  startFrame?: number;
  endFrame?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
}

/**
 * Resolve all modifiers on a node for a specific frame.
 * This is the main entry point called by the render pipeline
 * to get frame-specific modifier parameters.
 *
 * The resolution process:
 * 1. Filter modifiers by frame range (startFrame/endFrame)
 * 2. For each active modifier, resolve paramKeyframes + paramDrivers
 * 3. Apply fade in/out weighting based on frame position
 * 4. Return resolved modifiers ready for rendering
 */
export function resolveNodeModifiers(
  modifiers: ModifierInstance[],
  frame: number,
  variableContext?: VariableContext,
): ResolvedModifier[] {
  const resolved: ResolvedModifier[] = [];

  for (const mod of modifiers) {
    if (!mod.enabled) continue;

    // Check frame range
    // IMPORTANT: PartAnimationModifier uses -1 to mean "always active" at that boundary.
    // This convention must be handled here, otherwise modifiers with startFrame=-1 or
    // endFrame=-1 are incorrectly skipped (frame > -1 is always true for frame >= 0).
    const rawStart = mod.startFrame;
    const rawEnd = mod.endFrame;
    const effectiveStart = (rawStart === undefined || rawStart === -1) ? -Infinity : rawStart;
    const effectiveEnd = (rawEnd === undefined || rawEnd === -1) ? Infinity : rawEnd;

    if (frame < effectiveStart || frame > effectiveEnd) continue;

    // Resolve params
    const params = resolveModifierParamsAtFrame(mod, frame, variableContext);

    resolved.push({
      id: mod.id,
      type: mod.type,
      enabled: true,
      params,
      coordinateMode: mod.coordinateMode,
      blendMode: mod.blendMode,
      startFrame: mod.startFrame,
      endFrame: mod.endFrame,
      fadeInFrames: mod.fadeInFrames,
      fadeOutFrames: mod.fadeOutFrames,
    });
  }

  return resolved;
}

/**
 * Compute a fade factor based on the modifier's position within
 * its active frame range. Handles fade-in and fade-out at the
 * boundaries of the range.
 *
 * @param frame - Current frame
 * @param startFrame - Modifier start frame
 * @param endFrame - Modifier end frame
 * @param fadeInFrames - Number of frames for fade-in (0 = instant)
 * @param fadeOutFrames - Number of frames for fade-out (0 = instant)
 * @returns Weight factor in [0, 1]
 */
function computeFadeWeight(
  frame: number,
  startFrame: number,
  endFrame: number,
  fadeInFrames: number = 0,
  fadeOutFrames: number = 0,
): number {
  let weight = 1.0;

  // Fade in
  if (fadeInFrames > 0 && frame >= startFrame && frame < startFrame + fadeInFrames) {
    weight = Math.min(weight, (frame - startFrame) / fadeInFrames);
  }

  // Fade out
  if (fadeOutFrames > 0 && frame > endFrame - fadeOutFrames && frame <= endFrame) {
    weight = Math.min(weight, (endFrame - frame) / fadeOutFrames);
  }

  return Math.max(0, Math.min(1, weight));
}

// ============================================================
// 5. Procedural Animation (Transform-level Modifiers)
// ============================================================

/**
 * Compute the transform contribution from animation modifiers
 * (pendulum, wheel, bounce, breath, wobble, gait, etc.)
 * at a given frame.
 *
 * These modifiers produce additive transform offsets (translation,
 * rotation, scale) that are applied on top of the keyframe-driven
 * base transform.
 */
export function computeAnimationModifierTransform(
  modifiers: ResolvedModifier[],
  frame: number,
  frameRate: number = 12,
): { translateX: number; translateY: number; rotation: number; scaleX: number; scaleY: number } {
  // H4/H5: 委托给主路径的真实实现。puppet 路径与非木偶路径行为完全一致：
  // 参数名（period/amplitude/radiusX…）、周期制时间基准、全部 ANIMATION_MODIFIER_TYPES。
  const acc = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  for (const mod of modifiers) {
    const partial = computeRealAnimationModifierTransform(
      mod as unknown as StoreModifierInstance,
      frame,
      frameRate,
    );
    acc.translateX += partial.translateX;
    acc.translateY += partial.translateY;
    acc.rotation += partial.rotation;
    acc.scaleX *= partial.scaleX;
    acc.scaleY *= partial.scaleY;
  }
  return acc;
}