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
  IKChain, Mat3, ParentKeyValue, SpriteStack, ClampAnchor, ClampTrigger,
} from './unified-types';
import {
  subToPx, halfPixelAlignSub, DEFAULT_MIRROR_MAP, projectToView, rotateInViewPlane,
  directionTrig,
  resolveChainTarget3D,
  mat3Mul, mat3Transpose, mat3Apply, localRotMat, rotMatD, rotMatY, applyFrameRotation, frameViewAngle,
  frameViewAngleForDirection, frameYAxisWorld,
  worldToViewBasis, MAT3_IDENTITY, nodeJointDiscDiameter, mapDragTo3D,
} from './unified-types';
import { solveIK2Bone3D, solveIK3Bone3D, solveIK3BoneWithTip3D, solveIKFabrik3D } from './blueprint/ik';
import { DEFAULT_FACE_FEATURES, faceFeaturePoints, faceHalfWidths } from './face-features';
import { slashFrameCanvas, slashFrameLayout } from './slash-fan';
import { resolveClipSlash } from './slash-defs';
import type { SlashDefinition } from './unified-types';
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
  applyBrushCommandsToGrid,
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
import { computeProceduralPoseDelta, type ProceduralPoseDelta } from './engine/procedural';
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
import { computeStackOps, rasterizeStackOps, rasterizeStackOpsData, STACK_VIEW_ELEVATION_DEG, type StackBend } from './stack-render';

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

/** 收集角色全部节点修改器上启用的参数驱动器（变量上下文构建用：
 * generateRenderPlan 与 computeWorldTransforms 的变量兜底共用一份口径） */
