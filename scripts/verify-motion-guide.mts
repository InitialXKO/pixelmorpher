/**
 * verify-motion-guide — 制导生成轨迹探针（运动层，pixelfx 制导类分流）
 *
 * A) 求解器（纯函数，画布像素空间）：
 *    末点命中目标 ≤1px、转率全程不超限（朝向列 + 几何拐角双口径）、
 *    直线目标退化为直线、扭转 0 无侧偏、目标在身后大转弯仍命中、
 *    确定性（同输入同输出）、非法输入与不可达明确拒绝。
 * B) 生成 → 既有烘焙 → 既有消费读回：夹具角色上 generateGuidedTrajectory
 *    产出的轨迹写入 node.trajectory 后，经既有 interpolateNodeKeyframes
 *    逐帧读回、逆换算回画布点，与求解器点列逐点比对（容差 = 子像素
 *    取整量级）——证明生成物就是普通轨迹、消费端零改动即可播放。
 *    锚点双口径：插头（枢轴）与精灵点标记（clampPixelWorld 同源解析）。
 *
 * 运行：bun scripts/verify-motion-guide.mts
 */
import assert from 'node:assert/strict';
import { createDefaultNode, pxToSub, subToPx } from '../src/lib/unified-types';
import type { Character, Node, Sprite } from '../src/lib/unified-types';
import { interpolateNodeKeyframes } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { useProjectStore } from '../src/lib/store';
import {
  solveGuidancePath,
  generateGuidedTrajectory,
  wrapAngleDeg,
  type GuidanceSolveResult,
} from '../src/lib/motion-guide';

let passed = 0;
function ok(cond: boolean, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}
function mustOk(r: GuidanceSolveResult, label: string) {
  if (!r.ok) throw new Error(`${label}: 求解失败 — ${r.error}`);
  return r.path;
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function maxHeadingDelta(headings: number[]): number {
  let m = 0;
  for (let i = 1; i < headings.length; i++) m = Math.max(m, Math.abs(wrapAngleDeg(headings[i]! - headings[i - 1]!)));
  return m;
}
function maxGeometryTurn(points: { x: number; y: number }[]): number {
  let m = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const d1 = Math.hypot(b.x - a.x, b.y - a.y);
    const d2 = Math.hypot(c.x - b.x, c.y - b.y);
    if (d1 < 1e-9 || d2 < 1e-9) continue; // 停留点无方向，跳过
    const a1 = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const a2 = (Math.atan2(c.y - b.y, c.x - b.x) * 180) / Math.PI;
    m = Math.max(m, Math.abs(wrapAngleDeg(a2 - a1)));
  }
  return m;
}

// =====================================================================
// A) 求解器
// =====================================================================
console.log('A) 求解器');

// A1 直线目标退化为直线 + 末点命中
{
  const target = { x: 120, y: 0 };
  const p = mustOk(solveGuidancePath({ start: { x: 0, y: 0 }, target, totalFrames: 40, maxTurnDegPerFrame: 10, initialDirDeg: 0 }), 'A1');
  ok(p.points.length === 40, 'A1 点数 = 总帧数');
  ok(dist(p.points[p.points.length - 1]!, target) <= 1, `A1 末点命中 ≤1px（实际 ${dist(p.points[p.points.length - 1]!, target).toFixed(3)}）`);
  ok(p.points.every((pt) => Math.abs(pt.y) <= 1e-9), 'A1 全程无侧偏（y 恒为 0）');
  ok(p.arrivalFrame > 0 && p.arrivalFrame < 40, `A1 到达帧在界内（${p.arrivalFrame}）`);
  ok(p.points.slice(p.arrivalFrame).every((pt) => dist(pt, target) === 0), 'A1 到达后停留在目标点');
}

