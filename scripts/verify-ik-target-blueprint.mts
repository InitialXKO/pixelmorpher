// IK 目标蓝图探针：三缺陷回归网。
// 缺陷 1（行为）：带 targetBlueprint 的链在钳制 resettle 重解遍里，蓝图
// 输出曾照常覆盖 resettle 冻结出的目标——重解是纠正遍、必须赢。判别
// 夹具：静态目标 S、蓝图目标 B、冻结位 F 三者互不相同且都可达；常规遍
// 末端尖端取 B、resettle 遍取 F 换算的尖端目标（且不取 B）。
// 缺陷 2/3（源码）：类型注释改真实契约、编辑弹窗的输出节点校验红字与
// 全量覆盖/口径披露文案落点。
import { readFileSync } from 'node:fs';
import {
  computeWorldTransforms, solveChainIKOverrides, resettleChainOverride,
  type ClampStateMap,
} from '../src/lib/unified-render';
import {
  createDefaultNode, frameYAxisWorld, pxToSub, subToPx,
  type Character, type ClampAnchor, type IKChain,
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

// ---------- 夹具：竖直腿（髋→膝→踝，75+75），三点互异 ----------
const mk = (id: string, name: string, parentId?: string) => {
  const n = createDefaultNode(id, name);
  n.id = id;
  if (parentId) n.parentId = parentId;
  (n.transform as { variantIndex: number }).variantIndex = 6;
  return n;
};
const root = mk('tb_root', 'root');
const hip = mk('tb_hip', 'hip', root.id);
const knee = mk('tb_knee', 'knee', hip.id);
const foot = mk('tb_foot', 'foot', knee.id);
root.children = [hip.id]; hip.children = [knee.id]; knee.children = [foot.id];
const sock = (id: string, x: number, y: number) => ({
  id, name: id, basePosition: { x: 0, y: 0 }, directionOffsets: {},
  offset3D: { x: pxToSub(x), y: pxToSub(y), z: 0 },
});
root.sockets = [sock('s_hip', 0, 25)];
hip.sockets = [sock('s_knee', 0, 75)];
knee.sockets = [sock('s_foot', 0, 75)];
const attach = (n: ReturnType<typeof mk>, sid: string) => {
  n.attachment = { type: 'socket', parentSocketId: sid, plug: { x: 0, y: 0 } } as never;
};
attach(hip, 's_hip'); attach(knee, 's_knee'); attach(foot, 's_foot');

const S = { x: 90, y: 40, z: 0 };    // 静态目标（target3D）
const B = { x: -60, y: 110, z: 0 };  // 蓝图目标（输出节点参数）
const F = { x: 70, y: 120, z: 0 };   // 冻结位（锚主点 = 末关节口径）
const blueprint: BlueprintGraph = {
  version: 1,
  nodes: [
    {
      id: 'tb_out', type: 'transform', inputs: {},
      params: { translateX: B.x, translateY: B.y, translateZ: B.z },
      ui: { x: 0, y: 0 },
    } as never,
  ],
  outputId: 'tb_out',
};
const chain: IKChain = {
  id: 'ch_leg', name: '腿', rootNodeId: hip.id, endNodeId: foot.id,
  target: { x: 256, y: 256 }, target3D: { ...S }, targetBlueprint: blueprint,
  enabled: true, solver: '2bone', bendDir: 1, tipLength: 0,
} as IKChain;
const anchor: ClampAnchor = {
  id: 'aF', name: '脚锚', enabled: true, resettle: true,
  point: { kind: 'node', nodeId: foot.id },
  trigger: { kind: 'height', y: 150, side: 'below' },
} as ClampAnchor;
const character = {
  id: 'tb1', name: '目标蓝图测试',
  nodes: { [root.id]: root, [hip.id]: hip, [knee.id]: knee, [foot.id]: foot },
  rootNodeId: root.id, sprites: {},
  costumeSets: [{ id: 'cs1', name: '默认', pieces: {} }],
  activeCostumeSetId: 'cs1', direction: 6, latitude: 0,
  clampAnchors: [anchor], ikChains: [chain],
} as unknown as Character;

// 尖端口径：链无显式 tipLength、无精灵 → 求解器与 resettle 同走末段长 75
const TIP = 75;
const tipOf = (t: Map<string, unknown>, id: string) => {
  const w = t.get(id) as WT;
  const ya = frameYAxisWorld(w.worldFrame, 6);
  const j = pos(t, id);
  return { x: j.x + ya.x * TIP, y: j.y + ya.y * TIP, z: j.z + ya.z * TIP };
};
const solveWith = (ch: IKChain, fkT: Map<string, unknown>) => {
  const overrides = new Map<string, { angle: number; tilt: number }>();
  solveChainIKOverrides(character, ch, fkT as never, W, W, 0, 12, undefined, undefined, overrides, undefined);
  return computeWorldTransforms(character, 0, W, W, 12, undefined, undefined, overrides, undefined) as Map<string, unknown>;
};

const fk = computeWorldTransforms(character, 0, W, W, 12) as Map<string, unknown>;

// ---------- 1) 常规遍：蓝图目标赢静态目标 ----------
{
  const t1 = solveWith(chain, fk);
  const tip1 = tipOf(t1, foot.id);
  ok(dist(tip1, B) < 2, `1a 常规遍尖端落蓝图目标 B（距 ${dist(tip1, B).toFixed(2)}）`);
  ok(dist(tip1, S) > 30 && dist(tip1, F) > 30, '1b 常规遍不取静态目标 S、与冻结位 F 分离（夹具可判别）');
}

// ---------- 2) resettle 遍：剥离蓝图、冻结位赢 ----------
{
  const frozen: ClampStateMap = new Map([['aF', { points: [{ ...F }] }]]);
  const eff = resettleChainOverride(character, chain, frozen, fk as never, undefined);
  ok(eff.targetBlueprint === undefined, '2a resettle 有效链已剥离 targetBlueprint');
  const fkFoot = fk.get(foot.id) as WT;
  const ya = frameYAxisWorld(fkFoot.worldFrame, 6);
  const expectedTip = { x: F.x + ya.x * TIP, y: F.y + ya.y * TIP, z: F.z + ya.z * TIP };
  ok(!!eff.target3D && dist(eff.target3D, expectedTip) < 0.6,
    `2b resettle 目标 = 冻结位按当遍 frame 换算的尖端目标（距 ${eff.target3D ? dist(eff.target3D, expectedTip).toFixed(3) : 'N/A'}）`);
  const t2 = solveWith(eff, fk);
  const tip2 = tipOf(t2, foot.id);
  ok(dist(tip2, expectedTip) < 2, `2c resettle 遍尖端落冻结位换算目标（距 ${dist(tip2, expectedTip).toFixed(2)}）`);
  ok(dist(tip2, B) > 30, `2d resettle 遍不取蓝图目标 B（距 ${dist(tip2, B).toFixed(1)}；修复前蓝图覆盖时此距 ≈0）`);
}

// ---------- 3) 源码断言：注释/校验/文案落点 ----------
{
  const types = readFileSync(new URL('../src/lib/unified-types.ts', import.meta.url), 'utf8');
  ok(types.includes('三轴全量覆盖静态目标') && !types.includes('outputs {x, y} or {targetX, targetY}'),
    '3a unified-types 的 targetBlueprint 注释已改真实契约（旧 {x, y} 说法清除）');
  const editor = readFileSync(new URL('../src/components/pixel-editor/puppet/IKChainEditor.tsx', import.meta.url), 'utf8');
  ok(editor.includes('输出节点不是 transform 节点') && editor.includes('会被读作原点中心'),
    '3b 弹窗有输出节点非 transform 的红字校验提示');
  ok(editor.includes("outNode.type !== 'transform'"), '3c 校验按 outputId 指向节点的 type 判 transform');
  ok(editor.includes('三轴会全量覆盖静态目标') && editor.includes('设成静态目标的值'),
    '3d 弹窗已明示三轴全量覆盖、未连接输入取参数值（缺省 0）');
  ok(editor.includes('只在编辑器实时求解时生效') && editor.includes('不进导出包'),
    '3e 弹窗已披露：仅实时求解生效、烘焙接管时失效、不进导出包');
  const render = readFileSync(new URL('../src/lib/unified-render.ts', import.meta.url), 'utf8');
  const rs = render.slice(render.indexOf('export function resettleChainOverride'), render.indexOf('export interface ClampPassResult'));
  ok((rs.match(/targetBlueprint: undefined/g) ?? []).length >= 2,
    '3f resettleChainOverride 两个返回点都剥离 targetBlueprint');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
