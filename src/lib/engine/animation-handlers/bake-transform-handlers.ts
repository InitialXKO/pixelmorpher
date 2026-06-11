// ============================================================
// PixelMorpher - Bake Transform Handlers
// One handler per modifier type for computeAnimationModifierTransform
// (deterministic path, no cache, used by bake-to-timeline).
// ============================================================

import type { ModifierInstance, PartAnimationModifier, WheelTrajectoryMode } from '../../types';
import { seededRandom, fbmNoise } from '../noise';
import { evalExpression } from '../../expression-parser';
import { sampleWaveformAtFrame } from '../../csv-waveform';
import {
  computeWheelTrajectory,
  computeWheelAngularStateDeterministic,
  computeGaitTransform,
  applyProceduralToResult,
} from './shared-helpers';

import type { BakeTransformHandler, TransformResult } from './types';

// ============================================================
// Individual handlers
// ============================================================

const pendulumHandler: BakeTransformHandler = (mod, ctx) => {
  const amplitude = Number(mod.params.amplitude) || 30;
  const period = Math.max(2, Number(mod.params.period) || 16);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  const damping = Number(mod.params.damping) || 0;
  const t = ctx.relativeFrame / period;
  const decay = Math.exp(-damping * t * 2 * Math.PI);
  const angle = amplitude * Math.sin(2 * Math.PI * t + phaseRad) * decay;
  return { rotation: angle * ctx.effectiveWeight };
};

const wheelHandler: BakeTransformHandler = (mod, ctx) => {
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
    radiusX, radiusY, relativeFrame: ctx.relativeFrame, period, phaseRad, direction: dir,
    weight: ctx.effectiveWeight, trajectoryMode, cornerRadius, gearTeeth, gearMeshOffset,
  });

  const result: Partial<TransformResult> = {
    translateX: traj.translateX,
    translateY: traj.translateY,
    rotation: traj.rotation,
    scaleX: traj.scaleX,
    scaleY: traj.scaleY,
  };

  // V3.3: Add angular dynamics rotation (only for orbital modes; spin modes already have rotation)
  if (trajectoryMode !== 'independent_spin' && trajectoryMode !== 'gear') {
    const angularState = computeWheelAngularStateDeterministic(mod, ctx.currentFrame, ctx.frameRate);
    result.rotation = (result.rotation ?? 0) + angularState.angle * ctx.effectiveWeight;
  }

  return result;
};

const bounceHandler: BakeTransformHandler = (mod, ctx) => {
  const height = Number(mod.params.height) || 20;
  const period = Math.max(2, Number(mod.params.period) || 12);
  const bounces = Math.max(1, Number(mod.params.bounces) || 3);
  const damping = Number(mod.params.damping) || 0.5;
  const bounceT = (ctx.relativeFrame % period) / (period / bounces);
  const bounceIndex = Math.floor((ctx.relativeFrame % period) / (period / bounces));
  const decayFactor = Math.pow(1 - damping, bounceIndex);
  const bouncePhase = bounceT - Math.floor(bounceT);
  const yOffset = -height * decayFactor * Math.pow(Math.sin(Math.PI * bouncePhase), 2);
  return { translateY: yOffset * ctx.effectiveWeight };
};

