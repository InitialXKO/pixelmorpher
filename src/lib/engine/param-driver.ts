// ============================================================
// PixelMorpher - ParamDriver Resolution & Variable Context
// resolveModifierParams, evaluateParamDriverWithSources, variable context,
// collectActiveParamDrivers, resolveAnimModifierParams, resolveStrokeDriverParams,
// bakeParamDriverToKeyframes, resolveKeyframeModifierParams
// ============================================================

import type {
  ModifierInstance,
  ModifierType,
  ModifierParamValue,
  ParamDriver,
  ParamDriverNumericParam,
  ParamSource,
  ParamDriverKeyframe,
  SecondaryParamDriver,
  AnimationVariable,
  InterpolationMode,
  ModifierParamKeyframe,
  PartAnimationModifier,
  StrokeParamDriver,
  Keyframe,
} from '../types';
import { sampleWaveformAtFrame } from '../csv-waveform';
import { hashString } from './noise';
import { applyInterpolationMode, cubicBezierEasing } from './interpolation';

function resolveModifierParams(
  modifier: ModifierInstance,
  frame: number,
  interpolationMode: InterpolationMode = 'linear',
  bezierCP1?: { x: number; y: number },
  bezierCP2?: { x: number; y: number },
): Record<string, ModifierParamValue> {
  // If no param keyframes, return base params as-is
  if (!modifier.paramKeyframes || modifier.paramKeyframes.length === 0) {
    return modifier.params;
  }

  // Sort param keyframes by frame
  const sorted = [...modifier.paramKeyframes].sort((a, b) => a.frame - b.frame);

  // Binary search: find the last keyframe with frame <= current frame
  let prevPk: ModifierParamKeyframe | null = null;
  let nextPk: ModifierParamKeyframe | null = null;

  let lo = 0, hi = sorted.length - 1, prevIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].frame <= frame) {
      prevIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (prevIdx >= 0) prevPk = sorted[prevIdx];
  if (prevIdx + 1 < sorted.length) nextPk = sorted[prevIdx + 1];

  // Start with base params (shallow copy)
  const result: Record<string, ModifierParamValue> = { ...modifier.params };

  // If exactly at a param keyframe, apply its values directly
  if (prevPk && prevPk.frame === frame) {
    Object.assign(result, prevPk.params);
    return result;
  }

  // If before any param keyframe, use base params
  if (!prevPk) {
    return result;
  }

  // If after the last param keyframe, hold its values
  if (!nextPk) {
    Object.assign(result, prevPk.params);
    return result;
  }

  // Interpolate between prevPk and nextPk
  const t = (frame - prevPk.frame) / (nextPk.frame - prevPk.frame);
  const easedT = applyInterpolationMode(t, interpolationMode, bezierCP1, bezierCP2);

  // Collect all param keys that appear in either keyframe
  const allKeys = new Set([
    ...Object.keys(prevPk.params),
    ...Object.keys(nextPk.params),
  ]);

  for (const key of allKeys) {
    const prevVal = prevPk.params[key];
    const nextVal = nextPk.params[key];
    const baseVal = modifier.params[key];

    if (prevVal !== undefined && nextVal !== undefined) {
      // Both keyframes have this param — interpolate
      if (typeof prevVal === 'number' && typeof nextVal === 'number') {
        result[key] = prevVal + (nextVal - prevVal) * easedT;
      } else {
        // Non-numeric: switch at midpoint
        result[key] = easedT < 0.5 ? prevVal : nextVal;
      }
    } else if (prevVal !== undefined && nextVal === undefined) {
      // Param only in prev keyframe — fade towards base value
      if (typeof prevVal === 'number' && typeof baseVal === 'number') {
        result[key] = prevVal + (baseVal - prevVal) * easedT;
      } else {
        result[key] = easedT < 0.5 ? prevVal : baseVal;
      }
    } else if (prevVal === undefined && nextVal !== undefined) {
      // Param only in next keyframe — fade from base value
      if (typeof nextVal === 'number' && typeof baseVal === 'number') {
        result[key] = baseVal + (nextVal - baseVal) * easedT;
      } else {
        result[key] = easedT < 0.5 ? baseVal : nextVal;
      }
    }
  }

  return result;
}

// ============================================================
// M7+M8: ParamDriver Resolution, Param Sources & Baking
// ============================================================

// ---- Perlin Noise Implementation for perlin_noise waveform ----

/** Simple 2D Perlin noise for ParamDriver waveform evaluation.
 *  Uses a permutation table and gradient hashing for smooth random variation. */
const PERLIN_PERM = new Uint8Array(512);
const PERLIN_GRAD: [number, number][] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

// Initialize Perlin permutation table with a fixed seed for deterministic results
(function initPerlinPerm() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with fixed seed
  let seed = 42;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807 + 0) % 2147483647;
    const j = seed % (i + 1);
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 256; i++) {
    PERLIN_PERM[i] = p[i];
    PERLIN_PERM[i + 256] = p[i];
  }
})();

function perlinFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function perlinLerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function perlinGrad(hash: number, x: number, y: number): number {
  const g = PERLIN_GRAD[hash & 7];
  return g[0] * x + g[1] * y;
}

