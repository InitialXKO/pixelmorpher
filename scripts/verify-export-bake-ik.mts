// 导出选项管道 + 实时 IK 烘焙探针。
// 夹具：竖直腿（骨盆→髋→膝→踝，套索 25/75/75）+ 手臂链（肩→肘→手
// 55/55，目标蓝图含 var 节点）；骨盆 x 轨横移 48px 驱动采样。腿链
// target3D 在第 0 帧尖端位内侧（腿留弯曲余量、骨盆横移后仍可达）：
// - drop / 缺省档：采样剥链，踝样本随骨盆刚性横移 +48，且与无链基准
//   角色的「轨道」表演逐字相等；
// - bake 档：采样保留链按工程画布（800×600）求解，踝被 IK 钉在目标
//   附近（横移 ≈0），重建样本与编辑器侧 computeWorldTransforms（带
//   链、同画布）在同帧的世界位投影逐帧对齐（容差含曲线简化 0.15px）；
// - var 目标蓝图链只在 bake 档出点名 warning。
// 另源码断言三选项的 store 字段、两处调用传参、对话框三 Select 与
// useMemo 依赖落点。
import { readFileSync } from 'node:fs';
import { convertCharacterToRuntimePackage } from '../src/lib/proc-runtime/convert';
import { createDefaultParametricAppearance } from '../src/lib/proc-runtime/surfaces';
import { computeWorldTransforms } from '../src/lib/unified-render';
import {
  createDefaultNode, pxToSub, subToPx, projectToView,
  type Character, type IKChain,
} from '../src/lib/unified-types';
import type { BlueprintGraph } from '../src/lib/blueprint/ir';
import type { AnimationClip } from '../src/lib/types';

let fails = 0;
let total = 0;
const ok = (c: boolean, m: string) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const FR = 12;
const TOTAL = 24;
const CW = 800;
const CH = 600;

// ---------- 夹具 ----------
const mk = (id: string, parentId?: string) => {
  const n = createDefaultNode(id, id);
  n.id = id;
  if (parentId) n.parentId = parentId;
  (n.transform as { variantIndex: number }).variantIndex = 6;
  (n as { slot: unknown }).slot = { slotKey: id };
  return n;
};
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
const attach = (n: ReturnType<typeof mk>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};

function buildChar(withChains: boolean): Character {
  const pelvis = mk('pelvis');
  const hip = mk('hip', 'pelvis');
  const knee = mk('knee', 'hip');
  const foot = mk('foot', 'knee');
  const shoulder = mk('shoulder', 'pelvis');
  const elbow = mk('elbow', 'shoulder');
  const hand = mk('hand', 'elbow');
  pelvis.children = [hip.id, shoulder.id];
  hip.children = [knee.id]; knee.children = [foot.id];
  shoulder.children = [elbow.id]; elbow.children = [hand.id];
  pelvis.sockets = [sock('s_hip', 0, 25), sock('s_shoulder', 35, 15)] as never;
  hip.sockets = [sock('s_knee', 0, 75)] as never;
  knee.sockets = [sock('s_foot', 0, 75)] as never;
  shoulder.sockets = [sock('s_elbow', 0, 55)] as never;
  elbow.sockets = [sock('s_hand', 0, 55)] as never;
  attach(hip, 's_hip'); attach(knee, 's_knee'); attach(foot, 's_foot');
  attach(shoulder, 's_shoulder'); attach(elbow, 's_elbow'); attach(hand, 's_hand');
  pelvis.tracks = {
    x: { interpolation: 'linear', keyframes: [{ frame: 0, value: 0 }, { frame: TOTAL, value: pxToSub(48) }] },
  } as never;
  const armBlueprint: BlueprintGraph = {
    version: 1,
    nodes: [
      { id: 'v1', type: 'var', inputs: {}, params: { name: 'aimX', default: 35 }, ui: { x: 0, y: 0 } } as never,
      {
        id: 'out', type: 'transform',
        inputs: { translateX: { nodeId: 'v1' } },
        params: { translateX: 35, translateY: 180, translateZ: 0 },
        ui: { x: 0, y: 0 },
      } as never,
    ],
    outputId: 'out',
  };
  const legChain: IKChain = {
    id: 'ch_leg', name: '腿', rootNodeId: hip.id, endNodeId: foot.id,
    target: { x: 400, y: 300 }, target3D: { x: 0, y: 230, z: 0 },
    enabled: true, solver: '2bone', bendDir: 1, tipLength: 0,
  } as IKChain;
  const armChain: IKChain = {
    id: 'ch_arm', name: '手臂', rootNodeId: shoulder.id, endNodeId: hand.id,
    target: { x: 400, y: 300 }, target3D: { x: 35, y: 180, z: 0 }, targetBlueprint: armBlueprint,
    enabled: true, solver: '2bone', bendDir: 1, tipLength: 0,
  } as IKChain;
  const piece = (nodeId: string) => ({
    nodeId, zIndex: 0, parametric: createDefaultParametricAppearance(),
  }) as never;
  const nodes = { pelvis, hip, knee, foot, shoulder, elbow, hand };
  return {
    id: 'bake1', name: 'IK烘焙测试',
    nodes, rootNodeId: 'pelvis', rootNodeIds: ['pelvis'],
    sprites: {},
    costumeSets: [{
      id: 'set1', name: '默认',
      pieces: Object.fromEntries(Object.keys(nodes).map((id) => [id, piece(id)])),
    }],
    activeCostumeSetId: 'set1',
    direction: 6, latitude: 0,
    ikChains: withChains ? [legChain, armChain] : [],
  } as unknown as Character;
}

