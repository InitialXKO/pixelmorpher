// ============================================================
// PixelMorpher - Unified Render Pipeline
// ============================================================
// Implements the rendering flow described in the unified architecture:
//
// 1. Compute world transforms: depth-first from root node
// 2. Compute socket world positions: per parent, per direction
// 3. Z-order computation: draw layers + direction-dependent ordering
// 4. Generate render instructions: all node sprites + all discs
// 5. Execute rendering: stretch → rotate → translate → draw
//
// This pipeline replaces both renderFrame() and renderPuppetNodes()
// with a single unified entry point.
// ============================================================

import type {
  Node, Character, NodeTransform, Socket, DirectionIndex, SkinningSnapshot,
  SubPixel, Point, Sprite, RotationStrategy, CostumePiece,
  NodeRenderInstruction, DiscRenderInstruction, MannequinRenderInstruction, RenderPlan,
  KeyframeTrack, KeyframePoint, InterpolationMode,
  ModifierInstance, GeneratedItem, AnimationVariable, ParamDriver,
  IKChain, Mat3, ParentKeyValue,
} from './unified-types';
import {
  subToPx, halfPixelAlignSub, DEFAULT_MIRROR_MAP, projectToView, rotateInViewPlane,
  directionTrig,
  resolveChainTarget3D,
  mat3Mul, mat3Transpose, mat3Apply, localRotMat, rotMatD, rotMatY, applyFrameRotation, frameViewAngle,
  frameViewAngleForDirection, frameYAxisWorld,
  worldToViewBasis, MAT3_IDENTITY,
} from './unified-types';
import { solveIK2Bone3D, solveIKFabrik3D } from './blueprint/ik';
import { slashFrameCanvas } from './slash-fan';
import { renderPixelPerfectRotation } from './engine/puppet-utils';
import { releaseCanvas } from './engine/canvas-pool';
import { sampleJointDiscColor, getPlugJointWidth } from './engine/render-helpers/puppet-joint-color';
import {
  getDiscCacheKey, getCachedDisc, setCachedDisc,
  clearRenderCaches, createPixelGridHasher, hashPixelGrid,
} from './engine/render-cache';
import { rgbaToHexOrNull } from './engine/utils';
import {
  applyPixelModifiers,
  isPixelDeformModifier,
  computeTotalAnimPadding,
  padPixelGrid,
  trimTransparentEdges,
} from './engine/pixel-modifiers';
import { applyPixelDeformAnimations } from './engine/render-helpers/pixel-deform-animations';
import { resolveKeyframeModifierParams } from './engine/param-driver';
import {
  applyTextureScroll,
  applyWaveDeform,
  applyContourScroll,
  applyRevealHide,
  applyShatterDissolve,
  applyAnnihilate,
  applyTeleport,
  applyCrtOff,
  applyBend,
  applyEllipticalCompress,
  applyDumbbellStretch,
  applyPillowStretch,
  applyHyperbolicStretch,
  applyRingRipple,
} from './engine/modifier-renderers';
import {
  renderGlowEffect,
  renderAfterimageEffect,
  renderMotionBlurEffect,
  renderParticleEffect,
  getTranslateOffset,
  renderEffectTrackFrame,
} from './engine/effect-render';
import { applyAutoMotionBlur, renderMotionBlurStroke, renderEffectStroke } from './engine/brush-render';
import { getAnimationFrameAndWeight } from './engine/animation-state';
import { computeGlobalModifierTransform } from './engine/animation-dispatch';
import { applyProceduralAnimations } from './engine/procedural';
import { resolveDynamicPatterns, resolveGlowGroups, dynamicDeformAt, followAnchoredDeltaAt, glowField, glowPulseAt, spinAngleDegAt, arcPointsAt, type DynamicPatternParams } from './dynamic-patterns';
import { effectivePatternGraph, resolvePatternsFromGraph } from './blueprint/pattern-sync';
import { orbitPointsAt, postColorAt, blobFieldAt, flameFieldAt, fieldColorAt, envSamplesAt } from './dynamic-patterns';
import { evaluateNodeOutput } from './blueprint/eval';
import { markPointPx, markDirAngleDeg } from './sprite-marks';
import { simulateDynamicParticles } from './dynamic-pattern-sim';
import { applyCanvasModifiers } from './engine/canvas-modifiers';
// Blueprint evaluation (path B: unified transform + pixel via blueprint)
import { evaluateBlueprint, collectDynamicStrokes, evaluateCostumeState } from './blueprint/eval';
import { behaviorHostVars } from './behavior-host';
import { modifiersToBlueprint } from './blueprint/migrate';
import type { BlueprintEvalContext } from './blueprint/ir';
import { isIKChainSuspended } from './ik-drag-state';
import type { BlueprintGraph } from './blueprint/ir';
import type { VariableContext as EngineVariableContext } from './engine/param-driver';
import type {
  PixelGrid, ModifierType, Keyframe, ProceduralAnimation,
  EffectTrack, MotionBlurStroke, EffectStroke, GlobalModifier,
  AnimationVariable as StoreAnimationVariable, AnimationClip, CanvasModifierTrack,
} from './types';
import {
  resolveNodeModifiers,
  computeAnimationModifierTransform,
  buildVariableContext,
  buildBlueprintVars,
  mapStoreAnimationVariables,
  type ResolvedModifier,
  type VariableContext,
  getEmptyVariableContext,
} from './unified-animation-resolver';
import { resolvePieceSprite } from './sprite-resolve';
import { computeStackOps, rasterizeStackOps, rasterizeStackOpsData } from './stack-render';

// ---- World Transform Computation ----

/** Blueprint evaluation state (module-level, cleared on frame jumps) */
const blueprintNodeState = new Map<string, unknown>();
let blueprintLastFrame = -1;

/** Pre-computed blueprint transform result for a node */
export interface BlueprintTransformResult {
  translateX: number;
  translateY: number;
  translateZ: number;
  rotation: number;
  tilt: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
}

/**
 * Phase 0 (path B): Evaluate all node blueprints for transform values.
 * Two-pass for cross-node references (nodeOutputs). Mirrors puppet-keyframe-interpolation.
 */
export function evaluateBlueprintTransforms(
  character: Character,
  frame: number,
  frameRate: number,
  vars?: Record<string, number | string | boolean>,
): Map<string, BlueprintTransformResult> {
  if (frame < blueprintLastFrame || frame > blueprintLastFrame + 5) {
    blueprintNodeState.clear();
  }
  blueprintLastFrame = frame;

  const result = new Map<string, BlueprintTransformResult>();
  const nodeOutputs = new Map<string, {
    rotation: number; tilt: number; translateX: number; translateY: number; translateZ: number;
    scaleX: number; scaleY: number; skewX: number; skewY: number; zIndex: number;
  }>();

  for (let pass = 0; pass < 2; pass++) {
    for (const nodeId of Object.keys(character.nodes)) {
      const node = character.nodes[nodeId]!;
      const blueprint: BlueprintGraph | null =
        (node as any).blueprint ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as any) : null);
      if (!blueprint) continue;
      try {
        const t = evaluateBlueprint(blueprint, {
          frame,
          frameRate,
          vars: vars ?? {},
          nodeOutputs: pass === 1 ? nodeOutputs : undefined,
          nodeState: blueprintNodeState,
          // costume 节点用（transform pass 不出像素，但保持 ctx 完整）
          costumes: character.costumeSets,
          costumeSlot: (node as any).slot?.slotKey,
        } as any);
        result.set(nodeId, {
          translateX: t.translateX,
          translateY: t.translateY,
          translateZ: t.translateZ ?? 0,
          rotation: t.rotation,
          tilt: t.tilt ?? 0,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          skewX: t.skewX,
          skewY: t.skewY,
        });
        if (pass === 0) {
          nodeOutputs.set(nodeId, {
            rotation: t.rotation,
            tilt: t.tilt ?? 0,
            translateX: t.translateX,
            translateY: t.translateY,
            translateZ: t.translateZ ?? 0,
            scaleX: t.scaleX,
            scaleY: t.scaleY,
            skewX: t.skewX,
            skewY: t.skewY,
            zIndex: (t as any).zIndex ?? 0,
          });
        }
      } catch {
        // Single node failure doesn't break the whole graph
      }
    }
  }
  return result;
}

// ---- 行为求值层（主画布宿主） ----
// 行为图（character.behaviorGraphs）与运行时包同一批图：运行时由真
// 宿主（键盘）喂 vars 实时求值；主画布此前无消费者，现按同一契约接：
// 时间基 60fps（ctx.frame = 秒×60、frameRate=60）、vars = 输入轨采样
// （behavior-host：t/phase/moveX/speed01/grounded，缺轨静止缺省）。
// 只取 transform 的 rotation/translateX/translateY 三通道（与运行时
// 翻译契约一致），由 computeWorldTransforms 在节点本地变换层叠加——
// 出图、点选、枢轴、骨骼覆盖层共用同一份世界变换，行为偏移处处一致。
const behaviorNodeState = new Map<string, unknown>();
let behaviorLastFrame = -1;

export function evaluateBehaviorTransforms(
  character: Character,
  frame: number,
  frameRate: number,
  baseVars?: Record<string, number | string | boolean>,
): Map<string, { rotation: number; translateX: number; translateY: number }> {
  const result = new Map<string, { rotation: number; translateX: number; translateY: number }>();
  const graphs = character.behaviorGraphs;
  if (!graphs || Object.keys(graphs).length === 0) return result;
  if (frame < behaviorLastFrame || frame > behaviorLastFrame + 5) {
    behaviorNodeState.clear();
  }
  behaviorLastFrame = frame;

  type OutputRec = {
    rotation: number; tilt: number; translateX: number; translateY: number; translateZ: number;
    scaleX: number; scaleY: number; skewX: number; skewY: number; zIndex: number;
  };
  const entries = Object.entries(graphs).filter(([nodeId, g]) => g && character.nodes[nodeId]);
  const followOf = (g: BlueprintGraph) => g.followMode ?? 'prev';

  // 求值一遍全部行为图：每张图按自己的 followMode 选 nodeRef 来源
  // （mapFor 决定）。state 可传一次性 Map 隔离历史污染（上一帧草稿遍）。
  const evalSet = (
    host: ReturnType<typeof behaviorHostVars>,
    hostFrame: number,
    mapFor: (g: BlueprintGraph) => Map<string, OutputRec> | undefined,
    state: Map<string, unknown>,
  ): Map<string, OutputRec> => {
    const outs = new Map<string, OutputRec>();
    const vars: Record<string, number | string | boolean> = {
      ...(baseVars ?? {}),
      t: host.t, phase: host.phase, moveX: host.moveX, speed01: host.speed01, grounded: host.grounded,
    };
    for (const [nodeId, graph] of entries) {
      const node = character.nodes[nodeId]!;
      try {
        const t = evaluateBlueprint(graph, {
          frame: hostFrame,
          frameRate,
          vars,
          nodeOutputs: mapFor(graph),
          nodeState: state,
          costumes: character.costumeSets,
          costumeSlot: node.slot?.slotKey,
        } as any);
        outs.set(nodeId, {
          rotation: t.rotation, tilt: t.tilt ?? 0,
          translateX: t.translateX, translateY: t.translateY, translateZ: t.translateZ ?? 0,
          scaleX: t.scaleX, scaleY: t.scaleY, skewX: t.skewX, skewY: t.skewY,
          zIndex: (t as any).zIndex ?? 0,
        });
      } catch {
        // 单图失败不拖垮整角色
      }
    }
    return outs;
  };

  // 上一帧输出（'prev' 图的 nodeRef 来源）：在 frame-1 处按同帧口径
  // 求值一遍得到——延迟恰好一帧且逐帧确定，拖动可复现。第 0 帧无上一帧。
  let prevMap = new Map<string, OutputRec>();
  if (frame > 0 && entries.some(([, g]) => followOf(g) === 'prev')) {
    const hostPrev = behaviorHostVars(character, frame - 1, frameRate);
    const throwaway = new Map<string, unknown>();
    const draftPrev = evalSet(hostPrev, frame - 1, () => undefined, throwaway);
    prevMap = evalSet(hostPrev, frame - 1, () => draftPrev, throwaway);
  }

  // 本帧：A 遍全部图读 prevMap（'prev' 图定稿、'same' 图作草稿），
  // B 遍只重算 'same' 图、nodeRef 改读 A 遍草稿（本帧输出，无延迟）
  const host = behaviorHostVars(character, frame, frameRate);
  const passA = evalSet(host, frame, () => prevMap, behaviorNodeState);
  let finals = passA;
  if (entries.some(([, g]) => followOf(g) === 'same')) {
    finals = new Map(passA);
    const draft = passA;
    for (const [nodeId, graph] of entries) {
      if (followOf(graph) !== 'same') continue;
      const node = character.nodes[nodeId]!;
      try {
        const t = evaluateBlueprint(graph, {
          frame,
          frameRate,
          vars: {
            ...(baseVars ?? {}),
            t: host.t, phase: host.phase, moveX: host.moveX, speed01: host.speed01, grounded: host.grounded,
          },
          nodeOutputs: draft,
          nodeState: behaviorNodeState,
          costumes: character.costumeSets,
          costumeSlot: node.slot?.slotKey,
        } as any);
        finals.set(nodeId, {
          rotation: t.rotation, tilt: t.tilt ?? 0,
          translateX: t.translateX, translateY: t.translateY, translateZ: t.translateZ ?? 0,
          scaleX: t.scaleX, scaleY: t.scaleY, skewX: t.skewX, skewY: t.skewY,
          zIndex: (t as any).zIndex ?? 0,
        });
      } catch {
        // 单图失败保留 A 遍结果
      }
    }
  }

  for (const [nodeId, rec] of finals) {
    result.set(nodeId, { rotation: rec.rotation, translateX: rec.translateX, translateY: rec.translateY });
  }
  return result;
}

/** Computed world transform for a node */
export interface WorldTransform {
  nodeId: string;
  worldX: SubPixel;        // World position X (sub-pixel, 3D)
  worldY: SubPixel;        // World position Y (sub-pixel, 3D)
  worldZ: SubPixel;        // World position Z (sub-pixel, 3D depth)
  worldAngle: number;      // Derived view-plane angle (degrees; = frameViewAngle(worldFrame))
  worldFrame: Mat3;        // Accumulated orientation frame (basis-coords rotation, incl. own local rot)
  worldStretch: number;    // 本节点自身 stretch（不沿层级累乘；与 scaleX/skew 同口径）
  variantIndex: DirectionIndex; // Current direction
  mirror: boolean;         // Whether this node is mirrored
  scaleX?: number;          // X-axis scale factor (blueprint t.scaleX, default 1)
  skewX?: number;          // Local skew X in degrees (blueprint/legacy skew modifier)
  skewY?: number;          // Local skew Y in degrees (blueprint/legacy skew modifier)
}

/**
 * Step 1: Compute world transforms for all nodes in a character.
 * Traverses the node tree depth-first from the root.
 */
/** 父级切换轨在 frame 处的生效键（step：≤frame 的最后一点） */
export function parentKeyAt(node: Node, frame: number): ParentKeyValue | undefined {
  const kfs = node.tracks?.parentKeys?.keyframes;
  if (!kfs || kfs.length === 0) return undefined;
  let best: ParentKeyValue | undefined;
  let bestFrame = -Infinity;
  for (const kf of kfs) {
    if (kf.frame <= frame && kf.frame >= bestFrame) {
      best = kf.value;
      bestFrame = kf.frame;
    }
  }
  return best;
}

/**
 * 按帧重挂后的有效角色：任一节点带父级切换轨时，返回一份层级按
 * 本帧有效父级重写的浅克隆（节点数据共享、只换 parentId /
 * attachment / children），FK 的既有组成公式原样跑。有效父级成环
 * （著者错误）时，把环中最近切换的节点回退到静态父级；链条够不到
 * 根的节点挂到根兜底。无切换轨时原样返回（零开销）。
 */
export function effectiveCharacterAt(character: Character, frame: number): Character {
  const nodes = character.nodes;
  const anyKeys = Object.values(nodes).some((n) => (n.tracks?.parentKeys?.keyframes.length ?? 0) > 0);
  if (!anyKeys) return character;
  const rootId = character.rootNodeId;
  const staticParent = new Map<string, string | null>();
  const effParent = new Map<string, string | null>();
  const effKey = new Map<string, ParentKeyValue | undefined>();
  for (const n of Object.values(nodes)) {
    staticParent.set(n.id, n.id === rootId ? null : (n.parentId ?? null));
    const key = n.id === rootId ? undefined : parentKeyAt(n, frame);
    effKey.set(n.id, key);
    effParent.set(n.id, key ? (key.parentId === '' ? rootId : key.parentId) : staticParent.get(n.id) ?? null);
  }
  const keyFrameOf = (id: string): number => {
    const kfs = nodes[id]?.tracks?.parentKeys?.keyframes ?? [];
    let f = -Infinity;
    for (const kf of kfs) if (kf.frame <= frame && kf.frame > f) f = kf.frame;
    return f;
  };
  // 环回退：DFS 找环，环中最近切换者回退静态父级（静态结构是树、必收敛）
  for (let iter = 0; iter < 64; iter++) {
    const state = new Map<string, number>(); // 1 = 在栈上, 2 = 完成
    let cycle: string[] | null = null;
    const visit = (id: string, path: string[]): void => {
      if (cycle) return;
      const st = state.get(id) ?? 0;
      if (st === 2) return;
      if (st === 1) {
        cycle = path.slice(path.indexOf(id));
        return;
      }
      state.set(id, 1);
      const p = effParent.get(id);
      if (p && nodes[p] && p !== id) visit(p, [...path, id]);
      state.set(id, 2);
    };
    for (const id of Object.keys(nodes)) {
      visit(id, []);
      if (cycle) break;
    }
    const found = cycle as string[] | null;
    if (!found) break;
    let victim = found[0]!;
    for (const id of found) if (keyFrameOf(id) >= keyFrameOf(victim)) victim = id;
    effParent.set(victim, staticParent.get(victim) ?? null);
    effKey.set(victim, undefined);
  }
  // 够不到根的节点挂到根兜底
  const childrenOf = new Map<string, string[]>();
  for (const n of Object.values(nodes)) {
    const p = effParent.get(n.id);
    if (p && nodes[p] && p !== n.id) {
      const arr = childrenOf.get(p) ?? [];
      arr.push(n.id);
      childrenOf.set(p, arr);
    }
  }
  const reachable = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  for (const n of Object.values(nodes)) {
    if (n.id !== rootId && !reachable.has(n.id)) {
      effParent.set(n.id, rootId);
      effKey.set(n.id, undefined);
    }
  }
  const effChildren = new Map<string, string[]>();
  for (const n of Object.values(nodes)) {
    const p = effParent.get(n.id);
    if (p && nodes[p] && p !== n.id) {
      const arr = effChildren.get(p) ?? [];
      arr.push(n.id);
      effChildren.set(p, arr);
    }
  }
  const effNodes: Record<string, Node> = {};
  for (const n of Object.values(nodes)) {
    const key = effKey.get(n.id);
    let attachment = n.attachment;
    if (key) {
      if (key.socketId === null) {
        attachment = {
          ...n.attachment, type: 'fixed', parentSocketId: undefined,
          fixedOffset: key.fixedOffset ?? n.attachment.fixedOffset,
        };
      } else if (key.socketId !== undefined) {
        attachment = { ...n.attachment, type: 'socket', parentSocketId: key.socketId };
      }
    }
    effNodes[n.id] = {
      ...n,
      parentId: effParent.get(n.id) ?? undefined,
      attachment,
      children: effChildren.get(n.id) ?? [],
    };
  }
  return { ...character, nodes: effNodes };
}

export function computeWorldTransforms(
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  frameRate?: number,
  variableContext?: VariableContext,
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
  ikOverrides?: Map<string, { angle: number; tilt: number }>,
  geometryDirection?: DirectionIndex,
): Map<string, WorldTransform> {
  // 父级切换轨：FK 全程在按本帧有效父级重写的层级上跑
  character = effectiveCharacterAt(character, frame);
  if (!frameRate || frameRate <= 0) {
    let resolved = 12;
    try {
      // 懒加载避免循环依赖（与 puppet-keyframe-interpolation 同模式）
      const { useProjectStore } = require('./store') as typeof import('./store');
      resolved = useProjectStore.getState().frameRate || 12;
    } catch { /* store 不可用（离线语境）时回退 12 */ }
    frameRate = resolved;
  }
  const transforms = new Map<string, WorldTransform>();

  const rootNode = character.nodes[character.rootNodeId];
  if (!rootNode) return transforms;

  // 行为层在此统一求值：任何调用方（出图/点选/枢轴/覆盖层）都同源
  const behaviorTransforms = character.behaviorGraphs && Object.keys(character.behaviorGraphs).length > 0
    ? evaluateBehaviorTransforms(character, frame, frameRate, variableContext?.values)
    : undefined;

  // Root node: center of canvas + node's own offset
  const rootInterpolated = interpolateTransform(rootNode, frame, frameRate, variableContext, blueprintTransforms, ikOverrides, behaviorTransforms?.get(rootNode.id));
  const rootFrame = localRotMat(rootInterpolated.angle, rootInterpolated.tilt ?? 0);
  const rootWorld: WorldTransform = {
    nodeId: rootNode.id,
    // 3D 世界坐标以原点为中心，不含画布中心（画布中心在投影后 2D 阶段加）
    worldX: rootInterpolated.x,
    worldY: rootInterpolated.y,
    worldZ: rootInterpolated.z ?? 0,
    worldAngle: geometryDirection !== undefined
      ? frameViewAngleForDirection(rootFrame, geometryDirection, rootInterpolated.variantIndex)
      : frameViewAngle(rootFrame),
    worldFrame: rootFrame,
    worldStretch: rootInterpolated.stretch,
    variantIndex: rootInterpolated.variantIndex,
    mirror: false,
    scaleX: rootInterpolated.scaleX,
    skewX: rootInterpolated.skewX,
    skewY: rootInterpolated.skewY,
  };
  transforms.set(rootNode.id, rootWorld);

  // Recursively compute children
  computeChildTransforms(rootNode, rootWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms, ikOverrides, geometryDirection, behaviorTransforms);

  // IK（乙：真 3D）：首遍 FK 后解出各链关节的局部 (angle, tilt) 覆写，整树重算 FK——
  // 链外后代随 frame 复合自动跟随。ikOverrides 已传入时（重算遍）不再求解。
  if (!ikOverrides) {
    if (character.ikBlueprint) {
      applyBakedIKBlueprint(character, transforms, variableContext?.values, frame, frameRate);
      return transforms;
    }
    const chains = character.ikChains?.filter((c) => c.enabled && !isIKChainSuspended(c.id));
    if (chains && chains.length > 0) {
      const overrides = new Map<string, { angle: number; tilt: number }>();
      for (const chain of chains) {
        solveChainIKOverrides(character, chain, transforms, canvasWidth, canvasHeight, frame, frameRate, variableContext, blueprintTransforms, overrides, geometryDirection);
      }
      if (overrides.size > 0) {
        return computeWorldTransforms(character, frame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms, overrides, geometryDirection);
      }
    }
  }

  return transforms;
}

/**
 * Apply baked IK blueprint.
 *
 * Evaluates character.ikBlueprint and applies the resulting joint angles.
 * Nodes with _jointId param in their transform outputs indicate which
 * joint each angle applies to.
 */