export function collectActiveParamDrivers(character: Character): ParamDriver[] {
  const drivers: ParamDriver[] = [];
  for (const node of Object.values(character.nodes)) {
    for (const mod of node.modifiers ?? []) {
      for (const d of mod.paramDrivers ?? []) {
        if (d.enabled) drivers.push(d);
      }
    }
  }
  return drivers;
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
  clampCtx?: ClampContext,
  simCtx?: SimContext,
  // 程序化位姿增量图（generateRenderPlan 预备段按命中口径汇总；不传
  // 则全程零变化）。增量叠在每个节点的最终世界变换上（见根/子合成
  // 点），子节点与关节盘读同一张表、天然跟随。
  procDeltas?: ReadonlyMap<string, ProceduralPoseDelta>,
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
  // 变量上下文兜底：调用方没传 variableContext 时按主渲染同口径
  // 现建（动画变量取工程 store、驱动器收集与 generateRenderPlan
  // 共用一份）——否则变量驱动的关键帧/修改器/蓝图/IK 目标在
  // 覆盖层、命中里按默认值算，与出图对不上。离线语境 store 不
  // 可用时保持未传（烘焙/导出走 generateRenderPlan 显式传，不受影响）。
  if (!variableContext) {
    try {
      const { useProjectStore } = require('./store') as typeof import('./store');
      const storeVars = useProjectStore.getState().animationVariables;
      if (storeVars && storeVars.length > 0) {
        const mapped = mapStoreAnimationVariables(storeVars);
        if (mapped && mapped.length > 0) {
          variableContext = buildVariableContext(mapped, frame, collectActiveParamDrivers(character), frameRate);
        }
      }
    } catch { /* store 不可用（离线语境）时保持未传 */ }
  }
  // 蓝图/修改器求值兜底：调用方没传 blueprintTransforms 时在此求值，
  // 让所有取位路径（覆盖层标签/命中/IK 手柄/五官叠画/捕姿）与主渲染
  // 同源。转位克隆的 rotate 修改器只活在这份求值结果里——缺了它，
  // 克隆体在覆盖层与命中里停在原位（精灵却已经转过去了）。主渲染
  // （generateRenderPlan）总是显式传入（含编辑中未保存图的覆写），
  // 不走此兜底、语义不变。
  if (!blueprintTransforms) {
    const hasBp = Object.values(character.nodes).some(
      (n) => (n as any).blueprint || (n.modifiers?.length ?? 0) > 0,
    );
    if (hasBp) {
      blueprintTransforms = evaluateBlueprintTransforms(
        character, frame, frameRate, variableContext?.values,
      );
    }
  }
  const transforms = new Map<string, WorldTransform>();

  const rootNode = character.nodes[character.rootNodeId];
  if (!rootNode) return transforms;

  // 行为层在此统一求值：任何调用方（出图/点选/枢轴/覆盖层）都同源
  const behaviorTransforms = character.behaviorGraphs && Object.keys(character.behaviorGraphs).length > 0
    ? evaluateBehaviorTransforms(character, frame, frameRate, variableContext?.values)
    : undefined;

  // Root node: center of canvas + node's own offset
  const rootInterpolated = interpolateTransform(rootNode, frame, frameRate, variableContext, blueprintTransforms, ikOverrides, behaviorTransforms?.get(rootNode.id), simCtx?.angleDeltas);
  // 程序化增量（根）：叠在最终世界变换上——平移是画布系增量，按根
  // 朝向经 mapDragTo3D 换算到世界轴；frame 左乘视平面旋转 rotMatD
  // （frameViewAngle 恰好 +rotDeg，与旧指令层 angle 加法同值）；缩放
  // 乘 worldStretch/scaleX 两通道（这两通道是节点自身量、不沿层级
  // 累乘，与旧指令层落点一致）。无增量时各字段逐位不变。
  const rootDelta = procDeltas?.get(rootNode.id);
  const rootDelta3 = rootDelta && (rootDelta.dx !== 0 || rootDelta.dy !== 0)
    ? mapDragTo3D(pxToSub(rootDelta.dx) as SubPixel, pxToSub(rootDelta.dy) as SubPixel, rootInterpolated.variantIndex)
    : undefined;
  const rootFrame = rootDelta && rootDelta.rotDeg !== 0
    ? mat3Mul(rotMatD(rootDelta.rotDeg), localRotMat(rootInterpolated.angle, rootInterpolated.tilt ?? 0))
    : localRotMat(rootInterpolated.angle, rootInterpolated.tilt ?? 0);
  const rootWorld: WorldTransform = {
    nodeId: rootNode.id,
    // 3D 世界坐标以原点为中心，不含画布中心（画布中心在投影后 2D 阶段加）
    worldX: (rootInterpolated.x + (clampCtx?.rootOffset ? pxToSub(clampCtx.rootOffset.x) : 0) + (rootDelta3?.dx3 ?? 0)) as SubPixel,
    worldY: (rootInterpolated.y + (clampCtx?.rootOffset ? pxToSub(clampCtx.rootOffset.y) : 0) + (rootDelta3?.dy3 ?? 0)) as SubPixel,
    worldZ: ((rootInterpolated.z ?? 0) + (clampCtx?.rootOffset ? pxToSub(clampCtx.rootOffset.z) : 0) + (rootDelta3?.dz3 ?? 0)) as SubPixel,
    worldAngle: geometryDirection !== undefined
      ? frameViewAngleForDirection(rootFrame, geometryDirection, rootInterpolated.variantIndex)
      : frameViewAngle(rootFrame),
    worldFrame: rootFrame,
    worldStretch: rootDelta ? rootInterpolated.stretch * rootDelta.scaleMul : rootInterpolated.stretch,
    variantIndex: rootInterpolated.variantIndex,
    mirror: false,
    scaleX: rootDelta && rootDelta.scaleMul !== 1 ? (rootInterpolated.scaleX ?? 1) * rootDelta.scaleMul : rootInterpolated.scaleX,
    skewX: rootInterpolated.skewX,
    skewY: rootInterpolated.skewY,
  };
  transforms.set(rootNode.id, rootWorld);

  // Recursively compute children
  computeChildTransforms(rootNode, rootWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms, ikOverrides, geometryDirection, behaviorTransforms, simCtx?.angleDeltas, procDeltas, rootInterpolated.variantIndex);

  // 钳制锚定收尾（仅最外层调用执行；IK 重算遍与 resettle 的内层调用跳过）：
  // 刚性反移 + 节点局部旋转就地施加在结算结果上；resettle 开时以累进
  // 根偏移整树重算一遍（链目标仍是世界量），再以冻结位兜底施加。
  const finishWithClamps = (t: Map<string, WorldTransform>): Map<string, WorldTransform> => {
    if (!clampCtx || ikOverrides || !character.clampAnchors || character.clampAnchors.length === 0) return t;
    const res = applyClampPass(character, t, clampCtx.frozen, clampCtx.sprites, geometryDirection);
    // resettle 最多两遍重算：第二遍用第一遍已解 frame 换算尖端目标，
    // 把关节落位残差压到二阶小量（末遍收尾 Δ 刚性兜底）。
    if (res.resettleWanted && (clampCtx.resettleDepth ?? 0) < 2) {
      const ctx2: ClampContext = {
        frozen: clampCtx.frozen,
        sprites: clampCtx.sprites,
        resettleDepth: (clampCtx.resettleDepth ?? 0) + 1,
        resettleRefTransforms: t,
        rootOffset: {
          x: (clampCtx.rootOffset?.x ?? 0) + res.delta.x,
          y: (clampCtx.rootOffset?.y ?? 0) + res.delta.y,
          z: (clampCtx.rootOffset?.z ?? 0) + res.delta.z,
        },
      };
      return computeWorldTransforms(character, frame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms, undefined, geometryDirection, ctx2, simCtx, procDeltas);
    }
    return t;
  };

  // IK（乙：真 3D）：首遍 FK 后解出各链关节的局部 (angle, tilt) 覆写，整树重算 FK——
  // 链外后代随 frame 复合自动跟随。ikOverrides 已传入时（重算遍）不再求解。
  if (!ikOverrides) {
    if (character.ikBlueprint) {
      applyBakedIKBlueprint(character, transforms, variableContext?.values, frame, frameRate);
      return finishWithClamps(transforms);
    }
    const chains = character.ikChains?.filter((c) => c.enabled && !isIKChainSuspended(c.id));
    if (chains && chains.length > 0) {
      const overrides = new Map<string, { angle: number; tilt: number }>();
      for (const chain of chains) {
        const effChain = clampCtx?.resettleDepth ? resettleChainOverride(character, chain, clampCtx.frozen, clampCtx.resettleRefTransforms ?? transforms, clampCtx.sprites) : chain;
        solveChainIKOverrides(character, effChain, transforms, canvasWidth, canvasHeight, frame, frameRate, variableContext, blueprintTransforms, overrides, geometryDirection);
      }
      if (overrides.size > 0) {
        const t2 = computeWorldTransforms(character, frame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms, overrides, geometryDirection, clampCtx, simCtx, procDeltas);
        return finishWithClamps(t2);
      }
    }
  }

  return finishWithClamps(transforms);
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

/** 为一条链在首遍 FK（transforms）上求解各关节的局部 (angle, tilt) 覆写，写入 overrides。
 * 导出供草图捕姿烘焙复用（与渲染路径同一求解口径）。 */
export function solveChainIKOverrides(
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
  // 尖端长覆写：传入（含 0）则跳过缺省解析链、按此值定尖端；
  // 0 = 无尖端、目标直接落在末端关节上（草图捕姿的落点语义）。
  // 渲染路径不传，行为不变。
  tipLengthOverride?: number,
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
  // 尖端长口径：覆写值 > 链上显式值 > 末关节当前精灵（服装解析） > 旧 node.sprite > 末段骨长
  let tipLength: number;
  if (tipLengthOverride !== undefined) {
    tipLength = tipLengthOverride;
  } else {
    tipLength = chain.tipLength ?? 0;
    if (tipLength <= 0) {
      tipLength = resolveSpriteTipLength(
        character, chain.endNodeId,
        geometryDirection ?? fkT[n - 1].variantIndex,
        storeGlobalSprites(),
      ) ?? 0;
    }
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
  }
  const points: V3[] = [...pos];
  const hasTip = tipLength > 1e-6;
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

  // 位置求解：策略按实际段数自动匹配（定案）——显式 fabrik 声明优先；
  // 否则 2 段解析 2 骨、3 段解析 3 骨、4 段且末段为尖端时剥尖端走 3 骨，
  // 解析不可解的退化构型与其余长链回落 FABRIK。
  let solved: V3[];
  if (chain.solver !== 'fabrik' && lengths.length >= 2) {
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
    if (lengths.length === 2) {
      const r = solveIK2Bone3D(points[0], target, lengths[0], lengths[1], pole);
      solved = [points[0], r.mid, r.end];
    } else if (lengths.length === 3) {
      const r3 = solveIK3Bone3D(points[0], target, lengths[0], lengths[1], lengths[2], pole, { p1: points[1], p2: points[2], p3: points[3] });
      solved = r3
        ? [points[0], r3.p1, r3.p2, r3.end]
        : solveIKFabrik3D(points, lengths, target);
    } else if (lengths.length === 4 && hasTip) {
      solved = solveIK3BoneWithTip3D(points, lengths, target, pole)
        ?? solveIKFabrik3D(points, lengths, target);
    } else {
      solved = solveIKFabrik3D(points, lengths, target);
    }
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
  simDeltas?: ReadonlyMap<string, number>,
  // 程序化位姿增量图 + 本遍投影朝向（根 variant，与 generateRenderPlan
  // 指令投影的 currentDirection 同值）：增量叠在子节点最终世界变换上，
  // 递归时父级读到的已是叠加后的变换、整棵子树天然继承。
  procDeltas?: ReadonlyMap<string, ProceduralPoseDelta>,
  procViewDirection?: DirectionIndex,
): void {
  for (const childId of parentNode.children) {
    const childNode = character.nodes[childId];
    if (!childNode) continue;

    const childInterpolated = interpolateTransform(childNode, frame, frameRate, variableContext, blueprintTransforms, ikOverrides, behaviorTransforms?.get(childId), simDeltas);
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

    // 程序化增量（子）：与根同一落法叠在最终世界变换上——位置按投影
    // 朝向经 mapDragTo3D 换算到世界轴（加在已合成的位置上、画布系
    // 不随父 frame 旋转，与旧指令层加法同义）；frame 左乘视平面旋转
    // （worldAngle 恰好 +rotDeg）；缩放乘自身两通道。父级增量已在本
    // 节点的位置/frame 合成里（parentWorld 是叠加后的变换），此处只
    // 叠本节点自己的增量。无增量时各字段逐位不变。
    const childDelta = procDeltas?.get(childId);
    let childFrameFinal = childFrame;
    let childStretch = childInterpolated.stretch;
    let childScaleX = childInterpolated.scaleX;
    if (childDelta && (childDelta.dx !== 0 || childDelta.dy !== 0 || childDelta.rotDeg !== 0 || childDelta.scaleMul !== 1)) {
      if (childDelta.dx !== 0 || childDelta.dy !== 0) {
        const d3 = mapDragTo3D(pxToSub(childDelta.dx) as SubPixel, pxToSub(childDelta.dy) as SubPixel, procViewDirection ?? childInterpolated.variantIndex);
        childWorldX = (childWorldX + d3.dx3) as SubPixel;
        childWorldY = (childWorldY + d3.dy3) as SubPixel;
        childWorldZ = (childWorldZ + d3.dz3) as SubPixel;
      }
      if (childDelta.rotDeg !== 0) {
        childFrameFinal = mat3Mul(rotMatD(childDelta.rotDeg), childFrame);
      }
      childStretch = childInterpolated.stretch * childDelta.scaleMul;
      if (childDelta.scaleMul !== 1) {
        childScaleX = (childInterpolated.scaleX ?? 1) * childDelta.scaleMul;
      }
    }

    const childWorld: WorldTransform = {
      nodeId: childId,
      worldX: childWorldX,
      worldY: childWorldY,
      worldZ: childWorldZ,
      worldAngle: geometryDirection !== undefined
        ? frameViewAngleForDirection(childFrameFinal, geometryDirection, childInterpolated.variantIndex)
        : frameViewAngle(childFrameFinal),
      worldFrame: childFrameFinal,
      worldStretch: childStretch,
      variantIndex: childInterpolated.variantIndex,
      mirror: childMirror,
      scaleX: childScaleX,
      skewX: childInterpolated.skewX,
      skewY: childInterpolated.skewY,
    };
    transforms.set(childId, childWorld);

    // Recurse into children
    computeChildTransforms(childNode, childWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms, ikOverrides, geometryDirection, behaviorTransforms, simDeltas, procDeltas, procViewDirection);
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
  simDeltas?: ReadonlyMap<string, number>,
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
  const r2 = ov ? { ...r, angle: ov.angle, tilt: ov.tilt } : r;
  // 实时模拟角增量：叠加在当帧结算角之上（会话层已步进并折算）
  const sd = simDeltas?.get(node.id);
  return sd ? { ...r2, angle: r2.angle + sd } : r2;
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
  // 件键与产品通行口径一致（参数化分支/堆叠回退/convert/写侧同）：有槽位
  // 定义用 slotKey，无槽位定义的节点（向导/手动加节点、Spine 导入——写侧
  // 一律以节点 id 为键）回退 node.id。此前本支独缺回退且以 node.slot 存在
  // 为门，无 slot 节点写入的件永远读不到、画布只剩兜底胶囊。
  if (costumeSet) {
    const piece = costumeSet.pieces[node.slot?.slotKey ?? node.id];
    return resolvePieceSprite(piece, direction, variantId, sprites, latitude);
  }
  return { sprite: null, mirror: false, spriteId: null };
}

/**
 * Resolve the sprite ID for a node's current sprite (same logic as render).
 * Returns null when the sprite is embedded (no table ID) or missing.
 * Used by UI (e.g. heightmap editor) to write back to the global sprites table.
 */
/**
 * IK 尖端长（缺省解析）：末关节「当前精灵」的 Y 轴长度（plug 到底端）。
 * 走 resolveNodeSpriteId 按服装/变体/纬度解析现行精灵——旧实现直读
 * node.sprite（现行管线从不赋值）导致尖端长恒回退末段骨长。
 * 解析不到返回 undefined，调用方走各自回退（旧字段/末段长）。
 */
export function resolveSpriteTipLength(
  character: import('./unified-types').Character,
  endNodeId: string,
  direction: DirectionIndex,
  globalSprites?: Record<string, import('./unified-types').Sprite>,
): number | undefined {
  // 先按传入精灵表解析；查无此精灵时再按角色自带表解析（离线语境下
  // 全局表可能是空表，不能让它遮住角色自带表）
  const lookup = (table?: Record<string, import('./unified-types').Sprite>) => {
    const effective = table ?? character.sprites;
    const spriteId = resolveNodeSpriteId(character, endNodeId, direction, table);
    const sprite = spriteId ? effective?.[spriteId] : undefined;
    return sprite && sprite.height > 0 ? sprite : undefined;
  };
  const sprite = lookup(globalSprites) ?? lookup(character.sprites);
  if (!sprite) return undefined;
  const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  return Math.max(1, sprite.height - plugY);
}

/** 离线/渲染语境下惰性取工程全局精灵表（与帧率回退同一模式） */
function storeGlobalSprites(): Record<string, import('./unified-types').Sprite> | undefined {
  try {
    const { useProjectStore } = require('./store') as typeof import('./store');
    return useProjectStore.getState().sprites;
  } catch {
    return undefined;
  }
}

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
  const { spriteId } = resolveSprite(node, direction, activeCs, spriteTable, character.slotVariants?.[node.slot?.slotKey ?? node.id], character.latitude ?? 0);
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
    const resolved = resolveSprite(node, currentDirection, activeCostumeSet, spriteTable, character.slotVariants?.[node.slot?.slotKey ?? node.id], character.latitude ?? 0);
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
      nodeId,
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
 * 的关节点集同构。半径：关节盘有效直径/2（nodeJointDiscDiameter，
 * 与面板显示同口径），无盘数据时按段长 16% 估算（钳 1.5–16px，借
 * PoseSketcher 胶囊半径相对标尺的口径，标尺换成本段长）。被蒙皮
 * 快照认领的父节点（claimedParents）精灵已并入子节点合并图，不算
 * 无精灵、跳过。
 */
/** 肢体类别（衣物色区用）：沿父链上溯节点名，先命中者胜（近者优先） */
const MQ_ARM_KEYS = ['arm', 'shoulder', 'wrist', 'hand', '袖', '臂', '肩', '腕', '手'];
const MQ_LEG_KEYS = ['leg', 'thigh', 'hip', 'shin', 'calf', 'ankle', 'foot', '腿', '髋', '踝', '脚'];
export function mannequinLimbKind(character: Character, node: Node): 'arm' | 'leg' | null {
  let cur: Node | undefined = node;
  while (cur) {
    const name = cur.name.toLowerCase();
    if (MQ_LEG_KEYS.some((k) => name.includes(k))) return 'leg';
    if (MQ_ARM_KEYS.some((k) => name.includes(k))) return 'arm';
    cur = cur.parentId ? character.nodes[cur.parentId] : undefined;
  }
  return null;
}

/** 人偶兜底的形状几何（画布 px）：指令生成与编辑器命中共用一份——
 * 画出来的胶囊就是点得中的胶囊，不另算第二套。 */
export interface MannequinShape {
  nodeId: string;
  kind: 'segment' | 'hand' | 'foot' | 'thumb' | 'head' | 'joint';
  /** 段端点（画布 px）；head 时为颈段，判定走 head 椭圆；
   * joint 时 x1=x2=本关节、r1=r2=本关节半径（退化段） */
  x1: number; y1: number; x2: number; y2: number;
  r1: number; r2: number;
  /** segment 的远端节点（段 = nodeId 关节 → toNodeId 关节） */
  toNodeId?: string;
  head?: { cx: number; cy: number; a: number; b: number; angleRad: number };
}

function mannequinShapesInternal(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
  canvasWidth: number,
  canvasHeight: number,
  currentDirection: DirectionIndex,
  eligibleNodeIds: ReadonlySet<string>,
  geometryDirection?: DirectionIndex,
): MannequinShape[] {
  const shapes: MannequinShape[] = [];
  const centerSubX = pxToSub(canvasWidth / 2);
  const centerSubY = pxToSub(canvasHeight / 2);
  const project = (wx: SubPixel, wy: SubPixel, wz: SubPixel) => {
    const p = projectToView(wx, wy, wz, currentDirection);
    return {
      x: (centerSubX + (p.canvasX as SubPixel)) as SubPixel,
      y: (centerSubY + (p.canvasY as SubPixel)) as SubPixel,
    };
  };
  // 节点 frame 的 +Y 轴在画布上的单位方向（投影后）：末端节点自身的
  // 旋转只存在于 frame 里（不改变任何关节位置），手脚延伸与蛋形头
  // 必须读它才跟着转——与 IK 尖端口径 frameYAxisWorld 同源同法。
  // 投影后近零（骨正对镜头）返回 null，调用方回退段方向。
  const frameDirCanvas = (nodeId: string): { x: number; y: number } | null => {
    const wt = worldTransforms.get(nodeId);
    if (!wt) return null;
    const yAxis = frameYAxisWorld(wt.worldFrame, geometryDirection ?? wt.variantIndex);
    const p0 = project(wt.worldX, wt.worldY, wt.worldZ);
    const p1 = project(
      (wt.worldX + pxToSub(yAxis.x)) as SubPixel,
      (wt.worldY + pxToSub(yAxis.y)) as SubPixel,
      (wt.worldZ + pxToSub(yAxis.z)) as SubPixel,
    );
    const dx = subToPx(p1.x) - subToPx(p0.x), dy = subToPx(p1.y) - subToPx(p0.y);
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return null;
    return { x: dx / len, y: dy / len };
  };

  // 第一遍：各节点的关节位置与连接点（起点）
  const joints = new Map<string, { sx: SubPixel; sy: SubPixel; ex: SubPixel; ey: SubPixel }>();
  for (const nodeId of eligibleNodeIds) {
    const node = character.nodes[nodeId];
    if (!node) continue;
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

  // 半径：关节盘有效直径/2（与 RigPanel 显示同口径 nodeJointDiscDiameter：
  // jointWidth 手动值 > plug 截面 > bottom 截面），无数据才按本段长
  // 估算（根节点无段长 → 5px）。此前只认 jointWidth——截面定的盘径
  // 改了胶囊不跟。lenHintPx 供非 eligible 的子节点用（其入段长度
  // 就是当前这条出段的长度、同口径）。
  const radiusOf = (nodeId: string, lenHintPx?: number): number => {
    const node = character.nodes[nodeId];
    const discD = node ? nodeJointDiscDiameter(node) : null;
    if (discD !== null) return discD / 2;
    const j = joints.get(nodeId);
    const lenPx = j
      ? Math.hypot(subToPx(j.ex) - subToPx(j.sx), subToPx(j.ey) - subToPx(j.sy))
      : (lenHintPx ?? 0);
    if (lenPx <= 0.01) return 5;
    return Math.min(16, Math.max(1.5, lenPx * 0.16));
  };

  // 归属口径（与精灵属主对齐）：一段身体属于它起始的那个关节的节点——
  // 精灵挂在本关节、覆盖本关节→子关节这一段，胶囊同理。故段形状记在
  // 父侧节点名下（段 = 本关节 → 子关节），另给每个节点一个自关节的
  // joint 形状，让关节点本身点中的是它自己而非父段的末端。
  const posPxOf = (nodeId: string): { x: number; y: number } | null => {
    const wt = worldTransforms.get(nodeId);
    if (!wt) return null;
    const p = project(wt.worldX, wt.worldY, wt.worldZ);
    return { x: subToPx(p.x), y: subToPx(p.y) };
  };
  const childrenOf = new Map<string, string[]>();
  for (const n of Object.values(character.nodes)) {
    if (!n.parentId) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }
  for (const nodeId of joints.keys()) {
    const own = posPxOf(nodeId);
    if (!own) continue;
    const rOwn = radiusOf(nodeId);
    shapes.push({
      nodeId, kind: 'joint',
      x1: own.x, y1: own.y, x2: own.x, y2: own.y,
      r1: rOwn, r2: rOwn,
    });
    for (const childId of childrenOf.get(nodeId) ?? []) {
      const childNode = character.nodes[childId];
      if (!childNode || childNode.visible === false) continue;
      const cp = posPxOf(childId);
      if (!cp) continue;
      const segLen = Math.hypot(cp.x - own.x, cp.y - own.y);
      shapes.push({
        nodeId, kind: 'segment', toNodeId: childId,
        x1: own.x, y1: own.y, x2: cp.x, y2: cp.y,
        r1: rOwn, r2: radiusOf(childId, segLen),
      });
    }
  }

  // 手脚延伸（借 PoseSketcher 口径）：肢体末端叶子关节（腕/踝）的胶囊
  // 沿末端节点 frame 方向再伸一段——手掌自腕伸末段长 ×(0.16/0.44)、脚掌自踝伸
  // 末段长 ×(0.15/0.45)（原项目腕 0.84/踝 0.85 切分换算到末段占比），
  // 末端半径收至 0.64 倍；手另补拇指支段（自腕起：沿手向 0.3 倍手长
  // + 法向 0.4 倍手长，侧别沿父链名字判左右、判不出取 +1，同原项目
  // 侧面口径）。手指/脚趾/拇指命名的叶子不延伸，
  // 免得烘焙骨骼的指节末端冒出手掌。非叶子（其后还有节点）不延伸。
  // 肢类按节点自身名字判（不沿父链继承）：手掌/拇指是手本节点的
  // 形状——挂在手上的子节点（手指/武器之类）末端不该冒出手掌和
  // 拇指；拇指归手本位，手挂了子节点后延伸撤下、拇指仍画在手
  // 关节处（下方第二遍单独补，2026-10-28 用户裁决）。
  const EXTREMITY_EXCLUDE = ['finger', 'thumb', 'toe', 'index', 'middle', 'ring', 'pinky', '指', '趾'];
  const ownLimbKind = (node: Node): 'arm' | 'leg' | null => {
    const name = node.name.toLowerCase();
    if (MQ_LEG_KEYS.some((k) => name.includes(k))) return 'leg';
    if (MQ_ARM_KEYS.some((k) => name.includes(k))) return 'arm';
    return null;
  };
  const pushThumb = (nodeId: string, node: Node, ex: number, ey: number, ux: number, uy: number, extLen: number, r: number) => {
    let side = 1;
    let cur: Node | undefined = node;
    while (cur) {
      const n = cur.name.toLowerCase();
      if (n.includes('left') || n.includes('_l') || n.includes('左')) { side = -1; break; }
      if (n.includes('right') || n.includes('_r') || n.includes('右')) { side = 1; break; }
      cur = cur.parentId ? character.nodes[cur.parentId] : undefined;
    }
    const nx = -uy, ny = ux;
    shapes.push({
      nodeId, kind: 'thumb',
      x1: ex, y1: ey,
      x2: ex + ux * extLen * 0.3 + nx * side * extLen * 0.4,
      y2: ey + uy * extLen * 0.3 + ny * side * extLen * 0.4,
      r1: r * 0.8, r2: r * 0.45,
    });
  };
  const hasChildNode = new Set<string>();
  for (const n of Object.values(character.nodes)) if (n.parentId) hasChildNode.add(n.parentId);
  for (const [nodeId, j] of joints) {
    if (hasChildNode.has(nodeId)) continue;
    const node = character.nodes[nodeId]!;
    if (EXTREMITY_EXCLUDE.some((k) => node.name.toLowerCase().includes(k))) continue;
    const kind = ownLimbKind(node);
    if (!kind) continue;
    const sx = subToPx(j.sx), sy = subToPx(j.sy);
    const ex = subToPx(j.ex), ey = subToPx(j.ey);
    const segLen = Math.hypot(ex - sx, ey - sy);
    if (segLen < 2) continue;
    // 延伸方向 = 末端节点 frame 的 +Y（与 IK 尖端同一朝向）：腕/踝
    // 节点自身旋转时手脚跟着转；段方向（父关节→本关节）只作回退
    const segDir = { x: (ex - sx) / segLen, y: (ey - sy) / segLen };
    const dirF = frameDirCanvas(nodeId) ?? segDir;
    const ux = dirF.x, uy = dirF.y;
    const r = radiusOf(nodeId);
    const extLen = kind === 'arm' ? segLen * (0.16 / 0.44) : segLen * (0.15 / 0.45);
    shapes.push({
      nodeId, kind: kind === 'arm' ? 'hand' : 'foot',
      x1: ex, y1: ey,
      x2: ex + ux * extLen, y2: ey + uy * extLen,
      r1: r, r2: r * 0.64,
    });
  }
  // 拇指归手本位：画在腕/手本节点的关节处——该节点挂了子节点
  // （手指/武器）后不再是叶子、手掌延伸撤下，拇指仍留原位；子节
  // 点末端不画。判据只认手部关键词（腕/手/wrist/hand，上臂/前臂
  // 不是手本位、不画）；手指命名的先被 EXTREMITY_EXCLUDE 排除
  // （「手指」含「手」也照此办理）。
  const HAND_KEYS = ['wrist', 'hand', '腕', '手'];
  for (const [nodeId, j] of joints) {
    const node = character.nodes[nodeId]!;
    if (EXTREMITY_EXCLUDE.some((k) => node.name.toLowerCase().includes(k))) continue;
    if (!HAND_KEYS.some((k) => node.name.toLowerCase().includes(k))) continue;
    const sx = subToPx(j.sx), sy = subToPx(j.sy);
    const ex = subToPx(j.ex), ey = subToPx(j.ey);
    const segLen = Math.hypot(ex - sx, ey - sy);
    if (segLen < 2) continue;
    const segDir = { x: (ex - sx) / segLen, y: (ey - sy) / segLen };
    const dirF = frameDirCanvas(nodeId) ?? segDir;
    pushThumb(nodeId, node, ex, ey, dirF.x, dirF.y, segLen * (0.16 / 0.44), radiusOf(nodeId));
  }

  // 蛋形头（借 PoseSketcher 头蛋形）：头部节点的颈→头段上再挂一个蛋
  // 形——中心 = 头关节，长半轴 = 颈段长一半（头中心→颈上恰半个头
  // 高），宽半轴 = 长 ×0.7，长轴沿父关节→头关节方向；颈段退化时
  // 朝上、长半轴按关节半径估。
  for (const [nodeId, j] of joints) {
    const node = character.nodes[nodeId]!;
    const lname = node.name.toLowerCase();
    if (!lname.includes('head') && !lname.includes('头')) continue;
    const sx = subToPx(j.sx), sy = subToPx(j.sy);
    const ex = subToPx(j.ex), ey = subToPx(j.ey);
    const segLen = Math.hypot(ex - sx, ey - sy);
    let ax = 0, ay = -1;
    if (segLen > 0.5) { ax = (ex - sx) / segLen; ay = (ey - sy) / segLen; }
    // 长轴跟头节点 frame 转（点头/歪头都跟）：frame +Y 定轴向，
    // 段方向只用来定号——保证轴指向冠侧、五官不上下颠倒
    const fDir = frameDirCanvas(nodeId);
    if (fDir) {
      ax = fDir.x; ay = fDir.y;
      if (segLen > 0.5) {
        const segX = (ex - sx) / segLen, segY = (ey - sy) / segLen;
        if (ax * segX + ay * segY < 0) { ax = -ax; ay = -ay; }
      }
    }
    const a = Math.max(segLen / 2, radiusOf(nodeId) * 1.8, 5);
    const b = a * 0.7;
    shapes.push({
      nodeId, kind: 'head',
      x1: sx, y1: sy, x2: ex, y2: ey,
      r1: radiusOf(nodeId), r2: radiusOf(nodeId),
      head: { cx: ex, cy: ey, a, b, angleRad: Math.atan2(ay, ax) },
    });
  }
  return shapes;
}

/** 人偶形状几何（公开口径）：eligibleNodeIds 决定哪些节点出形状。 */
export function computeMannequinShapes(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
  canvasWidth: number,
  canvasHeight: number,
  currentDirection: DirectionIndex,
  eligibleNodeIds: ReadonlySet<string>,
  geometryDirection?: DirectionIndex,
): MannequinShape[] {
  return mannequinShapesInternal(character, worldTransforms, canvasWidth, canvasHeight, currentDirection, eligibleNodeIds, geometryDirection);
}

function generateMannequinInstructions(
  character: Character,
  worldTransforms: Map<string, WorldTransform>,
  canvasWidth: number,
  canvasHeight: number,
  currentDirection: DirectionIndex,
  instructedNodeIds: ReadonlySet<string>,
  claimedParents: ReadonlySet<string>,
  clothing: { sleeveRatio: number; pantsRatio: number },
  faceGuide?: boolean,
  geometryDirection?: DirectionIndex,
): MannequinRenderInstruction[] {
  const out: MannequinRenderInstruction[] = [];
  const eligible = new Set<string>();
  for (const [nodeId, node] of Object.entries(character.nodes)) {
    if (!node.visible) continue;
    if (instructedNodeIds.has(nodeId) || claimedParents.has(nodeId)) continue;
    if (!worldTransforms.has(nodeId)) continue;
    eligible.add(nodeId);
  }
  const shapes = mannequinShapesInternal(character, worldTransforms, canvasWidth, canvasHeight, currentDirection, eligible, geometryDirection);

  const centerSubX = pxToSub(canvasWidth / 2);
  const centerSubY = pxToSub(canvasHeight / 2);
  const project = (wx: SubPixel, wy: SubPixel, wz: SubPixel) => {
    const p = projectToView(wx, wy, wz, currentDirection);
    return {
      x: (centerSubX + (p.canvasX as SubPixel)) as SubPixel,
      y: (centerSubY + (p.canvasY as SubPixel)) as SubPixel,
    };
  };
  // 衣物色区：袖口/裤腰比例按肢体全长（弧长）切分到各段。
  // 全部关节点位（px）供链长计算（不限无精灵节点）。
  const posPx = new Map<string, { x: number; y: number }>();
  for (const [id, wt] of worldTransforms) {
    const p = project(wt.worldX, wt.worldY, wt.worldZ);
    posPx.set(id, { x: subToPx(p.x), y: subToPx(p.y) });
  }
  const clothRatioOf = (node: Node): number => {
    const kind = mannequinLimbKind(character, node);
    if (!kind) return 0;
    const ratio = kind === 'arm' ? clothing.sleeveRatio : clothing.pantsRatio;
    if (ratio <= 0) return 0;
    // 链根：沿父链上溯到类别变化处（父不再是同类）的那个节点。
    // 链根自身的段是「躯干→肩/髋」的挂接段、不算肢体本身，衣物色
    // 自链根关节（肩/髋）起算，故链根段不染色。
    let root: Node = node;
    while (root.parentId) {
      const parent = character.nodes[root.parentId];
      if (!parent || mannequinLimbKind(character, parent) !== kind) break;
      root = parent;
    }
    if (node.id === root.id) return 0;
    // 肢体全长：自链根关节沿子链取最长路径（同类节点内）
    const dist = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
      a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    const longestFrom = (n: Node): number => {
      let best = 0;
      for (const cid of n.children ?? []) {
        const c = character.nodes[cid];
        if (!c || mannequinLimbKind(character, c) !== kind) continue;
        best = Math.max(best, dist(posPx.get(n.id), posPx.get(c.id)) + longestFrom(c));
      }
      return best;
    };
    const total = longestFrom(root);
    if (total <= 0) return 0;
    // 本段起点距链根的弧长：沿链根→本节点父关节逐段累加
    let fromRoot = 0;
    const chainUp: Node[] = [];
    let cur: Node | undefined = node;
    while (cur && cur.id !== root.id) { chainUp.push(cur); cur = cur.parentId ? character.nodes[cur.parentId] : undefined; }
    chainUp.reverse();
    let prev: Node = root;
    for (const n of chainUp) {
      if (n.id !== node.id) fromRoot += dist(posPx.get(prev.id), posPx.get(n.id));
      prev = n;
    }
    // 本节点段的起点 = 父关节：若父不是链根链上节点（父即链根或链外），
    // fromRoot 应计到父关节为止——上面循环计的是到各祖先关节的累加，
    // 本段起点（父关节）距根 = fromRoot（循环已把父关节计入）。
    const segLen = dist(
      node.parentId ? posPx.get(node.parentId) : posPx.get(node.id),
      posPx.get(node.id),
    );
    if (segLen <= 0) return 0;
    const covered = Math.min(1, Math.max(0, (ratio * total - fromRoot) / segLen));
    return covered;
  };

  const EXTREMITY_FILL = '#a7b2c4';
  // segInsByNode 以段的远端节点为键（头蛋要挂到「以头关节结尾的那
  // 条段」上）；段的衣物色区是段自身的属性（自链根累计到本段），
  // 按远端节点算 clothRatioOf、与段记在谁名下无关。
  const segInsByNode = new Map<string, MannequinRenderInstruction>();
  const coveredOwners = new Set<string>();
  const jointShapes: MannequinShape[] = [];
  for (const s of shapes) {
    if (s.kind === 'joint') { jointShapes.push(s); continue; }
    if (s.kind === 'segment') {
      const distal = s.toNodeId ? character.nodes[s.toNodeId] : undefined;
      const clothRatio = distal ? clothRatioOf(distal) : 0;
      const ins: MannequinRenderInstruction = {
        nodeId: s.nodeId,
        x1: pxToSub(s.x1), y1: pxToSub(s.y1), x2: pxToSub(s.x2), y2: pxToSub(s.y2),
        r1: s.r1, r2: s.r2,
        fillColor: '#8f9bb0',
        outlineColor: '#4a5160',
        ...(clothRatio > 0 ? { clothRatio } : {}),
      };
      out.push(ins);
      coveredOwners.add(s.nodeId);
      if (s.toNodeId) segInsByNode.set(s.toNodeId, ins);
    } else if (s.kind === 'head') {
      let ins = segInsByNode.get(s.nodeId);
      if (!ins) {
        // 父节点有精灵时颈段不生成（父精灵已覆盖该区域）：给头节点
        // 补一条退化指令专挂蛋形
        ins = {
          nodeId: s.nodeId,
          x1: pxToSub(s.x2), y1: pxToSub(s.y2), x2: pxToSub(s.x2), y2: pxToSub(s.y2),
          r1: s.r2, r2: s.r2,
          fillColor: '#8f9bb0',
          outlineColor: '#4a5160',
        };
        out.push(ins);
      }
      coveredOwners.add(s.nodeId);
      if (!s.head) continue;
      const node = character.nodes[s.nodeId]!;
      const { cx, cy, a, b, angleRad } = s.head;
      ins.head = { cx: pxToSub(cx), cy: pxToSub(cy), a, b, angleRad };
      // 五官参照开关开启时，按头部框口径把五官线段现算进指令（节点
      // faceFeatures/faceTurn 优先，缺省标准三庭），与精灵头的五官
      // 参照叠画同参数同公式、互为有无精灵两路。
      if (faceGuide) {
        const ax = Math.cos(angleRad), ay = Math.sin(angleRad);
        const fp = node.faceFeatures ?? DEFAULT_FACE_FEATURES;
        const yaw = node.faceTurn?.yaw ?? 0;
        const pitch = node.faceTurn?.pitch ?? 0;
        const pts = faceFeaturePoints(fp, yaw, pitch);
        const hw = faceHalfWidths(fp, yaw);
        const rx = -ay, ry = ax;
        const mapPt = (fx: number, fy: number) => ({
          x: pxToSub(cx + rx * (fx - 0.5) * 2 * b + ax * (0.5 - fy) * 2 * a),
          y: pxToSub(cy + ry * (fx - 0.5) * 2 * b + ay * (0.5 - fy) * 2 * a),
        });
        const segOf = (p: { x: number; y: number }, halfW: number) => {
          const p1 = mapPt(p.x - halfW, p.y);
          const p2 = mapPt(p.x + halfW, p.y);
          return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
        };
        ins.faceSegs = [
          segOf(pts.browL, hw.eye * 0.8), segOf(pts.browR, hw.eye * 0.8),
          segOf(pts.eyeL, hw.eye), segOf(pts.eyeR, hw.eye),
          segOf(pts.noseBase, hw.nose), segOf(pts.mouth, hw.mouth),
        ];
      }
    } else {
      out.push({
        nodeId: s.nodeId,
        x1: pxToSub(s.x1), y1: pxToSub(s.y1), x2: pxToSub(s.x2), y2: pxToSub(s.y2),
        r1: s.r1, r2: s.r2,
        fillColor: EXTREMITY_FILL,
        outlineColor: '#4a5160',
        extremity: s.kind,
      });
      coveredOwners.add(s.nodeId);
    }
  }
  // 孤点补画：无子、无延伸、无头蛋的节点（如单节点角色、游离道具
  // 尖）在新归属下没有任何段可画，给它一条退化指令保住可见性
  for (const s of jointShapes) {
    if (coveredOwners.has(s.nodeId)) continue;
    out.push({
      nodeId: s.nodeId,
      x1: pxToSub(s.x1), y1: pxToSub(s.y1), x2: pxToSub(s.x2), y2: pxToSub(s.y2),
      r1: s.r1, r2: s.r2,
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

/** 激活片段的刀光（与状态轨道同一门控口径：激活片段 + 归属角色 + 帧在窗内）。
 *  规格经 resolveClipSlash 解引用（私有字段或共享定义活引用），与进包同源 */
export function pickSlashClip(
  clips: AnimationClip[] | undefined,
  activeClipId: string | null | undefined,
  characterId: string,
  frame: number,
  defs?: readonly SlashDefinition[],
): AnimationClip | undefined {
  if (!clips || !activeClipId) return undefined;
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip || clip.puppetCharacterId !== characterId || !resolveClipSlash(clip, defs)) return undefined;
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

/** 静止位世界变换（剥每节点轨道、关 IK、全节点强制朝向 dir）：
 * 按 nodes 对象身份 + 朝向缓存——动画播放期角色对象不变、逐帧复用。
 * 拆分工具（node-split）与堆叠接缝弯曲带共用同一静止口径。 */
const restWtCache = new WeakMap<Record<string, Node>, Map<string, Map<string, WorldTransform>>>();
export function computeRestWorldTransforms(
  character: Character,
  dir: DirectionIndex,
  geometryDirection?: DirectionIndex,
): Map<string, WorldTransform> {
  let byKey = restWtCache.get(character.nodes);
  if (!byKey) { byKey = new Map(); restWtCache.set(character.nodes, byKey); }
  const key = `${dir}|${geometryDirection ?? ''}`;
  let hit = byKey.get(key);
  if (hit) return hit;
  const nodes: Record<string, Node> = {};
  for (const n of Object.values(character.nodes)) {
    nodes[n.id] = { ...n, tracks: {}, transform: { ...n.transform, variantIndex: dir } };
  }
  const clone: Character = {
    ...character,
    nodes,
    ikChains: (character.ikChains ?? []).map((c) => ({ ...c, enabled: false })),
  };
  hit = computeWorldTransforms(clone, 0, 512, 512, 12, undefined, undefined, undefined, geometryDirection);
  byKey.set(key, hit);
  return hit;
}

// ==================== 钳制锚定（PR #55 研究定式） ====================
// 指定点经 IK 结算到达钳制高度/目标点/目标范围时暂时锚定：锚点全位
// 置冻结不滑动，整角色反向横移把它送回冻结位（结算位姿刚性不动）；
// 边缘/点对的倾斜只掰锚点所在节点（绕冻结主点转本节点子树）。多锚
// 硬优先级：Δ 由最高优先的生效锚独占。状态（冻结记录）由会话层
// （clamp-session）/convert 在平结算位上顺序步进，本段只消费。
// 语义与裁决全记录见 spikes/clamp-anchor/RESEARCH.md。

export interface ClampFrozen { points: Array<{ x: number; y: number; z: number }> }
export type ClampStateMap = Map<string, ClampFrozen | null>;
export interface SimContext {
  /** 链节点本地角增量（度）：实时模拟会话层步进后折算，结算时
   * 叠加在节点当帧角之上（世界段向与解出段向重合）。施加顺序：
   * 模拟先于钳制——本增量在 FK 阶段生效，钳制收尾读到的是模拟
   * 后的位姿。 */
  angleDeltas: ReadonlyMap<string, number>;
}

export interface ClampContext {
  /** 本帧已步进的冻结记录（会话层/convert 持有并步进） */
  frozen: ClampStateMap;
  sprites?: Record<string, Sprite>;
  /** 内部：resettle 重算时累进的根偏移（px） */
  rootOffset?: { x: number; y: number; z: number };
  resettleDepth?: number;
  /** 内部：resettle 换算尖端目标用的上一遍已解变换（frame 口径） */
  resettleRefTransforms?: Map<string, WorldTransform>;
}
export interface ClampReport { anchorId: string; engaged: boolean; residual: number }

type ClampV3 = { x: number; y: number; z: number };
const cv3 = (x: number, y: number, z: number): ClampV3 => ({ x, y, z });
const sub3 = (a: ClampV3, b: ClampV3): ClampV3 => cv3(a.x - b.x, a.y - b.y, a.z - b.z);
const len3 = (a: ClampV3): number => Math.hypot(a.x, a.y, a.z);

function clampSpriteTable(ctxSprites?: Record<string, Sprite>, character?: Character) {
  if (ctxSprites) return ctxSprites;
  try {
    const { useProjectStore } = require('./store') as typeof import('./store');
    const st = useProjectStore.getState() as unknown as { sprites?: Record<string, Sprite> };
    if (st.sprites && Object.keys(st.sprites).length > 0) return st.sprites;
  } catch { /* 离线语境回退角色自带表 */ }
  return character?.sprites as Record<string, Sprite> | undefined;
}

function clampNodeWorld(transforms: Map<string, WorldTransform>, nodeId: string): ClampV3 | null {
  const w = transforms.get(nodeId);
  if (!w) return null;
  return cv3(subToPx(w.worldX), subToPx(w.worldY), subToPx(w.worldZ));
}

function clampPixelWorld(
  character: Character,
  transforms: Map<string, WorldTransform>,
  nodeId: string,
  sel: { mark?: string; x?: number; y?: number },
  sprites?: Record<string, Sprite>,
): ClampV3 | null {
  const node = character.nodes[nodeId];
  const w = transforms.get(nodeId);
  if (!node || !w) return null;
  const dir = (w.variantIndex ?? 0) as DirectionIndex;
  const spriteId = resolveNodeSpriteId(character, nodeId, dir, sprites);
  if (!spriteId) return null;
  const table = sprites ?? (character.sprites as Record<string, Sprite> | undefined);
  const sprite = table?.[spriteId];
  if (!sprite) return null;
  let px = sel.x ?? 0, py = sel.y ?? 0;
  if (sel.mark) {
    const mp = markPointPx(sprite, sel.mark);
    if (!mp) return null;
    px = mp.x; py = mp.y;
  }
  const plug = sprite.plug ? { x: subToPx(sprite.plug.x), y: subToPx(sprite.plug.y) } : { x: 0, y: 0 };
  let lx = px - plug.x;
  const ly = py - plug.y;
  if (w.mirror) lx = -lx;
  const r = applyFrameRotation(w.worldFrame, lx, ly, 0, dir);
  const base = clampNodeWorld(transforms, nodeId)!;
  return cv3(base.x + r.x, base.y + r.y, base.z + r.z);
}

/** 指定点解析：返回世界点列（主点在前）与旋转承担节点（主点所在节点） */
export function clampAnchorPoints(
  character: Character,
  transforms: Map<string, WorldTransform>,
  anchor: ClampAnchor,
  sprites?: Record<string, Sprite>,
): { points: ClampV3[]; ownerNodeId: string; pairSameNode?: boolean } | null {
  const ref = anchor.point;
  if (ref.kind === 'node') {
    const p = clampNodeWorld(transforms, ref.nodeId);
    return p ? { points: [p], ownerNodeId: ref.nodeId } : null;
  }
  if (ref.kind === 'nodePair') {
    const a = clampNodeWorld(transforms, ref.nodeId);
    const b = clampNodeWorld(transforms, ref.nodeId2);
    return a && b ? { points: [a, b], ownerNodeId: ref.nodeId } : null;
  }
  if (ref.kind === 'pixel') {
    const p = clampPixelWorld(character, transforms, ref.nodeId, ref, sprites);
    return p ? { points: [p], ownerNodeId: ref.nodeId } : null;
  }
  if (ref.kind === 'pixelPair') {
    const a = clampPixelWorld(character, transforms, ref.a.nodeId, ref.a, sprites);
    const b = clampPixelWorld(character, transforms, ref.b.nodeId, ref.b, sprites);
    return a && b ? { points: [a, b], ownerNodeId: ref.a.nodeId, pairSameNode: ref.a.nodeId === ref.b.nodeId } : null;
  }
  // spriteEdge：精灵矩形一边（plug 相对的两角点）
  const node = character.nodes[ref.nodeId];
  const w = transforms.get(ref.nodeId);
  if (!node || !w) return null;
  const dir = (w.variantIndex ?? 0) as DirectionIndex;
  const spriteId = resolveNodeSpriteId(character, ref.nodeId, dir, sprites);
  if (!spriteId) return null;
  const table = sprites ?? (character.sprites as Record<string, Sprite> | undefined);
  const sprite = table?.[spriteId];
  if (!sprite) return null;
  const plug = sprite.plug ? { x: subToPx(sprite.plug.x), y: subToPx(sprite.plug.y) } : { x: 0, y: 0 };
  const W = sprite.width ?? 0, H = sprite.height ?? 0;
  const corners: Record<string, Array<[number, number]>> = {
    top: [[0, 0], [W, 0]],
    bottom: [[0, H], [W, H]],
    left: [[0, 0], [0, H]],
    right: [[W, 0], [W, H]],
  };
  const base = clampNodeWorld(transforms, ref.nodeId)!;
  const points = corners[ref.edge].map(([cx, cy]) => {
    let lx = cx - plug.x;
    const ly = cy - plug.y;
    if (w.mirror) lx = -lx;
    const r = applyFrameRotation(w.worldFrame, lx, ly, 0, dir);
    return cv3(base.x + r.x, base.y + r.y, base.z + r.z);
  });
  return { points, ownerNodeId: ref.nodeId, pairSameNode: true };
}

/** 触发判定（在平结算位上）：scene 触发在编辑器引擎内不生效（运行时包专属） */
export function clampTriggerHolds(trigger: ClampTrigger, points: ClampV3[]): boolean {
  if (trigger.kind === 'height') {
    return trigger.side === 'below' ? points[0].y >= trigger.y : points[0].y <= trigger.y;
  }
  if (trigger.kind === 'point') {
    return len3(sub3(points[0], trigger.target)) <= trigger.radius;
  }
  if (trigger.kind === 'range') {
    const p = points[0];
    if (trigger.shape === 'rect' && trigger.rect) {
      const r = trigger.rect;
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }
    if (trigger.shape === 'circle' && trigger.circle) {
      const c = trigger.circle;
      return Math.hypot(p.x - c.x, p.y - c.y) <= c.r;
    }
    return false;
  }
  return false; // scene
}

/** 生效帧的冻结位：整位冻结（高度先投影到面、目标点取目标、范围钳进区域） */
export function clampFreezePoints(trigger: ClampTrigger, settled: ClampV3[]): ClampV3[] {
  if (trigger.kind === 'height') return settled.map((p) => cv3(p.x, trigger.y, p.z));
  if (trigger.kind === 'point') return settled.map((p, i) => (i === 0 ? { ...trigger.target } : { ...p }));
  if (trigger.kind === 'range') {
    return settled.map((p) => {
      if (trigger.shape === 'rect' && trigger.rect) {
        const r = trigger.rect;
        return cv3(Math.min(Math.max(p.x, r.x), r.x + r.w), Math.min(Math.max(p.y, r.y), r.y + r.h), p.z);
      }
      if (trigger.shape === 'circle' && trigger.circle) {
        const c = trigger.circle;
        const dx = p.x - c.x, dy = p.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d <= c.r || d === 0) return { ...p };
        return cv3(c.x + (dx / d) * c.r, c.y + (dy / d) * c.r, p.z);
      }
      return { ...p };
    });
  }
  return settled.map((p) => ({ ...p }));
}

/** 在平结算位上步进一帧冻结状态（触发/冻结/释放）。顺序求值确定。 */
export function stepClampState(
  character: Character,
  settledTransforms: Map<string, WorldTransform>,
  state: ClampStateMap,
  sprites?: Record<string, Sprite>,
): void {
  const anchors = character.clampAnchors;
  if (!anchors || anchors.length === 0) return;
  const table = clampSpriteTable(sprites, character);
  for (const anchor of anchors) {
    if (!anchor.enabled) { if (state.get(anchor.id)) state.set(anchor.id, null); continue; }
    const resolved = clampAnchorPoints(character, settledTransforms, anchor, table);
    if (!resolved) continue;
    const cur = state.get(anchor.id);
    if (cur) {
      if (!clampTriggerHolds(anchor.trigger, resolved.points)) state.set(anchor.id, null);
    } else if (clampTriggerHolds(anchor.trigger, resolved.points)) {
      state.set(anchor.id, { points: clampFreezePoints(anchor.trigger, resolved.points) });
    }
  }
}

function clampSubtreeIds(character: Character, rootId: string): string[] {
  const out: string[] = [];
  const childrenOf = new Map<string, string[]>();
  for (const n of Object.values(character.nodes)) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenOf.set(n.parentId, arr);
    }
  }
  const walk = (id: string) => { out.push(id); for (const c of childrenOf.get(id) ?? []) walk(c); };
  walk(rootId);
  return out;
}

/** 两向量间的旋转（mat3）：把 a 方向转到 b 方向 */
function clampRotationBetween(a: ClampV3, b: ClampV3): Mat3 | null {
  const la = len3(a), lb = len3(b);
  if (la < 1e-6 || lb < 1e-6) return null;
  const ua = cv3(a.x / la, a.y / la, a.z / la), ub = cv3(b.x / lb, b.y / lb, b.z / lb);
  const dot = Math.min(1, Math.max(-1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z));
  const cx = ua.y * ub.z - ua.z * ub.y, cy = ua.z * ub.x - ua.x * ub.z, cz = ua.x * ub.y - ua.y * ub.x;
  const cl = Math.hypot(cx, cy, cz);
  if (cl < 1e-9) {
    if (dot > 0) return null; // 同向，无需旋转
    // 反向：任取垂直轴转 π
    const ax = Math.abs(ua.x) < 0.9 ? cv3(0, ua.z, -ua.y) : cv3(ua.z, 0, -ua.x);
    const al = len3(ax);
    const kx = ax.x / al, ky = ax.y / al, kz = ax.z / al;
    return [1 - 2 * (ky * ky + kz * kz), 2 * kx * ky, 2 * kx * kz,
            2 * kx * ky, 1 - 2 * (kx * kx + kz * kz), 2 * ky * kz,
            2 * kx * kz, 2 * ky * kz, 1 - 2 * (kx * kx + ky * ky)];
  }
  const kx = cx / cl, ky = cy / cl, kz = cz / cl;
  const ang = Math.acos(dot);
  if (ang < 0.5 * Math.PI / 180) return null; // <0.5° 不掰
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [t * kx * kx + c, t * kx * ky - s * kz, t * kx * kz + s * ky,
          t * kx * ky + s * kz, t * ky * ky + c, t * ky * kz - s * kx,
          t * kx * kz - s * ky, t * ky * kz + s * kx, t * kz * kz + c];
}

/** resettle 重算遍专用：末端节点是某生效锚主点所在节点的链，目标换成冻结位 */
export function resettleChainOverride(
  character: Character,
  chain: IKChain,
  frozen: ClampStateMap,
  transforms?: Map<string, WorldTransform>,
  sprites?: Record<string, Sprite>,
): IKChain {
  const anchors = character.clampAnchors;
  if (!anchors || anchors.length === 0) return chain;
  const ownerOf = (a: ClampAnchor): string | null => {
    const r = a.point;
    if (r.kind === 'node' || r.kind === 'nodePair' || r.kind === 'pixel' || r.kind === 'spriteEdge') return r.nodeId;
    return r.a.nodeId;
  };
  const ordered = anchors
    .map((a, idx) => ({ a, idx }))
    .filter(({ a }) => a.enabled && frozen.get(a.id))
    .sort((x, y) => (y.a.priority ?? (anchors.length - y.idx)) - (x.a.priority ?? (anchors.length - x.idx)));
  for (const { a } of ordered) {
    if (ownerOf(a) === chain.endNodeId) {
      const f = frozen.get(a.id)!;
      // 链目标是「尖端」口径（末关节 + frame +Y × 尖端长），冻结位是
      // 主点（末关节）口径：按当遍 FK 的末关节 frame 把冻结位换算成
      // 尖端目标，关节才会落回冻结位（残差由收尾遍刚性兜底）。
      const endWt = transforms?.get(chain.endNodeId);
      if (endWt) {
        const dir = (endWt.variantIndex ?? 0) as DirectionIndex;
        let tipLen = chain.tipLength ?? 0;
        if (tipLen <= 0) {
          tipLen = resolveSpriteTipLength(character, chain.endNodeId, dir, sprites) ?? 0;
        }
        if (tipLen <= 0) {
          // 回退末段长：末关节与其父关节的当遍距离
          const endNode = character.nodes[chain.endNodeId];
          const parentWt = endNode?.parentId ? transforms?.get(endNode.parentId) : undefined;
          if (parentWt) {
            tipLen = Math.hypot(
              subToPx(endWt.worldX) - subToPx(parentWt.worldX),
              subToPx(endWt.worldY) - subToPx(parentWt.worldY),
              subToPx(endWt.worldZ) - subToPx(parentWt.worldZ),
            );
          }
        }
        if (tipLen > 1e-6) {
          const ya = frameYAxisWorld(endWt.worldFrame, dir);
          return {
            ...chain,
            target3D: {
              x: f.points[0].x + ya.x * tipLen,
              y: f.points[0].y + ya.y * tipLen,
              z: f.points[0].z + ya.z * tipLen,
            },
          };
        }
      }
      return { ...chain, target3D: { ...f.points[0] } };
    }
  }
  return chain;
}

export interface ClampPassResult {
  delta: ClampV3;
  reports: ClampReport[];
  resettleWanted: boolean;
}

/**
 * 锚定施加遍（就地改 transforms）：硬优先级 Δ 整角色刚性平移 +
 * 生效点对/边缘的所在节点子树绕冻结主点对齐旋转。返回报告与
 * resettle 意愿（由 computeWorldTransforms 决定是否重算）。
 */
export function applyClampPass(
  character: Character,
  transforms: Map<string, WorldTransform>,
  frozen: ClampStateMap,
  sprites?: Record<string, Sprite>,
  geometryDirection?: DirectionIndex,
): ClampPassResult {
  const zero: ClampPassResult = { delta: cv3(0, 0, 0), reports: [], resettleWanted: false };
  const anchors = character.clampAnchors;
  if (!anchors || anchors.length === 0) return zero;
  const table = clampSpriteTable(sprites, character);
  const engaged: Array<{ anchor: ClampAnchor; idx: number; frozenPts: ClampV3[]; settled: { points: ClampV3[]; ownerNodeId: string; pairSameNode?: boolean } }> = [];
  anchors.forEach((anchor, idx) => {
    if (!anchor.enabled) return;
    const f = frozen.get(anchor.id);
    if (!f) return;
    const settled = clampAnchorPoints(character, transforms, anchor, table);
    if (!settled) return;
    engaged.push({ anchor, idx, frozenPts: f.points, settled });
  });
  if (engaged.length === 0) return zero;
  const effPrio = (e: { anchor: ClampAnchor; idx: number }) => e.anchor.priority ?? (anchors.length - e.idx);
  engaged.sort((a, b) => effPrio(b) - effPrio(a));
  const top = engaged[0];
  // Δ：单点 = 主点残差；同节点双点（精灵边缘/同节点像素对）= 主点残差
  // （次点由节点局部旋转精确带到位）；跨节点点对 = 两端残差均值
  let delta = sub3(top.frozenPts[0], top.settled.points[0]);
  if (top.frozenPts.length > 1 && top.settled.points.length > 1 && !top.settled.pairSameNode) {
    const d2 = sub3(top.frozenPts[1], top.settled.points[1]);
    delta = cv3((delta.x + d2.x) / 2, (delta.y + d2.y) / 2, (delta.z + d2.z) / 2);
  }
  if (len3(delta) > 1e-9) {
    for (const [id, w] of transforms) {
      transforms.set(id, {
        ...w,
        worldX: pxToSub(subToPx(w.worldX) + delta.x),
        worldY: pxToSub(subToPx(w.worldY) + delta.y),
        worldZ: pxToSub(subToPx(w.worldZ) + delta.z),
      });
    }
  }
  // 节点局部旋转：每个生效的双点锚，把所在节点子树绕其主点（平移后位）对齐到冻结段向
  for (const e of engaged) {
    if (e.frozenPts.length < 2 || e.settled.points.length < 2) continue;
    const curDir = sub3(e.settled.points[1], e.settled.points[0]);
    const froDir = sub3(e.frozenPts[1], e.frozenPts[0]);
    // 旋转在朝向基坐标下算（frame 的 mat3 活在基空间）：段向先换基
    const rotDir = (geometryDirection ?? transforms.get(e.settled.ownerNodeId)?.variantIndex ?? 0) as DirectionIndex;
    const toBasis = (vv: ClampV3): ClampV3 => { const b = worldToViewBasis(vv.x, vv.y, vv.z, rotDir); return cv3(b.h, b.y, b.d); };
    const R = clampRotationBetween(toBasis(curDir), toBasis(froDir));
    if (!R) continue;
    const about = cv3(e.settled.points[0].x + delta.x, e.settled.points[0].y + delta.y, e.settled.points[0].z + delta.z);
    for (const id of clampSubtreeIds(character, e.settled.ownerNodeId)) {
      const w = transforms.get(id);
      if (!w) continue;
      const px = subToPx(w.worldX), py = subToPx(w.worldY), pz = subToPx(w.worldZ);
      const rr = applyFrameRotation(R, px - about.x, py - about.y, pz - about.z, rotDir);
      const frame = mat3Mul(R, w.worldFrame);
      transforms.set(id, {
        ...w,
        worldX: pxToSub(about.x + rr.x),
        worldY: pxToSub(about.y + rr.y),
        worldZ: pxToSub(about.z + rr.z),
        worldFrame: frame,
        worldAngle: geometryDirection !== undefined
          ? frameViewAngleForDirection(frame, geometryDirection, w.variantIndex)
          : frameViewAngle(frame),
      });
    }
  }
  const reports = engaged.map((e) => {
    let residual = 0;
    e.frozenPts.forEach((fp, i) => {
      const sp = e.settled.points[i];
      if (sp) residual = Math.max(residual, len3(sub3(fp, cv3(sp.x + delta.x, sp.y + delta.y, sp.z + delta.z))));
    });
    return { anchorId: e.anchor.id, engaged: true, residual };
  });
  return { delta, reports, resettleWanted: engaged.some((e) => !!e.anchor.resettle) };
}

/**
 * 某节点摞的接缝弯曲带入参：根端取父节点、尖端取关节最贴摞尖端
 * 的子节点（摞轴长与子关节局部位置比对）；当帧帧取 now、静止帧取
 * rest（两图须同口径，如连续偏航须都已转）。无可用关节返回 undefined。
 */
export function stackBendForNode(
  node: Node,
  stack: SpriteStack,
  now: Map<string, WorldTransform>,
  rest: Map<string, WorldTransform>,
  geometryDirection?: DirectionIndex,
): StackBend | undefined {
  const selfN = now.get(node.id);
  const selfR = rest.get(node.id);
  if (!selfN || !selfR) return undefined;
  const bend: StackBend = { restFrame: selfR.worldFrame, restAngle: selfR.worldAngle };
  if (node.parentId) {
    const pN = now.get(node.parentId);
    const pR = rest.get(node.parentId);
    if (pN && pR) {
      bend.parent = { frame: pN.worldFrame, angle: pN.worldAngle, restFrame: pR.worldFrame, restAngle: pR.worldAngle };
    }
  }
  const totalLen = stack.layerSpriteIds.length * stack.layerThickness;
  if (totalLen > 0 && node.children.length > 0) {
    const tipX = stack.origin.x + stack.axis.x * totalLen;
    const tipY = stack.origin.y + stack.axis.y * totalLen;
    const tipZ = stack.origin.z + stack.axis.z * totalLen;
    let bestId: string | null = null;
    let bestD = Infinity;
    // 子关节在本节点局部（与插座偏移/摞原点同一空间）：世界位差经
    // 帧逆变换回局部——applyFrameRotation(转置帧) 是 computeChild-
    // Transforms 正变换的逆（node-split 摞原点回填同口径，探针 0.00）
    const basisDir = geometryDirection ?? selfN.variantIndex;
    for (const cid of node.children) {
      const cN = now.get(cid);
      if (!cN) continue;
      const loc = applyFrameRotation(
        mat3Transpose(selfN.worldFrame),
        subToPx(cN.worldX - selfN.worldX),
        subToPx(cN.worldY - selfN.worldY),
        subToPx(cN.worldZ - selfN.worldZ),
        basisDir,
      );
      const d = Math.hypot(loc.x - tipX, loc.y - tipY, loc.z - tipZ);
      if (d < Math.max(2, stack.layerThickness) && d < bestD) { bestD = d; bestId = cid; }
    }
    if (bestId) {
      const cN = now.get(bestId)!;
      const cR = rest.get(bestId);
      if (cR) {
        bend.child = { frame: cN.worldFrame, angle: cN.worldAngle, restFrame: cR.worldFrame, restAngle: cR.worldAngle };
      }
    }
  }
  return bend.parent || bend.child ? bend : undefined;
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
  // 编辑器显示效果（仅主画布传）：人偶衣物色区比例 + 空气透视强度
  editorFx?: { sleeveRatio?: number; pantsRatio?: number; fogStrength?: number; faceGuide?: boolean },
  // 钳制锚定上下文（主画布/导出会话传；不传则不锚定）
  clampCtx?: ClampContext,
  // 实时模拟上下文（主画布会话传；不传则链按结算原样）
  simCtx?: SimContext,
): RenderPlan {
  const spriteTable = globalSprites ?? character.sprites ?? {};
  // Build variable context for ParamDriver resolution
  // H6: 收集角色全部节点的 active param drivers，传入真实求值（之前恒为默认值）
  const allActiveDrivers: ParamDriver[] = animationVariables && animationVariables.length > 0
    ? collectActiveParamDrivers(character)
    : [];
  const variableContext = animationVariables && animationVariables.length > 0
    ? buildVariableContext(animationVariables, frame, allActiveDrivers, frameRate)
    : undefined;

  // 蓝图变量（变量名 → 本帧值，含 writer 驱动求值）：全部蓝图求值入口统一从此注入
  const blueprintVars: Record<string, number> = variableContext?.values ?? {};

  // Phase 0 (path B): Evaluate node blueprints for transform values (two-pass)
  const blueprintTransforms = blueprintTransformsOverride ?? evaluateBlueprintTransforms(character, frame, frameRate, blueprintVars);

  // 生效服装状态：静态字段 → clip 状态轨道 → 状态蓝图（三层增量叠加）
  const effCostume = resolveEffectiveCostumeState(character, frame, frameRate, stateKeyframes, blueprintVars);

  // 生效服装集（用生效状态的集 id，含轨道/蓝图覆盖；原在 Step 1 之后，
  // 因程序化增量图的预备段要按它解析精灵，提前到此，口径不变）
  const activeCostumeSet = effCostume.costumeSetId
    ? character.costumeSets.find(cs => cs.id === effCostume.costumeSetId)
    : undefined;

  // 方向间过渡（蒙皮转面 A）：facingAngle 为连续角度时，计算相邻两方向及混合系数
  // 单图模式（蒙皮转面 C）：不切换精灵，用 faceTurn 的 yaw 模拟转头
  // （原在指令构建前段，因程序化增量图的预备段解析精灵要同用 dirA，整块提前，逻辑不变）
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

  // 程序化增量图（预备段）：逐节点按与指令构建同一推导解析本次精灵
  // （resolveSprite + 无平面图时堆叠替身回落，见指令构建处），汇总命
  // 中条目为位姿增量，喂给 computeWorldTransforms 叠进世界变换——子
  // 节点在本遍 FK 里读父级最终变换、天然继承，关节盘读同一张表连带
  // 跟随（旧实现把增量加在渲染指令上，世界变换表里没有，子节点与
  // 盘都不跟）。解析朝向与指令构建同值：dirBlend 时 dirA、否则根
  // variantIndex（根的 variantIndex 只由其轨道决定、先于世界变换
  // 可知，单独求值一份只读 variantIndex）。无条目时不建图、下游零变化。
  let procDeltas: Map<string, ProceduralPoseDelta> | undefined;
  if (proceduralAnimations && proceduralAnimations.length > 0) {
    const rootNodeForDir = character.nodes[character.rootNodeId];
    const rootVariant = rootNodeForDir
      ? interpolateTransform(rootNodeForDir, frame, frameRate, variableContext, blueprintTransforms).variantIndex
      : (0 as DirectionIndex);
    const resolveDir = dirBlend ? dirBlend.dirA : rootVariant;
    const map = new Map<string, ProceduralPoseDelta>();
    for (const n of Object.values(character.nodes)) {
      const r = resolveSprite(n, resolveDir, activeCostumeSet, spriteTable, effCostume.slotVariants[n.slot?.slotKey ?? n.id], character.latitude ?? 0, frame, frameRate);
      let sid: string | null = r.spriteId;
      if (!r.sprite) {
        const piece = activeCostumeSet?.pieces[n.slot?.slotKey ?? n.id];
        const midId = piece?.stack?.layerSpriteIds[Math.floor(piece.stack.layerSpriteIds.length / 2)];
        sid = midId ?? null;
      }
      const d = computeProceduralPoseDelta(proceduralAnimations, n.id, frame, sid ?? undefined);
      if (d.dx !== 0 || d.dy !== 0 || d.rotDeg !== 0 || d.scaleMul !== 1) map.set(n.id, d);
    }
    if (map.size > 0) procDeltas = map;
  }

  // Step 1: World transforms (includes blueprint-evaluated modifier contributions)
  // 行为层在 computeWorldTransforms 内统一叠加（出图/点选/覆盖层同源）
  const worldTransforms = computeWorldTransforms(
    character, frame, canvasWidth, canvasHeight, frameRate, variableContext, blueprintTransforms,
    undefined, geometryDirection, clampCtx, simCtx, procDeltas,
  );

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

  // 堆叠接缝弯曲带的静止位帧（懒算一次；连续偏航时同步转一份，
  // 与当帧 worldTransforms 同口径）
  let stackRestCache: Map<string, WorldTransform> | undefined;
  const stackRestTransforms = (): Map<string, WorldTransform> => {
    if (!stackRestCache) {
      let rest = computeRestWorldTransforms(character, currentDirection as DirectionIndex, geometryDirection);
      if (yawDeltaRad !== 0) {
        rest = new Map(rest);
        rotateWorldTransformsForYaw(rest, yawDeltaRad, geometryDirection);
      }
      stackRestCache = rest;
    }
    return stackRestCache;
  };

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
    let { sprite, mirror } = resolveSprite(node, resolveDir, activeCostumeSet, spriteTable, effCostume.slotVariants[node.slot?.slotKey ?? node.id], character.latitude ?? 0, frame, frameRate);
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
      // 替身精灵即本节点本次显示的精灵：程序化增量图的预备段按同一
      // 推导（resolveSprite 无结果时取中间层图 id）做精灵通道匹配。
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
      const { sprite: spriteB } = resolveSprite(node, dirBlend.dirB, activeCostumeSet, spriteTable, effCostume.slotVariants[node.slot?.slotKey ?? node.id], character.latitude ?? 0, frame, frameRate);
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

    // 程序化动画增量不在本层叠加：已在预备段汇总成增量图、经
    // computeWorldTransforms 叠进 worldTf（本节点的位姿与子孙的继承
    // 都在那张表里），本处只读 worldTf 的最终值。

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
        const bend = stackBendForNode(node, stackPiece.stack, worldTransforms, stackRestTransforms(), geometryDirection);
        const res = computeStackOps(stackPiece.stack, layerSprites, worldTf.worldFrame, worldTf.worldAngle, STACK_VIEW_ELEVATION_DEG, bend);
        if (res.ops.length > 0) {
          stackRender = { ops: res.ops, width: res.width, height: res.height, pivotX: res.pivotX, pivotY: res.pivotY, key: res.key, layerSpriteIds: stackPiece.stack.layerSpriteIds, marks: stackPiece.stack.marks };
        }
      }
    }

    // 逐帧像素修正：节点当帧条目且精灵 id 与本帧实际精灵对上才下发
    const fcEntry = node.frameCorrections?.[frame];
    const frameCorrection = fcEntry && fcEntry.spriteId === effectiveSprite.id
      ? { commands: fcEntry.commands }
      : undefined;

    nodeInstructions.push({
      nodeId,
      sprite: effectiveSprite,
      stackRender,
      frameCorrection,
      worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2) + (proj.canvasX as SubPixel) + pxToSub(folDx)) as SubPixel,
      worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2) + (proj.canvasY as SubPixel) + pxToSub(folDy)) as SubPixel,
      angle: worldTf.worldAngle + (folDa * 180) / Math.PI + spinDeg,
      // worldStretch/scaleX 已在世界变换里乘过程序化 scaleMul（增量图
      // 落点），此处只叠动态形变自身的 dynSy/dynSx/folDs。
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
      modifiers: node.modifiers,
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
      // 动态形变缩放积（场域范围跟随部件的实际绘制缩放；程序化缩放
      // 走世界变换的 scaleX/stretch 通道、不经此字段——与蓝图缩放的
      // 既有口径一致：dynScale 本就不含世界变换的缩放）
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
  const slashClipSpec = slashClip ? resolveClipSlash(slashClip, character.slashDefs) : undefined;
  if (slashClip && slashClipSpec && frame >= slashClip.startFrame && frame <= slashClip.endFrame) {
    const spec = slashClipSpec;
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
        { sleeveRatio: editorFx?.sleeveRatio ?? 0, pantsRatio: editorFx?.pantsRatio ?? 0 },
        editorFx?.faceGuide ?? false,
        geometryDirection,
      )
    : [];

  // Step 5.6: 空气透视（编辑器专用）：按投影深度给节点指令写雾量
  // （zIndex 主键即深度分桶：值大 = 后画 = 近；远端雾量最大）
  const fogStrength = editorFx?.fogStrength ?? 0;
  if (fogStrength > 0 && nodeInstructions.length > 0) {
    let zMin = Infinity, zMax = -Infinity;
    for (const i of nodeInstructions) { zMin = Math.min(zMin, i.zIndex); zMax = Math.max(zMax, i.zIndex); }
    const span = zMax - zMin;
    if (span > 0) {
      for (const i of nodeInstructions) {
        i.fogAmount = fogStrength * (1 - (i.zIndex - zMin) / span) * 0.85;
      }
    }
  }

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

  // 刀光最后绘制（盖在角色之上）：帧图以有效帧布局的 plug 钉在
  // 定格位姿处、按定格角度旋转（镜像帧已预翻，其 plug 横坐标
  // = 帧宽 − plugX，与精灵同口径）
  if (plan.slashFx) {
    const fx = plan.slashFx;
    const fc = slashFrameCanvas(fx.spec, fx.frameIdx, fx.mirror);
    const lay = slashFrameLayout(fx.spec);
    const plugX = fx.mirror ? lay.w - lay.plugX : lay.plugX;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(fx.worldX, fx.worldY);
    ctx.rotate((fx.angleDeg * Math.PI) / 180);
    ctx.drawImage(fc, -plugX, -lay.plugY);
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

// ---- 拾取通道（编辑器专用）----
// 编辑器主画布绘制期间可开启一条并行通道：每个节点把自己最终画出的
// 剪影（像素修改器/像素链/蒙皮弯曲/堆叠合成都已作用在 workingCanvas
// 上）以专属编号色描到一张离屏「编号图」，关节盘同理随后覆盖。命中
// 直接读编号图——占据以绘制结果为准，不在命中侧重算。
// 编号：自 1 起递增、拆 RGB 三通道；0/透明 = 无。剪影保留源 alpha，
// 读取端只认 alpha ≥ 250 的像素（不透明像素的编号往返精确；半透明与
// 抗锯齿边缘读作未命中，由几何判定兜底——只会漏、不会错选）。
interface ActivePickPass {
  ctx: CanvasRenderingContext2D;
  next: number;
  ids: Map<number, string>;
}
let activePickPass: ActivePickPass | null = null;

export function beginPickPass(ctx: CanvasRenderingContext2D): void {
  activePickPass = { ctx, next: 1, ids: new Map() };
}

/** 结束通道并交出编号 → 节点 id 映射（未开启时为空表） */
export function endPickPass(): Map<number, string> {
  const ids = activePickPass ? activePickPass.ids : new Map<number, string>();
  activePickPass = null;
  return ids;
}

function pickColorFor(nodeId: string): string {
  const p = activePickPass!;
  const id = p.next++;
  p.ids.set(id, nodeId);
  return `rgb(${id & 0xff},${(id >> 8) & 0xff},${(id >> 16) & 0xff})`;
}

let pickScratch: HTMLCanvasElement | null = null;

/** 把 source 的不透明形状染成 nodeId 的编号色、按与正图相同的变换
 * 画进编号图。旋转走原生仿射（正图的像素完美旋转栅格差 ≤ 1px，命中
 * 侧有 slop 与几何兜底）。 */
function drawPickSilhouette(
  source: HTMLCanvasElement,
  nodeId: string,
  drawPivotX: number, drawPivotY: number,
  pivotX: number, pivotY: number,
  angleDeg: number, scaleX: number, effStretch: number,
  skews: Array<{ skewX: number; skewY: number }>,
  clipPath?: [number, number][],
): void {
  const p = activePickPass;
  if (!p || source.width === 0 || source.height === 0) return;
  if (!pickScratch) pickScratch = document.createElement('canvas');
  if (pickScratch.width !== source.width || pickScratch.height !== source.height) {
    pickScratch.width = source.width;
    pickScratch.height = source.height;
  }
  const sctx = pickScratch.getContext('2d')!;
  sctx.save();
  sctx.globalCompositeOperation = 'copy';
  sctx.drawImage(source, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = pickColorFor(nodeId);
  sctx.fillRect(0, 0, pickScratch.width, pickScratch.height);
  sctx.restore();
  const ctx = p.ctx;
  ctx.save();
  if (clipPath && clipPath.length >= 3) {
    ctx.beginPath();
    clipPath.forEach(([cx, cy], i) => (i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)));
    ctx.closePath();
    ctx.clip();
  }
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.scale(scaleX, effStretch);
  for (const { skewX, skewY } of skews) {
    ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
  }
  ctx.drawImage(pickScratch, -pivotX, -pivotY);
  ctx.restore();
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

  // 逐帧像素修正的笔刷命令：像素修改器之后回放（最上层的逐帧补画）
  if (instruction.frameCorrection?.commands && instruction.frameCorrection.commands.length > 0) {
    effectivePixels = applyBrushCommandsToGrid(effectivePixels, instruction.frameCorrection.commands, frame);
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

  // 空气透视（编辑器专用，计划期按深度写入 fogAmount）：在隔离副本上
  // 向雾色插值（source-atop 只染有像素处），不污染精灵画布缓存。
  if (instruction.fogAmount && instruction.fogAmount > 0.001) {
    const fogCanvas = document.createElement('canvas');
    fogCanvas.width = spriteCanvas.width;
    fogCanvas.height = spriteCanvas.height;
    const fctx = fogCanvas.getContext('2d')!;
    fctx.drawImage(spriteCanvas, 0, 0);
    fctx.globalCompositeOperation = 'source-atop';
    fctx.globalAlpha = Math.min(1, instruction.fogAmount);
    fctx.fillStyle = '#aebdd4';
    fctx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
    spriteCanvas = fogCanvas;
  }

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

  // 拾取通道：正图绘制前把最终剪影以编号色描进编号图（顺序与正图
  // 绘制序一致，后画的覆盖先画的——读到的就是视觉最上层）
  if (activePickPass) {
    drawPickSilhouette(
      workingCanvas, instruction.nodeId,
      drawPivotX, drawPivotY, pivotX, pivotY,
      angle, scaleX, effStretch, skews, instruction.clipPath,
    );
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
/**
 * 两圆外公切线几何（胶囊渐变体拼路径用）：切点在两圆上同角
 * （(r1−r2)/d 的相似变换口径），PoseSketcher TangentConnect 同形态。
 * d 太小（同心）返回 null。
 */
export function capsuleTangents(
  x1: number, y1: number, r1: number,
  x2: number, y2: number, r2: number,
): {
  phi: number; beta: number; d: number;
  t1a: { x: number; y: number }; t2a: { x: number; y: number };
  t1b: { x: number; y: number }; t2b: { x: number; y: number };
} | null {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return null;
  const phi = Math.atan2(dy, dx);
  const beta = Math.acos(Math.min(1, Math.max(-1, (r1 - r2) / d)));
  const a1 = phi + beta, a2 = phi - beta;
  const pt = (cx: number, cy: number, r: number, a: number) => ({
    x: cx + r * Math.cos(a), y: cy + r * Math.sin(a),
  });
  return {
    phi, beta, d,
    t1a: pt(x1, y1, r1, a1), t2a: pt(x2, y2, r2, a1),
    t1b: pt(x1, y1, r1, a2), t2b: pt(x2, y2, r2, a2),
  };
}

function renderMannequin(
  ctx: CanvasRenderingContext2D,
  instruction: MannequinRenderInstruction,
): void {
  const x1 = subToPx(instruction.x1), y1 = subToPx(instruction.y1);
  const x2 = subToPx(instruction.x2), y2 = subToPx(instruction.y2);
  // 两端粗细各自取本端关节的半径（与关节盘同源：jointWidth/2 首选），
  // 体形 = 两圆切线连接体（渐变），不再把两端平均成直筒
  const r1 = Math.max(0.5, instruction.r1), r2 = Math.max(0.5, instruction.r2);
  ctx.save();
  const traceCapsule = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) => {
    ctx.beginPath();
    const t = capsuleTangents(ax, ay, ar, bx, by, br);
    if (!t || t.d + Math.min(ar, br) <= Math.max(ar, br)) {
      // 退化（同点/一圆吞另一圆）：两端圆并集
      ctx.moveTo(ax + ar, ay); ctx.arc(ax, ay, ar, 0, Math.PI * 2);
      ctx.moveTo(bx + br, by); ctx.arc(bx, by, br, 0, Math.PI * 2);
      return;
    }
    const a1 = t.phi + t.beta, a2 = t.phi - t.beta;
    ctx.moveTo(t.t1a.x, t.t1a.y);
    ctx.lineTo(t.t2a.x, t.t2a.y);
    ctx.arc(bx, by, br, a1, a2, true);
    ctx.lineTo(t.t1b.x, t.t1b.y);
    ctx.arc(ax, ay, ar, a2, a1, true);
    ctx.closePath();
  };
  traceCapsule(x1, y1, r1 + 1, x2, y2, r2 + 1);
  ctx.fillStyle = instruction.outlineColor;
  ctx.fill();
  traceCapsule(x1, y1, r1, x2, y2, r2);
  ctx.fillStyle = instruction.fillColor;
  ctx.fill();
  // 衣物色区：自起点起 clothRatio 一段的子体（半径沿段插值）
  const cloth = instruction.clothRatio ?? 0;
  if (cloth > 0) {
    const ct = Math.min(1, cloth);
    const cxp = x1 + (x2 - x1) * ct, cyp = y1 + (y2 - y1) * ct;
    traceCapsule(x1, y1, r1, cxp, cyp, r1 + (r2 - r1) * ct);
    ctx.fillStyle = '#5b7ea6';
    ctx.fill();
  }
  if (instruction.head) {
    // 蛋形头替代末端关节圆：长轴沿颈向的椭圆（头不是胶囊段）
    const h = instruction.head;
    const cx = subToPx(h.cx), cy = subToPx(h.cy);
    ctx.beginPath();
    ctx.ellipse(cx, cy, h.a, h.b, h.angleRad, 0, Math.PI * 2);
    ctx.fillStyle = instruction.fillColor;
    ctx.fill();
    ctx.strokeStyle = instruction.outlineColor;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    // 五官线段（仅五官参照开启时生成端才写入）
    if (instruction.faceSegs) {
      ctx.strokeStyle = '#22d3ee';
      ctx.fillStyle = '#22d3ee';
      ctx.lineWidth = 1.25;
      for (const s of instruction.faceSegs) {
        const fx1 = subToPx(s.x1), fy1 = subToPx(s.y1);
        const fx2 = subToPx(s.x2), fy2 = subToPx(s.y2);
        ctx.beginPath(); ctx.moveTo(fx1, fy1); ctx.lineTo(fx2, fy2); ctx.stroke();
        ctx.beginPath(); ctx.arc((fx1 + fx2) / 2, (fy1 + fy2) / 2, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
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

  // 拾取通道：盘在全部精灵之前画（始终被遮挡），编号图同序——盘的
  // 编号先落、随后被精灵剪影覆盖，与视觉一致
  if (activePickPass && instruction.nodeId) {
    const pctx = activePickPass.ctx;
    pctx.save();
    pctx.beginPath();
    pctx.ellipse(x, y, radius, radius, 0, 0, Math.PI * 2);
    pctx.fillStyle = pickColorFor(instruction.nodeId);
    pctx.fill();
    pctx.restore();
  }

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
  editorFx?: { sleeveRatio?: number; pantsRatio?: number; fogStrength?: number; faceGuide?: boolean },
  clampCtxFor?: (character: Character) => ClampContext | undefined,
  simCtxFor?: (character: Character) => SimContext | undefined,
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
      pickSlashClip(animationClips, activeClipId, unifiedCharacter.id, currentFrame, unifiedCharacter.slashDefs) ?? null,
      mannequinFallback,
      editorFx,
      clampCtxFor?.(unifiedCharacter),
      simCtxFor?.(unifiedCharacter),
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
  editorFx?: { sleeveRatio?: number; pantsRatio?: number; fogStrength?: number; faceGuide?: boolean },
  clampCtxFor?: (character: Character) => ClampContext | undefined,
  simCtxFor?: (character: Character) => SimContext | undefined,
): void {
  // 有画布修改器在场时，背景填充推迟到 applyCanvasModifiers 之后以
  // destination-over 垫底：修改器按 alpha 定轮廓（描边带、掩码等），
  // 先填背景会让整幅画布 alpha=255、轮廓集变成整幅画布而带为空。
  // 背景是纯色填充、其余绘制以 source-over 叠加，最终合成逐像素
  // 等价（结合律）；无修改器时保持原顺序，零行为变化。
  // 推迟时入口先清画布：调用方（主画布）可能已在同一 ctx 上画过
  // 洋葱影等先行内容，旧流程靠背景填充盖住、从不进入修改器的
  // alpha 读取；不清则推迟后它们会混进轮廓集。清后恢复「每帧从
  // 已知（透明）状态起笔」的前提，修改器读到的 alpha 只有当前帧。
  const deferBgFill = backgroundColor !== 'transparent'
    && !!canvasModifierTracks && canvasModifierTracks.length > 0;
  if (backgroundColor !== 'transparent' && !deferBgFill) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  if (deferBgFill) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }
  if (unifiedCharacters && Object.keys(unifiedCharacters).length > 0) {
    renderPuppetViaUnifiedPipeline(
      ctx, canvasWidth, canvasHeight, unifiedCharacters,
      currentFrame, frameRate, globalModifiers, animationVariables,
      canvasModifierTracks, proceduralAnimations, globalBlueprint, sprites,
      perspectiveForeshorten, animationClips, activeClipId, geometryDirection,
      mannequinFallback, editorFx, clampCtxFor, simCtxFor,
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
  if (deferBgFill) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }
}

/**
 * Render a single frame to a canvas for export/SAM (new model only).
 */
export function renderUnifiedToCanvas(
  canvasWidth: number,
  canvasHeight: number,
  _parts: Sprite[],
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
  // 背景填充时机与 renderUnified 同口径：有画布修改器时推迟到
  // applyCanvasModifiers 之后 destination-over 垫底，避免背景 alpha
  // 污染修改器的轮廓集；无修改器时原顺序不变。
  const deferBgFill = !!backgroundColor && backgroundColor !== 'rgba(0,0,0,0)'
    && !!canvasModifierTracks && canvasModifierTracks.length > 0;
  if (backgroundColor && backgroundColor !== 'rgba(0,0,0,0)' && !deferBgFill) {
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
  if (deferBgFill) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
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
