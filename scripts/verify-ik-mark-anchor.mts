// IK 目标标记锚定探针：目标点锚定到节点当前精灵的点标记。
// 判别夹具：静态目标 S、蓝图目标 B、标记点 M 三者互不相同且都在链可达
// 范围内——锚定生效落 M、解析失败回落 B（有蓝图时）/S、resettle 遍剥
// 离锚定（冻结位赢，与 targetBlueprint 同规矩）。
import {
  computeWorldTransforms, resolveIKMarkAnchorTarget, resettleChainOverride,
  type ClampStateMap,
} from '../src/lib/unified-render';
import {
  createDefaultCostumePiece, createDefaultNode, frameYAxisWorld, pxToSub, subToPx,
  type Character, type ClampAnchor, type IKChain, type Sprite,
} from '../src/lib/unified-types';
import type { BlueprintGraph } from '../src/lib/blueprint/ir';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const W = 512;
type WT = { worldX: number; worldY: number; worldZ: number; worldFrame: never };
const pos = (t: Map<string, unknown>, id: string) => {
  const w = t.get(id) as WT;
  return { x: subToPx(w.worldX), y: subToPx(w.worldY), z: subToPx(w.worldZ) };
};
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ---------- 夹具：横臂（肩→肘→手，40+40）+ 道具节点（带 grip 点标记的精灵） ----------
const mk = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  if (parentId) n.parentId = parentId;
  (n.transform as { variantIndex: number }).variantIndex = 6;
  return n;
};
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const attach = (n: ReturnType<typeof mk>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};

const S = { x: 10, y: 10, z: 0 };     // 静态目标（尖端口径）
const B = { x: -30, y: 60, z: 0 };   // 蓝图目标（尖端口径）
const M = { x: 38, y: 50, z: 0 };    // 标记点世界位（手算：道具 (30,50) + 标记局部 (8,0)）
const TIP = 40; // 链无显式 tipLength、无精灵 → 求解器回落末段长 40（与既有口径一致）

function buildChar(propSprite: Sprite) {
  const root = mk('ma_root', 'root');
  const shoulder = mk('ma_shoulder', '肩', root.id);
  const elbow = mk('ma_elbow', '肘', shoulder.id);
  const hand = mk('ma_hand', '手', elbow.id);
  const prop = mk('ma_prop', '道具', root.id);
  root.children = [shoulder.id, prop.id];
  shoulder.children = [elbow.id]; elbow.children = [hand.id];
  root.sockets = [sock('s_sh', 0, 0), sock('s_prop', 30, 50)];
  shoulder.sockets = [sock('s_el', 40, 0)];
  elbow.sockets = [sock('s_ha', 40, 0)];
  attach(shoulder, 's_sh'); attach(elbow, 's_el'); attach(hand, 's_ha'); attach(prop, 's_prop');
  const piece = createDefaultCostumePiece('prop');
  piece.sprites = { 6: { spriteId: propSprite.id } } as never;
  prop.slot = piece as never;
  const nodes = { [root.id]: root, [shoulder.id]: shoulder, [elbow.id]: elbow, [hand.id]: hand, [prop.id]: prop };
  return { nodes, ids: { root: root.id, shoulder: shoulder.id, elbow: elbow.id, hand: hand.id, prop: prop.id }, piece };
}

const grid = (w: number, h: number) => Array.from({ length: h }, () => Array(w).fill('#888888'));
const sprA: Sprite = {
  id: 'ma_sprA', name: '道具A', width: 20, height: 10, data: grid(20, 10),
  plug: { x: pxToSub(2), y: pxToSub(5) },
  marks: [{ id: 'm1', name: 'grip', kind: 'point', x: 0.5, y: 0.5 }],
} as unknown as Sprite;
// 同名标记在另一张精灵的另一位置：markPx (0,5) → 局部 (−2,0) → 世界 (28,50)
const sprB: Sprite = {
  id: 'ma_sprB', name: '道具B', width: 20, height: 10, data: grid(20, 10),
  plug: { x: pxToSub(2), y: pxToSub(5) },
  marks: [{ id: 'm1', name: 'grip', kind: 'point', x: 0, y: 0.5 }],
} as unknown as Sprite;

const blueprint: BlueprintGraph = {
  version: 1,
  nodes: [{
    id: 'ma_out', type: 'transform', inputs: {},
    params: { translateX: B.x, translateY: B.y, translateZ: B.z }, ui: { x: 0, y: 0 },
  } as never],
  outputId: 'ma_out',
};

function buildCharacter(propSprite: Sprite, chainPatch: Partial<IKChain>): Character {
  const { nodes, ids, piece } = buildChar(propSprite);
  const chain: IKChain = {
    id: 'ch_arm', name: '臂', rootNodeId: ids.shoulder, endNodeId: ids.hand,
    target: { x: 256, y: 256 }, target3D: { ...S },
    enabled: true, solver: '2bone', bendDir: 1, tipLength: 0,
    ...chainPatch,
  } as IKChain;
  return {
    id: 'ma1', name: '标记锚定测试',
    nodes, rootNodeId: ids.root,
    sprites: { [propSprite.id]: propSprite },
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { prop: piece } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
    ikChains: [chain],
  } as unknown as Character;
}

const tipOf = (t: Map<string, unknown>, id: string) => {
  const w = t.get(id) as WT;
  const ya = frameYAxisWorld(w.worldFrame, 6);
  const j = pos(t, id);
  return { x: j.x + ya.x * TIP, y: j.y + ya.y * TIP, z: j.z + ya.z * TIP };
};

