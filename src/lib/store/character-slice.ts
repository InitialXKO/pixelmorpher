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
import { createDefaultNode } from '../unified-types';

export type CharacterSlice = {
  // ---- Character CRUD ----
  unifiedCharacters: Record<string, Character>;
  addUnifiedCharacter: (name: string) => Character;
  removeUnifiedCharacter: (id: string) => void;
  updateUnifiedCharacter: (id: string, updates: Partial<Character>) => void;

  // ---- Node CRUD ----
  addUnifiedNode: (characterId: string, name: string, opts?: Partial<Node>) => Node;
  removeUnifiedNode: (characterId: string, nodeId: string) => void;
  updateUnifiedNode: (characterId: string, nodeId: string, updates: Partial<Node>) => void;

  // ---- Selection ----
  selectedCharacterId: string | null;
  selectedNodeId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
  setSelectedNodeId: (id: string | null) => void;
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

  selectedCharacterId: null,
  selectedNodeId: null,
  setSelectedCharacterId: (id) => set({ selectedCharacterId: id }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
});
