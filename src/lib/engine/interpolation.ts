// ============================================================
// PixelMorpher - Keyframe Interpolation
// cubicBezierEasing, applyInterpolationMode, interpolateModifiers
// ============================================================

import type {
  ModifierInstance,
  ModifierParamValue,
  InterpolationMode,
} from '../types';

// ============================================================
// Keyframe Interpolation
// ============================================================

// P9: Frame-level interpolation cache — avoid redundant interpolation computation
// during playback when the same part/keyframe pair is rendered multiple times.
// Key: "prevKfId:nextKfId:quantizedT" → cached result
const _interpolationCache = new Map<string, ModifierInstance[]>();
const _INTERPOLATION_CACHE_MAX = 512;

/** Invalidate the interpolation cache. Call when keyframe data changes. */
function invalidateInterpolationCache(): void {
  _interpolationCache.clear();
}

// ============================================================
// Bezier Easing for Interpolation
// ============================================================

/** Default bezier control points (CSS ease curve) */
const DEFAULT_CP1 = { x: 0.25, y: 0.1 };
const DEFAULT_CP2 = { x: 0.25, y: 1.0 };

/**
 * Solve a cubic bezier easing curve for a given x value using binary subdivision.
 *
 * Given a cubic bezier with control points (0,0), (cp1x,cp1y), (cp2x,cp2y), (1,1),
 * find the parameter `s` such that the x-coordinate at `s` equals `t`.
 * Then return the y-coordinate at `s` as the eased value.
 *
 * @param t The input progress value [0, 1]
 * @param cp1x Control point 1 x
 * @param cp1y Control point 1 y
 * @param cp2x Control point 2 x
 * @param cp2y Control point 2 y
 * @returns The eased progress value
 */
