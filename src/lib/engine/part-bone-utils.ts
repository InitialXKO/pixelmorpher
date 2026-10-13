// ============================================================
// PixelMorpher - Part Bone Utilities (transitional)
// Moved from render-pipeline.ts (deleted) — used by renderPartsUnified
// ============================================================

import type {
  Part, Keyframe, Skeleton, ProceduralAnimation,
  AnimationVariable, ParamDriver, ModifierInstance, Bone,
} from '../types';
import type { VariableContext } from './param-driver';
import {
  resolveKeyframeModifierParams, buildVariableContext,
  EMPTY_VARIABLE_CONTEXT,
  cachedVariableContext, cachedVariableContextFrame, cachedVariableContextHash,
  setCachedVariableContext,
} from './param-driver';
import {
  getActiveDriversCache,
  getModifierResolveCacheKeyframesRef, getModifierResolveCacheMap,
  setModifierResolveCacheKeyframesRef, getFrameCacheMax,
} from './frame-cache';
import { computeBoneTransforms, applyProceduralAnimations } from './skeleton';
import { interpolateModifiers } from './interpolation';

// Module-level cache for part bone bindings
const _partBoneBindingsCache: {
  skeletonsRef: Skeleton[] | null;
  bindings: Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>>;
} = { skeletonsRef: null, bindings: new Map() };

export function buildVariableContextForFrame(
  keyframes: Keyframe[],
  animationVariables: AnimationVariable[] | undefined,
  currentFrame: number,
): VariableContext {
  // P4-4: Cache allActiveDrivers — only rebuild when keyframes reference changes.
  // During normal playback (no edits), keyframes array is the same reference,
  // so this avoids O(keyframes × modifiers × drivers) scan every frame.
  const cacheKey = keyframes;
  if (getActiveDriversCache().keyframes !== cacheKey) {
    const allActiveDrivers: ParamDriver[] = [];
    if (animationVariables && animationVariables.length > 0) {
      for (const kf of keyframes) {
        for (const mod of kf.modifiers) {
          if (mod.paramDrivers) {
            for (const d of mod.paramDrivers) {
              if (d.enabled && !d.isBaked) allActiveDrivers.push(d);
            }
          }
        }
      }
    }
    getActiveDriversCache().keyframes = cacheKey;
    getActiveDriversCache().drivers = allActiveDrivers;
  }
  const allActiveDrivers = getActiveDriversCache().drivers;
  let variableContext: VariableContext;
  if (animationVariables && animationVariables.length > 0) {
    // Check for structural changes in variable definitions
    const varHash = animationVariables.map(v => `${v.id}:${v.mode ?? 'v'}`).join(',');
    const hasAccumulators = animationVariables.some(v => v.mode === 'accumulator');
    let prevCtx: VariableContext | undefined;

    if (hasAccumulators) {
      // For accumulator variables, we need the previous frame's context.
      // Use cached context if it's from the previous frame and variables haven't changed.
      if (cachedVariableContextFrame === currentFrame - 1 && cachedVariableContextHash === varHash) {
        prevCtx = cachedVariableContext;
      }
    }

    variableContext = buildVariableContext(animationVariables, allActiveDrivers, currentFrame, prevCtx);

    // Cache this frame's context for next frame (for accumulator support)
    if (hasAccumulators) {
      setCachedVariableContext(variableContext, currentFrame, varHash);
    }
  } else {
    variableContext = EMPTY_VARIABLE_CONTEXT; // P4-8: reuse shared empty context
  }
  return variableContext;
}

