// 验证 IK 乙：真 3D 求解（2bone 带 pole / FABRIK）+ (angle, tilt) 闭式反解注入重算 FK
// A)  真实文件（东向、带 z、gait 蓝图）：解后尖端（走最终 transforms 的 computeIKChainTip）
//     到达有效目标（不可达时为钳制目标）——FK↔IK 自洽的外部证明
// A2) 南向 + z 全平坦克隆：新求解保持平面（z≈0）、段长不变、尖端到达钳制目标；
//     满伸直（唯一解）时全关节位置/角度 == 旧 2D FABRIK 复刻
// B1) 恒等：target3D = FK 尖端 → 尖端不移动
// B2) 纯深度移动（东向改 world x = 深度轴）：尖端到达（甲只能到可达边界）
// B3) 视平面内拉动（东向改 world z）：尖端到达
// B4) pole：2bone 下 pole 镜像 → 肘翻侧，尖端仍到达
// C)  蓝图 XYZ（params 源）== 等值静态 target3D（全节点逐值）
// D)  resolver 朝向填充（dir0 东向 x 分量落 z；dir6 回归）+ ikTargetMirror 往返 + tip 的 direction
// E)  链外后代跟随（合成角色：end 关节的子节点随动且段长保持）
import { readFileSync } from 'fs';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { evaluateBlueprint } from '../src/lib/blueprint/eval';
import { solveIKFabrik } from '../src/lib/blueprint/ik';
import { computeIKChainTip } from '../src/lib/ik-tip';
import { resolveChainTarget3D, ikTargetMirror, subToPx, pxToSub, frameYAxisWorld } from '../src/lib/unified-types';
import { useProjectStore } from '../src/lib/store';

const raw = JSON.parse(readFileSync('/home/hatch/workspace/user/files/1_0_hzs0.pxm', 'utf-8'));
const proj = raw.project;
const W = proj.canvasWidth ?? 256;
const H = proj.canvasHeight ?? 256;
const character = (Object.values(proj.unifiedCharacters) as any[])[0];
const frameRate = proj.frameRate ?? 12;
useProjectStore.setState({ canvasWidth: W, canvasHeight: H, currentFrame: 0 });

