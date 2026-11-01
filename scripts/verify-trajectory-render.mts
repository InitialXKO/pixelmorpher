// ============================================================
// 轨迹主消费探针（F-01）：node.trajectory 必须被主渲染位姿路径与
// 进包采样真正消费，而不只是辅助链（puppet-keyframe-interpolation）。
//
// 测的对象是出图对象本身：
//  A) computeWorldTransforms —— generateRenderPlan / 画布出图 /
//     拾取 / 覆盖层共用的位姿源。断言带轨迹的根节点在若干帧的
//     世界位 == 轨迹插值期望（手算值 + 与共享函数对拍）、且与同
//     节点轨道 x/y 的结果不同（证明轨迹盖过轨道）；同帧重复点
//     验入段读第一点 / 恰帧取出段最后一点 / 出段自最后一点起；
//     子节点世界位增量与根增量一致（子树跟随）。
//  B) convertCharacterToRuntimePackage —— 轨迹-only 节点（无任
//     何轨道）也必须产出「轨道」表演且 dx/dy 曲线与编辑器同帧
//     世界位投影对齐；节点同时有冲突轨道时包内仍走轨迹。
//
// 还原自查：摘掉 unified-render 的轨迹接线 → A 全红；摘掉
// convert 的 trackNodes 轨迹开门 → B1 红（无「轨道」表演）。
// ============================================================

import { computeWorldTransforms } from '../src/lib/unified-render';
import { interpolateTrajectoryPoints } from '../src/lib/engine/render-helpers/puppet-keyframe-interpolation';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import {
  createDefaultCharacter, createDefaultNode, pxToSub, subToPx, projectToView,
  type Character, type Node,
} from '../src/lib/unified-types';

let fails = 0;
let total = 0;
const ok = (c: boolean, m: string) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const FR = 12;

// ---------- A) 主渲染位姿路径 ----------
const TRAJ: { frame: number; x: number; y: number }[] = [
  { frame: 0, x: pxToSub(0), y: pxToSub(0) },
  { frame: 5, x: pxToSub(30), y: pxToSub(-10) },   // 同帧重复点·第一点（入段读它）
  { frame: 5, x: pxToSub(50), y: pxToSub(-20) },   // 同帧重复点·最后一点（恰帧/出段读它）
  { frame: 12, x: pxToSub(90), y: pxToSub(10) },
  { frame: 20, x: pxToSub(90), y: pxToSub(30) },
];

function buildCharA(withTraj: boolean): Character {
  const ch = createDefaultCharacter('ta', 'TA');
  const root = ch.nodes[ch.rootNodeId]!;
  root.tracks = {
    x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 20, value: pxToSub(100) }] },
    y: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 20, value: pxToSub(40) }] },
  } as Node['tracks'];
  if (withTraj) root.trajectory = TRAJ.map((p) => ({ ...p }));
  const kid = createDefaultNode('kid', 'Kid');
  kid.parentId = root.id;
  kid.transform = { ...kid.transform, x: pxToSub(10), y: pxToSub(5) };
  root.children = ['kid'];
  ch.nodes['kid'] = kid;
  return ch;
}

