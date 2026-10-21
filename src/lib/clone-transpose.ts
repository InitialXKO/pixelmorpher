// 肢体转位克隆：把一个节点子树深拷贝一份，克隆根绕其 socket 附着点在平面内
// 转 θ 安置（转位 = 转平面角度，不含 tilt、不镜像、附着点不变、子孙局部角不变）。
//
// θ 的承载：克隆根挂一个 'rotate' 变换修改器（params.angle = θ），在渲染
// Step 2 与关键帧角度加算——不改 base/轨道/剪辑/服装偏移的任何角度值，
// 事后可调、可关。节点有蓝图时按手术式同步把修改器节点接进图（优先
// addModifierNodeToBlueprint；其要求 time/screen 节点，缺失时手动接进
// transform 输出节点的 rotation 端口）；无蓝图时渲染端按 modifiers 现场生成。
//
// 引用跟随口径：
// - 子树内部引用重映射跟随：children/parentId、子孙 attachment.parentSocketId
//   （socket 随父节点克隆换新 id）、节点蓝图里指向子树节点的 nodeId 参数、
//   服装集 pieces（按新 slotKey 复制条目，精灵共用）、nodeOffsets、slotVariants、
//   剪辑 nodeKeyframes（按新 nodeId 原样复制）、剪辑状态关键帧的 slotChanges
//   （同帧补新 slotKey 同值）。
// - 克隆根的 parentSocketId 指向原父节点 socket（子树外），保持不变。
// - 完全落在子树内的 IK 链才克隆（跨界链不克隆）；静态 target3D/poleTarget3D
//   绕链根第 0 帧世界位在 XY 平面（东/下）内转 θ，target 镜像按不变式重算
//   （IK 覆写是顶层绝对替换，只认目标——转位对 IK 的尊重只能从目标侧给）；
//   蓝图驱动的链另在链上记 transposeAngle：渲染端在蓝图输出覆盖目标之后、
//   求解之前，绕链根当前世界位把图输出转 θ（改在 IK 蓝图的输入端）。
// - 角色级蓝图（角色/状态/全局）里指向原节点的引用不改（外部引用留在原肢体）。

import type { Character, Node, IKChain, NodeKeyframe, CostumeStateKeyframe, ModifierInstance } from './unified-types';
import { computeWorldTransforms } from './unified-render';
import { subToPx, ikTargetMirror } from './unified-types';
import { addModifierNodeToBlueprint } from './blueprint/migrate';
import type { BlueprintGraph } from './blueprint/ir';

export type IdFactory = (prefix: string) => string;

const defaultId: IdFactory = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 在任意 params 对象里把「恰好等于旧节点 id 的字符串值」换成新 id（递归） */
function remapIdStrings(value: unknown, idMap: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === 'string' && idMap.has(v)) value[i] = idMap.get(v);
      else remapIdStrings(v, idMap);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && idMap.has(v)) obj[k] = idMap.get(v);
      else remapIdStrings(v, idMap);
    }
  }
}

/**
 * 把 rotate 修改器接进已有蓝图：优先手术式 addModifierNodeToBlueprint
 * （要求图中有 time/screen 节点）；未生效时手动把 rotate 节点接进
 * transform 输出节点的 rotation 端口（已有连接则插 add 节点合并，
 * 字面量则经 const 节点保留）。无 transform 节点则原图返回（修改器仅存列表）。
 */
