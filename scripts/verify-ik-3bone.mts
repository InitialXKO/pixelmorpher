// 解析 3 骨 IK + 按段数自动分发探针：
//  A) solveIK3Bone3D 直测：段长守恒、末端达标、弯曲按 len2:len3 分担、
//     pole 定侧、近直不翻、不可达全伸直、过近回落 null；
//  B) solveIK3BoneWithTip3D：剥尖端后关节段长守恒、尖端达标、无折叠；
//  C) 分发（computeWorldTransforms）：胳膊链（2 骨+尖端）走 3 骨解析、
//     拆分链（3 骨+尖端）走剥尖端 3 骨——研究探针里被 FABRIK 折叠
//     −179° 的中间关节恢复正常弯曲；捕姿口径（尖端覆写 0）下 4 关节
//     链末端关节达标。
import { createDefaultNode, createDefaultCostumePiece, pxToSub, subToPx, projectToView, frameYAxisWorld } from '../src/lib/unified-types';
import type { Character, Node, Sprite, IKChain, WorldTransform } from '../src/lib/unified-types';
import { computeWorldTransforms, solveChainIKOverrides } from '../src/lib/unified-render';
import { solveIK3Bone3D, solveIK3BoneWithTip3D } from '../src/lib/blueprint/ik';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
type P = { x: number; y: number; z: number };
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: P) => Math.hypot(a.x, a.y, a.z);
const bend = (a: P, b: P) => {
  const la = len(a), lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)))) * 180 / Math.PI;
};

// ---------- A) 三骨解析直测 ----------
{
  const root: P = { x: 0, y: 0, z: 0 };
  const target: P = { x: 30, y: 55, z: 10 };
  const pole: P = { x: 60, y: 10, z: 0 }; // 弯向 +x 侧
  const r = solveIK3Bone3D(root, target, 35, 30, 16, pole);
  ok(!!r, 'A 可达目标有解');
  if (r) {
    ok(Math.abs(len(sub(r.p1, root)) - 35) < 1e-4, 'A 段1 长守恒');
    ok(Math.abs(len(sub(r.p2, r.p1)) - 30) < 1e-4, 'A 段2 长守恒');
    ok(Math.abs(len(sub(r.end, r.p2)) - 16) < 1e-4, 'A 段3 长守恒');
    ok(len(sub(r.end, target)) < 1e-4, `A 末端达标（err ${len(sub(r.end, target)).toFixed(5)}）`);
    const b1 = bend(sub(r.p1, root), sub(r.p2, r.p1));
    const b2 = bend(sub(r.p2, r.p1), sub(r.end, r.p2));
    const share = b1 / (b1 + b2);
    ok(Math.abs(share - 30 / 46) < 0.03, `A 弯曲分担 ≈ len2:(len2+len3)（实际 ${share.toFixed(3)} vs ${(30 / 46).toFixed(3)}；β1 ${b1.toFixed(1)}° β2 ${b2.toFixed(1)}°）`);
    // pole 侧：p1 相对 root→target 轴的偏移与 pole 同侧
    const axis = sub(target, root); const ax = len(axis);
    const perpP1 = sub(sub(r.p1, root), { x: axis.x / ax * (sub(r.p1, root).x * axis.x / ax + sub(r.p1, root).y * axis.y / ax + sub(r.p1, root).z * axis.z / ax), y: 0, z: 0 });
    void perpP1;
    const d1 = sub(r.p1, root);
    const proj = (d1.x * axis.x + d1.y * axis.y + d1.z * axis.z) / (ax * ax);
    const perp = { x: d1.x - axis.x * proj, y: d1.y - axis.y * proj, z: d1.z - axis.z * proj };
    const polePerp = (() => { const d = sub(pole, root); const pr = (d.x * axis.x + d.y * axis.y + d.z * axis.z) / (ax * ax); return { x: d.x - axis.x * pr, y: d.y - axis.y * pr, z: d.z - axis.z * pr }; })();
    ok(perp.x * polePerp.x + perp.y * polePerp.y + perp.z * polePerp.z > 0, 'A 中间关节在 pole 侧');
  }
  // 近直目标：不翻
  const r2 = solveIK3Bone3D(root, { x: 0, y: 80.5, z: 0 }, 35, 30, 16, { x: 10, y: 40, z: 0 });
  ok(!!r2 && bend(sub(r2!.p1, root), sub(r2!.p2, r2!.p1)) < 25 && bend(sub(r2!.p2, r2!.p1), sub(r2!.end, r2!.p2)) < 25, 'A 近直目标弯角小（不翻）');
  // 不可达：全伸直
  const r3 = solveIK3Bone3D(root, { x: 0, y: 200, z: 0 }, 35, 30, 16, pole);
  ok(!!r3 && Math.abs(len(sub(r3!.end, root)) - 81) < 1e-4 && bend(sub(r3!.p1, root), sub(r3!.p2, r3!.p1)) < 1e-6, 'A 不可达全伸直');
  // 过近（< 最长段与其余之差）→ null 回落
  const r4 = solveIK3Bone3D(root, { x: 1, y: 0, z: 0 }, 60, 10, 10, pole);
  ok(r4 === null, 'A 过近退化构型返回 null（调用方回落迭代）');
}

