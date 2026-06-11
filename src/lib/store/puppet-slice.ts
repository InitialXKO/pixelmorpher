// ============================================================
// PixelMorpher - Puppet Slice
// Concrete Puppet System: PuppetSkeleton, PuppetCharacter, CostumeSet
// ============================================================

import { generateDefaultCostumeSprite } from '../engine/default-costume-sprites';
import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type {
  PuppetSkeleton,
  PuppetNode,
  PuppetSocket,
  PuppetPlug,
  PuppetCharacter,
  CostumeSet,
  PuppetDirection,
  PuppetNodeKeyframe,
} from '../types';
import { PUPPET_DIRECTIONS, DIRECTION_MIRROR } from '../types';

// ---- Tree structure for rendering ----
export interface PuppetNodeTree {
  node: PuppetNode;
  children: PuppetNodeTree[];
}

export type PuppetSlice = {
  // ---- Puppet Skeleton CRUD ----
  addPuppetSkeleton: (name: string) => PuppetSkeleton;
  removePuppetSkeleton: (id: string) => void;
  updatePuppetSkeleton: (id: string, updates: Partial<PuppetSkeleton>) => void;
  setPuppetDirection: (skeletonId: string, direction: PuppetDirection) => void;
  setPuppetLatitude: (skeletonId: string, latitude: number) => void;

  // ---- Puppet Node CRUD ----
  addPuppetNode: (skeletonId: string, name: string, opts?: Partial<Pick<PuppetNode, 'plug' | 'sockets' | 'spritePartId' | 'angle' | 'stretch' | 'offsetX' | 'offsetY' | 'zIndex' | 'crossSectionTop' | 'crossSectionBottom' | 'color' | 'visible' | 'mirrorFrom'>>) => PuppetNode;
  removePuppetNode: (skeletonId: string, nodeId: string) => void;
  updatePuppetNode: (skeletonId: string, nodeId: string, updates: Partial<PuppetNode>) => void;
  addPuppetSocket: (skeletonId: string, nodeId: string, name: string, localX: number, localY: number) => PuppetSocket;
  removePuppetSocket: (skeletonId: string, nodeId: string, socketId: string) => void;
  setPuppetNodeSprite: (skeletonId: string, nodeId: string, partId: string | null, direction?: PuppetDirection) => void;

  // ---- Puppet Node Keyframes ----
  addPuppetNodeKeyframe: (clipId: string, nodeId: string, frame: number, values: Partial<Pick<PuppetNodeKeyframe, 'angle' | 'stretch' | 'offsetX' | 'offsetY' | 'direction' | 'viewLatitude'>>) => PuppetNodeKeyframe;
  removePuppetNodeKeyframe: (clipId: string, keyframeId: string) => void;
  updatePuppetNodeKeyframe: (clipId: string, keyframeId: string, updates: Partial<PuppetNodeKeyframe>) => void;

  // ---- Puppet Character CRUD ----
  addPuppetCharacter: (name: string, skeletonId: string) => PuppetCharacter;
  removePuppetCharacter: (id: string) => void;
  updatePuppetCharacter: (id: string, updates: Partial<PuppetCharacter>) => void;
  setActiveCostumeSet: (characterId: string, costumeSetId: string | null) => void;

  // ---- Costume Set CRUD ----
  addCostumeSet: (characterId: string, name: string) => CostumeSet;
  removeCostumeSet: (characterId: string, costumeSetId: string) => void;
  updateCostumeSet: (characterId: string, costumeSetId: string, updates: Partial<CostumeSet>) => void;
  setCostumeSprite: (characterId: string, costumeSetId: string, nodeId: string, direction: PuppetDirection, partId: string | null) => void;

  // ---- Selection ----
  selectedPuppetNodeId: string | null;
  setSelectedPuppetNodeId: (id: string | null) => void;

  // ---- Helpers (exported for use in render pipeline) ----
  computeDirectionDrawOrder: (skeleton: PuppetSkeleton) => PuppetNode[];
  buildPuppetNodeTree: (skeleton: PuppetSkeleton) => PuppetNodeTree[];
  halfPixelAlign: (v: number) => number;
  snapToPixel: (v: number) => number;
};

// ---- Helper functions ----

/** Snap a value to the nearest integer pixel */
export function snapToPixel(v: number): number {
  return Math.round(v);
}

/** Apply half-pixel alignment for crisp rendering */
function halfPixelAlign(v: number): number {
  const rounded = Math.round(v);
  return rounded % 2 === 0 ? rounded : rounded + 0.5;
}

