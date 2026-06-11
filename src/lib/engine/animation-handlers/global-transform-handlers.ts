// ============================================================
// PixelMorpher - Global Transform Handlers
// One handler per modifier type for computeGlobalModifierTransform.
// ============================================================

import type { GlobalModifier } from '../../types';
import { seededRandom, fbmNoise } from '../noise';
import { evalExpression } from '../../expression-parser';

import type { GlobalTransformHandler, TransformResult } from './types';

// ============================================================
// Individual handlers
// ============================================================

const translateHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  return {
    translateX: (Number(params.offsetX) || 0) * ctx.weight,
    translateY: (Number(params.offsetY) || 0) * ctx.weight,
  };
};

const rotateHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const rotAngle = (Number(params.angle) || 0) * ctx.weight;
  let translateX = 0;
  let translateY = 0;
  // Pivot offset compensation
  const rdx = Number(params.pivotOffsetX) || 0;
  const rdy = Number(params.pivotOffsetY) || 0;
  if ((rdx !== 0 || rdy !== 0) && rotAngle !== 0) {
    const rad = (rotAngle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    translateX = rdx - cosA * rdx + sinA * rdy;
    translateY = rdy - sinA * rdx - cosA * rdy;
  }
  return { rotation: rotAngle, translateX, translateY };
};

const uniformScaleHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const s = Number(params.scale) || 1;
  // Multiplicative blend with weight: lerp from 1 to s
  const effectiveS = 1 + (s - 1) * ctx.weight;
  let translateX = 0;
  let translateY = 0;
  // Pivot offset compensation
  const sdx = Number(params.pivotOffsetX) || 0;
  const sdy = Number(params.pivotOffsetY) || 0;
  if ((sdx !== 0 || sdy !== 0) && effectiveS !== 1) {
    translateX = sdx * (1 - effectiveS);
    translateY = sdy * (1 - effectiveS);
  }
  return { scaleX: effectiveS, scaleY: effectiveS, translateX, translateY };
};

const shakeHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 5;
  const frequency = Number(params.frequency) || 12;
  const decay = Number(params.decay) || 0;
  const t = ctx.currentFrame / ctx.frameRate;
  const decayFactor = Math.exp(-decay * t);
  return {
    translateX: (Math.random() * 2 - 1) * amplitude * decayFactor * ctx.weight,
    translateY: (Math.random() * 2 - 1) * amplitude * decayFactor * ctx.weight,
  };
};

const bounceHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 10;
  const period = Math.max(2, Number(params.period) || 16);
  const phase = ((Number(params.phase) || 0) * Math.PI) / 180;
  const relativeFrame = ctx.currentFrame;
  const frameInPeriod = ((relativeFrame % period) + period) % period;
  const t = frameInPeriod / period;
  // Bounce uses absolute value of sine
  const bounceValue = Math.abs(Math.sin(2 * Math.PI * t + phase));
  return { translateY: -amplitude * bounceValue * ctx.weight };
};

const breathHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 0.1;
  const period = Math.max(2, Number(params.period) || 30);
  const phase = ((Number(params.phase) || 0) * Math.PI) / 180;
  const frameInPeriod = ((ctx.currentFrame % period) + period) % period;
  const t = frameInPeriod / period;
  const breathValue = Math.sin(2 * Math.PI * t + phase);
  const s = 1 + amplitude * breathValue * ctx.weight;
  let translateX = 0;
  let translateY = 0;
  // Pivot offset compensation
  const brdx = Number(params.pivotOffsetX) || 0;
  const brdy = Number(params.pivotOffsetY) || 0;
  if ((brdx !== 0 || brdy !== 0) && s !== 1) {
    translateX = brdx * (1 - s);
    translateY = brdy * (1 - s);
  }
  return { scaleX: s, scaleY: s, translateX, translateY };
};

const floatHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 5;
  const period = Math.max(2, Number(params.period) || 30);
  const phase = ((Number(params.phase) || 0) * Math.PI) / 180;
  const frameInPeriod = ((ctx.currentFrame % period) + period) % period;
  const t = frameInPeriod / period;
  return { translateY: -amplitude * Math.sin(2 * Math.PI * t + phase) * ctx.weight };
};

const wobbleHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 5;
  const period = Math.max(2, Number(params.period) || 20);
  const phase = ((Number(params.phase) || 0) * Math.PI) / 180;
  const frameInPeriod = ((ctx.currentFrame % period) + period) % period;
  const t = frameInPeriod / period;
  const wobAngle = amplitude * Math.sin(2 * Math.PI * t + phase) * ctx.weight;
  let translateX = 0;
  let translateY = 0;
  // Pivot offset compensation
  const wdx = Number(params.pivotOffsetX) || 0;
  const wdy = Number(params.pivotOffsetY) || 0;
  if ((wdx !== 0 || wdy !== 0) && wobAngle !== 0) {
    const rad = (wobAngle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    translateX = wdx - cosA * wdx + sinA * wdy;
    translateY = wdy - sinA * wdx - cosA * wdy;
  }
  return { rotation: wobAngle, translateX, translateY };
};

const pendulumHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 10;
  const period = Math.max(2, Number(params.period) || 24);
  const phase = ((Number(params.phase) || 0) * Math.PI) / 180;
  const damping = Number(params.damping) || 0;
  const relativeFrame = (mod.startFrame === -1 ? 0 : mod.startFrame);
  const relFrame = ctx.currentFrame - relativeFrame;
  const decayFactor = Math.exp(-damping * relFrame * 0.1);
  const frameInPeriod = ((ctx.currentFrame % period) + period) % period;
  const t = frameInPeriod / period;
  const pendAngle = amplitude * Math.sin(2 * Math.PI * t + phase) * decayFactor * ctx.weight;
  let translateX = 0;
  let translateY = 0;
  // Pivot offset compensation
  const pdx = Number(params.pivotOffsetX) || 0;
  const pdy = Number(params.pivotOffsetY) || 0;
  if ((pdx !== 0 || pdy !== 0) && pendAngle !== 0) {
    const rad = (pendAngle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    translateX = pdx - cosA * pdx + sinA * pdy;
    translateY = pdy - sinA * pdx - cosA * pdy;
  }
  return { rotation: pendAngle, translateX, translateY };
};

const noiseHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitudeX = Number(params.amplitudeX) || 5;
  const amplitudeY = Number(params.amplitudeY) || 5;
  const speed = Number(params.speed) || 0.1;
  const seed = Number(params.seed) || 0;
  const t = ctx.currentFrame * speed;
  return {
    translateX: fbmNoise(seed, t, 4, 0) * amplitudeX * ctx.weight,
    translateY: fbmNoise(seed + 100, 0, t, 4) * amplitudeY * ctx.weight,
  };
};

const waveHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitudeX = Number(params.amplitudeX) || 5;
  const amplitudeY = Number(params.amplitudeY) || 5;
  const frequency = Number(params.frequency) || 0.5;
  const phase = ((Number(params.phase) || 0) * Math.PI) / 180;
  const t = ctx.currentFrame * frequency;
  return {
    translateX: amplitudeX * Math.sin(2 * Math.PI * t + phase) * ctx.weight,
    translateY: amplitudeY * Math.cos(2 * Math.PI * t + phase) * ctx.weight,
  };
};

const springHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitude = Number(params.amplitude) || 10;
  const stiffness = Number(params.stiffness) || 0.3;
  const springDamping = Number(params.damping) || 0.1;
  const triggerFrame = Number(params.triggerFrame) || 0;
  const relFrame = Math.max(0, ctx.currentFrame - triggerFrame);
  const t = relFrame / ctx.frameRate;
  // Damped harmonic oscillator
  const omega = Math.sqrt(stiffness) * 10;
  const zeta = springDamping;
  const envelope = Math.exp(-zeta * omega * t);
  const displacement = amplitude * envelope * Math.cos(omega * Math.sqrt(1 - zeta * zeta) * t);
  return { translateY: displacement * ctx.weight };
};

const jitterHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  const amplitudeX = Number(params.amplitudeX) || 2;
  const amplitudeY = Number(params.amplitudeY) || 2;
  const probability = Number(params.probability) || 0.5;
  let translateX = 0;
  let translateY = 0;
  if (seededRandom(ctx.currentFrame * 13 + (mod.id.charCodeAt(0) || 0))() < probability) {
    translateX = (seededRandom(ctx.currentFrame * 7 + 1)() * 2 - 1) * amplitudeX * ctx.weight;
    translateY = (seededRandom(ctx.currentFrame * 11 + 2)() * 2 - 1) * amplitudeY * ctx.weight;
  }
  return { translateX, translateY };
};

const expressionHandler: GlobalTransformHandler = (mod, ctx) => {
  const params = mod.params;
  try {
    const evalCtx: Record<string, number> = {
      f: ctx.currentFrame,
      t: ctx.currentFrame / ctx.frameRate,
      pi: Math.PI,
    };
    const txExpr = String(params.translateXExpr || '0');
    const tyExpr = String(params.translateYExpr || '0');
    const rotExpr = String(params.rotateExpr || '0');
    const scExpr = String(params.scaleExpr || '1');
    const translateX = (evalExpression(txExpr, evalCtx) || 0) * ctx.weight;
    const translateY = (evalExpression(tyExpr, evalCtx) || 0) * ctx.weight;
    const rotation = (evalExpression(rotExpr, evalCtx) || 0) * ctx.weight;
    const s = evalExpression(scExpr, evalCtx) || 1;
    const scaleX = 1 + (s - 1) * ctx.weight;
    const scaleY = 1 + (s - 1) * ctx.weight;
    return { translateX, translateY, rotation, scaleX, scaleY };
  } catch {
    return {};
  }
};

// ============================================================
// Lookup table: modifier type string → handler function
// ============================================================

export const GLOBAL_TRANSFORM_HANDLERS: Record<string, GlobalTransformHandler> = {
  translate: translateHandler,
  rotate: rotateHandler,
  uniform_scale: uniformScaleHandler,
  shake: shakeHandler,
  bounce: bounceHandler,
  breath: breathHandler,
  float: floatHandler,
  wobble: wobbleHandler,
  pendulum: pendulumHandler,
  noise: noiseHandler,
  wave: waveHandler,
  spring: springHandler,
  jitter: jitterHandler,
  expression: expressionHandler,
};
