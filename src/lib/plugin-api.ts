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

    addNodeKeyframe: (clipId, nodeId, frame, values) =>
      getStore().addNodeKeyframe(clipId, nodeId, frame, values as never).id,

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
