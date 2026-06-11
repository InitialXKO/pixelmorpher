// ============================================================
// PixelMorpher - Realtime Transform Handlers
// One handler per modifier type for computeAnimModifierRealtimeTransform
// (uses incremental phase cache, for live rendering).
// ============================================================

import type { ModifierInstance, PartAnimationModifier, WheelTrajectoryMode } from '../../types';
import { seededRandom, fbmNoise } from '../noise';
import { evalExpression } from '../../expression-parser';
import {
  getAnimationPhase,
  getAnimationFrameAndWeight,
  getWheelAngularState,
} from '../animation-state';
import {
  computeWheelTrajectory,
  computeGaitTransform,
  applyProceduralToResult,
} from './shared-helpers';

import type { RealtimeTransformHandler, RealtimeTransformResult, TransformResult } from './types';
import { DEFAULT_REALTIME_RESULT } from './types';

// ============================================================
// Individual handlers
// ============================================================

const pendulumHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { phase, t, weight } = getAnimationPhase(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const amplitude = Number(mod.params.amplitude) || 30;
  const damping = Number(mod.params.damping) || 0;
  const decay = Math.exp(-damping * t * 2 * Math.PI);
  return {
    rotation: amplitude * Math.sin(phase) * decay * effectiveWeight,
    weight: effectiveWeight,
  };
};

const wheelHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { phase, relativeFrame: rf, weight } = getAnimationPhase(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const radiusX = Number(mod.params.radiusX) || 10;
  const radiusY = Number(mod.params.radiusY) || 10;
  const period = Math.max(2, Number(mod.params.period) || 16);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  const dir = mod.params.direction === 'ccw' ? -1 : 1;
  const trajectoryMode = String(mod.params.trajectoryMode ?? 'circular') as WheelTrajectoryMode;
  const cornerRadius = Number(mod.params.cornerRadius ?? 5);
  const gearTeeth = Number(mod.params.gearTeeth ?? 8);
  const gearMeshOffset = Number(mod.params.gearMeshOffset ?? 0);
  const traj = computeWheelTrajectory({
    radiusX, radiusY, relativeFrame: rf, period, phaseRad, direction: dir,
    weight: effectiveWeight, trajectoryMode, cornerRadius, gearTeeth, gearMeshOffset,
  });

  const result: Partial<RealtimeTransformResult> = {
    translateX: traj.translateX,
    translateY: traj.translateY,
    rotation: traj.rotation,
    scaleX: traj.scaleX,
    scaleY: traj.scaleY,
    weight: effectiveWeight,
  };

  // V3.3: Add angular dynamics rotation (only for orbital modes; spin modes already have rotation)
  if (trajectoryMode !== 'independent_spin' && trajectoryMode !== 'gear') {
    const angularState = getWheelAngularState(mod, ctx.currentFrame, ctx.frameRate);
    result.rotation = (result.rotation ?? 0) + angularState.angle * effectiveWeight;
  }

  return result;
};

const bounceHandler: RealtimeTransformHandler = (mod, ctx) => {
  // V11: Use getAnimationPhase for phase continuity when period changes dynamically
  const { phase: bouncePhaseVal, t: bounceT, weight: bounceWeight } = getAnimationPhase(mod, ctx.currentFrame);
  if (bounceWeight <= 0) return null;
  const effectiveWeight = bounceWeight * ctx.convergeFactor;
  const height = Number(mod.params.height) || 20;
  const period = Math.max(2, Number(mod.params.period) || 12);
  const bounces = Math.max(1, Number(mod.params.bounces) || 3);
  const damping = Number(mod.params.damping) || 0.5;
  // Derive bounce index and within-bounce progress from accumulated phase
  const fullPhase = bouncePhaseVal; // already includes phaseRad offset
  const cyclesCompleted = fullPhase / (2 * Math.PI); // may be fractional
  const bounceIndex = Math.floor(cyclesCompleted * bounces);
  const withinBounce = (cyclesCompleted * bounces) - Math.floor(cyclesCompleted * bounces);
  const decayFactor = Math.pow(1 - damping, bounceIndex);
  return {
    translateY: -height * decayFactor * Math.pow(Math.sin(Math.PI * withinBounce), 2) * effectiveWeight,
    weight: effectiveWeight,
  };
};

