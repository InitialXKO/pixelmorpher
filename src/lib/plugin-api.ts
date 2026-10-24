// ============================================================
// PixelMorpher - Plugin API (Unified Model)
// JavaScript API exposed to plugins for interacting with the editor.
// Uses the unified Character/Node/Blueprint model (not legacy puppet*).
// ============================================================

import { useProjectStore } from './store';
import { useEditorStore } from './store';
import type { BlueprintGraph } from './blueprint/ir';

export interface PixelMorpherAPI {
  // Project info
  getProjectName(): string;
  setProjectName(name: string): void;
  getCanvasSize(): { width: number; height: number };
  getCurrentFrame(): number;
  getTotalFrames(): number;

  // Sprites (global table)
  getSprites(): { id: string; name: string; width: number; height: number }[];
  addSprite(name: string, width: number, height: number): string;
  removeSprite(id: string): void;
  getSpritePixels(id: string): (string | null)[][] | null;
  setSpritePixels(id: string, pixels: (string | null)[][]): void;

  // Characters (unified model)
  getCharacters(): { id: string; name: string }[];
  addCharacter(name: string): string;
  getNodes(characterId: string): { id: string; name: string }[];
  addNode(characterId: string, name: string): string;
  updateNode(characterId: string, nodeId: string, updates: Record<string, unknown>): void;

  // Node keyframes (unified)
  addNodeKeyframe(clipId: string, nodeId: string, frame: number, values: Record<string, unknown>): string;

  // Blueprint (unified, replaces old modifiers/procedural)
  getNodeBlueprint(characterId: string, nodeId: string): BlueprintGraph | null;
  setNodeBlueprint(characterId: string, nodeId: string, graph: BlueprintGraph | null): void;

  // Playback
  play(): void;
  pause(): void;
  stop(): void;
  goToFrame(frame: number): void;

  // Selection
  getSelectedNodeId(): string | null;
  selectNode(id: string | null): void;

  // Export
  exportProjectFile(): object;
}

export function createAPI(): PixelMorpherAPI {
  const getStore = () => useProjectStore.getState();
  return {
    getProjectName: () => getStore().name,
    setProjectName: (name) => getStore().setProjectName(name),
    getCanvasSize: () => ({
      width: getStore().canvasWidth,
      height: getStore().canvasHeight,
    }),
    getCurrentFrame: () => getStore().currentFrame,
    getTotalFrames: () => getStore().totalFrames,

    getSprites: () =>
      Object.values(getStore().sprites).map((p) => ({
        id: p.id!,
        name: p.name ?? '',
        width: p.width,
        height: p.height,
      })),
    addSprite: (name, w, h) => getStore().addSprite(name, w, h).id!,
    removeSprite: (id) => getStore().removeSprite(id),
    getSpritePixels: (id) => getStore().sprites[id]?.data ?? null,
    setSpritePixels: (id, pixels) => getStore().setSpritePixels(id, pixels),

    getCharacters: () =>
      Object.values(getStore().unifiedCharacters).map((c) => ({
        id: c.id,
        name: c.name,
      })),
    addCharacter: (name) => getStore().addUnifiedCharacter(name).id,
    getNodes: (characterId) => {
      const ch = getStore().unifiedCharacters[characterId];
      if (!ch) return [];
      return Object.values(ch.nodes).map((n) => ({ id: n.id, name: n.name }));
    },
    addNode: (characterId, name) =>
      getStore().addUnifiedNode(characterId, name).id,
    updateNode: (characterId, nodeId, updates) =>
      getStore().updateUnifiedNode(characterId, nodeId, updates as never),

    // 插件契约不变，落点已统一到节点轨道：姿态通道写通道点，
    // modifiers/faceTurn/zIndex 分别写三条附件轨。角色由片段归属解析
    // （归属失效时按节点所在角色兜底）。返回合成键 id `${nodeId}@${frame}`。
    addNodeKeyframe: (clipId, nodeId, frame, values) => {
      const store = getStore();
      const v = (values ?? {}) as Record<string, any>;
      const clip = store.animationClips.find((c) => c.id === clipId);
      let characterId = clip?.puppetCharacterId && store.unifiedCharacters[clip.puppetCharacterId]
        ? clip.puppetCharacterId
        : undefined;
      if (!characterId) {
        characterId = Object.values(store.unifiedCharacters).find((ch) => ch.nodes[nodeId])?.id;
      }
      if (!characterId) return '';
      const node = store.unifiedCharacters[characterId]?.nodes[nodeId];
      if (!node) return '';
      const channels = ['angle', 'tilt', 'x', 'y', 'stretch', 'scaleX', 'variantIndex'] as const;
      let tracks: Record<string, any> = { ...(node.tracks ?? {}) };
      let touched = false;
      for (const chName of channels) {
        if (typeof v[chName] !== 'number') continue;
        const track = tracks[chName] ?? { keyframes: [], interpolation: 'linear' };
        const idx = track.keyframes.findIndex((k: any) => k.frame === frame);
        const keyframes = idx >= 0
          ? track.keyframes.map((k: any, i: number) => (i === idx ? { ...k, value: v[chName] } : k))
          : [...track.keyframes, { frame, value: v[chName] }].sort((a: any, b: any) => a.frame - b.frame);
        tracks = { ...tracks, [chName]: { ...track, keyframes } };
        touched = true;
      }
      if (touched) store.updateUnifiedNode(characterId, nodeId, { tracks } as never);
      if (Array.isArray(v.modifiers)) store.setNodeModifierKey(characterId, nodeId, frame, v.modifiers);
      if (v.faceTurn) store.setNodeFaceTurnKey(characterId, nodeId, frame, v.faceTurn);
      if (typeof v.zIndex === 'number') store.setNodeZIndexKey(characterId, nodeId, frame, v.zIndex);
      return `${nodeId}@${frame}`;
    },

    getNodeBlueprint: (characterId, nodeId) =>
      getStore().unifiedCharacters[characterId]?.nodes[nodeId]?.blueprint ?? null,
    setNodeBlueprint: (characterId, nodeId, graph) =>
      getStore().updateUnifiedNode(characterId, nodeId, { blueprint: graph ?? undefined } as never),

    play: () => useEditorStore.getState().setPlayState('playing'),
    pause: () => useEditorStore.getState().setPlayState('paused'),
    stop: () => useEditorStore.getState().setPlayState('stopped'),
    goToFrame: (f) => getStore().setCurrentFrame(f),

    getSelectedNodeId: () => getStore().selectedNodeId ?? null,
    selectNode: (id) => getStore().setSelectedNodeId(id),

    exportProjectFile: () => getStore().exportProjectFile(),
  };
}
