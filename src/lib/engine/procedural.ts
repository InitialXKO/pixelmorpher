// ============================================================
// PixelMorpher - Procedural Animation Engine
// computeProceduralValue, applyProceduralAnimations,
// computeProceduralPoseDelta（旧骨骼 IK/变换已随旧系统删除，2026-10-26）
// ============================================================

import type { ModifierInstance, ProceduralAnimation, ProceduralConfig } from '../types';
import { fbmNoise, seededRandom, simplex2D } from './noise';
// ============================================================
// V2.0: Procedural Animation System
// ============================================================

export function computeProceduralValue(
  config: ProceduralConfig,
  frame: number,
): number {
  switch (config.type) {
    case 'noise': {
      return fbmNoise(frame * config.frequency, 0, config.octaves, config.seed) * config.amplitude;
    }
    case 'wave': {
      const t = frame * config.frequency + (config.phase / 360);
      const phase = t * Math.PI * 2;
      switch (config.waveType) {
        case 'sine': return Math.sin(phase) * config.amplitude;
        case 'triangle': return (2 * Math.abs(2 * (t % 1 - 0.5)) - 1) * config.amplitude;
        case 'square': return (Math.sin(phase) >= 0 ? 1 : -1) * config.amplitude;
        case 'sawtooth': return (2 * (t % 1) - 1) * config.amplitude;
        default: return Math.sin(phase) * config.amplitude;
      }
    }
    case 'spring': {
      // Damped spring oscillation
      const omega = Math.sqrt(config.stiffness / config.mass);
      const gamma = config.damping / (2 * config.mass);
      const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
      const t = frame / 60; // time in seconds
      return (config.restLength > 0 ? config.restLength : 1) * Math.exp(-gamma * t) * Math.cos(dampedOmega * t) + config.restLength;
    }
    case 'jitter': {
      const seed = Math.floor(frame * config.frequency * 100);
      const rng = seededRandom(seed);
      if (config.smooth) {
        // Smooth jitter using noise
        return (simplex2D(frame * config.frequency, 0) * 2 - 1) * config.amount;
      } else {
        return (rng() * 2 - 1) * config.amount;
      }
    }
    default: return 0;
  }
}

// ============================================================
// V2.0: Apply Procedural Animations to Modifiers
// ============================================================

export function applyProceduralAnimations(
  modifiers: ModifierInstance[],
  proceduralAnimations: ProceduralAnimation[],
  spriteId: string,
  frame: number,
  nodeId?: string,
): ModifierInstance[] {
  // Deep-clone modifiers (shallow copy of each modifier + its params)
  // to prevent mutating the store's original modifier objects.
  // Without this, the render loop would accumulate procedural values
  // on every frame because it ADDS to existing values.
  const result = modifiers.map(m => ({
    ...m,
    params: { ...m.params },
  }));

  for (const pa of proceduralAnimations) {
    // 匹配 spriteId 或 nodeId（新管线节点级程序化动画用 nodeId）。
    // spriteId 空串不算匹配：主渲染以 '' 调用本函数，节点级条目的
    // spriteId 同为 ''，不设此门会让节点条目串到所有节点上。
    const matchesPart = !!spriteId && pa.spriteId === spriteId;
    const matchesNode = nodeId && pa.nodeId === nodeId;
    if (!pa.enabled || (!matchesPart && !matchesNode)) continue;
    if (frame < pa.startFrame || frame > pa.endFrame) continue;

    const value = computeProceduralValue(pa.config, frame);

    switch (pa.config.targetProperty) {
      case 'translateX': {
        // M3: 只找启用的修改器，否则值会加到被禁用的修改器上而视觉无效果
        const translateMod = result.find(m => m.type === 'translate' && m.enabled);
        if (translateMod) {
          translateMod.params = { ...translateMod.params, offsetX: (Number(translateMod.params.offsetX) || 0) + value };
        }
        break;
      }
      case 'translateY': {
        // M3: 只找启用的修改器，否则值会加到被禁用的修改器上而视觉无效果
        const translateMod = result.find(m => m.type === 'translate' && m.enabled);
        if (translateMod) {
          translateMod.params = { ...translateMod.params, offsetY: (Number(translateMod.params.offsetY) || 0) + value };
        }
        break;
      }
      case 'rotation': {
        const rotateMod = result.find(m => m.type === 'rotate' && m.enabled);
        if (rotateMod) {
          rotateMod.params = { ...rotateMod.params, angle: (Number(rotateMod.params.angle) || 0) + value };
        }
        break;
      }
      case 'scale': {
        const scaleMod = result.find(m => m.type === 'uniform_scale' && m.enabled);
        if (scaleMod) {
          scaleMod.params = { ...scaleMod.params, scale: Math.max(0.1, (Number(scaleMod.params.scale) || 1) + value / 10) };
        }
        break;
      }
    }
  }

  return result;
}