/** Build a tree from the flat node list using plug/socket connections */
export function buildPuppetNodeTree(skeleton: PuppetSkeleton): PuppetNodeTree[] {
  const nodeMap = new Map(skeleton.nodes.map(n => [n.id, n]));
  const childrenMap = new Map<string, PuppetNodeTree[]>();
  const roots: PuppetNodeTree[] = [];

  for (const node of skeleton.nodes) {
    if (!childrenMap.has(node.id)) {
      childrenMap.set(node.id, []);
    }
  }

  for (const node of skeleton.nodes) {
    const tree: PuppetNodeTree = { node, children: childrenMap.get(node.id) ?? [] };
    if (!node.plug) {
      roots.push(tree);
    } else {
      const parent = nodeMap.get(
        skeleton.nodes.find(n => n.sockets.some(s => s.id === node.plug!.socketId))?.id ?? ''
      );
      if (parent) {
        if (!childrenMap.has(parent.id)) childrenMap.set(parent.id, []);
        childrenMap.get(parent.id)!.push(tree);
      } else {
        roots.push(tree);
      }
    }
  }

  return roots;
}

/** Direction-dependent draw order for 8-direction puppet rendering */
export function computeDirectionDrawOrder(skeleton: PuppetSkeleton): PuppetNode[] {
  const direction = skeleton.currentDirection;
  const nodes = [...skeleton.nodes];

  // Base z-index ordering
  const sorted = nodes.sort((a, b) => a.zIndex - b.zIndex);

  // Direction-dependent adjustments
  const isLeft = direction === 'NW' || direction === 'W' || direction === 'SW';

  return sorted.map(node => {
    // Flip z-index for mirrored limbs in left-facing directions
    let adjustedZ = node.zIndex;
    if (isLeft && node.mirrorFrom) {
      // Swap left/right z-ordering for mirrored nodes
      adjustedZ = 1000 - node.zIndex;
    }
    return { ...node, zIndex: adjustedZ };
  }).sort((a, b) => a.zIndex - b.zIndex);
}

// ---- Slice Implementation ----