function attachRotateModifierToBlueprint(
  bp: BlueprintGraph,
  mod: ModifierInstance,
  nextId: IdFactory,
): BlueprintGraph {
  const patched = addModifierNodeToBlueprint(bp, mod as never);
  const modGraphId = `mod_${mod.id.replace(/-/g, '').slice(0, 12)}`;
  if (patched.nodes.some((n) => n.id === modGraphId)) return patched;

  const graph = deepClone(bp);
  let timeNode = graph.nodes.find((n) => n.type === 'time');
  if (!timeNode) {
    timeNode = { id: nextId('time'), type: 'time', inputs: {}, params: {} };
    graph.nodes.push(timeNode);
  }
  graph.nodes.push({
    id: modGraphId,
    type: 'rotate',
    inputs: { t: { nodeId: timeNode.id } },
    params: { enabled: true, angle: Number(mod.params.angle ?? 0), pivotOffsetX: 0, pivotOffsetY: 0 },
  });
  const transformNode = graph.nodes.find((n) => n.type === 'transform');
  if (!transformNode) return bp;
  const existing = transformNode.inputs.rotation as { nodeId?: string; type?: string; value?: number } | undefined;
  if (existing && typeof existing === 'object' && 'nodeId' in existing && existing.nodeId) {
    const addId = nextId('add');
    graph.nodes.push({
      id: addId,
      type: 'add',
      inputs: {
        a: existing as never,
        b: { nodeId: modGraphId, output: 'outRotation' },
      },
      params: {},
    });
    transformNode.inputs.rotation = { nodeId: addId, output: 'out' };
  } else if (existing && typeof existing === 'object' && existing.type === 'number') {
    const constId = nextId('const');
    graph.nodes.push({ id: constId, type: 'const', inputs: {}, params: { value: existing.value ?? 0 } });
    const addId = nextId('add');
    graph.nodes.push({
      id: addId,
      type: 'add',
      inputs: {
        a: { nodeId: constId, output: 'out' },
        b: { nodeId: modGraphId, output: 'outRotation' },
      },
      params: {},
    });
    transformNode.inputs.rotation = { nodeId: addId, output: 'out' };
  } else {
    transformNode.inputs.rotation = { nodeId: modGraphId, output: 'outRotation' };
  }
  return graph;
}

export interface TransposeCloneResult {
  character: Character;
  newRootId: string;
  /** 旧节点 id → 新节点 id */
  idMap: Map<string, string>;
  /** 旧 slotKey → 新 slotKey（仅有 slot 的节点） */
  slotKeyMap: Map<string, string>;
  oldRootId: string;
}

/**
 * 角色级转位克隆（纯函数，不改入参）。根节点（角色 root）不可克隆 → null。
 */
