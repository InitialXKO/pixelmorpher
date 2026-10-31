// IK 烘焙探针（2026-10-31 右栏审计修复 组1 第 1/2 项）：
//  A) 烘焙测骨长必须走真 FK：插槽挂接的二链，子节点 transform 故意
//     写成与插槽位不一致的杂值——ikChainsToBlueprint 喂真
//     computeWorldTransforms 的变换表时，len1/len2 等于真 FK 关节点距；
//     喂旧式朴素变换表（父位置 + 子 transform 直加、不走插槽不随父角）
//     时测出的长度明显不同（夹具能证伪旧实现）。
//  B) 烘焙蓝图顶替走覆写整树重算：带 ikBlueprint 的角色求值后，链末
//     关节到达蓝图目标、段长守恒，且链外子节点（挂在末关节上的 d）
//     随末关节的新 frame 跟随移动（旧实现就地改关节 worldAngle，
//     子节点位置不动、且 2bone 的相对角 angle2 被当绝对角）。
import { createDefaultNode, pxToSub, subToPx, projectToView } from '../src/lib/unified-types';
import type { Character, Node, IKChain, WorldTransform } from '../src/lib/unified-types';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { ikChainsToBlueprint } from '../src/lib/blueprint/ik-bake';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

const W = 512;
const mkNode = (id: string, name: string, parentId?: string): Node => {
  const n = createDefaultNode(name, name); n.id = id;
  (n.transform as any).variantIndex = 6;
  if (parentId) n.parentId = parentId;
  return n;
};
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const attach = (n: Node, sid: string) => { n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never; };
const pos3 = (wt: Map<string, WorldTransform>, id: string) => {
  const w = wt.get(id)!;
  return { x: subToPx(w.worldX), y: subToPx(w.worldY), z: subToPx(w.worldZ) };
};
const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const posCanvas = (wt: Map<string, WorldTransform>, id: string) => {
  const w = wt.get(id)!;
  const p = projectToView(w.worldX, w.worldY, w.worldZ, 6);
  return { x: subToPx(p.canvasX), y: subToPx(p.canvasY) };
};

// ---- 夹具：躯干 root → 肩 a → 肘 f → 腕 h（链），腕下再挂链外子节点 d ----
// 插槽几何：a 在 root 的 (-30,0)；f 在 a 的 (-35,0)；h 在 f 的 (-28,4)；d 在 h 的 (-12,0)。
// 子节点 transform 故意写杂值：旧朴素烘焙按 transform 直加测长，与插槽几何完全脱节。
const r = mkNode('root', 'torso');
const a = mkNode('a', 'upper_arm', r.id);
const f = mkNode('f', 'fore_arm', a.id);
const h = mkNode('h', 'hand', f.id);
const d = mkNode('d', 'prop', h.id);
r.children = [a.id]; a.children = [f.id]; f.children = [h.id]; h.children = [d.id];
r.sockets = [sock('s_a', -30, 0)] as never;
a.sockets = [sock('s_f', -35, 0)] as never;
f.sockets = [sock('s_h', -28, 4)] as never;
h.sockets = [sock('s_d', -12, 0)] as never;
attach(a, 's_a'); attach(f, 's_f'); attach(h, 's_h'); attach(d, 's_d');
(a.transform as any).x = pxToSub(3); (a.transform as any).y = pxToSub(-2);
(f.transform as any).x = pxToSub(11); (f.transform as any).y = pxToSub(6);
(h.transform as any).x = pxToSub(-4); (h.transform as any).y = pxToSub(9);
(d.transform as any).x = pxToSub(8); (d.transform as any).y = pxToSub(8);

const chain: IKChain = {
  id: 'ikbake1', name: 'arm', rootNodeId: a.id, endNodeId: h.id,
  target: { x: W / 2 - 80, y: W / 2 + 30 }, enabled: true, solver: '2bone',
  target3D: { x: -80, y: 30, z: 0 },
} as IKChain;
const character = {
  id: 'cbake', name: 'cbake',
  nodes: { [r.id]: r, [a.id]: a, [f.id]: f, [h.id]: h, [d.id]: d },
  rootNodeId: r.id, sprites: {}, costumeSets: [], activeCostumeSetId: undefined,
  direction: 6, latitude: 0, ikChains: [chain], ikBlueprint: null,
} as unknown as Character;

// 与 IKBakeButton 新实现同一口径的真 FK：链全禁用 + 无烘焙蓝图的克隆
const fkChar = {
  ...character,
  ikChains: (character.ikChains ?? []).map((c) => ({ ...c, enabled: false })),
  ikBlueprint: null,
} as Character;
const fkT = computeWorldTransforms(fkChar, 0, W, W, 12);