{
  const chTraj = buildCharA(true);
  const chTrack = buildCharA(false);
  const rootId = chTraj.rootNodeId;
  const world = (ch: Character, f: number, id: string) => {
    const w = computeWorldTransforms(ch, f, 512, 512, FR).get(id)!;
    return { x: w.worldX, y: w.worldY };
  };

  // 手算期望（SubPixel，16/px）：见 TRAJ 注释
  const hand: Record<number, { x: number; y: number }> = {
    0: { x: 0, y: 0 },
    2: { x: 192, y: -64 },      // 入段：朝第一重复点 (30,-10)px 插值 t=0.4
    5: { x: 800, y: -320 },     // 恰帧：取最后重复点 (50,-20)px
    8: { x: 1074, y: -114 },    // 出段：自最后重复点向 (90,10)px 插值 t=3/7 取整
    12: { x: 1440, y: 160 },
    20: { x: 1440, y: 480 },
    25: { x: 1440, y: 480 },    // 范围外 hold 末点
  };
  for (const [fs, want] of Object.entries(hand)) {
    const f = Number(fs);
    const got = world(chTraj, f, rootId);
    ok(got.x === want.x && got.y === want.y,
      `A f${f} 根世界位 == 轨迹手算期望 (${want.x},${want.y})，实得 (${got.x},${got.y})`);
    const shared = interpolateTrajectoryPoints(TRAJ, f)!;
    ok(got.x === shared.x && got.y === shared.y,
      `A f${f} 根世界位与共享插值函数逐值一致 (${shared.x},${shared.y})`);
  }

  // 轨道单独的结果（f5 应为 (400,160)），轨迹结果必须与之不同（盖过）
  const trackOnly5 = world(chTrack, 5, rootId);
  ok(trackOnly5.x === 400 && trackOnly5.y === 160,
    `A 对照：无轨迹时 f5 根世界位走轨道 (400,160)，实得 (${trackOnly5.x},${trackOnly5.y})`);
  const traj5 = world(chTraj, 5, rootId);
  ok(traj5.x !== trackOnly5.x || traj5.y !== trackOnly5.y,
    'A f5 轨迹结果 ≠ 轨道结果（轨迹确实盖过轨道）');

  // 子树跟随：kid 在两角色间的世界位增量 == 根的世界位增量
  const dRoot = {
    x: world(chTraj, 8, rootId).x - world(chTrack, 8, rootId).x,
    y: world(chTraj, 8, rootId).y - world(chTrack, 8, rootId).y,
  };
  const dKid = {
    x: world(chTraj, 8, 'kid').x - world(chTrack, 8, 'kid').x,
    y: world(chTraj, 8, 'kid').y - world(chTrack, 8, 'kid').y,
  };
  ok(dKid.x === dRoot.x && dKid.y === dRoot.y,
    `A 子节点跟随：kid 增量 (${dKid.x},${dKid.y}) == 根增量 (${dRoot.x},${dRoot.y})`);
  const kidMove = Math.hypot(
    world(chTraj, 12, 'kid').x - world(chTraj, 0, 'kid').x,
    world(chTraj, 12, 'kid').y - world(chTraj, 0, 'kid').y,
  );
  ok(kidMove > 0, 'A 轨迹角色内 kid 世界位随帧真动（主画布能播）');
}

// ---------- B) 进包采样 ----------
const TOTAL_B = 24;

function buildCharB(mode: 'trajOnly' | 'trajPlusTrack' | 'trackOnly'): Character {
  const mk = (id: string, parentId?: string) => {
    const n = createDefaultNode(id, id);
    if (parentId) n.parentId = parentId;
    (n.transform as { variantIndex: number }).variantIndex = 6;
    return n;
  };
  const pelvis = mk('pelvis');
  const mover = mk('mover', 'pelvis');
  pelvis.children = ['mover'];
  pelvis.sockets = [{
    id: 's_m', name: 's_m', basePosition: { x: 0, y: 0 }, directionOffsets: {},
    offset3D: { x: 0, y: 0, z: 0 },
  }] as never;
  mover.attachment = { type: 'socket', parentSocketId: 's_m', plug: { x: 0, y: 0 } } as never;
  if (mode !== 'trackOnly') {
    mover.trajectory = [
      { frame: 0, x: pxToSub(0), y: pxToSub(0) },
      { frame: 12, x: pxToSub(30), y: pxToSub(-15) },
      { frame: 24, x: pxToSub(60), y: pxToSub(-30) },
    ];
  }
  if (mode !== 'trajOnly') {
    mover.tracks = {
      x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 24, value: pxToSub(-60) }] },
      y: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: 24, value: pxToSub(30) }] },
    } as Node['tracks'];
  }
  const nodes = { pelvis, mover };
  const piece = (nodeId: string) => ({
    nodeId, zIndex: 0, parametric: createDefaultParametricAppearance(),
  }) as never;
  return {
    id: 'tb', name: '轨迹进包测试',
    nodes, rootNodeId: 'pelvis', rootNodeIds: ['pelvis'],
    sprites: {},
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: { pelvis: piece('pelvis'), mover: piece('mover') },
    }],
    activeCostumeSetId: 'set1',
    direction: 6, latitude: 0,
    ikChains: [],
  } as unknown as Character;
}

type Pkg = ReturnType<typeof convertCharacterToRuntimePackage>;
const tracksPerf = (pkg: Pkg) => pkg.performances.find((p) => p.id === 'tracks');

