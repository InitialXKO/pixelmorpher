// ============================================================
// D6 乙路步骤 4：convert 发包探针。夹具角色带一条 realtime 链
// （且留有烘焙档案+烘焙角轨）与一条 bake 链（烘焙角轨），断言：
// ① chains 条目齐全，数值与手算（computeWorldTransforms 平结算 +
// projectToView 同式）一致；② bake 链的烘焙摆幅进包内位姿、
// realtime 链的烘焙注入被剥离；③ simMode='frame' 写入；④ 无实时
// 链时 chains 缺省、位姿与旧行为一致；⑤ 包体积增量实测打印。
// 跑法：bun scripts/verify-sim-convert.mts
// ============================================================
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { computeWorldTransforms } from '../src/lib/unified-render';
import { defaultChainBakeParams } from '../src/lib/sim/verlet-chain';
import {
  pxToSub, subToPx, projectToView,
  type Character, type Node as UnifiedNode,
} from '../src/lib/unified-types';
import type { AnimationClip } from '../src/lib/types';

let fails = 0;
let total = 0;
const ok = (c: boolean, m: string) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

const FR = 12;
const TOTAL = 30;

function makeNode(id: string, parentId?: string, yOff = 0): UnifiedNode {
  return {
    id, name: id, parentId, role: 'bone',
    slot: { slotKey: id },
    transform: { x: 0, y: pxToSub(yOff), angle: 0, variantIndex: 6, stretch: 1 },
    attachment: { type: 'fixed' }, sockets: [], tracks: {}, modifiers: [],
    children: [], sprite: undefined as never,
  } as unknown as UnifiedNode;
}

const angleTrack = (kvs: Array<[number, number]>) => ({
  interpolation: 'linear' as const,
  keyframes: kvs.map(([frame, value]) => ({ frame, value })),
});

function buildChar(rtMode: 'realtime' | 'bake'): Character {
  const torso = makeNode('torso');
  const ra = makeNode('ra', 'torso', 20);
  const rb = makeNode('rb', 'ra', 18);
  const rc = makeNode('rc', 'rb', 16);
  const ba = makeNode('ba', 'torso', 24);
  const bb = makeNode('bb', 'ba', 15);
  torso.children = ['ra', 'ba']; ra.children = ['rb']; rb.children = ['rc'];
  ba.children = ['bb'];
  // 根横移驱动（保证轨道采样有内容）
  torso.tracks = {
    x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: TOTAL, value: pxToSub(60) }] },
  } as never;
  // 两条链都留「烘焙写回」的角轨：rb/bb 在窗内有摆幅关键帧，
  // 基准本地角均为 0（档案 baseLocals）
  rb.tracks = { angle: angleTrack([[0, 0], [15, 40], [TOTAL, 0]]) } as never;
  bb.tracks = { angle: angleTrack([[0, 0], [15, 35], [TOTAL, 0]]) } as never;
  const piece = (nodeId: string) => ({
    nodeId, zIndex: 0, parametric: createDefaultParametricAppearance(),
  }) as never;
  const params = defaultChainBakeParams();
  const ch = {
    id: 'sc1', name: '实时链转换测试',
    nodes: { torso, ra, rb, rc, ba, bb },
    rootNodeId: 'torso', rootNodeIds: ['torso'],
    sprites: {},
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: { torso: piece('torso'), ra: piece('ra'), rb: piece('rb'), rc: piece('rc'), ba: piece('ba'), bb: piece('bb') },
    }],
    activeCostumeSetId: 'set1',
    variants: { '0': '东', '2': '西' },
    chainSims: { ra: { chainNodeIds: ['ra', 'rb', 'rc'], params } },
    chainModes: { ra: rtMode },
    chainBakes: {
      ra: { fingerprint: 'x', fromFrame: 0, toFrame: TOTAL, params, chainNodeIds: ['ra', 'rb', 'rc'], baseLocals: [0, 0, 0] },
      ba: { fingerprint: 'y', fromFrame: 0, toFrame: TOTAL, params, chainNodeIds: ['ba', 'bb'], baseLocals: [0, 0] },
    },
  } as unknown as Character;
  return ch;
}

const clips = [{
  id: 'clip1', name: '片段1', puppetCharacterId: 'sc1', startFrame: 0, endFrame: TOTAL, loop: false,
}] as unknown as AnimationClip[];
const opts = { frameRate: FR, totalFrames: TOTAL, clips };

type Pkg = ReturnType<typeof convertCharacterToRuntimePackage>;

/** 取某表演里某部件的 angleFrom 曲线最大绝对值（无曲线 → null） */
function angleAmp(pkg: Pkg, perfId: string, part: string): number | null {
  const perf = pkg.performances.find((p) => p.id === perfId);
  if (!perf) return null;
  const nodes = (perf.graph as { nodes: Array<Record<string, unknown>> }).nodes;
  const tr = nodes.find((n) => n.type === 'transform' && n.part === part) as { angleFrom?: { n: string } } | undefined;
  if (!tr?.angleFrom) return null;
  const curve = nodes.find((n) => n.id === tr.angleFrom!.n) as { points?: Array<[number, number]> } | undefined;
  if (!curve?.points?.length) return null;
  return Math.max(...curve.points.map((p) => Math.abs(p[1])));
}