export function cubicBezierEasing(
  t: number,
  cp1x: number = DEFAULT_CP1.x,
  cp1y: number = DEFAULT_CP1.y,
  cp2x: number = DEFAULT_CP2.x,
  cp2y: number = DEFAULT_CP2.y,
): number {
  // Clamp t to [0, 1]
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Evaluate cubic bezier x at parameter s
  const bezierX = (s: number): number => {
    const ms = 1 - s;
    return ms * ms * ms * 0 + 3 * ms * ms * s * cp1x + 3 * ms * s * s * cp2x + s * s * s * 1;
  };

  // Evaluate cubic bezier y at parameter s
  const bezierY = (s: number): number => {
    const ms = 1 - s;
    return ms * ms * ms * 0 + 3 * ms * ms * s * cp1y + 3 * ms * s * s * cp2y + s * s * s * 1;
  };

  // Binary subdivision to find s such that bezierX(s) ≈ t
  const MAX_ITERATIONS = 12;
  const EPSILON = 1e-7;
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const xMid = bezierX(mid);
    if (Math.abs(xMid - t) < EPSILON) {
      return bezierY(mid);
    }
    if (xMid < t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Return y at the midpoint of the final interval
  return bezierY((lo + hi) / 2);
}

/**
 * Apply interpolation mode to transform the raw t value into an eased t.
 */
export function applyInterpolationMode(
  t: number,
  mode: InterpolationMode,
  bezierCP1?: { x: number; y: number },
  bezierCP2?: { x: number; y: number },
): number {
  switch (mode) {
    case 'step':
      // Hold at start value until the very last moment
      return t >= 1 ? 1 : 0;
    case 'bezier':
      return cubicBezierEasing(
        t,
        bezierCP1?.x ?? DEFAULT_CP1.x,
        bezierCP1?.y ?? DEFAULT_CP1.y,
        bezierCP2?.x ?? DEFAULT_CP2.x,
        bezierCP2?.y ?? DEFAULT_CP2.y,
      );
    case 'linear':
    default:
      return t;
  }
}

/**
 * Interpolate between two keyframe modifier stacks.
 * Matches modifiers by type (not by array index) to avoid incorrect
 * interpolation when modifier stacks have different orderings.
 *
 * @param from Source modifier stack
 * @param to Target modifier stack
 * @param t Raw interpolation progress [0, 1]
 * @param mode Interpolation mode: 'linear', 'bezier', or 'step'
 * @param bezierCP1 Bezier control point 1 (used when mode is 'bezier')
 * @param bezierCP2 Bezier control point 2 (used when mode is 'bezier')
 */
export function interpolateModifiers(
  from: ModifierInstance[],
  to: ModifierInstance[],
  t: number,
  mode: InterpolationMode = 'linear',
  bezierCP1?: { x: number; y: number },
  bezierCP2?: { x: number; y: number },
  _cacheKey?: string, // P9: Optional cache key for frame-level caching
): ModifierInstance[] {
  // P4-7: Fast path — at keyframe boundaries, skip interpolation entirely
  if (t <= 0) return from;
  if (t >= 1 && mode !== 'bezier') return to;

  // P9: Check interpolation cache if cache key provided
  if (_cacheKey) {
    const cached = _interpolationCache.get(_cacheKey);
    if (cached) return cached;
  }

  const result: ModifierInstance[] = [];

  // Apply interpolation mode to ease the raw t value
  const easedT = applyInterpolationMode(t, mode, bezierCP1, bezierCP2);

  // Build index: type → array of { index, modifier } for O(1) type lookup
  const toByType = new Map<string, { idx: number; mod: ModifierInstance }[]>();
  for (let j = 0; j < to.length; j++) {
    const entry = { idx: j, mod: to[j] };
    const list = toByType.get(to[j].type);
    if (list) {
      list.push(entry);
    } else {
      toByType.set(to[j].type, [entry]);
    }
  }

  // Track which 'to' modifiers have been matched (by index)
  const matchedTo = new Set<number>();

  // First pass: match 'from' modifiers with 'to' modifiers by type
  for (const fromMod of from) {
    // O(1) type lookup instead of O(M) linear scan
    const candidates = toByType.get(fromMod.type);
    let toMatch: { idx: number; mod: ModifierInstance } | null = null;
    if (candidates) {
      for (const c of candidates) {
        if (!matchedTo.has(c.idx)) {
          toMatch = c;
          break;
        }
      }
    }

    if (toMatch) {
      matchedTo.add(toMatch.idx);
      const toMod = toMatch.mod;

      // Interpolate numeric params between matched modifiers using easedT
      const params: Record<string, ModifierParamValue> = {};
      for (const key of Object.keys(fromMod.params)) {
        const fromVal = fromMod.params[key];
        const toVal = toMod.params[key];
        if (typeof fromVal === 'number' && typeof toVal === 'number') {
          params[key] = fromVal + (toVal - fromVal) * easedT;
        } else {
          params[key] = easedT < 0.5 ? fromVal : toVal;
        }
      }

      result.push({
        id: fromMod.id,
        type: fromMod.type,
        enabled: fromMod.enabled,
        collapsed: fromMod.collapsed,
        params,
        startFrame: fromMod.startFrame ?? -1,
        endFrame: fromMod.endFrame ?? -1,
        fadeInFrames: fromMod.fadeInFrames ?? 0,
        fadeOutFrames: fromMod.fadeOutFrames ?? 0,
        blendMode: fromMod.blendMode ?? 'add',
        coordinateMode: fromMod.coordinateMode ?? 'world',
        // paramKeyframes and paramDrivers are NOT carried over from interpolation.
        // They use step-interpolation persistence: the render loop resolves them
        // via collectActiveParamDrivers (walking back through keyframes).
        // Setting undefined ensures inheritance from the nearest earlier keyframe.
        paramKeyframes: undefined,
        paramDrivers: undefined,
      });
    } else {
      // No matching 'to' modifier — fade out the 'from' modifier
      // Interpolate numeric params towards 0/default values using easedT
      const params: Record<string, ModifierParamValue> = {};
      for (const key of Object.keys(fromMod.params)) {
        const fromVal = fromMod.params[key];
        if (typeof fromVal === 'number') {
          // Fade towards zero for offsets, towards 1 for scales, towards 0 for angles
          const defaultVal = key === 'scale' || key === 'scaleX' || key === 'scaleY' ? 1 : 0;
          params[key] = fromVal + (defaultVal - fromVal) * easedT;
        } else {
          params[key] = fromVal;
        }
      }
      result.push({
        id: fromMod.id,
        type: fromMod.type,
        enabled: fromMod.enabled,
        collapsed: fromMod.collapsed,
        params,
        startFrame: fromMod.startFrame ?? -1,
        endFrame: fromMod.endFrame ?? -1,
        fadeInFrames: fromMod.fadeInFrames ?? 0,
        fadeOutFrames: fromMod.fadeOutFrames ?? 0,
        blendMode: fromMod.blendMode ?? 'add',
        coordinateMode: fromMod.coordinateMode ?? 'world',
        paramKeyframes: undefined,
        paramDrivers: undefined,
      });
    }
  }

  // Second pass: add 'to' modifiers that were not matched (new modifiers appearing)
  for (let j = 0; j < to.length; j++) {
    if (matchedTo.has(j)) continue;
    const toMod = to[j];

    // Fade in the new modifier from default values using easedT
    const params: Record<string, ModifierParamValue> = {};
    for (const key of Object.keys(toMod.params)) {
      const toVal = toMod.params[key];
      if (typeof toVal === 'number') {
        const defaultVal = key === 'scale' || key === 'scaleX' || key === 'scaleY' ? 1 : 0;
        params[key] = defaultVal + (toVal - defaultVal) * easedT;
      } else {
        params[key] = easedT < 0.5 ? toMod.params[key] : toVal;
      }
    }
    result.push({
      id: toMod.id,
      type: toMod.type,
      enabled: toMod.enabled,
      collapsed: toMod.collapsed,
      params,
      startFrame: toMod.startFrame ?? -1,
      endFrame: toMod.endFrame ?? -1,
      fadeInFrames: toMod.fadeInFrames ?? 0,
      fadeOutFrames: toMod.fadeOutFrames ?? 0,
      blendMode: toMod.blendMode ?? 'add',
      coordinateMode: toMod.coordinateMode ?? 'world',
      paramKeyframes: undefined,
      paramDrivers: undefined,
    });
  }

  // P9: Store in interpolation cache if cache key provided
  if (_cacheKey) {
    if (_interpolationCache.size >= _INTERPOLATION_CACHE_MAX) {
      const firstKey = _interpolationCache.keys().next().value;
      if (firstKey !== undefined) _interpolationCache.delete(firstKey);
    }
    _interpolationCache.set(_cacheKey, result);
  }

  return result;
}

// ============================================================