function applyBakedIKBlueprint(
  character: Character,
  transforms: Map<string, WorldTransform>,
  vars?: Record<string, number>,
  frame: number = 0,
  frameRate: number = 12,
): void {
  const blueprint = character.ikBlueprint;
  if (!blueprint) return;

  const ctx: BlueprintEvalContext = { frame, frameRate, vars: vars ?? {} };

  // Evaluate each transform node that has a _jointId param
  for (const node of blueprint.nodes) {
    if (node.type !== 'transform') continue;
    const jointId = node.params._jointId as string | undefined;
    if (!jointId) continue;

    // Build a single-node graph to evaluate this transform
    const singleGraph: BlueprintGraph = {
      version: 1,
      nodes: blueprint.nodes,
      outputId: node.id,
    };
    const result = evaluateBlueprint(singleGraph, ctx);

    const t = transforms.get(jointId);
    if (t) {
      t.worldAngle = result.rotation;
      t.worldFrame = rotMatD(result.rotation);
    }
  }
}

// ---- IK 真 3D 求解（乙） ----
//
// 流程：首遍 FK 关节位置 → 3D 位置求解（2bone 解析 / FABRIK）→ 每关节 (angle, tilt)
// 闭式反解为局部覆写 → 整树重算 FK。FK/IK 同一套 frame 复合口径，故自洽：
// 重算后的关节位置与求解位置逐点一致（verify-ik-space A2）。

type V3 = { x: number; y: number; z: number };

/**
 * (angle, tilt) 闭式反解：求本地 L = RU(tilt)·RD(angle)，使
 * applyFrameRotation(Mprev·L, offWorld, variant) 的方向 == dirWorld（均为世界轴向量）。
 * 推导：等式化到 variant 朝向基坐标后即 L·ô = Mprev⁻¹·r̂（Mprev 为旋转阵，逆=转置）；
 * RD 先定 h 分量（两解取与 refAngle 近者，姿态连续），RU 再把 (y, d) 对齐。
 * inherit=false 时 Mprev 按单位阵（帧重置，与 FK 语义一致）。
 * |q.h| 超过偏移在 (h,y) 平面的投影长度时该方向不可达，a 钳到边界（残余误差由调用方断言监控）。
 */
function solveLocalAngleTilt(
  mPrev: Mat3,
  variant: DirectionIndex,
  offWorld: V3,
  dirWorld: V3,
  refAngleDeg: number,
  inherit: boolean,
): { angle: number; tilt: number } {
  const oW = Math.hypot(offWorld.x, offWorld.y, offWorld.z) || 1;
  const o = worldToViewBasis(offWorld.x / oW, offWorld.y / oW, offWorld.z / oW, variant);
  const dW = Math.hypot(dirWorld.x, dirWorld.y, dirWorld.z) || 1;
  const r = worldToViewBasis(dirWorld.x / dW, dirWorld.y / dW, dirWorld.z / dW, variant);
  const q = inherit ? mat3Apply(mat3Transpose(mPrev), r.h, r.y, r.d) : r;

  const rho = Math.hypot(o.h, o.y);
  const refRad = (refAngleDeg * Math.PI) / 180;
  let a: number;
  if (rho > 1e-9) {
    const phi = Math.atan2(o.y, o.h);
    const base = Math.acos(Math.max(-1, Math.min(1, q.h / rho)));
    const a1 = -phi + base;
    const a2 = -phi - base;
    const dist = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
    a = dist(a1, refRad) <= dist(a2, refRad) ? a1 : a2;
  } else {
    a = refRad;
  }
  const o1y = o.h * Math.sin(a) + o.y * Math.cos(a);
  const alpha1 = Math.atan2(o.d, o1y);
  const alpha2 = Math.atan2(q.d, q.y);
  const tilt = alpha1 - alpha2;
  return { angle: (a * 180) / Math.PI, tilt: (tilt * 180) / Math.PI };
}

/** 为一条链在首遍 FK（transforms）上求解各关节的局部 (angle, tilt) 覆写，写入 overrides */
function solveChainIKOverrides(
  character: Character,
  chain: IKChain,
  transforms: Map<string, WorldTransform>,
  canvasWidth: number,
  canvasHeight: number,
  frame: number,
  frameRate: number,
  variableContext: VariableContext | undefined,
  blueprintTransforms: Map<string, BlueprintTransformResult> | undefined,
  overrides: Map<string, { angle: number; tilt: number }>,
  geometryDirection?: DirectionIndex,
): void {
  // 关节链 root → end（与旧实现同走法）
  const jointIds: string[] = [];
  let currentId: string | undefined = chain.endNodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    jointIds.unshift(currentId);
    const node = character.nodes[currentId];
    if (!node) break;
    if (currentId === chain.rootNodeId) break;
    currentId = node.parentId;
  }
  if (jointIds.length < 2 || jointIds[0] !== chain.rootNodeId) return;

  const fk = jointIds.map((id) => transforms.get(id));
  if (fk.some((t) => !t)) return;
  const fkT = fk as WorldTransform[];
  const pos: V3[] = fkT.map((t) => ({ x: subToPx(t.worldX), y: subToPx(t.worldY), z: subToPx(t.worldZ) }));
  const n = jointIds.length;

  // 每段固定偏移（world 轴向量）：由 FK 帧逆旋转段向量还原——与 FK 合成严格互逆，不另算 socket/local
  const totals: V3[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const seg = { x: pos[i + 1].x - pos[i].x, y: pos[i + 1].y - pos[i].y, z: pos[i + 1].z - pos[i].z };
    lengths.push(Math.hypot(seg.x, seg.y, seg.z));
    totals.push(applyFrameRotation(mat3Transpose(fkT[i].worldFrame), seg.x, seg.y, seg.z, geometryDirection ?? fkT[i].variantIndex));
  }

  // 尖端：末关节 + 其 frame 的 +Y 轴 × tipLength（与 computeIKChainTip 同构造）
  let tipLength = chain.tipLength ?? 0;
  if (tipLength <= 0) {
    const endNode = character.nodes[chain.endNodeId];
    const sprite = endNode?.sprite;
    if (sprite && sprite.height > 0) {
      const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
      tipLength = Math.max(1, sprite.height - plugY);
    } else if (lengths.length > 0) {
      tipLength = lengths[lengths.length - 1];
    }
  }
  const points: V3[] = [...pos];
  if (tipLength > 1e-6) {
    const yAxis = frameYAxisWorld(fkT[n - 1].worldFrame, geometryDirection ?? fkT[n - 1].variantIndex);
    points.push({
      x: pos[n - 1].x + yAxis.x * tipLength,
      y: pos[n - 1].y + yAxis.y * tipLength,
      z: pos[n - 1].z + yAxis.z * tipLength,
    });
    lengths.push(tipLength);
  }

  // 目标：target3D（按链根朝向填充）+ targetBlueprint 的 XYZ 逐分量覆盖
  const dir0 = geometryDirection ?? fkT[0].variantIndex;
  const staticT = resolveChainTarget3D(chain, canvasWidth, canvasHeight, dir0);
  let target: V3 = { ...staticT };
  if (chain.targetBlueprint) {
    try {
      const tbResult = evaluateBlueprint(chain.targetBlueprint, { frame, frameRate, vars: variableContext?.values ?? {} });
      let drove = false;
      if (Number.isFinite(tbResult.translateX)) { target.x = tbResult.translateX; drove = true; }
      if (Number.isFinite(tbResult.translateY)) { target.y = tbResult.translateY; drove = true; }
      if (Number.isFinite(tbResult.translateZ)) { target.z = tbResult.translateZ; drove = true; }
      // 转位（改在 IK 蓝图的输入端）：图输出绕链根当前世界位在 XY 平面内转
      // transposeAngle——图本身不改，静态目标回退时不重复旋转（drove 门控）
      if (drove && chain.transposeAngle) {
        const rad = (chain.transposeAngle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = target.x - points[0].x;
        const dy = target.y - points[0].y;
        target.x = points[0].x + dx * cos - dy * sin;
        target.y = points[0].y + dx * sin + dy * cos;
      }
    } catch {
      // 蓝图求值失败时回退到静态目标
    }
  }

  // 位置求解
  let solved: V3[];
  if (chain.solver === '2bone' && lengths.length === 2) {
    let pole: V3 = chain.poleTarget3D ? { ...chain.poleTarget3D } : { ...points[1] };
    if (!chain.poleTarget3D && (chain.bendDir ?? 1) < 0) {
      // bendDir=-1 且无显式 pole：把 FK 肘位关于 root→target 轴镜像到另一侧
      const axis = { x: target.x - points[0].x, y: target.y - points[0].y, z: target.z - points[0].z };
      const al = Math.hypot(axis.x, axis.y, axis.z) || 1;
      const d = { x: axis.x / al, y: axis.y / al, z: axis.z / al };
      const rel = { x: pole.x - points[0].x, y: pole.y - points[0].y, z: pole.z - points[0].z };
      const proj = rel.x * d.x + rel.y * d.y + rel.z * d.z;
      pole = {
        x: points[0].x + 2 * proj * d.x - rel.x,
        y: points[0].y + 2 * proj * d.y - rel.y,
        z: points[0].z + 2 * proj * d.z - rel.z,
      };
    }
    const r = solveIK2Bone3D(points[0], target, lengths[0], lengths[1], pole);
    solved = [points[0], r.mid, r.end];
  } else {
    solved = solveIKFabrik3D(points, lengths, target);
  }

  // 位置 → 局部 (angle, tilt) 覆写：逐段沿链推进父帧（Mprev 与 FK 的 plain-product 复合口径一致）
  const rootNode = character.nodes[jointIds[0]];
  const parentId = rootNode?.parentId ?? undefined;
  const parentT = parentId ? transforms.get(parentId) : undefined;
  let mPrev: Mat3 = parentT ? parentT.worldFrame : MAT3_IDENTITY;
  let hasParent = !!parentT;
  for (let s = 0; s < lengths.length; s++) {
    const jid = jointIds[s];
    const node = character.nodes[jid];
    if (!node) break;
    const segDir = {
      x: solved[s + 1].x - solved[s].x,
      y: solved[s + 1].y - solved[s].y,
      z: solved[s + 1].z - solved[s].z,
    };
    if (Math.hypot(segDir.x, segDir.y, segDir.z) < 1e-9) continue;
    const offWorld = s < totals.length ? totals[s] : { x: 0, y: tipLength, z: 0 };
    const inherit = hasParent && node.attachment?.inheritRotation !== false;
    const ref = interpolateTransform(node, frame, frameRate, variableContext, blueprintTransforms);
    const { angle, tilt } = solveLocalAngleTilt(mPrev, geometryDirection ?? fkT[s].variantIndex, offWorld, segDir, ref.angle, inherit);
    overrides.set(jid, { angle, tilt });
    const local = localRotMat(angle, tilt);
    mPrev = inherit ? mat3Mul(mPrev, local) : local;
    hasParent = true;
  }
}



function computeChildTransforms(
  parentNode: Node,
  parentWorld: WorldTransform,
  character: Character,
  frame: number,
  transforms: Map<string, WorldTransform>,
  frameRate: number = 12,
  variableContext?: VariableContext,
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
  ikOverrides?: Map<string, { angle: number; tilt: number }>,
  geometryDirection?: DirectionIndex,
  behaviorTransforms?: Map<string, { rotation: number; translateX: number; translateY: number }>,
): void {
  for (const childId of parentNode.children) {
    const childNode = character.nodes[childId];
    if (!childNode) continue;

    const childInterpolated = interpolateTransform(childNode, frame, frameRate, variableContext, blueprintTransforms, ikOverrides, behaviorTransforms?.get(childId));
    let childWorldX: SubPixel;
    let childWorldY: SubPixel;
    let childWorldZ: SubPixel;
    let childMirror = parentWorld.mirror;

    if (childNode.attachment.type === 'socket' && childNode.attachment.parentSocketId) {
      // Socket-based attachment: compute from parent's socket position
      const socket = parentNode.sockets.find(s => s.id === childNode.attachment!.parentSocketId);
      if (socket) {
        // Socket 3D 偏移：走共同口径 socketOffsetTo3D（offset3D 或 2D→3D 映射）
        const s3 = socketOffsetTo3D(socket, geometryDirection ?? parentWorld.variantIndex);
        const sockX3D = s3.x;
        const sockZ3D = s3.z;
        const sockY = s3.y;
        const childOffsetX_px = subToPx(childInterpolated.x);
        const childOffsetY_px = subToPx(childInterpolated.y) * childInterpolated.stretch;
        const childOffsetZ_px = subToPx(childInterpolated.z ?? 0);
        // 合并偏移：socket 3D + child 3D（姿态）
        const totalX = sockX3D + childOffsetX_px;
        const totalY = sockY + childOffsetY_px;
        const totalZ = sockZ3D + childOffsetZ_px;
        // 旋转：父 frame 复合旋转（tilt 全 0 时与旧 rotateInViewPlane(父 worldAngle) 逐值相同）
        const rotated = applyFrameRotation(parentWorld.worldFrame, totalX, totalY, totalZ, geometryDirection ?? parentWorld.variantIndex);
        childWorldX = parentWorld.worldX + pxToSub(rotated.x);
        childWorldY = parentWorld.worldY + pxToSub(rotated.y);
        childWorldZ = parentWorld.worldZ + pxToSub(rotated.z);
      } else {
        childWorldX = parentWorld.worldX + childInterpolated.x;
        childWorldY = parentWorld.worldY + childInterpolated.y;
        childWorldZ = parentWorld.worldZ + childInterpolated.z;
      }

      // Check if this direction requires mirroring
      const mirrorMap = childNode.slot?.mirrorMap ?? DEFAULT_MIRROR_MAP;
      if (mirrorMap[childInterpolated.variantIndex] !== undefined) {
        childMirror = !parentWorld.mirror; // Toggle mirror
      }

    } else {
      // Fixed attachment: offset rotated by parent's world angle
      const fixedOffset = childNode.attachment.fixedOffset ?? { x: 0, y: 0 };

      // Combine fixed offset + child's local offset (3D)
      const totalOffsetX_px = subToPx(fixedOffset.x) + subToPx(childInterpolated.x);
      const totalOffsetY_px = subToPx(fixedOffset.y) + subToPx(childInterpolated.y) * childInterpolated.stretch;
      const totalOffsetZ_px = subToPx(childInterpolated.z ?? 0);
      // 旋转：父 frame 复合旋转（同 socket 分支）
      const rotated2 = applyFrameRotation(parentWorld.worldFrame, totalOffsetX_px, totalOffsetY_px, totalOffsetZ_px, geometryDirection ?? parentWorld.variantIndex);

      childWorldX = parentWorld.worldX + pxToSub(rotated2.x);
      childWorldY = parentWorld.worldY + pxToSub(rotated2.y);
      childWorldZ = parentWorld.worldZ + pxToSub(rotated2.z);
    }

    // Frame 复合：inheritRotation 时父 frame · 本地 (angle, tilt)，否则只用本地
    // （tilt 全 0 时退化为旧标量角相加/重置，逐值一致）
    const childLocalFrame = localRotMat(childInterpolated.angle, childInterpolated.tilt ?? 0);
    const childFrame = childNode.attachment.inheritRotation !== false
      ? mat3Mul(parentWorld.worldFrame, childLocalFrame)
      : childLocalFrame;

    const childWorld: WorldTransform = {
      nodeId: childId,
      worldX: childWorldX,
      worldY: childWorldY,
      worldZ: childWorldZ,
      worldAngle: geometryDirection !== undefined
        ? frameViewAngleForDirection(childFrame, geometryDirection, childInterpolated.variantIndex)
        : frameViewAngle(childFrame),
      worldFrame: childFrame,
      worldStretch: childInterpolated.stretch,
      variantIndex: childInterpolated.variantIndex,
      mirror: childMirror,
      scaleX: childInterpolated.scaleX,
      skewX: childInterpolated.skewX,
      skewY: childInterpolated.skewY,
    };
    transforms.set(childId, childWorld);

    // Recurse into children
    computeChildTransforms(childNode, childWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms, ikOverrides, geometryDirection, behaviorTransforms);
  }
}

// ---- Socket Offset Resolution ----

/**
 * Get the effective socket offset for a given direction.
 * Falls back to basePosition if no direction-specific offset exists.
 */
function resolveSocketOffset(socket: Socket, direction: DirectionIndex): Point {
  return socket.directionOffsets[direction] ?? socket.basePosition;
}

/** 节点转向（乙案：全员基准 3D 真转）的几何基准朝向：世界 3D 固定在此朝向下计算
 * （socket 嵌入、frame 基、姿势偏移、IK 目标填充），投影与选图仍用目标朝向。
 * 南向（6）与烘焙/模型空间一致：θ=0 时 2D 布局原样嵌入 z=0 平面。 */
export const GEOMETRY_CANONICAL_DIRECTION: DirectionIndex = 6;

/** 视图开关 → 几何方向参数：关 = undefined（全部表达式回落到节点 variantIndex，与旧行为逐值一致） */
export function geometryDirectionFromToggle(on: boolean): DirectionIndex | undefined {
  return on ? GEOMETRY_CANONICAL_DIRECTION : undefined;
}

/**
 * Socket 偏移 → 3D（像素）。全项目唯一口径：所有需要 socket 3D 偏移的地方
 * （渲染、伪 3D 烘焙、覆盖层、命中）都必须走这里，不得各自再算。
 * - offset3D 存在（3D 管线，选项 A）：直接用 3D 向量
 * - 否则（2D 管线）：2D 偏移按朝向映射到 3D（sx·cosθ→X、sy→Y、sx·sinθ→Z）
 */
export function socketOffsetTo3D(socket: Socket, variantIndex: DirectionIndex): { x: number; y: number; z: number } {
  if (socket.offset3D) {
    return { x: subToPx(socket.offset3D.x), y: subToPx(socket.offset3D.y), z: subToPx(socket.offset3D.z) };
  }
  const socketOffset = resolveSocketOffset(socket, variantIndex);
  const sx = subToPx(socketOffset.x);
  const sy = subToPx(socketOffset.y);
  const t = directionTrig(variantIndex);
  return { x: sx * t.cos, y: sy, z: sx * t.sin };
}

// ---- Transform Interpolation ----

/**
 * Interpolate a node's transform at the given frame using its tracks.
 * Falls back to the node's base transform for properties without tracks.
 * Also applies animation modifier contributions (pendulum, bounce, etc.)
 * as additive offsets on top of the keyframe-driven base transform.
 */
function interpolateTransform(
  node: Node,
  frame: number,
  frameRate: number = 12,
  variableContext?: VariableContext,
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
  ikOverrides?: Map<string, { angle: number; tilt: number }>,
  behavior?: { rotation: number; translateX: number; translateY: number },
): NodeTransform {
  const r0 = interpolateTransformImpl(node, frame, frameRate, variableContext, blueprintTransforms);
  // 行为层：行为图输出叠加在关键帧/蓝图/旧修改器之上（单位与蓝图路径
  // 一致：平移 px→SubPixel、旋转度）；所有走 computeWorldTransforms 的
  // 路径（出图/点选/枢轴/覆盖层）同源生效
  const r = behavior
    ? {
        ...r0,
        x: r0.x + pxToSub(behavior.translateX),
        y: r0.y + pxToSub(behavior.translateY),
        angle: r0.angle + behavior.rotation,
      }
    : r0;
  // IK 覆写：求解出的局部 (angle, tilt) 绝对替换（乙的注入层，与蓝图同一层级之上）
  const ov = ikOverrides?.get(node.id);
  return ov ? { ...r, angle: ov.angle, tilt: ov.tilt } : r;
}

function interpolateTransformImpl(
  node: Node,
  frame: number,
  frameRate: number = 12,
  variableContext?: VariableContext,
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
): NodeTransform {
  const base = node.transform;

  // Step 1: Keyframe-driven base transform
  const kfX = interpolateTrack(node.tracks.x, frame, base.x);
  const kfY = interpolateTrack(node.tracks.y, frame, base.y);
  const kfZ = base.z ?? 0; // 暂无 z 轨道，直接用 base（3D 烘焙写入）；旧数据缺 z 时默 0
  const kfAngle = interpolateTrack(node.tracks.angle, frame, base.angle);
  const kfTilt = interpolateTrack(node.tracks.tilt, frame, base.tilt ?? 0);
  const kfStretch = interpolateTrack(node.tracks.stretch, frame, base.stretch);
  const kfScaleX = interpolateTrack(node.tracks.scaleX, frame, base.scaleX ?? 1);
  const kfVariant = interpolateTrack(node.tracks.variantIndex, frame, base.variantIndex) as DirectionIndex;

  // Step 2 (path B): Blueprint-driven modifier contributions (preferred)
  const bpT = blueprintTransforms?.get(node.id);
  if (bpT) {
    return {
      x: kfX + pxToSub(bpT.translateX),
      y: kfY + pxToSub(bpT.translateY),
      // 蓝图 translateZ 是节点的程序化 z 通道（z 无关键帧轨道，这是唯一的动态 z 来源）
      z: kfZ + pxToSub(bpT.translateZ ?? 0),
      angle: kfAngle + bpT.rotation,
      tilt: kfTilt + (bpT.tilt ?? 0),
      stretch: kfStretch * bpT.scaleY,
      scaleX: kfScaleX * bpT.scaleX,
      skewX: (base.skewX ?? 0) + bpT.skewX,
      skewY: (base.skewY ?? 0) + bpT.skewY,
      variantIndex: kfVariant,
    };
  }

  // Step 2 (legacy fallback): Resolve animation modifiers via old resolver
  const animMods = resolveNodeModifiers(
    node.modifiers.filter(m => isAnimationModifier(m.type)),
    frame,
    variableContext,
  );

  if (animMods.length > 0) {
    const animTransform = computeAnimationModifierTransform(animMods, frame, frameRate);
    return {
      x: kfX + pxToSub(animTransform.translateX),
      y: kfY + pxToSub(animTransform.translateY),
      z: kfZ,
      angle: kfAngle + animTransform.rotation,
      tilt: kfTilt,
      stretch: kfStretch * ((animTransform.scaleX + animTransform.scaleY) / 2), // Average scale as stretch
      scaleX: kfScaleX,
      skewX: base.skewX,
      skewY: base.skewY,
      variantIndex: kfVariant,
    };
  }

  return {
    x: kfX,
    y: kfY,
    z: kfZ,
    angle: kfAngle,
    tilt: kfTilt,
    stretch: kfStretch,
    scaleX: kfScaleX,
    skewX: base.skewX,
    skewY: base.skewY,
    variantIndex: kfVariant,
  };
}

/**
 * Effect modifier types that render additional visual elements
 * (glow behind, particles on top, etc.) around the sprite.
 */
const EFFECT_MOD_TYPES: string[] = ['glow', 'afterimage', 'motion_blur', 'particle'];

/**
 * Check if a modifier type is an animation modifier (produces transform offsets)
 * vs. an edit modifier (produces pixel-level changes) or effect modifier.
 *
 * Note: 'elliptical_compress' was previously listed here, but in the old pipeline
 * it is handled as a pixel-deform modifier (PIXEL_DEFORM_MODIFIER_TYPES),
 * NOT as a transform-level animation modifier. It has been removed from this list
 * to match the old pipeline's behavior.
 */
function isAnimationModifier(type: string): boolean {
  return [
    'pendulum', 'wheel', 'bounce', 'breath', 'wobble',
    'gait', 'custom_wave',
    'float', 'shake', 'elastic',
  ].includes(type);
}

