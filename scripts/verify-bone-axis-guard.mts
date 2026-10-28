// 骨轴守卫探针（行为，走真实消费路径 computeWorldTransforms / generateRenderPlan）：
// A) X 向骨链夹具（offset3D 纯 X 段 + 子节点 + 精灵 + 标记）：守卫前东/西向
//    IK 尖端误差大（奇异点实证），守卫后全 8 朝向误差 ≤1.5px；
// B) 静止不变：守卫前后 FK 关节世界位逐点一致；渲染指令位置一致、角度差
//    恰为帧增益 Γ、精灵位图为 D4 反旋（角点画布位逐点一致 = 绘制恒等）、
//    关节盘指令逐字一致；
// C) 幂等：再跑一遍 changed=false 且数据逐字不变；合规角色（+Y/2D socket
//    构造）零改动逐字不变；
// D) 边界：兄弟冲突（X 坏段 + 2D socket 子树）保持原样并点名
//    blocked-by-sibling；Z 主导坏段保持原样并点名 z-dominant；
// E) fixed 附着（Spine 形态）X 段同样改轴且静止位不变；
// F) 工程级入口 guardProjectBoneAxes（读入规范化同一函数）同效。
import { computeWorldTransforms, generateRenderPlan } from '../src/lib/unified-render';
import { computeIKChainTip } from '../src/lib/ik-tip';
import { guardCharacterBoneAxes, guardProjectBoneAxes, rotateSpriteD4 } from '../src/lib/bone-axis-guard';
import { useProjectStore } from '../src/lib/store';
import {
  createDefaultNode, pxToSub, subToPx,
  type Character, type Node, type Sprite,
} from '../src/lib/unified-types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

useProjectStore.setState({ canvasWidth: 256, canvasHeight: 256, currentFrame: 0, frameRate: 12 } as never);

// ---------- 夹具 A：X 向骨链 ----------
function gridWithCorners(w: number, h: number): string[][] {
  const g = Array.from({ length: h }, () => Array(w).fill('#224466'));
  g[0]![0] = '#ff0000'; g[0]![w - 1] = '#00ff00'; g[h - 1]![0] = '#0000ff'; g[h - 1]![w - 1] = '#ffff00';
  return g;
}
function mkSprite(id: string): Sprite {
  return {
    id, name: id, width: 12, height: 8, data: gridWithCorners(12, 8),
    plug: { x: pxToSub(3), y: pxToSub(6) },
    marks: [
      { id: 'm1', name: '尖端', kind: 'point', x: 0.25, y: 0.75 },
      { id: 'm2', name: '向', kind: 'direction', angleDeg: 30 },
    ],
  } as Sprite;
}
function buildFixtureA() {
  const nodes: Record<string, Node> = {};
  const mk = (id: string, parentId?: string): Node => {
    const n = createDefaultNode(id, id);
    n.transform.variantIndex = 6;
    if (parentId) { n.parentId = parentId; nodes[parentId]!.children.push(id); }
    nodes[id] = n;
    return n;
  };
  const root = mk('root');
  const chest = mk('chest', 'root');
  const armA = mk('armA', 'chest');
  const armB = mk('armB', 'armA');
  const hand = mk('hand', 'armB');
  mk('finger', 'hand');
  const leg = mk('leg', 'root');
  const wire = (parent: Node, child: Node, x: number, y: number, z: number) => {
    const sid = `sock_${child.id}`;
    parent.sockets.push({ id: sid, name: child.id, basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: pxToSub(x), y: pxToSub(y), z: pxToSub(z) } });
    child.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } };
  };
  wire(root, chest, 0, -30, 0);
  wire(chest, armA, 26, 0, 0);
  wire(armA, armB, 22, 0, 0);
  wire(armB, hand, 14, 0, 0);
  wire(hand, nodes['finger']!, 6, 0, 0);
  wire(root, leg, 4, 34, 0);

  const sprites: Record<string, Sprite> = {};
  const pieces: Record<string, unknown> = {};
  for (const id of ['chest', 'armA', 'armB', 'hand', 'leg']) {
    const spr = mkSprite(`spr_${id}`);
    sprites[spr.id!] = spr;
    const piece = nodes[id]!.slot!;
    piece.sprites = { 6: { spriteId: spr.id } } as never;
    pieces[id] = piece;
  }
  const character = {
    id: 'fixA', name: 'X链夹具',
    rootNodeId: 'root', nodes,
    costumeSets: [{ id: 'cs_a', name: 'A', pieces }],
    activeCostumeSetId: 'cs_a',
    ikChains: [{
      id: 'chain_arm', name: 'arm', rootNodeId: 'armA', endNodeId: 'hand',
      target: { x: 0, y: 0 }, solver: 'fabrik', bendDir: 1, tipLength: 10, enabled: true,
    }],
  } as unknown as Character;
  return { character, sprites };
}

