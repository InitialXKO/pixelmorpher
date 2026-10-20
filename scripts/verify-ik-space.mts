// 验证 IK 视平面求解 + 深度写回（target3D / 蓝图 XYZ）：
// A1) 真实文件（东向、带 z 的旧项目）：引擎结果 == 独立复刻（投影→旧求解器→深度符号搜索→反投影）
// A2) 南向 + z 全平坦克隆：引擎 == 旧 2D 算法复刻（与 main 逐值等价的退化情形）
// B1) 恒等：target3D = FK 尖端 → 姿态不变
// B2) 纯深度移动（东向改 world x）：角度不变、末端深度到达可达边界、worldZ 不变
// B3) 视平面内拉动（东向改 world z）：求解后尖端到达 3D 目标
// C)  蓝图 XYZ（params 源）== 等值静态 target3D；顺带验 transform params 读取修复
import { readFileSync } from 'fs';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { evaluateBlueprint, EVALUATORS } from '../src/lib/blueprint/eval';
import { computeIKChainTip } from '../src/lib/ik-tip';
import { resolveChainTarget3D, subToPx } from '../src/lib/unified-types';
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
function fkOf(ch: any, frame: number, disableIdx = -1) {
  const c = clone(ch);
  c.ikChains = c.ikChains.map((x: any, i: number) => ({ ...x, enabled: disableIdx === -1 ? false : (i === disableIdx ? false : x.enabled) }));
  if (disableIdx === -1) c.ikChains = c.ikChains.map((x: any) => ({ ...x, enabled: false }));
  return computeWorldTransforms(c, frame, W, H, frameRate);
}

/** 独立复刻：视平面投影 → 旧求值器平面求解 → 深度符号搜索 → 反投影 */
function replicate(ch: any, chain: any, frame: number) {
  const jointIds = chainJointIds(ch, chain);
  const fk = fkOf(ch, frame);
  const fj = jointIds.map((id) => {
    const t = fk.get(id)!;
    return { x: subToPx(t.worldX), y: subToPx(t.worldY), z: subToPx(t.worldZ), angle: t.worldAngle, variant: t.variantIndex };
  });
  const dir = fj[0].variant;
  const theta = (((dir + 2) % 8) * Math.PI) / 4;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const view = fj.map((j) => ({ u: j.x * cosT + j.z * sinT, v: j.y, d: -j.x * sinT + j.z * cosT }));
  const n = jointIds.length;
  const lengths: number[] = [], lengths3D: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    lengths.push(Math.hypot(view[i + 1].u - view[i].u, view[i + 1].v - view[i].v));
    lengths3D.push(Math.hypot(fj[i + 1].x - fj[i].x, fj[i + 1].y - fj[i].y, fj[i + 1].z - fj[i].z));
  }
  let tipLength = chain.tipLength ?? 0;
  if (tipLength <= 0) {
    const sprite = ch.nodes[chain.endNodeId]?.sprite;
    if (sprite && sprite.height > 0) {
      const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
      tipLength = Math.max(1, sprite.height - plugY);
    } else tipLength = lengths[lengths.length - 1];
  }
  if (tipLength > 1e-6) {
    const last = view[n - 1];
    const rad = (fj[n - 1].angle * Math.PI) / 180;
    view.push({ u: last.u + -Math.sin(rad) * tipLength, v: last.v + Math.cos(rad) * tipLength, d: last.d });
    lengths.push(tipLength); lengths3D.push(tipLength);
  }
  let target = resolveChainTarget3D(chain, W, H) as { x: number; y: number; z: number };
  if (chain.targetBlueprint) {
    const r = evaluateBlueprint(chain.targetBlueprint, { frame, frameRate, vars: {} } as any);
    target = { x: r.translateX, y: r.translateY, z: r.translateZ };
  }
  const tv = { u: target.x * cosT + target.z * sinT, v: target.y, d: -target.x * sinT + target.z * cosT };
  const ikNode: any = {
    id: 'ik', type: 'ik_fabrik', inputs: {},
    params: { targetX: tv.u, targetY: tv.v, lengths: lengths.join(','), baseX: view[0].u, baseY: view[0].v },
  };
  const res = EVALUATORS['ik_fabrik'](ikNode, {}, { frame: 0, frameRate: 12, vars: {} } as any);
  const v: any = res.angles;
  const s = typeof v === 'object' && v !== null && 'value' in v ? String(v.value) : '';
  const rawA = s.split(',').map(Number).filter((x) => !isNaN(x)).map((a) => a - 90);
  const jointAngles = jointIds.map((_, idx) => rawA[Math.min(idx, rawA.length - 1)] ?? 0);
  const uv = [{ u: view[0].u, v: view[0].v }];
  for (let i = 1; i < n; i++) {
    const rad = (jointAngles[i - 1] * Math.PI) / 180;
    uv.push({ u: uv[i - 1].u + -Math.sin(rad) * lengths[i - 1], v: uv[i - 1].v + Math.cos(rad) * lengths[i - 1] });
  }
  // 深度符号搜索（独立实现）
  const fkD = view.slice(0, n).map((p) => p.d);
  const caps = lengths.slice(0, n - 1).map((L, i) => Math.sqrt(Math.max(0, lengths3D[i] ** 2 - L ** 2)));
  const fkSigns = caps.map((c, i) => (fkD[i + 1] - fkD[i] < 0 ? -1 : 1));
  const evalSigns = (signs: number[]) => {
    const ds = [fkD[0]];
    for (let i = 0; i < signs.length; i++) ds.push(ds[i] + signs[i] * caps[i]);
    let dev = 0;
    for (let i = 0; i < ds.length; i++) dev += Math.abs(ds[i] - fkD[i]);
    return { ds, err: Math.abs(ds[ds.length - 1] - tv.d), dev };
  };
  let best = evalSigns(fkSigns);
  for (let mask = 1; mask < (1 << caps.length); mask++) {
    const signs = fkSigns.map((sg, i) => ((mask >> i) & 1 ? -sg : sg));
    const cand = evalSigns(signs);
    if (cand.err < best.err - 1e-9 || (Math.abs(cand.err - best.err) <= 1e-9 && cand.dev < best.dev - 1e-9)) best = cand;
  }
  return jointIds.map((id, i) => {
    const d = best.ds[i];
    return {
      id,
      angle: jointAngles[i],
      x: uv[i].u * cosT - d * sinT,
      y: uv[i].v,
      z: uv[i].u * sinT + d * cosT,
    };
  });
}