const gaitHandler: BakeTransformHandler = (mod, ctx) => {
  const gaitPeriod = Math.max(4, Number(mod.params.period) || 24);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  // Deterministic path: analytical normalizedT from relativeFrame
  const frameInPeriod = ((ctx.relativeFrame % gaitPeriod) + gaitPeriod) % gaitPeriod;
  const gaitNormT = frameInPeriod / gaitPeriod + phaseRad / (2 * Math.PI);
  return computeGaitTransform({
    normalizedT: gaitNormT, period: gaitPeriod, weight: ctx.effectiveWeight,
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
};

const breathHandler: BakeTransformHandler = (mod, ctx) => {
  const amplitude = Number(mod.params.amplitude) || 0.1;
  const period = Math.max(2, Number(mod.params.period) || 24);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  const scale = 1 + amplitude * Math.sin(2 * Math.PI * ctx.relativeFrame / period + phaseRad);
  const s = Math.max(0.01, scale) * ctx.effectiveWeight + (1 - ctx.effectiveWeight);
  return { scaleX: s, scaleY: s };
};

const wobbleHandler: BakeTransformHandler = (mod, ctx) => {
  const angleAmp = Number(mod.params.angleAmplitude) || 5;
  const moveAmp = Number(mod.params.moveAmplitude) || 2;
  const period = Math.max(2, Number(mod.params.period) || 12);
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  const damping = Number(mod.params.damping) || 0;
  const t = ctx.relativeFrame / period;
  const decay = Math.exp(-damping * t * 2 * Math.PI);
  const rot = angleAmp * Math.sin(2 * Math.PI * t + phaseRad) * decay;
  const dx = moveAmp * Math.sin(2 * Math.PI * t + phaseRad + Math.PI / 3) * decay;
  const dy = moveAmp * Math.cos(2 * Math.PI * t + phaseRad) * decay;
  return {
    translateX: dx * ctx.effectiveWeight,
    translateY: dy * ctx.effectiveWeight,
    rotation: rot * ctx.effectiveWeight,
  };
};

const floatHandler: BakeTransformHandler = (mod, ctx) => {
  const floatHeight = Number(mod.params.height) || 5;
  const period = Math.max(2, Number(mod.params.period) || 24);
  const tiltDeg = Number(mod.params.tilt) || 3;
  const phaseRad = ((Number(mod.params.phase) || 0) * Math.PI) / 180;
  const t = 2 * Math.PI * ctx.relativeFrame / period + phaseRad;
  const dy = -floatHeight * (0.5 + 0.5 * Math.sin(t));
  const rot = tiltDeg * Math.sin(t);
  return {
    translateY: dy * ctx.effectiveWeight,
    rotation: rot * ctx.effectiveWeight,
  };
};

const shakeHandler: BakeTransformHandler = (mod, ctx) => {
  const intensity = Number(mod.params.intensity) || 3;
  const period = Math.max(1, Number(mod.params.period) || 4);
  const decay = Number(mod.params.decay) || 0;
  const seed = Number(mod.params.seed) || 0;
  const step = Math.floor(ctx.relativeFrame / period);
  const rng = seededRandom(seed + step * 7919);
  const dx = (rng() * 2 - 1) * intensity;
  const dy = (rng() * 2 - 1) * intensity;
  const decayFactor = Math.exp(-decay * ctx.relativeFrame * 0.1);
  return {
    translateX: dx * decayFactor * ctx.effectiveWeight,
    translateY: dy * decayFactor * ctx.effectiveWeight,
  };
};

const elasticHandler: BakeTransformHandler = (mod, ctx) => {
  const offset = Number(mod.params.offset) || 20;
  const period = Math.max(2, Number(mod.params.period) || 12);
  const overshoot = Number(mod.params.overshoot) || 0.3;
  const damping = Number(mod.params.damping) || 0.5;
  const axis = String(mod.params.axis) || 'y';
  const t = ctx.relativeFrame / period;
  const decayVal = Math.exp(-damping * t * 2 * Math.PI);
  const osc = 1 - Math.cos(2 * Math.PI * t) * decayVal * (1 + overshoot);
  const value = offset * osc * ctx.effectiveWeight;
  switch (axis) {
    case 'x': return { translateX: value };
    case 'rotation': return { rotation: value };
    case 'scale': {
      const s = Math.max(0.01, 1 + value / 100);
      return { scaleX: s, scaleY: s };
    }
    case 'y':
    default: return { translateY: value };
  }
};

const expressionHandler: BakeTransformHandler = (mod, ctx) => {
  const amplitude = Number(mod.params.amplitude) || 10;
  const period = Math.max(2, Number(mod.params.period) || 16);
  const phase = Number(mod.params.phase) || 0;

  // Feature 5: CSV waveform support
  const csvWaveform = Array.isArray(mod.params.csvWaveform) ? mod.params.csvWaveform as number[] : undefined;
  if (csvWaveform && Array.isArray(csvWaveform) && csvWaveform.length > 0) {
    const totalFrames = Math.max(csvWaveform.length, 24);
    const waveformValue = sampleWaveformAtFrame(csvWaveform, ctx.relativeFrame, totalFrames);
    return { translateX: (waveformValue * 2 - 1) * amplitude * ctx.effectiveWeight };
  }

  const vars = {
    t: ctx.relativeFrame,
    f: ctx.relativeFrame,
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
    const tx = evalExpression(exprX, vars) * ctx.effectiveWeight;
    const ty = evalExpression(exprY, vars) * ctx.effectiveWeight;
    const rot = evalExpression(exprRot, vars) * ctx.effectiveWeight;
    const scaleVal = evalExpression(exprScale, vars);
    const sx = Math.max(0.01, scaleVal) * ctx.effectiveWeight + (1 - ctx.effectiveWeight);
    return { translateX: tx, translateY: ty, rotation: rot, scaleX: sx, scaleY: sx };
  } catch {
    return {};
  }
};

/** Pixel-level deformation modifiers produce zero geometric transform. */
const noopHandler: BakeTransformHandler = () => ({});

const noiseHandler: BakeTransformHandler = (mod, ctx) => {
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const amplitude = Number(mod.params.amplitude) || 5;
  const frequency = Number(mod.params.frequency) || 0.05;
  const octaves = Number(mod.params.octaves) || 2;
  const seed = Number(mod.params.seed) || 42;
  const targetProperty = String(mod.params.targetProperty || 'translateX');
  const value = fbmNoise(ctx.relativeFrame * frequency, 0, octaves, seed) * amplitude * ctx.effectiveWeight;
  applyProceduralToResult(result, targetProperty, value);
  return result;
};

const waveHandler: BakeTransformHandler = (mod, ctx) => {
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const amplitude = Number(mod.params.amplitude) || 5;
  const frequency = Number(mod.params.frequency) || 0.1;
  const phase = Number(mod.params.phase) || 0;
  const waveType = String(mod.params.waveType || 'sine');
  const targetProperty = String(mod.params.targetProperty || 'translateY');
  const t = ctx.relativeFrame * frequency + (phase / 360);
  const p = t * Math.PI * 2;
  let value: number;
  switch (waveType) {
    case 'triangle': value = ((2 * Math.abs(2 * (p / (2 * Math.PI) - Math.floor(p / (2 * Math.PI) + 0.5)))) - 1) * amplitude; break;
    case 'square': value = (Math.sin(p) >= 0 ? 1 : -1) * amplitude; break;
    case 'sawtooth': value = (2 * (p / (2 * Math.PI) - Math.floor(p / (2 * Math.PI) + 0.5))) * amplitude; break;
    default: value = Math.sin(p) * amplitude; break;
  }
  applyProceduralToResult(result, targetProperty, value * ctx.effectiveWeight);
  return result;
};

const springHandler: BakeTransformHandler = (mod, ctx) => {
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const stiffness = Number(mod.params.stiffness) || 0.5;
  const damping = Number(mod.params.damping) || 0.3;
  const mass = Number(mod.params.mass) || 1;
  const restLength = Number(mod.params.restLength) || 0;
  const targetProperty = String(mod.params.targetProperty || 'translateY');
  const omega = Math.sqrt(stiffness / mass);
  const gamma = damping / (2 * mass);
  const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
  const timeSec = ctx.relativeFrame / 60;
  const value = (restLength > 0 ? restLength : 1) * Math.exp(-gamma * timeSec) * Math.cos(dampedOmega * timeSec) + restLength;
  applyProceduralToResult(result, targetProperty, value * ctx.effectiveWeight);
  return result;
};

const jitterHandler: BakeTransformHandler = (mod, ctx) => {
  const result: TransformResult = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const amount = Number(mod.params.amount) || 2;
  const frequency = Number(mod.params.frequency) || 0.5;
  const smooth = Boolean(mod.params.smooth);
  const targetProperty = String(mod.params.targetProperty || 'translateX');
  const jitterSeed = Math.floor(ctx.relativeFrame * frequency * 100);
  const rng = seededRandom(jitterSeed);
  let value: number;
  if (smooth) {
    value = (rng() * 2 - 1) * amount;
  } else {
    value = (Math.round(rng() * 2 - 1)) * amount;
  }
  applyProceduralToResult(result, targetProperty, value * ctx.effectiveWeight);
  return result;
};

// ============================================================
// Lookup table: modifier type string → handler function
// ============================================================

export const BAKE_TRANSFORM_HANDLERS: Record<string, BakeTransformHandler> = {
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