// A2 转率全程不超限（朝向列与几何拐角双口径）
{
  const target = { x: 60, y: 80 };
  const p = mustOk(solveGuidancePath({ start: { x: 0, y: 0 }, target, totalFrames: 60, maxTurnDegPerFrame: 6, initialDirDeg: 0 }), 'A2');
  ok(dist(p.points[p.points.length - 1]!, target) <= 1, 'A2 末点命中 ≤1px');
  ok(maxHeadingDelta(p.headingsDeg) <= 6 + 1e-9, `A2 朝向转率不超限（最大 ${maxHeadingDelta(p.headingsDeg).toFixed(3)}°/帧）`);
  ok(maxGeometryTurn(p.points) <= 6 + 1e-9, `A2 几何拐角不超限（最大 ${maxGeometryTurn(p.points).toFixed(3)}°/帧）`);
}

// A3 目标在身后：大转弯仍命中
{
  const target = { x: -80, y: 10 };
  const p = mustOk(solveGuidancePath({ start: { x: 0, y: 0 }, target, totalFrames: 120, maxTurnDegPerFrame: 8, initialDirDeg: 0 }), 'A3');
  ok(dist(p.points[p.points.length - 1]!, target) <= 1, 'A3 身后目标末点命中 ≤1px');
  ok(maxHeadingDelta(p.headingsDeg) <= 8 + 1e-9, 'A3 大转弯转率不超限');
  ok(p.arrivalFrame < 120, `A3 预算内到达（第 ${p.arrivalFrame} 帧）`);
}

// A4 扭转：端点不动、中段侧偏；扭转 0 与不填扭转逐点一致（无侧偏）
{
  const base = { start: { x: 0, y: 0 }, target: { x: 60, y: 80 }, totalFrames: 60, maxTurnDegPerFrame: 6, initialDirDeg: 0 };
  const plain = mustOk(solveGuidancePath(base), 'A4-plain');
  const zeroTwist = mustOk(solveGuidancePath({ ...base, twistAmpPx: 0, twistCycles: 2 }), 'A4-zero');
  ok(JSON.stringify(zeroTwist.points) === JSON.stringify(plain.points), 'A4 扭转幅值 0 → 与无扭转逐点一致');
  const twisted = mustOk(solveGuidancePath({ ...base, twistAmpPx: 6, twistCycles: 2 }), 'A4-twist');
  ok(dist(twisted.points[0]!, plain.points[0]!) === 0, 'A4 扭转不动起点');
  ok(dist(twisted.points[twisted.points.length - 1]!, base.target) <= 1, 'A4 扭转不损末点命中');
  ok(twisted.arrivalFrame === plain.arrivalFrame, 'A4 扭转不改到达帧');
  let maxDev = 0;
  for (let i = 0; i < plain.points.length; i++) maxDev = Math.max(maxDev, dist(twisted.points[i]!, plain.points[i]!));
  ok(maxDev >= 2, `A4 扭转中段确有侧偏（最大 ${maxDev.toFixed(2)}px）`);
}

// A5 确定性
{
  const input = { start: { x: 3, y: -7 }, target: { x: 90, y: 44 }, totalFrames: 70, maxTurnDegPerFrame: 9, initialDirDeg: 123, twistAmpPx: 4, twistCycles: 1.5 };
  const a = solveGuidancePath(input);
  const b = solveGuidancePath(input);
  ok(JSON.stringify(a) === JSON.stringify(b), 'A5 同输入同输出（无随机）');
}

// A6 非法输入与不可达：明确拒绝
{
  const good = { start: { x: 0, y: 0 }, target: { x: 50, y: 0 }, totalFrames: 30, maxTurnDegPerFrame: 10, initialDirDeg: 0 };
  ok(!solveGuidancePath({ ...good, totalFrames: 1 }).ok, 'A6 总帧数 <2 拒绝');
  ok(!solveGuidancePath({ ...good, maxTurnDegPerFrame: 0 }).ok, 'A6 转向率 0 拒绝');
  ok(!solveGuidancePath({ ...good, speedPxPerFrame: -3 }).ok, 'A6 步速为负拒绝');
  ok(!solveGuidancePath({ ...good, twistAmpPx: -1 }).ok, 'A6 扭转幅值为负拒绝');
  const far = solveGuidancePath({ ...good, target: { x: 500, y: 0 }, totalFrames: 10, speedPxPerFrame: 5 });
  ok(!far.ok && far.error.includes('无法到达'), 'A6 帧预算内不可达 → 明确错误（不静默凑数）');
}