/**
 * Interpolate a single track at the given frame.
 * Returns the base value if no track or no keyframes.
 *
 * Supports three interpolation modes:
 * - step: hold previous keyframe value until next keyframe
 * - linear: straight-line interpolation between keyframes
 * - bezier: cubic bezier easing with time-parameterized curve
 *   (control points are normalized [0,1]² vectors;
 *    Newton-Raphson iteration finds the bezier parameter s
 *    where Bx(s) = t, then evaluates By(s) for the value fraction)
 */
function interpolateTrack<T extends number>(
  track: KeyframeTrack<T> | undefined,
  frame: number,
  baseValue: T,
): T {
  if (!track || track.keyframes.length === 0) return baseValue;

  const kfs = track.keyframes;

  // Before first keyframe: hold first value
  if (frame <= kfs[0].frame) return kfs[0].value;

  // After last keyframe: hold last value
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frame >= kfs[i].frame && frame <= kfs[i + 1].frame) {
      const mode = kfs[i + 1].interpolation ?? track.interpolation;

      switch (mode) {
        case 'step':
          return kfs[i].value;

        case 'linear': {
          const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
          return (kfs[i].value + (kfs[i + 1].value - kfs[i].value) * t) as T;
        }

        case 'bezier': {
          // Time fraction between the two keyframes
          const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
          const v0 = kfs[i].value;
          const v1 = kfs[i + 1].value;

          // Normalized control points in [0,1]² space.
          // Default: ease-in-out (0.33, 0) → (0.66, 1)
          const cp1 = kfs[i].bezierCP1 ?? { x: 0.33, y: 0 };
          const cp2 = kfs[i + 1].bezierCP2 ?? { x: 0.66, y: 1 };

          // Evaluate cubic bezier easing.
          // P0 = (0, 0), P1 = cp1, P2 = cp2, P3 = (1, 1)
          // Find s such that Bx(s) = t, then return v0 + By(s) * (v1 - v0)
          const easedT = solveCubicBezierX(cp1.x, cp2.x, t);
          const easedY = cubicBezierY(cp1.x, cp1.y, cp2.x, cp2.y, easedT);

          return (v0 + easedY * (v1 - v0)) as T;
        }

        default:
          return kfs[i].value;
      }
    }
  }

  return baseValue;
}

// ---- Cubic Bezier Easing ----

/**
 * Evaluate Bx(s) for a cubic bezier with P0=(0,0), P1=(cp1x,?), P2=(cp2x,?), P3=(1,1).
 * Only the x-coordinates of control points matter for Bx.
 */
function cubicBezierX(cp1x: number, cp2x: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * cp1x + 3 * ms * s * s * cp2x + s * s * s;
}

/**
 * Evaluate By(s) for a cubic bezier with P0=(0,0), P1=(cp1x,cp1y), P2=(cp2x,cp2y), P3=(1,1).
 */
function cubicBezierY(cp1x: number, cp1y: number, cp2x: number, cp2y: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * s * cp1y + 3 * ms * s * s * cp2y + s * s * s;
}

/**
 * Evaluate derivative Bx'(s).
 */
function cubicBezierXDeriv(cp1x: number, cp2x: number, s: number): number {
  const ms = 1 - s;
  return 3 * ms * ms * cp1x + 6 * ms * s * (cp2x - cp1x) + 3 * s * s * (1 - cp2x);
}

/**
 * Solve Bx(s) = t using Newton-Raphson iteration.
 * Falls back to binary search if Newton-Raphson diverges.
 *
 * This is the standard approach used by CSS and most animation systems
 * for time-parameterized cubic bezier easing.
 */
function solveCubicBezierX(cp1x: number, cp2x: number, t: number): number {
  // Edge cases
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Linear case: control points at 1/3 and 2/3 produce approximately linear X
  if (Math.abs(cp1x - 1 / 3) < 1e-6 && Math.abs(cp2x - 2 / 3) < 1e-6) {
    return t;
  }

  // Newton-Raphson iteration (typically converges in 4-8 iterations)
  let s = t; // Initial guess
  for (let i = 0; i < 8; i++) {
    const x = cubicBezierX(cp1x, cp2x, s) - t;
    const dx = cubicBezierXDeriv(cp1x, cp2x, s);
    if (Math.abs(dx) < 1e-12) break; // Near-zero derivative, fall back to bisection
    const sNew = s - x / dx;
    if (Math.abs(sNew - s) < 1e-8) return sNew; // Converged
    s = sNew;
  }

  // If Newton-Raphson didn't converge, use binary search
  let lo = 0, hi = 1;
  s = t;
  for (let i = 0; i < 20; i++) {
    const x = cubicBezierX(cp1x, cp2x, s);
    if (Math.abs(x - t) < 1e-8) return s;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }

  return s;
}

// ---- Z-Order Computation ----

/**
 * 关节盘生成判定（唯一口径）：plug 开关 attachment.autoJointDisc 未关（默认开）
 * 且节点经 socket 连接到父插口。node.generated 是旧数据，不再作门——仅其
 * crossSectionId 在直径回退时被采用（见 generateDiscInstructions）。
 * 蒙皮快照生效的连接另行抑制（见 generateDiscInstructions 的认领判定）。
 */
function nodeHasJointDisc(node: Node): boolean {
  if (node.attachment?.type !== 'socket' || !node.attachment.parentSocketId) return false;
  if (node.attachment.autoJointDisc === false) return false;
  return true;
}

/**
 * 蒙皮快照认领（唯一口径，渲染计划与关节盘抑制共用）：
 * 返回当前朝向真正生效的快照（子节点 id → 快照 + 父节点 id）。
 * 规则：一父只被一个子认领（首个）；被认领为父的节点自身快照停用（防双绘）。
 */
function computeActiveSnapshots(
  character: Character,
  direction: DirectionIndex,
): Map<string, { snap: SkinningSnapshot; parentId: string }> {
  const candidates = new Map<string, { snap: SkinningSnapshot; parentId: string }>();
  for (const n of Object.values(character.nodes)) {
    const att = n.attachment;
    if (!att || att.type !== 'socket' || !att.parentSocketId) continue;
    if (att.allowSkinning !== true || !att.skinningSnapshot) continue;
    if (att.skinningSnapshot.direction !== direction) continue;
    if (!n.parentId) continue;
    candidates.set(n.id, { snap: att.skinningSnapshot, parentId: n.parentId });
  }
  const claimedBy = new Map<string, string>();
  for (const [childId, c] of candidates) {
    if (!claimedBy.has(c.parentId)) claimedBy.set(c.parentId, childId);
  }
  const active = new Map<string, { snap: SkinningSnapshot; parentId: string }>();
  for (const [childId, c] of candidates) {
    if (claimedBy.get(c.parentId) !== childId) continue; // 认领落败
    if (claimedBy.has(childId)) continue; // 自身被子认领 → 停用（防双绘）
    active.set(childId, c);
  }
  return active;
}

// ---- Sprite Resolution ----

/**
 * Resolve which sprite to use for a node at the current direction.
 * Priority: costumeSet → directionSprites → default sprite
 */
function resolveSprite(
  node: Node,
  direction: DirectionIndex,
  costumeSet?: import('./unified-types').CostumeSet,
  sprites?: Record<string, import('./unified-types').Sprite>,
  variantId?: string,
  latitude?: number,
  // 动态表面（D1）：当前帧与工程帧率——表面图带 animation 时按
  // frame/frameRate 算离散相位取对应烘焙；缺省 = 相位 0（静态口径）
  frame?: number,
  frameRate?: number,
): { sprite: Sprite | null; mirror: boolean; spriteId: string | null } {
  // 参数化优先（用户拍板）：生效服装件带 parametric 时，主画布以参数化
  // 烘焙精灵渲染，盖过精灵图。件键走产品回退口径 slot.slotKey ?? nodeId。
  // 合成三档（appearance.composite）：generate 独立生成（形状轮廓）；
  // silhouette/overlay 先按分层规则解析当前方向的精灵作轮廓/底图，
  // 按该精灵自身的 mirror 出图；无精灵可借时回落独立生成。
  if (costumeSet) {
    const piece = costumeSet.pieces[node.slot?.slotKey ?? node.id];
    if (piece?.parametric) {
      const { buildParametricSprite, PARAMETRIC_MIRROR_DIRECTIONS } = require('./proc-runtime/main-canvas') as typeof import('./proc-runtime/main-canvas');
      const { surfaceAnimationOf, surfacePhaseAt } = require('./proc-runtime/surface-animation') as typeof import('./proc-runtime/surface-animation');
      const app = piece.parametric;
      const anim = surfaceAnimationOf(app.surfaceGraph);
      const phase = anim ? surfacePhaseAt(anim, (frame ?? 0) / (frameRate ?? 12)) : 0;
      if ((app.composite ?? 'generate') !== 'generate' && sprites) {
        const base = resolvePieceSprite(piece, direction, variantId, sprites, latitude);
        if (base.sprite) {
          const spr = buildParametricSprite(app, node.id, base.sprite, phase);
          if (spr) return { sprite: spr, mirror: base.mirror, spriteId: null };
        }
      }
      const spr = buildParametricSprite(app, node.id, undefined, phase);
      if (spr) return { sprite: spr, mirror: PARAMETRIC_MIRROR_DIRECTIONS.has(direction), spriteId: null };
    }
  }
  // 只走服装集：node.slot 只定义槽位，不存精灵。
  // 分层解析（纬度→变体→基础）走 sprite-resolve 的共同实现，与蓝图预览逐级一致。
  if (costumeSet && node.slot) {
    const piece = costumeSet.pieces[node.slot.slotKey];
    return resolvePieceSprite(piece, direction, variantId, sprites, latitude);
  }
  return { sprite: null, mirror: false, spriteId: null };
}

/**
 * Resolve the sprite ID for a node's current sprite (same logic as render).
 * Returns null when the sprite is embedded (no table ID) or missing.
 * Used by UI (e.g. heightmap editor) to write back to the global sprites table.
 */
export function resolveNodeSpriteId(
  character: import('./unified-types').Character,
  nodeId: string,
  direction: DirectionIndex,
  globalSprites?: Record<string, import('./unified-types').Sprite>,
): string | null {
  const node = character.nodes[nodeId];
  if (!node) return null;
  const activeCs = (character.costumeSets ?? []).find((cs) => cs.id === character.activeCostumeSetId);
  const spriteTable = globalSprites ?? character.sprites ?? {};
  const { spriteId } = resolveSprite(node, direction, activeCs, spriteTable, character.slotVariants?.[node.slot?.slotKey ?? ''], character.latitude ?? 0);
  return spriteId;
}

// ---- Disc Generation ----

/**
 * Step 4 (partial): Generate disc render instructions for nodes
 * with `generated` configuration.
 *
 * Disc diameter = the joint opening width (plug-side), via getPlugJointWidth:
 *   plug.jointWidth (written at creation) > plug position → crossSectionTop/Bottom > 4.
 * No longer averaged with parent bottom (that made discs a ring too big at
 * non-bottom sockets like shoulders).
 *
 * The disc is positioned at the socket world position (the connection
 * point between parent and child), NOT at the child node's world position.
 */
function generateDiscInstructions(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
  canvasWidth: number,
  canvasHeight: number,
  currentDirection: DirectionIndex,
  activeSnapshots: Map<string, { snap: SkinningSnapshot; parentId: string }>,
  activeCostumeSet?: import('./unified-types').CostumeSet,
  spriteTable?: Record<string, Sprite>,
  geometryDirection?: DirectionIndex,
): DiscRenderInstruction[] {
  const discs: DiscRenderInstruction[] = [];

  for (const [nodeId, node] of Object.entries(character.nodes)) {
    if (!nodeHasJointDisc(node)) continue;
    if (activeSnapshots.has(nodeId)) continue; // 蒙皮快照生效：改走合并精灵弯曲，不出盘

    // mesh 蒙皮模式：不生成关节盘（由像素变形代替）
    if (node.attachment?.type === 'socket' && node.attachment.parentSocketId && node.parentId) {
      const parentNode = character.nodes[node.parentId];
      const socket = parentNode?.sockets.find(s => s.id === node.attachment!.parentSocketId);
      if (socket?.skinning === 'mesh') continue;
    }

    const worldTf = worldTransforms.get(nodeId);
    if (!worldTf) continue;

    // Find parent node to get its crossSectionBottom
    const parentNode = node.parentId ? character.nodes[node.parentId] : undefined;

    // 当前精灵（与下方配色采样同一解析）：直径回退与配色共用。
    // （旧代码读 node.sprite——现行管线从不赋值，截面回退因此恒走不到、
    // 无 jointWidth 的节点盘恒为 4px；这里改走 resolveSprite 修活。）
    const resolved = resolveSprite(node, currentDirection, activeCostumeSet, spriteTable, character.slotVariants?.[node.slot?.slotKey ?? ''], character.latitude ?? 0);
    const currentSprite = resolved.sprite;

    // 无精灵可遮盖（占位/结构节点）不出盘：按上面的同一解析判——精灵
    // 住在生效服装件里（向导角色 node.slot 本身不带 sprites，只看
    // slot.sprites 会把向导角色的每个关节都误判成占位、整批不出盘）。
    if (!node.sprite && !currentSprite) continue;

    // 关节盘直径 = plug 侧开口宽度（与 carve 同源，不再与 parent bottom 求平均）。
    // 优先用 attachment.jointWidth（创建时写入），否则按 plug 位置回退估算。
    const storedJointWidth = node.attachment?.jointWidth;
    let diameter: number;
    if (typeof storedJointWidth === 'number' && storedJointWidth > 0) {
      diameter = storedJointWidth;
    } else {
      const childPiece = node.slot;
      const plugCS = (childPiece?.crossSections ?? []).find(cs => cs.id === (node.generated?.crossSectionId ?? 'plug'));
      const bottomCS = (childPiece?.crossSections ?? []).find(cs => cs.id === 'bottom');
      diameter = getPlugJointWidth(
        {
          plug: node.attachment?.plug
            ? { localX: subToPx(node.attachment.plug.x), localY: subToPx(node.attachment.plug.y) }
            : null,
          crossSectionTop: plugCS?.diameter,
          // 现行数据里服装件只有 'plug' 一个截面：'bottom' 缺失时以它兜底，
          // 否则 plug 位于精灵下半时回退仍然落空
          crossSectionBottom: bottomCS?.diameter ?? plugCS?.diameter,
        },
        currentSprite
          ? {
              width: currentSprite.width,
              height: currentSprite.height,
              pivotX: subToPx(currentSprite.plug?.x ?? 0),
              pivotY: subToPx(currentSprite.plug?.y ?? 0),
            }
          : null,
      );
    }
    diameter = Math.max(1, diameter);

    // Position the disc at the socket world position (connection point),
    // not at the child node's world position.
    // 与节点指令同一口径：3D 世界坐标 → socketOffsetTo3D → 视平面旋转 → 投影 + 画布中心。
    // （此前：2D socket 数学的结果直接当画布坐标——没投影、没中心化、没读 offset3D，盘位置全错）
    let socketWorldX = worldTf.worldX;
    let socketWorldY = worldTf.worldY;
    let socketWorldZ = worldTf.worldZ;

    if (parentNode && node.attachment.type === 'socket' && node.attachment.parentSocketId) {
      // Find the socket on the parent
      const socket = parentNode.sockets.find(s => s.id === node.attachment!.parentSocketId);
      if (socket) {
        const parentWorldTf = worldTransforms.get(parentNode.id);
        if (parentWorldTf) {
          // Compute socket 3D position (same math as computeChildTransforms)
          const s3 = socketOffsetTo3D(socket, geometryDirection ?? parentWorldTf.variantIndex);
          const rot = applyFrameRotation(parentWorldTf.worldFrame, s3.x, s3.y, s3.z, geometryDirection ?? parentWorldTf.variantIndex);
          socketWorldX = (parentWorldTf.worldX + pxToSub(rot.x)) as SubPixel;
          socketWorldY = (parentWorldTf.worldY + pxToSub(rot.y)) as SubPixel;
          socketWorldZ = (parentWorldTf.worldZ + pxToSub(rot.z)) as SubPixel;
        }
      }
    }

    // 投影到 2D 并加画布中心（与节点指令完全同一口径）
    const discProj = projectToView(socketWorldX, socketWorldY, socketWorldZ, currentDirection);
    const discWorldX = (pxToSub(canvasWidth / 2) + (discProj.canvasX as SubPixel)) as SubPixel;
    const discWorldY = (pxToSub(canvasHeight / 2) + (discProj.canvasY as SubPixel)) as SubPixel;

    // 关节盘无 zIndex、不参与深度排序：执行端在全部精灵之前统一先画，
    // 始终被遮挡，只在没有精灵覆盖的开口处露出来补缝（规格）。

    // 关节盘配色（生成时自动按精灵配色）：plug.discColor 自定义 > 子节点当前
    // 精灵在 plug（关节）处采样的众数色（排除轮廓色）> piece.fillColor 兜底。
    // 精灵走与节点指令相同的解析（node.sprite 现行管线从不赋值，旧采样分支是死代码，
    // 此前实际一直用 fillColor——烘焙导入件为 #ffffff，盘恒为白色）。
    const childPiece = node.slot;
    let fillColor: string = childPiece?.fillColor ?? '#808080';
    const customDiscColor = node.attachment?.discColor;
    if (typeof customDiscColor === 'string' && customDiscColor) {
      fillColor = customDiscColor;
    } else {
      const spr = currentSprite;
      if (spr?.data && spr.plug) {
        let sampleX = subToPx(spr.plug.x);
        const sampleY = subToPx(spr.plug.y);
        if (resolved.mirror) sampleX = spr.width - 1 - sampleX;
        const sampled = sampleJointDiscColor(spr.data, sampleX, sampleY);
        if (sampled) fillColor = sampled;
      }
    }
    const outlineColor = '#000000'; // From global palette in full implementation

    discs.push({
      worldX: discWorldX,
      worldY: discWorldY,
      diameter,
      fillColor: typeof fillColor === 'string' ? fillColor : '#808080',
      outlineColor,
    });
  }

  return discs;
}

/**
 * 人偶兜底指令生成（编辑器专用）：给「本帧没有产出任何节点指令」的
 * 可见节点一段胶囊体（父 socket 连接点 → 本关节），让有骨无形的阶段
 * （向导新建、拆分中间态、精灵缺失）也有跟随姿态的体量形象。
 * 段 = 父关节 → 本关节（关节 = 节点世界原点，projectToView + 画布
 * 中心，与关节盘同投影口径）——胶囊链穿过各关节点位，与 PoseSketcher
 * 的关节点集同构。半径：attachment.jointWidth/2 首选，缺失时按段长
 * 16% 估算（钳 1.5–16px，借 PoseSketcher 胶囊半径相对标尺的口径，
 * 标尺换成本段长）。被蒙皮快照认领的父节点（claimedParents）精灵
 * 已并入子节点合并图，不算无精灵、跳过。
 */
function generateMannequinInstructions(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
  canvasWidth: number,
  canvasHeight: number,
  currentDirection: DirectionIndex,
  instructedNodeIds: ReadonlySet<string>,
  claimedParents: ReadonlySet<string>,
): MannequinRenderInstruction[] {
  const out: MannequinRenderInstruction[] = [];
  const centerSubX = pxToSub(canvasWidth / 2);
  const centerSubY = pxToSub(canvasHeight / 2);
  const project = (wx: SubPixel, wy: SubPixel, wz: SubPixel) => {
    const p = projectToView(wx, wy, wz, currentDirection);
    return {
      x: (centerSubX + (p.canvasX as SubPixel)) as SubPixel,
      y: (centerSubY + (p.canvasY as SubPixel)) as SubPixel,
    };
  };

  // 第一遍：各节点的关节位置与连接点（起点）
  const joints = new Map<string, { sx: SubPixel; sy: SubPixel; ex: SubPixel; ey: SubPixel }>();
  for (const [nodeId, node] of Object.entries(character.nodes)) {
    if (!node.visible) continue;
    if (instructedNodeIds.has(nodeId) || claimedParents.has(nodeId)) continue;
    const worldTf = worldTransforms.get(nodeId);
    if (!worldTf) continue;
    const end = project(worldTf.worldX, worldTf.worldY, worldTf.worldZ);
    let start = end;
    const parentWorldTf = node.parentId ? worldTransforms.get(node.parentId) : undefined;
    if (parentWorldTf) {
      start = project(parentWorldTf.worldX, parentWorldTf.worldY, parentWorldTf.worldZ);
    }
    joints.set(nodeId, { sx: start.x, sy: start.y, ex: end.x, ey: end.y });
  }

  // 半径：jointWidth 首选，否则按本段长估算（根节点无段长 → 5px）
  const radiusOf = (nodeId: string): number => {
    const node = character.nodes[nodeId];
    const jw = node?.attachment?.jointWidth;
    if (typeof jw === 'number' && jw > 0) return jw / 2;
    const j = joints.get(nodeId);
    if (!j) return 5;
    const lenPx = Math.hypot(subToPx(j.ex) - subToPx(j.sx), subToPx(j.ey) - subToPx(j.sy));
    if (lenPx <= 0.01) return 5;
    return Math.min(16, Math.max(1.5, lenPx * 0.16));
  };

  for (const [nodeId, j] of joints) {
    const node = character.nodes[nodeId]!;
    const parentId = node.parentId ?? undefined;
    out.push({
      nodeId,
      x1: j.sx, y1: j.sy, x2: j.ex, y2: j.ey,
      r1: parentId ? radiusOf(parentId) : radiusOf(nodeId),
      r2: radiusOf(nodeId),
      fillColor: '#8f9bb0',
      outlineColor: '#4a5160',
    });
  }
  return out;
}

// ---- Render Plan Generation ----

/**
 * Generate the complete render plan for a frame.
 * This is the main entry point for the unified render pipeline.
 *
 * Now supports animation modifier resolution: each node's modifiers
 * are resolved at the given frame (paramKeyframes + paramDrivers)
 * before computing world transforms, ensuring procedural animation
 * contributions (pendulum, bounce, etc.) are included.
 */
/** 本帧生效的服装状态（generateRenderPlan 内部唯一口径） */
export interface EffectiveCostumeState {
  costumeSetId?: string;
  slotVariants: Record<string, string>;
}

/**
 * 生效服装状态的前两层：角色静态字段 + clip 状态轨道（不含状态蓝图）。
 * 时间轴的轨道摘要与「记录」diff 以此为口径（蓝图是程序化层，不进轨道编辑）。
 */
export function resolveTrackCostumeState(
  character: Character,
  frame: number,
  stateKeyframes?: import('./unified-types').CostumeStateKeyframe[],
): EffectiveCostumeState {
  let costumeSetId = character.activeCostumeSetId;
  const slotVariants: Record<string, string> = { ...(character.slotVariants ?? {}) };
  if (stateKeyframes && stateKeyframes.length > 0) {
    const sorted = [...stateKeyframes].sort((a, b) => a.frame - b.frame);
    for (const k of sorted) {
      if (k.frame > frame) break;
      if (k.costumeSetId) costumeSetId = k.costumeSetId;
      if (k.slotChanges) {
        for (const [slot, v] of Object.entries(k.slotChanges)) {
          if (v === null) delete slotVariants[slot];
          else slotVariants[slot] = v;
        }
      }
    }
  }
  return { costumeSetId, slotVariants };
}