const fkPositions = (ch: Character): Record<string, [number, number, number]> => {
  const c = clone(ch);
  c.ikChains = (c.ikChains ?? []).map((x) => ({ ...x, enabled: false }));
  const t = computeWorldTransforms(c, 0, 256, 256, 12);
  const out: Record<string, [number, number, number]> = {};
  for (const [id, w] of t) out[id] = [subToPx(w.worldX), subToPx(w.worldY), subToPx(w.worldZ)];
  return out;
};

const tipErrorAt = (ch: Character, dir: number): number => {
  const c = clone(ch);
  for (const n of Object.values(c.nodes)) n.transform.variantIndex = dir as never;
  const jointIds = ['armA', 'armB', 'hand'];
  const dis = clone(c);
  dis.ikChains = (dis.ikChains ?? []).map((x) => ({ ...x, enabled: false }));
  useProjectStore.setState({ sprites: {} } as never);
  const fk = computeIKChainTip(dis, jointIds, 10);
  const rootT = computeWorldTransforms(dis, 0, 256, 256, 12).get('armA')!;
  const rp = { x: subToPx(rootT.worldX), y: subToPx(rootT.worldY), z: subToPx(rootT.worldZ) };
  // 目标：自根向 FK 尖端方向走 75% + 垂直（y）8px + 纵深 −10px（链总长 36，距根 ≈29.9 < 36 可达）
  const tgt = {
    x: rp.x + 0.75 * (fk.tipX - rp.x),
    y: rp.y + 0.75 * (fk.tipY - rp.y) + 8,
    z: rp.z + 0.75 * (fk.tipZ - rp.z) - 10,
  };
  c.ikChains = [{ ...(c.ikChains![0] as object), target3D: tgt, enabled: true } as never];
  const solved = computeIKChainTip(c, jointIds, 10);
  return Math.hypot(solved.tipX - tgt.x, solved.tipY - tgt.y, solved.tipZ - tgt.z);
};

// ---------- A) 疾病实证（守卫前） ----------
const { character: charA, sprites: spritesA } = buildFixtureA();
const preEast = tipErrorAt(charA, 0);
const preWest = tipErrorAt(charA, 4);
const preSouth = tipErrorAt(charA, 6);
console.log(`守卫前尖端误差：东 ${preEast.toFixed(2)}px / 西 ${preWest.toFixed(2)}px / 南 ${preSouth.toFixed(2)}px`);
ok(preEast > 5, `A 守卫前东向误差 >5px（奇异点在场）: ${preEast.toFixed(2)}`);
ok(preWest > 5, `A 守卫前西向误差 >5px: ${preWest.toFixed(2)}`);
ok(preSouth < 1.5, `A 守卫前南向误差 <1.5px（南向本无病）: ${preSouth.toFixed(2)}`);

// ---------- B) 静止不变对照（守卫前快照） ----------
const fkPre = fkPositions(charA);
const planOf = (ch: Character, table: Record<string, Sprite>) => {
  const c = clone(ch);
  c.ikChains = (c.ikChains ?? []).map((x) => ({ ...x, enabled: false }));
  return generateRenderPlan(c, 0, 256, 256, 'pixel-perfect', 12,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, table);
};
const planPre = planOf(charA, spritesA);
const insPre = new Map(planPre.nodeInstructions.map((i) => [i.nodeId, i]));
const discsPre = JSON.stringify(planPre.discInstructions);