// ---------- B) 剥尖端 ----------
{
  const pts: P[] = [
    { x: 0, y: 0, z: 0 }, { x: -18, y: 0, z: 0 }, { x: -35, y: 0, z: 0 },
    { x: -65, y: 0, z: 0 }, { x: -95, y: 0, z: 0 },
  ];
  const lens = [18, 17, 30, 30];
  const target: P = { x: -50, y: 30, z: 0 };
  const r = solveIK3BoneWithTip3D(pts, lens, target, { x: -30, y: -20, z: 0 });
  ok(!!r && r.length === 5, 'B 剥尖端有解（5 点）');
  if (r) {
    for (let i = 0; i < 4; i++) ok(Math.abs(len(sub(r[i + 1], r[i])) - lens[i]) < 1e-4, `B 段${i + 1} 长守恒`);
    ok(len(sub(r[4], target)) < 1e-3, `B 尖端达标（err ${len(sub(r[4], target)).toFixed(4)}）`);
    const bM = bend(sub(r[1], r[0]), sub(r[2], r[1]));
    ok(bM < 120, `B 插入关节弯角正常（${bM.toFixed(1)}°，对照旧迭代解 −179° 折叠）`);
  }
}

// ---------- C) 分发 ----------
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
const relDeg = (wt: Map<string, WorldTransform>, id: string, pid: string) => {
  let d = (wt.get(id)?.worldAngle ?? 0) - (wt.get(pid)?.worldAngle ?? 0);
  while (d > 180) d -= 360; while (d < -180) d += 360;
  return d;
};
const posOf = (wt: Map<string, WorldTransform>, id: string) => {
  const w = wt.get(id)!;
  const p = projectToView(w.worldX, w.worldY, w.worldZ, 6);
  return { x: subToPx(p.canvasX), y: subToPx(p.canvasY) };
};
const segBend = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  const cross = u.x * v.y - u.y * v.x;
  const dot = u.x * v.x + u.y * v.y;
  return Math.atan2(cross, dot) * 180 / Math.PI;
};
const tipCanvas = (wt: Map<string, WorldTransform>, id: string, tipLen: number) => {
  const w = wt.get(id)!;
  const y = frameYAxisWorld(w.worldFrame, 6);
  const p = projectToView(
    (w.worldX + Math.round(y.x * tipLen * 16)) as never,
    (w.worldY + Math.round(y.y * tipLen * 16)) as never,
    (w.worldZ + Math.round(y.z * tipLen * 16)) as never, 6);
  return { x: subToPx(p.canvasX), y: subToPx(p.canvasY) };
};