// ---------- A1 ----------
for (const frame of [0, 7]) {
  const solved = computeWorldTransforms(character, frame, W, H, frameRate);
  for (const chain of character.ikChains as any[]) {
    if (!chain.enabled) continue;
    const exp = replicate(character, chain, frame);
    const okA = exp.every((e) => Math.abs(solved.get(e.id)!.worldAngle - e.angle) < 0.05);
    const okP = exp.every((e) => {
      const t = solved.get(e.id)!;
      return Math.abs(subToPx(t.worldX) - e.x) < 0.1 && Math.abs(subToPx(t.worldY) - e.y) < 0.1 && Math.abs(subToPx(t.worldZ) - e.z) < 0.1;
    });
    check(`A1 ${chain.name} f${frame} 角度==独立复刻`, okA, exp.map((e) => e.angle.toFixed(2)).join(', '));
    check(`A1 ${chain.name} f${frame} 位置==独立复刻`, okP, '含 z 写回');
  }
}

// ---------- A2：南向 z 平坦 == 旧算法 ----------
{
  const flat = clone(character);
  for (const node of Object.values(flat.nodes) as any[]) {
    node.transform.variantIndex = 6;
    node.transform.z = 0;
    if (node.tracks) node.tracks.variantIndex = { keyframes: [] };
    for (const s of node.sockets ?? []) delete s.offset3D;
  }
  const frame = 0;
  const fkFlat = fkOf(flat, frame);
  const zFlat = [...fkFlat.values()].every((t) => Math.abs(subToPx(t.worldZ)) < 1e-6);
  check('A2 前提：克隆 FK 的 z 全 0', zFlat, '');
  const solved = computeWorldTransforms(flat, frame, W, H, frameRate);
  for (const chain of flat.ikChains as any[]) {
    // 旧算法复刻（2D 关节、平面骨长、世界角尖端、含中心目标、toYAxis）
    const jointIds = chainJointIds(flat, chain);
    const joints = jointIds.map((id) => {
      const t = fkFlat.get(id)!;
      return { x: subToPx(t.worldX), y: subToPx(t.worldY), angle: t.worldAngle };
    });
    const lens: number[] = [];
    for (let i = 0; i < joints.length - 1; i++) lens.push(Math.hypot(joints[i + 1].x - joints[i].x, joints[i + 1].y - joints[i].y));
    const tipLength = chain.tipLength ?? lens[lens.length - 1];
    const lastJ = joints[joints.length - 1];
    const rad = (lastJ.angle * Math.PI) / 180;
    joints.push({ x: lastJ.x + -Math.sin(rad) * tipLength, y: lastJ.y + Math.cos(rad) * tipLength, angle: lastJ.angle });
    lens.push(tipLength);
    let tx = chain.target.x, ty = chain.target.y;
    if (chain.targetBlueprint) {
      const r = evaluateBlueprint(chain.targetBlueprint, { frame, frameRate, vars: {} } as any);
      if (Number.isFinite(r.translateX)) tx = r.translateX + W / 2;
      if (Number.isFinite(r.translateY)) ty = r.translateY + H / 2;
    }
    const ikNode: any = {
      id: 'ik', type: 'ik_fabrik', inputs: {},
      params: { targetX: tx, targetY: ty, lengths: lens.join(','), baseX: joints[0].x + W / 2, baseY: joints[0].y + H / 2 },
    };
    const res = EVALUATORS['ik_fabrik'](ikNode, {}, { frame: 0, frameRate: 12, vars: {} } as any);
    const vv: any = res.angles;
    const ss = typeof vv === 'object' && vv !== null && 'value' in vv ? String(vv.value) : '';
    const rawA = ss.split(',').map(Number).filter((x) => !isNaN(x)).map((a) => a - 90);
    const expAngles = jointIds.map((_, idx) => rawA[Math.min(idx, rawA.length - 1)] ?? 0);
    const actAngles = jointIds.map((id) => solved.get(id)!.worldAngle);
    const ok = actAngles.every((a, i) => Math.abs(a - expAngles[i]) < 0.05);
    check(`A2 ${chain.name} 南向平坦 角度==旧算法`, ok,
      `实际 [${actAngles.map((a) => a.toFixed(2)).join(', ')}] 旧 [${expAngles.map((a) => a.toFixed(2)).join(', ')}]`);
  }
}