// ---------- 施加守卫 ----------
const guardedChar = clone(charA);
const guardedSprites = clone(spritesA);
const rep = guardCharacterBoneAxes(guardedChar, guardedSprites);
console.log('报告:', JSON.stringify({ changed: rep.changed, gained: rep.gainedNodes, fixed: rep.fixedSegments.map((s) => `${s.parentId}>${s.childId}`), unfixable: rep.unfixableSegments, conflicts: rep.conflictRoots, aborted: rep.aborted }));
ok(rep.changed, 'B 守卫生效 changed=true');
ok(rep.fixedSegments.length === 4, `B 修复段 = 4（chest>armA、armA>armB、armB>hand、hand>finger）: ${rep.fixedSegments.length}`);
ok(rep.unfixableSegments.length === 0, 'B 无不可修段');
ok((guardedChar.nodes['chest']!.transform.angle) === -90, `B chest 角 = −90: ${guardedChar.nodes['chest']!.transform.angle}`);
ok((guardedChar.nodes['armA']!.transform.angle) === 0, 'B armA 角保持 0（增益靠继承）');
const sockOf = (ch: Character, parentId: string, childId: string) =>
  ch.nodes[parentId]!.sockets.find((s) => s.id === `sock_${childId}`)!.offset3D!;
ok(JSON.stringify(sockOf(guardedChar, 'chest', 'armA')) === JSON.stringify({ x: 0, y: pxToSub(26), z: 0 }), `B armA 偏移转 +Y: ${JSON.stringify(sockOf(guardedChar, 'chest', 'armA'))}`);
ok(JSON.stringify(sockOf(guardedChar, 'armA', 'armB')) === JSON.stringify({ x: 0, y: pxToSub(22), z: 0 }), 'B armB 偏移转 +Y');
ok(JSON.stringify(sockOf(guardedChar, 'armB', 'hand')) === JSON.stringify({ x: 0, y: pxToSub(14), z: 0 }), 'B hand 偏移转 +Y');
ok(JSON.stringify(sockOf(guardedChar, 'hand', 'finger')) === JSON.stringify({ x: 0, y: pxToSub(6), z: 0 }), 'B finger 偏移转 +Y');

