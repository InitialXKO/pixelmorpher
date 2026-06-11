// ============================================================
// PixelMorpher V2.0 - Plugin API
// JavaScript API exposed to plugins for interacting with the editor
// ============================================================

import { useProjectStore } from './store';
import { useEditorStore } from './store';
import { ModifierType, ProceduralConfig, ModifierParamValue } from './types';

export interface PixelMorpherAPI {
  // Project info
  getProjectName(): string;
  setProjectName(name: string): void;
  getCanvasSize(): { width: number; height: number };
  getCurrentFrame(): number;
  getTotalFrames(): number;

  // Parts
  getParts(): { id: string; name: string; width: number; height: number }[];
  addPart(name: string, width: number, height: number): string;
  removePart(id: string): void;
  getPartPixels(id: string): (string | null)[][] | null;
  setPartPixels(id: string, pixels: (string | null)[][]): void;

  // Keyframes
  addKeyframe(partId: string, frame: number): string;
  removeKeyframe(keyframeId: string): void;
  getKeyframesForPart(partId: string): { id: string; frame: number; modifiers: any[] }[];

  // Modifiers
  addModifier(keyframeId: string, type: ModifierType): void;
  updateModifier(keyframeId: string, modifierId: string, params: Record<string, ModifierParamValue>): void;
  removeModifier(keyframeId: string, modifierId: string): void;

  // Trajectory
  autoRecordTrajectory(partId: string): void;
  clearTrajectory(partId: string): void;

  // Procedural
  addProceduralAnimation(partId: string, name: string, config: ProceduralConfig, startFrame: number, endFrame: number): string;
  removeProceduralAnimation(id: string): void;

  // Skeleton
  addSkeleton(name: string): string;
  addBone(skeletonId: string, name: string, parentId: string | null, headX: number, headY: number, tailX: number, tailY: number): string;

  // Playback
  play(): void;
  pause(): void;
  stop(): void;
  goToFrame(frame: number): void;

  // Selection
  getSelectedPartId(): string | null;
  selectPart(id: string): void;

  // Export
  exportProjectFile(): object;
}

export function createAPI(): PixelMorpherAPI {
  return {
    getProjectName: () => useProjectStore.getState().name,
    setProjectName: (name) => useProjectStore.getState().setProjectName(name),
    getCanvasSize: () => ({
      width: useProjectStore.getState().canvasWidth,
      height: useProjectStore.getState().canvasHeight,
    }),
    getCurrentFrame: () => useProjectStore.getState().currentFrame,
    getTotalFrames: () => useProjectStore.getState().totalFrames,

    getParts: () =>
      useProjectStore.getState().parts.map((p) => ({
        id: p.id,
        name: p.name,
        width: p.width,
        height: p.height,
      })),
    addPart: (name, w, h) => useProjectStore.getState().addPart(name, w, h).id,
    removePart: (id) => useProjectStore.getState().removePart(id),
    getPartPixels: (id) =>
      useProjectStore.getState().parts.find((p) => p.id === id)?.pixels ?? null,
    setPartPixels: (id, pixels) =>
      useProjectStore.getState().setPartPixels(id, pixels),

    addKeyframe: (partId, frame) =>
      useProjectStore.getState().addKeyframe(partId, frame).id,
    removeKeyframe: (id) => useProjectStore.getState().removeKeyframe(id),
    getKeyframesForPart: (partId) =>
      useProjectStore
        .getState()
        .getKeyframesForPart(partId)
        .map((k) => ({ id: k.id, frame: k.frame, modifiers: k.modifiers })),

    addModifier: (kfId, type) => useProjectStore.getState().addModifier(kfId, type),
    updateModifier: (kfId, modId, params) =>
      useProjectStore.getState().updateModifier(kfId, modId, params),
    removeModifier: (kfId, modId) =>
      useProjectStore.getState().removeModifier(kfId, modId),

    autoRecordTrajectory: (partId) =>
      useProjectStore.getState().autoRecordTrajectory(partId),
    clearTrajectory: (partId) =>
      useProjectStore.getState().clearTrajectory(partId),

    addProceduralAnimation: (partId, name, config, start, end) =>
      useProjectStore
        .getState()
        .addProceduralAnimation(partId, name, config, start, end).id,
    removeProceduralAnimation: (id) =>
      useProjectStore.getState().removeProceduralAnimation(id),

    addSkeleton: (name) => useProjectStore.getState().addSkeleton(name).id,
    addBone: (skId, name, parentId, hx, hy, tx, ty) =>
      useProjectStore.getState().addBone(skId, name, parentId, hx, hy, tx, ty).id,

    play: () => useEditorStore.getState().setPlayState('playing'),
    pause: () => useEditorStore.getState().setPlayState('paused'),
    stop: () => useEditorStore.getState().setPlayState('stopped'),
    goToFrame: (f) => useProjectStore.getState().setCurrentFrame(f),

    getSelectedPartId: () => useEditorStore.getState().selectedPartId,
    selectPart: (id) => useEditorStore.getState().selectPart(id),

    exportProjectFile: () => useProjectStore.getState().exportProjectFile(),
  };
}
