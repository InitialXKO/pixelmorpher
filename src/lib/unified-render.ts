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
  NodeRenderInstruction, DiscRenderInstruction, RenderPlan,
  KeyframeTrack, KeyframePoint, InterpolationMode,
  ModifierInstance, GeneratedItem, AnimationVariable, ParamDriver,
  IKChain, Mat3,
} from './unified-types';
import {
  subToPx, halfPixelAlignSub, DEFAULT_MIRROR_MAP, projectToView, rotateInViewPlane,
  resolveChainTarget3D,
  mat3Mul, mat3Transpose, mat3Apply, localRotMat, rotMatD, applyFrameRotation, frameViewAngle,
  frameViewAngleForDirection, frameYAxisWorld,
  worldToViewBasis, MAT3_IDENTITY,
} from './unified-types';
import { solveIK2Bone3D, solveIKFabrik3D } from './blueprint/ik';
import { renderPixelPerfectRotation } from './engine/puppet-utils';
import { releaseCanvas } from './engine/canvas-pool';
import { sampleJointDiscColor, getPlugJointWidth } from './engine/render-helpers/puppet-joint-color';
import {
  getDiscCacheKey, getCachedDisc, setCachedDisc,
  clearRenderCaches,
} from './engine/render-cache';
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
import { applyProceduralAnimations } from './engine/skeleton';
import { applyCanvasModifiers } from './engine/canvas-modifiers';
// Blueprint evaluation (path B: unified transform + pixel via blueprint)
import { evaluateBlueprint, collectDynamicStrokes, evaluateCostumeState } from './blueprint/eval';
import { modifiersToBlueprint } from './blueprint/migrate';
import type { BlueprintEvalContext } from './blueprint/ir';
import { isIKChainSuspended } from './ik-drag-state';
import type { BlueprintGraph } from './blueprint/ir';
import type { VariableContext as EngineVariableContext } from './engine/param-driver';
import type {
  PixelGrid, ModifierType, Keyframe, Skeleton, ProceduralAnimation,
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
export function computeWorldTransforms(
  character: Character,
  frame: number,
  canvasWidth: number,
  canvasHeight: number,
  frameRate: number = 12,
  variableContext?: VariableContext,
  blueprintTransforms?: Map<string, BlueprintTransformResult>,
  ikOverrides?: Map<string, { angle: number; tilt: number }>,
  geometryDirection?: DirectionIndex,
): Map<string, WorldTransform> {
  const transforms = new Map<string, WorldTransform>();

  const rootNode = character.nodes[character.rootNodeId];
  if (!rootNode) return transforms;

  // Root node: center of canvas + node's own offset
  const rootInterpolated = interpolateTransform(rootNode, frame, frameRate, variableContext, blueprintTransforms, ikOverrides);
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
  computeChildTransforms(rootNode, rootWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms, ikOverrides, geometryDirection);

  // IK（乙：真 3D）：首遍 FK 后解出各链关节的局部 (angle, tilt) 覆写，整树重算 FK——
  // 链外后代随 frame 复合自动跟随。ikOverrides 已传入时（重算遍）不再求解。
  if (!ikOverrides) {
    if (character.ikBlueprint) {
      applyBakedIKBlueprint(character, transforms, variableContext?.values);
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
): void {
  const blueprint = character.ikBlueprint;
  if (!blueprint) return;

  const ctx: BlueprintEvalContext = { frame: 0, frameRate: 12, vars: vars ?? {} };

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
): void {
  for (const childId of parentNode.children) {
    const childNode = character.nodes[childId];
    if (!childNode) continue;

    const childInterpolated = interpolateTransform(childNode, frame, frameRate, variableContext, blueprintTransforms, ikOverrides);
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
    computeChildTransforms(childNode, childWorld, character, frame, transforms, frameRate, variableContext, blueprintTransforms, ikOverrides, geometryDirection);
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
  const theta = (((variantIndex + 2) % 8) * Math.PI) / 4;
  return { x: sx * Math.cos(theta), y: sy, z: sx * Math.sin(theta) };
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
): NodeTransform {
  const r = interpolateTransformImpl(node, frame, frameRate, variableContext, blueprintTransforms);
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
): { sprite: Sprite | null; mirror: boolean; spriteId: string | null } {
  // 参数化优先（用户拍板）：生效服装件带 parametric 时，主画布以参数化
  // 烘焙精灵渲染，盖过精灵图。件键走产品回退口径 slot.slotKey ?? nodeId。
  if (costumeSet) {
    const piece = costumeSet.pieces[node.slot?.slotKey ?? node.id];
    if (piece?.parametric) {
      const { buildParametricSprite, PARAMETRIC_MIRROR_DIRECTIONS } = require('./proc-runtime/main-canvas') as typeof import('./proc-runtime/main-canvas');
      const spr = buildParametricSprite(piece.parametric, node.id);
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
    // 无精灵可遮盖（占位/结构节点）不出盘：node.sprite 现行管线不赋值，
    // 以 slot 精灵条目为准（烘焙占位节点的 slot.sprites 为空）
    if (!node.sprite && Object.keys(node.slot?.sprites ?? {}).length === 0) continue;

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

    // 关节盘直径 = plug 侧开口宽度（与 carve 同源，不再与 parent bottom 求平均）。
    // 优先用 attachment.jointWidth（创建时写入），否则按 plug 位置回退估算。
    const storedJointWidth = node.attachment?.jointWidth;
    let diameter: number;
    if (typeof storedJointWidth === 'number' && storedJointWidth > 0) {
      diameter = storedJointWidth;
    } else {
      const childPiece = node.slot;
      const plugCS = childPiece?.crossSections.find(cs => cs.id === (node.generated?.crossSectionId ?? 'plug'));
      const bottomCS = childPiece?.crossSections.find(cs => cs.id === 'bottom');
      diameter = getPlugJointWidth(
        {
          plug: node.attachment?.plug
            ? { localX: subToPx(node.attachment.plug.x), localY: subToPx(node.attachment.plug.y) }
            : null,
          crossSectionTop: plugCS?.diameter,
          crossSectionBottom: bottomCS?.diameter,
        },
        node.sprite
          ? {
              width: node.sprite.width,
              height: node.sprite.height,
              pivotX: subToPx(node.sprite.plug?.x ?? 0),
              pivotY: subToPx(node.sprite.plug?.y ?? 0),
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
      const resolved = resolveSprite(node, currentDirection, activeCostumeSet, spriteTable, character.slotVariants?.[node.slot?.slotKey ?? ''], character.latitude ?? 0);
      const spr = resolved.sprite;
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
  clips: Array<{ id: string; puppetCharacterId?: string; stateKeyframes?: import('./unified-types').CostumeStateKeyframe[] }> | undefined,
  activeClipId: string | null | undefined,
  characterId: string,
): import('./unified-types').CostumeStateKeyframe[] | undefined {
  if (!clips || !activeClipId) return undefined;
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip || clip.puppetCharacterId !== characterId) return undefined;
  return clip.stateKeyframes;
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
    ? buildVariableContext(animationVariables, frame, allActiveDrivers)
    : undefined;

  // 蓝图变量（变量名 → 本帧值，含 writer 驱动求值）：全部蓝图求值入口统一从此注入
  const blueprintVars: Record<string, number> = variableContext?.values ?? {};

  // Phase 0 (path B): Evaluate node blueprints for transform values (two-pass)
  const blueprintTransforms = blueprintTransformsOverride ?? evaluateBlueprintTransforms(character, frame, frameRate, blueprintVars);

  // 生效服装状态：静态字段 → clip 状态轨道 → 状态蓝图（三层增量叠加）
  const effCostume = resolveEffectiveCostumeState(character, frame, frameRate, stateKeyframes, blueprintVars);

  // Step 1: World transforms (includes blueprint-evaluated modifier contributions)
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
    let { sprite, mirror } = resolveSprite(node, resolveDir, activeCostumeSet, spriteTable, effCostume.slotVariants[node.slot?.slotKey ?? ''], character.latitude ?? 0);
    if (!sprite) continue;

    // 方向间过渡（蒙皮转面 A）：blend 不为 0/1 时，双精灵 faceTurn + alpha 混合
    // 只在需要时双采样，避免性能开销
    let blendedSprite: typeof sprite | null = null;
    if (dirBlend && sprite.data) {
      const { sprite: spriteB } = resolveSprite(node, dirBlend.dirB, activeCostumeSet, spriteTable, effCostume.slotVariants[node.slot?.slotKey ?? ''], character.latitude ?? 0);
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
      const thR = (((currentDirection + 2) % 8) * Math.PI) / 4;
      const hr = yw.x * Math.cos(thR) + yw.z * Math.sin(thR);
      foreshorten = Math.min(1, Math.hypot(hr, yw.y));
    }
    nodeInstructions.push({
      nodeId,
      sprite: effectiveSprite,
      worldX: halfPixelAlignSub(pxToSub(canvasWidth / 2) + (proj.canvasX as SubPixel)) as SubPixel,
      worldY: halfPixelAlignSub(pxToSub(canvasHeight / 2) + (proj.canvasY as SubPixel)) as SubPixel,
      angle: worldTf.worldAngle,
      stretch: worldTf.worldStretch,
      foreshorten,
      variantIndex: worldTf.variantIndex,
      rotationStrategy: strategy,
      mirror: mirror || worldTf.mirror,
      // 3D 深度排序替代 zIndex：depth 越大越靠前（后绘制）
      zIndex: proj.depth,
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
      scaleX: worldTf.scaleX,
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

  // Step 5: Generate disc instructions
  const discInstructions = generateDiscInstructions(character, worldTransforms, canvasWidth, canvasHeight, currentDirection, activeSnapshots, activeCostumeSet, spriteTable, geometryDirection);

  // Step 6: 节点指令按 zIndex（投影深度）排序；关节盘不进排序流，
  // 由执行端从 discInstructions 单独先行绘制（无视深度、始终被遮挡）
  const allInstructions: NodeRenderInstruction[] = [...nodeInstructions];
  allInstructions.sort((a, b) => a.zIndex - b.zIndex);

  return {
    nodeInstructions,
    discInstructions,
    sortedInstructions: allInstructions,
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
  const useCharBlueprint = !!plan.characterBlueprint;
  if (useCharBlueprint) {
    const ok = renderCharacterWithBlueprint(ctx, plan, canvasWidth, canvasHeight);
    if (!ok) {
      // Fallback: legacy per-node draw (blueprint invalid — don't lose the frame)
      // 关节盘先行（不参与深度排序、始终被遮挡），节点随后按深度序绘制
      for (const disc of plan.discInstructions) renderDisc(ctx, disc);
      for (const instruction of plan.sortedInstructions) {
        renderNodeSprite(ctx, instruction, canvasWidth, canvasHeight, plan.blueprintVars);
      }
    }
  } else {
    for (const disc of plan.discInstructions) renderDisc(ctx, disc);
    for (const instruction of plan.sortedInstructions) {
      renderNodeSprite(ctx, instruction, canvasWidth, canvasHeight, plan.blueprintVars);
    }
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
  'color_replace', 'outline', 'dither', 'pixel_displace',
  'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip', 'pixel_edit',
];

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

  // Create offscreen canvas from (possibly modified) sprite data
  // 可逆性：分部件尺度差换算。精灵是分部件像素（相机紧→图里大），节点是全局像素，
  // 绘制时按比例缩放对齐。scaleFactor = partCameraHalf / globalCameraHalf（记录的尺度差，可逆）
  // 相机紧（partCH小）→ 精灵在图里占比大 → 需缩小到全局尺度
  // TODO: 用户反馈烘焙精灵已正确但渲染裁剪，暂禁用缩放排查
  const partCH = sprite.partCameraHalf ?? 1.0;
  const globalCH = sprite.globalCameraHalf ?? 1.0;
  const scaleFactor = 1.0; // partCH / globalCH;

  let spriteCanvas = pixelsToCanvas(effectivePixels, sprite.width, sprite.height);
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
  let pivotX = (sprite.plug?.x !== undefined ? subToPx(sprite.plug.x) * scaleFactor : spriteCanvas.width / 2) + modOffsetX;
  const pivotY = (sprite.plug?.y !== undefined ? subToPx(sprite.plug.y) * scaleFactor : spriteCanvas.height / 2) + modOffsetY;

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

  // Compute the draw position (where the pivot lands on canvas)
  const drawPivotX = subToPx(worldX);
  const drawPivotY = subToPx(worldY);

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
      { scaleX, skews },
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

    // Render "on top" effects after the sprite for pixel-perfect rotation path
    // Preview quality: skip particle effects in low quality mode (old parity).
    const topEffectMods = previewQuality === 'low' ? [] : modifiers.filter(m =>
      m.enabled && m.type === 'particle'
    );
    if (topEffectMods.length > 0) {
      ctx.save();
      ctx.translate(Math.round(drawPivotX), Math.round(drawPivotY));
      ctx.rotate((angle * Math.PI) / 180);
      ctx.scale(scaleX, effStretch);
      for (const { skewX, skewY } of skews) {
        ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
      }
      for (const mod of topEffectMods) {
        renderParticleEffect(ctx, nodeId, sprite, mod as any, frame);
      }
      ctx.restore();
    }
  } else {
    // Native Canvas2D or no rotation: draw in the already-transformed space
    ctx.drawImage(workingCanvas, -pivotX, -pivotY);

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
export function pixelsToCanvas(pixels: PixelGrid, width: number, height: number): HTMLCanvasElement | null {
  if (!pixels || pixels.length === 0) return null;
  if (width <= 0 || height <= 0) return null;

  const canvasW = pixels[0]?.length ?? width;
  const canvasH = pixels.length ?? height;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  const imageData = ctx.createImageData(canvasW, canvasH);
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      const color = pixels[y]?.[x];
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
  for (const instruction of plan.sortedInstructions) {
    renderNodeSprite(offCtx, instruction, canvasWidth, canvasHeight, plan.blueprintVars);
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
): void {
  const hasGlobalTransform = applyGlobalTransformWrapper(
    ctx, canvasWidth, canvasHeight, globalModifiers, currentFrame, frameRate, globalBlueprint,
    buildBlueprintVars(mapStoreAnimationVariables(animationVariables), currentFrame),
  );
  for (const unifiedCharacter of Object.values(unifiedCharacters)) {
    const unifiedVars = mapStoreAnimationVariables(animationVariables);
    const plan = generateRenderPlan(
      unifiedCharacter, currentFrame, canvasWidth, canvasHeight,
      'pixel-perfect', frameRate, unifiedVars,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, proceduralAnimations, sprites,
      undefined, perspectiveForeshorten,
      pickClipStateKeyframes(animationClips, activeClipId, unifiedCharacter.id),
      geometryDirection,
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
  skeletons: Skeleton[] | undefined,
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
      ? collectDynamicStrokes(globalBlueprint, currentFrame, frameRate, buildBlueprintVars(mapStoreAnimationVariables(animationVariables), currentFrame))
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
      ? collectDynamicStrokes(globalBlueprint, currentFrame, frameRate, buildBlueprintVars(mapStoreAnimationVariables(animationVariables), currentFrame))
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
  skeletons?: Skeleton[],
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
  nodeKeyframes: any[],
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
      pickClipStateKeyframes(animationClips, activeClipId, character.id),
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