// FK 逐点一致
const fkPost = fkPositions(guardedChar);
let maxFkDelta = 0;
for (const id of Object.keys(fkPre)) {
  const a = fkPre[id]!, b = fkPost[id]!;
  maxFkDelta = Math.max(maxFkDelta, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
ok(maxFkDelta < 1e-6, `B FK 关节世界位逐点一致（最大差 ${maxFkDelta.toExponential(1)}px）`);

// 渲染指令：位置一致、角度差 = Γ、位图 D4 反旋、角点画布位一致、关节盘逐字一致
const planPost = planOf(guardedChar, guardedSprites);
const insPost = new Map(planPost.nodeInstructions.map((i) => [i.nodeId, i]));
const expectedGain: Record<string, number> = { root: 0, chest: -90, armA: -90, armB: -90, hand: -90, finger: -90, leg: 0 };
let insOk = true, insMsg: string[] = [];
const rot2d = (x: number, y: number, deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
};
for (const [id, pre] of insPre) {
  const post = insPost.get(id);
  if (!post) { insOk = false; insMsg.push(`${id} 指令丢失`); continue; }
  if (pre.worldX !== post.worldX || pre.worldY !== post.worldY) { insOk = false; insMsg.push(`${id} 位置变`); }
  const dAng = post.angle - pre.angle;
  if (Math.abs(dAng - (expectedGain[id] ?? 0)) > 1e-6) { insOk = false; insMsg.push(`${id} 角度差 ${dAng} ≠ Γ ${expectedGain[id]}`); }
  const g = expectedGain[id] ?? 0;
  if (g !== 0) {
    const op = g === -90 ? 'rot90' : g === 90 ? 'rot270' : 'rot180';
    const expect = rotateSpriteD4(pre.sprite, op as never);
    if (JSON.stringify(post.sprite.data) !== JSON.stringify(expect.data)
      || post.sprite.width !== expect.width || post.sprite.height !== expect.height
      || JSON.stringify(post.sprite.plug) !== JSON.stringify(expect.plug)) {
      insOk = false; insMsg.push(`${id} 位图非 D4 反旋`);
    }
    // 角点画布位：pre 四角经 pre 位姿 ↔ post 对应角（D4 映射）经 post 位姿
    const w = pre.sprite.width, h = pre.sprite.height;
    const plugPre = { x: subToPx(pre.sprite.plug!.x), y: subToPx(pre.sprite.plug!.y) };
    const plugPost = { x: subToPx(post.sprite.plug!.x), y: subToPx(post.sprite.plug!.y) };
    const dimsPost = { w: post.sprite.width, h: post.sprite.height };
    const corners: Array<[number, number]> = [[0, 0], [w, 0], [0, h], [w, h]];
    for (const [cx, cy] of corners) {
      const [rx, ry] = rot2d(cx - plugPre.x, cy - plugPre.y, pre.angle);
      const want = [subToPx(pre.worldX) + rx, subToPx(pre.worldY) + ry];
      // D4 映射（与 sprite-transform 同定义）：rot90: (x,y)→(h−y, x)
      const mapped: [number, number] = op === 'rot90' ? [h - cy, cx] : op === 'rot270' ? [cy, w - cx] : [w - cx, h - cy];
      const [qx, qy] = rot2d(mapped[0] - plugPost.x, mapped[1] - plugPost.y, post.angle);
      const got = [subToPx(post.worldX) + qx, subToPx(post.worldY) + qy];
      if (Math.hypot(want[0] - got[0], want[1] - got[1]) > 1e-6 || dimsPost.w <= 0) {
        insOk = false; insMsg.push(`${id} 角点 (${cx},${cy}) 画布位移`);
      }
    }
    // 标记随旋：点标记 (0.25, 0.75) 经 rot90 → (1−0.75, 0.25) = (0.25, 0.25)（归一按新尺寸换算后）
    const mk = post.sprite.marks?.find((m) => m.name === '尖端') as { x: number; y: number } | undefined;
    if (!mk || Math.abs(mk.x - 0.25) > 1e-9 || Math.abs(mk.y - 0.25) > 1e-9) { insOk = false; insMsg.push(`${id} 点标记未随旋`); }
    const dm = post.sprite.marks?.find((m) => m.name === '向') as { angleDeg: number } | undefined;
    if (!dm || dm.angleDeg !== 120) { insOk = false; insMsg.push(`${id} 方向标记未随旋: ${dm?.angleDeg}`); }
  } else if (post.sprite.id !== pre.sprite.id || post.angle !== pre.angle) {
    insOk = false; insMsg.push(`${id} 无增益节点被动`);
  }
}
ok(insOk, `B 渲染指令恒等（位置/角度差/位图/角点/标记）${insMsg.length ? '：' + insMsg.join('；') : ''}`);
ok(JSON.stringify(planPost.discInstructions) === discsPre, 'B 关节盘指令逐字一致');
// 红角像素落点（独立于守卫自身的旋转函数，按 D4 定义手算）：原 (0,0) 红 → rot90 后 (row 0, col 7)
const armASprPost = insPost.get('armA')!.sprite;
ok(armASprPost.data[0]![7] === '#ff0000' && armASprPost.width === 8 && armASprPost.height === 12,
  `B 位图角像素落点手算核对（红→(0,7)、尺寸 8×12）: ${armASprPost.data[0]![7]} ${armASprPost.width}×${armASprPost.height}`);
// 原表精灵未被改（copy-on-write）
ok(JSON.stringify(guardedSprites['spr_armA']) === JSON.stringify(spritesA['spr_armA']), 'B 原表精灵逐字未动（反旋走副本）');
ok(!!guardedSprites['spr_armA__axg_rot90'], 'B 反旋副本已注册 spr_armA__axg_rot90');

// ---------- A) 守卫后可达性：全朝向 ----------
const postErrs: Record<number, number> = {};
for (let d = 0; d < 8; d++) postErrs[d] = tipErrorAt(guardedChar, d);
console.log('守卫后尖端误差（8 朝向）:', Object.entries(postErrs).map(([d, e]) => `${d}:${e.toFixed(2)}`).join(' '));
for (let d = 0; d < 8; d++) ok(postErrs[d]! < 1.5, `A 守卫后朝向 ${d} 误差 <1.5px: ${postErrs[d]!.toFixed(2)}`);

// ---------- C) 幂等 + 工程级入口 ----------
const snapG = JSON.stringify({ c: guardedChar, s: guardedSprites });
const rep2 = guardCharacterBoneAxes(guardedChar, guardedSprites);
ok(!rep2.changed && JSON.stringify({ c: guardedChar, s: guardedSprites }) === snapG, 'C 二次守卫零改动（幂等）');
const projIn = buildFixtureA();
const projRep = guardProjectBoneAxes({ [projIn.character.id]: projIn.character } as never, projIn.sprites);
ok(projRep.changed && projRep.reports['fixA']!.fixedSegments.length === 4, 'F 工程级入口同效（changed + 修复 4 段）');

// ---------- C) 合规角色零改动 ----------
function buildCompliant() {
  const nodes: Record<string, Node> = {};
  const mk = (id: string, parentId?: string): Node => {
    const n = createDefaultNode(id, id);
    n.transform.variantIndex = 6;
    if (parentId) { n.parentId = parentId; nodes[parentId]!.children.push(id); }
    nodes[id] = n;
    return n;
  };
  const root = mk('root');
  const hip = mk('hip', 'root');
  const thigh = mk('thigh', 'hip');
  const shin = mk('shin', 'thigh');
  root.sockets.push({ id: 's_hip', name: 'hip', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: pxToSub(10), z: 0 } });
  hip.attachment = { type: 'socket', parentSocketId: 's_hip', plug: { x: 0, y: 0 } };
  hip.sockets.push({ id: 's_thigh', name: 'thigh', basePosition: { x: 0, y: pxToSub(24) }, directionOffsets: {} });
  thigh.attachment = { type: 'socket', parentSocketId: 's_thigh', plug: { x: 0, y: 0 } };
  thigh.transform.angle = 15;
  thigh.sockets.push({ id: 's_shin', name: 'shin', basePosition: { x: 0, y: pxToSub(22) }, directionOffsets: {} });
  shin.attachment = { type: 'socket', parentSocketId: 's_shin', plug: { x: 0, y: 0 } };
  shin.transform.angle = -10;
  const character = { id: 'fixY', name: 'Y夹具', rootNodeId: 'root', nodes, costumeSets: [], activeCostumeSetId: undefined } as unknown as Character;
  return character;
}
const compChar = buildCompliant();
const compSnap = JSON.stringify(compChar);
const repC = guardCharacterBoneAxes(compChar, {});
ok(!repC.changed && JSON.stringify(compChar) === compSnap, 'C 合规角色（+Y offset3D + 2D socket 肢链）逐字零改动');

// ---------- D) 兄弟冲突 ----------
function buildConflict() {
  const nodes: Record<string, Node> = {};
  const mk = (id: string, parentId?: string): Node => {
    const n = createDefaultNode(id, id);
    n.transform.variantIndex = 6;
    if (parentId) { n.parentId = parentId; nodes[parentId]!.children.push(id); }
    nodes[id] = n;
    return n;
  };
  const root = mk('root');
  const p = mk('P', 'root');
  const x1 = mk('X1', 'P');
  const y1 = mk('Y1', 'P');
  const y2 = mk('Y2', 'Y1');
  root.sockets.push({ id: 's_P', name: 'P', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: pxToSub(-10), z: 0 } });
  p.attachment = { type: 'socket', parentSocketId: 's_P', plug: { x: 0, y: 0 } };
  p.sockets.push({ id: 's_X1', name: 'X1', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: pxToSub(24), y: 0, z: 0 } });
  x1.attachment = { type: 'socket', parentSocketId: 's_X1', plug: { x: 0, y: 0 } };
  p.sockets.push({ id: 's_Y1', name: 'Y1', basePosition: { x: 0, y: pxToSub(20) }, directionOffsets: {} });
  y1.attachment = { type: 'socket', parentSocketId: 's_Y1', plug: { x: 0, y: 0 } };
  y1.sockets.push({ id: 's_Y2', name: 'Y2', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: pxToSub(18), z: 0 } });
  y2.attachment = { type: 'socket', parentSocketId: 's_Y2', plug: { x: 0, y: 0 } };
  const character = { id: 'fixB', name: '冲突夹具', rootNodeId: 'root', nodes, costumeSets: [] } as unknown as Character;
  return character;
}
const confChar = buildConflict();
const confSnap = JSON.stringify(confChar);
const repB = guardCharacterBoneAxes(confChar, {});
ok(!repB.changed && JSON.stringify(confChar) === confSnap, 'D 兄弟冲突：数据逐字未动');
ok(repB.unfixableSegments.some((u) => u.childId === 'X1' && u.reason === 'blocked-by-sibling'),
  `D X1 点名 blocked-by-sibling（帧增益被 2D socket 兄弟堵住）: ${JSON.stringify(repB.unfixableSegments)}`);