const clips = [{
  id: 'clip1', name: '片段1', puppetCharacterId: 'bake1', startFrame: 0, endFrame: TOTAL, loop: false,
}] as unknown as AnimationClip[];
const baseOpts = {
  frameRate: FR, totalFrames: TOTAL, clips,
  projectData: { canvasWidth: CW, canvasHeight: CH },
};

type Pkg = ReturnType<typeof convertCharacterToRuntimePackage>;
const tracksPerf = (pkg: Pkg) => pkg.performances.find((p) => p.id === 'tracks');

/** 从「轨道」表演解出某部件某通道在 u 处的增量（无曲线 = 0） */
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

/** 编辑器侧同式投影（与 convert 采样同一公式：projectToView + subToPx、y 取反） */
function editorSample(char: Character, f: number, w: number, h: number) {
  const wf = computeWorldTransforms(char, f, w, h, FR);
  const wt = wf.get('foot')!;
  const dirF = wf.get('pelvis')?.variantIndex ?? 6;
  const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, dirF as never);
  return { x: subToPx(proj.canvasX), y: -subToPx(proj.canvasY) };
}

// ---------- 1) 缺省 / drop 档 == 无链基准 ----------
const charChained = buildChar(true);
const charBare = buildChar(false);
const pkgBare = convertCharacterToRuntimePackage(charBare, undefined, baseOpts);
const pkgDefault = convertCharacterToRuntimePackage(charChained, undefined, baseOpts);
const pkgDrop = convertCharacterToRuntimePackage(charChained, undefined, { ...baseOpts, bake: { ik: 'drop' } });
{
  ok(JSON.stringify(tracksPerf(pkgDefault)) === JSON.stringify(tracksPerf(pkgBare)),
    '1a 缺省（不传 bake）：「轨道」表演与无链基准逐字相等');
  ok(JSON.stringify(tracksPerf(pkgDrop)) === JSON.stringify(tracksPerf(pkgBare)),
    '1b 显式 drop 档：「轨道」表演与无链基准逐字相等');
  const bareBase = editorSample(charBare, 0, 512, 512);
  const dropEndX = bareBase.x + deltaAt(pkgDrop, 'foot', 'dxFrom', 1);
  ok(Math.abs(dropEndX - (bareBase.x + 48)) < 1.5,
    `1c drop 档踝随骨盆刚性横移 +48（实得 ${dropEndX.toFixed(2)}，基准 ${bareBase.x.toFixed(2)}）`);
  ok(!pkgDefault.warnings.some((w) => w.includes('目标蓝图含变量节点')),
    '1d 缺省档不出 var 目标蓝图 warning');
  ok(!pkgDrop.warnings.some((w) => w.includes('目标蓝图含变量节点')),
    '1e drop 档不出 var 目标蓝图 warning');
}