/** 从「轨道」表演解出某部件某通道在 u 处的增量（无曲线 = 0）；与 verify-export-bake-ik 同读法 */
function deltaAt(pkg: Pkg, part: string, field: 'dxFrom' | 'dyFrom', u: number): number {
  const perf = tracksPerf(pkg);
  if (!perf) return 0;
  const nodes = (perf.graph as { nodes: Array<Record<string, unknown>> }).nodes;
  const tr = nodes.find((n) => n.type === 'transform' && n.part === part) as
    { dxFrom?: { n: string }; dyFrom?: { n: string } } | undefined;
  const ref = tr?.[field];
  if (!ref) return 0;
  const curve = nodes.find((n) => n.id === ref.n) as { points?: Array<[number, number]> } | undefined;
  const pts = curve?.points;
  if (!pts?.length) return 0;
  if (u <= pts[0][0]) return pts[0][1];
  if (u >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [u0, v0] = pts[i - 1];
      const [u1, v1] = pts[i];
      return u1 === u0 ? v1 : v0 + ((v1 - v0) * (u - u0)) / (u1 - u0);
    }
  }
  return pts[pts.length - 1][1];
}

/** 编辑器侧同式投影（与 convert 采样同一公式：projectToView + subToPx、y 取反；采样画布缺省 512） */
function editorSample(char: Character, nodeId: string, f: number) {
  const wf = computeWorldTransforms(char, f, 512, 512, FR);
  const wt = wf.get(nodeId)!;
  const dirF = wf.get('pelvis')?.variantIndex ?? 6;
  const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, dirF as never);
  return { x: subToPx(proj.canvasX), y: -subToPx(proj.canvasY) };
}

const optsB = {
  frameRate: FR, totalFrames: TOTAL_B, clips: [],
  projectData: { canvasWidth: 512, canvasHeight: 512 },
} as never;

{
  // B1：轨迹-only（全角色无任何轨道）也必须进包
  const ch = buildCharB('trajOnly');
  const pkg = convertCharacterToRuntimePackage(ch, undefined, optsB);
  ok(!!tracksPerf(pkg), 'B1 轨迹-only 角色进包产出「轨道」表演（采样块未被门控跳过）');
  const base = editorSample(ch, 'mover', 0);
  for (const f of [12, 24]) {
    const u = f / TOTAL_B;
    const pkgPos = {
      x: base.x + deltaAt(pkg, 'mover', 'dxFrom', u),
      y: base.y + deltaAt(pkg, 'mover', 'dyFrom', u),
    };
    const edPos = editorSample(ch, 'mover', f);
    const err = Math.hypot(pkgPos.x - edPos.x, pkgPos.y - edPos.y);
    ok(err <= 0.75,
      `B1 第 ${f} 帧 mover 包内位与编辑器同帧世界位对齐（误差 ${err.toFixed(3)}px，容差 0.75）`);
  }
  const endMove = Math.hypot(deltaAt(pkg, 'mover', 'dxFrom', 1), deltaAt(pkg, 'mover', 'dyFrom', 1));
  ok(endMove > 30, `B1 末帧 mover 包内真位移（|Δ|=${endMove.toFixed(1)}px，轨迹终点 (60,-30)）`);

  // B2：轨迹 + 冲突轨道 → 包内走轨迹不走轨道
  const chBoth = buildCharB('trajPlusTrack');
  const chTrackOnly = buildCharB('trackOnly');
  const pkgBoth = convertCharacterToRuntimePackage(chBoth, undefined, optsB);
  const baseB = editorSample(chBoth, 'mover', 0);
  const pkgEnd = {
    x: baseB.x + deltaAt(pkgBoth, 'mover', 'dxFrom', 1),
    y: baseB.y + deltaAt(pkgBoth, 'mover', 'dyFrom', 1),
  };
  const trajEnd = editorSample(chBoth, 'mover', 24);
  const trackEnd = editorSample(chTrackOnly, 'mover', 24);
  ok(Math.hypot(pkgEnd.x - trajEnd.x, pkgEnd.y - trajEnd.y) <= 0.75,
    'B2 包内末帧位 == 轨迹口径编辑器位（轨迹盖过轨道进包）');
  ok(Math.hypot(pkgEnd.x - trackEnd.x, pkgEnd.y - trackEnd.y) > 10,
    'B2 包内末帧位远离纯轨道口径（未被轨道带偏）');
}

console.log(`\nverify-trajectory-render: ${total - fails}/${total} 过`);
if (fails > 0) process.exit(1);