ok(repB.gainedNodes.length === 0, 'D 无节点获得帧增益');

// ---------- D) Z 主导 ----------
function buildZ() {
  const nodes: Record<string, Node> = {};
  const mk = (id: string, parentId?: string): Node => {
    const n = createDefaultNode(id, id);
    n.transform.variantIndex = 6;
    if (parentId) { n.parentId = parentId; nodes[parentId]!.children.push(id); }
    nodes[id] = n;
    return n;
  };
  const root = mk('root');
  const q = mk('Q', 'root');
  const tail = mk('tail', 'Q');
  root.sockets.push({ id: 's_Q', name: 'Q', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: 0, y: pxToSub(-10), z: 0 } });
  q.attachment = { type: 'socket', parentSocketId: 's_Q', plug: { x: 0, y: 0 } };
  q.sockets.push({ id: 's_tail', name: 'tail', basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: pxToSub(2), y: pxToSub(1), z: pxToSub(30) } });
  tail.attachment = { type: 'socket', parentSocketId: 's_tail', plug: { x: 0, y: 0 } };
  return { id: 'fixZ', name: 'Z夹具', rootNodeId: 'root', nodes, costumeSets: [] } as unknown as Character;
}
const zChar = buildZ();
const zSnap = JSON.stringify(zChar);
const repZ = guardCharacterBoneAxes(zChar, {});
ok(!repZ.changed && JSON.stringify(zChar) === zSnap, 'D Z 主导：数据逐字未动');
ok(repZ.unfixableSegments.some((u) => u.childId === 'tail' && u.reason === 'z-dominant'),
  `D tail 点名 z-dominant: ${JSON.stringify(repZ.unfixableSegments)}`);