// =====================================================================
// B) 生成 → 烘焙 → 既有消费读回
// =====================================================================
console.log('B) 生成→烘焙→读回');

const CANVAS = 256;
function buildFixture() {
  const nodes: Record<string, Node> = {};
  const mk = (id: string) => {
    const n = createDefaultNode(id, id);
    n.transform.variantIndex = 6 as never; // 南向：投影为恒等（canvas = 世界 + 中心）
    nodes[id] = n;
    return n;
  };
  const root = mk('root');
  const hand = mk('hand');
  const wand = mk('wand');
  root.children = ['hand', 'wand'];
  hand.parentId = 'root';
  wand.parentId = 'root';
  const wire = (parent: Node, child: Node, x: number, y: number) => {
    const sid = `sock_${child.id}`;
    parent.sockets.push({ id: sid, name: child.id, basePosition: { x: 0, y: 0 }, directionOffsets: {}, offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 } } as never);
    child.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
  };
  wire(root, hand, 30, 10);   // hand 枢轴画布位 = (128+30, 128+10) = (158, 138)
  wire(root, wand, 90, -20);  // wand 枢轴画布位 = (128+90, 128-20) = (218, 108)

  // wand 精灵 12×8：插头 (3,6)px；点标记「尖端」在归一 (0.75, 0.25) → 像素 (9,2)
  const wandSprite: Sprite = {
    id: 'spr_wand', width: 12, height: 8,
    pixels: new Uint32Array(12 * 8).fill(0xffffffff),
    plug: { x: pxToSub(3), y: pxToSub(6) } as never,
    marks: [{ id: 'm_tip', name: '尖端', kind: 'point', x: 0.75, y: 0.25 }],
  } as unknown as Sprite;
  const sprites: Record<string, Sprite> = { spr_wand: wandSprite };
  const wandPiece = wand.slot!;
  (wandPiece as any).sprites = { 6: { spriteId: 'spr_wand' } };
  const character = {
    id: 'fix_guide', name: '制导夹具',
    rootNodeId: 'root', nodes,
    costumeSets: [{ id: 'cs', name: 'A', pieces: { wand: wandPiece } }],
    activeCostumeSetId: 'cs',
    ikChains: [],
  } as unknown as Character;
  return { character, sprites };
}

const { character, sprites } = buildFixture();
useProjectStore.setState({ canvasWidth: CANVAS, canvasHeight: CANVAS, frameRate: 12, sprites } as never);
const env = { frame: 0, canvasWidth: CANVAS, canvasHeight: CANVAS, sprites };

// 读回：轨迹写入角色副本后，经既有 interpolateNodeKeyframes 逐帧读父级
// 局部值，再按烘焙的逆变换（父角 0 → 恒等）换回画布点
function readbackCanvasPoints(traj: { frame: number; x: number; y: number }[]) {
  const clone = JSON.parse(JSON.stringify(character, (k, v) => (v instanceof Uint32Array ? Array.from(v) : v)));
  // JSON 往返会丢 Uint32Array 等类型字段，读回只依赖节点 transform/轨迹，足够
  clone.nodes.hand.trajectory = traj;
  const baseIv = interpolateNodeKeyframes(character, 0).get('hand')!;
  const out: { x: number; y: number }[] = [];
  for (let f = 0; f < traj.length; f++) {
    const iv = interpolateNodeKeyframes(clone as Character, f).get('hand')!;
    out.push({
      x: 158 + subToPx(iv.x - baseIv.x),
      y: 138 + subToPx(iv.y - baseIv.y),
    });
  }
  return out;
}