export function buildPartBoneBindingsMap(
  skeletons: Skeleton[] | undefined,
): Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>> {
  if (!_partBoneBindingsCache.skeletonsRef || _partBoneBindingsCache.skeletonsRef !== skeletons) {
    const partBoneBindings = new Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>>();
    if (skeletons) {
      for (const skeleton of skeletons) {
        for (const bone of skeleton.bones) {
          for (const binding of bone.boundParts) {
            const existing = partBoneBindings.get(binding.partId) || [];
            existing.push({ skeletonId: skeleton.id, bone, weight: binding.weight });
            partBoneBindings.set(binding.partId, existing);
          }
        }
      }
    }
    _partBoneBindingsCache.skeletonsRef = skeletons ?? null;
    _partBoneBindingsCache.bindings = partBoneBindings;
  }
  return _partBoneBindingsCache.bindings;
}

export function resolvePartKeyframe(
  part: Part,
  kfByPart: Map<string, Keyframe[]>,
  currentFrame: number,
  variableContext: VariableContext,
  keyframesRef: Keyframe[],
  proceduralAnimations: ProceduralAnimation[] | undefined,
): Keyframe | null {
  const partKeyframes = kfByPart.get(part.id) || [];

  // P5-3: Pre-compute ParamDriver inheritance for all modifier types in this part.
  // Instead of calling collectActiveParamDrivers (O(K) per modifier) for each modifier,
  // walk the keyframes once and build a Map<modifierType, ParamDriver[]> cache.
  // This reduces O(modifiers × keyframes) to O(keyframes) for the inheritance lookup.
  const driverInheritanceCache = new Map<string, ParamDriver[] | undefined>();
  let hasAnyUndefinedDrivers = false;
  for (const kf of partKeyframes) {
    for (const mod of kf.modifiers) {
      if (mod.paramDrivers !== undefined) {
        // This keyframe defines drivers for this modifier type — update the cache
        // Only cache if this keyframe is at or before currentFrame
        if (kf.frame <= currentFrame) {
          driverInheritanceCache.set(mod.type, mod.paramDrivers);
        }
      } else {
        hasAnyUndefinedDrivers = true;
      }
    }
  }
  // If no modifier has undefined paramDrivers, no inheritance is needed
  const needsInheritance = hasAnyUndefinedDrivers;

  // Find surrounding keyframes — binary search O(log K) instead of linear O(K)
  let prevKf: Keyframe | null = null;
  let nextKf: Keyframe | null = null;

  if (partKeyframes.length > 0) {
    // Binary search: find the last keyframe with frame <= currentFrame
    let lo = 0, hi = partKeyframes.length - 1;
    let prevIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (partKeyframes[mid].frame <= currentFrame) {
        prevIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (prevIdx >= 0) prevKf = partKeyframes[prevIdx];
    if (prevIdx + 1 < partKeyframes.length) nextKf = partKeyframes[prevIdx + 1];
  }

  // Determine which keyframe to use for rendering
  let renderKf: Keyframe | null = prevKf;

  // If we have both prev and next, interpolate
  if (prevKf && nextKf && prevKf.frame !== nextKf.frame) {
    const t = (currentFrame - prevKf.frame) / (nextKf.frame - prevKf.frame);
    // P9: Cache key for interpolation — quantize t to 4 decimal places
    // to avoid cache misses from floating-point differences
    const interpCacheKey = `${prevKf.id}:${nextKf.id}:${t.toFixed(4)}`;
    const interpolatedMods = interpolateModifiers(
      prevKf.modifiers, nextKf.modifiers, t,
      prevKf.interpolationMode ?? 'linear',
      prevKf.bezierCP1,
      prevKf.bezierCP2,
      interpCacheKey,
    );
    renderKf = {
      ...prevKf,
      modifiers: interpolatedMods,
    };
  }

  // If no keyframe at this frame, use the part's default position
  if (!renderKf && partKeyframes.length > 0) {
    renderKf = partKeyframes[0];
  }

  // M6+M7: Resolve per-modifier param keyframes and/or param drivers FIRST,
  // so that procedural animations add their offsets on top of resolved values.
  // ParamDrivers now persist across keyframes via step-interpolation:
  // if a modifier doesn't define paramDrivers, it inherits from the nearest
  // earlier keyframe's modifier of the same type.
  // B4: Use LRU cache for modifier resolution — skip redundant per-part per-frame resolution.
  if (renderKf && renderKf.modifiers.some(m =>
    (m.paramKeyframes && m.paramKeyframes.length > 0) ||
    m.paramDrivers !== undefined ||
    // Also check if any modifier needs inherited drivers (paramDrivers undefined but
    // earlier keyframes might have them). We optimistically resolve if any modifier
    // has paramKeyframes or if there are keyframes with paramDrivers in the part.
    partKeyframes.some(kf => kf.modifiers.some(km =>
      km.paramDrivers !== undefined && km.paramDrivers.length > 0 &&
      km.paramDrivers.some(d => d.enabled && !d.isBaked)
    ))
  )) {
    // B4: Check modifier resolution cache
    const resolveCacheKey = `${part.id}:${currentFrame}`;
    const cachedResolve = getModifierResolveCacheKeyframesRef() === keyframesRef
      ? getModifierResolveCacheMap().get(resolveCacheKey)
      : undefined;

    if (cachedResolve) {
      renderKf = cachedResolve;
    } else {
      // Step 1: Collect inherited ParamDrivers for each modifier type.
      // P5-3: Use pre-computed driverInheritanceCache instead of O(K) scan per modifier.
      const resolvedMods = renderKf.modifiers.map(mod => {
        let effectiveDrivers = mod.paramDrivers;
        if (effectiveDrivers === undefined && needsInheritance) {
          // O(1) cache lookup instead of O(K) backward scan
          effectiveDrivers = driverInheritanceCache.get(mod.type);
        }
        return { ...mod, paramDrivers: effectiveDrivers };
      });

      // Step 2: Resolve paramKeyframes and ParamDrivers for each modifier.
      // No more keyframeEndFrame clamping — ParamDriver lifetime is controlled
      // by its own startFrame/endFrame, not by keyframe boundaries.
      // M8: Pass variableContext for paramSources resolution.
      renderKf = {
        ...renderKf,
        modifiers: resolveKeyframeModifierParams(
          resolvedMods,
          currentFrame,
          renderKf.interpolationMode ?? 'linear',
          renderKf.bezierCP1,
          renderKf.bezierCP2,
          variableContext,
        ),
      };

      // B4: Store in modifier resolution cache
      if (getModifierResolveCacheKeyframesRef() !== keyframesRef) {
        getModifierResolveCacheMap().clear();
        setModifierResolveCacheKeyframesRef(keyframesRef);
      }
      if (getModifierResolveCacheMap().size >= getFrameCacheMax()) {
        const firstKey = getModifierResolveCacheMap().keys().next().value;
        if (firstKey !== undefined) getModifierResolveCacheMap().delete(firstKey);
      }
      getModifierResolveCacheMap().set(resolveCacheKey, renderKf);
    }
  }

  // V2.0: Apply procedural animations to modifiers AFTER paramDriver resolution
  // so procedural offsets add on top of resolved base values
  if (renderKf && proceduralAnimations && proceduralAnimations.length > 0) {
    renderKf = {
      ...renderKf,
      modifiers: applyProceduralAnimations(renderKf.modifiers, proceduralAnimations, part.id, currentFrame),
    };
  }

  return renderKf;
}

export function applyBoneDrivenTransforms(
  renderKf: Keyframe,
  partId: string,
  partBoneBindings: Map<string, Array<{ skeletonId: string; bone: Bone; weight: number }>>,
  boneTransforms: Map<string, Map<string, { rotation: number; headX: number; headY: number; tailX: number; tailY: number }>>,
): Keyframe {
  if (partBoneBindings.size === 0) return renderKf;

  const bindings = partBoneBindings.get(partId);
  if (!bindings || bindings.length === 0) return renderKf;

  let boneRotationOffset = 0;
  let boneTranslateX = 0;
  let boneTranslateY = 0;

  if (bindings.length === 1 && Math.abs(bindings[0].weight - 1.0) < 0.001) {
    // Single bone with full weight: apply as rigid transform
    const { skeletonId, bone } = bindings[0];
    const skeletonTransforms = boneTransforms.get(skeletonId);
    if (skeletonTransforms) {
      const boneTransform = skeletonTransforms.get(bone.id);
      if (boneTransform) {
        // Delta rotation from rest pose (poseRotation only, restRotation is base)
        boneRotationOffset = boneTransform.rotation - bone.restRotation;
        // Delta translation from rest position
        boneTranslateX = boneTransform.headX - bone.headX;
        boneTranslateY = boneTransform.headY - bone.headY;
      }
    }
  } else {
    // Multi-bone binding: simplified weighted average of bone deltas.
    // Per-pixel deformation is a future enhancement; for now we blend
    // rotation and translation by weight.
    let totalWeight = 0;
    for (const { skeletonId, bone, weight } of bindings) {
      const skeletonTransforms = boneTransforms.get(skeletonId);
      if (skeletonTransforms) {
        const boneTransform = skeletonTransforms.get(bone.id);
        if (boneTransform) {
          const deltaRotation = boneTransform.rotation - bone.restRotation;
          const deltaTranslateX = boneTransform.headX - bone.headX;
          const deltaTranslateY = boneTransform.headY - bone.headY;

          boneRotationOffset += deltaRotation * weight;
          boneTranslateX += deltaTranslateX * weight;
          boneTranslateY += deltaTranslateY * weight;
          totalWeight += weight;
        }
      }
    }
    // Normalize if weights don't sum to 1.0
    if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
      boneRotationOffset /= totalWeight;
      boneTranslateX /= totalWeight;
      boneTranslateY /= totalWeight;
    }
  }

  // Apply bone offsets to renderKf modifiers (additive to keyframe)
  if (boneRotationOffset !== 0 || boneTranslateX !== 0 || boneTranslateY !== 0) {
    const mods = [...renderKf.modifiers];

    // Apply rotation offset: add to existing rotate modifier or create one
    if (boneRotationOffset !== 0) {
      const rotateIdx = mods.findIndex(m => m.type === 'rotate' && m.enabled);
      if (rotateIdx !== -1) {
        const rotateMod = mods[rotateIdx];
        mods[rotateIdx] = {
          ...rotateMod,
          params: {
            ...rotateMod.params,
            angle: (Number(rotateMod.params.angle) || 0) + boneRotationOffset,
          },
        };
      } else {
        mods.push({
          id: `__bone_rotate_${partId}`,
          type: 'rotate',
          enabled: true,
          collapsed: false,
          params: { angle: boneRotationOffset },
          startFrame: -1,
          endFrame: -1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          blendMode: 'add',
          coordinateMode: 'parent_local',
        });
      }
    }

    // Apply translation offset: add to existing translate modifier or create one
    if (boneTranslateX !== 0 || boneTranslateY !== 0) {
      const translateIdx = mods.findIndex(m => m.type === 'translate' && m.enabled);
      if (translateIdx !== -1) {
        const translateMod = mods[translateIdx];
        mods[translateIdx] = {
          ...translateMod,
          params: {
            ...translateMod.params,
            offsetX: (Number(translateMod.params.offsetX) || 0) + boneTranslateX,
            offsetY: (Number(translateMod.params.offsetY) || 0) + boneTranslateY,
          },
        };
      } else {
        mods.push({
          id: `__bone_translate_${partId}`,
          type: 'translate',
          enabled: true,
          collapsed: false,
          params: { offsetX: boneTranslateX, offsetY: boneTranslateY },
          startFrame: -1,
          endFrame: -1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          blendMode: 'add',
          coordinateMode: 'parent_local',
        });
      }
    }

    return { ...renderKf, modifiers: mods };
  }

  return renderKf;
}
