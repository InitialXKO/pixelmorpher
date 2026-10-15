// ============================================================
// PixelMorpher - Character Slice (New Architecture)
// Uses Character/Node types (no Puppet* types)
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type {
  Character,
  Node,
  NodeTracks,
  CostumeSet,
} from '../unified-types';
import { createDefaultNode, createDefaultCostumeSet, createDefaultCostumePiece } from '../unified-types';
import type { DirectionIndex } from '../unified-types';
import { LiveAdapter } from '../migration-adapter';

export type CharacterSlice = {
  // ---- Character CRUD ----
  unifiedCharacters: Record<string, Character>;
  addUnifiedCharacter: (name: string) => Character;
  removeUnifiedCharacter: (id: string) => void;
  updateUnifiedCharacter: (id: string, updates: Partial<Character>) => void;
  /** Sync Puppet data to unified Character (via LiveAdapter). Call when puppet data changes. */
  syncPuppetToUnified: (skeletonId: string) => Character | null;
  /** Set direction for all nodes (updates transform.variantIndex). variantIndex: 0-7 direction index. */
  setUnifiedDirection: (characterId: string, variantIndex: number) => void;
  /** Currently selected node ID (unified Node ID) */
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // ---- Node Keyframes ----
  addNodeKeyframe: (clipId: string, nodeId: string, frame: number, values: Partial<Pick<import('../unified-types').NodeKeyframe, 'angle' | 'stretch' | 'x' | 'y' | 'variantIndex' | 'zIndex' | 'interpolationMode'>>) => import('../unified-types').NodeKeyframe;
  removeNodeKeyframe: (clipId: string, keyframeId: string) => void;
  updateNodeKeyframe: (clipId: string, keyframeId: string, updates: Partial<import('../unified-types').NodeKeyframe>) => void;

  // ---- Node CRUD ----
  addUnifiedNode: (characterId: string, name: string, opts?: Partial<Node>) => Node;
  removeUnifiedNode: (characterId: string, nodeId: string) => void;
  updateUnifiedNode: (characterId: string, nodeId: string, updates: Partial<Node>) => void;

  // ---- Modifier CRUD (via updateUnifiedNode) ----
  addUnifiedNodeModifier: (characterId: string, nodeId: string, type: string) => void;
  removeUnifiedNodeModifier: (characterId: string, nodeId: string, modifierId: string) => void;
  updateUnifiedNodeModifier: (characterId: string, nodeId: string, modifierId: string, updates: Record<string, unknown>) => void;
  toggleUnifiedNodeModifier: (characterId: string, nodeId: string, modifierId: string) => void;

  // ---- Selection ----
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;

  // ---- Batch tagging ----
  /** 按节点命名自动标记 side (L/R/C) 与 isCore。返回标记的节点数。 */
  autoTagNodeDirections: (characterId: string) => { tagged: number };

  // ---- CostumeSet CRUD ----
  addUnifiedCostumeSet: (characterId: string, name: string) => CostumeSet;
  removeUnifiedCostumeSet: (characterId: string, costumeSetId: string) => void;
  updateUnifiedCostumeSet: (characterId: string, costumeSetId: string, updates: Partial<CostumeSet>) => void;
  /** 给指定节点/方向设置精灵引用。spriteId 为 null 时清除。 */
  setUnifiedCostumeSprite: (characterId: string, costumeSetId: string, nodeId: string, direction: DirectionIndex, spriteId: string | null) => void;
};

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const createCharacterSlice: StateCreator<ProjectStore, [], [], CharacterSlice> = (set, get) => ({
  unifiedCharacters: {},

  addUnifiedCharacter: (name) => {
    const id = generateId('char');
    const character: Character = {
      id,
      name,
      rootNodeId: '',
      nodes: {},
      sprites: {},  // Shared sprite table (replaces old Part[])
      costumeSets: [],
      directionDrawOrders: {},
      latitude: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Create root node
    const rootNode = createDefaultNode(generateId('node'), 'root');
    character.nodes[rootNode.id] = rootNode;
    character.rootNodeId = rootNode.id;

    set((s) => ({
      unifiedCharacters: { ...s.unifiedCharacters, [id]: character },
    }));
    return character;
  },

  removeUnifiedCharacter: (id) => {
    set((s) => {
      const unifiedCharacters = { ...s.unifiedCharacters };
      delete unifiedCharacters[id];
      return { unifiedCharacters };
    });
  },

  updateUnifiedCharacter: (id, updates) => {
    set((s) => ({
      unifiedCharacters: {
        ...s.unifiedCharacters,
        [id]: { ...s.unifiedCharacters[id]!, ...updates, updatedAt: Date.now() },
      },
    }));
  },

  syncPuppetToUnified: (skeletonId) => {
    const s = get() as any;
    const skeleton = s.puppetSkeletons?.find((sk: any) => sk.id === skeletonId);
    if (!skeleton) return null;
    const adapter = new LiveAdapter();
    const puppetChar = s.puppetCharacters?.find((c: any) => c.puppetSkeletonId === skeletonId);
    const character = adapter.getCharacter(
      skeleton,
      puppetChar ? [puppetChar] : [],
      s.parts ?? [],
      s.puppetNodeKeyframes ?? [],
      puppetChar?.costumeSets ?? []
    );
    set((state: any) => ({
      unifiedCharacters: { ...state.unifiedCharacters, [skeletonId]: character },
    }));
    return character;
  },

  setUnifiedDirection: (characterId, variantIndex) => {
    const character = get().unifiedCharacters[characterId];
    if (!character) return;
    const nodes: Record<string, Node> = {};
    for (const [id, node] of Object.entries(character.nodes)) {
      nodes[id] = {
        ...node,
        transform: { ...node.transform, variantIndex: variantIndex as any },
      };
    }
    set((s) => ({
      unifiedCharacters: {
        ...s.unifiedCharacters,
        [characterId]: { ...character, nodes, updatedAt: Date.now() },
      },
    }));
  },

  addUnifiedNode: (characterId, name, opts) => {
    const character = get().unifiedCharacters[characterId];
    if (!character) throw new Error(`Character not found: ${characterId}`);

    const node = createDefaultNode(generateId('node'), name);
    Object.assign(node, opts);

    set((s) => ({
      unifiedCharacters: {
        ...s.unifiedCharacters,
        [characterId]: {
          ...s.unifiedCharacters[characterId]!,
          nodes: { ...s.unifiedCharacters[characterId]!.nodes, [node.id]: node },
          updatedAt: Date.now(),
        },
      },
    }));
    return node;
  },

  removeUnifiedNode: (characterId, nodeId) => {
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      const nodes = { ...character.nodes };
      delete nodes[nodeId];
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: { ...character, nodes, updatedAt: Date.now() },
        },
      };
    });
  },

  updateUnifiedNode: (characterId, nodeId, updates) => {
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      const node = character.nodes[nodeId];
      if (!node) return s;
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: {
            ...character,
            nodes: { ...character.nodes, [nodeId]: { ...node, ...updates } },
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  addUnifiedNodeModifier: (characterId, nodeId, type) => {
    const character = get().unifiedCharacters[characterId];
    const node = character?.nodes[nodeId];
    if (!node) return;
    const modifier: any = {
      id: crypto.randomUUID(),
      type,
      enabled: true,
      collapsed: false,
      params: {},
      startFrame: -1,
      endFrame: -1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      blendMode: 'add',
      paramKeyframes: {},
      paramDrivers: {},
    };
    get().updateUnifiedNode(characterId, nodeId, {
      modifiers: [...(node.modifiers ?? []), modifier],
    });
  },

  removeUnifiedNodeModifier: (characterId, nodeId, modifierId) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().updateUnifiedNode(characterId, nodeId, {
      modifiers: (node.modifiers ?? []).filter((m: any) => m.id !== modifierId),
    });
  },

  updateUnifiedNodeModifier: (characterId, nodeId, modifierId, updates) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().updateUnifiedNode(characterId, nodeId, {
      modifiers: (node.modifiers ?? []).map((m: any) =>
        m.id === modifierId ? { ...m, ...updates } : m
      ),
    });
  },

  toggleUnifiedNodeModifier: (characterId, nodeId, modifierId) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().updateUnifiedNode(characterId, nodeId, {
      modifiers: (node.modifiers ?? []).map((m: any) =>
        m.id === modifierId ? { ...m, enabled: !m.enabled } : m
      ),
    });
  },

  selectedCharacterId: null,
  selectedNodeId: null,
  setSelectedCharacterId: (id) => set({ selectedCharacterId: id }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  // ---- Node Keyframes ----
  addNodeKeyframe: (clipId, nodeId, frame, values) => {
    const state = get();
    state.pushUndo('添加节点关键帧');
    const kf = {
      id: crypto.randomUUID(),
      nodeId,
      frame,
      ...values,
    };
    set((s) => ({
      animationClips: s.animationClips.map((c) =>
        c.id === clipId
          ? { ...c, nodeKeyframes: [...(c.nodeKeyframes ?? []), kf] }
          : c
      ),
    }));
    return kf;
  },

  removeNodeKeyframe: (clipId, keyframeId) => {
    const state = get();
    state.pushUndo('删除节点关键帧');
    set((s) => ({
      animationClips: s.animationClips.map((c) =>
        c.id === clipId
          ? { ...c, nodeKeyframes: (c.nodeKeyframes ?? []).filter((k) => k.id !== keyframeId) }
          : c
      ),
    }));
  },

  updateNodeKeyframe: (clipId, keyframeId, updates) => {
    set((s) => ({
      animationClips: s.animationClips.map((c) =>
        c.id === clipId
          ? { ...c, nodeKeyframes: (c.nodeKeyframes ?? []).map((k) => k.id === keyframeId ? { ...k, ...updates } : k) }
          : c
      ),
    }));
  },

  autoTagNodeDirections: (characterId) => {
    const state = get();
    const character = state.unifiedCharacters[characterId];
    if (!character) return { tagged: 0 };

    const inferSide = (name: string): 'L' | 'R' | 'C' => {
      const n = name.toLowerCase();
      if (/(^|[^a-z])_l([^a-z]|$)|left|左/.test(name) || n.includes('_l')) return 'L';
      if (/(^|[^a-z])_r([^a-z]|$)|right|右/.test(name) || n.includes('_r')) return 'R';
      return 'C';
    };
    const inferIsCore = (name: string, isRoot: boolean): boolean => {
      if (isRoot) return true;
      const n = name.toLowerCase();
      return /body|torso|head|neck|pelvis|chest|waist|身体|躯干|头|颈|骨盆|胸|腰/.test(n);
    };

    let tagged = 0;
    const newNodes: Record<string, Node> = { ...character.nodes };
    for (const [nodeId, node] of Object.entries(character.nodes)) {
      const side = inferSide(node.name);
      const isRoot = nodeId === character.rootNodeId || !node.parentId;
      const isCore = inferIsCore(node.name, isRoot);
      if (node.side !== side || node.isCore !== isCore) {
        tagged++;
        newNodes[nodeId] = { ...node, side, isCore };
      }
    }

    if (tagged > 0) {
      state.pushUndo('批量标记方向');
      set((s) => ({
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: { ...character, nodes: newNodes, updatedAt: Date.now() },
        },
      }));
    }
    return { tagged };
  },

  addUnifiedCostumeSet: (characterId, name) => {
    const state = get();
    state.pushUndo('添加服装集');
    const costumeSet = createDefaultCostumeSet(crypto.randomUUID(), name);
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: {
            ...character,
            costumeSets: [...character.costumeSets, costumeSet],
            updatedAt: Date.now(),
          },
        },
      };
    });
    return costumeSet;
  },

  removeUnifiedCostumeSet: (characterId, costumeSetId) => {
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: {
            ...character,
            costumeSets: character.costumeSets.filter((cs) => cs.id !== costumeSetId),
            activeCostumeSetId: character.activeCostumeSetId === costumeSetId ? undefined : character.activeCostumeSetId,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  updateUnifiedCostumeSet: (characterId, costumeSetId, updates) => {
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: {
            ...character,
            costumeSets: character.costumeSets.map((cs) =>
              cs.id === costumeSetId ? { ...cs, ...updates } : cs
            ),
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  setUnifiedCostumeSprite: (characterId, costumeSetId, nodeId, direction, spriteId) => {
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: {
            ...character,
            costumeSets: character.costumeSets.map((cs) => {
              if (cs.id !== costumeSetId) return cs;
              const piece = cs.pieces[nodeId] ?? createDefaultCostumePiece(nodeId);
              const newSprites = { ...piece.sprites };
              if (spriteId) {
                newSprites[direction] = { spriteId };
              } else {
                delete newSprites[direction];
              }
              return {
                ...cs,
                pieces: { ...cs.pieces, [nodeId]: { ...piece, sprites: newSprites } },
              };
            }),
            updatedAt: Date.now(),
          },
        },
      };
    });
  },
});