function perlinNoise2D(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = perlinFade(xf);
  const v = perlinFade(yf);

  const aa = PERLIN_PERM[PERLIN_PERM[xi] + yi];
  const ab = PERLIN_PERM[PERLIN_PERM[xi] + yi + 1];
  const ba = PERLIN_PERM[PERLIN_PERM[xi + 1] + yi];
  const bb = PERLIN_PERM[PERLIN_PERM[xi + 1] + yi + 1];

  return perlinLerp(
    perlinLerp(perlinGrad(aa, xf, yf), perlinGrad(ba, xf - 1, yf), u),
    perlinLerp(perlinGrad(ab, xf, yf - 1), perlinGrad(bb, xf - 1, yf - 1), u),
    v,
  );
}

// ---- M8: ParamSource Resolution Pipeline ----

// P8: Frame-level ParamDriver evaluation cache.
// During playback, the same driver is evaluated at the same frame many times
// (once per part that references it). Cache the result to avoid redundant
// waveform computation. Keyed by "driverId:frame".
const _paramDriverEvalCache = new Map<string, number>();
const _PARAM_DRIVER_EVAL_CACHE_MAX = 1024;

/** Invalidate the ParamDriver evaluation cache.
 *  Call when project data changes (driver params, keyframes, etc.) */
export function invalidateParamDriverEvalCache(): void {
  _paramDriverEvalCache.clear();
}

/** Interpolate a ParamDriverKeyframe curve at a given frame.
 *  Returns undefined if no keyframes exist or frame is before the first keyframe. */