export function cloneSubtreeTransposed(
  character: Character,
  rootNodeId: string,
  thetaDeg: number,
  nextId: IdFactory = defaultId,
  /** 给出时，克隆 IK 链的 target 镜像按投影不变式重算（需画布尺寸） */
  canvas?: { width: number; height: number },
): TransposeCloneResult | null {
  const root = character.nodes[rootNodeId];
  if (!root || rootNodeId === character.rootNodeId || !root.parentId) return null;
  const parent = character.nodes[root.parentId];
  if (!parent) return null;

  // 收集子树（按 children 链）
  const subtreeIds: string[] = [];
  const stack = [rootNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    const n = character.nodes[id];
    if (!n) continue;
    subtreeIds.push(id);
    stack.push(...n.children);
  }
  const inSubtree = new Set(subtreeIds);

  const idMap = new Map<string, string>();
  for (const id of subtreeIds) idMap.set(id, nextId('node'));
  const socketMap = new Map<string, string>();
  for (const id of subtreeIds) {
    for (const s of character.nodes[id].sockets) socketMap.set(s.id, nextId('socket'));
  }
  // slotKey 唯一化：挂新节点 id，天然不与既有 key 冲突
  const slotKeyMap = new Map<string, string>();
  for (const id of subtreeIds) {
    const key = character.nodes[id].slot?.slotKey;
    if (key) slotKeyMap.set(key, `${key}@${idMap.get(id)}`);
  }

  const nodes: Record<string, Node> = { ...character.nodes };
  // 父节点：children 追加克隆根
  nodes[parent.id] = { ...parent, children: [...parent.children, idMap.get(rootNodeId)!] };

  for (const oldId of subtreeIds) {
    const src = character.nodes[oldId];
    const node = deepClone(src);
    node.id = idMap.get(oldId)!;
    node.parentId = oldId === rootNodeId ? src.parentId : idMap.get(src.parentId!)!;
    node.children = src.children.map((c) => idMap.get(c)!).filter(Boolean);
    node.sockets = node.sockets.map((s) => ({ ...s, id: socketMap.get(s.id)! }));
    // attachment 的 parentSocketId：父在子树内 → 指克隆父的新 socket；克隆根指原父 socket，保持
    if (oldId !== rootNodeId && node.attachment.parentSocketId && socketMap.has(node.attachment.parentSocketId)) {
      node.attachment = { ...node.attachment, parentSocketId: socketMap.get(node.attachment.parentSocketId) };
    }
    if (node.slot && slotKeyMap.has(node.slot.slotKey)) {
      node.slot = { ...node.slot, slotKey: slotKeyMap.get(node.slot.slotKey)! };
    }
    // 节点蓝图内部指向子树节点的 id 参数（如 nodeRef.nodeId）重映射
    if (node.blueprint) remapIdStrings(node.blueprint as unknown, idMap);
    if (oldId === rootNodeId) {
      node.name = `${src.name}·转位`;
      // θ 由 'rotate' 变换修改器承载（渲染 Step 2 加算），不改任何角度数据
      const mod: ModifierInstance = {
        id: nextId('mod'),
        type: 'rotate',
        enabled: true,
        collapsed: false,
        params: { angle: thetaDeg, pivotOffsetX: 0, pivotOffsetY: 0 },
        blendMode: 'add',
        paramKeyframes: [],
        paramDrivers: [],
      };
      node.modifiers = [...node.modifiers, mod];
      if (node.blueprint) {
        node.blueprint = attachRotateModifierToBlueprint(node.blueprint, mod, nextId);
      }
    }
    nodes[node.id] = node;
  }

  // 服装集：pieces 按新 slotKey 复制（精灵共用，条目深拷贝）；nodeOffsets 跟随（根 angle +θ）
  const costumeSets = character.costumeSets.map((set) => {
    let pieces = set.pieces;
    let piecesChanged = false;
    const nextPieces = { ...set.pieces };
    for (const [oldKey, newKey] of slotKeyMap) {
      if (set.pieces[oldKey]) {
        nextPieces[newKey] = deepClone(set.pieces[oldKey]);
        piecesChanged = true;
      }
    }
    if (piecesChanged) pieces = nextPieces;
    let nodeOffsets = set.nodeOffsets;
    if (set.nodeOffsets) {
      let offChanged = false;
      const nextOffsets = { ...set.nodeOffsets };
      for (const oldId of subtreeIds) {
        const off = set.nodeOffsets[oldId];
        if (off) {
          nextOffsets[idMap.get(oldId)!] = { ...off };
          offChanged = true;
        }
      }
      if (offChanged) nodeOffsets = nextOffsets;
    }
    return piecesChanged || nodeOffsets !== set.nodeOffsets ? { ...set, pieces, nodeOffsets } : set;
  });

  // 槽位变体指派跟随新 slotKey
  let slotVariants = character.slotVariants;
  if (character.slotVariants) {
    let changed = false;
    const next = { ...character.slotVariants };
    for (const [oldKey, newKey] of slotKeyMap) {
      if (character.slotVariants[oldKey] !== undefined) {
        next[newKey] = character.slotVariants[oldKey];
        changed = true;
      }
    }
    if (changed) slotVariants = next;
  }

  // IK 链：完全落在子树内的才克隆；目标绕链根第 0 帧世界位平面内转 θ
  const ikChains: IKChain[] = [...(character.ikChains ?? [])];
  const internalChains = ikChains.filter((c) => inSubtree.has(c.rootNodeId) && inSubtree.has(c.endNodeId));
  if (internalChains.length > 0) {
    const world = computeWorldTransforms(character, 0, canvas?.width ?? 0, canvas?.height ?? 0);
    const rad = (thetaDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotateTarget = (chain: IKChain, v: { x: number; y: number; z: number }) => {
      const rw = world.get(chain.rootNodeId);
      if (!rw) return v;
      const px = subToPx(rw.worldX);
      const py = subToPx(rw.worldY);
      const dx = v.x - px;
      const dy = v.y - py;
      return { x: px + dx * cos - dy * sin, y: py + dx * sin + dy * cos, z: v.z };
    };
    for (const chain of internalChains) {
      const c = deepClone(chain);
      c.id = nextId('ik');
      c.name = `${chain.name}·转位`;
      c.rootNodeId = idMap.get(chain.rootNodeId)!;
      c.endNodeId = idMap.get(chain.endNodeId)!;
      // 蓝图驱动目标的转位角（求解输入端生效，与源链已有转位角叠加）
      c.transposeAngle = (chain.transposeAngle ?? 0) + thetaDeg;
      if (c.target3D) {
        c.target3D = rotateTarget(chain, c.target3D);
        if (canvas) {
          const rw = world.get(chain.rootNodeId);
          const dir = (rw?.variantIndex ?? 6) as import('./unified-types').DirectionIndex;
          c.target = ikTargetMirror(c.target3D, dir, canvas.width, canvas.height);
        }
      }
      if (c.poleTarget3D) c.poleTarget3D = rotateTarget(chain, c.poleTarget3D);
      ikChains.push(c);
    }
  }

  return {
    character: { ...character, nodes, costumeSets, slotVariants, ikChains },
    newRootId: idMap.get(rootNodeId)!,
    idMap,
    slotKeyMap,
    oldRootId: rootNodeId,
  };
}

/**
 * 剪辑级跟随（纯函数）：把属于该角色的 nodeKeyframes 按 idMap 原样复制一份
 * （角度不改——转位由克隆根的 rotate 修改器在渲染期叠加），并给状态关键帧
 * 的 slotChanges 补新 slotKey 同值。无可复制内容时返回 null（剪辑不变）。
 */
export function cloneClipDataForTranspose<T extends { puppetCharacterId?: string; nodeKeyframes?: NodeKeyframe[]; stateKeyframes?: CostumeStateKeyframe[] }>(
  clip: T,
  characterId: string,
  result: TransposeCloneResult,
  nextId: IdFactory = defaultId,
): T | null {
  if (clip.puppetCharacterId !== characterId) return null;
  const { idMap, slotKeyMap } = result;
  let changed = false;

  const srcKfs = clip.nodeKeyframes ?? [];
  const additions: NodeKeyframe[] = [];
  for (const kf of srcKfs) {
    const newNodeId = idMap.get(kf.nodeId);
    if (!newNodeId) continue;
    additions.push({
      ...deepClone(kf),
      id: nextId('kf'),
      nodeId: newNodeId,
    });
  }
  let nodeKeyframes = clip.nodeKeyframes;
  if (additions.length > 0) {
    nodeKeyframes = [...srcKfs, ...additions];
    changed = true;
  }

  let stateKeyframes = clip.stateKeyframes;
  if (clip.stateKeyframes && slotKeyMap.size > 0) {
    let skChanged = false;
    const next = clip.stateKeyframes.map((sk) => {
      if (!sk.slotChanges) return sk;
      const merged = { ...sk.slotChanges };
      let hit = false;
      for (const [oldKey, newKey] of slotKeyMap) {
        if (oldKey in sk.slotChanges) {
          merged[newKey] = sk.slotChanges[oldKey];
          hit = true;
        }
      }
      if (!hit) return sk;
      skChanged = true;
      return { ...sk, slotChanges: merged };
    });
    if (skChanged) {
      stateKeyframes = next;
      changed = true;
    }
  }

  return changed ? { ...clip, nodeKeyframes, stateKeyframes } : null;
}
