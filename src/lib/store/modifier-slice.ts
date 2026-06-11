// ============================================================
// PixelMorpher - Modifier Slice
// Keyframe-level modifiers (add/remove/update/toggle, collapse, bake/unbake),
// modifier param keyframes, modifier range, scope-aware actions
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  ModifierType,
  AnimationBlendMode,
  ModifierCoordinateMode,
  ANIMATION_MODIFIER_TYPES,
  PartAnimationModifier,
  createDefaultModifier,
  ModifierParamValue,
  BrushCommand,
} from '../types';
import {
  invalidateAnimModifierCache,
  applyPixelModifiers,
  computeKeyframeBaseTransform,
  computePartAnimationTransform,
  combineTransformsComponentLevel,
  createPartCanvas,
  imageDataToPixelGrid,
  bakeParamDriverToKeyframes,
} from '../engine';
import { _isDragActive, _pendingTrajectoryPartIds } from './shared';

export type ModifierSlice = {
  addModifier: ProjectStore['addModifier'];
  removeModifier: ProjectStore['removeModifier'];
  updateModifier: ProjectStore['updateModifier'];
  toggleModifier: ProjectStore['toggleModifier'];
  toggleModifierCollapsed: ProjectStore['toggleModifierCollapsed'];
  reorderModifier: ProjectStore['reorderModifier'];
  collapseModifiers: ProjectStore['collapseModifiers'];
  uncollapseModifiers: ProjectStore['uncollapseModifiers'];
  bakeModifiers: ProjectStore['bakeModifiers'];
  bakeToTimeline: ProjectStore['bakeToTimeline'];
  updateModifierRange: ProjectStore['updateModifierRange'];
  addModifierToSubsequent: ProjectStore['addModifierToSubsequent'];
  removeModifierFromSubsequent: ProjectStore['removeModifierFromSubsequent'];
  addModifierParamKeyframe: ProjectStore['addModifierParamKeyframe'];
  removeModifierParamKeyframe: ProjectStore['removeModifierParamKeyframe'];
  updateModifierParamKeyframe: ProjectStore['updateModifierParamKeyframe'];
  addParamDriver: ProjectStore['addParamDriver'];
  removeParamDriver: ProjectStore['removeParamDriver'];
  updateParamDriver: ProjectStore['updateParamDriver'];
  toggleParamDriver: ProjectStore['toggleParamDriver'];
  bakeParamDriver: ProjectStore['bakeParamDriver'];
  unbakeParamDriver: ProjectStore['unbakeParamDriver'];
};

