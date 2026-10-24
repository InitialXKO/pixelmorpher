/**
 * Helper: interpolate node keyframes.
 * Uses new Character/Node types (migrated from PuppetSkeleton).
 *
 * For each node, interpolates from node.tracks, then evaluates
 * blueprint/modifiers and adds to values.
 */

import type { Character, Node, KeyframeTrack, ModifierInstance, ModifierParamValue } from '../../unified-types';
import type { InterpolatedNodeValues } from './types';
import { computePartAnimationTransform } from '../animation-dispatch';
import { evaluateBlueprint } from '../../blueprint/eval';
import { modifiersToBlueprint } from '../../blueprint/migrate';
import { buildBlueprintVars, mapStoreAnimationVariables } from '../../unified-animation-resolver';

// hold 等有状态节点的跨帧存储
const blueprintNodeState = new Map<string, any>();
let lastFrame = -1;

function interpolateTrack(track: KeyframeTrack<number> | undefined, frame: number, defaultValue: number): number {
  if (!track || track.keyframes.length === 0) return defaultValue;
  const kfs = track.keyframes;
  let prev: typeof kfs[0] | null = null;
  let next: typeof kfs[0] | null = null;
  for (const kf of kfs) {
    if (kf.frame <= frame) prev = kf;
    else { next = kf; break; }
  }
  if (!prev) return next ? next.value : defaultValue;
  if (!next || prev.frame === next.frame) return prev.value;
  const t = (frame - prev.frame) / (next.frame - prev.frame);
  const mode = next.interpolation ?? track.interpolation ?? 'linear';
  if (mode === 'step') return prev.value;
  return prev.value + (next.value - prev.value) * t;
}

/** step 插值：取 ≤frame 的最后一点，无点用缺省（离散量不用线性插值） */
function interpolateTrackStep(track: KeyframeTrack<number> | undefined, frame: number, defaultValue: number): number {
  if (!track || track.keyframes.length === 0) return defaultValue;
  let v = defaultValue;
  for (const kf of track.keyframes) {
    if (kf.frame <= frame) v = kf.value;
    else break;
  }
  return v;
}

function interpolateSingleNode(node: Node, currentFrame: number): InterpolatedNodeValues {
  const tracks = node.tracks;
  let x = interpolateTrack(tracks?.x, currentFrame, 0);
  let y = interpolateTrack(tracks?.y, currentFrame, 0);
  // Node trajectory（轨迹工具烘焙）：有轨迹点时 x/y 走轨迹插值，与关键帧插值合并
  const traj = node.trajectory;
  if (traj && traj.length > 0) {
    const tp = interpolateTrajectoryPoints(traj, currentFrame);
    if (tp) { x = tp.x; y = tp.y; }
  }
  return {
    angle: interpolateTrack(tracks?.angle, currentFrame, 0),
    tilt: interpolateTrack(tracks?.tilt, currentFrame, node.transform.tilt ?? 0),
    stretch: interpolateTrack(tracks?.stretch, currentFrame, 1),
    x,
    y,
    variantIndex: 0,
    zIndex: interpolateTrackStep(tracks?.zIndex, currentFrame, node.zIndex ?? 0),
    skewX: 0,
    skewY: 0,
    scaleX: interpolateTrack(tracks?.scaleX, currentFrame, node.transform.scaleX ?? 1),
  };
}

/** 轨迹点线性插值（帧 → x/y） */
function interpolateTrajectoryPoints(
  points: { frame: number; x: number; y: number }[],
  frame: number,
): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  let prev = sorted[0];
  let next: typeof prev | null = null;
  for (const p of sorted) {
    if (p.frame <= frame) prev = p;
    else { next = p; break; }
  }
  if (!next || prev.frame === next.frame) return { x: prev.x, y: prev.y };
  const t = (frame - prev.frame) / (next.frame - prev.frame);
  return {
    x: Math.round(prev.x + (next.x - prev.x) * t),
    y: Math.round(prev.y + (next.y - prev.y) * t),
  };
}

