// ============================================================
// PixelMorpher - Puppet Slice
// Concrete Puppet System: PuppetSkeleton, PuppetCharacter, CostumeSet
// ============================================================

import { generateDefaultCostumeSprite } from '../engine/default-costume-sprites';
import { applyJointOpenings, getPlugJointWidth, type JointOpeningSpec } from '../engine/render-helpers/puppet-joint-color';
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
  PartAnimationModifier,
  ModifierParamValue,
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
  /** 创建单节点道具角色（用于背景/道具/UI 等简单动画，走统一木偶模型） */
  addPropCharacter: (name: string) => PuppetCharacter;
  removePuppetSkeleton: (id: string) => void;
  updatePuppetSkeleton: (id: string, updates: Partial<PuppetSkeleton>) => void;
  setPuppetDirection: (skeletonId: string, direction: PuppetDirection) => void;
  setPuppetLatitude: (skeletonId: string, latitude: number) => void;

  // ---- Puppet Node CRUD ----
  addPuppetNode: (skeletonId: string, name: string, opts?: Partial<Pick<PuppetNode, 'plug' | 'sockets' | 'spritePartId' | 'angle' | 'stretch' | 'offsetX' | 'offsetY' | 'zIndex' | 'crossSectionTop' | 'crossSectionBottom' | 'color' | 'visible' | 'mirrorFrom'>>) => PuppetNode;
  removePuppetNode: (skeletonId: string, nodeId: string) => void;
  updatePuppetNode: (skeletonId: string, nodeId: string, updates: Partial<PuppetNode>) => void;
  // ---- Z-order（Word 式相对操作） ----
  bringNodeToFront: (skeletonId: string, nodeId: string) => void;
  sendNodeToBack: (skeletonId: string, nodeId: string) => void;
  bringNodeForward: (skeletonId: string, nodeId: string) => void;
  sendNodeBackward: (skeletonId: string, nodeId: string) => void;
  addPuppetSocket: (skeletonId: string, nodeId: string, name: string, localX: number, localY: number) => PuppetSocket;
  removePuppetSocket: (skeletonId: string, nodeId: string, socketId: string) => void;
  setPuppetNodeSprite: (skeletonId: string, nodeId: string, partId: string | null, direction?: PuppetDirection) => void;

  // ---- Puppet Node Keyframes ----
  addPuppetNodeKeyframe: (clipId: string, nodeId: string, frame: number, values: Partial<Pick<PuppetNodeKeyframe, 'angle' | 'stretch' | 'offsetX' | 'offsetY' | 'direction' | 'viewLatitude' | 'zIndex'>>) => PuppetNodeKeyframe;
  removePuppetNodeKeyframe: (clipId: string, keyframeId: string) => void;
  updatePuppetNodeKeyframe: (clipId: string, keyframeId: string, updates: Partial<PuppetNodeKeyframe>) => void;

  // ---- Puppet Node Modifiers（程序化动画） ----
  addPuppetNodeModifier: (skeletonId: string, nodeId: string, type: PartAnimationModifier['type']) => PartAnimationModifier;
  removePuppetNodeModifier: (skeletonId: string, nodeId: string, modifierId: string) => void;
  updatePuppetNodeModifier: (skeletonId: string, nodeId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  togglePuppetNodeModifier: (skeletonId: string, nodeId: string, modifierId: string) => void;

  // ---- Puppet Character CRUD ----
  addPuppetCharacter: (name: string, skeletonId: string) => PuppetCharacter;
  removePuppetCharacter: (id: string) => void;
  updatePuppetCharacter: (id: string, updates: Partial<PuppetCharacter>) => void;
  setActiveCostumeSet: (characterId: string, costumeSetId: string | null) => void;
  /** 克隆角色+骨骼（深拷贝节点，生成新 ID），返回新角色 */
  clonePuppetCharacter: (characterId: string, newName: string) => PuppetCharacter | null;

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
export function computeDirectionDrawOrder(
  skeleton: PuppetSkeleton,
  interpolatedZIndex?: Map<string, number>,
): PuppetNode[] {
  const direction = skeleton.currentDirection;
  const nodes = [...skeleton.nodes];

  // Base z-index ordering (use interpolated keyframe zIndex if available)
  const getZ = (n: PuppetNode) => interpolatedZIndex?.get(n.id) ?? n.zIndex;
  const sorted = nodes.sort((a, b) => getZ(a) - getZ(b));

  // Direction-dependent adjustments
  const isLeft = direction === 'NW' || direction === 'W' || direction === 'SW';

  return sorted.map(node => {
    // Flip z-index for mirrored limbs in left-facing directions
    let adjustedZ = getZ(node);
    if (isLeft && node.mirrorFrom) {
      // Swap left/right z-ordering for mirrored nodes
      adjustedZ = 1000 - adjustedZ;
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

  addPropCharacter: (name) => {
    const state = get();
    // 单节点骨骼：无 socket/plug，就是一个可动精灵
    const skeleton = state.addPuppetSkeleton(`${name}骨骼`);
    state.addPuppetNode(skeleton.id, name, {
      angle: 0,
      stretch: 1,
      offsetX: 0,
      offsetY: 0,
      zIndex: 0,
      visible: true,
    });
    // 创建角色（自动建默认服装集）
    return state.addPuppetCharacter(name, skeleton.id);
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
    // 注意：不要重写已有关键帧的 direction。
    // 渲染器在解析精灵/镜像时使用 skeleton.currentDirection（实时方向），
    // 关键帧里记录的 direction 只是录制时的快照。历史上这里曾重写全部
    // 关键帧，会静默销毁用户的逐帧方向数据，已移除。
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId ? { ...sk, currentDirection: direction } : sk
      ),
    }));
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
    let computedJointWidth: number | null = null;
    if (!resolvedSpritePartId) {
      try {
        const skeleton = state.puppetSkeletons.find(sk => sk.id === skeletonId);
        const templateName = skeleton ? 'humanoid' : 'humanoid'; // Default to humanoid
        const spriteResult = generateDefaultCostumeSprite(name, templateName, opts?.color ?? '#888888');
        // 关节开口约定：默认精灵在 plug / socket 对应的轮廓处留开口。
        // jointWidth 写入 plug，供两侧渲染共用（= 关节盘直径）。
        {
          const openings: JointOpeningSpec[] = [];
          if (opts?.plug) {
            const px = spriteResult.pivotX + opts.plug.localX;
            const py = spriteResult.pivotY + opts.plug.localY;
            const w = getPlugJointWidth(
              {
                plug: { localX: opts.plug.localX, localY: opts.plug.localY },
                crossSectionTop: opts.crossSectionTop ?? 4,
                crossSectionBottom: opts.crossSectionBottom ?? 4,
              },
              { width: spriteResult.width, height: spriteResult.height, pivotX: spriteResult.pivotX, pivotY: spriteResult.pivotY },
            );
            computedJointWidth = w;
            openings.push({ x: px, y: py, width: w });
          }
          for (const s of opts?.sockets ?? []) {
            openings.push({
              x: spriteResult.pivotX + s.localX,
              y: spriteResult.pivotY + s.localY,
              width: opts?.crossSectionBottom ?? 4,
            });
          }
          applyJointOpenings(spriteResult.pixels, openings);
        }
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
      plug: opts?.plug
        ? { ...opts.plug, jointWidth: computedJointWidth ?? opts.plug.jointWidth ?? null }
        : null,
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
      modifiers: [],
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

  // ---- Z-order（Word 式相对操作，不暴露数字） ----
  bringNodeToFront: (skeletonId, nodeId) => {
    const state = get();
    state.pushUndo('节点置于顶层');
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk => {
        if (sk.id !== skeletonId) return sk;
        const maxZ = Math.max(0, ...sk.nodes.map(n => n.zIndex));
        return { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, zIndex: maxZ + 1 } : n) };
      }),
    }));
  },

  sendNodeToBack: (skeletonId, nodeId) => {
    const state = get();
    state.pushUndo('节点置于底层');
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk => {
        if (sk.id !== skeletonId) return sk;
        const minZ = Math.min(0, ...sk.nodes.map(n => n.zIndex));
        return { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, zIndex: minZ - 1 } : n) };
      }),
    }));
  },

  bringNodeForward: (skeletonId, nodeId) => {
    const state = get();
    const sk = state.puppetSkeletons.find(x => x.id === skeletonId);
    const node = sk?.nodes.find(n => n.id === nodeId);
    if (!sk || !node) return;
    const higher = sk.nodes
      .filter(n => n.zIndex > node.zIndex)
      .sort((a, b) => a.zIndex - b.zIndex)[0];
    if (!higher) return; // 已在最上
    state.pushUndo('节点上移一层');
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(x =>
        x.id === skeletonId
          ? {
              ...x,
              nodes: x.nodes.map(n =>
                n.id === nodeId ? { ...n, zIndex: higher.zIndex }
                : n.id === higher.id ? { ...n, zIndex: node.zIndex }
                : n
              ),
            }
          : x
      ),
    }));
  },

  sendNodeBackward: (skeletonId, nodeId) => {
    const state = get();
    const sk = state.puppetSkeletons.find(x => x.id === skeletonId);
    const node = sk?.nodes.find(n => n.id === nodeId);
    if (!sk || !node) return;
    const lower = sk.nodes
      .filter(n => n.zIndex < node.zIndex)
      .sort((a, b) => b.zIndex - a.zIndex)[0];
    if (!lower) return; // 已在最下
    state.pushUndo('节点下移一层');
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(x =>
        x.id === skeletonId
          ? {
              ...x,
              nodes: x.nodes.map(n =>
                n.id === nodeId ? { ...n, zIndex: lower.zIndex }
                : n.id === lower.id ? { ...n, zIndex: node.zIndex }
                : n
              ),
            }
          : x
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

  // ---- Puppet Node Modifiers（程序化动画） ----
  addPuppetNodeModifier: (skeletonId, nodeId, type) => {
    const modifier: PartAnimationModifier = {
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
      groupId: null,
    };
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, modifiers: [...(n.modifiers ?? []), modifier] } : n) }
          : sk
      ),
    }));
    return modifier;
  },

  removePuppetNodeModifier: (skeletonId, nodeId, modifierId) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, modifiers: (n.modifiers ?? []).filter(m => m.id !== modifierId) } : n) }
          : sk
      ),
    }));
  },

  updatePuppetNodeModifier: (skeletonId, nodeId, modifierId, params) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, modifiers: (n.modifiers ?? []).map(m => m.id === modifierId ? { ...m, params: { ...m.params, ...params } } : m) } : n) }
          : sk
      ),
    }));
  },

  togglePuppetNodeModifier: (skeletonId, nodeId, modifierId) => {
    set(s => ({
      puppetSkeletons: s.puppetSkeletons.map(sk =>
        sk.id === skeletonId
          ? { ...sk, nodes: sk.nodes.map(n => n.id === nodeId ? { ...n, modifiers: (n.modifiers ?? []).map(m => m.id === modifierId ? { ...m, enabled: !m.enabled } : m) } : n) }
          : sk
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

  clonePuppetCharacter: (characterId, newName) => {
    const state = get();
    const character = state.puppetCharacters.find((c) => c.id === characterId);
    if (!character) return null;
    const skeleton = state.puppetSkeletons.find((sk) => sk.id === character.puppetSkeletonId);
    if (!skeleton) return null;

    state.pushUndo('克隆木偶角色');

    // 深拷贝骨骼：节点新 ID，socket/plug 引用更新
    const nodeIdMap = new Map<string, string>();
    for (const n of skeleton.nodes) {
      nodeIdMap.set(n.id, crypto.randomUUID());
    }
    const clonedNodes = skeleton.nodes.map((n) => {
      const newSockets = n.sockets.map((s) => ({ ...s, id: crypto.randomUUID() }));
      // plug 的 socketId 需要映射到新 socket ID
      // 简化：通过原 socket 在原节点中的索引找新 socket
      let newPlug: { socketId: string; localX: number; localY: number } | null = null;
      if (n.plug) {
        // 找到父节点和原 socket
        const parentNode = skeleton.nodes.find((pn) =>
          pn.sockets.some((s) => s.id === n.plug!.socketId)
        );
        if (parentNode) {
          const socketIdx = parentNode.sockets.findIndex((s) => s.id === n.plug!.socketId);
          // 注意：clonedNodes 还在构建中，不能在这里查找，先占位，后续修正
          newPlug = {
            socketId: `__PENDING__${parentNode.id}:${socketIdx}`,
            localX: n.plug.localX,
            localY: n.plug.localY,
          };
        }
      }
      return {
        ...n,
        id: nodeIdMap.get(n.id)!,
        sockets: newSockets,
        plug: newPlug,
        // 深拷贝 modifiers/blueprint（浅拷贝数组，元素引用不变，可接受）
        modifiers: [...n.modifiers],
      };
    });
    // 修正 plug 的 socketId
    const socketIdMap = new Map<string, string>();
    for (const origNode of skeleton.nodes) {
      const newNodeId = nodeIdMap.get(origNode.id)!;
      const newNode = clonedNodes.find((cn) => cn.id === newNodeId)!;
      origNode.sockets.forEach((s, idx) => {
        socketIdMap.set(s.id, newNode.sockets[idx].id);
      });
    }
    for (const cn of clonedNodes) {
      if (cn.plug && cn.plug.socketId.startsWith('__PENDING__')) {
        const [, origParentId, idxStr] = cn.plug.socketId.split(':');
        const origParent = skeleton.nodes.find((n) => n.id === origParentId);
        const origSocketId = origParent?.sockets[Number(idxStr)]?.id;
        const newSocketId = origSocketId ? socketIdMap.get(origSocketId) : null;
        if (newSocketId) {
          cn.plug.socketId = newSocketId;
        } else {
          cn.plug = null; // 找不到则断开
        }
      }
    }

    const newSkeleton: PuppetSkeleton = {
      ...skeleton,
      id: crypto.randomUUID(),
      name: `${skeleton.name}（装配副本）`,
      nodes: clonedNodes,
    };
    set((s) => ({ puppetSkeletons: [...s.puppetSkeletons, newSkeleton] }));

    // 克隆角色（服装集浅拷贝，新 ID）
    const newCharacter: PuppetCharacter = {
      ...character,
      id: crypto.randomUUID(),
      name: newName,
      puppetSkeletonId: newSkeleton.id,
      costumeSets: character.costumeSets.map((cs) => ({
        ...cs,
        id: crypto.randomUUID(),
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // 修正服装集的 spriteMap：key 是 `${nodeId}:${dir}`，需映射新 nodeId
    for (const cs of newCharacter.costumeSets) {
      const newMap: Record<string, string> = {};
      for (const [key, partId] of Object.entries(cs.spriteMap)) {
        const [oldNodeId, dir] = key.split(':');
        const newNodeId = nodeIdMap.get(oldNodeId);
        if (newNodeId) newMap[`${newNodeId}:${dir}`] = partId;
      }
      cs.spriteMap = newMap;
    }
    set((s) => ({ puppetCharacters: [...s.puppetCharacters, newCharacter] }));
    return newCharacter;
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