let fail = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${label}: ${detail}`);
  if (!ok) fail++;
}
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const dist3 = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function chainJointIds(ch: any, chain: any): string[] {
  const ids: string[] = [];
  let cur: string | undefined = chain.endNodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    ids.unshift(cur);
    if (cur === chain.rootNodeId) break;
    cur = ch.nodes[cur]?.parentId;
  }
  return ids;
}
function fkOf(ch: any, frame: number) {
  const c = clone(ch);
  c.ikChains = (c.ikChains ?? []).map((x: any) => ({ ...x, enabled: false }));
  return computeWorldTransforms(c, frame, W, H, frameRate);
}
const posOf = (t: any) => ({ x: subToPx(t.worldX), y: subToPx(t.worldY), z: subToPx(t.worldZ) });
/** 有效目标 = resolver（按 FK 根朝向填充）+ targetBlueprint 的 XYZ 逐分量覆盖（与生产求解同口径） */
function effTarget(chain: any, rootVariant: number, frame: number) {
  const t = { ...resolveChainTarget3D(chain, W, H, rootVariant) };
  if (chain.targetBlueprint) {
    const r = evaluateBlueprint(chain.targetBlueprint, { frame, frameRate, vars: {} } as any);
    if (Number.isFinite(r.translateX)) t.x = r.translateX;
    if (Number.isFinite(r.translateY)) t.y = r.translateY;
    if (Number.isFinite(r.translateZ)) t.z = r.translateZ;
  }
  return t;
}
function clampToReach(root: any, target: any, total: number) {
  const d = dist3(root, target);
  if (d <= total || d < 1e-9) return target;
  const s = total / d;
  return { x: root.x + (target.x - root.x) * s, y: root.y + (target.y - root.y) * s, z: root.z + (target.z - root.z) * s };
}

// ---------- A ----------
for (const frame of [0, 7, 13]) {
  useProjectStore.setState({ currentFrame: frame });
  for (const chain of character.ikChains as any[]) {
    if (!chain.enabled) continue;
    const jointIds = chainJointIds(character, chain);
    const fk = fkOf(character, frame);
    const rootPos = posOf(fk.get(jointIds[0]));
    let total = chain.tipLength ?? 0;
    for (let i = 0; i < jointIds.length - 1; i++) total += dist3(posOf(fk.get(jointIds[i])), posOf(fk.get(jointIds[i + 1])));
    const tgt = effTarget(chain, fk.get(jointIds[0])!.variantIndex, frame);
    const clamped = clampToReach(rootPos, tgt, total);
    const tip = computeIKChainTip(character, jointIds, chain.tipLength);
    const d = dist3({ x: tip.tipX, y: tip.tipY, z: tip.tipZ }, clamped);
    check(`A ${chain.name} f${frame} 尖端到达${clamped === tgt ? '目标' : '钳制目标'}`, d < 1.5,
      `距钳制目标 ${d.toFixed(2)}px（原始目标距 ${dist3({ x: tip.tipX, y: tip.tipY, z: tip.tipZ }, tgt).toFixed(2)}px）`);
  }
}

// ---------- A2 ----------
{
  const flat = clone(character);
  for (const node of Object.values(flat.nodes) as any[]) {
    node.transform.variantIndex = 6;
    node.transform.z = 0;
    if (node.tracks) node.tracks.variantIndex = { keyframes: [] };
    for (const s of node.sockets ?? []) delete s.offset3D;
  }
  const frame = 0;
  useProjectStore.setState({ currentFrame: frame });
  const fkFlat = fkOf(flat, frame);
  const zFlat = [...fkFlat.values()].every((t) => Math.abs(subToPx(t.worldZ)) < 1e-6);
  check('A2 前提：克隆 FK 的 z 全 0', zFlat, '');
  const solved = computeWorldTransforms(flat, frame, W, H, frameRate);
  for (const chain of flat.ikChains as any[]) {
    const jointIds = chainJointIds(flat, chain);
    const joints = jointIds.map((id) => posOf(fkFlat.get(id)!));
    const lens: number[] = [];
    for (let i = 0; i < joints.length - 1; i++) lens.push(Math.hypot(joints[i + 1].x - joints[i].x, joints[i + 1].y - joints[i].y));
    const tipLength = chain.tipLength ?? lens[lens.length - 1];
    const totalLen = lens.reduce((s, l) => s + l, 0) + tipLength;
    // 旧 2D 口径目标：静态（南向填充）+ 蓝图 translateX/Y 覆盖（旧求解无 z 通道）
    const st = resolveChainTarget3D(chain, W, H, 6);
    let tx = st.x, ty = st.y;
    if (chain.targetBlueprint) {
      const r = evaluateBlueprint(chain.targetBlueprint, { frame, frameRate, vars: {} } as any);
      if (Number.isFinite(r.translateX)) tx = r.translateX;
      if (Number.isFinite(r.translateY)) ty = r.translateY;
    }
    // 新求解：平面性 + 段长 + 尖端到达钳制目标
    const solvedJoints = jointIds.map((id) => posOf(solved.get(id)!));
    const zOk = solvedJoints.every((p) => Math.abs(p.z) < 0.6);
    check(`A2 ${chain.name} 南向平坦 解后仍在平面`, zOk, `max|z| ${Math.max(...solvedJoints.map((p) => Math.abs(p.z))).toFixed(3)}px`);
    let lenOk = true;
    for (let i = 0; i < solvedJoints.length - 1; i++) lenOk = lenOk && Math.abs(dist3(solvedJoints[i], solvedJoints[i + 1]) - lens[i]) < 0.6;
    check(`A2 ${chain.name} 段长保持`, lenOk, '');
    const tip = computeIKChainTip(flat, jointIds, chain.tipLength);
    const clamped2 = clampToReach(joints[0], { x: tx, y: ty, z: 0 }, totalLen);
    const dTip = dist3({ x: tip.tipX, y: tip.tipY, z: tip.tipZ }, clamped2);
    check(`A2 ${chain.name} 尖端到达钳制目标`, dTip < 1.5, `距 ${dTip.toFixed(2)}px`);
    // 旧 2D FABRIK 复刻（EVALUATORS 底层的 solveIKFabrik，直线初始化）
    const allLens = [...lens, tipLength];
    const legacy = solveIKFabrik({ targetX: tx, targetY: ty, lengths: allLens, baseX: joints[0].x, baseY: joints[0].y });
    const legacyTip = legacy.joints[legacy.joints.length - 1];
    const extended = Math.hypot(tx - joints[0].x, ty - joints[0].y) >= totalLen - 1e-6;
    // 满伸直唯一解：新旧全关节位置逐值一致；角度口径不同（旧=段方向角，新=帧角，
    // 偏移非 +Y 对齐时本就不等）——断言乙的刚性不变量：帧 +Y 与出段方向的夹角 FK→解后保持
    if (extended) {
      const posOk = jointIds.every((id, i) => Math.hypot(solvedJoints[i].x - legacy.joints[i].x, solvedJoints[i].y - legacy.joints[i].y) < 0.75);
      check(`A2 ${chain.name} 满伸直 全关节位置==旧算法`, posOk,
        `新 y [${solvedJoints.map((p) => p.y.toFixed(1)).join(',')}] 旧 y [${legacy.joints.map((p: any) => p.y.toFixed(1)).join(',')}]`);
      const angBetween = (a: any, b: any) => {
        const d = (a.x * b.x + a.y * b.y + a.z * b.z) / ((Math.hypot(a.x, a.y, a.z) || 1) * (Math.hypot(b.x, b.y, b.z) || 1));
        return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
      };
      let rigidOk = true;
      for (let i = 0; i < jointIds.length - 1; i++) {
        const fkT = fkFlat.get(jointIds[i])!;
        const solT = solved.get(jointIds[i])!;
        const segEnd = solvedJoints[i + 1];
        const segFkEnd = joints[i + 1];
        const yFk = frameYAxisWorld(fkT.worldFrame, fkT.variantIndex);
        const ySol = frameYAxisWorld(solT.worldFrame, solT.variantIndex);
        const dFk = angBetween(yFk, { x: segFkEnd.x - joints[i].x, y: segFkEnd.y - joints[i].y, z: segFkEnd.z - joints[i].z });
        const dSol = angBetween(ySol, { x: segEnd.x - solvedJoints[i].x, y: segEnd.y - solvedJoints[i].y, z: segEnd.z - solvedJoints[i].z });
        if (Math.abs(dFk - dSol) > 0.5) rigidOk = false;
      }
      check(`A2 ${chain.name} 满伸直 帧-段夹角保持（刚性旋转）`, rigidOk,
        `新帧角 [${jointIds.map((id) => solved.get(id)!.worldAngle.toFixed(2)).join(', ')}] 旧段角 [${legacy.angles.map((a: number) => (a - 90).toFixed(2)).join(', ')}]`);
    } else {
      console.log(`  · A2 ${chain.name} 目标可达且弯曲：旧 FABRIK（直线初始化）尖端距目标 ${Math.hypot(legacyTip.x - tx, legacyTip.y - ty).toFixed(2)}px，新求解（FK 初始化）${dTip.toFixed(2)}px——分支选择口径不同，不做逐值断言`);
    }
  }
}

// ---------- B ----------
function fkTipOf(ch: any, chainIdx: number) {
  const chain = ch.ikChains[chainIdx];
  const jointIds = chainJointIds(ch, chain);
  const dis = clone(ch);
  dis.ikChains[chainIdx] = { ...dis.ikChains[chainIdx], enabled: false };
  useProjectStore.setState({ currentFrame: 0 });
  const tip = computeIKChainTip(dis, jointIds, chain.tipLength);
  return { jointIds, tip };
}
{
  const chainIdx = 0;
  const { jointIds, tip } = fkTipOf(character, chainIdx);
  const fkTip = { x: tip.tipX, y: tip.tipY, z: tip.tipZ };
  const mkChar = (t3: any, extra: any = {}) => {
    const c = clone(character);
    c.ikChains[chainIdx] = { ...c.ikChains[chainIdx], targetBlueprint: undefined, target3D: { ...t3 }, ...extra };
    return c;
  };
  const tipAfter = (c: any) => {
    const t = computeIKChainTip(c, jointIds, c.ikChains[chainIdx].tipLength);
    return { x: t.tipX, y: t.tipY, z: t.tipZ };
  };
  // B1 目标=FK尖端 → 尖端不移动
  const d1 = dist3(tipAfter(mkChar(fkTip)), fkTip);
  check('B1 target3D=FK尖端 → 尖端不移动', d1 < 1.5, `尖端偏移 ${d1.toFixed(2)}px`);
  // B2 纯深度（东向：改 world x = 改深度，视平面 (z,y) 不变）；FK 姿态近满伸（74.4/75.8），
  // 取 -18 保持可达（-30 时超距 1.0，解算尖端精确落钳制点，已由探针核实）
  const t2 = { x: fkTip.x - 18, y: fkTip.y, z: fkTip.z };
  const d2 = dist3(tipAfter(mkChar(t2)), t2);
  check('B2 纯深度移动 -18 → 尖端到达', d2 < 1.5, `距目标 ${d2.toFixed(2)}px（甲在此只能部分到达）`);
  // B3 视平面内拉动（东向改 world z = 改 u，兼回拉 y 保可达）
  const t3 = { x: fkTip.x, y: fkTip.y - 10, z: fkTip.z + 18 };
  const d3 = dist3(tipAfter(mkChar(t3)), t3);
  check('B3 视平面内拉动 (z+18, y-10) → 尖端到达', d3 < 1.5, `距目标 ${d3.toFixed(2)}px`);
  // B4 pole：强制 2bone，目标取可达弯曲位；pole 镜像 → 肘翻侧、尖端仍到达
  const fk = fkOf(character, 0);
  const rootPos = posOf(fk.get(jointIds[0]));
  const elbowFk = posOf(fk.get(jointIds[1]));
  const tgtB = { x: fkTip.x, y: fkTip.y - 10, z: fkTip.z + 18 };
  const axis = { x: tgtB.x - rootPos.x, y: tgtB.y - rootPos.y, z: tgtB.z - rootPos.z };
  const al = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const dAxis = { x: axis.x / al, y: axis.y / al, z: axis.z / al };
  const rel = { x: elbowFk.x - rootPos.x, y: elbowFk.y - rootPos.y, z: elbowFk.z - rootPos.z };
  const projLen = rel.x * dAxis.x + rel.y * dAxis.y + rel.z * dAxis.z;
  const poleMirror = {
    x: rootPos.x + 2 * projLen * dAxis.x - rel.x,
    y: rootPos.y + 2 * projLen * dAxis.y - rel.y,
    z: rootPos.z + 2 * projLen * dAxis.z - rel.z,
  };
  const elbowOf = (c: any) => posOf(computeWorldTransforms(c, 0, W, H, frameRate).get(jointIds[1])!);
  const cA = mkChar(tgtB, { solver: '2bone', poleTarget3D: { ...elbowFk } });
  const cB = mkChar(tgtB, { solver: '2bone', poleTarget3D: poleMirror });
  const eA = elbowOf(cA), eB = elbowOf(cB);
  const elbowShift = dist3(eA, eB);
  const dTipB = dist3(tipAfter(cB), tgtB);
  check('B4 pole 镜像 → 肘翻侧', elbowShift > 8, `肘位移 ${elbowShift.toFixed(1)}px`);
  check('B4 pole 镜像 → 尖端仍到达', dTipB < 1.5, `距目标 ${dTipB.toFixed(2)}px`);
}

// ---------- C ----------
{
  const chainIdx = 0;
  const bpGraph = {
    version: 1,
    nodes: [{ id: 'o', type: 'transform', inputs: {}, params: { translateX: 30, translateY: 55, translateZ: 40 }, ui: { x: 0, y: 0 } }],
    outputId: 'o',
  };
  const cBp = clone(character);
  cBp.ikChains[chainIdx] = { ...cBp.ikChains[chainIdx], targetBlueprint: bpGraph, target3D: undefined };
  const cSt = clone(character);
  cSt.ikChains[chainIdx] = { ...cSt.ikChains[chainIdx], targetBlueprint: undefined, target3D: { x: 30, y: 55, z: 40 } };
  const tBp = computeWorldTransforms(cBp, 0, W, H, frameRate);
  const tSt = computeWorldTransforms(cSt, 0, W, H, frameRate);
  let maxD = 0;
  for (const [id, t] of tBp) {
    const o = tSt.get(id);
    if (!o) continue;
    maxD = Math.max(maxD, Math.abs(t.worldX - o.worldX), Math.abs(t.worldY - o.worldY), Math.abs(t.worldZ - o.worldZ));
  }
  check('C 蓝图 XYZ == 静态 target3D', maxD < 1, `全节点最大位置差 ${maxD} sub`);
}

// ---------- D ----------
{
  const stub: any = { target: { x: 154.88344289457763, y: 181.31541617273797 } };
  const e = resolveChainTarget3D(stub, 256, 256, 0);
  check('D resolver dir0（东向）x 分量落 z', Math.abs(e.x) < 0.01 && Math.abs(e.y - 53.3154) < 0.01 && Math.abs(e.z - 26.8834) < 0.01,
    `(${e.x.toFixed(2)}, ${e.y.toFixed(2)}, ${e.z.toFixed(2)})`);
  const s = resolveChainTarget3D(stub, 256, 256, 6);
  check('D resolver dir6（南向）回归', Math.abs(s.x - 26.8834) < 0.01 && Math.abs(s.y - 53.3154) < 0.01 && Math.abs(s.z) < 0.01,
    `(${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`);
  for (const dir of [0, 6] as const) {
    const m = ikTargetMirror(resolveChainTarget3D(stub, 256, 256, dir), dir, 256, 256);
    check(`D mirror 往返 dir${dir}`, Math.abs(m.x - stub.target.x) < 0.01 && Math.abs(m.y - stub.target.y) < 0.01,
      `(${m.x.toFixed(2)}, ${m.y.toFixed(2)})`);
  }
  const { tip } = fkTipOf(character, 0);
  check('D computeIKChainTip.direction == 链根朝向（东向 0）', (tip as any).direction === 0, `direction=${(tip as any).direction}`);
}

// ---------- E ----------
{
  function mkNode(id: string, opts: any = {}): any {
    return {
      id, name: id,
      parentId: opts.parentId ?? null,
      children: opts.children ?? [],
      transform: { x: 0, y: 0, z: 0, angle: 0, stretch: 1, variantIndex: 6, ...(opts.transform ?? {}) },
      tracks: {}, modifiers: [], sockets: opts.sockets ?? [],
      attachment: opts.attachment ?? { type: 'root' },
      drawLayer: 'default', visible: true,
    };
  }
  const sock = (id: string, base2d: { x: number; y: number }): any => ({
    id, name: id, basePosition: { x: pxToSub(base2d.x), y: pxToSub(base2d.y) }, directionOffsets: {},
  });
  const chE: any = {
    rootNodeId: 'R',
    ikChains: [{
      id: 'e', name: 'e', rootNodeId: 'A', endNodeId: 'B',
      target: { x: 0, y: 0 }, solver: 'fabrik', bendDir: 1, tipLength: 15, enabled: true,
    }],
    nodes: {
      R: mkNode('R', { children: ['A'], sockets: [sock('s1', { x: 0, y: 20 })] }),
      A: mkNode('A', { parentId: 'R', children: ['B'], sockets: [sock('s2', { x: 0, y: 20 })], attachment: { type: 'socket', parentSocketId: 's1' }, transform: { angle: 20 } }),
      B: mkNode('B', { parentId: 'A', children: ['C'], sockets: [sock('s3', { x: 0, y: 12 })], attachment: { type: 'socket', parentSocketId: 's2' }, transform: { angle: -15 } }),
      C: mkNode('C', { parentId: 'B', attachment: { type: 'socket', parentSocketId: 's3' }, transform: { angle: 5 } }),
    },
  };
  useProjectStore.setState({ canvasWidth: 256, canvasHeight: 256, currentFrame: 0 });
  const jointIdsE = ['A', 'B'];
  const disE = clone(chE);
  disE.ikChains[0] = { ...disE.ikChains[0], enabled: false };
  const tipE = computeIKChainTip(disE, jointIdsE, 15);
  const fkE = computeWorldTransforms(disE, 0, 256, 256, 12);
  const tgtE = { x: tipE.tipX + 8, y: tipE.tipY - 6, z: tipE.tipZ + 5 };
  const solE = clone(chE);
  solE.ikChains[0] = { ...solE.ikChains[0], target3D: tgtE };
  const solvedE = computeWorldTransforms(solE, 0, 256, 256, 12);
  const cFk = posOf(fkE.get('C')); const cSol = posOf(solvedE.get('C'));
  const bFk = posOf(fkE.get('B')); const bSol = posOf(solvedE.get('B'));
  const moved = dist3(cFk, cSol);
  const segDelta = Math.abs(dist3(cSol, bSol) - dist3(cFk, bFk));
  check('E 链外后代 C 随 end 关节跟随', moved > 3, `C 位移 ${moved.toFixed(1)}px`);
  check('E 后代段长保持', segDelta < 0.1, `|Δ| ${segDelta.toFixed(3)}px`);
  const tipSolE = computeIKChainTip(solE, jointIdsE, 15);
  const dE = dist3({ x: tipSolE.tipX, y: tipSolE.tipY, z: tipSolE.tipZ }, tgtE);
  check('E 合成链尖端到达 3D 目标', dE < 1.5, `距目标 ${dE.toFixed(2)}px`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
