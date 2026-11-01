// ============================================================
// editor-world-transforms — 覆盖层/拾取共用的世界变换构造
//
// 主画布出图（PixelCanvas → renderUnified → generateRenderPlan）给
// computeWorldTransforms 喂三份上下文：钳制锚定（clamp-session 会话步
// 进）、链摆实时模拟（sim-session 会话步进）、程序化增量图
// （computeFrameProcDeltas），外加变量上下文与蓝图变换。覆盖层（骨骼
// 线/IK 手柄/钳制 gizmo/五官引导/枢轴）与几何拾取此前直接调
// computeWorldTransforms 且三份上下文全传 undefined——程序化增量、
// 钳制、模拟生效时，覆盖层与拾取算出的关节位与出图不一致（审计
// F-20）。本 helper 按主画布同一构造装配全部输入，覆盖层/拾取一律
// 走这里，不再裸调 computeWorldTransforms。
// ============================================================

import {
  computeWorldTransforms,
  computeFrameProcDeltas,
  facingDirBlendOf,
  evaluateBlueprintTransforms,
  collectActiveParamDrivers,
  resolveEffectiveCostumeState,
  pickClipStateKeyframes,
  type WorldTransform,
} from './unified-render';
import { buildVariableContext, mapStoreAnimationVariables } from './unified-animation-resolver';
import { getActiveCostumeSet } from './sprite-resolve';
import { editorClampContextFor } from './clamp-session';
import { editorSimContextFor } from './sim-session';
import { useProjectStore, useEditorStore } from './store';
import type { Character, DirectionIndex } from './unified-types';

export interface EditorWorldTransformOpts {
  canvasWidth: number;
  canvasHeight: number;
  frameRate?: number;
  geometryDirection?: DirectionIndex;
}

/**
 * 与主画布出图同口径的世界变换：变量上下文、蓝图变换、生效服装状态、
 * 程序化增量、钳制/模拟会话上下文全部按 generateRenderPlan 的输入
 * 装配。离线/无 store 语境不在此列（烘焙/导出走 generateRenderPlan）。
 */
export function computeEditorWorldTransforms(
  character: Character,
  frame: number,
  opts: EditorWorldTransformOpts,
): Map<string, WorldTransform> {
  const ps = useProjectStore.getState();
  const frameRate = opts.frameRate ?? ps.frameRate ?? 12;

  // 变量上下文 + 蓝图变换（与 generateRenderPlan Phase 0 同口径）
  const mappedVars = mapStoreAnimationVariables(ps.animationVariables);
  const variableContext = mappedVars && mappedVars.length > 0
    ? buildVariableContext(mappedVars, frame, collectActiveParamDrivers(character), frameRate)
    : undefined;
  const blueprintTransforms = evaluateBlueprintTransforms(
    character, frame, frameRate, variableContext?.values ?? {},
  );

  // 生效服装状态（静态 → clip 状态轨道 → 状态蓝图）与生效服装集
  const stateKeyframes = pickClipStateKeyframes(
    ps.animationClips, ps.activeAnimationClipId, character.id, frame,
  );
  const effCostume = resolveEffectiveCostumeState(
    character, frame, frameRate, stateKeyframes, variableContext?.values ?? {},
  );
  const activeCostumeSet = getActiveCostumeSet(character.costumeSets, effCostume.costumeSetId);

  // 程序化增量图（与出图预备段同一实现）
  const procDeltas = computeFrameProcDeltas(character, frame, frameRate, ps.proceduralAnimations, {
    spriteTable: ps.sprites,
    activeCostumeSet,
    slotVariants: effCostume.slotVariants,
    dirBlend: facingDirBlendOf(character),
    variableContext,
    blueprintTransforms,
  });

  // 钳制锚定 / 链摆模拟会话上下文（与 PixelCanvas 传 renderUnified 的
  // clampCtxFor/simCtxFor 逐字同口径）
  const clampCtx = editorClampContextFor(character, frame, ps.animationClips, {
    canvasWidth: opts.canvasWidth,
    canvasHeight: opts.canvasHeight,
    frameRate,
    sprites: ps.sprites,
  });
  const simCtx = useEditorStore.getState().simRealtimePreview
    ? editorSimContextFor(character, frame, ps.animationClips, {
        canvasWidth: opts.canvasWidth,
        canvasHeight: opts.canvasHeight,
        frameRate,
      })
    : undefined;

  return computeWorldTransforms(
    character, frame, opts.canvasWidth, opts.canvasHeight, frameRate,
    variableContext, blueprintTransforms, undefined, opts.geometryDirection,
    clampCtx, simCtx, procDeltas,
  );
}