// B1 插头锚：生成 + 起终点解析 + 读回逐点一致
{
  const gen = generateGuidedTrajectory({
    character, nodeId: 'hand', targetNodeId: 'wand', anchor: { kind: 'plug' },
    totalFrames: 60, maxTurnDegPerFrame: 10, env,
  });
  if (!gen.ok) throw new Error(`B1 生成失败: ${gen.error}`);
  ok(dist(gen.start, { x: 158, y: 138 }) <= 0.6, `B1 起点 = hand 枢轴画布位（${gen.start.x.toFixed(1)}, ${gen.start.y.toFixed(1)}）`);
  ok(dist(gen.target, { x: 218, y: 108 }) <= 0.6, `B1 目标 = wand 插头画布位（${gen.target.x.toFixed(1)}, ${gen.target.y.toFixed(1)}）`);
  ok(gen.trajectory.length === 60 && gen.trajectory.every((p, i) => p.frame === i), 'B1 轨迹 60 点、帧号 0..59 连续');
  const solved = mustOk(solveGuidancePath({
    start: gen.start, target: gen.target, totalFrames: 60, maxTurnDegPerFrame: 10,
    initialDirDeg: (Math.atan2(gen.target.y - gen.start.y, gen.target.x - gen.start.x) * 180) / Math.PI,
  }), 'B1-resolve');
  const back = readbackCanvasPoints(gen.trajectory);
  let maxDev = 0;
  for (let i = 0; i < 60; i++) maxDev = Math.max(maxDev, dist(back[i]!, solved.points[i]!));
  ok(maxDev <= 0.25, `B1 读回与求解器点列逐点一致（最大偏差 ${maxDev.toFixed(3)}px，子像素取整量级）`);
  ok(dist(back[back.length - 1]!, gen.target) <= 1, 'B1 读回末点命中目标 ≤1px');
}

// B2 标记锚：目标点 = 标记世界位（插头位 + (6,-4) 局部增量）
{
  const gen = generateGuidedTrajectory({
    character, nodeId: 'hand', targetNodeId: 'wand', anchor: { kind: 'mark', name: '尖端' },
    totalFrames: 60, maxTurnDegPerFrame: 10, env,
  });
  if (!gen.ok) throw new Error(`B2 生成失败: ${gen.error}`);
  ok(dist(gen.target, { x: 224, y: 104 }) <= 0.6, `B2 目标 = 「尖端」标记画布位（${gen.target.x.toFixed(1)}, ${gen.target.y.toFixed(1)}）`);
  const back = readbackCanvasPoints(gen.trajectory);
  ok(dist(back[back.length - 1]!, { x: 224, y: 104 }) <= 1, 'B2 读回末点命中标记 ≤1px');
}

// B3 生成级非法态：明确拒绝
{
  const baseIn = { character, nodeId: 'hand', targetNodeId: 'wand', anchor: { kind: 'plug' } as const, totalFrames: 60, maxTurnDegPerFrame: 10, env };
  const same = generateGuidedTrajectory({ ...baseIn, targetNodeId: 'hand' });
  ok(!same.ok && same.error.includes('自身'), 'B3 目标即自身 → 拒绝并明示');
  const ghost = generateGuidedTrajectory({ ...baseIn, targetNodeId: 'ghost' });
  ok(!ghost.ok, 'B3 目标节点不存在 → 拒绝');
  const noMark = generateGuidedTrajectory({ ...baseIn, anchor: { kind: 'mark', name: '不存在' } });
  ok(!noMark.ok && noMark.error.includes('不存在'), 'B3 标记不存在 → 拒绝并点名');
  ok(!generateGuidedTrajectory({ ...baseIn, totalFrames: 1 }).ok, 'B3 总帧数 <2 → 拒绝');
  ok(!generateGuidedTrajectory({ ...baseIn, maxTurnDegPerFrame: 0 }).ok, 'B3 转向率 0 → 拒绝');
  const unreachable = generateGuidedTrajectory({ ...baseIn, totalFrames: 4, speedPxPerFrame: 2 });
  ok(!unreachable.ok && unreachable.error.includes('无法到达'), 'B3 帧预算内不可达 → 拒绝并给可执行提示');
}

console.log(`verify-motion-guide: ${passed} 项全过`);