// ---------- ① chains 条目与手算一致 ----------
const charRt = buildChar('realtime');
const pkgRt = convertCharacterToRuntimePackage(charRt, undefined, opts);
{
  ok(Array.isArray(pkgRt.chains) && pkgRt.chains.length === 1, '①a chains 恰一条（bake 链不入）');
  const c = pkgRt.chains![0];
  ok(c.nodeId === 'ra' && c.root === 'ra' && c.chainNodeIds.join(',') === 'ra,rb,rc'
    && c.nodes.join(',') === 'ra,rb,rc', '①b 条目身份：nodeId/root/nodes/chainNodeIds');
  ok(c.params.gravity === 980 && c.params.damping === 0.02 && c.params.iterations === 8, '①c params 与定义一致');
  ok(c.initState.frame === 0, '①d initState.frame = 0（全程窗首帧锚点）');
  // 手算：帧 0 平结算 + projectToView（与 convert 同式）
  const map = computeWorldTransforms(charRt, 0, 800, 800, FR);
  const dirF = map.get('torso')?.variantIndex ?? 0;
  const exp = ['ra', 'rb', 'rc'].map((id) => {
    const w = map.get(id)!;
    const proj = projectToView(w.worldX, w.worldY, w.worldZ, dirF as never);
    return [subToPx(proj.canvasX), -subToPx(proj.canvasY)];
  });
  const jointsOk = c.initState.joints.every((j, i) => near(j[0], exp[i][0]) && near(j[1], exp[i][1]));
  ok(jointsOk, `①e joints 与手算一致（${JSON.stringify(c.initState.joints)} vs ${JSON.stringify(exp.map((e) => e.map((v) => Math.round(v * 100) / 100)))}）`);
  const lensOk = c.restLengths.every((L, i) =>
    near(L, Math.hypot(exp[i + 1][0] - exp[i][0], exp[i + 1][1] - exp[i][1])));
  ok(lensOk && c.restLengths.length === 2, `①f restLengths = 相邻关节距（${c.restLengths.join(', ')}）`);
  const angOk = c.initState.angles.every((a, i) => {
    const w = map.get(['ra', 'rb', 'rc'][i])!;
    return near(a, -w.worldAngle * Math.PI / 180);
  });
  ok(angOk, '①g angles = 帧 0 世界角（运行时弧度）');
  ok(c.baseAngles.length === 3 && c.baseAngles.every((a) => near(a, 0)), '①h baseAngles = 档案基准本地角（全 0）');
}

// ---------- ② 烘焙注入：bake 链在、realtime 链剥离 ----------
{
  const ampBb = angleAmp(pkgRt, 'tracks', 'bb');
  ok(ampBb !== null && ampBb > 0.3, `②a bake 链 bb 的烘焙摆幅进包内位姿（angleFrom 幅值 ${ampBb?.toFixed(3)} rad）`);
  const ampRb = angleAmp(pkgRt, 'tracks', 'rb');
  ok(ampRb === null || ampRb < 1e-6, `②b realtime 链 rb 的烘焙注入已剥离（angleFrom ${ampRb === null ? '无曲线' : `幅值 ${ampRb}`})`);
  ok(pkgRt.warnings.some((w) => w.includes('烘焙角轨已从包内位姿剥离')), '②c 剥离有警告点名');
}

// ---------- ③ simMode ----------
ok(pkgRt.simMode === 'frame', "③ 包顶层 simMode = 'frame'");

// ---------- ④ 无实时链：chains 缺省、位姿旧行为 ----------
const charBk = buildChar('bake');
const pkgBk = convertCharacterToRuntimePackage(charBk, undefined, opts);
{
  ok(pkgBk.chains === undefined, '④a 无实时链时 chains 缺省');
  const ampRb = angleAmp(pkgBk, 'tracks', 'rb');
  ok(ampRb !== null && ampRb > 0.3, `④b 链改回烘焙模式后 rb 烘焙摆幅照常进包（幅值 ${ampRb?.toFixed(3)} rad）`);
  ok(pkgBk.simMode === 'frame', "④c simMode 仍写入 'frame'（玩家缺省口径）");
}

// ---------- ⑤ 包体积增量（干净对照：两包只差 chains 定义本身——
// 无烘焙档案、无链上 angle 轨，剥离不发生） ----------
{
  const clean = (withSim: boolean) => {
    const ch = buildChar('realtime');
    delete (ch as { chainBakes?: unknown }).chainBakes;
    ch.nodes.rb.tracks = {} as never;
    ch.nodes.bb.tracks = {} as never;
    if (!withSim) {
      (ch as { chainSims?: unknown }).chainSims = {};
      (ch as { chainModes?: unknown }).chainModes = {};
    }
    return convertCharacterToRuntimePackage(ch, undefined, opts);
  };
  const sizeRt = JSON.stringify(clean(true)).length;
  const sizeBk = JSON.stringify(clean(false)).length;
  console.log(`    [⑤] 带一条实时链 ${sizeRt} B vs 同角色无实时链 ${sizeBk} B，增量 ${sizeRt - sizeBk} B`);
  ok(sizeRt > sizeBk && sizeRt - sizeBk < 1500, '⑤ 体积增量为一条链定义量级（<1.5KB）');
  // 旁注：主夹具里 realtime 包反而更小——剥离掉的烘焙曲线（rb 摆幅
  // 曲线）比链定义本身大（见 ①/② 两包原始尺寸）
  console.log(`    [⑤旁注] 主夹具 realtime 包 ${JSON.stringify(pkgRt).length} B vs bake 包 ${JSON.stringify(pkgBk).length} B（剥离烘焙曲线后净减）`);
}

console.log(fails === 0 ? `\n全部 ${total} 条断言通过` : `\n${fails}/${total} 条断言失败`);
process.exit(fails === 0 ? 0 : 1);