// ---------- B ----------
function fkTipOf(ch: any, chainIdx: number) {
  const c = clone(ch);
  const chain = c.ikChains[chainIdx];
  const jointIds = chainJointIds(c, chain);
  const dis = clone(ch);
  dis.ikChains[chainIdx] = { ...dis.ikChains[chainIdx], enabled: false };
  useProjectStore.setState({ currentFrame: 0 });
  // computeIKChainTip 内部用 store 的 currentFrame/canvas；ch 的链在 dis 中禁用 → FK 尖端
  const tip = computeIKChainTip(dis, jointIds, chain.tipLength);
  return { jointIds, tip };
}
{
  const chainIdx = 0;
  const chain = character.ikChains[chainIdx];
  const { jointIds, tip } = fkTipOf(character, chainIdx);
  const fk = fkOf(character, 0);
  const mkSolved = (t3: { x: number; y: number; z: number }) => {
    const c = clone(character);
    c.ikChains[chainIdx] = { ...c.ikChains[chainIdx], targetBlueprint: undefined, target3D: { ...t3 } };
    return computeWorldTransforms(c, 0, W, H, frameRate);
  };
  // B1 目标=FK尖端：末端效应器不移动（肘侧由 FABRIK 直线初始化收敛决定，
  // 与旧求解器同性质——恒等的是尖端位置，不是肘部姿态）
  const s1 = mkSolved({ x: tip.tipX, y: tip.tipY, z: tip.tipZ });
  const s1char = clone(character);
  s1char.ikChains[chainIdx] = { ...s1char.ikChains[chainIdx], targetBlueprint: undefined, target3D: { x: tip.tipX, y: tip.tipY, z: tip.tipZ } };
  const tip1 = computeIKChainTip(s1char, jointIds, chain.tipLength);
  const tipDist1 = Math.hypot(tip1.tipX - tip.tipX, tip1.tipY - tip.tipY, tip1.tipZ - tip.tipZ);
  check('B1 target3D=FK尖端 → 尖端不移动', tipDist1 < 1.5, `尖端偏移 ${tipDist1.toFixed(2)}px`);
  // B2 纯深度（东向：改 world x = 改深度，视平面不变）
  const s2 = mkSolved({ x: tip.tipX - 30, y: tip.tipY, z: tip.tipZ });
  const endId = jointIds[jointIds.length - 1];
  const depthOf = (t: any, variant: number) => {
    const th = (((variant + 2) % 8) * Math.PI) / 4;
    return -subToPx(t.worldX) * Math.sin(th) + subToPx(t.worldZ) * Math.cos(th);
  };
  const variant = fk.get(jointIds[0])!.variantIndex;
  const d1 = depthOf(s1.get(endId), variant);
  const d2 = depthOf(s2.get(endId), variant);
  const angSame = jointIds.every((id) => Math.abs(s2.get(id)!.worldAngle - s1.get(id)!.worldAngle) < 0.06);
  check('B2 纯深度移动 角度不变', angSame, '');
  check('B2 末端深度向目标移动', d2 > d1 + 5, `深度 ${d1.toFixed(1)} → ${d2.toFixed(1)}（目标 +30，受骨长容量限制）`);
  check('B2 worldZ 不变（深度≠视平面）', Math.abs(subToPx(s2.get(endId)!.worldZ) - subToPx(s1.get(endId)!.worldZ)) < 0.15,
    `z ${subToPx(s1.get(endId)!.worldZ).toFixed(1)} → ${subToPx(s2.get(endId)!.worldZ).toFixed(1)}`);
  // B3 视平面拉动（东向：改 world z = 改视平面 u）；目标取可达点（向基点收 15% 再侧移）
  const baseT = fk.get(jointIds[0])!;
  const bx = subToPx(baseT.worldX), by = subToPx(baseT.worldY), bz = subToPx(baseT.worldZ);
  const t3 = {
    x: bx + (tip.tipX - bx) * 0.85,
    y: by + (tip.tipY - by) * 0.85,
    z: bz + (tip.tipZ - bz) * 0.85 + 20,
  };
  const s3char = clone(character);
  s3char.ikChains[chainIdx] = { ...s3char.ikChains[chainIdx], targetBlueprint: undefined, target3D: { ...t3 } };
  const tipSolved = computeIKChainTip(s3char, jointIds, chain.tipLength);
  const dist = Math.hypot(tipSolved.tipX - t3.x, tipSolved.tipY - t3.y, tipSolved.tipZ - t3.z);
  check('B3 视平面拉动后尖端到达目标', dist < 3, `尖端距目标 ${dist.toFixed(2)}px`);
}