export const createPuppetSlice: StateCreator<ProjectStore, [], [], PuppetSlice> = (set, get) => ({
  selectedPuppetNodeId: null,
  setSelectedPuppetNodeId: (id) => set({ selectedPuppetNodeId: id }),

  // ---- Puppet Skeleton CRUD ----
  addPuppetSkeleton: (name) => {
    const state = get();
    state.pushUndo('添加木偶骨骼');
    const skeleton: PuppetSkeleton = {
      id: crypto.randomUUID(),
      name,
      nodes: [],
      currentDirection: 'S',
      viewLatitude: 0,
    };
    set(s => ({ puppetSkeletons: [...s.puppetSkeletons, skeleton] }));
    return skeleton;
  },

  removePuppetSkeleton: (id) => {
    const state = get();
    state.pushUndo('删除木偶骨骼');
    set(s => ({ puppetSkeletons: s.puppetSkeletons.filter(sk => sk.id !== id) }));
  },

  updatePuppetSkeleton: (id, updates) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === id ? { ...sk, ...updates } : sk
      ),
    }));
  },

  setPuppetDirection: (skeletonId, direction) => {
    set(s => {
      // Update the skeleton's current direction
      const updatedSkeletons = s.puppetSkeletons.map(sk =>
        sk.id === skeletonId ? { ...sk, currentDirection: direction } : sk
      );

      // CRITICAL FIX: Sync all existing puppet keyframes to the new direction.
      // Without this, keyframes retain stale direction values from when they were
      // created, causing shouldMirrorDirection() to make incorrect mirror decisions
      // based on the old direction. This is the root cause of the bug where paired
      // limbs' sprites suddenly change when their rotation angles match — the
      // interpolated direction from an old keyframe triggers wrong mirroring.
      const updatedClips = s.animationClips.map(clip => {
        if (!clip.puppetNodeKeyframes || clip.puppetNodeKeyframes.length === 0) return clip;
        // Only update keyframes for clips that belong to a character using this skeleton
        const character = s.puppetCharacters.find(c =>
          c.puppetSkeletonId === skeletonId &&
          c.id === clip.puppetCharacterId
        );
        if (!character) return clip;

        return {
          ...clip,
          puppetNodeKeyframes: clip.puppetNodeKeyframes.map(kf => ({
            ...kf,
            direction,
          })),
        };
      });

      return {
        puppetSkeletons: updatedSkeletons,
        animationClips: updatedClips,
      };
    });
  },

  setPuppetLatitude: (skeletonId, latitude) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId ? { ...sk, viewLatitude: Math.max(0, Math.min(90, latitude)) } : sk
      ),
    }));
  },

  // ---- Puppet Node CRUD ----
  addPuppetNode: (skeletonId, name, opts) => {
    const state = get();
    state.pushUndo('添加木偶节点');

    // Auto-generate a default costume sprite if no spritePartId is provided
    let resolvedSpritePartId = opts?.spritePartId ?? null;
    if (!resolvedSpritePartId) {
      try {
        const skeleton = state.puppetSkeletons.find(sk => sk.id === skeletonId);
        const templateName = skeleton ? 'humanoid' : 'humanoid'; // Default to humanoid
        const spriteResult = generateDefaultCostumeSprite(name, templateName, opts?.color ?? '#888888');
        const part = state.addPart(`${name}_${spriteResult.partName}`, spriteResult.width, spriteResult.height, { pivotX: spriteResult.pivotX, pivotY: spriteResult.pivotY });
        state.setPartPixels(part.id, spriteResult.pixels);
        resolvedSpritePartId = part.id;
      } catch (e) {
        // Fallback: no sprite if generation fails
        console.warn('Failed to auto-generate default costume sprite:', e);
      }
    }

    const node: PuppetNode = {
      id: crypto.randomUUID(),
      name,
      sockets: opts?.sockets ?? [],
      plug: opts?.plug ?? null,
      spritePartId: resolvedSpritePartId,
      directionSprites: {},
      mirrorFrom: opts?.mirrorFrom ?? false,
      angle: opts?.angle ?? 0,
      stretch: opts?.stretch ?? 1,
      offsetX: opts?.offsetX ?? 0,
      offsetY: opts?.offsetY ?? 0,
      crossSectionTop: opts?.crossSectionTop ?? 4,
      crossSectionBottom: opts?.crossSectionBottom ?? 4,
      zIndex: opts?.zIndex ?? 10,
      visible: opts?.visible ?? true,
      color: opts?.color ?? '#888888',
    };
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId ? { ...sk, nodes: [...sk.nodes, node] } : sk
      ),
    }));
    return node;
  },

  removePuppetNode: (skeletonId, nodeId) => {
    const state = get();
    state.pushUndo('删除木偶节点');
    // Also remove children that plug into this node's sockets
    const skeleton = state.puppetSkeletons.find(sk => sk.id === skeletonId);
    if (!skeleton) return;
    const socketIds = new Set(skeleton.nodes.find(n => n.id === nodeId)?.sockets.map(s => s.id) ?? []);
    const idsToRemove = new Set([nodeId]);
    // Recursively find children
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of skeleton.nodes) {
        if (idsToRemove.has(n.id)) continue;
        if (n.plug && socketIds.has(n.plug.socketId)) {
          // Direct child of removed node
        } else if (n.plug && idsToRemove.has(
          skeleton.nodes.find(sn => sn.sockets.some(s => s.id === n.plug!.socketId))?.id ?? ''
        )) {
          // Child of a removed child
        } else continue;
        idsToRemove.add(n.id);
        n.sockets.forEach(s => socketIds.add(s.id));
        changed = true;
      }
    }
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId ? { ...sk, nodes: sk.nodes.filter(n => !idsToRemove.has(n.id)) } : sk
      ),
    }));
  },

  updatePuppetNode: (skeletonId, nodeId, updates) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n) }
          : sk
      ),
    }));
  },

  addPuppetSocket: (skeletonId, nodeId, name, localX, localY) => {
    const socket: PuppetSocket = { id: crypto.randomUUID(), name, localX, localY };
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, sockets: [...n.sockets, socket] } : n) }
          : sk
      ),
    }));
    return socket;
  },

  removePuppetSocket: (skeletonId, nodeId, socketId) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, sockets: n.sockets.filter(s => s.id !== socketId) } : n) }
          : sk
      ),
    }));
  },

  setPuppetNodeSprite: (skeletonId, nodeId, partId, direction) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? {
              ...sk,
              nodes: sk.nodes.map(n => {
                if (n.id !== nodeId) return n;
                if (direction) {
                  const ds = { ...n.directionSprites };
                  if (partId) ds[direction] = partId;
                  else delete ds[direction];
                  return { ...n, directionSprites: ds };
                }
                return { ...n, spritePartId: partId };
              }),
            }
          : sk
      ),
    }));
  },

  // ---- Puppet Node Keyframes ----
  addPuppetNodeKeyframe: (clipId, nodeId, frame, values) => {
    const state = get();
    state.pushUndo('添加木偶关键帧');
    const kf: PuppetNodeKeyframe = {
      id: crypto.randomUUID(),
      nodeId,
      frame,
      ...values,
    };
    set(s => ({
      animationClips: s.animationClips.map(c =>
        c.id === clipId
          ? { ...c, puppetNodeKeyframes: [...(c.puppetNodeKeyframes ?? []), kf] }
          : c
      ),
    }));
    return kf;
  },

  removePuppetNodeKeyframe: (clipId, keyframeId) => {
    const state = get();
    state.pushUndo('删除木偶关键帧');
    set(s => ({
      animationClips: s.animationClips.map(c =>
        c.id === clipId
          ? { ...c, puppetNodeKeyframes: (c.puppetNodeKeyframes ?? []).filter(k => k.id !== keyframeId) }
          : c
      ),
    }));
  },

  updatePuppetNodeKeyframe: (clipId, keyframeId, updates) => {
    set(s => ({
      animationClips: s.animationClips.map(c =>
        c.id === clipId
          ? { ...c, puppetNodeKeyframes: (c.puppetNodeKeyframes ?? []).map(k => k.id === keyframeId ? { ...k, ...updates } : k) }
          : c
      ),
    }));
  },

  // ---- Puppet Character CRUD ----
  addPuppetCharacter: (name, skeletonId) => {
    const state = get();
    state.pushUndo('添加木偶角色');

    // Auto-create a default costume set populated with existing node sprites
    const skeleton = state.puppetSkeletons.find(sk => sk.id === skeletonId);
    const defaultCostumeSpriteMap: Record<string, string> = {};
    if (skeleton) {
      for (const node of skeleton.nodes) {
        if (node.spritePartId) {
          for (const dir of PUPPET_DIRECTIONS) {
            defaultCostumeSpriteMap[`${node.id}:${dir}`] = node.spritePartId;
          }
        }
      }
    }

    const defaultCostumeSet: CostumeSet = {
      id: crypto.randomUUID(),
      name: '默认服装',
      spriteMap: defaultCostumeSpriteMap,
    };

    const character: PuppetCharacter = {
      id: crypto.randomUUID(),
      name,
      puppetSkeletonId: skeletonId,
      costumeSets: [defaultCostumeSet],
      activeCostumeSetId: defaultCostumeSet.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(s => ({ puppetCharacters: [...s.puppetCharacters, character] }));
    return character;
  },

  removePuppetCharacter: (id) => {
    const state = get();
    state.pushUndo('删除木偶角色');
    set(s => ({ puppetCharacters: s.puppetCharacters.filter(c => c.id !== id) }));
  },

  updatePuppetCharacter: (id, updates) => {
    set(s => ({
      puppetCharacters: s.puppetCharacters.map(c =>
        c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
      ),
    }));
  },

  setActiveCostumeSet: (characterId, costumeSetId) => {
    set(s => ({
      puppetCharacters: s.puppetCharacters.map(c =>
        c.id === characterId ? { ...c, activeCostumeSetId: costumeSetId } : c
      ),
    }));
  },

  // ---- Costume Set CRUD ----
  addCostumeSet: (characterId, name) => {
    const state = get();
    state.pushUndo('添加服装集');
    const costumeSet: CostumeSet = {
      id: crypto.randomUUID(),
      name,
      spriteMap: {},
    };
    set(s => ({
      puppetCharacters: s.puppetCharacters.map(c =>
        c.id === characterId ? { ...c, costumeSets: [...c.costumeSets, costumeSet] } : c
      ),
    }));
    return costumeSet;
  },

  removeCostumeSet: (characterId, costumeSetId) => {
    set(s => ({
      puppetCharacters: s.puppetCharacters.map(c =>
        c.id === characterId
          ? { ...c, costumeSets: c.costumeSets.filter(cs => cs.id !== costumeSetId), activeCostumeSetId: c.activeCostumeSetId === costumeSetId ? null : c.activeCostumeSetId }
          : c
      ),
    }));
  },

  updateCostumeSet: (characterId, costumeSetId, updates) => {
    set(s => ({
      puppetCharacters: s.puppetCharacters.map(c =>
        c.id === characterId
          ? { ...c, costumeSets: c.costumeSets.map(cs => cs.id === costumeSetId ? { ...cs, ...updates } : cs) }
          : c
      ),
    }));
  },

  setCostumeSprite: (characterId, costumeSetId, nodeId, direction, partId) => {
    set(s => ({
      puppetCharacters: s.puppetCharacters.map(c => {
        if (c.id !== characterId) return c;
        return {
          ...c,
          costumeSets: c.costumeSets.map(cs => {
            if (cs.id !== costumeSetId) return cs;
            const key = `${nodeId}:${direction}`;
            const newMap = { ...cs.spriteMap };
            if (partId) newMap[key] = partId;
            else delete newMap[key];
            return { ...cs, spriteMap: newMap };
          }),
        };
      }),
    }));
  },

  // ---- Helpers ----
  computeDirectionDrawOrder,
  buildPuppetNodeTree,
  halfPixelAlign,
  snapToPixel,
});