export const createModifierSlice: StateCreator<ProjectStore, [], [], ModifierSlice> = (set, get) => ({
  addModifier: (keyframeId, type) => {
    if (ANIMATION_MODIFIER_TYPES.includes(type)) {
      const kf = get().keyframes.find((k) => k.id === keyframeId);
      if (kf) {
        get().addPartAnimationModifier(kf.partId, type as PartAnimationModifier['type']);
      }
      return;
    }
    get().pushUndo('添加修改器');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        if (k.isBaked) return k;
        return {
          ...k,
          modifiers: [...k.modifiers, createDefaultModifier(type)],
        };
      }),
    }));
    if (type === 'translate' || type === 'rotate') {
      const kf = get().keyframes.find((k) => k.id === keyframeId);
      if (kf) {
        if (_isDragActive) {
          _pendingTrajectoryPartIds.add(kf.partId);
        } else {
          setTimeout(() => get().autoRecordTrajectory(kf.partId), 0);
        }
      }
    }
  },

  removeModifier: (keyframeId, modifierId) => {
    get().pushUndo('删除修改器');
    const kf = get().keyframes.find((k) => k.id === keyframeId);
    if (kf) {
      const mod = kf.modifiers.find((m) => m.id === modifierId);
      if (mod && ANIMATION_MODIFIER_TYPES.includes(mod.type)) {
        invalidateAnimModifierCache(modifierId);
      }
    }
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.filter((m) => m.id !== modifierId),
        };
      }),
    }));
  },

  updateModifier: (keyframeId, modifierId, params) => {
    get().pushUndo('更新修改器', 'updateModifier');
    const { blendMode, coordinateMode, ...restParams } = params as any;
    const actualParams = restParams as Record<string, ModifierParamValue>;

    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              params: { ...m.params, ...actualParams },
              ...(blendMode !== undefined && { blendMode: blendMode as AnimationBlendMode }),
              ...(coordinateMode !== undefined && { coordinateMode: coordinateMode as ModifierCoordinateMode }),
            };
          }),
        };
      }),
    }));
    const updatedState = get();
    const kf = updatedState.keyframes.find((k) => k.id === keyframeId);
    if (kf) {
      const mod = kf.modifiers.find((m) => m.id === modifierId);
      if (mod) {
        if (ANIMATION_MODIFIER_TYPES.includes(mod.type)) {
          invalidateAnimModifierCache(modifierId);
        }
        if (mod.type === 'translate' || mod.type === 'rotate') {
          if (_isDragActive) {
            _pendingTrajectoryPartIds.add(kf.partId);
          } else {
            setTimeout(() => get().autoRecordTrajectory(kf.partId), 0);
          }
        }
      }
    }
  },

  toggleModifier: (keyframeId, modifierId) => {
    get().pushUndo('切换修改器');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            if (ANIMATION_MODIFIER_TYPES.includes(m.type)) {
              invalidateAnimModifierCache(modifierId);
            }
            return { ...m, enabled: !m.enabled };
          }),
        };
      }),
    }));
  },

  toggleModifierCollapsed: (keyframeId, modifierId) => set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      return {
        ...k,
        modifiers: k.modifiers.map((m) => {
          if (m.id !== modifierId) return m;
          return { ...m, collapsed: !m.collapsed };
        }),
      };
    }),
  })),

  reorderModifier: (keyframeId, modifierId, newIndex) => {
    get().pushUndo('重排修改器');
    set((s) => ({
    keyframes: s.keyframes.map((k) => {
      if (k.id !== keyframeId) return k;
      const modifiers = [...k.modifiers];
      const oldIndex = modifiers.findIndex((m) => m.id === modifierId);
      if (oldIndex === -1) return k;
      const [removed] = modifiers.splice(oldIndex, 1);
      modifiers.splice(newIndex, 0, removed);
      return { ...k, modifiers };
    }),
    }));
  },

  collapseModifiers: (keyframeId) => {
    get().pushUndo('折叠修改器');
    const s = get();
    const keyframe = s.keyframes.find(k => k.id === keyframeId);
    if (!keyframe || keyframe.isBaked) return;

    const part = s.parts.find(p => p.id === keyframe.partId);
    if (!part) return;

    const modifiers = keyframe.modifiers.filter(m => m.enabled);
    if (modifiers.length === 0) return;

    const basePixels = keyframe.correctionMask ?? part.pixels;
    let bakedPart = { ...part, pixels: basePixels.map((row) => [...row]) };

    const pixelModTypes: ModifierType[] = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip',
      'pixel_edit',
    ];
    const pixelMods = modifiers.filter(m => pixelModTypes.includes(m.type));
    if (pixelMods.length > 0) {
      const bakedResult = applyPixelModifiers(bakedPart, pixelMods, keyframe.frame, basePixels);
      bakedPart.pixels = bakedResult.pixels;
    }

    const geoModTypes: ModifierType[] = [
      'translate', 'rotate', 'uniform_scale', 'non_uniform_stretch', 'skew', 'simple_physics',
    ];
    const effectBakeTypes: ModifierType[] = ['glow', 'afterimage', 'motion_blur'];
    const hasGeoMods = modifiers.some(m => geoModTypes.includes(m.type));
    const hasEffectMods = modifiers.some(m => effectBakeTypes.includes(m.type));

    if (hasGeoMods || hasEffectMods) {
      const kfBase = computeKeyframeBaseTransform(modifiers);
      const animTransform = computePartAnimationTransform(
        bakedPart.animationModifiers || [], keyframe.frame, s.frameRate,
      );
      const combined = combineTransformsComponentLevel(
        kfBase, animTransform, animTransform.blendMode, animTransform.convergeFactor,
      );

      const hasTransform =
        Math.abs(combined.translateX) > 0.01 ||
        Math.abs(combined.translateY) > 0.01 ||
        Math.abs(combined.rotation) > 0.01 ||
        Math.abs(combined.scaleX - 1) > 0.001 ||
        Math.abs(combined.scaleY - 1) > 0.001 ||
        kfBase.skews.length > 0;

      if (hasTransform) {
        const canvas = document.createElement('canvas');
        canvas.width = s.canvasWidth;
        canvas.height = s.canvasHeight;
        const ctx = canvas.getContext('2d')!;

        const partCanvas = createPartCanvas(bakedPart, null, false, keyframe.frame, s.frameRate).canvas;

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(s.canvasWidth / 2, s.canvasHeight / 2);
        ctx.translate(combined.translateX, combined.translateY);
        ctx.rotate((combined.rotation * Math.PI) / 180);
        ctx.scale(combined.scaleX, combined.scaleY);
        for (const { skewX, skewY } of kfBase.skews) {
          ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
        }
        ctx.translate(-bakedPart.pivotX, -bakedPart.pivotY);
        ctx.drawImage(partCanvas, 0, 0);
        ctx.restore();

        const imageData = ctx.getImageData(0, 0, s.canvasWidth, s.canvasHeight);
        const newPixels = imageDataToPixelGrid(imageData);

        bakedPart.pixels = newPixels;
        bakedPart.width = s.canvasWidth;
        bakedPart.height = s.canvasHeight;
        bakedPart.pivotX = s.canvasWidth / 2;
        bakedPart.pivotY = s.canvasHeight / 2;
      }
    }

    if (hasEffectMods) {
      const effectMods = modifiers.filter(m => effectBakeTypes.includes(m.type));
      const effectCanvas = document.createElement('canvas');
      effectCanvas.width = s.canvasWidth;
      effectCanvas.height = s.canvasHeight;
      const ectx = effectCanvas.getContext('2d')!;

      const partCanvas = createPartCanvas(bakedPart, null, false, keyframe.frame, s.frameRate).canvas;
      const offsetX = s.canvasWidth / 2;
      const offsetY = s.canvasHeight / 2;

      const translateMod = modifiers.find(m => m.type === 'translate' && m.enabled);
      const dx = translateMod ? (Number(translateMod.params.offsetX) || 0) : 0;
      const dy = translateMod ? (Number(translateMod.params.offsetY) || 0) : 0;
      const moveLen = Math.sqrt(dx * dx + dy * dy);
      const dirX = moveLen > 0.01 ? -dx / moveLen : -1;
      const dirY = moveLen > 0.01 ? -dy / moveLen : 0;

      for (const effectMod of effectMods) {
        ectx.clearRect(0, 0, s.canvasWidth, s.canvasHeight);
        const params = effectMod.params;

        if (effectMod.type === 'glow') {
          const glowColor = (params.color as string) || '#ffff00';
          const glowRadius = (params.radius as number) || 3;
          const glowIntensity = (params.intensity as number) || 0.5;
          const pad = Math.ceil(glowRadius * 3);
          const glowCanvas = document.createElement('canvas');
          glowCanvas.width = bakedPart.width + pad * 2;
          glowCanvas.height = bakedPart.height + pad * 2;
          const gctx = glowCanvas.getContext('2d')!;
          gctx.imageSmoothingEnabled = false;
          gctx.drawImage(partCanvas as HTMLCanvasElement, pad, pad);
          const blurIterations = Math.max(1, Math.round(glowRadius / 2));
          for (let i = 0; i < blurIterations; i++) {
            const imgData = gctx.getImageData(0, 0, glowCanvas.width, glowCanvas.height);
            const d = imgData.data;
            const w = glowCanvas.width;
            const h = glowCanvas.height;
            const temp = new Uint8ClampedArray(d);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let ddx = -2; ddx <= 2; ddx++) {
                  const nx = x + ddx;
                  if (nx >= 0 && nx < w) { sum += temp[(y * w + nx) * 4 + 3]; cnt++; }
                }
                d[(y * w + x) * 4 + 3] = Math.round(sum / cnt);
              }
            }
            const temp2 = new Uint8ClampedArray(d);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let ddy = -2; ddy <= 2; ddy++) {
                  const ny = y + ddy;
                  if (ny >= 0 && ny < h) { sum += temp2[(ny * w + x) * 4 + 3]; cnt++; }
                }
                d[(y * w + x) * 4 + 3] = Math.round(sum / cnt);
              }
            }
            gctx.putImageData(imgData, 0, 0);
          }
          ectx.save();
          ectx.globalCompositeOperation = 'lighter';
          ectx.globalAlpha = glowIntensity;
          const gR = parseInt(glowColor.slice(1, 3), 16);
          const gG = parseInt(glowColor.slice(3, 5), 16);
          const gB = parseInt(glowColor.slice(5, 7), 16);
          const tintData = gctx.getImageData(0, 0, glowCanvas.width, glowCanvas.height);
          for (let i = 0; i < tintData.data.length; i += 4) {
            if (tintData.data[i + 3] > 0) {
              tintData.data[i] = gR;
              tintData.data[i + 1] = gG;
              tintData.data[i + 2] = gB;
            }
          }
          gctx.putImageData(tintData, 0, 0);
          ectx.drawImage(glowCanvas, offsetX - bakedPart.pivotX - pad, offsetY - bakedPart.pivotY - pad);
          ectx.restore();
        }

        if (effectMod.type === 'afterimage') {
          const count = (params.count as number) || 3;
          const opacity = (params.opacity as number) || 0.3;
          const spacing = (params.spacing as number) || 5;
          ectx.save();
          ectx.imageSmoothingEnabled = false;
          for (let i = count; i >= 1; i--) {
            ectx.globalAlpha = opacity * (1 - i / (count + 1));
            const offX = dirX * i * spacing;
            const offY = dirY * i * spacing;
            ectx.drawImage(partCanvas as HTMLCanvasElement, offsetX - bakedPart.pivotX + offX, offsetY - bakedPart.pivotY + offY);
          }
          ectx.restore();
        }

        if (effectMod.type === 'motion_blur') {
          const length = (params.length as number) ?? 5;
          const decay = (params.decay as number) ?? 0.5;
          const copies = Math.max(1, Math.round(length));
          ectx.save();
          ectx.imageSmoothingEnabled = false;
          for (let i = copies; i >= 1; i--) {
            const t = i / copies;
            ectx.globalAlpha = Math.pow(1 - t, (1 - decay) * 4 + 1) * 0.8;
            const offX = dirX * i * (length / copies);
            const offY = dirY * i * (length / copies);
            ectx.drawImage(partCanvas as HTMLCanvasElement, offsetX - bakedPart.pivotX + offX, offsetY - bakedPart.pivotY + offY);
          }
          ectx.restore();
        }
      }

      ectx.save();
      ectx.imageSmoothingEnabled = false;
      ectx.globalAlpha = 1;
      ectx.drawImage(partCanvas as HTMLCanvasElement, offsetX - bakedPart.pivotX, offsetY - bakedPart.pivotY);
      ectx.restore();

      const effectImageData = ectx.getImageData(0, 0, s.canvasWidth, s.canvasHeight);
      const effectPixels = imageDataToPixelGrid(effectImageData);

      bakedPart.pixels = effectPixels;
      bakedPart.width = s.canvasWidth;
      bakedPart.height = s.canvasHeight;
      bakedPart.pivotX = s.canvasWidth / 2;
      bakedPart.pivotY = s.canvasHeight / 2;
    }

    const isDimensionChanged = bakedPart.width !== part.width || bakedPart.height !== part.height
      || bakedPart.pivotX !== part.pivotX || bakedPart.pivotY !== part.pivotY;

    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => ({ ...m, collapsed: true })),
          correctionMask: bakedPart.pixels,
          overrideWidth: isDimensionChanged ? bakedPart.width : undefined,
          overrideHeight: isDimensionChanged ? bakedPart.height : undefined,
          overridePivotX: isDimensionChanged ? bakedPart.pivotX : undefined,
          overridePivotY: isDimensionChanged ? bakedPart.pivotY : undefined,
          collapsedWidth: part.width,
          collapsedHeight: part.height,
          collapsedPivotX: part.pivotX,
          collapsedPivotY: part.pivotY,
        };
      }),
    }));
  },

  uncollapseModifiers: (keyframeId) => {
    const s = get();
    const keyframe = s.keyframes.find(k => k.id === keyframeId);
    if (!keyframe) return;

    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => ({ ...m, collapsed: false })),
          correctionMask: null,
          overrideWidth: undefined,
          overrideHeight: undefined,
          overridePivotX: undefined,
          overridePivotY: undefined,
          collapsedWidth: undefined,
          collapsedHeight: undefined,
          collapsedPivotX: undefined,
          collapsedPivotY: undefined,
        };
      }),
    }));
  },

  bakeModifiers: (keyframeId) => {
    get().pushUndo('烘焙修改器');
    const s = get();
    const keyframe = s.keyframes.find(k => k.id === keyframeId);
    if (!keyframe || keyframe.isBaked) return;

    const part = s.parts.find(p => p.id === keyframe.partId);
    if (!part) return;

    const modifiers = keyframe.modifiers.filter(m => m.enabled);
    const basePixels2 = keyframe.correctionMask ?? part.pixels;
    let bakedPart = { ...part, pixels: basePixels2.map((row) => [...row]) };

    const pixelModTypes: ModifierType[] = [
      'color_replace', 'outline', 'dither', 'pixel_displace',
      'cylinder_rotate', 'sphere_rotate', 'mirror', 'flip',
      'pixel_edit',
    ];
    const pixelMods = modifiers.filter(m => pixelModTypes.includes(m.type));
    if (pixelMods.length > 0) {
      const bakedResult = applyPixelModifiers(bakedPart, pixelMods, keyframe.frame, basePixels2);
      bakedPart.pixels = bakedResult.pixels;
    }

    const geoModTypes: ModifierType[] = [
      'translate', 'rotate', 'uniform_scale', 'non_uniform_stretch', 'skew', 'simple_physics',
    ];
    const geoMods = modifiers.filter(m => geoModTypes.includes(m.type));
    if (geoMods.length > 0) {
      const kfBase = computeKeyframeBaseTransform(modifiers);
      const animTransform = computePartAnimationTransform(
        bakedPart.animationModifiers || [], keyframe.frame, s.frameRate,
      );
      const combined = combineTransformsComponentLevel(
        kfBase, animTransform, animTransform.blendMode, animTransform.convergeFactor,
      );

      const hasTransform =
        Math.abs(combined.translateX) > 0.01 ||
        Math.abs(combined.translateY) > 0.01 ||
        Math.abs(combined.rotation) > 0.01 ||
        Math.abs(combined.scaleX - 1) > 0.001 ||
        Math.abs(combined.scaleY - 1) > 0.001 ||
        kfBase.skews.length > 0;

      if (hasTransform) {
        const canvas = document.createElement('canvas');
        canvas.width = s.canvasWidth;
        canvas.height = s.canvasHeight;
        const ctx = canvas.getContext('2d')!;

        const partCanvas = createPartCanvas(bakedPart, null, false, keyframe.frame, s.frameRate).canvas;

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(s.canvasWidth / 2, s.canvasHeight / 2);
        ctx.translate(combined.translateX, combined.translateY);
        ctx.rotate((combined.rotation * Math.PI) / 180);
        ctx.scale(combined.scaleX, combined.scaleY);
        for (const { skewX, skewY } of kfBase.skews) {
          ctx.transform(1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0);
        }
        ctx.translate(-bakedPart.pivotX, -bakedPart.pivotY);
        ctx.drawImage(partCanvas, 0, 0);
        ctx.restore();

        const imageData = ctx.getImageData(0, 0, s.canvasWidth, s.canvasHeight);
        const newPixels = imageDataToPixelGrid(imageData);

        bakedPart.pixels = newPixels;
        bakedPart.width = s.canvasWidth;
        bakedPart.height = s.canvasHeight;
        bakedPart.pivotX = s.canvasWidth / 2;
        bakedPart.pivotY = s.canvasHeight / 2;
      }
    }

    const effectBakeTypes: ModifierType[] = ['glow', 'afterimage', 'motion_blur'];
    const effectMods = modifiers.filter(m => effectBakeTypes.includes(m.type));
    if (effectMods.length > 0) {
      const effectCanvas = document.createElement('canvas');
      effectCanvas.width = s.canvasWidth;
      effectCanvas.height = s.canvasHeight;
      const ectx = effectCanvas.getContext('2d')!;

      const partCanvas = createPartCanvas(bakedPart, null, false, keyframe.frame, s.frameRate).canvas;
      const offsetX = s.canvasWidth / 2;
      const offsetY = s.canvasHeight / 2;

      const translateMod = modifiers.find(m => m.type === 'translate' && m.enabled);
      const dx = translateMod ? (Number(translateMod.params.offsetX) || 0) : 0;
      const dy = translateMod ? (Number(translateMod.params.offsetY) || 0) : 0;
      const moveLen = Math.sqrt(dx * dx + dy * dy);
      const dirX = moveLen > 0.01 ? -dx / moveLen : -1;
      const dirY = moveLen > 0.01 ? -dy / moveLen : 0;

      for (const effectMod of effectMods) {
        ectx.clearRect(0, 0, s.canvasWidth, s.canvasHeight);
        const params = effectMod.params;

        if (effectMod.type === 'glow') {
          const glowColor = (params.color as string) || '#ffff00';
          const glowRadius = (params.radius as number) || 3;
          const glowIntensity = (params.intensity as number) || 0.5;
          const pad = Math.ceil(glowRadius * 3);
          const glowCanvas = document.createElement('canvas');
          glowCanvas.width = bakedPart.width + pad * 2;
          glowCanvas.height = bakedPart.height + pad * 2;
          const gctx = glowCanvas.getContext('2d')!;
          gctx.imageSmoothingEnabled = false;
          gctx.drawImage(partCanvas as HTMLCanvasElement, pad, pad);
          const blurIterations = Math.max(1, Math.round(glowRadius / 2));
          for (let i = 0; i < blurIterations; i++) {
            const imgData = gctx.getImageData(0, 0, glowCanvas.width, glowCanvas.height);
            const d = imgData.data;
            const w = glowCanvas.width;
            const h = glowCanvas.height;
            const temp = new Uint8ClampedArray(d);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let ddx = -2; ddx <= 2; ddx++) {
                  const nx = x + ddx;
                  if (nx >= 0 && nx < w) { sum += temp[(y * w + nx) * 4 + 3]; cnt++; }
                }
                d[(y * w + x) * 4 + 3] = Math.round(sum / cnt);
              }
            }
            const temp2 = new Uint8ClampedArray(d);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let ddy = -2; ddy <= 2; ddy++) {
                  const ny = y + ddy;
                  if (ny >= 0 && ny < h) { sum += temp2[(ny * w + x) * 4 + 3]; cnt++; }
                }
                d[(y * w + x) * 4 + 3] = Math.round(sum / cnt);
              }
            }
            gctx.putImageData(imgData, 0, 0);
          }
          ectx.save();
          ectx.globalCompositeOperation = 'lighter';
          ectx.globalAlpha = glowIntensity;
          const gR = parseInt(glowColor.slice(1, 3), 16);
          const gG = parseInt(glowColor.slice(3, 5), 16);
          const gB = parseInt(glowColor.slice(5, 7), 16);
          const tintData = gctx.getImageData(0, 0, glowCanvas.width, glowCanvas.height);
          for (let i = 0; i < tintData.data.length; i += 4) {
            if (tintData.data[i + 3] > 0) {
              tintData.data[i] = gR;
              tintData.data[i + 1] = gG;
              tintData.data[i + 2] = gB;
            }
          }
          gctx.putImageData(tintData, 0, 0);
          ectx.drawImage(glowCanvas, offsetX - bakedPart.pivotX - pad, offsetY - bakedPart.pivotY - pad);
          ectx.restore();
        }

        if (effectMod.type === 'afterimage') {
          const count = (params.count as number) || 3;
          const opacity = (params.opacity as number) || 0.3;
          const spacing = (params.spacing as number) || 5;
          ectx.save();
          ectx.imageSmoothingEnabled = false;
          for (let i = count; i >= 1; i--) {
            ectx.globalAlpha = opacity * (1 - i / (count + 1));
            const offX = dirX * i * spacing;
            const offY = dirY * i * spacing;
            ectx.drawImage(partCanvas as HTMLCanvasElement, offsetX - bakedPart.pivotX + offX, offsetY - bakedPart.pivotY + offY);
          }
          ectx.restore();
        }

        if (effectMod.type === 'motion_blur') {
          const length = (params.length as number) ?? 5;
          const decay = (params.decay as number) ?? 0.5;
          const copies = Math.max(1, Math.round(length));
          ectx.save();
          ectx.imageSmoothingEnabled = false;
          for (let i = copies; i >= 1; i--) {
            const t = i / copies;
            ectx.globalAlpha = Math.pow(1 - t, (1 - decay) * 4 + 1) * 0.8;
            const offX = dirX * i * (length / copies);
            const offY = dirY * i * (length / copies);
            ectx.drawImage(partCanvas as HTMLCanvasElement, offsetX - bakedPart.pivotX + offX, offsetY - bakedPart.pivotY + offY);
          }
          ectx.restore();
        }
      }

      ectx.save();
      ectx.imageSmoothingEnabled = false;
      ectx.globalAlpha = 1;
      ectx.drawImage(partCanvas as HTMLCanvasElement, offsetX - bakedPart.pivotX, offsetY - bakedPart.pivotY);
      ectx.restore();

      const effectImageData = ectx.getImageData(0, 0, s.canvasWidth, s.canvasHeight);
      const effectPixels = imageDataToPixelGrid(effectImageData);

      bakedPart.pixels = effectPixels;
      bakedPart.width = s.canvasWidth;
      bakedPart.height = s.canvasHeight;
      bakedPart.pivotX = s.canvasWidth / 2;
      bakedPart.pivotY = s.canvasHeight / 2;
    }

    const animMods = bakedPart.animationModifiers?.filter(m => m.enabled) || [];
    if (animMods.length > 0) {
      const animTransform = computePartAnimationTransform(
        animMods, keyframe.frame, s.frameRate,
      );
      const hasAnimTransform =
        Math.abs(animTransform.translateX) > 0.01 ||
        Math.abs(animTransform.translateY) > 0.01 ||
        Math.abs(animTransform.rotation) > 0.01 ||
        Math.abs(animTransform.scaleX - 1) > 0.001 ||
        Math.abs(animTransform.scaleY - 1) > 0.001;

      if (hasAnimTransform) {
        const animCanvas = document.createElement('canvas');
        animCanvas.width = s.canvasWidth;
        animCanvas.height = s.canvasHeight;
        const actx = animCanvas.getContext('2d')!;
        const partCanvas = createPartCanvas(bakedPart, null, false, keyframe.frame, s.frameRate).canvas;
        const offsetX = s.canvasWidth / 2;
        const offsetY = s.canvasHeight / 2;

        actx.save();
        actx.imageSmoothingEnabled = false;
        actx.translate(offsetX, offsetY);
        actx.translate(animTransform.translateX, animTransform.translateY);
        actx.rotate((animTransform.rotation * Math.PI) / 180);
        actx.scale(animTransform.scaleX, animTransform.scaleY);
        actx.translate(-bakedPart.pivotX, -bakedPart.pivotY);
        actx.drawImage(partCanvas, 0, 0);
        actx.restore();

        const animImageData = actx.getImageData(0, 0, s.canvasWidth, s.canvasHeight);
        bakedPart.pixels = imageDataToPixelGrid(animImageData);
        bakedPart.width = s.canvasWidth;
        bakedPart.height = s.canvasHeight;
        bakedPart.pivotX = s.canvasWidth / 2;
        bakedPart.pivotY = s.canvasHeight / 2;
      }
      bakedPart.animationModifiers = [];
    }

    const isDimensionChanged = bakedPart.width !== part.width || bakedPart.height !== part.height
      || bakedPart.pivotX !== part.pivotX || bakedPart.pivotY !== part.pivotY;

    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          isBaked: true,
          modifiers: [],
          correctionMask: bakedPart.pixels,
          overrideWidth: isDimensionChanged ? bakedPart.width : undefined,
          overrideHeight: isDimensionChanged ? bakedPart.height : undefined,
          overridePivotX: isDimensionChanged ? bakedPart.pivotX : undefined,
          overridePivotY: isDimensionChanged ? bakedPart.pivotY : undefined,
        };
      }),
    }));
  },

  bakeToTimeline: (partId, startFrame, endFrame, step) => {
    get().pushUndo('烘焙到时间轴');
    const state = get();
    const part = state.parts.find(p => p.id === partId);

    const animMods = part?.animationModifiers?.filter(m => m.enabled) || [];

    if (animMods.length === 0) {
      const partKeyframes = state.keyframes
        .filter((k) => k.partId === partId)
        .sort((a, b) => a.frame - b.frame);
      if (partKeyframes.length === 0) return;
    }

    for (let frame = startFrame; frame <= endFrame; frame += step) {
      let totalTX = 0, totalTY = 0, totalRot = 0, totalSX = 1, totalSY = 1;
      let hasAnimMods = false;

      if (animMods.length > 0) {
        for (const animMod of animMods) {
          const { computeAnimationModifierTransform } = require('../engine');
          const transform = computeAnimationModifierTransform(animMod, frame, state.frameRate);
          totalTX += transform.translateX;
          totalTY += transform.translateY;
          totalRot += transform.rotation;
          totalSX *= transform.scaleX;
          totalSY *= transform.scaleY;
          hasAnimMods = true;
        }
      } else {
        const kf = state.keyframes.find((k) => k.partId === partId && k.frame === frame);
        if (!kf || kf.isBaked) continue;
        const kfAnimMods = kf.modifiers.filter((m) =>
          m.enabled && ANIMATION_MODIFIER_TYPES.includes(m.type)
        );
        if (kfAnimMods.length === 0) continue;
        for (const animMod of kfAnimMods) {
          const { computeAnimationModifierTransform } = require('../engine');
          const transform = computeAnimationModifierTransform(animMod, frame, state.frameRate);
          totalTX += transform.translateX;
          totalTY += transform.translateY;
          totalRot += transform.rotation;
          totalSX *= transform.scaleX;
          totalSY *= transform.scaleY;
          hasAnimMods = true;
        }
      }

      if (!hasAnimMods) continue;

      totalTX = Math.round(totalTX);
      totalTY = Math.round(totalTY);
      totalRot = Math.round(totalRot * 10) / 10;

      let targetKfId: string;
      const existingKf = state.keyframes.find((k) => k.partId === partId && k.frame === frame);
      if (existingKf) {
        targetKfId = existingKf.id;
      } else {
        const newKf = get().addKeyframe(partId, frame);
        targetKfId = newKf.id;
      }

      if (totalTX !== 0 || totalTY !== 0) {
        get().addModifier(targetKfId, 'translate');
        const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
        const translateMod = updatedKf?.modifiers.find((m) => m.type === 'translate');
        if (translateMod) {
          get().updateModifier(targetKfId, translateMod.id, {
            offsetX: totalTX,
            offsetY: totalTY,
          });
        }
      }

      if (Math.abs(totalRot) > 0.01) {
        get().addModifier(targetKfId, 'rotate');
        const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
        const rotateMod = updatedKf?.modifiers.find((m) => m.type === 'rotate');
        if (rotateMod) {
          get().updateModifier(targetKfId, rotateMod.id, { angle: totalRot });
        }
      }

      if (Math.abs(totalSX - 1) > 0.001 || Math.abs(totalSY - 1) > 0.001) {
        if (Math.abs(totalSX - totalSY) < 0.001) {
          get().addModifier(targetKfId, 'uniform_scale');
          const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
          const scaleMod = updatedKf?.modifiers.find((m) => m.type === 'uniform_scale');
          if (scaleMod) {
            get().updateModifier(targetKfId, scaleMod.id, { scale: totalSX });
          }
        } else {
          get().addModifier(targetKfId, 'non_uniform_stretch');
          const updatedKf = get().keyframes.find((k) => k.id === targetKfId);
          const stretchMod = updatedKf?.modifiers.find((m) => m.type === 'non_uniform_stretch');
          if (stretchMod) {
            get().updateModifier(targetKfId, stretchMod.id, { scaleX: totalSX, scaleY: totalSY });
          }
        }
      }

      if (part && animMods.length > 0) {
        for (const am of [...animMods]) {
          get().removePartAnimationModifier(partId, am.id);
        }
        break;
      }

      const currentKf = get().keyframes.find((k) => k.id === targetKfId);
      if (currentKf) {
        const animModIds = currentKf.modifiers
          .filter((m) => ANIMATION_MODIFIER_TYPES.includes(m.type))
          .map((m) => m.id);
        for (const modId of animModIds) {
          get().removeModifier(targetKfId, modId);
        }
      }
    }
  },

  updateModifierRange: (keyframeId, modifierId, range) => {
    get().pushUndo('更新修改器范围');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              ...(range.startFrame !== undefined && { startFrame: range.startFrame }),
              ...(range.endFrame !== undefined && { endFrame: range.endFrame }),
              ...(range.fadeInFrames !== undefined && { fadeInFrames: range.fadeInFrames }),
              ...(range.fadeOutFrames !== undefined && { fadeOutFrames: range.fadeOutFrames }),
            };
          }),
        };
      }),
    }));
  },

  addModifierToSubsequent: (partId, fromFrame, type) => {
    get().pushUndo('添加到后续帧');
    const newMod = createDefaultModifier(type);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.partId !== partId || k.frame < fromFrame || k.isBaked) return k;
        return {
          ...k,
          modifiers: [...k.modifiers, { ...newMod, id: crypto.randomUUID() }],
        };
      }),
    }));
    if (type === 'translate' || type === 'rotate') {
      if (_isDragActive) {
        _pendingTrajectoryPartIds.add(partId);
      } else {
        setTimeout(() => get().autoRecordTrajectory(partId), 0);
      }
    }
  },

  removeModifierFromSubsequent: (partId, fromFrame, modifierType) => {
    get().pushUndo('从后续帧删除');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.partId !== partId || k.frame < fromFrame) return k;
        return {
          ...k,
          modifiers: k.modifiers.filter((m) => m.type !== modifierType),
        };
      }),
    }));
    if (modifierType === 'translate' || modifierType === 'rotate') {
      if (_isDragActive) {
        _pendingTrajectoryPartIds.add(partId);
      } else {
        setTimeout(() => get().autoRecordTrajectory(partId), 0);
      }
    }
  },

  addModifierParamKeyframe: (keyframeId, modifierId, frame, params) => {
    get().pushUndo('添加参数关键帧');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            const existing = m.paramKeyframes ?? [];
            const existingIdx = existing.findIndex((pk) => pk.frame === frame);
            if (existingIdx >= 0) {
              const updated = [...existing];
              updated[existingIdx] = { ...updated[existingIdx], params: { ...updated[existingIdx].params, ...params } };
              return { ...m, paramKeyframes: updated };
            }
            const newPk: import('../types').ModifierParamKeyframe = {
              id: crypto.randomUUID(),
              frame,
              params,
            };
            return { ...m, paramKeyframes: [...existing, newPk] };
          }),
        };
      }),
    }));
  },

  removeModifierParamKeyframe: (keyframeId, modifierId, paramKfId) => {
    get().pushUndo('删除参数关键帧');
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: (m.paramKeyframes ?? []).filter((pk) => pk.id !== paramKfId),
            };
          }),
        };
      }),
    }));
  },

  updateModifierParamKeyframe: (keyframeId, modifierId, paramKfId, params) => {
    get().pushUndo('更新参数关键帧');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: (m.paramKeyframes ?? []).map((pk) => {
                if (pk.id !== paramKfId) return pk;
                const paramsAny = params as Record<string, unknown>;
                if (typeof paramsAny.__frame === 'number') {
                  const { __frame, ...restParams } = paramsAny;
                  const cleanParams: Record<string, ModifierParamValue> = {};
                  for (const [key, val] of Object.entries(restParams)) {
                    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
                      cleanParams[key] = val;
                    }
                  }
                  return { ...pk, frame: paramsAny.__frame as number, params: { ...pk.params, ...cleanParams } };
                }
                return { ...pk, params: { ...pk.params, ...params } };
              }),
            };
          }),
        };
      }),
    }));
  },

  addParamDriver: (keyframeId, modifierId, paramName, startFrame, endFrame) => {
    get().pushUndo('添加参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            const baseVal = typeof m.params[paramName] === 'number' ? (m.params[paramName] as number) : 0;
            const { createDefaultParamDriver } = require('../types');
            const driver = createDefaultParamDriver(
              paramName,
              baseVal,
              startFrame ?? k.frame,
              endFrame ?? -1,
            );
            return {
              ...m,
              paramDrivers: [...(m.paramDrivers ?? []), driver],
            };
          }),
        };
      }),
    }));
  },

  removeParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('删除参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).filter((d) => d.id !== driverId),
            };
          }),
        };
      }),
    }));
  },

  updateParamDriver: (keyframeId, modifierId, driverId, updates) => {
    get().pushUndo('更新参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const { invalidatePhaseCache } = require('../engine');
    invalidatePhaseCache(driverId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, ...updates };
              }),
            };
          }),
        };
      }),
    }));
  },

  toggleParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('切换参数驱动器');
    invalidateAnimModifierCache(modifierId);
    set((s) => ({
      keyframes: s.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, enabled: !d.enabled };
              }),
            };
          }),
        };
      }),
    }));
  },

  bakeParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('烘焙参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const kf = s.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const mod = kf.modifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const driver = (mod.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || driver.isBaked) return;

    const result = bakeParamDriverToKeyframes(
      driver,
      mod.paramKeyframes ?? [],
      s.totalFrames,
    );

    set((s2) => ({
      keyframes: s2.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: result.paramKeyframes,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, ...result.driverUpdates };
              }),
            };
          }),
        };
      }),
    }));
  },

  unbakeParamDriver: (keyframeId, modifierId, driverId) => {
    get().pushUndo('反烘焙参数驱动器');
    invalidateAnimModifierCache(modifierId);
    const s = get();
    const kf = s.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const mod = kf.modifiers.find((m) => m.id === modifierId);
    if (!mod) return;
    const driver = (mod.paramDrivers ?? []).find((d) => d.id === driverId);
    if (!driver || !driver.isBaked) return;

    const startFrame = driver.startFrame;
    const endFrame = driver.endFrame >= 0 ? driver.endFrame : s.totalFrames - 1;

    const cleanedPkfs = (mod.paramKeyframes ?? []).filter((pkf) => {
      if (pkf.frame < startFrame || pkf.frame > endFrame) return true;
      const otherKeys = Object.keys(pkf.params).filter((k) => k !== driver.paramName);
      if (otherKeys.length > 0) {
        return true;
      }
      return false;
    }).map((pkf) => {
      if (pkf.frame >= startFrame && pkf.frame <= endFrame) {
        const newParams = { ...pkf.params };
        delete newParams[driver.paramName];
        if (Object.keys(newParams).length === 0) return null;
        return { ...pkf, params: newParams };
      }
      return pkf;
    }).filter(Boolean) as import('../types').ModifierParamKeyframe[];

    set((s2) => ({
      keyframes: s2.keyframes.map((k) => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          modifiers: k.modifiers.map((m) => {
            if (m.id !== modifierId) return m;
            return {
              ...m,
              paramKeyframes: cleanedPkfs,
              paramDrivers: (m.paramDrivers ?? []).map((d) => {
                if (d.id !== driverId) return d;
                return { ...d, isBaked: false, enabled: true };
              }),
            };
          }),
        };
      }),
    }));
  },
});