// ---------- C ----------
{
  const bpGraph: any = {
    version: 1,
    nodes: [{ id: 'out', type: 'transform', inputs: {}, params: { translateX: 30, translateY: 55, translateZ: 40 }, ui: { x: 0, y: 0 } }],
    outputId: 'out',
  };
  const r = evaluateBlueprint(bpGraph, { frame: 0, frameRate, vars: {} } as any);
  check('C transform params 读取（XYZ）', r.translateX === 30 && r.translateY === 55 && r.translateZ === 40,
    `得到 (${r.translateX}, ${r.translateY}, ${r.translateZ})`);
  const mkChar = (useBp: boolean) => {
    const c = clone(character);
    const ch0 = c.ikChains[0];
    if (useBp) { ch0.targetBlueprint = bpGraph; ch0.target3D = { x: 0, y: 0, z: 0 }; }
    else { ch0.targetBlueprint = undefined; ch0.target3D = { x: 30, y: 55, z: 40 }; }
    return c;
  };
  const a = computeWorldTransforms(mkChar(false), 0, W, H, frameRate);
  const b = computeWorldTransforms(mkChar(true), 0, W, H, frameRate);
  const jointIds = chainJointIds(character, character.ikChains[0]);
  const same = jointIds.every((id) => {
    const ta = a.get(id)!, tb = b.get(id)!;
    return Math.abs(ta.worldAngle - tb.worldAngle) < 1e-6 && ta.worldX === tb.worldX && ta.worldY === tb.worldY && ta.worldZ === tb.worldZ;
  });
  check('C 蓝图 XYZ == 静态 target3D', same, '两路姿态逐值相同');
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