// C1：胳膊链（肩→肘→腕 + 手精灵尖端 16），目标够得着
{
  const r = mkNode('c1_root', 'torso');
  const a = mkNode('c1_a', 'upper_arm_R', r.id);
  const f = mkNode('c1_f', 'lower_arm_R', a.id);
  const h = mkNode('c1_h', 'hand_R', f.id);
  r.children = [a.id]; a.children = [f.id]; f.children = [h.id];
  r.sockets = [sock('s_a', -30, 0)]; a.sockets = [sock('s_f', -35, 0)]; f.sockets = [sock('s_h', -30, 0)];
  attach(a, 's_a'); attach(f, 's_f'); attach(h, 's_h');
  const grid: (string | null)[][] = Array.from({ length: 20 }, () => Array(8).fill('#cc6633'));
  const sprHand: Sprite = { id: 'spr_hand_c1', name: 'hand', width: 8, height: 20, data: grid, plug: { x: pxToSub(4), y: pxToSub(4) } } as Sprite;
  const piece = createDefaultCostumePiece('hand_R');
  piece.sprites = { 6: { spriteId: sprHand.id } } as never;
  h.slot = piece as never;
  const chain: IKChain = {
    id: 'ikc1', name: 'arm', rootNodeId: a.id, endNodeId: h.id,
    target: { x: 0, y: 0 }, enabled: true, solver: '2bone',
    target3D: { x: -80, y: 30, z: 0 },
  } as IKChain;
  const ch = {
    id: 'c1', name: 'c1', nodes: { [r.id]: r, [a.id]: a, [f.id]: f, [h.id]: h },
    rootNodeId: r.id, sprites: { [sprHand.id]: sprHand },
    costumeSets: [{ id: 'cs1', name: '默认', pieces: { hand_R: piece } }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0, ikChains: [chain],
  } as unknown as Character;
  const wt = computeWorldTransforms(ch, 0, W, W, 12);
  const tip = tipCanvas(wt, h.id, 16);
  const err = Math.hypot(tip.x - -80, tip.y - 30);
  const pa = posOf(wt, a.id), pf = posOf(wt, f.id), ph = posOf(wt, h.id);
  const bElbow = segBend(pa, pf, ph);
  const bWrist = segBend(pf, ph, tip);
  console.log(`  C1 尖端=(${tip.x.toFixed(1)},${tip.y.toFixed(1)}) err=${err.toFixed(2)} 肘位=(${pf.x.toFixed(0)},${pf.y.toFixed(0)}) 腕位=(${ph.x.toFixed(0)},${ph.y.toFixed(0)}) 位置弯角 肘=${bElbow.toFixed(1)} 腕=${bWrist.toFixed(1)}`);
  ok(err < 2.5, 'C1 胳膊链尖端达标（3 骨解析）');
  ok(Math.abs(bElbow) < 120 && Math.abs(bWrist) < 120, 'C1 肘/腕弯角无折叠');
  ok(bElbow * bWrist > 0, 'C1 肘/腕同向弯（无锯齿）');
  ok(Math.abs(bElbow) < 40, 'C1 近目标（离 FK 尖端 ~16px）肘不重排：种子连续延拓保 FK 弯角对，腕位形弯含手 frame 与前臂的固有偏角');
}

// C2：拆分链（肩→M→肘→腕，无精灵尖端回落 30）——旧迭代解折叠 fixture
{
  const r = mkNode('c2_root', 'torso');
  const a = mkNode('c2_a', 'upper_arm_R', r.id);
  const m = mkNode('c2_m', 'upper_arm_mid', a.id);
  const f = mkNode('c2_f', 'lower_arm_R', m.id);
  const h = mkNode('c2_h', 'hand_R', f.id);
  r.children = [a.id]; a.children = [m.id]; m.children = [f.id]; f.children = [h.id];
  r.sockets = [sock('s_a', -30, 0)]; a.sockets = [sock('s_m', -18, 0)]; m.sockets = [sock('s_f', -17, 0)]; f.sockets = [sock('s_h', -30, 0)];
  attach(a, 's_a'); attach(m, 's_m'); attach(f, 's_f'); attach(h, 's_h');
  const chain: IKChain = {
    id: 'ikc2', name: 'arm', rootNodeId: a.id, endNodeId: h.id,
    target: { x: 0, y: 0 }, enabled: true, solver: '2bone',
    target3D: { x: -80, y: 30, z: 0 },
  } as IKChain;
  const nodes = { [r.id]: r, [a.id]: a, [m.id]: m, [f.id]: f, [h.id]: h };
  const ch = {
    id: 'c2', name: 'c2', nodes, rootNodeId: r.id, sprites: {},
    costumeSets: [{ id: 'cs1', name: '默认', pieces: {} }],
    activeCostumeSetId: 'cs1', direction: 6, latitude: 0, ikChains: [chain],
  } as unknown as Character;
  const wt = computeWorldTransforms(ch, 0, W, W, 12);
  const tip = tipCanvas(wt, h.id, 30);
  const errTip = Math.hypot(tip.x - -80, tip.y - 30);
  const pa = posOf(wt, a.id), pm = posOf(wt, m.id), pf = posOf(wt, f.id), ph = posOf(wt, h.id);
  const bM = segBend(pa, pm, pf);
  const bF = segBend(pm, pf, ph);
  const bH = segBend(pf, ph, tip);
  console.log(`  C2 M位=(${pm.x.toFixed(0)},${pm.y.toFixed(0)}) 肘位=(${pf.x.toFixed(0)},${pf.y.toFixed(0)}) 尖端err=${errTip.toFixed(2)} 位置弯角 M=${bM.toFixed(1)} 肘=${bF.toFixed(1)} 腕=${bH.toFixed(1)}`);
  ok(Math.abs(bM) < 90, 'C2 插入关节不再折叠（旧值 −179°）');
  ok(errTip < 3, 'C2 尖端达标（剥尖端 3 骨）');
  ok(Math.abs(bH) < 120, 'C2 腕弯角无折叠（旧值 +158°）');

  // C3：捕姿口径——尖端覆写 0，末端关节落目标
  const chOff = { ...ch, ikChains: [{ ...chain, enabled: false }] } as Character;
  const fkT = computeWorldTransforms(chOff, 0, W, W, 12);
  const overrides = new Map<string, { angle: number; tilt: number }>();
  solveChainIKOverrides(chOff, chain, fkT, W, W, 0, 12, undefined, undefined, overrides, undefined, 0);
  ok(overrides.size >= 3, 'C3 捕姿口径产出覆写');
  const wt2 = computeWorldTransforms(chOff, 0, W, W, 12, undefined, undefined, overrides);
  const w2 = wt2.get(h.id)!;
  const p2 = projectToView(w2.worldX, w2.worldY, w2.worldZ, 6);
  const errJ = Math.hypot(subToPx(p2.canvasX) - -80, subToPx(p2.canvasY) - 30);
  const bM3 = segBend(posOf(wt2, a.id), posOf(wt2, m.id), posOf(wt2, f.id));
  console.log(`  C3 末端关节 err=${errJ.toFixed(2)} M位置弯角=${bM3.toFixed(1)}`);
  ok(errJ < 2.5, 'C3 捕姿口径末端关节落目标（4 关节链走 3 骨解析）');
  ok(Math.abs(bM3) < 90, 'C3 捕姿口径插入关节不折叠');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