/**
 * 生效服装状态 = 三层增量叠加：
 *  1) 角色静态字段（activeCostumeSetId / slotVariants，换装面板所设）
 *  2) clip 状态轨道（stateKeyframes：frame ≤ 当前帧的键按帧序应用；
 *     costumeSetId 整覆，slotChanges 逐槽覆、null 删该槽指派）
 *  3) 角色状态蓝图（stateBlueprint 的 costume_state 指令组装结果，同增量语义）
 * 蓝图求值 ctx 的 vars 沿用全仓现状（各蓝图求值路径均传空 vars，var 节点用自身默认值）。
 * 蓝图求值失败时静默回落轨道层结果，不中断渲染。
 */
export function resolveEffectiveCostumeState(
  character: Character,
  frame: number,
  frameRate: number,
  stateKeyframes?: import('./unified-types').CostumeStateKeyframe[],
  vars?: Record<string, number | string | boolean>,
): EffectiveCostumeState {
  const { costumeSetId: trackSetId, slotVariants } = resolveTrackCostumeState(character, frame, stateKeyframes);
  let costumeSetId = trackSetId;
  if (character.stateBlueprint) {
    try {
      const out = evaluateCostumeState(character.stateBlueprint, { frame, frameRate, vars: vars ?? {} } as any);
      if (out) {
        if (out.setId) costumeSetId = out.setId;
        for (const [slot, v] of Object.entries(out.slotChanges)) {
          if (v === null) delete slotVariants[slot];
          else slotVariants[slot] = v;
        }
      }
    } catch { /* 状态蓝图失败：保持轨道层结果 */ }
  }
  return { costumeSetId, slotVariants };
}

/**
 * 从 clip 列表挑出对某角色生效的状态轨道：仅激活 clip 且其 puppetCharacterId
 * 等于该角色时返回其 stateKeyframes（与 Timeline 的 clip→角色归属口径一致）；
 * 其余情况返回 undefined（该角色本帧只受静态字段+状态蓝图影响）。
 */
export function pickClipStateKeyframes(
  clips: Array<{ id: string; puppetCharacterId?: string; startFrame?: number; endFrame?: number; stateKeyframes?: import('./unified-types').CostumeStateKeyframe[] }> | undefined,
  activeClipId: string | null | undefined,
  characterId: string,
  frame: number,
): import('./unified-types').CostumeStateKeyframe[] | undefined {
  if (!clips || !activeClipId) return undefined;
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip || clip.puppetCharacterId !== characterId) return undefined;
  // 时间窗门控：当前帧不在片段窗内时，该片段什么都不贡献
  if (typeof clip.startFrame === 'number' && frame < clip.startFrame) return undefined;
  if (typeof clip.endFrame === 'number' && frame > clip.endFrame) return undefined;
  return clip.stateKeyframes;
}

/** 激活片段的刀光（与状态轨道同一门控口径：激活片段 + 归属角色 + 帧在窗内） */
export function pickSlashClip(
  clips: AnimationClip[] | undefined,
  activeClipId: string | null | undefined,
  characterId: string,
  frame: number,
): AnimationClip | undefined {
  if (!clips || !activeClipId) return undefined;
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip || clip.puppetCharacterId !== characterId || !clip.slashEffect) return undefined;
  if (frame < clip.startFrame || frame > clip.endFrame) return undefined;
  return clip;
}

/** 裁剪面 → 画布 px 多边形：平面定义在锚点精灵图空间（相对图
 * 中心、x 右 y 下，保留法线正侧 n·p >= offset）。经锚点指令的当
 * 帧位姿（位置/角度/镜像/缩放，与 renderNodeSprite 的变换链同
 * 式：镜像先翻进位图、再旋转）映射到画布，再与画布大矩形求交
 * （Sutherland–Hodgman 单边裁剪）。 */
function clipPolygonFor(
  cp: { angleDeg: number; offset: number },
  anchor: NodeRenderInstruction,
  canvasWidth: number,
  canvasHeight: number,
): [number, number][] | undefined {
  const spr = anchor.sprite;
  const plugX = spr.plug ? subToPx(spr.plug.x) : spr.width / 2;
  const plugY = spr.plug ? subToPx(spr.plug.y) : spr.height / 2;
  const rad = (cp.angleDeg * Math.PI) / 180;
  const nx = Math.cos(rad), ny = Math.sin(rad);
  const diag = Math.hypot(spr.width, spr.height) + Math.hypot(canvasWidth, canvasHeight);
  const lx = spr.width / 2 + nx * cp.offset, ly = spr.height / 2 + ny * cp.offset;
  const dx = -ny, dy = nx;
  const aRad = (anchor.angle * Math.PI) / 180;
  const cos = Math.cos(aRad), sin = Math.sin(aRad);
  const ax = subToPx(anchor.worldX), ay = subToPx(anchor.worldY);
  const sx = anchor.scaleX ?? 1, sy = anchor.stretch || 1;
  const toCanvas = (qx: number, qy: number): [number, number] => {
    let ox = (qx - plugX) * sx, oy = (qy - plugY) * sy;
    if (anchor.mirror) ox = -ox;
    return [ax + ox * cos - oy * sin, ay + ox * sin + oy * cos];
  };
  const p1 = toCanvas(lx - dx * diag, ly - dy * diag);
  const p2 = toCanvas(lx + dx * diag, ly + dy * diag);
  const keep = toCanvas(lx + nx * diag, ly + ny * diag);
  const side = (p: [number, number]) =>
    (p2[0] - p1[0]) * (p[1] - p1[1]) - (p2[1] - p1[1]) * (p[0] - p1[0]);
  const kSign = side(keep) >= 0 ? 1 : -1;
  let poly: [number, number][] = [
    [-canvasWidth, -canvasHeight], [canvasWidth * 2, -canvasHeight],
    [canvasWidth * 2, canvasHeight * 2], [-canvasWidth, canvasHeight * 2],
  ];
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!, prev = poly[(i + poly.length - 1) % poly.length]!;
    const sc = side(cur), sp = side(prev);
    const curIn = sc * kSign >= 0, prevIn = sp * kSign >= 0;
    if (curIn !== prevIn) {
      const t = sp / (sp - sc);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (curIn) out.push(cur);
  }
  poly = out;
  return poly.length >= 3 ? poly : undefined;
}

/**
 * 整个角色绕竖直轴连续偏航：把一组世界变换按 deltaRad（相对当前离散
 * 朝向的增量）刚性旋转——世界位置 (x, z) 与 frame 同步转，投影与执行端
 * 仍走离散朝向口径。worldAngle 随新 frame 重算。facingAngle 驱动：
 * 平面精灵没有连续朝向数据、仍按离散朝向选图；堆叠按 frame 逐层重合成，
 * 因此只有堆叠（及其关节位置）真正连续转起来。
 */
export function rotateWorldTransformsForYaw(
  transforms: Map<string, WorldTransform>,
  deltaRad: number,
  geometryDirection?: DirectionIndex,
): void {
  if (deltaRad === 0) return;
  const c = Math.cos(deltaRad), s = Math.sin(deltaRad);
  const rot = rotMatY((deltaRad * 180) / Math.PI);
  for (const [id, wt] of transforms) {
    const frame = mat3Mul(rot, wt.worldFrame);
    transforms.set(id, {
      ...wt,
      worldX: (wt.worldX * c + wt.worldZ * s) as SubPixel,
      worldZ: (-wt.worldX * s + wt.worldZ * c) as SubPixel,
      worldFrame: frame,
      worldAngle: geometryDirection !== undefined
        ? frameViewAngleForDirection(frame, geometryDirection, wt.variantIndex)
        : frameViewAngle(frame),
    });
  }
}

/** facingAngle（0=E, 45=NE, …, 270=S）相对离散朝向的偏航增量（弧度） */
export function facingYawDeltaRad(facingAngle: number, currentDirection: DirectionIndex): number {
  return (((facingAngle - 45 * currentDirection) % 360) * Math.PI) / 180;
}