// ik-bake 自身的测长口径：相邻关节 worldX/worldY 的 2D 距（px）
const fkLen = (id1: string, id2: string) => {
  const t1 = fkT.get(id1)!, t2 = fkT.get(id2)!;
  return Math.hypot(subToPx(t2.worldX) - subToPx(t1.worldX), subToPx(t2.worldY) - subToPx(t1.worldY));
};
const expLen1 = fkLen(a.id, f.id);
const expLen2 = fkLen(f.id, h.id);
console.log(`真 FK 段长：len1=${expLen1.toFixed(2)} len2=${expLen2.toFixed(2)}（纯插槽几何 35 / ${Math.hypot(28, 4).toFixed(2)}）`);
ok(Math.abs(expLen1 - 35) > 1 && Math.abs(expLen2 - Math.hypot(28, 4)) > 1,
  'A0 夹具自检：子 transform 杂值确实进了 FK 合成（纯插槽几何也测不准，只有真 FK 对）');

// ---------- A) 真 FK 喂烘焙 ----------
{
  const bp = ikChainsToBlueprint(character, fkT as never);
  ok(!!bp, 'A 烘焙产出蓝图');
  const ikNode = bp!.nodes.find((n) => n.id === `ik_${chain.id}`);
  ok(!!ikNode && ikNode.type === 'ik_2bone', 'A 蓝图含 ik_2bone 节点');
  const len1 = Number(ikNode!.params.len1);
  const len2 = Number(ikNode!.params.len2);
  ok(Math.abs(len1 - expLen1) < 1e-6, `A len1 == 真 FK 段长（${len1.toFixed(4)} vs ${expLen1.toFixed(4)}）`);
  ok(Math.abs(len2 - expLen2) < 1e-6, `A len2 == 真 FK 段长（${len2.toFixed(4)} vs ${expLen2.toFixed(4)}）`);

  // 旧式朴素变换表（修复前 IKBakeButton 的算法：父位置 + 子 transform 直加）
  const naive = new Map<string, unknown>();
  const walk = (nodeId: string, px: number, py: number, pa: number) => {
    const node = character.nodes[nodeId];
    if (!node) return;
    const ang = pa + (node.transform.angle ?? 0);
    const x = px + (node.transform.x ?? 0);
    const y = py + (node.transform.y ?? 0);
    naive.set(nodeId, { nodeId, worldX: x, worldY: y, worldAngle: ang });
    for (const cid of node.children) walk(cid, x, y, ang);
  };
  walk(character.rootNodeId, 0, 0, 0);
  const bpNaive = ikChainsToBlueprint(character, naive as never);
  const naiveNode = bpNaive!.nodes.find((n) => n.id === `ik_${chain.id}`)!;
  const nLen1 = Number(naiveNode.params.len1);
  const nLen2 = Number(naiveNode.params.len2);
  ok(Math.abs(nLen1 - expLen1) > 1 || Math.abs(nLen2 - expLen2) > 1,
    `A 夹具可证伪：朴素变换表测长（${nLen1.toFixed(2)}/${nLen2.toFixed(2)}）与真 FK 明显不同`);
}

// ---------- B) 烘焙蓝图顶替：整树重算、子节点跟随 ----------
{
  const bp = ikChainsToBlueprint(character, fkT as never)!;
  const ikNode = bp.nodes.find((n) => n.id === `ik_${chain.id}`)!;
  const baseX = Number(ikNode.params.baseX);
  const baseY = Number(ikNode.params.baseY);
  // 目标设在可达的弯曲位（相对链根 base 的画布平面坐标）
  const tx = baseX + 10;
  const ty = baseY + 45;
  const bp2 = {
    ...bp,
    nodes: bp.nodes.map((n) => (n.id === ikNode.id ? { ...n, params: { ...n.params, targetX: tx, targetY: ty } } : n)),
  };
  const bakedChar = { ...character, ikBlueprint: bp2 } as unknown as Character;
  const wt = computeWorldTransforms(bakedChar, 0, W, W, 12);

  const wrist = posCanvas(wt, h.id);
  const err = Math.hypot(wrist.x - tx, wrist.y - ty);
  ok(err < 1.5, `B 末关节到达蓝图目标（err ${err.toFixed(3)}px，腕 (${wrist.x.toFixed(1)},${wrist.y.toFixed(1)}) vs 目标 (${tx.toFixed(1)},${ty.toFixed(1)})）`);

  const seg1 = dist3(pos3(wt, a.id), pos3(wt, f.id));
  const seg2 = dist3(pos3(wt, f.id), pos3(wt, h.id));
  const fkSeg1 = dist3(pos3(fkT, a.id), pos3(fkT, f.id));
  const fkSeg2 = dist3(pos3(fkT, f.id), pos3(fkT, h.id));
  ok(Math.abs(seg1 - fkSeg1) < 0.05 && Math.abs(seg2 - fkSeg2) < 0.05,
    `B 段长守恒（${seg1.toFixed(2)}/${seg2.toFixed(2)} vs FK ${fkSeg1.toFixed(2)}/${fkSeg2.toFixed(2)}）`);

  // 链外子节点 d：随腕的新 frame 跟随——位置明显离开 FK 位、且与腕的距离守恒
  const dBaked = pos3(wt, d.id);
  const dFk = pos3(fkT, d.id);
  const moved = dist3(dBaked, dFk);
  ok(moved > 5, `B 链外子节点跟随末关节（移动 ${moved.toFixed(1)}px；旧实现就地改角时它不动）`);
  const dd = dist3(dBaked, pos3(wt, h.id));
  const ddFk = dist3(dFk, pos3(fkT, h.id));
  ok(Math.abs(dd - ddFk) < 0.05, `B 子节点与末关节距离守恒（${dd.toFixed(2)} vs ${ddFk.toFixed(2)}）`);

  // 对照：无蓝图时腕停在 FK 位（与烘焙结果明显不同，证明顶替确实生效）
  const wristFk = posCanvas(fkT, h.id);
  ok(Math.hypot(wrist.x - wristFk.x, wrist.y - wristFk.y) > 5, 'B 烘焙姿态与纯 FK 明显不同（顶替生效）');
}