function interpolateDriverKeyframeCurve(
  keyframes: ParamDriverKeyframe[],
  frame: number,
): number | undefined {
  if (keyframes.length === 0) return undefined;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Exact match
  for (const kf of sorted) {
    if (kf.frame === frame) return kf.value;
  }

  // Before first keyframe
  if (frame < sorted[0].frame) return undefined;

  // After last keyframe — hold
  if (frame > sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value;

  // Find surrounding keyframes
  let prev: ParamDriverKeyframe | null = null;
  let next: ParamDriverKeyframe | null = null;
  for (const kf of sorted) {
    if (kf.frame <= frame) prev = kf;
    if (kf.frame > frame && !next) { next = kf; break; }
  }
  if (!prev || !next) return prev?.value;

  const t = (frame - prev.frame) / (next.frame - prev.frame);
  const mode = next.interpolation ?? 'linear';

  let easedT: number;
  if (mode === 'step') {
    easedT = 0;
  } else if (mode === 'bezier') {
    const cp1 = next.bezierCP1 ?? { x: 0.25, y: 0.1 };
    const cp2 = next.bezierCP2 ?? { x: 0.25, y: 1.0 };
    easedT = cubicBezierEasing(t, cp1.x, cp1.y, cp2.x, cp2.y);
  } else {
    easedT = t;
  }

  return prev.value + (next.value - prev.value) * easedT;
}

// ---- Phase Continuity (DDS Phase Accumulator) ----

/** Checkpoint for the phase accumulator cache.
 *  Stores the accumulated phase at a specific frame to avoid recomputing
 *  from startFrame on every evaluation. */
interface PhaseCheckpoint {
  frame: number;
  phase: number;
}

/** Per-driver phase accumulator cache.
 *  Key: driver.id, Value: sorted array of checkpoints.
 *  Invalidated when the driver's paramSources or source data change. */
const phaseCache = new Map<string, PhaseCheckpoint[]>();

/** Interval (in frames) between phase cache checkpoints.
 *  Larger values use less memory but require more sequential computation on scrub. */
const PHASE_CHECKPOINT_INTERVAL = 64;

/** Cached variable context from the previous frame evaluation.
 *  Used by accumulator variables (mode='accumulator') which need var[f-1] to compute var[f].
 *  Keyed by a composite of variable IDs to detect structural changes.
 *  Invalidated when variable definitions change. */
export let cachedVariableContext: VariableContext = new Map();
export let cachedVariableContextFrame: number = -1;
/** Hash of variable IDs to detect structural changes (add/remove/reorder). */
export let cachedVariableContextHash: string = '';

/** Invalidate the variable context cache.
 *  Call when animationVariables are added, removed, or their mode/writer changes. */
export function invalidateVariableContextCache(): void {
  cachedVariableContext = new Map();
  cachedVariableContextFrame = -1;
  cachedVariableContextHash = '';
}

/** Update the variable context cache (used by render-pipeline for accumulator support) */
export function setCachedVariableContext(ctx: VariableContext, frame: number, hash: string): void {
  cachedVariableContext = ctx;
  cachedVariableContextFrame = frame;
  cachedVariableContextHash = hash;
}

/** Invalidate the phase cache for a specific driver.
 *  Call when paramSources, keyframes, or any source data changes. */
export function invalidatePhaseCache(driverId: string): void {
  phaseCache.delete(driverId);
}

/** Invalidate all phase caches. Call on project load or major structural changes. */
function invalidateAllPhaseCaches(): void {
  phaseCache.clear();
}

/** Determine if a ParamDriver has a dynamic period source (non-constant).
 *  Only drivers with dynamic period need phase accumulation. */
function hasDynamicPeriod(driver: ParamDriver): boolean {
  const periodSource = driver.paramSources?.['period'];
  return periodSource !== undefined && periodSource.type !== 'constant';
}

/** Compute the accumulated phase for a ParamDriver at a given frame.
 *
 *  Phase continuity formula (DDS phase accumulator):
 *    Φ(f) = φ₀ + Σ_{k=startFrame+1}^{f} 2π / P(k)
 *  where φ₀ = initial phase offset (resolved at startFrame)
 *        P(k) = period at frame k (resolved from paramSources)
 *
 *  For constant period: Φ(f) = 2π × (f - startFrame) / P + φ₀  (analytical, O(1))
 *  For dynamic period:  sequential accumulation with checkpoint caching
 *
 *  @param driver The ParamDriver to compute phase for
 *  @param frame The target frame
 * @param variables Variable context for resolving Source 4 references
 *  @returns Accumulated phase in radians
 */
function computeAccumulatedPhase(
  driver: ParamDriver,
  frame: number,
  variables: VariableContext,
): number {
  const startFrame = driver.startFrame;

  // Initial phase offset: resolve at startFrame, treating phase as constant initial condition
  const phaseOffset = resolveParamValue(driver, 'phase', startFrame, variables);
  const phaseRad = (phaseOffset * Math.PI) / 180;

  // At or before startFrame: just the initial offset
  if (frame <= startFrame) return phaseRad;

  // Fast path: constant period → analytical formula
  if (!hasDynamicPeriod(driver)) {
    const period = Math.max(1, driver.period);
    return (2 * Math.PI * (frame - startFrame)) / period + phaseRad;
  }

  // Dynamic period: sequential accumulation with cache
  const checkpoints = phaseCache.get(driver.id) ?? [];
  const t = frame - startFrame;

  // Find the nearest checkpoint at or before the target frame
  let startIdx = 0;
  let startPhase = phaseRad;
  let startFrame_ = startFrame;

  for (let i = checkpoints.length - 1; i >= 0; i--) {
    if (checkpoints[i].frame <= frame) {
      startIdx = i;
      startPhase = checkpoints[i].phase;
      startFrame_ = checkpoints[i].frame;
      break;
    }
  }

  // Sequential accumulation from the checkpoint to the target frame
  let phase = startPhase;
  const newCheckpoints: PhaseCheckpoint[] = [];

  for (let f = startFrame_ + 1; f <= frame; f++) {
    const period = Math.max(1, resolveParamValue(driver, 'period', f, variables));
    phase += (2 * Math.PI) / period;

    // Store checkpoint at regular intervals
    const localFrame = f - startFrame;
    if (localFrame > 0 && localFrame % PHASE_CHECKPOINT_INTERVAL === 0) {
      newCheckpoints.push({ frame: f, phase });
    }
  }

  // Update cache: merge new checkpoints
  if (newCheckpoints.length > 0) {
    const existingCheckpoints = phaseCache.get(driver.id) ?? [];
    // Only keep checkpoints up to and including the current frame
    const filtered = existingCheckpoints.filter(c => c.frame <= frame);
    // Add new checkpoints that aren't duplicates
    const existingFrames = new Set(filtered.map(c => c.frame));
    for (const cp of newCheckpoints) {
      if (!existingFrames.has(cp.frame)) {
        filtered.push(cp);
      }
    }
    filtered.sort((a, b) => a.frame - b.frame);
    phaseCache.set(driver.id, filtered);
  }

  return phase;
}

/** Evaluate a SecondaryParamDriver at a given frame.
 *  SecondaryParamDrivers are depth-1 sub-drivers with constant-only parameters.
 *  Returns the modulation factor (1.0 = no modulation for multiply, 0.0 for add). */
function evaluateSecondaryDriver(
  secDriver: SecondaryParamDriver,
  frame: number,
): number {
  const startFrame = secDriver.startFrame;
  const endFrame = secDriver.endFrame >= 0 ? secDriver.endFrame : Infinity;
  if (frame < startFrame || frame > endFrame) {
    // Outside range: return identity for the modulation mode
    return secDriver.modMode === 'add' ? 0 : 1;
  }

  const t = frame - startFrame;
  const period = Math.max(1, secDriver.period);
  const phaseRad = (secDriver.phase * Math.PI) / 180;

  let waveValue: number;
  switch (secDriver.waveform) {
    case 'sine': {
      const totalDuration = endFrame - startFrame;
      const rampUp = Math.min(t / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      const rampDown = Math.min((totalDuration - t) / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      waveValue = Math.sin((2 * Math.PI * t) / period + phaseRad) * rampUp * rampDown;
      break;
    }
    case 'triangle': {
      const p = ((t / period + secDriver.phase / 360) % 1 + 1) % 1;
      waveValue = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      break;
    }
    case 'square': {
      const p = ((t / period + secDriver.phase / 360) % 1 + 1) % 1;
      waveValue = p < 0.5 ? 1 : -1;
      break;
    }
    case 'sawtooth': {
      const p = ((t / period + secDriver.phase / 360) % 1 + 1) % 1;
      waveValue = 2 * p - 1;
      break;
    }
    case 'linear_ramp': {
      const totalDuration = endFrame - startFrame;
      if (totalDuration <= 0) { waveValue = 0; break; }
      const progress = Math.min(1, Math.max(0, t / totalDuration));
      waveValue = progress;
      break;
    }
    case 'exponential_decay': {
      const totalDuration = endFrame - startFrame;
      if (totalDuration <= 0) { waveValue = 0; break; }
      const progress = Math.min(1, Math.max(0, t / totalDuration));
      waveValue = Math.exp(-secDriver.damping * 5 * progress);
      break;
    }
    case 'spring_oscillate': {
      const totalDuration = endFrame - startFrame;
      const progress = totalDuration > 0 ? t / totalDuration : 0;
      waveValue = Math.exp(-secDriver.damping * 5 * progress) * Math.sin((2 * Math.PI * t) / period + phaseRad);
      break;
    }
    case 'perlin_noise': {
      // Perlin noise: use frame/time as x coordinate, driver id for y variation
      const noiseX = t / Math.max(1, period);
      const noiseY = (hashCode(secDriver.id) % 100) * 0.01;
      waveValue = perlinNoise2D(noiseX, noiseY); // range roughly [-1, 1]
      break;
    }
    default:
      waveValue = 0;
  }

  // Apply modulation
  if (secDriver.modMode === 'add') {
    // Additive: baseValue + amplitude * wave
    return secDriver.baseValue + secDriver.amplitude * waveValue;
  } else {
    // Multiplicative (AM): baseValue + amplitude * wave, then used as multiplier
    // baseValue=1, amplitude=0 → multiplier=1 (no modulation)
    // baseValue=1, amplitude=0.5, sin=1 → multiplier=1.5
    return secDriver.baseValue + secDriver.amplitude * waveValue;
  }
}

/** Simple string hash for deterministic per-driver noise offset */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Variable resolution context — pre-computed variable values for the current frame. */
export type VariableContext = Map<string, number>;

/** P4-8: Shared empty context — avoids allocating new Map() for default parameters */
export const EMPTY_VARIABLE_CONTEXT: VariableContext = new Map();

/** Build the variable context for the current frame.
 *  Evaluates all variables in topological order (DAG-safe).
 *  Variables whose writer is inactive use defaultValue.
 *
 *  Accumulator variables (mode='accumulator') require the previous frame's context
 *  to compute the running sum: var[f] = var[f-1] + writer(f).
 *  Pass `prevContext` for correct accumulator evaluation; if omitted, accumulator
 *  variables start from their defaultValue. */
export function buildVariableContext(
  variables: AnimationVariable[],
  allActiveDrivers: ParamDriver[],
  frame: number,
  prevContext?: VariableContext,
): VariableContext {
  const ctx: VariableContext = new Map();

  if (variables.length === 0) return ctx;

  // Build driver lookup by id
  const driverMap = new Map<string, ParamDriver>();
  for (const d of allActiveDrivers) driverMap.set(d.id, d);

  // Build dependency graph and compute topological order
  const sorted = topologicalSortVariables(variables, driverMap);

  // Evaluate variables in topological order
  for (const variable of sorted) {
    const writer = driverMap.get(variable.writerDriverId);
    if (!writer || !writer.enabled || writer.isBaked) {
      // Writer inactive: for accumulator, carry forward previous value; for value mode, use default
      if (variable.mode === 'accumulator' && prevContext) {
        const prevVal = prevContext.get(variable.id);
        ctx.set(variable.id, prevVal !== undefined ? prevVal : variable.defaultValue);
      } else {
        ctx.set(variable.id, variable.defaultValue);
      }
      continue;
    }
    // Evaluate writer driver using current context (already-computed vars are available)
    const writerOutput = evaluateParamDriverWithSources(writer, frame, ctx);

    if (variable.mode === 'accumulator') {
      // Accumulator: var[f] = var[f-1] + writer(f)
      const prevVal = prevContext?.get(variable.id);
      const base = prevVal !== undefined ? prevVal : variable.defaultValue;
      ctx.set(variable.id, base + writerOutput);
    } else {
      // Value mode (default): var[f] = writer(f)
      ctx.set(variable.id, writerOutput);
    }
  }

  return ctx;
}

/** Topological sort of AnimationVariables based on their dependency graph.
 *  A variable depends on another if its writer's paramSources reference that variable. */
function topologicalSortVariables(
  variables: AnimationVariable[],
  driverMap: Map<string, ParamDriver>,
): AnimationVariable[] {
  const varById = new Map<string, AnimationVariable>();
  for (const v of variables) varById.set(v.id, v);

  // Build adjacency: variable → Set<variable> that depend on it
  const deps = new Map<string, Set<string>>(); // varId → Set of varIds it depends on
  for (const v of variables) {
    const depSet = new Set<string>();
    const writer = driverMap.get(v.writerDriverId);
    if (writer?.paramSources) {
      for (const source of Object.values(writer.paramSources)) {
        if (source.type === 'variable') {
          depSet.add(source.variableId);
        }
      }
    }
    deps.set(v.id, depSet);
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const v of variables) inDegree.set(v.id, 0);
  for (const [, depSet] of deps) {
    for (const depId of depSet) {
      if (inDegree.has(depId)) {
        inDegree.set(depId, (inDegree.get(depId) ?? 0) + 1);
      }
    }
  }

  // Invert: inDegree should count how many vars THIS var depends on that are other vars
  // Actually let's use a cleaner approach: inDegree[v] = number of vars that v depends on
  const result: AnimationVariable[] = [];
  const visited = new Set<string>();

  function visit(vId: string) {
    if (visited.has(vId)) return;
    visited.add(vId);
    const depSet = deps.get(vId);
    if (depSet) {
      for (const depId of depSet) {
        visit(depId);
      }
    }
    const v = varById.get(vId);
    if (v) result.push(v);
  }

  for (const v of variables) {
    visit(v.id);
  }

  return result;
}

/** Validate that variable dependency graph has no cycles.
 *  Returns { valid: true } or { valid: false, cycle: string[] of variable names }.
 *  Should be called before modifying writerDriverId or paramSources references. */
export function validateVariableGraph(
  variables: AnimationVariable[],
  driverMap: Map<string, ParamDriver>,
): { valid: boolean; cycle?: string[] } {
  const varById = new Map<string, AnimationVariable>();
  for (const v of variables) varById.set(v.id, v);

  // Build adjacency: varId → Set of varIds it depends on
  const deps = new Map<string, Set<string>>();
  for (const v of variables) {
    const depSet = new Set<string>();
    const writer = driverMap.get(v.writerDriverId);
    if (writer?.paramSources) {
      for (const source of Object.values(writer.paramSources)) {
        if (source.type === 'variable') {
          depSet.add(source.variableId);
        }
      }
    }
    deps.set(v.id, depSet);
  }

  // DFS cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const v of variables) color.set(v.id, WHITE);

  const path: string[] = [];

  function dfs(vId: string): boolean {
    color.set(vId, GRAY);
    path.push(vId);
    const depSet = deps.get(vId);
    if (depSet) {
      for (const depId of depSet) {
        if (!color.has(depId)) continue; // unknown variable, skip
        const c = color.get(depId);
        if (c === GRAY) {
          // Found cycle — extract it
          const cycleStart = path.indexOf(depId);
          const cycleVars = path.slice(cycleStart).map(id => varById.get(id)?.name ?? id);
          path.length = 0;
          return true; // cycle found
        }
        if (c === WHITE && dfs(depId)) return true;
      }
    }
    path.pop();
    color.set(vId, BLACK);
    return false;
  }

  for (const v of variables) {
    if (color.get(v.id) === WHITE) {
      if (dfs(v.id)) {
        return { valid: false, cycle: path.length > 0 ? path : undefined };
      }
    }
  }

  return { valid: true };
}

/** Resolve a single ParamDriver numeric parameter value from its source.
 *  Falls back to the constant field value if no source is set or source evaluation fails. */
function resolveParamValue(
  driver: ParamDriver,
  param: ParamDriverNumericParam,
  frame: number,
  variables: VariableContext,
): number {
  const source = driver.paramSources?.[param];

  // No source or constant → read field directly
  if (!source || source.type === 'constant') {
    return driver[param] as number;
  }

  // Source 2: keyframe curve
  if (source.type === 'keyframes') {
    const interpolated = interpolateDriverKeyframeCurve(source.keyframes, frame);
    if (interpolated !== undefined) return interpolated;
    // Fallback to constant if frame is before first keyframe
    return driver[param] as number;
  }

  // Source 3: secondary driver
  if (source.type === 'secondary_driver') {
    const modulationValue = evaluateSecondaryDriver(source.driver, frame);
    const baseValue = driver[param] as number;
    if (source.driver.modMode === 'add') {
      return baseValue + modulationValue;
    } else {
      // Multiplicative (AM): baseValue * modulationValue
      // For amplitude modulation: baseValue=5, modValue=1.2 → 6
      // For frequency modulation: baseValue=16, modValue=1.5 → 24
      return baseValue * modulationValue;
    }
  }

  // Source 4: external variable
  if (source.type === 'variable') {
    const varValue = variables.get(source.variableId);
    if (varValue !== undefined) return varValue;
    // Variable not found or not yet evaluated — fallback to constant
    return driver[param] as number;
  }

  return driver[param] as number;
}

/** Evaluate a ParamDriver at a given frame, resolving all paramSources.
 *  This is the central evaluation function that replaces direct evaluateParamDriver calls
 *  in the rendering pipeline. Falls back to evaluateParamDriver for drivers without paramSources.
 *
 *  Phase continuity: when the driver has a dynamic period source (Source 2/3/4 on 'period'),
 *  the accumulated phase is computed via DDS integration instead of the analytical formula,
 *  ensuring seamless waveform transitions when frequency changes. */
function evaluateParamDriverWithSources(
  driver: ParamDriver,
  frame: number,
  variables: VariableContext = new Map(),
): number {
  // P8: Check frame-level evaluation cache — skip redundant waveform computation
  // when the same driver is evaluated multiple times per frame (common in playback)
  const cacheKey = `${driver.id}:${frame}`;
  const cached = _paramDriverEvalCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: number;

  // If no paramSources, use the fast path (direct evaluateParamDriver)
  if (!driver.paramSources || Object.keys(driver.paramSources).length === 0) {
    result = evaluateParamDriver(driver, frame);
  } else {
    // Check active range
    const startFrame = driver.startFrame;
    const endFrame = driver.endFrame >= 0 ? driver.endFrame : Infinity;
    if (frame < startFrame || frame > endFrame) {
      result = resolveParamValue(driver, 'baseValue', frame, variables);
    } else {
      // Resolve non-phase parameters from their sources
      const amplitude = resolveParamValue(driver, 'amplitude', frame, variables);
      const baseValue = resolveParamValue(driver, 'baseValue', frame, variables);
      const endValue = resolveParamValue(driver, 'endValue', frame, variables);
      const period = resolveParamValue(driver, 'period', frame, variables);
      const phase = resolveParamValue(driver, 'phase', frame, variables);
      const damping = resolveParamValue(driver, 'damping', frame, variables);

      // Build a temporary driver with resolved values for evaluation
      const resolvedDriver: ParamDriver = {
        ...driver,
        amplitude,
        baseValue,
        endValue,
        period,
        phase,
        damping,
      };

      // Phase continuity: compute accumulated phase for dynamic period sources.
      if (hasDynamicPeriod(driver)) {
        const accumulatedPhase = computeAccumulatedPhase(driver, frame, variables);
        result = evaluateParamDriver(resolvedDriver, frame, accumulatedPhase);
      } else {
        result = evaluateParamDriver(resolvedDriver, frame);
      }
    }
  }

  // P8: Store in frame-level cache with LRU eviction
  if (_paramDriverEvalCache.size >= _PARAM_DRIVER_EVAL_CACHE_MAX) {
    const firstKey = _paramDriverEvalCache.keys().next().value;
    if (firstKey !== undefined) _paramDriverEvalCache.delete(firstKey);
  }
  _paramDriverEvalCache.set(cacheKey, result);

  return result;
}

/** Evaluate a ParamDriver at a given frame using its constant parameters.
 *  This is the base evaluator that uses the analytical formula for constant period.
 *  For dynamic period sources, evaluateParamDriverWithSources uses DDS integration instead.
 *
 *  @param driver The ParamDriver to evaluate
 *  @param frame The target frame
 *  @param overridePhase If provided, use this phase instead of computing from driver parameters
 */
function evaluateParamDriver(
  driver: ParamDriver,
  frame: number,
  overridePhase?: number,
): number {
  const startFrame = driver.startFrame;
  const endFrame = driver.endFrame >= 0 ? driver.endFrame : Infinity;
  if (frame < startFrame || frame > endFrame) {
    return driver.baseValue;
  }

  const t = frame - startFrame;
  const period = Math.max(1, driver.period);
  const phaseRad = overridePhase ?? (driver.phase * Math.PI) / 180;

  // Compute waveform value
  let waveValue: number;
  switch (driver.waveform) {
    case 'sine': {
      const totalDuration = endFrame - startFrame;
      const rampUp = Math.min(t / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      const rampDown = Math.min((totalDuration - t) / Math.max(1, Math.min(3, totalDuration * 0.1)), 1);
      waveValue = Math.sin((2 * Math.PI * t) / period + phaseRad) * rampUp * rampDown;
      break;
    }
    case 'triangle': {
      const p = ((t / period + driver.phase / 360) % 1 + 1) % 1;
      waveValue = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      break;
    }
    case 'square': {
      const p = ((t / period + driver.phase / 360) % 1 + 1) % 1;
      waveValue = p < 0.5 ? 1 : -1;
      break;
    }
    case 'sawtooth': {
      const p = ((t / period + driver.phase / 360) % 1 + 1) % 1;
      waveValue = 2 * p - 1;
      break;
    }
    case 'linear_ramp': {
      const totalDuration = endFrame - startFrame;
      if (totalDuration <= 0) { waveValue = 0; break; }
      const progress = Math.min(1, Math.max(0, t / totalDuration));
      waveValue = progress;
      break;
    }
    case 'exponential_decay': {
      const totalDuration = endFrame - startFrame;
      if (totalDuration <= 0) { waveValue = 0; break; }
      const progress = Math.min(1, Math.max(0, t / totalDuration));
      waveValue = Math.exp(-driver.damping * 5 * progress);
      break;
    }
    case 'spring_oscillate': {
      const totalDuration = endFrame - startFrame;
      const progress = totalDuration > 0 ? t / totalDuration : 0;
      waveValue = Math.exp(-driver.damping * 5 * progress) * Math.sin((2 * Math.PI * t) / period + phaseRad);
      break;
    }
    default:
      waveValue = 0;
  }

  // Compute output: interpolate from baseValue to endValue over the duration
  const totalDuration = endFrame - startFrame;
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, t / totalDuration)) : 0;
  const baseAtFrame = driver.baseValue + (driver.endValue - driver.baseValue) * progress;
  return baseAtFrame + driver.amplitude * waveValue;
}

/**
 * Collect active ParamDrivers for a modifier by walking backward through keyframes.
 *
 * ParamDrivers use step-interpolation persistence: once set on a keyframe, they remain
 * active on subsequent keyframes until explicitly overridden or stopped.
 *
 * Resolution order (for each paramName):
 * 1. The current modifier's own paramDrivers (if defined) take priority.
 *    - paramDrivers with entries → use them (may stop or override inherited drivers)
 *    - paramDrivers = [] → explicitly stop all inherited drivers for this modifier
 *    - paramDrivers = undefined → inherit from previous keyframes (step interpolation)
 * 2. If the current modifier doesn't define paramDrivers, scan backward through
 *    earlier keyframes of the same part to find the nearest modifier of the same type
 *    that has paramDrivers defined (either entries or empty array).
 *
 * @param modifierType The type of modifier to match (e.g. 'translate', 'rotate')
 * @param currentModDrivers The current modifier's own paramDrivers (may be undefined)
 * @param partKeyframes All keyframes for this part, sorted by frame ascending
 * @param currentFrame The frame being rendered
 * @returns The effective ParamDriver[] to use for this modifier
 */
export function collectActiveParamDrivers(
  modifierType: ModifierType,
  currentModDrivers: ParamDriver[] | undefined,
  partKeyframes: Keyframe[],
  currentFrame: number,
): ParamDriver[] | undefined {
  // If the current modifier explicitly defines paramDrivers, use it directly.
  // This includes both non-empty arrays (has drivers) and empty arrays (stop inheriting).
  if (currentModDrivers !== undefined) return currentModDrivers;

  // paramDrivers is undefined → inherit from the nearest earlier keyframe
  // that has a modifier of the same type with defined paramDrivers.
  // Walk backward through keyframes at or before currentFrame.
  for (let i = partKeyframes.length - 1; i >= 0; i--) {
    const kf = partKeyframes[i];
    if (kf.frame > currentFrame) continue;
    const mod = kf.modifiers.find(m => m.type === modifierType);
    if (mod && mod.paramDrivers !== undefined) {
      return mod.paramDrivers;
    }
  }

  // No earlier keyframe defines paramDrivers for this modifier type → no drivers.
  return undefined;
}

/**
 * Apply active ParamDriver values on top of the resolved params.
 * ParamDrivers override individual numeric params — they take priority
 * over both base params and paramKeyframes for the driven parameter.
 * Only enabled, non-baked drivers contribute.
 *
 * Now supports paramSources: each driver's parameters can come from
 * constant, keyframe curves, secondary drivers, or external variables.
 * The variableContext provides pre-computed variable values for the current frame.
 */
function applyParamDrivers(
  params: Record<string, ModifierParamValue>,
  paramDrivers: ParamDriver[] | undefined,
  frame: number,
  variableContext?: VariableContext,
): Record<string, ModifierParamValue> {
  if (!paramDrivers || paramDrivers.length === 0) return params;

  // P4-2: Only spread params when at least one active driver will modify them.
  // This avoids allocating a new object when no drivers are actually active.
  let hasActiveDriver = false;
  for (const driver of paramDrivers) {
    if (driver.enabled && !driver.isBaked) { hasActiveDriver = true; break; }
  }
  if (!hasActiveDriver) return params;

  const result = { ...params };
  for (const driver of paramDrivers) {
    if (!driver.enabled || driver.isBaked) continue;
    // Use evaluateParamDriverWithSources to resolve paramSources (sources 2/3/4)
    // Falls back to evaluateParamDriver for drivers without paramSources (source 1 only)
    const value = evaluateParamDriverWithSources(driver, frame, variableContext ?? EMPTY_VARIABLE_CONTEXT);
    result[driver.paramName] = value;
  }
  return result;
}

/**
 * M7: Resolve paramKeyframes and paramDrivers for a PartAnimationModifier.
 * Works the same as resolveKeyframeModifierParams but for PartAnimationModifier
 * (which lacks coordinateMode but has the same params/paramKeyframes/paramDrivers shape).
 * Returns a new object with resolved params.
 */
export function resolveAnimModifierParams(
  mod: PartAnimationModifier,
  frame: number,
  variableContext?: VariableContext,
): PartAnimationModifier {
  const hasParamKeyframes = mod.paramKeyframes && mod.paramKeyframes.length > 0;
  const hasActiveDrivers = mod.paramDrivers && mod.paramDrivers.length > 0 &&
    mod.paramDrivers.some(d => d.enabled && !d.isBaked);

  if (!hasParamKeyframes && !hasActiveDrivers) return mod;

  // Reuse the same resolution logic by treating the anim modifier like a ModifierInstance
  let params = mod.params;
  if (hasParamKeyframes) {
    // Use resolveModifierParams by casting (safe — same shape for params/paramKeyframes)
    params = resolveModifierParams(mod as unknown as ModifierInstance, frame);
  }
  if (hasActiveDrivers) {
    params = applyParamDrivers(params, mod.paramDrivers, frame, variableContext ?? EMPTY_VARIABLE_CONTEXT);
  }
  return { ...mod, params };
}

/**
 * M7+: Resolve paramKeyframes and paramDrivers for a StrokeParamDriver.
 * StrokeParamDriver has its own time-domain animation capability:
 * its numeric fields (center, amplitude, width, frequency, phase) can be
 * driven by paramKeyframes and paramDrivers over time.
 *
 * For example, a linear_ramp ParamDriver on 'center' from 0→1 over frames 0–15
 * makes a bump travel along the stroke path.
 */
export function resolveStrokeDriverParams(
  driver: StrokeParamDriver,
  frame: number,
  variableContext?: VariableContext,
): StrokeParamDriver {
  const hasParamKeyframes = driver.paramKeyframes && driver.paramKeyframes.length > 0;
  const hasActiveDrivers = driver.paramDrivers && driver.paramDrivers.length > 0 &&
    driver.paramDrivers.some(d => d.enabled && !d.isBaked);

  if (!hasParamKeyframes && !hasActiveDrivers) return driver;

  // Build a "params" object from the driver's numeric fields
  let params: Record<string, ModifierParamValue> = {
    center: driver.center,
    amplitude: driver.amplitude,
    width: driver.width,
    frequency: driver.frequency,
    phase: driver.phase,
  };

  // Apply paramKeyframes (reuse resolveModifierParams logic)
  if (hasParamKeyframes) {
    const fakeMod: ModifierInstance = {
      id: driver.id,
      type: 'translate' as ModifierType,
      enabled: true,
      collapsed: false,
      params,
      startFrame: 0,
      endFrame: -1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      blendMode: 'add',
      coordinateMode: 'world',
      paramKeyframes: driver.paramKeyframes,
    };
    params = resolveModifierParams(fakeMod, frame);
  }

  // Apply paramDrivers (no more keyframe boundary clamping)
  if (hasActiveDrivers) {
    params = applyParamDrivers(params, driver.paramDrivers, frame, variableContext ?? EMPTY_VARIABLE_CONTEXT);
  }

  // Write resolved values back into the driver
  return {
    ...driver,
    center: typeof params.center === 'number' ? params.center : driver.center,
    amplitude: typeof params.amplitude === 'number' ? params.amplitude : driver.amplitude,
    width: typeof params.width === 'number' ? params.width : driver.width,
    frequency: typeof params.frequency === 'number' ? params.frequency : driver.frequency,
    phase: typeof params.phase === 'number' ? params.phase : driver.phase,
  };
}

/**
 * Bake a ParamDriver into consecutive ModifierParamKeyframes.
 * For each frame in the driver's range, computes the driver value and
 * creates a param keyframe. After baking, the driver is marked as baked
 * and disabled (its values are now in paramKeyframes for manual editing).
 *
 * M8: Now uses evaluateParamDriverWithSources to resolve paramSources.
 * The variableContext provides current variable values. When baking a driver
 * that references variables, those variable values are frozen into the keyframes.
 *
 * @returns Array of new ModifierParamKeyframe objects generated by baking
 */
export function bakeParamDriverToKeyframes(
  driver: ParamDriver,
  existingParamKeyframes: ModifierParamKeyframe[],
  totalFrames: number,
  variableContext?: VariableContext,
): { paramKeyframes: ModifierParamKeyframe[]; driverUpdates: Partial<ParamDriver> } {
  const startFrame = driver.startFrame;
  const endFrame = driver.endFrame >= 0 ? driver.endFrame : totalFrames - 1;

  // Build a map of existing param keyframes (excluding ones for this driver's param at driven frames)
  const existingMap = new Map<number, ModifierParamKeyframe>();
  for (const pkf of existingParamKeyframes) {
    existingMap.set(pkf.frame, pkf);
  }

  // Generate param keyframes for every frame in the driver's range
  const newPkfs: ModifierParamKeyframe[] = [];
  for (let f = startFrame; f <= endFrame; f++) {
    // Use evaluateParamDriverWithSources to resolve paramSources (sources 2/3/4)
    const value = evaluateParamDriverWithSources(driver, f, variableContext ?? EMPTY_VARIABLE_CONTEXT);
    const existing = existingMap.get(f);
    if (existing) {
      // Merge driver value into existing keyframe (driver overrides the driven param)
      newPkfs.push({
        ...existing,
        params: { ...existing.params, [driver.paramName]: value },
      });
    } else {
      // Create new keyframe with only the driven param
      newPkfs.push({
        id: crypto.randomUUID(),
        frame: f,
        params: { [driver.paramName]: value },
      });
    }
  }

  // Keep param keyframes outside the driver's range
  const outsidePkfs = existingParamKeyframes.filter(
    (pkf) => pkf.frame < startFrame || pkf.frame > endFrame
  );

  // Combine and sort
  const allPkfs = [...outsidePkfs, ...newPkfs].sort((a, b) => a.frame - b.frame);

  return {
    paramKeyframes: allPkfs,
    driverUpdates: {
      isBaked: true,
      enabled: false,
    },
  };
}

/**
 * Resolve all modifier params for a keyframe at a given frame.
 * Returns a new array of modifiers with interpolated params from paramKeyframes
 * and ParamDriver-computed values applied on top.
 *
 * Note: keyframeEndFrame clamping has been removed — ParamDriver lifetime is
 * controlled by its own startFrame/endFrame, not by keyframe boundaries.
 */
export function resolveKeyframeModifierParams(
  modifiers: ModifierInstance[],
  frame: number,
  interpolationMode: InterpolationMode = 'linear',
  bezierCP1?: { x: number; y: number },
  bezierCP2?: { x: number; y: number },
  variableContext?: VariableContext,
): ModifierInstance[] {
  // P4-3: Skip object allocation when no modifier needs param resolution.
  // Most modifiers have no paramKeyframes or active paramDrivers — return as-is.
  return modifiers.map((mod) => {
    const hasKeyframes = mod.paramKeyframes && mod.paramKeyframes.length > 0;
    const hasActiveDrivers = mod.paramDrivers && mod.paramDrivers.length > 0 &&
      mod.paramDrivers.some(d => d.enabled && !d.isBaked);

    if (!hasKeyframes && !hasActiveDrivers) return mod;

    // First resolve paramKeyframes via interpolation
    let params = resolveModifierParams(mod, frame, interpolationMode, bezierCP1, bezierCP2);
    // Then apply ParamDriver values on top (drivers override interpolated values)
    // No more keyframeEndFrame clamping — drivers span freely across keyframes
    params = applyParamDrivers(params, mod.paramDrivers, frame, variableContext ?? EMPTY_VARIABLE_CONTEXT);
    return { ...mod, params };
  });
}

// ============================================================