export function generateRenderPlan(
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  rotationStrategy: RotationStrategy = 'pixel-perfect',
  frameRate: number = 12,
  animationVariables?: AnimationVariable[],
  backgroundColor?: string,
  previewQuality?: 'low' | 'medium' | 'high',
  effectTracks?: any[],
  motionBlurStrokes?: any[],
  effectStrokes?: any[],
  autoMotionBlur?: boolean,
  autoMotionBlurIntensity?: number,
  proceduralAnimations?: any[],
  // Global sprite table (s.sprites). Defaults to character.sprites for backward compat.
  globalSprites?: Record<string, Sprite>,
  // Phase 0 蓝图求值的覆盖（预览未保存的编辑图用；默认走渲染器内部求值）
  blueprintTransformsOverride?: Map<string, BlueprintTransformResult>,
  // 透视缩短开关（编辑器视图选项）：开启时精灵沿骨骼方向按投影长度比缩放
  perspectiveForeshorten?: boolean,
  // 当前 clip 的服装/变体状态轨道（仅激活 clip 且归属本角色时由调用方传入）
  stateKeyframes?: import('./unified-types').CostumeStateKeyframe[],
  // 节点转向（乙案）：几何基准朝向；undefined = 现行口径（几何基 = 节点 variantIndex）
  geometryDirection?: DirectionIndex,
  // 激活片段的刀光（pickSlashClip 门控后传入）：窗内按起始帧定格锚点位姿播放
  slashClip?: AnimationClip | null,
  // 人偶兜底（编辑器专用开关）：为无精灵节点生成胶囊人偶指令；
  // 转换/导出路径不传 → 恒为空，运行时包不受影响
  mannequinFallback?: boolean,
): RenderPlan {
  const spriteTable = globalSprites ?? character.sprites ?? {};
  // Build variable context for ParamDriver resolution
  // H6: 收集角色全部节点的 active param drivers，传入真实求值（之前恒为默认值）
  const allActiveDrivers: ParamDriver[] = [];
  if (animationVariables && animationVariables.length > 0) {
    for (const node of Object.values(character.nodes)) {
      for (const mod of node.modifiers ?? []) {
        for (const d of mod.paramDrivers ?? []) {
          if (d.enabled) allActiveDrivers.push(d);
        }
      }
    }
  }
  const variableContext = animationVariables && animationVariables.length > 0
    ? buildVariableContext(animationVariables, frame, allActiveDrivers, frameRate)
    : undefined;

  // 蓝图变量（变量名 → 本帧值，含 writer 驱动求值）：全部蓝图求值入口统一从此注入
  const blueprintVars: Record<string, number> = variableContext?.values ?? {};

  // Phase 0 (path B): Evaluate node blueprints for transform values (two-pass)
  const blueprintTransforms = blueprintTransformsOverride ?? evaluateBlueprintTransforms(character, frame, frameRate, blueprintVars);

  // 生效服装状态：静态字段 → clip 状态轨道 → 状态蓝图（三层增量叠加）
  const effCostume = resolveEffectiveCostumeState(character, frame, frameRate, stateKeyframes, blueprintVars);

  // Step 1: World transforms (includes blueprint-evaluated modifier contributions)
  // 行为层在 computeWorldTransforms 内统一叠加（出图/点选/覆盖层同源）
  const worldTransforms = computeWorldTransforms(
    character, frame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms,
    undefined, geometryDirection,
  );

  // Step 3: Get active costume set（用生效状态的集 id，含轨道/蓝图覆盖）
  const activeCostumeSet = effCostume.costumeSetId
    ? character.costumeSets.find(cs => cs.id === effCostume.costumeSetId)
    : undefined;

  // Step 4: Generate node render instructions
  const nodeInstructions: NodeRenderInstruction[] = [];
  const rootTransform = worldTransforms.get(character.rootNodeId);
  const currentDirection = rootTransform?.variantIndex ?? 0;
  // 连续偏航（facingAngle）：整个角色绕竖直轴转到连续朝向——位置与
  // frame 在此统一旋转，后续投影/选图/执行仍按离散 currentDirection 走。
  // geometryDirection（节点转向）模式下帧基锚不同，口径未定，不适用。
  const yawDeltaRad = geometryDirection === undefined && character.facingAngle !== undefined
    ? facingYawDeltaRad(character.facingAngle, currentDirection as DirectionIndex)
    : 0;
  if (yawDeltaRad !== 0) rotateWorldTransformsForYaw(worldTransforms, yawDeltaRad, geometryDirection);

  // 追随段取样（动态模式跨部件驱动）：源部件位姿取渲染同源的完整
  // 位姿（轨道+蓝图+行为/IK，2026-10-27 改口径），当前帧与滞后帧
  // 各一份。无追随实例时整块跳过。增量在画布空间算、画布空间用。
  const followSlotToNode = new Map<string, string>();
  for (const n of Object.values(character.nodes)) {
    followSlotToNode.set(n.slot?.slotKey ?? n.id, n.id);
  }
  const anyFollow = Object.values(character.nodes).some((n) => {
    const lists = [n.dynamicPatterns, ...(character.costumeSets ?? []).map(
      (cs) => cs.pieces[n.slot?.slotKey ?? n.id]?.dynamicPatterns)];
    return lists.some((l) => (l ?? []).some((i) => i.enabled && i.params.followEnabled && i.params.followSource));
  });
  const followMaps = new Map<number, Map<string, WorldTransform>>();
  const followPoseAt = (srcId: string, atFrame: number) => {
    let map = followMaps.get(atFrame);
    if (!map) {
      // 追随读蓝图（2026-10-27 用户拍板）：源部件位姿取渲染同源的
      // 完整位姿——轨道 + 蓝图变换（按取样帧求值）+ 行为/IK（在
      // computeWorldTransforms 内叠加），不再剥离成纯轨道位姿。
      // 图案形变/自旋是精灵局部效果、不进位姿求值，追随不递归。
      // 蓝图求值带模块级节点状态：取样前后快照/恢复，免得滞后帧
      // 求值污染主帧的状态节点（hold/step 一类）。
      const savedState = new Map(blueprintNodeState);
      try {
        const bpT = evaluateBlueprintTransforms(character, atFrame, frameRate, blueprintVars);
        map = computeWorldTransforms(
          character, atFrame, canvasWidth, canvasHeight, frameRate,
          variableContext, bpT, undefined, geometryDirection,
        );
      } finally {
        blueprintNodeState.clear();
        for (const [k, v] of savedState) blueprintNodeState.set(k, v);
      }
      followMaps.set(atFrame, map);
    }
    const w = map.get(srcId);
    if (!w) return undefined;
    const dir = (map.get(character.rootNodeId)?.variantIndex ?? currentDirection) as DirectionIndex;
    // 追随源位姿与主变换同一偏航口径（取样 FK 未经主旋转）
    let wx = w.worldX, wz = w.worldZ, wa = w.worldAngle;
    if (yawDeltaRad !== 0) {
      const c = Math.cos(yawDeltaRad), s = Math.sin(yawDeltaRad);
      wx = (w.worldX * c + w.worldZ * s) as SubPixel;
      wz = (-w.worldX * s + w.worldZ * c) as SubPixel;
      wa = frameViewAngle(mat3Mul(rotMatY((yawDeltaRad * 180) / Math.PI), w.worldFrame));
    }
    const p = projectToView(wx, w.worldY, wz, dir);
    return { a: (wa * Math.PI) / 180, x: subToPx(p.canvasX), y: subToPx(p.canvasY) };
  };

  // 方向间过渡（蒙皮转面 A）：facingAngle 为连续角度时，计算相邻两方向及混合系数
  // 单图模式（蒙皮转面 C）：不切换精灵，用 faceTurn 的 yaw 模拟转头
  const singleImageMode = character.faceTurnConfig?.singleImageMode === true;
  let dirBlend: { dirA: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; dirB: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; blend: number } | undefined;
  let singleImageYaw = 0;
  if (character.facingAngle !== undefined && character.faceTurnConfig?.enabled) {
    if (singleImageMode) {
      // 单图模式：facingAngle → yaw（-1~1），不切换精灵
      // 归一化到 [-180, 180)，yaw = angle / 180
      let a = ((character.facingAngle % 360) + 360) % 360;
      if (a > 180) a -= 360;
      singleImageYaw = Math.max(-1, Math.min(1, a / 180));
      // dirBlend 保持 undefined（单精灵）
    } else {
      // 懒加载避免循环依赖
      const { facingAngleToBlend } = require('./skin/face-turn') as typeof import('./skin/face-turn');
      dirBlend = facingAngleToBlend(character.facingAngle);
      // blend 为 0 或 1 时退化为单方向（避免双采样开销）
      if (dirBlend.blend < 1e-6 || dirBlend.blend > 1 - 1e-6) {
        dirBlend = undefined;
      }
    }
  }

  // 蒙皮快照认领（与关节盘抑制同一口径）：生效子节点的父精灵被合并图替代。
  // 合并精灵缺失/子节点不可见的认领不成立（否则父被跳过又无人接）。
  const activeSnapshots = computeActiveSnapshots(character, currentDirection as DirectionIndex);
  for (const [childId, entry] of [...activeSnapshots]) {
    const cn = character.nodes[childId];
    if (!cn || !cn.visible || !spriteTable[entry.snap.spriteId]) activeSnapshots.delete(childId);
  }
  const claimedParents = new Set<string>([...activeSnapshots.values()].map((a) => a.parentId));

  for (const [nodeId, worldTf] of worldTransforms) {
    const node = character.nodes[nodeId];
    if (!node || !node.visible) continue;
    if (claimedParents.has(nodeId)) continue; // 精灵已并入子节点的蒙皮快照

    // 蒙皮快照：以合并精灵代替本节点精灵（父精灵已在上行跳过），
    // 位置/枢轴沿用本节点口径，转角 = 父当前世界角 − 快照时父世界角，
    // 弯曲量 = 当前相对角 − 快照基础角（renderNodeSprite 里对合并像素弯曲）
    const snapEntry = activeSnapshots.get(nodeId);
    if (snapEntry) {
      const parentWorldTf = worldTransforms.get(snapEntry.parentId);
      const mergedSprite = spriteTable[snapEntry.snap.spriteId];
      if (parentWorldTf && mergedSprite) {
        const projSnap = projectToView(worldTf.worldX, worldTf.worldY, worldTf.worldZ, currentDirection);
        let deltaAngle = (worldTf.worldAngle - parentWorldTf.worldAngle) - snapEntry.snap.baseAngle;
        while (deltaAngle > 180) deltaAngle -= 360;
        while (deltaAngle < -180) deltaAngle += 360;
        nodeInstructions.push({
          nodeId,
          sprite: mergedSprite,
          worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2) + (projSnap.canvasX as SubPixel)) as SubPixel,
          worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2) + (projSnap.canvasY as SubPixel)) as SubPixel,
          angle: parentWorldTf.worldAngle - snapEntry.snap.parentBaseAngle,
          stretch: 1,
          variantIndex: worldTf.variantIndex,
          rotationStrategy,
          mirror: false,
          zIndex: projSnap.depth,
          authoredZ: node.zIndex ?? 0,
          drawLayer: node.drawLayer,
          modifiers: [],
          frame,
          frameRate,
          snapshotSkin: {
            jointX: mergedSprite.plug ? subToPx(mergedSprite.plug.x) : mergedSprite.width / 2,
            jointY: mergedSprite.plug ? subToPx(mergedSprite.plug.y) : mergedSprite.height / 2,
            axisX: snapEntry.snap.axisX,
            axisY: snapEntry.snap.axisY,
            deltaAngle,
            radius: snapEntry.snap.radius,
            curve: snapEntry.snap.curve,
          },
          blueprint: null,
        });
        continue;
      }
      // 合并精灵缺失 → 落回普通渲染
    }

    // Resolve sprite (with Character.sprites table for SpriteRef resolution)
    // 方向混合时：先按 dirA 解析主精灵
    const resolveDir = dirBlend ? dirBlend.dirA : currentDirection;
    let { sprite, mirror } = resolveSprite(node, resolveDir, activeCostumeSet, spriteTable, effCostume.slotVariants[node.slot?.slotKey ?? ''], character.latitude ?? 0, frame, frameRate);
    if (!sprite) {
      // 堆叠部件可以没有方向平面图（纯堆叠件）：以中间层图作替身
      // 精灵让指令成立（身份/点选/缩略口径），实际绘制由 stackRender
      // 接管；连层图都没有才跳过本节点。
      const stackOnlyPiece = activeCostumeSet?.pieces[node.slot?.slotKey ?? node.id];
      const midId = stackOnlyPiece?.stack?.layerSpriteIds[
        Math.floor(stackOnlyPiece.stack.layerSpriteIds.length / 2)
      ];
      const midSprite = midId ? spriteTable[midId] : undefined;
      if (!midSprite) continue;
      sprite = midSprite;
      // 镜像不因回落丢弃：本方向在 mirrorMap 里有条目即镜像朝向——
      // 平面图缺失不改变朝向，堆叠合成图在执行端按同一 mirror 标志
      // 整图翻转（水平翻转下摞内深度由 y/d 决定、与 h 无关，画序
      // 不变，整图翻转与逐层镜像等价）。
      mirror = stackOnlyPiece?.mirrorMap?.[resolveDir] !== undefined;
    }

    // 方向间过渡（蒙皮转面 A）：blend 不为 0/1 时，双精灵 faceTurn + alpha 混合
    // 只在需要时双采样，避免性能开销
    let blendedSprite: typeof sprite | null = null;
    if (dirBlend && sprite.data) {
      const { sprite: spriteB } = resolveSprite(node, dirBlend.dirB, activeCostumeSet, spriteTable, effCostume.slotVariants[node.slot?.slotKey ?? ''], character.latitude ?? 0, frame, frameRate);
      if (spriteB && spriteB.data) {
        try {
          const { applyFaceTurn, alphaBlendGrids } = require('./skin/face-turn') as typeof import('./skin/face-turn');
          // dirA 的 yaw：从 0（blend=0）到 -1（blend=1，转向 dirB）
          // dirB 的 yaw：从 1（blend=0）到 0（blend=1）
          // 即：每个精灵都向"中间"转，blend 处相遇
          const yawA = -dirBlend.blend;
          const yawB = 1 - dirBlend.blend;
          const gridA = applyFaceTurn(sprite.data, { yaw: yawA, pitch: 0, landmarks: sprite.landmarks });
          const gridB = applyFaceTurn(spriteB.data, { yaw: yawB, pitch: 0, landmarks: spriteB.landmarks });
          const blended = alphaBlendGrids(gridA, gridB, dirBlend.blend);
          blendedSprite = { ...sprite, data: blended };
        } catch {
          // 混合失败时回退到单精灵
          blendedSprite = null;
        }
      }
    }
    const effectiveSprite = blendedSprite ?? sprite;

    // Determine rotation strategy
    const strategy: RotationStrategy = rotationStrategy;

    // Apply procedural animations to node modifiers (migrated from old renderFrame)
    let nodeModifiers = node.modifiers;
    if (proceduralAnimations && proceduralAnimations.length > 0) {
      nodeModifiers = applyProceduralAnimations(
        node.modifiers as any ?? [],
        proceduralAnimations as any,
        '', frame, nodeId,
      ) as any;
    }

    // ---- Mesh skinning: 若父 socket.skinning === 'mesh'，计算蒙皮参数 ----
    // （替代关节盘：子精灵在 plug 附近做插值变形）
    let meshSkin: NodeRenderInstruction['meshSkin'];
    if (node.attachment?.type === 'socket' && node.attachment.parentSocketId) {
      const parentNode = node.parentId ? character.nodes[node.parentId] : undefined;
      const socket = parentNode?.sockets.find(s => s.id === node.attachment!.parentSocketId);
      if (socket?.skinning === 'mesh') {
        const parentWorldTf = parentNode ? worldTransforms.get(parentNode.id) : undefined;
        if (parentWorldTf) {
          // 关节相对角度 = 子世界角 - 父世界角
          let jointAngle = worldTf.worldAngle - parentWorldTf.worldAngle;
          // 归一化到 [-180, 180]
          while (jointAngle > 180) jointAngle -= 360;
          while (jointAngle < -180) jointAngle += 360;
          // plug 在精灵局部坐标（像素）：sprite.plug（SubPixel）+ attachment.plug 偏移
          // 默认值与 renderNodeSprite 的 pivot 计算一致（无 plug 时居中）
          const plugBaseX = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
          const plugBaseY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
          const plugOffX = node.attachment.plug ? subToPx(node.attachment.plug.x) : 0;
          const plugOffY = node.attachment.plug ? subToPx(node.attachment.plug.y) : 0;
          meshSkin = {
            plugX: plugBaseX + plugOffX,
            plugY: plugBaseY + plugOffY,
            jointAngle,
            radius: socket.skinRadius ?? 8,
            curve: socket.skinCurve ?? 'smoothstep',
          };
        }
      }
    }

    // 3D 投影：按当前朝向将 3D 世界坐标映射到 2D 画布（直接取项，非两步投影）
    // 投影后加画布中心（3D 世界以原点为中心，2D 画布以中心为原点）
    const proj = projectToView(worldTf.worldX, worldTf.worldY, worldTf.worldZ, currentDirection);
    // 透视缩短：节点 +Y 轴（骨骼主轴）单位方向投影到渲染朝向视平面后的长度比
    let foreshorten: number | undefined;
    if (perspectiveForeshorten) {
      const yw = frameYAxisWorld(worldTf.worldFrame, geometryDirection ?? worldTf.variantIndex);
      const tR = directionTrig(currentDirection);
      const hr = yw.x * tR.cos + yw.z * tR.sin;
      foreshorten = Math.min(1, Math.hypot(hr, yw.y));
    }
    // 动态模式（图案↔蓝图统一：从生效图解析，接线参数实时覆盖）：
    // 形变段乘进本指令的 stretch/scaleX——只动本节点精灵、不沿层
    // 级传播；粒子由执行端按 dynamicPatterns 绘制
    const patternGraph = effectivePatternGraph(character, node as never);
    const dynResolved = patternGraph
      ? resolvePatternsFromGraph(patternGraph, activeCostumeSet?.id, (srcId) => {
        try {
          return evaluateNodeOutput(patternGraph, srcId, {
            frame, frameRate, vars: blueprintVars,
            costumes: character.costumeSets, costumeSlot: node.slot?.slotKey,
          } as never) as Record<string, unknown> | null;
        } catch { return null; }
      })
      : [];
    let dynSx = 1, dynSy = 1;
    let folDx = 0, folDy = 0, folDa = 0, folDs = 1;
    let spinDeg = 0;
    if (dynResolved.length > 0) {
      const tSec = frame / frameRate;
      for (const r of dynResolved) {
        const d = dynamicDeformAt(r.instance.params, tSec);
        dynSx *= d.sx;
        dynSy *= d.sy;
        // 自转段（D3）：角度叠进本指令（多实例求和），只动本节点
        spinDeg += spinAngleDegAt(r.instance.params, tSec);
        // 追随段：源部件滞后位姿差（轨道位姿取样，见 followPoseAt）
        const fp = r.instance.params;
        if (anyFollow && fp.followEnabled && fp.followSource) {
          const srcId = followSlotToNode.get(fp.followSource);
          const now = srcId ? followPoseAt(srcId, frame) : undefined;
          const lag = srcId ? followPoseAt(srcId, frame - fp.followDelaySec * frameRate) : undefined;
          if (now && lag) {
            // 锚定版（甲）：连接点锚死——平移增量换算为绕插头的摆角
            // 与沿轴缩放。本节点主轴（画布系）u = (−sinθ, cosθ)，
            // 臂长 = 精灵高 − 有效插头 Y（精灵 plug + attachment 偏移，
            // 与蒙皮同一口径）；无精灵时臂长 0、只剩角度滞后。
            const th = (worldTf.worldAngle * Math.PI) / 180;
            let reach = 0;
            if (effectiveSprite) {
              const plugEffY = (effectiveSprite.plug ? subToPx(effectiveSprite.plug.y) : effectiveSprite.height / 2)
                + (node.attachment?.plug ? subToPx(node.attachment.plug.y) : 0);
              reach = Math.max(0, effectiveSprite.height - plugEffY);
            }
            const fd = followAnchoredDeltaAt(now, lag, fp.followAmount, fp.followRotate, -Math.sin(th), Math.cos(th), reach);
            folDa += fd.da; folDs *= fd.ds;
          }
        }
      }
    }
    // 弧线双锚点（D4 二期）：目标部件当前帧轨道位姿 → 本节点
    // 本地系终点（与追随/残影同一 followPoseAt 口径：剥离蓝图、
    // 视图投影后的画布 px 差逆旋回本地；投影压扁不补偿，同近似）
    let arcEnds: NodeRenderInstruction['arcEnds'];
    if (dynResolved.length > 0 && dynResolved.some((r) => r.instance.params.arcEnabled && r.instance.params.arcTarget)) {
      const selfPose = followPoseAt(nodeId, frame);
      if (selfPose) {
        const ends: NonNullable<NodeRenderInstruction['arcEnds']> = {};
        dynResolved.forEach((r, ri) => {
          const p = r.instance.params;
          if (!p.arcEnabled || !p.arcTarget) return;
          const srcId = followSlotToNode.get(p.arcTarget);
          const tp = srcId ? followPoseAt(srcId, frame) : undefined;
          if (!tp) return;
          const dx = tp.x - selfPose.x, dy = tp.y - selfPose.y;
          const ca = Math.cos(selfPose.a), sa = Math.sin(selfPose.a);
          ends[ri] = { x: dx * ca + dy * sa, y: -dx * sa + dy * ca };
        });
        if (Object.keys(ends).length > 0) arcEnds = ends;
      }
    }
    // 弧线原点标记（sprite-marks）：点标记相对插头的本地偏移
    // （镜像时标记与插头同翻，偏移 x 取反）
    let arcOrigins: NodeRenderInstruction['arcOrigins'];
    if (dynResolved.length > 0 && effectiveSprite?.marks?.length) {
      const origins: NonNullable<NodeRenderInstruction['arcOrigins']> = {};
      dynResolved.forEach((r, ri) => {
        const p = r.instance.params;
        if (!p.arcEnabled || !p.arcOriginMark) return;
        const mp = markPointPx(effectiveSprite, p.arcOriginMark);
        if (!mp) return;
        const plugPx = effectiveSprite.plug ? subToPx(effectiveSprite.plug.x) : effectiveSprite.width / 2;
        const plugPy = effectiveSprite.plug ? subToPx(effectiveSprite.plug.y) : effectiveSprite.height / 2;
        let ox = mp.x - plugPx;
        if (mirror || worldTf.mirror) ox = -ox;
        origins[ri] = { x: ox, y: mp.y - plugPy };
      });
      if (Object.keys(origins).length > 0) arcOrigins = origins;
    }
    // 残影段（D5）：过去帧的世界位姿差（与追随段同一 followPoseAt
    // machinery——剥离蓝图的轨道位姿、当前帧同口径相减，增量由此
    // 只含轨道运动；蓝图驱动的运动不入残影，与追随段同一近似）
    let trailGhosts: NodeRenderInstruction['trailGhosts'];
    if (dynResolved.length > 0) {
      const tp = dynResolved.map((r) => r.instance.params).find((p) => p.trailEnabled);
      if (tp) {
        const nowP = followPoseAt(nodeId, frame);
        if (nowP) {
          const count = Math.max(1, Math.min(6, Math.round(tp.trailCount || 3)));
          const list: NonNullable<NodeRenderInstruction['trailGhosts']> = [];
          for (let k = count; k >= 1; k--) {
            const past = followPoseAt(nodeId, frame - k * (tp.trailIntervalSec || 0.06) * frameRate);
            if (!past) continue;
            list.push({
              dx: past.x - nowP.x,
              dy: past.y - nowP.y,
              daDeg: ((past.a - nowP.a) * 180) / Math.PI,
              alpha: (tp.trailOpacity || 0.35) * (1 - (k - 1) / count),
            });
          }
          if (list.length) trailGhosts = list;
        }
      }
    }
    // 精灵堆叠：生效服装件带 stack 时，计划期按当帧朝向算逐层算子
    // 随指令下发（执行端栅格化；精灵方向图仅回落）。合成在去视平面
    // 角的帧里做——worldAngle 由执行端 rotate 施加。
    let stackRender: NodeRenderInstruction['stackRender'];
    const stackPiece = activeCostumeSet?.pieces[node.slot?.slotKey ?? node.id];
    if (stackPiece?.stack) {
      const layerSprites = stackPiece.stack.layerSpriteIds.map((id) => spriteTable[id]);
      if (layerSprites.some(Boolean)) {
        const res = computeStackOps(stackPiece.stack, layerSprites, worldTf.worldFrame, worldTf.worldAngle);
        if (res.ops.length > 0) {
          stackRender = { ops: res.ops, width: res.width, height: res.height, pivotX: res.pivotX, pivotY: res.pivotY, key: res.key, layerSpriteIds: stackPiece.stack.layerSpriteIds, marks: stackPiece.stack.marks };
        }
      }
    }

    nodeInstructions.push({
      nodeId,
      sprite: effectiveSprite,
      stackRender,
      worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2) + (proj.canvasX as SubPixel) + pxToSub(folDx)) as SubPixel,
      worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2) + (proj.canvasY as SubPixel) + pxToSub(folDy)) as SubPixel,
      angle: worldTf.worldAngle + (folDa * 180) / Math.PI + spinDeg,
      stretch: dynResolved.length > 0 ? worldTf.worldStretch * dynSy * folDs : worldTf.worldStretch,
      foreshorten: stackRender ? undefined : foreshorten,
      variantIndex: worldTf.variantIndex,
      rotationStrategy: strategy,
      mirror: mirror || worldTf.mirror,
      // 排序键：投影深度为主（depth 越大越靠前、后绘制），作者 zIndex
      // 为次（见 Step 6）——纯 2D 时深度恒同值，画序由 zIndex 决定
      zIndex: proj.depth,
      authoredZ: node.zIndex ?? 0,
      drawLayer: node.drawLayer,
      generated: undefined, // Discs are handled separately
      modifiers: nodeModifiers,
      frame,
      frameRate,
      meshSkin,
      // Face turn（Spine 式伪 3D 转头）：先转面整体，后关节蒙皮局部
      // TODO: 从 keyframe 插值获取（puppet-keyframe-interpolation.ts 已有 getInterpolatedKeyframeFaceTurn，
      // 需 computeWorldTransforms 接入 nodeKeyframes）；当前用 node 静态值
      // 单图模式（C）：singleImageYaw（来自 facingAngle）+ node.faceTurn（微动）叠加
      faceTurn: (() => {
        const base = node.faceTurn ?? { yaw: 0, pitch: 0 };
        if (singleImageMode && Math.abs(singleImageYaw) > 1e-6) {
          return {
            yaw: Math.max(-1, Math.min(1, singleImageYaw + base.yaw)),
            pitch: base.pitch,
          };
        }
        return node.faceTurn;
      })(),
      // t.scaleX 修复：蓝图 scaleX 独立 plumbing，不再平均吃掉
      scaleX: dynResolved.length > 0 ? (worldTf.scaleX ?? 1) * dynSx : worldTf.scaleX,
      dynScale: dynResolved.length > 0 ? [dynSx, dynSy] as [number, number] : undefined,
      dynamicPatterns: dynResolved.length > 0 ? dynResolved : undefined,
      trailGhosts,
      arcEnds,
      arcOrigins,
      // 蓝图 skew：有倾斜量时才填，避免空数组污染
      skews: (worldTf.skewX || worldTf.skewY) ? [{ skewX: worldTf.skewX ?? 0, skewY: worldTf.skewY ?? 0 }] : undefined,
      // STEP2 合并：plumbing 蓝图给 renderNodeSprite，替代手拼像素链
      blueprint: (node as any).blueprint ?? (node.modifiers?.length ? modifiersToBlueprint(node.modifiers as any) : null),
      // costume 节点求值用：服装集 + 槽位 + 精灵表（SpriteRef 解析）
      costumes: character.costumeSets,
      costumeSlot: node.slot?.slotKey,
      sprites: spriteTable,
    });
  }

  // 裁剪面第二遍：指令齐备后，按锚点指令的当帧位姿把平面映射到
  // 画布并求多边形（锚点当帧无指令 = 无精灵可锚 → 不裁）
  {
    const byId = new Map(nodeInstructions.map((i) => [i.nodeId, i]));
    for (const ins of nodeInstructions) {
      const cp = character.nodes[ins.nodeId]?.clipPlane;
      if (!cp) continue;
      const anchorIns = byId.get(cp.anchor);
      if (!anchorIns) continue;
      ins.clipPath = clipPolygonFor(cp, anchorIns, canvasWidth, canvasHeight);
    }
  }

  // 刀光：位姿在片段起始帧定格（锚点其后怎么动都不跟随），进度
  // 按窗内帧走；时长单独设了秒数时先于窗结束
  let slashFx: RenderPlan['slashFx'];
  if (slashClip?.slashEffect && frame >= slashClip.startFrame && frame <= slashClip.endFrame) {
    const spec = slashClip.slashEffect;
    const spawnTransforms = computeWorldTransforms(
      character, slashClip.startFrame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms,
      undefined, geometryDirection,
    );
    const anchorWt = spawnTransforms.get(spec.anchorNodeId);
    if (anchorWt) {
      const spawnDir = spawnTransforms.get(character.rootNodeId)?.variantIndex ?? currentDirection;
      const proj = projectToView(anchorWt.worldX, anchorWt.worldY, anchorWt.worldZ, spawnDir as DirectionIndex);
      const winLen = Math.max(1, slashClip.endFrame - slashClip.startFrame + 1);
      const durFrames = spec.durationSec && spec.durationSec > 0
        ? Math.max(1, spec.durationSec * frameRate)
        : winLen;
      const p = (frame - slashClip.startFrame) / durFrames;
      if (p < 1) {
        const n = Math.max(2, Math.round(spec.frameCount || 6));
        slashFx = {
          spec,
          frameIdx: Math.min(n - 1, Math.floor(p * n)),
          worldX: canvasWidth / 2 + subToPx(proj.canvasX),
          worldY: canvasHeight / 2 + subToPx(proj.canvasY),
          angleDeg: anchorWt.worldAngle,
          mirror: anchorWt.mirror,
        };
      }
    }
  }

  // Step 5: Generate disc instructions
  const discInstructions = generateDiscInstructions(character, worldTransforms, canvasWidth, canvasHeight, currentDirection, activeSnapshots, activeCostumeSet, spriteTable, geometryDirection);

  // Step 5.5: 人偶兜底（编辑器开关开启时）：无精灵节点生成胶囊段
  const mannequinInstructions = mannequinFallback
    ? generateMannequinInstructions(
        character, worldTransforms, canvasWidth, canvasHeight, currentDirection,
        new Set(nodeInstructions.map((i) => i.nodeId)), claimedParents,
      )
    : [];

  // Step 6: 节点指令复合排序——主键投影深度（3D 遮挡），次键作者
  // zIndex（node.zIndex），再同则稳定排序保持生成序（层级遍历序）。
  // 纯 2D 时 socket 2D 偏移沿视平面右向量映射、与深度轴正交，各节点
  // 深度恒同值（只剩三角函数浮点尘埃），画序实际由作者 zIndex 决定
  // （RigPanel 可编辑、烘焙按骨骼层级写入、运行时包同口径），不退化为
  // 遍历事故。故深度比较先取整到 SubPixel 整数分桶：尘埃落回同桶、
  // 交给 zIndex，真深度差（≥1/16px）不受影响。关节盘不进排序流，
  // 由执行端从 discInstructions 单独先行绘制（无视深度、始终被遮挡）。
  const allInstructions: NodeRenderInstruction[] = [...nodeInstructions];
  allInstructions.sort((a, b) => (Math.round(a.zIndex) - Math.round(b.zIndex)) || ((a.authoredZ ?? 0) - (b.authoredZ ?? 0)));

  return {
    nodeInstructions,
    discInstructions,
    sortedInstructions: allInstructions,
    mannequinInstructions,
    backgroundColor,
    previewQuality,
    effectTracks,
    motionBlurStrokes,
    effectStrokes,
    autoMotionBlur,
    autoMotionBlurIntensity,
    frame,
    frameRate,
    characterBlueprint: character.blueprint ?? null,
    blueprintVars,
    slashFx,
  };
}

// ---- Render Execution ----

/**
 * Execute a render plan: draw all sprites and discs to the canvas.
 * This is the final step of the unified render pipeline.
 */
export function executeRenderPlan(
  ctx: CanvasRenderingContext2D,
  plan: RenderPlan,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // NOTE: 不再在此清画布。调用方负责 clear/fill 背景（renderUnifiedFrame 自己清；
  // unified-pipeline-bridge 的两处调用都是在 renderFrame 已画好非木偶部件之后叠加木偶，
  // 若在此 clear 会擦掉同一画布上已有的全部内容——见 F1）。

  // Character blueprint path: composite to offscreen → post-process → draw.
  // Falls through to legacy path when blueprint is missing or evaluation fails.
  const drawOne = (c: CanvasRenderingContext2D, instruction: NodeRenderInstruction) => {
    if (instruction.clipPath && instruction.clipPath.length >= 3) {
      c.save();
      c.beginPath();
      instruction.clipPath.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
      c.closePath();
      c.clip();
      renderNodeSprite(c, instruction, canvasWidth, canvasHeight, plan.blueprintVars);
      c.restore();
    } else {
      renderNodeSprite(c, instruction, canvasWidth, canvasHeight, plan.blueprintVars);
    }
  };
  const useCharBlueprint = !!plan.characterBlueprint;
  if (useCharBlueprint) {
    const ok = renderCharacterWithBlueprint(ctx, plan, canvasWidth, canvasHeight, drawOne);
    if (!ok) {
      // Fallback: legacy per-node draw (blueprint invalid — don't lose the frame)
      // 关节盘先行（不参与深度排序、始终被遮挡），节点随后按深度序绘制
      for (const disc of plan.discInstructions) renderDisc(ctx, disc);
      for (const mq of plan.mannequinInstructions ?? []) renderMannequin(ctx, mq);
      for (const instruction of plan.sortedInstructions) {
        drawOne(ctx, instruction);
      }
    }
  } else {
    for (const disc of plan.discInstructions) renderDisc(ctx, disc);
    for (const mq of plan.mannequinInstructions ?? []) renderMannequin(ctx, mq);
    for (const instruction of plan.sortedInstructions) {
      drawOne(ctx, instruction);
    }
  }

  // 刀光最后绘制（盖在角色之上）：帧图以对位点 (cx, cy) 钉在定格
  // 位姿处、按定格角度旋转（镜像帧已预翻，与精灵同口径）
  if (plan.slashFx) {
    const fx = plan.slashFx;
    const fc = slashFrameCanvas(fx.spec, fx.frameIdx, fx.mirror);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(fx.worldX, fx.worldY);
    ctx.rotate((fx.angleDeg * Math.PI) / 180);
    ctx.drawImage(fc, -fx.spec.cx, -fx.spec.cy);
    ctx.restore();
  }

  // Render effects (overlays, not tied to specific nodes)
  // These are canvas-level effects from the old renderFrame pipeline
  const currentFrame = plan.frame ?? 0;
  if (plan.effectTracks) {
    for (const effectTrack of plan.effectTracks) {
      if (!effectTrack.visible) continue;
      const kf = effectTrack.keyframes
        ?.filter((k: any) => k.frame <= currentFrame)
        ?.sort((a: any, b: any) => b.frame - a.frame)[0];
      if (!kf) continue;
      renderEffectTrackFrame(ctx, effectTrack, kf, currentFrame, canvasWidth, canvasHeight);
    }
  }

  // Render motion blur strokes for this frame
  if (plan.motionBlurStrokes) {
    for (const stroke of plan.motionBlurStrokes) {
      if ((stroke as any).frame <= currentFrame) {
        renderMotionBlurStroke(ctx, stroke as any);
      }
    }
  }

  // Render effect strokes for this frame
  if (plan.effectStrokes) {
    for (const stroke of plan.effectStrokes) {
      if ((stroke as any).frame <= currentFrame) {
        renderEffectStroke(ctx, stroke as any);
      }
    }
  }
}

/**
 * Pixel-level modifier types that modify the pixel grid before drawing.
 * These are applied in the sprite → canvas conversion step.
 */
const PIXEL_MOD_TYPES: ModifierType[] = [
  'color_replace', 'outline', 'cleanup', 'dither', 'pixel_displace',
  'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
];

/** 团块/火焰场画布（乙8）：热度场 → RGBA 画布，颜色过图案级
 * 后期主题；按键（实例 + 段参数签名 + 时间量化步）缓存 */