// ---------- 1) 解析器：标记点世界位与手算一致 ----------
{
  const ch = buildCharacter(sprA, {});
  const fk = computeWorldTransforms(ch, 0, W, W, 12) as Map<string, unknown>;
  const p = resolveIKMarkAnchorTarget(ch, fk as never, { nodeId: 'ma_prop', mark: 'grip' }, ch.sprites as never);
  ok(!!p && dist(p, M) < 0.01, `1a 标记解析 = 手算世界位 (38,50,0)（实际 ${p ? `${p.x},${p.y},${p.z}` : 'null'}）`);
  const miss = resolveIKMarkAnchorTarget(ch, fk as never, { nodeId: 'ma_prop', mark: 'nope' }, ch.sprites as never);
  ok(miss === null, '1b 标记不存在 → null（消费端回落）');
  const noSpr = resolveIKMarkAnchorTarget(ch, fk as never, { nodeId: 'ma_hand', mark: 'grip' }, ch.sprites as never);
  ok(noSpr === null, '1c 节点无精灵 → null');
}

// ---------- 2) 求解消费（全渲染路径）：尖端落标记点 ----------
{
  const ch = buildCharacter(sprA, { targetMarkAnchor: { nodeId: 'ma_prop', mark: 'grip' } });
  const t = computeWorldTransforms(ch, 0, W, W, 12) as Map<string, unknown>;
  const tip = tipOf(t, 'ma_hand');
  ok(dist(tip, M) < 2, `2a 锚定链尖端落标记点 M（距 ${dist(tip, M).toFixed(2)}）`);
  ok(dist(tip, S) > 20, '2b 不取静态目标 S（夹具可判别）');
}

// ---------- 3) 优先序：锚定 > 蓝图 > 静态 ----------
{
  const chBoth = buildCharacter(sprA, {
    targetBlueprint: blueprint,
    targetMarkAnchor: { nodeId: 'ma_prop', mark: 'grip' },
  });
  const tipBoth = tipOf(computeWorldTransforms(chBoth, 0, W, W, 12) as Map<string, unknown>, 'ma_hand');
  ok(dist(tipBoth, M) < 2 && dist(tipBoth, B) > 20, '3a 锚定与蓝图并存 → 锚定赢');

  const chBp = buildCharacter(sprA, { targetBlueprint: blueprint });
  const tipBp = tipOf(computeWorldTransforms(chBp, 0, W, W, 12) as Map<string, unknown>, 'ma_hand');
  ok(dist(tipBp, B) < 2, '3b 无锚定 → 蓝图赢静态（对照组）');
}

// ---------- 4) 回落：标记名失效 → 蓝图/静态 ----------
{
  const chMissBp = buildCharacter(sprA, {
    targetBlueprint: blueprint,
    targetMarkAnchor: { nodeId: 'ma_prop', mark: 'nope' },
  });
  const tipMissBp = tipOf(computeWorldTransforms(chMissBp, 0, W, W, 12) as Map<string, unknown>, 'ma_hand');
  ok(dist(tipMissBp, B) < 2, '4a 标记解析失败 + 有蓝图 → 回落蓝图');

  const chMiss = buildCharacter(sprA, { targetMarkAnchor: { nodeId: 'ma_prop', mark: 'nope' } });
  const tipMiss = tipOf(computeWorldTransforms(chMiss, 0, W, W, 12) as Map<string, unknown>, 'ma_hand');
  ok(dist(tipMiss, S) < 2, '4b 标记解析失败 + 无蓝图 → 回落静态目标');
}

// ---------- 5) 换装跟随：精灵按节点现解析，换精灵标记位随之变 ----------
{
  const ch = buildCharacter(sprB, { targetMarkAnchor: { nodeId: 'ma_prop', mark: 'grip' } });
  const fk = computeWorldTransforms(ch, 0, W, W, 12) as Map<string, unknown>;
  const p = resolveIKMarkAnchorTarget(ch, fk as never, { nodeId: 'ma_prop', mark: 'grip' }, ch.sprites as never);
  ok(!!p && dist(p, { x: 28, y: 50, z: 0 }) < 0.01, `5 换精灵后同名标记解析到新位置 (28,50,0)（实际 ${p ? `${p.x},${p.y}` : 'null'}）`);
}

// ---------- 6) resettle 遍剥离锚定（冻结位赢，与蓝图同规矩） ----------
{
  const anchor: ClampAnchor = {
    id: 'aH', name: '手锚', enabled: true,
    point: { kind: 'node', nodeId: 'ma_hand' },
    trigger: { kind: 'height', y: 150, side: 'below' },
  } as ClampAnchor;
  const ch = buildCharacter(sprA, {
    targetBlueprint: blueprint,
    targetMarkAnchor: { nodeId: 'ma_prop', mark: 'grip' },
  });
  (ch as { clampAnchors?: ClampAnchor[] }).clampAnchors = [anchor];
  const fk = computeWorldTransforms(ch, 0, W, W, 12) as Map<string, unknown>;
  const frozen: ClampStateMap = new Map([['aH', { points: [{ x: 20, y: 90, z: 0 }] }]]);
  const eff = resettleChainOverride(ch, ch.ikChains![0]!, frozen, fk as never, undefined);
  ok(eff.targetMarkAnchor === undefined, '6a resettle 有效链已剥离 targetMarkAnchor');
  ok(eff.targetBlueprint === undefined, '6b resettle 有效链已剥离 targetBlueprint');
  ok(!!eff.target3D && dist(eff.target3D, { x: 20, y: 90, z: 0 }) > 1, '6c resettle 目标来自冻结位换算（非静态 S）');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
