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
import { cloneSubtreeTransposed, cloneClipDataForTranspose } from '../clone-transpose';
import { splitNodeSegment } from '../node-split';
import type { DirectionIndex as SplitDirectionIndex } from '../unified-types';
import { syncCharacterPatternBlueprints } from '../blueprint/pattern-sync';
import { syncCharacterSlashBlueprints } from '../blueprint/slash-sync';

export type CharacterSlice = {
  // ---- Character CRUD ----
  unifiedCharacters: Record<string, Character>;
  addUnifiedCharacter: (name: string, opts?: { skipPlaceholderRoot?: boolean }) => Character;
  removeUnifiedCharacter: (id: string) => void;
  updateUnifiedCharacter: (id: string, updates: Partial<Character>) => void;
  /** Set direction for all nodes (updates transform.variantIndex). variantIndex: 0-7 direction index. */
  setUnifiedDirection: (characterId: string, variantIndex: number) => void;
  /** Currently selected node ID (unified Node ID) */
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  /** 肢体转位克隆：克隆节点子树并转平面角度 θ（含剪辑关键帧跟随）。返回克隆根 id，失败 null */
  cloneNodeSubtreeTransposed: (characterId: string, rootNodeId: string, thetaDeg: number) => string | null;
  /** 纯复制子树（不转位）：与转位克隆同一套引用跟随，仅不挂 rotate 修改器。返回新根 id */
  cloneNodeSubtree: (characterId: string, rootNodeId: string) => string | null;
  /** 节点拆分（工具走甲）：在段 nodeId→childId 中插入新关节（childId=null 为叶子），
   * 精灵逐向切/摞按层断/参数化按档，一次写入（一个撤销步）。 */
  splitUnifiedNode: (characterId: string, nodeId: string, childId: string | null, t: number) => { ok: boolean; error?: string; report: string[]; midNodeId?: string };

  // ---- Node Track Keys（轨道附件轨与帧级操作；姿态通道点由 writePuppetPoseKeyframe 等直写） ----
  /** 写修饰器组轨上某帧的点（空数组 = 删点） */
  setNodeModifierKey: (characterId: string, nodeId: string, frame: number, modifiers: import('../unified-types').ModifierInstance[]) => void;
  removeNodeModifierKey: (characterId: string, nodeId: string, frame: number) => void;
  /** 写转面轨上某帧的点 */
  setNodeFaceTurnKey: (characterId: string, nodeId: string, frame: number, faceTurn: { yaw: number; pitch: number }) => void;
  removeNodeFaceTurnKey: (characterId: string, nodeId: string, frame: number) => void;
  /** 写图层顺序轨上某帧的点 */
  setNodeZIndexKey: (characterId: string, nodeId: string, frame: number, zIndex: number) => void;
  removeNodeZIndexKey: (characterId: string, nodeId: string, frame: number) => void;
  /** 删除某帧在全部轨道（通道+附件）上的点 */
  clearNodeFrameKeys: (characterId: string, nodeId: string, frame: number) => void;
  /** 把某帧的全部轨道点复制到目标帧；目标帧已有该节点的点或源帧无点时返回 false */
  copyNodeFrameKeys: (characterId: string, nodeId: string, fromFrame: number, toFrame: number) => boolean;
  /** 把某帧的全部轨道点移到目标帧；目标帧已有该节点的点或源帧无点时返回 false */
  moveNodeFrameKeys: (characterId: string, nodeId: string, fromFrame: number, toFrame: number) => boolean;
  /** 给某帧全部数值通道点设插值模式覆盖（作用于以该帧结尾的段） */
  setNodeFrameInterpolation: (characterId: string, nodeId: string, frame: number, mode: import('../types').InterpolationMode) => void;
  // ---- 修饰器组轨内的 ParamDriver（按 节点+帧 定位，旧 keyframes 版在 modifier-slice 不动） ----
  toggleTrackParamDriver: (characterId: string, nodeId: string, frame: number, modifierId: string, driverId: string) => void;
  updateTrackParamDriver: (characterId: string, nodeId: string, frame: number, modifierId: string, driverId: string, updates: Partial<import('../unified-types').ParamDriver>) => void;
  removeTrackParamDriver: (characterId: string, nodeId: string, frame: number, modifierId: string, driverId: string) => void;

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


// ---- 轨道点操作（纯函数，供本 slice 的帧级动作共用） ----
type AnyTrack = import('../unified-types').KeyframeTrack<any>;
const ALL_TRACK_KEYS = ['angle', 'tilt', 'x', 'y', 'stretch', 'scaleX', 'variantIndex', 'zIndex', 'modifierKeys', 'faceTurnKeys'] as const;

function upsertPoint(tracks: NodeTracks, key: (typeof ALL_TRACK_KEYS)[number], frame: number, value: unknown): NodeTracks {
  const track = (tracks[key] as AnyTrack | undefined) ?? { keyframes: [], interpolation: 'linear' as const };
  const idx = track.keyframes.findIndex((k) => k.frame === frame);
  const keyframes = idx >= 0
    ? track.keyframes.map((k, i) => (i === idx ? { ...k, value } : k))
    : [...track.keyframes, { frame, value }].sort((a, b) => a.frame - b.frame);
  return { ...tracks, [key]: { ...track, keyframes } };
}

function removePoint(tracks: NodeTracks, key: (typeof ALL_TRACK_KEYS)[number], frame: number): NodeTracks {
  const track = tracks[key] as AnyTrack | undefined;
  if (!track) return tracks;
  return { ...tracks, [key]: { ...track, keyframes: track.keyframes.filter((k) => k.frame !== frame) } };
}

/** 某帧在任一轨道上有点 */
function frameHasPoints(tracks: NodeTracks | undefined, frame: number): boolean {
  if (!tracks) return false;
  return ALL_TRACK_KEYS.some((key) => ((tracks[key] as AnyTrack | undefined)?.keyframes ?? []).some((k) => k.frame === frame));
}

/** 把 from 帧的全部轨道点搬到 to 帧（copy 时保留源）；目标已有该节点点或源无点返回 null */
function shiftFramePoints(tracks: NodeTracks, from: number, to: number, copy: boolean): NodeTracks | null {
  if (!frameHasPoints(tracks, from) || frameHasPoints(tracks, to)) return null;
  let next: NodeTracks = { ...tracks };
  for (const key of ALL_TRACK_KEYS) {
    const track = next[key] as AnyTrack | undefined;
    if (!track) continue;
    const pt = track.keyframes.find((k) => k.frame === from);
    if (!pt) continue;
    const moved = { ...pt, frame: to, value: pt.value !== null && typeof pt.value === 'object' ? structuredClone(pt.value) : pt.value };
    const rest = copy ? track.keyframes : track.keyframes.filter((k) => k.frame !== from);
    next = { ...next, [key]: { ...track, keyframes: [...rest, moved].sort((a, b) => a.frame - b.frame) } };
  }
  return next;
}

export const createCharacterSlice: StateCreator<ProjectStore, [], [], CharacterSlice> = (set, get) => ({
  unifiedCharacters: {},

  addUnifiedCharacter: (name, opts) => {
    const id = generateId('char');
    const character: Character = {
      id,
      name,
      rootNodeId: '',
      nodes: {},
      // NOTE: Character.sprites is deprecated; sprites live in global s.sprites.
      costumeSets: [],
      directionDrawOrders: {},
      latitude: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Create placeholder root node UNLESS caller will provide its own nodes.
    // Callers that build a full skeleton (e.g. creation wizard) should pass
    // { skipPlaceholderRoot: true } and set rootNodeId themselves — otherwise
    // the placeholder lingers and find((n) => !n.parentId) picks the wrong root.
    if (!opts?.skipPlaceholderRoot) {
      const rootNode = createDefaultNode(generateId('node'), 'root');
      character.nodes[rootNode.id] = rootNode;
      character.rootNodeId = rootNode.id;
    }

    set((s) => ({
      unifiedCharacters: { ...s.unifiedCharacters, [id]: character },
    }));
    return character;
  },

  removeUnifiedCharacter: (id) => {
    set((s) => {
      const unifiedCharacters = { ...s.unifiedCharacters };
      delete unifiedCharacters[id];
      // 片段归属必填 → 角色删除时其名下片段级联删除，激活片段被删时回落首个剩余（无则 null）
      const animationClips = s.animationClips.filter((c) => c.puppetCharacterId !== id);
      const activeAnimationClipId = animationClips.some((c) => c.id === s.activeAnimationClipId)
        ? s.activeAnimationClipId
        : (animationClips[0]?.id ?? null);
      return { unifiedCharacters, animationClips, activeAnimationClipId };
    });
  },

  updateUnifiedCharacter: (id, updates) => {
    set((s) => {
      const merged = { ...s.unifiedCharacters[id]!, ...updates, updatedAt: Date.now() };
      // 图案↔蓝图统一：服装集变更（含件挂载图案编辑）→ 图案节点手术式同步落盘
      const patternSynced = (updates as { costumeSets?: unknown }).costumeSets !== undefined
        ? syncCharacterPatternBlueprints(merged as never, true) as typeof merged
        : merged;
      // 刀光↔蓝图统一：表演清单变更（含刀光面板编辑）→ 刀光节点手术式同步落盘
      const slashSynced = (updates as { performances?: unknown }).performances !== undefined
        ? syncCharacterSlashBlueprints(patternSynced as never) as typeof patternSynced
        : patternSynced;
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [id]: slashSynced,
        },
      };
    });
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

    // 挂接关系写全（node.parentId + 父节点 children）：渲染按 root→children
    // 遍历，只写 attachment 的节点不可达、永远不显示（向导/资产面板添加的
    // 肢体曾全中招）。父级推导：显式 parentId > socket 属主 > 根节点；
    // 根不存在（自建骨架拼装中）或父级不在表中时不挂，留给调用方自理。
    let parentId: string | undefined = node.parentId ?? undefined;
    if (!parentId && node.attachment?.type === 'socket' && node.attachment.parentSocketId) {
      const owner = Object.values(character.nodes).find((n) =>
        n.sockets?.some((s) => s.id === node.attachment.parentSocketId),
      );
      if (owner) parentId = owner.id;
    }
    if (
      !parentId &&
      character.rootNodeId &&
      character.nodes[character.rootNodeId] &&
      node.id !== character.rootNodeId
    ) {
      parentId = character.rootNodeId;
    }
    const parent = parentId ? character.nodes[parentId] : undefined;
    if (parent && parent.id !== node.id) {
      node.parentId = parent.id;
    } else {
      parentId = undefined;
    }

    set((s) => {
      const ch = s.unifiedCharacters[characterId]!;
      const nodes = { ...ch.nodes, [node.id]: node };
      if (parentId) {
        const p = nodes[parentId];
        if (p && !p.children.includes(node.id)) {
          nodes[parentId] = { ...p, children: [...p.children, node.id] };
        }
      }
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          [characterId]: { ...ch, nodes, updatedAt: Date.now() },
        },
      };
    });
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

  cloneNodeSubtree: (characterId, rootNodeId) => {
    const state = get();
    const character = state.unifiedCharacters[characterId];
    if (!character) return null;
    const result = cloneSubtreeTransposed(character, rootNodeId, 0, generateId, {
      width: state.canvasWidth,
      height: state.canvasHeight,
    }, { plain: true });
    if (!result) return null;
    state.pushUndo('复制子树');
    set((s) => ({
      unifiedCharacters: {
        ...s.unifiedCharacters,
        [characterId]: { ...result.character, updatedAt: Date.now() },
      },
      animationClips: s.animationClips.map(
        (clip) => cloneClipDataForTranspose(clip, characterId, result, generateId) ?? clip,
      ),
    }));
    return result.newRootId;
  },

  cloneNodeSubtreeTransposed: (characterId, rootNodeId, thetaDeg) => {
    const state = get();
    const character = state.unifiedCharacters[characterId];
    if (!character) return null;
    const result = cloneSubtreeTransposed(character, rootNodeId, thetaDeg, generateId, {
      width: state.canvasWidth,
      height: state.canvasHeight,
    });
    if (!result) return null;
    state.pushUndo('转位克隆');
    set((s) => ({
      unifiedCharacters: {
        ...s.unifiedCharacters,
        [characterId]: { ...result.character, updatedAt: Date.now() },
      },
      animationClips: s.animationClips.map(
        (clip) => cloneClipDataForTranspose(clip, characterId, result, generateId) ?? clip,
      ),
    }));
    return result.newRootId;
  },

  splitUnifiedNode: (characterId, nodeId, childId, t) => {
    const state = get();
    const character = state.unifiedCharacters[characterId];
    if (!character) return { ok: false, error: '角色不存在', report: [] as string[] };
    const direction = ((character.nodes[character.rootNodeId]?.transform.variantIndex ?? 2) as SplitDirectionIndex);
    const out = splitNodeSegment({ character, sprites: state.sprites, nodeId, childId, t, direction });
    if (!out.ok || !out.character) {
      return { ok: false, error: out.error, report: out.report };
    }
    state.pushUndo('拆分节点');
    const mergedSprites = { ...state.sprites };
    for (const sp of out.newSprites ?? []) if (sp.id) mergedSprites[sp.id] = sp;
    set((s) => ({
      unifiedCharacters: {
        ...s.unifiedCharacters,
        [characterId]: { ...out.character!, updatedAt: Date.now() },
      },
      sprites: mergedSprites,
      selectedNodeId: out.midNodeId ?? s.selectedNodeId,
    }));
    return { ok: true, report: out.report, midNodeId: out.midNodeId };
  },

  updateUnifiedNode: (characterId, nodeId, updates) => {
    set((s) => {
      const character = s.unifiedCharacters[characterId];
      if (!character) return s;
      const node = character.nodes[nodeId];
      if (!node) return s;
      const mergedChar = {
        ...character,
        nodes: { ...character.nodes, [nodeId]: { ...node, ...updates } },
        updatedAt: Date.now(),
      };
      return {
        unifiedCharacters: {
          ...s.unifiedCharacters,
          // 图案↔蓝图统一：节点图案列表变更 → 图案节点手术式同步落盘
          [characterId]: (updates as { dynamicPatterns?: unknown }).dynamicPatterns !== undefined
            ? syncCharacterPatternBlueprints(mergedChar as never, true) as typeof mergedChar
            : mergedChar,
        },
      };
    });
  },

  addUnifiedNodeModifier: (characterId, nodeId, type) => {
    const character = get().unifiedCharacters[characterId];
    const node = character?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('添加修改器');
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
    get().pushUndo('删除修改器');
    get().updateUnifiedNode(characterId, nodeId, {
      modifiers: (node.modifiers ?? []).filter((m: any) => m.id !== modifierId),
    });
  },

  updateUnifiedNodeModifier: (characterId, nodeId, modifierId, updates) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    // 参数编辑逐字/逐帧触发，同键 1 秒窗合并避免刷栈
    get().pushUndo('更新修改器', 'updateNodeModifier');
    get().updateUnifiedNode(characterId, nodeId, {
      modifiers: (node.modifiers ?? []).map((m: any) =>
        m.id === modifierId ? { ...m, ...updates } : m
      ),
    });
  },

  toggleUnifiedNodeModifier: (characterId, nodeId, modifierId) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('开关修改器');
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

  // ---- Node Track Keys ----
  setNodeModifierKey: (characterId, nodeId, frame, modifiers) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('编辑关键帧修饰器');
    const tracks = modifiers.length > 0
      ? upsertPoint(node.tracks ?? {}, 'modifierKeys', frame, structuredClone(modifiers))
      : removePoint(node.tracks ?? {}, 'modifierKeys', frame);
    get().updateUnifiedNode(characterId, nodeId, { tracks });
  },

  removeNodeModifierKey: (characterId, nodeId, frame) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('删除关键帧修饰器');
    get().updateUnifiedNode(characterId, nodeId, { tracks: removePoint(node.tracks ?? {}, 'modifierKeys', frame) });
  },

  setNodeFaceTurnKey: (characterId, nodeId, frame, faceTurn) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('编辑转面关键帧');
    get().updateUnifiedNode(characterId, nodeId, {
      tracks: upsertPoint(node.tracks ?? {}, 'faceTurnKeys', frame, { yaw: faceTurn.yaw, pitch: faceTurn.pitch }),
    });
  },

  removeNodeFaceTurnKey: (characterId, nodeId, frame) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('删除转面关键帧');
    get().updateUnifiedNode(characterId, nodeId, { tracks: removePoint(node.tracks ?? {}, 'faceTurnKeys', frame) });
  },

  setNodeZIndexKey: (characterId, nodeId, frame, zIndex) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('编辑图层顺序关键帧');
    get().updateUnifiedNode(characterId, nodeId, {
      tracks: upsertPoint(node.tracks ?? {}, 'zIndex', frame, zIndex),
    });
  },

  removeNodeZIndexKey: (characterId, nodeId, frame) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node) return;
    get().pushUndo('删除图层顺序关键帧');
    get().updateUnifiedNode(characterId, nodeId, { tracks: removePoint(node.tracks ?? {}, 'zIndex', frame) });
  },

  clearNodeFrameKeys: (characterId, nodeId, frame) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node?.tracks) return;
    get().pushUndo('删除节点关键帧');
    let tracks = node.tracks;
    for (const key of ALL_TRACK_KEYS) tracks = removePoint(tracks, key, frame);
    get().updateUnifiedNode(characterId, nodeId, { tracks });
  },

  copyNodeFrameKeys: (characterId, nodeId, fromFrame, toFrame) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node?.tracks) return false;
    const next = shiftFramePoints(node.tracks, fromFrame, toFrame, true);
    if (!next) return false;
    get().pushUndo('复制节点关键帧');
    get().updateUnifiedNode(characterId, nodeId, { tracks: next });
    return true;
  },

  moveNodeFrameKeys: (characterId, nodeId, fromFrame, toFrame) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node?.tracks) return false;
    const next = shiftFramePoints(node.tracks, fromFrame, toFrame, false);
    if (!next) return false;
    get().pushUndo('移动节点关键帧');
    get().updateUnifiedNode(characterId, nodeId, { tracks: next });
    return true;
  },

  setNodeFrameInterpolation: (characterId, nodeId, frame, mode) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    if (!node?.tracks) return;
    let tracks = node.tracks;
    for (const key of ALL_TRACK_KEYS) {
      if (key === 'modifierKeys' || key === 'faceTurnKeys') continue;
      const track = tracks[key] as AnyTrack | undefined;
      if (!track?.keyframes.some((k) => k.frame === frame)) continue;
      tracks = {
        ...tracks,
        [key]: { ...track, keyframes: track.keyframes.map((k) => (k.frame === frame ? { ...k, interpolation: mode } : k)) },
      };
    }
    get().updateUnifiedNode(characterId, nodeId, { tracks });
  },

  toggleTrackParamDriver: (characterId, nodeId, frame, modifierId, driverId) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    const pt = node?.tracks?.modifierKeys?.keyframes.find((k) => k.frame === frame);
    if (!node || !pt) return;
    get().pushUndo('切换参数驱动器');
    const modifiers = pt.value.map((m) => m.id !== modifierId ? m : {
      ...m,
      paramDrivers: (m.paramDrivers ?? []).map((d) => (d.id === driverId ? { ...d, enabled: !d.enabled } : d)),
    });
    get().updateUnifiedNode(characterId, nodeId, {
      tracks: upsertPoint(node.tracks ?? {}, 'modifierKeys', frame, modifiers),
    });
  },

  updateTrackParamDriver: (characterId, nodeId, frame, modifierId, driverId, updates) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    const pt = node?.tracks?.modifierKeys?.keyframes.find((k) => k.frame === frame);
    if (!node || !pt) return;
    get().pushUndo('更新参数驱动器');
    const modifiers = pt.value.map((m) => m.id !== modifierId ? m : {
      ...m,
      paramDrivers: (m.paramDrivers ?? []).map((d) => (d.id === driverId ? { ...d, ...updates } : d)),
    });
    get().updateUnifiedNode(characterId, nodeId, {
      tracks: upsertPoint(node.tracks ?? {}, 'modifierKeys', frame, modifiers),
    });
  },

  removeTrackParamDriver: (characterId, nodeId, frame, modifierId, driverId) => {
    const node = get().unifiedCharacters[characterId]?.nodes[nodeId];
    const pt = node?.tracks?.modifierKeys?.keyframes.find((k) => k.frame === frame);
    if (!node || !pt) return;
    get().pushUndo('删除参数驱动器');
    const modifiers = pt.value.map((m) => m.id !== modifierId ? m : {
      ...m,
      paramDrivers: (m.paramDrivers ?? []).filter((d) => d.id !== driverId),
    });
    get().updateUnifiedNode(characterId, nodeId, {
      tracks: upsertPoint(node.tracks ?? {}, 'modifierKeys', frame, modifiers),
    });
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