const dynFieldCanvasCache = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number } | null>();
function dynFieldCanvas(
  kind: 'blob' | 'flame',
  params: import('./dynamic-patterns').DynamicPatternParams,
  tSec: number,
  idKey: string,
  dsx = 1,
  dsy = 1,
): { canvas: HTMLCanvasElement; ox: number; oy: number } | null {
  const seg = kind === 'blob'
    ? [params.blobRadius, params.blobCount, params.blobSeed, params.blobHz, params.blobBurn, params.blobAlpha, params.blobColorEdge, params.blobColorMid, params.blobColorCore]
    : [params.flameWidth, params.flameHeight, params.flameHz, params.flameTurbulence, params.flameAlpha, params.flameColorEdge, params.flameColorMid, params.flameColorCore];
  const key = `${idKey}|${kind}|${Math.round(tSec * 24)}|${seg.join(',')}|${params.postEnabled ? params.postTheme : ''}|${Math.round(dsx * 24)},${Math.round(dsy * 24)}`;
  const hit = dynFieldCanvasCache.get(key);
  if (hit !== undefined) return hit;
  const field = kind === 'blob' ? blobFieldAt(params, tSec, dsx, dsy) : flameFieldAt(params, tSec, dsx, dsy);
  let result: { canvas: HTMLCanvasElement; ox: number; oy: number } | null = null;
  if (field) {
    const canvas = document.createElement('canvas');
    canvas.width = field.w;
    canvas.height = field.h;
    const c2d = canvas.getContext('2d')!;
    const img = c2d.createImageData(field.w, field.h);
    const edge = kind === 'blob' ? params.blobColorEdge : params.flameColorEdge;
    const mid = kind === 'blob' ? params.blobColorMid : params.flameColorMid;
    const core = kind === 'blob' ? params.blobColorCore : params.flameColorCore;
    const segAlpha = kind === 'blob' ? params.blobAlpha : params.flameAlpha;
    for (let i = 0; i < field.heat.length; i++) {
      const hv = field.heat[i];
      if (hv <= 0.003) continue;
      let [r, g, b] = fieldColorAt(edge, mid, core, hv);
      if (params.postEnabled && params.postTheme !== 'none') {
        const hex = `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
        const mapped = /^#([0-9a-fA-F]{6})$/.exec(postColorAt(params, hex));
        if (mapped) {
          r = parseInt(mapped[1].slice(0, 2), 16); g = parseInt(mapped[1].slice(2, 4), 16); b = parseInt(mapped[1].slice(4, 6), 16);
        }
      }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(255 * Math.min(1, hv) * segAlpha);
    }
    c2d.putImageData(img, 0, 0);
    result = { canvas, ox: field.ox, oy: field.oy };
  }
  if (dynFieldCanvasCache.size > 96) dynFieldCanvasCache.clear();
  dynFieldCanvasCache.set(key, result);
  return result;
}

/** 动态模式粒子绘制（本地坐标：原点 = 枢轴，与精灵同一变换空间） */
function drawDynamicParticles(
  ctx: CanvasRenderingContext2D,
  instruction: NodeRenderInstruction,
  layer: 'back' | 'front',
): void {
  const list = instruction.dynamicPatterns;
  if (!list || list.length === 0) return;
  for (const resolved of list) {
    const particles = simulateDynamicParticles(
      resolved, instruction.sprite, instruction.frame, instruction.frameRate,
      instruction.mirror, layer, instruction.nodeId,
    );
    for (const p of particles) {
      if (p.size <= 0 || p.alpha <= 0) continue;
      const r = Math.max(0.5, p.size / 2);
      const m = /^#([0-9a-fA-F]{6})$/.exec(p.color);
      const rgb = m
        ? `${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)}`
        : '255,180,107';
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(${rgb},${Math.min(1, p.alpha)})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      // 粒子形状（Jeff 落地）：dot = 径向渐隐圆（原行为）；其余以
      // 同一渐变填充形状轮廓（柔边由渐变承担，与运行时四边形同族）
      if (p.shape === 'diamond') {
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
      } else if (p.shape === 'star') {
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 - Math.PI / 2;
          const rad = i % 2 === 0 ? r : r * 0.38;
          const vx = p.x + Math.cos(a) * rad, vy = p.y + Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
      } else if (p.shape === 'line') {
        const dx = p.dirX, dy = p.dirY;
        const pxv = -dy, pyv = dx;
        ctx.moveTo(p.x + dx * r * 1.7, p.y + dy * r * 1.7);
        ctx.lineTo(p.x - dx * r * 0.1 + pxv * r * 0.45, p.y - dy * r * 0.1 + pyv * r * 0.45);
        ctx.lineTo(p.x - dx * r * 1.1, p.y - dy * r * 1.1);
        ctx.lineTo(p.x - dx * r * 0.1 - pxv * r * 0.45, p.y - dy * r * 0.1 - pyv * r * 0.45);
        ctx.closePath();
      } else {
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // 团块/火焰场（乙8）：身前层、粒子之下先画场画布（带缓存）
    if (layer === 'front') {
      const tSecF = instruction.frame / instruction.frameRate;
      for (const resolved of list) {
        const dsF = instruction.dynScale ?? [1, 1];
        for (const kind of ['blob', 'flame'] as const) {
          const fc = dynFieldCanvas(kind, resolved.instance.params, tSecF, `${instruction.nodeId}|${resolved.instance.id}`, dsF[0], dsF[1]);
          if (!fc) continue;
          ctx.save();
          if (instruction.mirror) ctx.scale(-1, 1);
          // 域缩放口径：画布内域已按形变放大（范围跟），绘制抵消
          // ctx 的形变缩放那份，形态（瓣/火舌）保持自然像素不拉伸
          ctx.scale(1 / Math.max(0.05, dsF[0]), 1 / Math.max(0.05, dsF[1]));
          ctx.drawImage(fc.canvas, -fc.ox, -fc.oy);
          ctx.restore();
        }
      }
    }
    // 环境场样本（乙9）：区域样本（落/游/涟漪），身前层绘制
    if (layer === 'front') {
      const tSecE = instruction.frame / instruction.frameRate;
      for (const resolved of list) {
        const params = resolved.instance.params;
        if (!params.envEnabled) continue;
        const env = envSamplesAt(params, tSecE);
        const m = /^#([0-9a-fA-F]{6})$/.exec(postColorAt(params, params.envColor));
        const rgb = m
          ? `${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4), 16)}`
          : '188,216,255';
        const flipX = (x: number) => (instruction.mirror ? -x : x);
        for (const q of env.quads) {
          const gx = flipX(q.x);
          ctx.fillStyle = `rgba(${rgb},${Math.max(0, Math.min(1, q.alpha)).toFixed(3)})`;
          if (q.line) {
            const len = Math.max(2, q.size * 1.6);
            const dx = instruction.mirror ? -q.dirX : q.dirX;
            ctx.beginPath();
            ctx.moveTo(gx - dx * len / 2, q.y - q.dirY * len / 2);
            ctx.lineTo(gx + dx * len / 2, q.y + q.dirY * len / 2);
            ctx.lineWidth = Math.max(1, q.size / 2.2);
            ctx.strokeStyle = ctx.fillStyle;
            ctx.stroke();
          } else {
            const r = Math.max(0.5, q.size / 2);
            const grad = ctx.createRadialGradient(gx, q.y, 0, gx, q.y, r * 1.6);
            grad.addColorStop(0, `rgba(${rgb},${Math.max(0, Math.min(1, q.alpha)).toFixed(3)})`);
            grad.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(gx, q.y, r * 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.lineWidth = 1;
        for (const rg of env.rings) {
          if (rg.alpha <= 0.004) continue;
          ctx.strokeStyle = `rgba(${rgb},${Math.max(0, Math.min(1, rg.alpha)).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(flipX(rg.x), rg.y, rg.r, rg.r * 0.38, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    // 环绕光点（Jeff 落地）：只在身前层画一次（绕部件的轨道光点）
    if (layer === 'front') {
      const tSec = instruction.frame / instruction.frameRate;
      for (const resolved of list) {
        const params = resolved.instance.params;
        if (!params.orbitEnabled) continue;
        const pts = orbitPointsAt(params, tSec, instruction.angle);
        const m = /^#([0-9a-fA-F]{6})$/.exec(postColorAt(params, params.orbitColor));
        const rgb = m
          ? `${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)}`
          : '174,230,255';
        const r = Math.max(0.5, params.orbitSize / 2);
        for (const q of pts) {
          const gx = instruction.mirror ? -q.x : q.x;
          const grad = ctx.createRadialGradient(gx, q.y, 0, gx, q.y, r);
          grad.addColorStop(0, `rgba(${rgb},0.95)`);
          grad.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(gx, q.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

/** 动态模式弧线段（D4 一期）：本地坐标（原点 = 枢轴，与粒子同一
 * 变换空间）。先宽线低透明作晕，再细线本体，逐段线宽随点位收细。 */
function drawDynamicArcs(
  ctx: CanvasRenderingContext2D,
  instruction: NodeRenderInstruction,
): void {
  const list = instruction.dynamicPatterns;
  if (!list || list.length === 0) return;
  const tSec = (instruction.frame ?? 0) / (instruction.frameRate || 12);
  list.forEach((resolved, ri) => {
    const p = resolved.instance.params;
    if (!p.arcEnabled) return;
    const shape = arcPointsAt(p, tSec, instruction.arcEnds?.[ri]);
    // 原点标记偏移（计划期算好）：整形平移到标记点
    const org = instruction.arcOrigins?.[ri];
    if (org) {
      const sh = (pts: { x: number; y: number; w: number }[]) =>
        pts.map((pt) => ({ ...pt, x: pt.x + org.x, y: pt.y + org.y }));
      shape.main = sh(shape.main);
      shape.branches = shape.branches.map(sh);
      shape.dots = sh(shape.dots);
    }
    const rgb = hexToRgb(postColorAt(p, p.arcColor || '#bfe3ff')) ?? { r: 191, g: 227, b: 255 };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokeLine = (pts: { x: number; y: number; w: number }[], widthMul: number, alphaMul: number) => {
      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${(shape.alpha * alphaMul).toFixed(3)})`;
      for (let i = 0; i + 1 < pts.length; i++) {
        ctx.lineWidth = Math.max(0.4, pts[i].w * widthMul);
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
        ctx.stroke();
      }
    };
    for (const line of [shape.main, ...shape.branches]) {
      strokeLine(line, 2.6, 0.22);
      strokeLine(line, 1, 1);
    }
    // 光点（藤蔓叶 / 星座星）：实心圆，半径 = 点宽
    for (const d of shape.dots) {
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${shape.alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, Math.max(0.5, d.w), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

/** 发光叠加层缓存：键 = 像素内容哈希 + 发光参数签名 + 脉冲量化步 + 镜像位 */
const glowOverlayCache = new Map<string, { canvas: HTMLCanvasElement; padX: number; padY: number } | null>();

/**
 * 动态模式发光段：为一个发光组构建发光叠加层（未镜像空间，pad = 柔光圈外扩）。
 * 颜色/强度/呼吸脉冲以组参数（visualParams）为准；权重场 = 本组全部选区
 * 来源（contributors）的场逐像素取大合并。选区内：原色提亮并染向辉光色；
 * 柔光圈：辉光色淡出。返回 null = 本帧无可见发光（脉冲近 0 / 选区全空）。
 */
function buildGlowOverlay(
  pixels: PixelGrid,
  visualParams: DynamicPatternParams,
  contributors: DynamicPatternParams[],
  tSec: number,
  contentHash: string,
  mirror: boolean,
  frameAngleDeg = 0,
  marks?: import('./unified-types').SpriteMark[],
): { canvas: HTMLCanvasElement; padX: number; padY: number; key: string } | null {
  if (!visualParams.glowEnabled) return null;
  const pulse = glowPulseAt(visualParams, tSec);
  if (pulse <= 0.01 || visualParams.glowStrength <= 0) return null;
  const params = visualParams;
  const hasWorld = contributors.some((c) => c.glowAngleSpace === 'world');
  const sig = [
    params.glowColor, params.glowStrength, params.postEnabled ? params.postTheme : '',
    ...contributors.flatMap((c) => [
      c.glowHalo, c.glowMaskSource, c.glowMarkName ?? '', c.glowPick, c.glowTolerance,
      c.glowMask?.w ?? 0, c.glowMask?.h ?? 0, c.glowMask?.bits ?? '',
      c.glowShape ?? 'square', c.glowShapeKernel?.w ?? 0, c.glowShapeKernel?.h ?? 0, c.glowShapeKernel?.bits ?? '',
      c.glowStarReach ?? 1.2, c.glowFlameReach ?? 1.8, c.glowAngleDeg ?? 270, c.glowAngleSpace ?? 'sprite',
    ]),
    hasWorld ? `W${Math.round(frameAngleDeg / 3)}` : '',
    // 选区来源为精灵标记时，标记几何本身进签名（改标记不改像素也要失效缓存）
    contributors.some((c) => c.glowMaskSource === 'mark') ? JSON.stringify(marks ?? null) : '',
  ].join('|');
  const key = `${contentHash}|${sig}|${Math.round(pulse * 24)}|${mirror ? 'M' : ''}`;
  const hit = glowOverlayCache.get(key);
  if (hit !== undefined) return hit ? { ...hit, key } : null;
  let result: { canvas: HTMLCanvasElement; padX: number; padY: number } | null = null;
  let merged: { w: number; h: number; field: Float32Array; padX: number; padY: number } | null = null;
  for (const c of contributors) {
    const f = glowField(c, pixels, frameAngleDeg, marks);
    if (!f) continue;
    if (!merged) {
      merged = { w: f.w, h: f.h, field: new Float32Array(f.field), padX: f.padX, padY: f.padY };
    } else {
      let m = merged;
      const padX = Math.max(m.padX, f.padX);
      const padY = Math.max(m.padY, f.padY);
      if (padX !== m.padX || padY !== m.padY) {
        const nm = {
          w: m.w + (padX - m.padX) * 2, h: m.h + (padY - m.padY) * 2,
          field: new Float32Array((m.w + (padX - m.padX) * 2) * (m.h + (padY - m.padY) * 2)),
          padX, padY,
        };
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            nm.field[(y + padY - m.padY) * nm.w + (x + padX - m.padX)] = m.field[y * m.w + x];
          }
        }
        m = nm;
        merged = nm;
      }
      const ox = m.padX - f.padX, oy = m.padY - f.padY;
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const v = f.field[y * f.w + x];
          const ni = (y + oy) * m.w + (x + ox);
          if (v > m.field[ni]) m.field[ni] = v;
        }
      }
    }
  }
  const gf = merged;
  if (gf) {
    const pad = contributors.reduce(
      (m, c) => Math.max(m, Math.max(0, Math.min(8, Math.round(c.glowHalo || 0)))), 0);
    const W = gf.w + pad * 2;
    const H = gf.h + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c2d = canvas.getContext('2d')!;
    const img = c2d.createImageData(W, H);
    const glowRgbObj = hexToRgb(postColorAt(params, params.glowColor));
    const glowRgb: [number, number, number] = glowRgbObj
      ? [glowRgbObj.r, glowRgbObj.g, glowRgbObj.b]
      : [125, 215, 255];
    const k = Math.min(1, pulse * params.glowStrength);
    for (let y = 0; y < gf.h; y++) {
      for (let x = 0; x < gf.w; x++) {
        const f = gf.field[y * gf.w + x];
        if (f <= 0) continue;
        const o = ((y + pad) * W + (x + pad)) * 4;
        if (f >= 0.999) {
          const origObj = hexToRgb(pixels[y - gf.padY]?.[x - gf.padX] ?? '');
          const orig: [number, number, number] = origObj
            ? [origObj.r, origObj.g, origObj.b]
            : glowRgb;
          img.data[o] = Math.min(255, Math.round(orig[0] + (255 - orig[0]) * 0.35 * k + glowRgb[0] * 0.25 * k));
          img.data[o + 1] = Math.min(255, Math.round(orig[1] + (255 - orig[1]) * 0.35 * k + glowRgb[1] * 0.25 * k));
          img.data[o + 2] = Math.min(255, Math.round(orig[2] + (255 - orig[2]) * 0.35 * k + glowRgb[2] * 0.25 * k));
          img.data[o + 3] = Math.round(235 * k);
        } else {
          img.data[o] = glowRgb[0];
          img.data[o + 1] = glowRgb[1];
          img.data[o + 2] = glowRgb[2];
          img.data[o + 3] = Math.round(200 * f * k);
        }
      }
    }
    c2d.putImageData(img, 0, 0);
    let out = canvas;
    if (mirror) {
      const flip = document.createElement('canvas');
      flip.width = W;
      flip.height = H;
      const fctx = flip.getContext('2d')!;
      fctx.translate(W, 0);
      fctx.scale(-1, 1);
      fctx.drawImage(canvas, 0, 0);
      out = flip;
    }
    result = { canvas: out, padX: gf.padX + pad, padY: gf.padY + pad };
  }
  if (glowOverlayCache.size > 128) glowOverlayCache.clear();
  glowOverlayCache.set(key, result);
  return result ? { ...result, key } : null;
}

/**
 * Render a single node sprite to the canvas.
 * Implements the unified rendering flow:
 * modifiers → stretch → rotate → translate → draw
 *
 * Pixel-level modifiers (color_replace, outline, dither, pixel_edit, etc.)
 * are applied to the sprite's pixel data before creating the canvas.
 */
function renderNodeSprite(
  ctx: CanvasRenderingContext2D,
  instruction: NodeRenderInstruction,
  canvasWidth: number,
  canvasHeight: number,
  blueprintVars?: Record<string, number>,
): void {
  const { nodeId, sprite, worldX, worldY, angle, stretch, mirror, rotationStrategy, modifiers, frame, frameRate } = instruction;
  const scaleX = instruction.scaleX ?? 1;
  // 透视缩短：沿骨骼方向（局部 Y）乘投影长度比；未开启时 foreshorten 为 undefined → 恒 1
  const effStretch = stretch * (instruction.foreshorten ?? 1);
  const skews = instruction.skews ?? [];
  const previewQuality = instruction.previewQuality ?? 'high';

  // ========================================================================
  // STEP 1: Apply pixel-level EDIT modifiers (color_replace, outline, dither, etc.)
  // These modify the sprite's pixel grid before any canvas creation.
  // This matches the old pipeline's createPartCanvasFromPart() behavior.
  // ========================================================================
  let effectivePixels: PixelGrid = sprite.data;
  let modOffsetX = 0;
  let modOffsetY = 0;

  const activePixelMods = modifiers.filter(m =>
    m.enabled && PIXEL_MOD_TYPES.includes(m.type as ModifierType)
  );

  if (activePixelMods.length > 0) {
    // Convert ModifierInstance[] to old format for applyPixelModifiers
    // Preserve paramKeyframes/paramDrivers so time-domain resolution works
    const oldFormatMods = activePixelMods.map(m => ({
      id: m.id,
      type: m.type,
      enabled: m.enabled,
      collapsed: m.collapsed ?? false,
      params: m.params ?? {},
      startFrame: m.startFrame,
      endFrame: m.endFrame,
      fadeInFrames: m.fadeInFrames,
      fadeOutFrames: m.fadeOutFrames,
      blendMode: m.blendMode,
      coordinateMode: m.coordinateMode,
      paramKeyframes: m.paramKeyframes,
      paramDrivers: m.paramDrivers,
    }));
    // Resolve ParamDrivers/ParamKeyframes before rendering
    const resolvedMods = oldFormatMods.some(m =>
      (m.paramKeyframes && m.paramKeyframes.length > 0) ||
      (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some((d: any) => d.enabled && !d.isBaked))
    ) ? resolveKeyframeModifierParams(oldFormatMods as any, frame) : oldFormatMods;
    const modResult = applyPixelModifiers(sprite.data, resolvedMods as any, frame);
    effectivePixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  }

  // 像素形变走蓝图，不再此处直接调用 applyPixelDeformAnimations
  // （用户指令：extractPixelModifiers + applyPixelDeformAnimations 不用）

  // Apply translate modifier as pixel-level shift (internal shift, not position offset)
  // This matches the old pipeline's behavior in createPartCanvasInner()
  const translateMod = modifiers.find(m => m.type === 'translate' && m.enabled);
  if (translateMod) {
    const dx = Math.round(Number(translateMod.params.offsetX) || 0);
    const dy = Math.round(Number(translateMod.params.offsetY) || 0);
    if (dx !== 0 || dy !== 0) {
      const gridH = effectivePixels.length;
      const gridW = effectivePixels[0]?.length || 0;
      const shifted: PixelGrid = [];
      for (let y = 0; y < gridH; y++) {
        const row: (string | null)[] = [];
        for (let x = 0; x < gridW; x++) {
          const srcX = x - dx;
          const srcY = y - dy;
          if (srcX >= 0 && srcX < gridW && srcY >= 0 && srcY < gridH) {
            row.push(effectivePixels[srcY]?.[srcX] ?? null);
          } else {
            row.push(null);
          }
        }
        shifted.push(row);
      }
      effectivePixels = shifted;
    }
  }

  // ========================================================================
  // STEP 2: Apply pixel-deform via node's BLUEPRINT (unified graph)
  // Path B + STEP2 merge: use instruction.blueprint instead of hand-built graph.
  // The blueprint contains sprite_source -> pixel mods -> screen (from migrate.ts
  // or manual editor wiring). Transform nodes in the graph are re-evaluated
  // harmlessly; only pixels are consumed here.
  // ========================================================================
  const blueprint = (instruction as any).blueprint as BlueprintGraph | null | undefined;

  if (blueprint) {
    // Only evaluate if the blueprint has pixel-deform work to do.
    // (Pure transform blueprints skip pixel evaluation.)
    const hasPixelChain = blueprint.nodes.some(n =>
      n.type === 'sprite_source' || n.type === 'costume' || (n.inputs as any)?.pixels
    );
    if (hasPixelChain) {
      const bpCtx: any = {
        frame, frameRate, vars: blueprintVars ?? {},
        spritePixels: effectivePixels,  // sprite_source 从这里取图
        // costume 节点用
        costumes: (instruction as any).costumes,
        direction: instruction.variantIndex,
        costumeSlot: (instruction as any).costumeSlot,
        // SpriteRef 解析用：Character.sprites 表
        sprites: (instruction as any).sprites,
        // bump_light 手绘高度图（Sprite.heightmap，可选）
        heightmap: (sprite as any).heightmap,
        // screen 为绘制终点：直接回调更新 effectivePixels
        drawToScreen: (cmd: { pixels: PixelGrid }) => {
          if (cmd.pixels) effectivePixels = cmd.pixels;
        },
      };
      try {
        evaluateBlueprint(blueprint, bpCtx);
      } catch {
        // Blueprint pixel evaluation failure: keep original pixels
      }
      // screen 已通过 drawToScreen 更新 effectivePixels，无需再读 renderCommands
    }
  } else {
    // Legacy fallback: no blueprint (should not happen for nodes with modifiers,
    // but preserved for safety). Uses manual graph construction.
    const activeDeformMods = modifiers.filter(m =>
      m.enabled && isPixelDeformModifier(m.type as ModifierType)
    );

    if (activeDeformMods.length > 0) {
      const { pixels: pixelsVal } = require('./blueprint/ir');

      // 构建蓝图图
      const bpNodes: any[] = [
        { id: 'bp_time', type: 'time', inputs: {}, params: {} },
        { id: 'bp_source', type: 'sprite_source', inputs: {}, params: {} },
      ];

      let prevPixelsNodeId = 'bp_source';
      for (const mod of activeDeformMods) {
        const nodeId = `bp_mod_${mod.id}`;
        bpNodes.push({
          id: nodeId,
          type: mod.type,
          inputs: {
            pixels: { nodeId: prevPixelsNodeId, output: 'pixels' },
            t: { nodeId: 'bp_time', output: 'out' },
          },
          params: mod.params ?? {},
        });
        prevPixelsNodeId = nodeId;
      }

      // 终点 screen 节点：接收最终像素 + 变换
      bpNodes.push({
        id: 'bp_screen',
        type: 'screen',
        inputs: {
          pixels: { nodeId: prevPixelsNodeId, output: 'pixels' },
          // 变换数值直接传字面量（worldX/worldY/angle 在指令里）
          translateX: { type: 'number', value: 0 },
          translateY: { type: 'number', value: 0 },
          rotation: { type: 'number', value: 0 },
          scaleX: { type: 'number', value: 1 },
          scaleY: { type: 'number', value: 1 },
        },
        params: {},
      });

      const bpGraph = { version: 1 as const, nodes: bpNodes, edges: [], outputId: 'bp_screen' };
      const bpCtx: any = {
        frame, frameRate, vars: blueprintVars ?? {},
        spritePixels: effectivePixels,
        drawToScreen: (cmd: { pixels: PixelGrid }) => {
          if (cmd.pixels) effectivePixels = cmd.pixels;
        },
      };

      evaluateBlueprint(bpGraph, bpCtx);
    }
  }

  // ---- Face turn（Spine 式伪 3D 转头）：在像素定稿后、关节蒙皮前变形 ----
  // 先转面（整体），后关节蒙皮（局部）。用单张静态图模拟转头，不用多角度差分。
  const faceTurn = (instruction as any).faceTurn as
    | { yaw: number; pitch: number }
    | undefined;
  if (faceTurn && (Math.abs(faceTurn.yaw) > 1e-6 || Math.abs(faceTurn.pitch) > 1e-6)) {
    // 懒加载避免循环依赖
    const { applyFaceTurn } = require('./skin/face-turn') as typeof import('./skin/face-turn');
    effectivePixels = applyFaceTurn(effectivePixels, {
      yaw: faceTurn.yaw,
      pitch: faceTurn.pitch,
      landmarks: sprite.landmarks,
    });
  }

  // ---- Mesh skinning（关节网格蒙皮）：在像素定稿后、转 canvas 前变形 ----
  // socket.skinning === 'mesh' 时，用插值变形代替关节盘遮盖接缝。
  // 注意：plug 坐标是精灵局部（未镜像）；mirror 时 plug X 已在下方翻转，
  // 此处蒙皮作用于未镜像的 effectivePixels，故用原始 plug 坐标。
  const meshSkin = (instruction as any).meshSkin as
    | { plugX: number; plugY: number; jointAngle: number; radius: number; curve: 'linear' | 'smoothstep' }
    | undefined;
  if (meshSkin && Math.abs(meshSkin.jointAngle) > 0.01 && meshSkin.radius > 0) {
    // 懒加载避免循环依赖（mesh-skin 只依赖类型+工具函数，无回引）
    const { applyMeshSkin } = require('./skin/mesh-skin') as typeof import('./skin/mesh-skin');
    effectivePixels = applyMeshSkin(
      effectivePixels,
      meshSkin.plugX,
      meshSkin.plugY,
      meshSkin.jointAngle,
      meshSkin.radius,
      meshSkin.curve,
    );
  }

  // ---- 蒙皮快照弯曲：合并精灵在像素定稿后按相对角变化弯曲 ----
  const snapshotSkin = (instruction as any).snapshotSkin as
    | { jointX: number; jointY: number; axisX: number; axisY: number; deltaAngle: number; radius: number; curve: 'linear' | 'smoothstep' }
    | undefined;
  if (snapshotSkin && Math.abs(snapshotSkin.deltaAngle) > 0.01 && snapshotSkin.radius > 0) {
    const { applySnapshotBend } = require('./skin/mesh-skin') as typeof import('./skin/mesh-skin');
    effectivePixels = applySnapshotBend(
      effectivePixels,
      snapshotSkin.jointX,
      snapshotSkin.jointY,
      snapshotSkin.axisX,
      snapshotSkin.axisY,
      snapshotSkin.deltaAngle,
      snapshotSkin.radius,
      snapshotSkin.curve,
    );
  }

  // 动态模式置换段（D2）：全部像素加工完成后、成画布之前按噪声场
  // 逐像素重采样。多实例只取第一个启用置换（与导出运行时同口径）；
  // 发光叠加层在下方用同一份 effectivePixels 构建，自动同场对齐。
  if (previewQuality !== 'low' && instruction.dynamicPatterns?.length) {
    const disp = instruction.dynamicPatterns
      .map((r) => r.instance.params)
      .find((p) => p.displaceEnabled && (p.displaceAmp ?? 0) > 0);
    if (disp) {
      const { displacePixelGrid, displacePhaseAt } = require('./dynamic-patterns') as typeof import('./dynamic-patterns');
      // 置换方向绑定（sprite-marks）：命中标记时以标记角为准
      const dispEff = disp.displaceDirMark && sprite
        ? { ...disp, displaceDeg: markDirAngleDeg(sprite, disp.displaceDirMark) ?? disp.displaceDeg }
        : disp;
      effectivePixels = displacePixelGrid(
        effectivePixels, dispEff, displacePhaseAt(dispEff, frame / frameRate),
      ) as PixelGrid;
    }
  }

  // Create offscreen canvas from (possibly modified) sprite data
  // 可逆性：分部件尺度差换算。精灵是分部件像素（相机紧→图里大），节点是全局像素，
  // 绘制时按比例缩放对齐。scaleFactor = partCameraHalf / globalCameraHalf（记录的尺度差，可逆）
  // 相机紧（partCH小）→ 精灵在图里占比大 → 需缩小到全局尺度
  // TODO: 用户反馈烘焙精灵已正确但渲染裁剪，暂禁用缩放排查
  const partCH = sprite.partCameraHalf ?? 1.0;
  const globalCH = sprite.globalCameraHalf ?? 1.0;
  const scaleFactor = 1.0; // partCH / globalCH;

  // 像素内容全图哈希：定稿像素（列表像素修改器+蓝图像素链+蒙皮弯曲全过完）
  // 的同一性凭证，随旋转调用进缓存键——像素可变的精灵不得用 5 点采样指纹，
  // 否则改参数不碰采样点时旋转缓存返回旧图（改参数/播放都不生效的原凶）。
  // 哈希折进 pixelsToCanvas 本来就要做的全图遍历，不单独再跑一遍。
  const pixelHashOut = { value: '' };
  let spriteCanvas = pixelsToCanvas(effectivePixels, sprite.width, sprite.height, pixelHashOut);
  let pixelContentHash = pixelHashOut.value;
  // 堆叠合成图：按计划期算子逐层栅格化为绘制画布（effectivePixels
  // 是回落精灵的像素链产物，对摞不适用）。颜色/图案类像素修改器
  // 逐层套用（口径见 STACK_PIXEL_MOD_TYPES）；内容哈希 = 朝向键 +
  // 逐层内容哈希——只改像素/参数时也换键，防旋转缓存串旧图。
  const stackPivot = instruction.stackRender
    ? { x: instruction.stackRender.pivotX, y: instruction.stackRender.pivotY }
    : null;
  let stackLayerGrids: (PixelGrid | null)[] = [];
  if (instruction.stackRender) {
    const table = instruction.sprites ?? {};
    const stackResolved = resolveStackPixelMods(modifiers, frame);
    const hashParts: string[] = [];
    const canvases = instruction.stackRender.layerSpriteIds.map((id, li) => {
      const spr = table[id];
      if (!spr) { hashParts.push('∅'); stackLayerGrids.push(null); return null; }
      const p = stackLayerProcessed(spr, stackResolved, frame, `${instruction.stackRender!.key}|${li}`);
      hashParts.push(p.hash);
      stackLayerGrids.push(p.grid);
      return p.canvas;
    });
    const raster = rasterizeStackOps(instruction.stackRender, canvases);
    if (raster) {
      spriteCanvas = raster;
      pixelContentHash = `${instruction.stackRender.key}|${hashParts.join(',')}`;
    }
  }
  if (!spriteCanvas || spriteCanvas.width === 0 || spriteCanvas.height === 0) return;
  // 若尺度不一致，重采样到全局像素（一次，非每帧；记录的系数保证可逆）
  if (Math.abs(scaleFactor - 1) > 0.001) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.round(spriteCanvas.width * scaleFactor));
    scaled.height = Math.max(1, Math.round(spriteCanvas.height * scaleFactor));
    const sctx = scaled.getContext('2d')!;
    sctx.imageSmoothingEnabled = false; // 像素风不模糊
    sctx.drawImage(spriteCanvas, 0, 0, scaled.width, scaled.height);
    spriteCanvas = scaled;
  }

  // Compute the pivot/plug position in the working canvas.
  // Account for modifier offset (e.g. outline expansion shifts the origin).
  // worldX/Y is where this pivot should land on the output canvas.
  // When mirrored, the plug X is flipped: x → width - x
  // 注意：plug 已在全局像素下（画布已缩放），直接使用
  let pivotX = stackPivot ? stackPivot.x : (sprite.plug?.x !== undefined ? subToPx(sprite.plug.x) * scaleFactor : spriteCanvas.width / 2) + modOffsetX;
  const pivotY = stackPivot ? stackPivot.y : (sprite.plug?.y !== undefined ? subToPx(sprite.plug.y) * scaleFactor : spriteCanvas.height / 2) + modOffsetY;

  const pivotXRaw = pivotX; // 未镜像口径的枢轴（发光叠加层按此对位）

  // Step 3: Apply horizontal flip if mirrored (STATIC mirror: flip BEFORE rotation)
  let workingCanvas: HTMLCanvasElement = spriteCanvas;
  if (mirror) {
    const flipCanvas = document.createElement('canvas');
    flipCanvas.width = spriteCanvas.width;
    flipCanvas.height = spriteCanvas.height;
    const flipCtx = flipCanvas.getContext('2d')!;
    flipCtx.translate(flipCanvas.width, 0);
    flipCtx.scale(-1, 1);
    flipCtx.drawImage(spriteCanvas, 0, 0);
    workingCanvas = flipCanvas;
    // Flip pivot: pivotX measured from left edge becomes (width - pivotX) after horizontal flip
    pivotX = workingCanvas.width - pivotX;
  }

  // STEP 4: Set up canvas transform for this sprite's world position
  // (translate + rotate + scale around pivot), then render effects + sprite
  // ========================================================================

  // 动态模式发光段：叠加层与精灵同像素空间（scaleFactor ≡ 1 前提，与绘制口径一致）。
  // 按发光组建层：前 3 个各一组，第 4 个起按所选组并入（resolveGlowGroups）。
  const glowOverlays = previewQuality === 'low' || !instruction.dynamicPatterns?.length
    ? []
    : instruction.stackRender
      ? (() => {
          // 发光按合成图出（逐层出会互相遮挡/重复发光）：合成网格
          // 与绘制画布同算子同层料，定向用摞级 marks
          const grid = stackCompositeGrid(instruction.stackRender, stackLayerGrids, pixelContentHash);
          if (!grid) return [];
          return resolveGlowGroups(instruction.dynamicPatterns.map((r) => r.instance.params))
            .map((g) => buildGlowOverlay(grid, g.representative, g.contributors, frame / frameRate, pixelContentHash, mirror, angle, instruction.stackRender!.marks ?? sprite?.marks))
            .filter((x): x is { canvas: HTMLCanvasElement; padX: number; padY: number; key: string } => !!x);
        })()
      : resolveGlowGroups(instruction.dynamicPatterns.map((r) => r.instance.params))
        .map((g) => buildGlowOverlay(effectivePixels, g.representative, g.contributors, frame / frameRate, pixelContentHash, mirror, angle, sprite?.marks))
        .filter((x): x is { canvas: HTMLCanvasElement; padX: number; padY: number; key: string } => !!x);
  const glowPivotX = (g: { canvas: HTMLCanvasElement; padX: number }) =>
    (mirror ? g.canvas.width - (pivotXRaw + g.padX) : pivotXRaw + g.padX);

  // Compute the draw position (where the pivot lands on canvas)
  const drawPivotX = subToPx(worldX);
  const drawPivotY = subToPx(worldY);

  // 残影段（D5）：在本节点一切绘制之前，按过去位姿增量逐个画同一
  // 份 workingCanvas（旧→新、逐个变淡）。走原生变换路径——残影
  // 半透明，像素完美旋转的差异不可见。
  if (previewQuality !== 'low' && instruction.trailGhosts?.length) {
    for (const g of instruction.trailGhosts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha));
      ctx.translate(Math.round(drawPivotX + g.dx), Math.round(drawPivotY + g.dy));
      ctx.rotate(((angle + g.daDeg) * Math.PI) / 180);
      ctx.scale(scaleX, effStretch);
      for (const { skewX, skewY } of skews) {
        ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
      }
      ctx.drawImage(workingCanvas, -pivotX, -pivotY);
      ctx.restore();
    }
  }

  // We need ctx.save/restore to isolate the transform for effect rendering
  ctx.save();

  // Apply the same transform chain as the old pipeline:
  // translate(worldPosition) → rotate(angle) → scale(scaleX, stretchY) → skew
  // Then draw at (-pivotX, -pivotY) so the pivot aligns with world position
  ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(scaleX, effStretch);

  // Apply skews (matches old pipeline's renderPartToCanvas order: after scale)
  for (const { skewX, skewY } of skews) {
    ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
  }

  // ========================================================================
  // STEP 4a: Render "behind" effects (before the part itself)
  // glow, afterimage, motion_blur are drawn BEHIND the main sprite
  // This matches the old pipeline's renderPartToCanvas() behavior.
  // Preview quality: skip effect modifiers in low quality mode (old parity).
  // ========================================================================
  const behindEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
    m.enabled && ['glow', 'afterimage', 'motion_blur'].includes(m.type)
  );
  for (const mod of behindEffectMods) {
    switch (mod.type) {
      case 'glow':
        renderGlowEffect(ctx, mod as any, workingCanvas);
        break;
      case 'afterimage':
        renderAfterimageEffect(ctx, mod as any, modifiers as any, workingCanvas);
        break;
      case 'motion_blur':
        renderMotionBlurEffect(ctx, mod as any, modifiers as any, workingCanvas);
        break;
    }
  }

  // === Auto motion blur (old pipeline parity) ===
  // Rendered in the transformed space, after behind effects, before the sprite.
  if (
    instruction.autoMotionBlur &&
    instruction.autoMotionBlurKeyframes &&
    instruction.autoMotionBlurKeyframes.length > 0 &&
    instruction.autoMotionBlurSpriteId
  ) {
    applyAutoMotionBlur(
      ctx,
      instruction.autoMotionBlurSpriteId ?? instruction.nodeId,
      frame,
      instruction.autoMotionBlurKeyframes,
      instruction.autoMotionBlurIntensity ?? 0.5,
      workingCanvas,
      undefined,
    );
  }

  // 动态模式粒子（身后层）：与身后效果同空间，精灵之前绘制
  if (previewQuality !== 'low' && instruction.dynamicPatterns?.length) {
    drawDynamicParticles(ctx, instruction, 'back');
  }

  // ========================================================================
  // STEP 4b: Draw the main sprite
  // In the transformed coordinate space, the sprite's top-left is at (-pivotX, -pivotY)
  // ========================================================================
  ctx.imageSmoothingEnabled = false;

  // Pixel-perfect path covers the full local affine: rotate + Y-stretch on the
  // diagonal fast path; X-scale / skew go through the composite path, which
  // bakes S·K at 4× first and rotates last (matrix associativity makes this
  // identical to the native chain). The native canvas path remains only for
  // rotationStrategy === 'native' or a fully identity transform.
  const usePixelPerfect = rotationStrategy === 'pixel-perfect'
    && (angle !== 0 || effStretch !== 1.0 || scaleX !== 1 || skews.length !== 0);
  if (usePixelPerfect) {
    // Use 4× upscale pixel-perfect rotation — this renders to an offscreen
    // canvas, then we draw that result at the world position.
    // Since we already applied the translate+rotate+scale transform above,
    // we need to undo it and draw the pixel-perfect result directly.
    ctx.restore(); // Undo the transform we set up

    const result = renderPixelPerfectRotation(
      workingCanvas,
      angle,
      effStretch,
      pivotX,
      pivotY,
      // 镜像在旋转前已翻进 workingCanvas：内容哈希补镜像位，防镜像/原图同键串图
      { scaleX, skews, contentHash: mirror ? `${pixelContentHash}M` : pixelContentHash },
    );

    // Draw at world position with half-pixel alignment
    const drawX = Math.round(subToPx(worldX) - result.resultPivotX);
    const drawY = Math.round(subToPx(worldY) - result.resultPivotY);

    // NOTE: behind effects (glow/afterimage/motion_blur) + auto motion blur were
    // already rendered above in the transformed space before ctx.restore(),
    // so they are NOT repeated here (old code rendered them twice — fixed).

    ctx.drawImage(result.canvas, drawX, drawY);

    // H13: 释放 pixel-perfect 旋转产生的池化 canvas（缓存命中返回的也是调用方拥有的
    // 池化副本）。注意 angle=0&&stretch=1 时返回的是 workingCanvas 本身，不能释放。
    if (result.canvas !== workingCanvas) {
      releaseCanvas(result.canvas);
    }

    // 动态模式发光段（pixel-perfect 路径）：叠加层过同一旋转机器后加色叠加
    if (glowOverlays.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const g of glowOverlays) {
        const gres = renderPixelPerfectRotation(
          g.canvas, angle, effStretch, glowPivotX(g), pivotY + g.padY,
          { scaleX, skews, contentHash: g.key },
        );
        ctx.drawImage(
          gres.canvas,
          Math.round(subToPx(worldX) - gres.resultPivotX),
          Math.round(subToPx(worldY) - gres.resultPivotY),
        );
        if (gres.canvas !== g.canvas) releaseCanvas(gres.canvas);
      }
      ctx.restore();
    }

    // Render "on top" effects after the sprite for pixel-perfect rotation path
    // Preview quality: skip particle effects in low quality mode (old parity).
    const topEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    if (topEffectMods.length > 0 || (previewQuality !== 'low' && instruction.dynamicPatterns?.length)) {
      ctx.save();
      ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(scaleX, effStretch);
      for (const { skewX, skewY } of skews) {
        ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
      }
      if (previewQuality !== 'low' && instruction.dynamicPatterns?.length) {
        drawDynamicParticles(ctx, instruction, 'front');
        drawDynamicArcs(ctx, instruction);
      }
      for (const mod of topEffectMods) {
        renderParticleEffect(ctx, nodeId, sprite, mod as any, frame);
      }
      ctx.restore();
    }
  } else {
    // Native Canvas2D or no rotation: draw in the already-transformed space
    ctx.drawImage(workingCanvas, -pivotX, -pivotY);

    // 动态模式发光段：与精灵同一变换空间，加色叠加在精灵之上
    if (glowOverlays.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const g of glowOverlays) {
        ctx.drawImage(g.canvas, -glowPivotX(g), -(pivotY + g.padY));
      }
      ctx.restore();
    }

    // 动态模式粒子（身前层）+ 弧线段
    if (previewQuality !== 'low' && instruction.dynamicPatterns?.length) {
      drawDynamicParticles(ctx, instruction, 'front');
      drawDynamicArcs(ctx, instruction);
    }

    // ========================================================================
    // STEP 4c: Render "on top" effects (after the part itself)
    // particle effects are drawn ON TOP of the main sprite
    // Preview quality: skip particle effects in low quality mode (old parity).
    // ========================================================================
    const topEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    for (const mod of topEffectMods) {
      renderParticleEffect(ctx, nodeId, sprite, mod as any, frame);
    }

    ctx.restore(); // Undo the transform we set up
  }
}

/**
 * Render a disc (joint circle) at its world position.
 */
/** 人偶兜底绘制：胶囊段（圆头粗线，半径取两端均值）+ 终点关节圆，
 * 先描边色垫底再填主体色。与关节盘同层（精灵之前）。 */
function renderMannequin(
  ctx: CanvasRenderingContext2D,
  instruction: MannequinRenderInstruction,
): void {
  const x1 = subToPx(instruction.x1), y1 = subToPx(instruction.y1);
  const x2 = subToPx(instruction.x2), y2 = subToPx(instruction.y2);
  const rAvg = Math.max(1, (instruction.r1 + instruction.r2) / 2);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = instruction.outlineColor;
  ctx.lineWidth = rAvg * 2 + 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = instruction.fillColor;
  ctx.lineWidth = rAvg * 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x2, y2, Math.max(1, instruction.r2), 0, Math.PI * 2);
  ctx.fillStyle = instruction.fillColor;
  ctx.fill();
  ctx.strokeStyle = instruction.outlineColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function renderDisc(
  ctx: CanvasRenderingContext2D,
  instruction: DiscRenderInstruction,
): void {
  const { worldX, worldY, diameter, fillColor, outlineColor } = instruction;
  const x = Math.round(subToPx(worldX));
  const y = Math.round(subToPx(worldY));
  const radius = Math.max(1, diameter / 2);

  // ---- Disc bitmap cache ----
  // Discs are pure geometric shapes determined by diameter + fillColor + outlineColor.
  // Cache the pre-rendered disc bitmap and reuse it across frames.
  const cacheKey = getDiscCacheKey(diameter, fillColor, outlineColor);
  let cached = getCachedDisc(cacheKey);

  if (!cached || cached.radius !== radius) {
    // Create pre-rendered disc bitmap
    const padding = 2; // Extra pixels for outline stroke
    const bmpSize = Math.ceil(diameter + padding * 2);
    const discCanvas = document.createElement('canvas');
    discCanvas.width = bmpSize;
    discCanvas.height = bmpSize;
    const discCtx = discCanvas.getContext('2d')!;
    const cx = bmpSize / 2;
    const cy = bmpSize / 2;

    discCtx.beginPath();
    discCtx.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2);
    discCtx.fillStyle = fillColor;
    discCtx.fill();
    discCtx.strokeStyle = outlineColor;
    discCtx.lineWidth = 1;
    discCtx.stroke();

    cached = { canvas: discCanvas, radius };
    setCachedDisc(cacheKey, cached);
  }

  // Draw the cached disc bitmap centered at the world position
  const bmpSize = cached.canvas.width;
  ctx.drawImage(cached.canvas, x - bmpSize / 2, y - bmpSize / 2);
}

/**
 * Convert a PixelGrid to an offscreen HTMLCanvasElement.
 * This is the raw pixel→canvas conversion without modifier processing.
 */
const stackLayerCanvasCache = new WeakMap<Sprite, HTMLCanvasElement>();
function stackLayerCanvas(sprite: Sprite): HTMLCanvasElement | null {
  let cv = stackLayerCanvasCache.get(sprite);
  if (!cv) {
    cv = pixelsToCanvas(sprite.data, sprite.width, sprite.height) ?? undefined as unknown as HTMLCanvasElement;
    if (!cv) return null;
    stackLayerCanvasCache.set(sprite, cv);
  }
  return cv;
}

// ---- 堆叠的像素口径 ----
// 像素修改器里只有「只改格值、不改网格几何」的颜色/图案类能逐层
// 套用：算子按层图的 plug/尺寸锚定，改色与算子可交换。几何重映射
// 类（pixel_displace、cylinder/sphere_rotate、mirror、flip）、形变
// 级修改器与蓝图单图像素链逐层套用会让每层以各自 plug 为原点独
// 立变形、层间配准被破坏——不适用于堆叠（蓝图链是单图契约：
// sprite_source 只有一份网格，无从分发到 N 层）。发光不逐层，
// 按合成图出（见 stackCompositeGrid）。
const STACK_PIXEL_MOD_TYPES: readonly string[] = ['color_replace', 'dither', 'pixel_edit'];

const stackRawHashCache = new WeakMap<Sprite, string>();
function stackRawLayerHash(spr: Sprite): string {
  let h = stackRawHashCache.get(spr);
  if (!h) { h = hashPixelGrid(spr.data); stackRawHashCache.set(spr, h); }
  return h;
}

const stackProcessedCache = new Map<string, { canvas: HTMLCanvasElement | null; hash: string; grid: PixelGrid }>();

/** 堆叠口径的修改器解析：从节点修改器里挑颜色/图案类（见
 * STACK_PIXEL_MOD_TYPES），走与 STEP 1 同路的格式转换 + 关键帧/
 * 驱动解析。其余修改器对堆叠不适用（机制见上方口径注释）。 */
export function resolveStackPixelMods(
  modifiers: readonly { enabled: boolean; type: string }[],
  frame: number,
): unknown[] {
  const picked = (modifiers as unknown as Record<string, unknown>[]).filter(
    (m) => m.enabled && STACK_PIXEL_MOD_TYPES.includes(m.type as string),
  ) as Record<string, unknown>[];
  if (picked.length === 0) return [];
  const oldFormat = picked.map((m) => ({
    id: m.id, type: m.type, enabled: m.enabled, collapsed: m.collapsed ?? false,
    params: m.params ?? {}, startFrame: m.startFrame, endFrame: m.endFrame,
    fadeInFrames: m.fadeInFrames, fadeOutFrames: m.fadeOutFrames,
    blendMode: m.blendMode, coordinateMode: m.coordinateMode,
    paramKeyframes: m.paramKeyframes, paramDrivers: m.paramDrivers,
  }));
  const needsResolve = oldFormat.some((m) =>
    (Array.isArray(m.paramKeyframes) && m.paramKeyframes.length > 0)
    || (Array.isArray(m.paramDrivers) && m.paramDrivers.length > 0
      && m.paramDrivers.some((d) => (d as { enabled?: boolean; isBaked?: boolean }).enabled && !(d as { isBaked?: boolean }).isBaked)));
  return needsResolve ? resolveKeyframeModifierParams(oldFormat as never, frame) : oldFormat;
}

/** 层网格过一遍已解析的堆叠口径修改器（纯函数）：尺寸被改则回落
 * 原网格保层间配准（颜色/图案类本不应改尺寸，这是护栏）。 */
export function processStackLayerGrid(spr: Sprite, resolvedMods: unknown[], frame: number): PixelGrid {
  if (resolvedMods.length === 0) return spr.data;
  const result = applyPixelModifiers(spr.data, resolvedMods as never, frame);
  return (result.pixels.length === spr.height && (result.pixels[0]?.length ?? 0) === spr.width)
    ? result.pixels : spr.data;
}

/** 层图的（可能已过像素修改器的）画布 + 内容哈希 + 网格 */
function stackLayerProcessed(
  spr: Sprite,
  resolvedMods: unknown[],
  frame: number,
  keyPrefix: string,
): { canvas: HTMLCanvasElement | null; hash: string; grid: PixelGrid } {
  if (resolvedMods.length === 0) {
    return { canvas: stackLayerCanvas(spr), hash: stackRawLayerHash(spr), grid: spr.data };
  }
  const key = `${keyPrefix}|${JSON.stringify(resolvedMods)}|${frame}`;
  const hit = stackProcessedCache.get(key);
  if (hit) return hit;
  const grid = processStackLayerGrid(spr, resolvedMods, frame);
  const hashOut = { value: '' };
  const canvas = pixelsToCanvas(grid, spr.width, spr.height, hashOut) as HTMLCanvasElement | null;
  const entry = { canvas, hash: hashOut.value, grid };
  if (stackProcessedCache.size > 96) stackProcessedCache.clear();
  if (canvas) stackProcessedCache.set(key, entry);
  return entry;
}

const stackCompositeGridCache = new Map<string, PixelGrid>();
/** 堆叠的合成网格（发光等需要整图网格的消费方用）：按计划算子对
 * 加工后层网格纯数据栅格化，与执行层画布栅格化同口径；按内容
 * 哈希（朝向键 + 逐层哈希）缓存。 */
function stackCompositeGrid(
  stackRender: NonNullable<NodeRenderInstruction['stackRender']>,
  layerGrids: (PixelGrid | null)[],
  cacheKey: string,
): PixelGrid | null {
  const hit = stackCompositeGridCache.get(cacheKey);
  if (hit) return hit;
  const rgbaLayers = layerGrids.map((g) => {
    if (!g || g.length === 0) return null;
    const h = g.length, w = g[0]?.length ?? 0;
    if (w === 0) return null;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = g[y]?.[x];
        if (!cell) continue;
        const o = (y * w + x) * 4;
        rgba[o] = parseInt(cell.slice(1, 3), 16);
        rgba[o + 1] = parseInt(cell.slice(3, 5), 16);
        rgba[o + 2] = parseInt(cell.slice(5, 7), 16);
        rgba[o + 3] = 255;
      }
    }
    return { rgba, width: w, height: h };
  });
  const raster = rasterizeStackOpsData(stackRender, rgbaLayers);
  if (!raster) return null;
  const grid: PixelGrid = [];
  for (let y = 0; y < raster.height; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < raster.width; x++) {
      const o = (y * raster.width + x) * 4;
      row.push(rgbaToHexOrNull(raster.rgba[o]!, raster.rgba[o + 1]!, raster.rgba[o + 2]!, raster.rgba[o + 3]!));
    }
    grid.push(row);
  }
  if (stackCompositeGridCache.size > 16) stackCompositeGridCache.clear();
  stackCompositeGridCache.set(cacheKey, grid);
  return grid;
}

export function pixelsToCanvas(
  pixels: PixelGrid,
  width: number,
  height: number,
  // 给出时顺路算全图内容哈希（createPixelGridHasher，与 hashPixelGrid 同值）：
  // 本函数本来就要逐格遍历建 ImageData，哈希折进同一遍、零额外遍历。
  // 渲染主路径靠它给旋转缓存供键，不再单独跑一遍 hashPixelGrid。
  hashOut?: { value: string },
): HTMLCanvasElement | null {
  if (!pixels || pixels.length === 0) return null;
  if (width <= 0 || height <= 0) return null;

  const canvasW = pixels[0]?.length ?? width;
  const canvasH = pixels.length ?? height;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  const hasher = hashOut ? createPixelGridHasher(canvasW, canvasH) : null;
  const imageData = ctx.createImageData(canvasW, canvasH);
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      const color = pixels[y]?.[x];
      if (hasher) hasher.cell(color);
      if (color) {
        const idx = (y * canvasW + x) * 4;
        const rgb = hexToRgb(color);
        if (rgb) {
          imageData.data[idx] = rgb.r;
          imageData.data[idx + 1] = rgb.g;
          imageData.data[idx + 2] = rgb.b;
          imageData.data[idx + 3] = 255;
        }
      }
    }
  }

  if (hasher && hashOut) hashOut.value = hasher.digest();
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Convert Sprite data to an offscreen HTMLCanvasElement.
 * Convenience wrapper around pixelsToCanvas for Sprite objects.
 */
function spriteDataToCanvas(sprite: Sprite): HTMLCanvasElement | null {
  return pixelsToCanvas(sprite.data, sprite.width, sprite.height);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Read back a canvas into a PixelGrid.
 * Opaque pixels → "#rrggbb", transparent → null.
 * (Alpha is not preserved — same limitation as the PNG importer.)
 */
export function canvasToPixels(canvas: HTMLCanvasElement): PixelGrid {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const grid: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = img.data[i + 3]!;
      if (a === 0) {
        row.push(null);
      } else {
        const r = img.data[i]!.toString(16).padStart(2, '0');
        const g = img.data[i + 1]!.toString(16).padStart(2, '0');
        const b = img.data[i + 2]!.toString(16).padStart(2, '0');
        row.push(`#${r}${g}${b}`);
      }
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Render a character through its character-level blueprint.
 * 1. Draw all node/disc instructions to an offscreen canvas (existing path).
 * 2. Read back pixels → character_source.
 * 3. Evaluate character blueprint (user post-processing) → screen.
 * 4. Draw final pixels to the main canvas.
 * Falls back to null (caller uses legacy path) when blueprint is missing/invalid.
 */
function renderCharacterWithBlueprint(
  ctx: CanvasRenderingContext2D,
  plan: RenderPlan,
  canvasWidth: number,
  canvasHeight: number,
  drawOne?: (c: CanvasRenderingContext2D, instruction: NodeRenderInstruction) => void,
): boolean {
  const blueprint = plan.characterBlueprint;
  if (!blueprint) return false;

  const frame = plan.frame ?? 0;
  const frameRate = plan.frameRate ?? 12;

  // Step 1: composite character to offscreen (existing per-node path)
  const off = document.createElement('canvas');
  off.width = canvasWidth;
  off.height = canvasHeight;
  const offCtx = off.getContext('2d')!;
  // 关节盘先行（不参与深度排序、始终被遮挡），节点随后按深度序绘制
  for (const disc of plan.discInstructions) renderDisc(offCtx, disc);
  for (const mq of plan.mannequinInstructions ?? []) renderMannequin(offCtx, mq);
  for (const instruction of plan.sortedInstructions) {
    if (drawOne) drawOne(offCtx, instruction);
    else renderNodeSprite(offCtx, instruction, canvasWidth, canvasHeight, plan.blueprintVars);
  }

  // Step 2: read back → character_source pixels
  const characterPixels = canvasToPixels(off);

  // Step 3: evaluate character blueprint
  let finalPixels: PixelGrid | null = null;
  try {
    evaluateBlueprint(blueprint, {
      frame,
      frameRate,
      vars: plan.blueprintVars ?? {},
      characterPixels,
      drawToScreen: (cmd: { pixels: PixelGrid }) => {
        if (cmd.pixels) finalPixels = cmd.pixels;
      },
    } as any);
  } catch {
    return false;
  }
  if (!finalPixels) return false;

  // Step 4: draw result to main canvas
  const resultCanvas = pixelsToCanvas(finalPixels, canvasWidth, canvasHeight);
  if (!resultCanvas) return false;
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(resultCanvas, 0, 0);
  ctx.imageSmoothingEnabled = prevSmoothing;
  return true;
}

// ---- Unified Render Entry Point ----

/**
 * Unified render function: renders a complete frame using the new architecture.
 * This is the primary entry point that replaces both renderFrame() and renderPuppetNodes().
 */
function renderUnifiedFrame(
  ctx: CanvasRenderingContext2D,
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string = '#000000',
  rotationStrategy: RotationStrategy = 'pixel-perfect',
  frameRate: number = 12,
  animationVariables?: AnimationVariable[],
): void {
  // Clear and fill background
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Generate and execute render plan
  const plan = generateRenderPlan(
    character, frame, canvasWidth, canvasHeight,
    rotationStrategy, frameRate, animationVariables,
  );
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
}

// ---- Compatibility Bridge ----

/**
 * Render using the old data model through the new pipeline.
 * This is the transitional API that allows the new render pipeline
 * to work with the old store data via the LiveAdapter.
 */
function renderFrameViaUnifiedPipeline(
  ctx: CanvasRenderingContext2D,
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  backgroundColor: string = '#000000',
  frameRate: number = 12,
  animationVariables?: AnimationVariable[],
): void {
  renderUnifiedFrame(
    ctx, character, frame, canvasWidth, canvasHeight,
    backgroundColor, 'pixel-perfect', frameRate, animationVariables,
  );
}

// Helper: convert pixel value to sub-pixel units (imported from unified-types but also needed here)
function pxToSub(v: number): SubPixel {
  return Math.round(v * 16);
}


// ============================================================
// Render Orchestrators (moved from unified-pipeline-bridge.ts)
// ============================================================
// The old Puppet pipeline bridge is deleted. These are the
// new-model-only entry points.

/** Invalidate render caches when store data changes */
export function invalidateUnifiedPipelineCache(): void {
  clearRenderCaches();
}

/**
 * H11: 全局变换（镜头/世界）包装——实时预览与导出两条路径复用。
 */
function applyGlobalTransformWrapper(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  globalModifiers: GlobalModifier[] | undefined,
  frame: number,
  frameRate: number,
  globalBlueprint?: import('./blueprint/ir').BlueprintGraph | null,
  vars?: Record<string, number>,
): boolean {
  let globalTransform = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  if (globalModifiers && globalModifiers.length > 0) {
    const blueprint = globalBlueprint ?? modifiersToBlueprint(globalModifiers as any);
    if (blueprint) {
      const t = evaluateBlueprint(blueprint, { frame, frameRate, vars: vars ?? {} } as any);
      globalTransform = {
        translateX: t.translateX, translateY: t.translateY, rotation: t.rotation,
        scaleX: t.scaleX, scaleY: t.scaleY,
      };
    }
  }
  const has = globalTransform.translateX !== 0 || globalTransform.translateY !== 0 ||
    globalTransform.rotation !== 0 || globalTransform.scaleX !== 1 || globalTransform.scaleY !== 1;
  if (has) {
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.translate(globalTransform.translateX, globalTransform.translateY);
    ctx.rotate((globalTransform.rotation * Math.PI) / 180);
    ctx.scale(globalTransform.scaleX, globalTransform.scaleY);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
  }
  return has;
}

function renderPuppetViaUnifiedPipeline(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  unifiedCharacters: Record<string, Character>,
  currentFrame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: StoreAnimationVariable[],
  canvasModifierTracks?: CanvasModifierTrack[],
  proceduralAnimations?: ProceduralAnimation[],
  globalBlueprint?: import('./blueprint/ir').BlueprintGraph | null,
  sprites?: Record<string, Sprite>,
  perspectiveForeshorten?: boolean,
  animationClips?: AnimationClip[],
  activeClipId?: string | null,
  geometryDirection?: DirectionIndex,
  mannequinFallback?: boolean,
): void {
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, currentFrame, frameRate, globalBlueprint,
    buildBlueprintVars(mapStoreAnimationVariables(animationVariables), currentFrame, undefined, frameRate),
  );
  for (const unifiedCharacter of Object.values(unifiedCharacters)) {
    const unifiedVars = mapStoreAnimationVariables(animationVariables);
    const plan = generateRenderPlan(
      unifiedCharacter, currentFrame, canvasWidth, canvasHeight,
      'pixel-perfect', frameRate, unifiedVars,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, proceduralAnimations, sprites,
      undefined, perspectiveForeshorten,
      pickClipStateKeyframes(animationClips, activeClipId, unifiedCharacter.id, currentFrame),
      geometryDirection,
      pickSlashClip(animationClips, activeClipId, unifiedCharacter.id, currentFrame) ?? null,
      mannequinFallback,
    );
    executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
  }
  if (hasGlobalTransform) ctx.restore();
}

/**
 * Main canvas render orchestrator (new model only).
 */
export function renderUnified(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  _parts: Sprite[],
  keyframes: Keyframe[],
  currentFrame: number,
  backgroundColor: string,
  effectTracks: EffectTrack[] | undefined,
  motionBlurStrokes: MotionBlurStroke[] | undefined,
  effectStrokes: EffectStroke[] | undefined,
  autoMotionBlur: boolean,
  autoMotionBlurIntensity: number,
  proceduralAnimations: ProceduralAnimation[] | undefined,
  canvasModifierTracks: CanvasModifierTrack[] | undefined,
  frameRate: number,
  previewQuality: 'low' | 'medium' | 'high',
  animationVariables: StoreAnimationVariable[] | undefined,
  globalModifiers: GlobalModifier[] | undefined,
  unifiedCharacters: Record<string, Character> | undefined,
  animationClips: AnimationClip[],
  useUnifiedPipeline: boolean = true,
  globalBlueprint?: import('./blueprint/ir').BlueprintGraph | null,
  sprites?: Record<string, Sprite>,
  perspectiveForeshorten?: boolean,
  activeClipId?: string | null,
  geometryDirection?: DirectionIndex,
  mannequinFallback?: boolean,
): void {
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  if (unifiedCharacters && Object.keys(unifiedCharacters).length > 0) {
    renderPuppetViaUnifiedPipeline(
      ctx, canvasWidth, canvasHeight, unifiedCharacters,
      currentFrame, frameRate, globalModifiers, animationVariables,
      canvasModifierTracks, proceduralAnimations, globalBlueprint, sprites,
      perspectiveForeshorten, animationClips, activeClipId, geometryDirection,
      mannequinFallback,
    );
  }
  if (effectTracks) {
    for (const effectTrack of effectTracks) {
      if (!effectTrack.visible) continue;
      const kf = effectTrack.keyframes
        ?.filter((k: any) => k.frame <= currentFrame)
        ?.sort((a: any, b: any) => b.frame - a.frame)[0];
      if (!kf) continue;
      renderEffectTrackFrame(ctx, effectTrack, kf, currentFrame, canvasWidth, canvasHeight);
    }
  }
  if (motionBlurStrokes) {
    // 动态笔触（蓝图 stroke_emitter / stroke_source 每帧求值）
    const dynamic = globalBlueprint
      ? collectDynamicStrokes(globalBlueprint, currentFrame, frameRate, buildBlueprintVars(mapStoreAnimationVariables(animationVariables), currentFrame, undefined, frameRate))
      : { motionBlur: [], effect: [] };
    const overriddenIds = new Set<string>();
    for (const s of [...dynamic.motionBlur, ...dynamic.effect]) {
      if (typeof s.sourceStrokeId === 'string') overriddenIds.add(s.sourceStrokeId);
    }
    // 静态手绘：frame <= currentFrame 且未被蓝图覆盖
    for (const stroke of motionBlurStrokes) {
      if (stroke.frame <= currentFrame && !overriddenIds.has(stroke.id)) renderMotionBlurStroke(ctx, stroke);
    }
    // 动态：全部渲染（已是当帧求值结果）
    for (const stroke of dynamic.motionBlur) renderMotionBlurStroke(ctx, stroke as any);
  }
  if (effectStrokes) {
    const dynamic = globalBlueprint
      ? collectDynamicStrokes(globalBlueprint, currentFrame, frameRate, buildBlueprintVars(mapStoreAnimationVariables(animationVariables), currentFrame, undefined, frameRate))
      : { motionBlur: [], effect: [] };
    const overriddenIds = new Set<string>();
    for (const s of [...dynamic.motionBlur, ...dynamic.effect]) {
      if (typeof s.sourceStrokeId === 'string') overriddenIds.add(s.sourceStrokeId);
    }
    for (const stroke of effectStrokes) {
      if (stroke.frame <= currentFrame && !overriddenIds.has(stroke.id)) renderEffectStroke(ctx, stroke);
    }
    for (const stroke of dynamic.effect) renderEffectStroke(ctx, stroke as any);
  }
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, currentFrame, canvasWidth, canvasHeight);
  }
}

/**
 * Render a single frame to a canvas for export/SAM (new model only).
 */
export function renderUnifiedToCanvas(
  canvasWidth: number,
  canvasHeight: number,
  _parts: Sprite[],
  keyframes: Keyframe[],
  frame: number,
  backgroundColor: string,
  effectTracks?: EffectTrack[],
  motionBlurStrokes?: MotionBlurStroke[],
  effectStrokes?: EffectStroke[],
  autoMotionBlur: boolean = false,
  autoMotionBlurIntensity: number = 0.5,
  proceduralAnimations?: ProceduralAnimation[],
  canvasModifierTracks?: CanvasModifierTrack[],
  previewQuality: 'low' | 'medium' | 'high' = 'high',
  globalModifiers?: GlobalModifier[],
  animationVariables?: StoreAnimationVariable[],
  frameRate: number = 12,
  unifiedCharacters?: Record<string, Character>,
  sprites?: Record<string, Sprite>,
  animationClips?: AnimationClip[],
  activeClipId?: string | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, frame, frameRate, undefined,
    buildBlueprintVars(mapStoreAnimationVariables(animationVariables), frame),
  );
  if (unifiedCharacters && Object.keys(unifiedCharacters).length > 0) {
    renderPuppetViaUnifiedPipeline(
      ctx, canvasWidth, canvasHeight, unifiedCharacters,
      frame, frameRate, globalModifiers, animationVariables,
      canvasModifierTracks, undefined, undefined, sprites,
      undefined, animationClips, activeClipId,
    );
  }
  if (hasGlobalTransform) ctx.restore();
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, frame, canvasWidth, canvasHeight);
  }
  return canvas;
}

/**
 * Render a single character at a specific frame for onion skin (new model).
 */
export function renderCharacterOnionFrameFromCharacter(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  character: Character,
  frame: number,
  frameRate: number,
  globalModifiers?: GlobalModifier[],
  animationVariables?: StoreAnimationVariable[],
  sprites?: Record<string, Sprite>,
  geometryDirection?: DirectionIndex,
): void {
  const unifiedVars = animationVariables?.map(v => ({
    id: v.id, name: v.name, value: v.defaultValue ?? 0, min: 0, max: 100,
    writerDriverId: (v as any).writerDriverId, defaultValue: v.defaultValue ?? 0,
  }));
  const plan = generateRenderPlan(
    character, frame, canvasWidth, canvasHeight,
    'pixel-perfect', frameRate, unifiedVars as any,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, sprites,
    undefined, undefined, undefined, geometryDirection,
  );
  executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
}

/**
 * Render multiple unified Characters to a canvas (for export).
 */
export function renderUnifiedCharactersToCanvas(
  canvasWidth: number,
  canvasHeight: number,
  characters: Character[],
  frame: number,
  backgroundColor: string,
  frameRate: number = 12,
  globalModifiers?: GlobalModifier[],
  animationVariables?: StoreAnimationVariable[],
  canvasModifierTracks?: CanvasModifierTrack[],
  sprites?: Record<string, Sprite>,
  animationClips?: AnimationClip[],
  activeClipId?: string | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;
  if (backgroundColor && backgroundColor !== 'rgba(0,0,0,0)') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, frame, frameRate, undefined,
    buildBlueprintVars(mapStoreAnimationVariables(animationVariables), frame),
  );
  for (const character of characters) {
    const unifiedVars = mapStoreAnimationVariables(animationVariables);
    const plan = generateRenderPlan(
      character, frame, canvasWidth, canvasHeight,
      'pixel-perfect', frameRate, unifiedVars,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, sprites,
      undefined, undefined,
      pickClipStateKeyframes(animationClips, activeClipId, character.id, frame),
    );
    executeRenderPlan(ctx, plan, canvasWidth, canvasHeight);
  }
  if (hasGlobalTransform) ctx.restore();
  if (canvasModifierTracks && canvasModifierTracks.length > 0) {
    applyCanvasModifiers(ctx, canvasModifierTracks, frame, canvasWidth, canvasHeight);
  }
  return canvas;
}

/**
 * Render a single Sprite centered on canvas for sprite editing.
 */
export function renderSpriteEditUnified(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  spriteEditModifiers: any[],
  canvasWidth: number,
  canvasHeight: number,
  currentFrame: number = 0,
  sprites?: Record<string, Sprite>,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const centerX = Math.floor((canvasWidth - sprite.width) / 2);
  const centerY = Math.floor((canvasHeight - sprite.height) / 2);
  const resolvedMods = (spriteEditModifiers.some(m =>
    (m.paramKeyframes && m.paramKeyframes.length > 0) ||
    (m.paramDrivers && m.paramDrivers.length > 0 && m.paramDrivers.some((d: any) => d.enabled && !d.isBaked))
  ))
    ? resolveKeyframeModifierParams(spriteEditModifiers, currentFrame)
    : spriteEditModifiers;
  const pixelModTypes = [
    'color_replace', 'outline', 'dither', 'pixel_displace',
    'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
  ];
  const activePixelMods = resolvedMods.filter(m => pixelModTypes.includes(m.type) && m.enabled);
  let pixels: import('./unified-types').PixelGrid;
  let modOffsetX = 0, modOffsetY = 0;
  if (activePixelMods.length > 0) {
    const modResult = applyPixelModifiers(sprite.data, activePixelMods, currentFrame);
    pixels = modResult.pixels;
    modOffsetX = modResult.offsetX;
    modOffsetY = modResult.offsetY;
  } else {
    pixels = sprite.data;
  }
  const translateMod = resolvedMods.find(m => m.type === 'translate' && m.enabled);
  let shiftX = 0, shiftY = 0;
  if (translateMod) {
    shiftX = Math.round(Number(translateMod.params.offsetX) || 0);
    shiftY = Math.round(Number(translateMod.params.offsetY) || 0);
  }
  const gridH = pixels.length;
  const gridW = pixels[0]?.length || 0;
  const originX = centerX - modOffsetX;
  const originY = centerY - modOffsetY;
  ctx.imageSmoothingEnabled = false;
  const spriteCanvas = pixelsToCanvas(pixels, gridW, gridH);
  if (spriteCanvas) ctx.drawImage(spriteCanvas, originX + shiftX, originY + shiftY);
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(centerX - 0.5, centerY - 0.5, sprite.width + 1, sprite.height + 1);
  ctx.strokeStyle = 'rgba(255, 200, 50, 0.5)';
  ctx.lineWidth = 1;
  const pivotScreenX = centerX + (sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2);
  const pivotScreenY = centerY + (sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2);
  ctx.beginPath();
  ctx.moveTo(pivotScreenX - 4, pivotScreenY);
  ctx.lineTo(pivotScreenX + 4, pivotScreenY);
  ctx.moveTo(pivotScreenX, pivotScreenY - 4);
  ctx.lineTo(pivotScreenX, pivotScreenY + 4);
  ctx.stroke();
}