// ============================================================
// V2.0: Procedural Pose Delta（编辑器位姿增量口径）
// ============================================================

/** 程序化动画汇总出的节点位姿增量（编辑器主画布叠加到渲染指令的位姿字段） */
export interface ProceduralPoseDelta {
  /** 平移增量 X（画布 px） */
  dx: number;
  /** 平移增量 Y（画布 px） */
  dy: number;
  /** 旋转增量（度） */
  rotDeg: number;
  /** 等比缩放倍乘（逐条 max(0.1, 1 + v/10) 累乘，与播放器 paScale 同式） */
  scaleMul: number;
}

/**
 * 把命中本节点的程序化动画汇总为位姿增量，与运行时播放器
 * （runtime-template 的 PROCEDURAL 叠加段）同一口径：平移按 px
 * 累加、旋转按度累加、缩放逐条以 (1 + v/10) 钳 ≥0.1 后累乘。
 *
 * 匹配规则（与 convert 进包同一口径）：条目作用于某节点，当且仅当
 * pa.nodeId 等于该节点，或 pa.spriteId 非空且等于该节点当前解析出
 * 的精灵 id（resolvedSpriteId，由调用方按本次渲染的解析结果传入）
 * ——只挂精灵的条目自动落到挂着这个精灵的节点上。除此之外仍须
 * enabled、帧在 [startFrame, endFrame] 内，且节点挂有目标属性对应
 * 类型的启用修改器（translateX/Y→translate、rotation→rotate、
 * scale→uniform_scale）才计入，与 applyProceduralAnimations 的查找
 * 门控一致。一条条目同帧只走一条汇总路径：nodeId 与 spriteId 双
 * 通道同时命中也只计一次。
 *
 * modifiers 只读 type/enabled 两字段，入参取结构形状：types 与
 * unified-types 两套 ModifierInstance 定义字段兼容但类型不互认，
 * 结构入参让两边都可直传（替代旧调用点的 as any 糊法）。
 */
export function computeProceduralPoseDelta(
  proceduralAnimations: ProceduralAnimation[],
  modifiers: ReadonlyArray<{ type: string; enabled: boolean }>,
  nodeId: string | undefined,
  frame: number,
  resolvedSpriteId?: string,
): ProceduralPoseDelta {
  const delta: ProceduralPoseDelta = { dx: 0, dy: 0, rotDeg: 0, scaleMul: 1 };
  if (!nodeId && !resolvedSpriteId) return delta;
  const hasEnabledModifier = (type: string) =>
    modifiers.some((m) => m.type === type && m.enabled);
  for (const pa of proceduralAnimations) {
    const matchesNode = !!nodeId && pa.nodeId === nodeId;
    const matchesSprite = !!resolvedSpriteId && !!pa.spriteId && pa.spriteId === resolvedSpriteId;
    if (!pa.enabled || (!matchesNode && !matchesSprite)) continue;
    if (frame < pa.startFrame || frame > pa.endFrame) continue;
    switch (pa.config.targetProperty) {
      case 'translateX':
        if (hasEnabledModifier('translate')) delta.dx += computeProceduralValue(pa.config, frame);
        break;
      case 'translateY':
        if (hasEnabledModifier('translate')) delta.dy += computeProceduralValue(pa.config, frame);
        break;
      case 'rotation':
        if (hasEnabledModifier('rotate')) delta.rotDeg += computeProceduralValue(pa.config, frame);
        break;
      case 'scale':
        if (hasEnabledModifier('uniform_scale')) {
          delta.scaleMul *= Math.max(0.1, 1 + computeProceduralValue(pa.config, frame) / 10);
        }
        break;
    }
  }
  return delta;
}