// ---------- 2) bake 档：IK 钉住踝 + 与编辑器同帧投影对齐 ----------
const pkgBake = convertCharacterToRuntimePackage(charChained, undefined, { ...baseOpts, bake: { ik: 'bake' } });
{
  const bakeBase = editorSample(charChained, 0, CW, CH);
  for (const f of [12, TOTAL]) {
    const u = f / TOTAL;
    const pkgPos = {
      x: bakeBase.x + deltaAt(pkgBake, 'foot', 'dxFrom', u),
      y: bakeBase.y + deltaAt(pkgBake, 'foot', 'dyFrom', u),
    };
    const edPos = editorSample(charChained, f, CW, CH);
    const err = Math.hypot(pkgPos.x - edPos.x, pkgPos.y - edPos.y);
    ok(err <= 0.75,
      `2${f === 12 ? 'a' : 'b'} bake 档第 ${f} 帧踝样本与编辑器投影对齐（误差 ${err.toFixed(3)}px，容差 0.75 含曲线简化 0.15）`);
  }
  const bakeEndX = bakeBase.x + deltaAt(pkgBake, 'foot', 'dxFrom', 1);
  const bakeDrift = Math.abs(bakeEndX - bakeBase.x);
  ok(bakeDrift < 48 * 0.4,
    `2c bake 档踝被 IK 拉住、末帧横移远小于 drop 的刚性 +48（实得 ${bakeDrift.toFixed(2)}px，判别线 19.2；逐帧精确对齐见 2a/2b）`);
  ok(pkgBake.warnings.some((w) => w === '链「手臂」的目标蓝图含变量节点，烘焙按缺省值求值，可能与编辑器实时画面不同'),
    '2d bake 档 var 目标蓝图链出点名 warning（逐字）');
  ok(!pkgBake.warnings.some((w) => w.includes('链「腿」')),
    '2e 无 var 的腿链不出该 warning');
}

// ---------- 3) 源码断言：管道落点 ----------
{
  const store = readFileSync('src/lib/store/editor-store.ts', 'utf8');
  ok(store.includes('exportBakePluginChain') && store.includes('exportBakeCorrections') && store.includes('exportBakeIk'),
    '3a editor store 三选项字段在位');
  ok(store.includes('setExportBakePluginChain') && store.includes('setExportBakeCorrections') && store.includes('setExportBakeIk'),
    '3b editor store 三 setter 在位');
  const conv = readFileSync('src/lib/proc-runtime/convert.ts', 'utf8');
  ok(conv.includes("bake?: { pluginChain?: 'drop' | 'bake' | 'live'; corrections?: 'off' | 'standard' | 'extended'; ik?: 'drop' | 'bake' }"),
    '3c convert opts.bake 类型在位');
  ok(conv.includes("ik: opts?.bake?.ik ?? 'drop'") && conv.includes("pluginChain: opts?.bake?.pluginChain ?? 'drop'") && conv.includes("corrections: opts?.bake?.corrections ?? 'standard'"),
    '3d convert 缺省解析 = 现行行为（drop/standard/drop）');
  ok(conv.includes("ikChains: bakeOpts.ik === 'bake' ? character.ikChains : []"),
    '3e 剥离克隆按档保留/剥除 ikChains');
  ok(conv.includes('sampleCanvasW') && conv.includes('opts?.projectData?.canvasWidth ?? 512'),
    '3f bake 档采样画布读 projectData、回落 512');
  const dlg = readFileSync('src/components/pixel-editor/ExportDialog.tsx', 'utf8');
  ok(dlg.includes('bake: { pluginChain: exportBakePluginChain, corrections: exportBakeCorrections, ik: exportBakeIk }'),
    '3g ExportDialog 把三值组装进 opts.bake');
  ok(dlg.includes('exportBakePluginChain, exportBakeCorrections, exportBakeIk]'),
    '3h 三值进了 procPkg 的 useMemo 依赖');
  ok(dlg.includes('插件像素链') && dlg.includes('逐帧像素修正') && dlg.includes('实时 IK')
    && dlg.includes('不进包') && dlg.includes('烘焙进包') && dlg.includes('不烘焙') && dlg.includes('现行烘焙') && dlg.includes('尽力全烘'),
    '3i 导出对话框三 Select 与档位文案在位');
  const prev = readFileSync('src/components/pixel-editor/puppet/ProcPreview.tsx', 'utf8');
  ok(prev.includes('bake: { pluginChain: exportBakePluginChain, corrections: exportBakeCorrections, ik: exportBakeIk }'),
    '3j ProcPreview 同口径传 opts.bake');
  ok(prev.includes('与导出共用同一组选择'),
    '3k ProcPreview 文案注明与导出共用选择');
}

console.log(`\n共 ${total} 项，失败 ${fails}`);
process.exit(fails ? 1 : 0);