// ---------- E) fixed 附着（Spine 形态） ----------
function buildFixed() {
  const nodes: Record<string, Node> = {};
  const mk = (id: string, parentId?: string): Node => {
    const n = createDefaultNode(id, id);
    n.transform.variantIndex = 6;
    if (parentId) { n.parentId = parentId; nodes[parentId]!.children.push(id); }
    nodes[id] = n;
    return n;
  };
  const root = mk('root');
  const a = mk('boneA', 'root');
  const b = mk('boneB', 'boneA');
  a.attachment = { type: 'fixed', fixedOffset: { x: pxToSub(30), y: pxToSub(2) }, inheritRotation: true };
  b.attachment = { type: 'fixed', fixedOffset: { x: pxToSub(26), y: pxToSub(-2) }, inheritRotation: true };
  return { id: 'fixF', name: 'fixed夹具', rootNodeId: 'root', nodes, costumeSets: [] } as unknown as Character;
}
const fixF = buildFixed();
const fkFPre = fkPositions(fixF);
const repF = guardCharacterBoneAxes(fixF, {});
const fkFPost = fkPositions(fixF);
ok(repF.changed && repF.fixedSegments.length === 2, `E fixed 两段修复: ${JSON.stringify(repF.fixedSegments)}`);
ok(fixF.nodes['root']!.transform.angle === -90, `E root 角 −90（承载增益）: ${fixF.nodes['root']!.transform.angle}`);
let maxF = 0;
for (const id of Object.keys(fkFPre)) {
  const a = fkFPre[id]!, b = fkFPost[id]!;
  maxF = Math.max(maxF, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
ok(maxF < 1e-6, `E fixed 静止位逐点一致（最大差 ${maxF.toExponential(1)}）`);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