function interpolateCharacterInternal(
  character: Character,
  currentFrame: number,
  frameRate: number = 12,
): Map<string, InterpolatedNodeValues> {
  const result = new Map<string, InterpolatedNodeValues>();

  if (currentFrame < lastFrame || currentFrame > lastFrame + 5) {
    blueprintNodeState.clear();
  }
  lastFrame = currentFrame;

  // 蓝图变量：从 store 读 animationVariables（与主渲染 generateRenderPlan 同口径，
  // drivers 取本角色全部节点的 active param drivers）。store 不可用时为空（回退 var 节点默认值）
  let blueprintVars: Record<string, number> = {};
  try {
    const { useProjectStore } = require('../../store') as typeof import('../../store');
    const storeVars = (useProjectStore.getState() as any).animationVariables;
    if (Array.isArray(storeVars) && storeVars.length > 0) {
      const drivers: import('../../unified-types').ParamDriver[] = [];
      for (const n of Object.values(character.nodes)) {
        for (const mod of n.modifiers ?? []) {
          for (const d of (mod as any).paramDrivers ?? []) {
            if (d.enabled) drivers.push(d);
          }
        }
      }
      blueprintVars = buildBlueprintVars(mapStoreAnimationVariables(storeVars), currentFrame, drivers as any, frameRate);
    }
  } catch { /* store 不可用（测试/SSR）：保持空 vars */ }

  const nodeOutputs = new Map<string, { rotation: number; translateX: number; translateY: number; scaleX: number; scaleY: number; skewX: number; skewY: number; zIndex: number }>();

  for (let pass = 0; pass < 2; pass++) {
    for (const nodeId of Object.keys(character.nodes)) {
      const node = character.nodes[nodeId]!;
      const values = interpolateSingleNode(node, currentFrame);
      // 合并 node.faceTurn 和转面轨（轨优先）
      const kfFaceTurn = getInterpolatedTrackFaceTurn(node, currentFrame);
      values.faceTurn = kfFaceTurn ?? node.faceTurn;
      // 合并 node.modifiers 和修饰器组轨（轨优先，同 type 去重）
      const kfModifiers = getInterpolatedTrackModifiers(node, currentFrame);
      const nodeMods = node.modifiers ?? [];
      const kfTypes = new Set(kfModifiers.map((m) => m.type));
      const mergedModifiers = [
        ...nodeMods.filter((m) => !kfTypes.has(m.type)),
        ...kfModifiers,
      ];
      // 优先用 node.blueprint（已同步，含手动编辑）；无蓝图时从 modifiers 生成
      const blueprint = (node as any).blueprint ?? (mergedModifiers.length ? modifiersToBlueprint(mergedModifiers as any) : null);
      if (blueprint) {
        const t = evaluateBlueprint(blueprint, {
          frame: currentFrame,
          frameRate,
          vars: blueprintVars,
          nodeOutputs: pass === 1 ? nodeOutputs : undefined,
          nodeState: blueprintNodeState,
        } as any);
        values.angle += t.rotation;
        values.tilt = (values.tilt ?? 0) + (t.tilt ?? 0);
        values.x += t.translateX;
        values.y += t.translateY;
        values.stretch *= t.scaleY;
        values.scaleX *= t.scaleX;
        values.skewX += t.skewX;
        values.skewY += t.skewY;
        if (t.zIndex !== 0) values.zIndex = t.zIndex;
        if (pass === 0) {
          nodeOutputs.set(node.id, {
            rotation: t.rotation,
            translateX: t.translateX,
            translateY: t.translateY,
            scaleX: t.scaleX,
            scaleY: t.scaleY,
            skewX: t.skewX,
            skewY: t.skewY,
            zIndex: t.zIndex,
          });
        }
      } else {
        const mods = node.modifiers ?? [];
        if (mods.length > 0) {
          const t = computePartAnimationTransform(mods as any, currentFrame, 12);
          values.angle += t.rotation;
          values.x += t.translateX;
          values.y += t.translateY;
          values.stretch *= t.scaleY;
        }
      }
      if (pass === 1) {
        result.set(node.id, values);
      }
    }
  }

  return result;
}

/**
 * Compute interpolated values for every node in the character.
 */
