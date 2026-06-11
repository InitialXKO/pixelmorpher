// ============================================================
// PixelMorpher - Unified Store Slice
// ============================================================
// Provides a unified data view over the old store state.
//
// Architecture:
// - Old store data (Part, PuppetNode, etc.) remains the source of truth
// - This slice lazily builds and caches a UnifiedProject from old data
// - The unified render pipeline reads from getUnifiedProject() directly
//   instead of going through LiveAdapter
// - Cache is invalidated whenever relevant old state changes
// - This is a progressive migration step — eventually, the old data
//   will be deprecated and the unified types will become primary
//
// Migration Strategy:
// Phase 1 (current): Derived state — unified view over old data
// Phase 2: Dual-write — actions write to both old and unified
// Phase 3: Primary — unified types become the source of truth
// ============================================================

import type { StateCreator } from 'zustand';
import type {
  UnifiedProject,
  Character,
  UnifiedAnimationClip,
  Node,
  Socket,
  AnimationVariable as UnifiedAnimationVariable,
} from '../unified-types';
import { migrateOldProject } from '../migration-adapter';
import type { ProjectStore } from './types';

// ---- Unified Slice State & Actions ----

export interface UnifiedSlice {
  // ---- Cached unified project ----
  /** Cached UnifiedProject derived from old store data.
   *  Null if not yet computed or invalidated. */
  _unifiedProjectCache: UnifiedProject | null;
  /** Cache key — a hash of relevant state to detect changes */
  _unifiedCacheKey: string;

  // ---- Unified data access ----
  /** Get the unified project view, building it lazily if needed */
  getUnifiedProject: () => UnifiedProject;
  /** Get a specific character by ID from the unified project */
  getUnifiedCharacter: (characterId: string) => Character | null;
  /** Get a specific node by ID from any character in the unified project */
  getUnifiedNode: (nodeId: string) => { node: Node; character: Character } | null;
  /** Get all unified animation clips */
  getUnifiedAnimationClips: () => UnifiedAnimationClip[];
  /** Get all unified animation variables */
  getUnifiedAnimationVariables: () => UnifiedAnimationVariable[];

  // ---- Cache management ----
  /** Invalidate the unified cache — called when old store data changes */
  invalidateUnifiedCache: () => void;
  /** Force rebuild the unified cache from current old store data */
  rebuildUnifiedCache: () => void;
}

// ---- Cache Key Computation ----

/**
 * Compute a cache key from the old store state.
 * This is a lightweight hash of the data that affects the unified view.
 * If any of these change, the cache is invalidated and rebuilt.
 */
function computeCacheKey(state: ProjectStore): string {
  // Include IDs and counts of key entities — this is a tradeoff between
  // accuracy (detecting all changes) and performance (avoiding deep hashing).
  // For most use cases, detecting structural changes (add/remove/reorder)
  // is sufficient — property-level changes (pixel edits, angle changes)
  // will also trigger invalidation via the pipeline bridge.

  const partsKey = state.parts.map(p => `${p.id}:${p.width}x${p.height}:${p.zIndex}:${p.visible}`).join('|');
  const skeletonsKey = (state as any).puppetSkeletons?.map((s: any) =>
    `${s.id}:${s.currentDirection}:${s.viewLatitude}:${s.nodes.map((n: any) => `${n.id}:${n.angle}:${n.stretch}:${n.offsetX}:${n.offsetY}`).join(',')}`
  ).join('||') ?? '';
  const charactersKey = (state as any).puppetCharacters?.map((c: any) =>
    `${c.id}:${c.puppetSkeletonId}:${c.activeCostumeSetId}`
  ).join('|') ?? '';
  const clipsKey = state.animationClips?.map((c: any) =>
    `${c.id}:${c.isPuppetClip}:${c.puppetCharacterId}:${(c.puppetNodeKeyframes?.length ?? 0)}:${(c.clipPartData?.length ?? 0)}:${(c.keyframes?.length ?? 0)}`
  ).join('|') ?? '';
  const globalModsKey = (state as any).globalModifiers?.map((m: any) =>
    `${m.id}:${m.type}:${m.enabled}`
  ).join('|') ?? '';
  const varsKey = (state as any).animationVariables?.map((v: any) =>
    `${v.id}:${v.name}:${v.defaultValue}`
  ).join('|') ?? '';
  const frameKey = (state as any).currentFrame ?? 0;
  const canvasKey = `${(state as any).canvasWidth ?? 64}x${(state as any).canvasHeight ?? 64}`;

  return `${partsKey}::${skeletonsKey}::${charactersKey}::${clipsKey}::${globalModsKey}::${varsKey}::${frameKey}::${canvasKey}`;
}

// ---- Slice Creator ----

export const createUnifiedSlice: StateCreator<ProjectStore, [], [], UnifiedSlice> = (set, get) => ({
  // State
  _unifiedProjectCache: null,
  _unifiedCacheKey: '',

  // ---- Unified data access ----

  getUnifiedProject: () => {
    const state = get();
    const key = computeCacheKey(state);

    // Return cached if valid
    if (state._unifiedProjectCache && state._unifiedCacheKey === key) {
      return state._unifiedProjectCache;
    }

    // Rebuild from old store data
    const oldData = {
      id: (state as any).id ?? 'project',
      name: (state as any).name ?? 'Untitled',
      parts: state.parts,
      puppetSkeletons: (state as any).puppetSkeletons,
      puppetCharacters: (state as any).puppetCharacters,
      puppetNodeKeyframes: state.animationClips?.flatMap((c: any) => c.puppetNodeKeyframes ?? []) ?? [],
      animationClips: state.animationClips,
      costumeSets: (state as any).puppetCharacters?.flatMap((c: any) => c.costumeSets ?? []) ?? [],
      globalModifiers: (state as any).globalModifiers,
      animationVariables: (state as any).animationVariables,
      canvasWidth: (state as any).canvasWidth ?? 64,
      canvasHeight: (state as any).canvasHeight ?? 64,
      backgroundColor: (state as any).backgroundColor ?? '#000000',
      frameRate: (state as any).frameRate ?? 12,
    };

    const { project } = migrateOldProject(oldData);

    // Cache the result
    set({
      _unifiedProjectCache: project,
      _unifiedCacheKey: key,
    });

    return project;
  },

  getUnifiedCharacter: (characterId: string) => {
    const project = get().getUnifiedProject();
    return project.characters.find(c => c.id === characterId) ?? null;
  },

  getUnifiedNode: (nodeId: string) => {
    const project = get().getUnifiedProject();
    for (const character of project.characters) {
      const node = character.nodes[nodeId];
      if (node) {
        return { node, character };
      }
    }
    return null;
  },

  getUnifiedAnimationClips: () => {
    const project = get().getUnifiedProject();
    return project.animationClips;
  },

  getUnifiedAnimationVariables: () => {
    const project = get().getUnifiedProject();
    return project.animationVariables;
  },

  // ---- Cache management ----

  invalidateUnifiedCache: () => {
    set({
      _unifiedProjectCache: null,
      _unifiedCacheKey: '',
    });
  },

  rebuildUnifiedCache: () => {
    // Force rebuild by invalidating then accessing
    set({ _unifiedProjectCache: null, _unifiedCacheKey: '' });
    get().getUnifiedProject();
  },
});