// ---------- C) FABRIK 烘焙蓝图同路（angles 拼接串 → 每段绝对角） ----------
{
  const r2 = mkNode('r2', 'torso2');
  const j0 = mkNode('j0', 'seg0', r2.id);
  const j1 = mkNode('j1', 'seg1', j0.id);
  const j2 = mkNode('j2', 'seg2', j1.id);
  const j3 = mkNode('j3', 'seg3', j2.id);
  const dd = mkNode('dd', 'prop2', j3.id);
  r2.children = [j0.id]; j0.children = [j1.id]; j1.children = [j2.id]; j2.children = [j3.id]; j3.children = [dd.id];
  r2.sockets = [sock('t_j0', -20, 0)] as never;
  j0.sockets = [sock('t_j1', -30, 0)] as never;
  j1.sockets = [sock('t_j2', -26, 3)] as never;
  j2.sockets = [sock('t_j3', -22, -2)] as never;
  j3.sockets = [sock('t_dd', -10, 0)] as never;
  attach(j0, 't_j0'); attach(j1, 't_j1'); attach(j2, 't_j2'); attach(j3, 't_j3'); attach(dd, 't_dd');
  const chainF: IKChain = {
    id: 'ikfab1', name: 'tail', rootNodeId: j0.id, endNodeId: j3.id,
    target: { x: W / 2 - 60, y: W / 2 + 40 }, enabled: true, solver: 'fabrik',
    target3D: { x: -60, y: 40, z: 0 },
  } as IKChain;
  const charF = {
    id: 'cfab', name: 'cfab',
    nodes: { [r2.id]: r2, [j0.id]: j0, [j1.id]: j1, [j2.id]: j2, [j3.id]: j3, [dd.id]: dd },
    rootNodeId: r2.id, sprites: {}, costumeSets: [], activeCostumeSetId: undefined,
    direction: 6, latitude: 0, ikChains: [chainF], ikBlueprint: null,
  } as unknown as Character;
  const fkCharF = { ...charF, ikChains: [{ ...chainF, enabled: false }], ikBlueprint: null } as Character;
  const fkTF = computeWorldTransforms(fkCharF, 0, W, W, 12);
  const bpF = ikChainsToBlueprint(charF, fkTF as never);
  ok(!!bpF, 'C 烘焙产出 FABRIK 蓝图');
  const fabNode = bpF!.nodes.find((n) => n.id === `ik_${chainF.id}`);
  ok(!!fabNode && fabNode.type === 'ik_fabrik', 'C 蓝图含 ik_fabrik 节点');
  const bx = Number(fabNode!.params.baseX);
  const by = Number(fabNode!.params.baseY);
  const tx = bx - 20;
  const ty = by + 55;
  const bpF2 = {
    ...bpF!,
    nodes: bpF!.nodes.map((n) => (n.id === fabNode!.id ? { ...n, params: { ...n.params, targetX: tx, targetY: ty } } : n)),
  };
  const wtF = computeWorldTransforms({ ...charF, ikBlueprint: bpF2 } as unknown as Character, 0, W, W, 12);
  const end = posCanvas(wtF, j3.id);
  const errF = Math.hypot(end.x - tx, end.y - ty);
  ok(errF < 3, `C FABRIK 末关节到达蓝图目标（err ${errF.toFixed(3)}px）`);
  const ids = [j0.id, j1.id, j2.id, j3.id];
  let segOk = true;
  for (let i = 0; i < 3; i++) {
    const sB = dist3(pos3(wtF, ids[i]), pos3(wtF, ids[i + 1]));
    const sF = dist3(pos3(fkTF, ids[i]), pos3(fkTF, ids[i + 1]));
    if (Math.abs(sB - sF) > 0.1) segOk = false;
  }
  ok(segOk, 'C FABRIK 各段长守恒');
  const movedF = dist3(pos3(wtF, dd.id), pos3(fkTF, dd.id));
  ok(movedF > 5, `C FABRIK 链外子节点跟随（移动 ${movedF.toFixed(1)}px）`);
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