export function interpolateNodeKeyframes(
  character: Character,
  currentFrame: number,
  frameRate?: number,
): Map<string, InterpolatedNodeValues> {
  // 帧率与主渲染同口径：显式传入优先，否则读 store 的工程帧率
  // （此前写死 12，蓝图里按秒计的节点在拖拽/面板路径与主画布算得不一致）
  let rate = frameRate;
  if (rate === undefined) {
    try {
      // 懒加载避免循环依赖
      const { useProjectStore } = require('../../store') as typeof import('../../store');
      rate = (useProjectStore.getState() as any).frameRate;
    } catch { /* store 不可用（测试/SSR）：用缺省 */ }
  }
  return interpolateCharacterInternal(character, currentFrame, rate && rate > 0 ? rate : 12);
}

// ---- Per-keyframe modifier interpolation ----

/**
 * 插值单个 modifier 参数值。
 * 数值：线性插值；非数值（boolean/string）：step，取前一帧的值。
 */
function interpolateParamValue(prev: ModifierParamValue, next: ModifierParamValue, t: number): ModifierParamValue {
  if (typeof prev === 'number' && typeof next === 'number') {
    return prev + (next - prev) * t;
  }
  // 非数值用 step：t < 1 时取 prev，t = 1 时取 next
  return t < 1 ? prev : next;
}

/**
 * 把 modifier 的数值 params 按强度缩放（用于淡入淡出）。
 * strength=1 全强度，strength=0 无效果（数值 params → 0）。
 */
function scaleModifierByStrength(mod: ModifierInstance, strength: number): ModifierInstance {
  if (strength === 1) return mod;
  const params: Record<string, ModifierParamValue> = {};
  for (const [key, value] of Object.entries(mod.params)) {
    params[key] = typeof value === 'number' ? value * strength : value;
  }
  return { ...mod, params, enabled: strength > 0 };
}

/**
 * 插值两个 NodeKeyframe 的 modifiers。
 *
 * 规则：
 * - 同 type 的 modifier：params 逐个插值（数值线性，非数值 step）
 * - 只在 prev 存在的 modifier：按强度 1→0 淡出（t=0.5 时半强度）
 * - 只在 next 存在的 modifier：按强度 0→1 淡入
 * - 不同 id 但同 type 的视为同一个（按 type 匹配）
 *
 * @param prevMods 前一帧的 modifiers（t=0 时）
 * @param nextMods 后一帧的 modifiers（t=1 时）
 * @param t 插值系数 0-1
 */
export function interpolateNodeKeyframeModifiers(
  prevMods: ModifierInstance[] | undefined,
  nextMods: ModifierInstance[] | undefined,
  t: number,
): ModifierInstance[] {
  const prev = prevMods ?? [];
  const next = nextMods ?? [];
  if (prev.length === 0 && next.length === 0) return [];
  if (t <= 0) return prev.map((m) => ({ ...m }));
  if (t >= 1) return next.map((m) => ({ ...m }));

  const result: ModifierInstance[] = [];
  const matchedNext = new Set<string>();

  for (const pMod of prev) {
    // 按 type 匹配 next 中的 modifier
    const nMod = next.find((m) => m.type === pMod.type && !matchedNext.has(m.id));
    if (nMod) {
      matchedNext.add(nMod.id);
      // 同 type：插值 params
      const params: Record<string, ModifierParamValue> = {};
      const allKeys = new Set([...Object.keys(pMod.params), ...Object.keys(nMod.params)]);
      for (const key of allKeys) {
        const pv = pMod.params[key];
        const nv = nMod.params[key];
        if (pv !== undefined && nv !== undefined) {
          params[key] = interpolateParamValue(pv, nv, t);
        } else if (pv !== undefined) {
          // 只在 prev 有：数值按强度淡出，非数值 step（t<1 保留）
          params[key] = typeof pv === 'number' ? pv * (1 - t) : pv;
        } else {
          // 只在 next 有：数值按强度淡入，非数值 step（t=1 才出现）
          params[key] = typeof nv === 'number' ? (nv as number) * t : (nv as ModifierParamValue);
          if (typeof nv !== 'number' && t < 1) {
            // 非数值且未到下一帧：不加入 params
            delete params[key];
          }
        }
      }
      result.push({
        ...pMod,
        id: nMod.id,
        params,
        enabled: pMod.enabled || nMod.enabled,
      });
    } else {
      // 只在 prev 存在：淡出
      result.push(scaleModifierByStrength(pMod, 1 - t));
    }
  }

  // 只在 next 存在的：淡入
  for (const nMod of next) {
    if (!matchedNext.has(nMod.id)) {
      // 检查是否已按 type 匹配过（避免重复）
      const alreadyMatched = result.some((r) => r.type === nMod.type && prev.some((p) => p.type === nMod.type));
      if (!alreadyMatched) {
        result.push(scaleModifierByStrength(nMod, t));
      }
    }
  }

  return result;
}