const gaitHandler: RealtimeTransformHandler = (mod, ctx) => {
  // V11: Use getAnimationPhase for phase-accumulated normalizedT
  const { phase: gaitPhase, weight: gaitWeight } = getAnimationPhase(mod, ctx.currentFrame);
  if (gaitWeight <= 0) return null;
  const effectiveWeight = gaitWeight * ctx.convergeFactor;
  // Derive normalizedT from accumulated phase: each 2π = one gait cycle
  const gaitNormT = gaitPhase / (2 * Math.PI);
  const gaitPeriod = Math.max(4, Number(mod.params.period) || 24);
  const gaitResult = computeGaitTransform({
    normalizedT: gaitNormT, period: gaitPeriod, weight: effectiveWeight,
    strideLength: Number(mod.params.strideLength) || 20,
    liftHeight: Number(mod.params.liftHeight) || 12,
    stanceRatio: Number(mod.params.stanceRatio ?? 0.6),
    direction: String(mod.params.direction ?? 'forward'),
    gaitStyle: String(mod.params.gaitStyle ?? 'cartoon'),
    aerialRatio: Number(mod.params.aerialRatio ?? 0.35),
    teardropAsymmetry: Number(mod.params.teardropAsymmetry ?? 0.3),
    liftoffAngle: Number(mod.params.liftoffAngle ?? -20),
    peakAngle: Number(mod.params.peakAngle ?? 15),
    contactAngle: Number(mod.params.contactAngle ?? 10),
    angleEasing: String(mod.params.angleEasing ?? 'sine'),
    landBend: Number(mod.params.landBend ?? 0.15),
    landBendDuration: Number(mod.params.landBendDuration ?? 3),
    liftoffBend: Number(mod.params.liftoffBend ?? 0.1),
    liftoffBendDuration: Number(mod.params.liftoffBendDuration ?? 2),
  });
  return {
    translateX: gaitResult.translateX,
    translateY: gaitResult.translateY,
    rotation: gaitResult.rotation,
    scaleX: gaitResult.scaleX,
    scaleY: gaitResult.scaleY,
    weight: effectiveWeight,
  };
};

const breathHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { phase, weight } = getAnimationPhase(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const amplitude = Number(mod.params.amplitude) || 0.1;
  const scale = 1 + amplitude * Math.sin(phase);
  const s = Math.max(0.01, scale) * effectiveWeight + (1 - effectiveWeight);
  return { scaleX: s, scaleY: s, weight: effectiveWeight };
};

const wobbleHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { phase, t, weight } = getAnimationPhase(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const angleAmp = Number(mod.params.angleAmplitude) || 5;
  const moveAmp = Number(mod.params.moveAmplitude) || 2;
  const damping = Number(mod.params.damping) || 0;
  const decay = Math.exp(-damping * t * 2 * Math.PI);
  return {
    rotation: angleAmp * Math.sin(phase) * decay * effectiveWeight,
    translateX: moveAmp * Math.sin(phase + Math.PI / 3) * decay * effectiveWeight,
    translateY: moveAmp * Math.cos(phase) * decay * effectiveWeight,
    weight: effectiveWeight,
  };
};

const floatHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { phase, weight } = getAnimationPhase(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const floatHeight = Number(mod.params.height) || 5;
  const tiltDeg = Number(mod.params.tilt) || 3;
  return {
    translateY: -floatHeight * (0.5 + 0.5 * Math.sin(phase)) * effectiveWeight,
    rotation: tiltDeg * Math.sin(phase) * effectiveWeight,
    weight: effectiveWeight,
  };
};

const shakeHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { relativeFrame, weight } = getAnimationFrameAndWeight(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const intensity = Number(mod.params.intensity) || 3;
  const period = Math.max(1, Number(mod.params.period) || 4);
  const decay = Number(mod.params.decay) || 0;
  const seed = Number(mod.params.seed) || 0;
  const step = Math.floor(relativeFrame / period);
  const rng = seededRandom(seed + step * 7919);
  const dx = (rng() * 2 - 1) * intensity;
  const dy = (rng() * 2 - 1) * intensity;
  const decayFactor = Math.exp(-decay * relativeFrame * 0.1);
  return {
    translateX: dx * decayFactor * effectiveWeight,
    translateY: dy * decayFactor * effectiveWeight,
    weight: effectiveWeight,
  };
};

const elasticHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { phase, t, weight } = getAnimationPhase(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const offset = Number(mod.params.offset) || 20;
  const overshoot = Number(mod.params.overshoot) || 0.3;
  const damping = Number(mod.params.damping) || 0.5;
  const axis = String(mod.params.axis) || 'y';
  const decay = Math.exp(-damping * t * 2 * Math.PI);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  const rawPhase = phase - phaseRad;
  const osc = 1 - Math.cos(rawPhase) * decay * (1 + overshoot);
  const value = offset * osc * effectiveWeight;

  let partial: Partial<RealtimeTransformResult>;
  switch (axis) {
    case 'x': partial = { translateX: value }; break;
    case 'rotation': partial = { rotation: value }; break;
    case 'scale': {
      const s = Math.max(0.01, 1 + value / 100);
      partial = { scaleX: s, scaleY: s };
      break;
    }
    case 'y':
    default: partial = { translateY: value }; break;
  }
  return { ...partial, weight: effectiveWeight };
};

const expressionHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { relativeFrame: rf, weight } = getAnimationFrameAndWeight(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const amplitude = Number(mod.params.amplitude) || 10;
  const period = Math.max(2, Number(mod.params.period) || 16);
  const phase = Number(mod.params.phase) || 0;

  const vars = {
    t: rf,
    f: rf,
    period,
    phase,
    amplitude,
    fps: 12,
    totalFrames: 24,
    PI: Math.PI,
    E: Math.E,
    TAU: Math.PI * 2,
  };

  const exprX = String(mod.params.expressionX || '0');
  const exprY = String(mod.params.expressionY || '0');
  const exprRot = String(mod.params.expressionRotation || '0');
  const exprScale = String(mod.params.expressionScale || '1');

  try {
    const tx = evalExpression(exprX, vars) * effectiveWeight;
    const ty = evalExpression(exprY, vars) * effectiveWeight;
    const rot = evalExpression(exprRot, vars) * effectiveWeight;
    const scaleVal = evalExpression(exprScale, vars);
    const sx = Math.max(0.01, scaleVal) * effectiveWeight + (1 - effectiveWeight);
    return { translateX: tx, translateY: ty, rotation: rot, scaleX: sx, scaleY: sx, weight: effectiveWeight };
  } catch {
    return { weight: effectiveWeight };
  }
};

const noiseHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { relativeFrame: rf, weight } = getAnimationFrameAndWeight(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const amplitude = Number(mod.params.amplitude) || 5;
  const frequency = Number(mod.params.frequency) || 0.05;
  const octaves = Number(mod.params.octaves) || 2;
  const seed = Number(mod.params.seed) || 42;
  const targetProperty = String(mod.params.targetProperty || 'translateX');
  const value = fbmNoise(rf * frequency, 0, octaves, seed) * amplitude * effectiveWeight;
  applyProceduralToResult(result, targetProperty, value);
  return { ...result, weight: effectiveWeight };
};

const waveHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { relativeFrame: rf, weight } = getAnimationFrameAndWeight(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const amplitude = Number(mod.params.amplitude) || 5;
  const frequency = Number(mod.params.frequency) || 0.1;
  const phase = Number(mod.params.phase) || 0;
  const waveType = String(mod.params.waveType || 'sine');
  const targetProperty = String(mod.params.targetProperty || 'translateY');
  const t = rf * frequency + (phase / 360);
  const p = t * Math.PI * 2;
  let value: number;
  switch (waveType) {
    case 'triangle': value = ((2 * Math.abs(2 * (p / (2 * Math.PI) - Math.floor(p / (2 * Math.PI) + 0.5)))) - 1) * amplitude; break;
    case 'square': value = (Math.sin(p) >= 0 ? 1 : -1) * amplitude; break;
    case 'sawtooth': value = (2 * (p / (2 * Math.PI) - Math.floor(p / (2 * Math.PI) + 0.5))) * amplitude; break;
    default: value = Math.sin(p) * amplitude; break;
  }
  applyProceduralToResult(result, targetProperty, value * effectiveWeight);
  return { ...result, weight: effectiveWeight };
};

const springHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { relativeFrame: rf, weight } = getAnimationFrameAndWeight(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const stiffness = Number(mod.params.stiffness) || 0.5;
  const damping = Number(mod.params.damping) || 0.3;
  const mass = Number(mod.params.mass) || 1;
  const restLength = Number(mod.params.restLength) || 0;
  const targetProperty = String(mod.params.targetProperty || 'translateY');
  const omega = Math.sqrt(stiffness / mass);
  const gamma = damping / (2 * mass);
  const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
  const timeSec = rf / 60;
  const value = (restLength > 0 ? restLength : 1) * Math.exp(-gamma * timeSec) * Math.cos(dampedOmega * timeSec) + restLength;
  applyProceduralToResult(result, targetProperty, value * effectiveWeight);
  return { ...result, weight: effectiveWeight };
};

const jitterHandler: RealtimeTransformHandler = (mod, ctx) => {
  const { relativeFrame: rf, weight } = getAnimationFrameAndWeight(mod, ctx.currentFrame);
  if (weight <= 0) return null;
  const effectiveWeight = weight * ctx.convergeFactor;
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const amount = Number(mod.params.amount) || 2;
  const frequency = Number(mod.params.frequency) || 0.5;
  const smooth = Boolean(mod.params.smooth);
  const targetProperty = String(mod.params.targetProperty || 'translateX');
  const jitterSeed = Math.floor(rf * frequency * 100);
  const rng = seededRandom(jitterSeed);
  let value: number;
  if (smooth) {
    value = (rng() * 2 - 1) * amount;
  } else {
    value = (Math.round(rng() * 2 - 1)) * amount;
  }
  applyProceduralToResult(result, targetProperty, value * effectiveWeight);
  return { ...result, weight: effectiveWeight };
};

/** Pixel-level deformation modifiers produce zero geometric transform. */
const noopHandler: RealtimeTransformHandler = (_mod, _ctx) => null;

// ============================================================
// Lookup table: modifier type string → handler function
// ============================================================

export const REALTIME_TRANSFORM_HANDLERS: Record<string, RealtimeTransformHandler> = {
  pendulum: pendulumHandler,
  wheel: wheelHandler,
  bounce: bounceHandler,
  gait: gaitHandler,
  breath: breathHandler,
  wobble: wobbleHandler,
  float: floatHandler,
  shake: shakeHandler,
  elastic: elasticHandler,
  expression: expressionHandler,
  noise: noiseHandler,
  wave: waveHandler,
  spring: springHandler,
  jitter: jitterHandler,
  // Pixel-level deformation modifiers — produce zero geometric transform
  texture_scroll: noopHandler,
  wave_deform: noopHandler,
  contour_scroll: noopHandler,
  reveal_hide: noopHandler,
  shatter_dissolve: noopHandler,
  annihilate: noopHandler,
  teleport: noopHandler,
  crt_off: noopHandler,
  bend: noopHandler,
  elliptical_compress: noopHandler,
  dumbbell_stretch: noopHandler,
  pillow_stretch: noopHandler,
  hyperbolic_stretch: noopHandler,
  ring_ripple: noopHandler,
};