/**
 * 在两个修饰器组点之间插值（点值 = 修饰器组快照）。
 */
export function interpolateModifierPoints(
  prevMods: ModifierInstance[] | null,
  nextMods: ModifierInstance[] | null,
  prevFrame: number,
  nextFrame: number,
  frame: number,
): ModifierInstance[] {
  if (!prevMods && !nextMods) return [];
  if (!prevMods) return (nextMods ?? []).map((m) => ({ ...m }));
  if (!nextMods) return prevMods.map((m) => ({ ...m }));
  if (prevFrame === nextFrame) return prevMods.map((m) => ({ ...m }));
  const t = Math.max(0, Math.min(1, (frame - prevFrame) / (nextFrame - prevFrame)));
  return interpolateNodeKeyframeModifiers(prevMods, nextMods, t);
}

/**  bracket 查找：返回 ≤frame 的最后一点与 ≥frame 的第一点（同一引用表示恰在点上） */
function bracketPoint<T>(points: { frame: number; value: T }[] | undefined, frame: number): {
  prev: { frame: number; value: T } | null;
  next: { frame: number; value: T } | null;
} {
  if (!points || points.length === 0) return { prev: null, next: null };
  const sorted = [...points].sort((a, b) => a.frame - b.frame);
  let prev: { frame: number; value: T } | null = null;
  let next: { frame: number; value: T } | null = null;
  for (const pt of sorted) {
    if (pt.frame <= frame) prev = pt;
    if (pt.frame >= frame && !next) next = pt;
  }
  if (!prev) prev = next;
  if (!next) next = prev;
  return { prev, next };
}

/**
 * 获取某节点在指定帧的插值后修饰器组（读 node.tracks.modifierKeys）。
 * 供 interpolateCharacterInternal 调用，与 node.modifiers 合并。
 */
function getInterpolatedTrackModifiers(
  node: Node,
  currentFrame: number,
): ModifierInstance[] {
  const { prev, next } = bracketPoint(node.tracks?.modifierKeys?.keyframes, currentFrame);
  if (!prev && !next) return [];
  return interpolateModifierPoints(
    prev?.value ?? null, next?.value ?? null,
    prev?.frame ?? currentFrame, next?.frame ?? currentFrame,
    currentFrame,
  );
}

/**
 * 获取某节点在指定帧的插值后 faceTurn（读 node.tracks.faceTurnKeys，yaw/pitch 数值 lerp）。
 * 供 interpolateCharacterInternal 调用，与 node.faceTurn 合并（轨优先）。
 */
function getInterpolatedTrackFaceTurn(
  node: Node,
  currentFrame: number,
): { yaw: number; pitch: number } | undefined {
  const { prev, next } = bracketPoint(node.tracks?.faceTurnKeys?.keyframes, currentFrame);
  if (!prev || !next) return undefined;
  if (prev.frame === next.frame) return { ...prev.value };
  const t = Math.max(0, Math.min(1, (currentFrame - prev.frame) / (next.frame - prev.frame)));
  return {
    yaw: prev.value.yaw + (next.value.yaw - prev.value.yaw) * t,
    pitch: prev.value.pitch + (next.value.pitch - prev.value.pitch) * t,
  };
}
