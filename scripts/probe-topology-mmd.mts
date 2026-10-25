/**
 * 探针：MMD 骨架的拓扑识别 + 名字回退合并（纯函数层，走真实消费函数）
 * 夹具按 reze 实测几何缩比：上半身2 原点比肩线靠后 0.8（两肩相对它的
 * XZ 向量余弦 +0.63，原点配对判定必败）——链方向兜底必须把十字找出来；
 * 下半身是十字的叔叔节点（不在祖先链上），髋部全局扫必须命中。
 * 另验名字回退：日文手指/脚趾并入手首/足首、左足（大腿）不被误并；
 * 以及手动合并（并入父链）的闭包语义。
 */
import { analyzeTopology, type TopoBone } from '../src/lib/bake/bone-topology.ts';
import { computeBoneMerge, computeTopologyMerge } from '../src/lib/bake/threejs-baker-twopass.ts';

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

// ---- 骨架夹具：[名字, 父名, x, y, z]（父名解析为索引）----
type B = [string, string | null, number, number, number];
const defs: B[] = [
  ['センター', null, 0, 13.0, -1.0],
  ['腰', 'センター', 0, 13.2, -1.0],
  ['上半身', '腰', 0, 13.75, -0.96],
  ['下半身', '腰', 0, 13.7, -0.99],
  ['上半身2', '上半身', 0, 15.01, -0.99],
  ['首', '上半身2', 0, 17.65, -0.12],
  ['頭', '首', 0, 18.66, -0.1],
  ['髪1', '頭', 0.3, 18.2, -0.5],
  ['髪2', '頭', -0.3, 18.2, -0.5],
  ['右肩P', '上半身2', -0.43, 17.36, -0.22],
  ['右肩', '右肩P', -0.43, 17.36, -0.22],
  ['右腕', '右肩', -1.45, 17.1, -0.21],
  ['右腕捩1', '右腕', -1.9, 16.9, -0.18],
  ['右腕捩2', '右腕捩1', -2.3, 16.2, -0.14],
  ['右ひじ', '右腕捩2', -2.6, 15.12, -0.1],
  ['右手首', '右ひじ', -3.6, 13.44, 0.0],
  ['左肩P', '上半身2', 0.32, 17.4, -0.2],
  ['左肩', '左肩P', 0.32, 17.4, -0.2],
  ['左腕', '左肩', 1.4, 17.14, -0.19],
  ['左腕捩1', '左腕', 1.85, 16.95, -0.16],
  ['左腕捩2', '左腕捩1', 2.25, 16.25, -0.12],
  ['左ひじ', '左腕捩2', 2.55, 15.15, -0.08],
  ['左手首', '左ひじ', 3.55, 13.47, 0.02],
  ['腰キャンセル右', '下半身', -0.98, 11.78, -0.6],
  ['右足', '腰キャンセル右', -1.05, 11.7, -0.55],
  ['右ひざ', '右足', -1.1, 6.5, -0.4],
  ['右足首', '右ひざ', -1.15, 1.2, -0.3],
  ['腰キャンセル左', '下半身', 0.98, 11.78, -0.6],
  ['左足', '腰キャンセル左', 1.05, 11.7, -0.55],
  ['左ひざ', '左足', 1.1, 6.5, -0.4],
  ['左足首', '左ひざ', 1.15, 1.2, -0.3],
];
const idxOf = (nm: string) => defs.findIndex((d) => d[0] === nm);
function addFinger(handName: string, side: '右' | '左', fname: string, dx: number) {
  const h = defs[idxOf(handName)];
  let parent = handName;
  for (let s = 0; s < 3; s++) {
    const nm = `${side}${fname}${s}`;
    defs.push([nm, parent, h[2] + dx * (s + 1) * 0.3, h[3] - 0.25 * (s + 1), h[4] + 0.1 * s]);
    parent = nm;
  }
}
addFinger('右手首', '右', '親指', -1);
addFinger('右手首', '右', '人指', -1);
addFinger('右手首', '右', '中指', -1);
addFinger('左手首', '左', '親指', 1);
addFinger('左手首', '左', '人指', 1);
addFinger('左手首', '左', '中指', 1);

const parents = defs.map((d) => (d[1] === null ? null : idxOf(d[1])));
const names = defs.map((d) => d[0]);
const topoBones: TopoBone[] = defs.map(([name, , x, y, z], i) => ({
  index: i, name, parentIndex: parents[i],
  worldPos: { x, y, z }, weightSum: 10,
}));
const topo = analyzeTopology(topoBones);
check('十字 = 上半身2（链方向兜底）', topo.cross === idxOf('上半身2'), `cross=${topo.cross !== null ? names[topo.cross] : 'null'}；${topo.notes.join(' ; ')}`);
check('髋部 = 下半身（叔叔节点全局扫）', topo.hipFork === idxOf('下半身'), `hipFork=${topo.hipFork !== null ? names[topo.hipFork] : 'null'}`);
check('双手找到手掌', topo.handL === idxOf('左手首') && topo.handR === idxOf('右手首'));
check('手指链 L/R 各 3 条', topo.fingersL.length === 3 && topo.fingersR.length === 3, `L=${topo.fingersL.length} R=${topo.fingersR.length}`);
check('腿部件非空', topo.boneToPart[idxOf('右足首')] === 'legR' && topo.boneToPart[idxOf('左足')] === 'legL',
  `右足首→${topo.boneToPart[idxOf('右足首')]} 左足→${topo.boneToPart[idxOf('左足')]}`);

const tm = computeTopologyMerge(topo, names, parents);
const fingerIdxs = names.map((nm, i) => [nm, i] as const).filter(([nm]) => /指/.test(nm));
check('拓扑合并：全部手指并入手首', fingerIdxs.every(([nm, i]) => names[tm.effectiveIndex[i]] === (nm.startsWith('左') ? '左手首' : '右手首')),
  `有效骨骼 ${tm.effectiveBones.length}`);

// 名字回退（拓扑失败时）：日文手指并手首、脚趾并足首、大腿不误并
const nm2 = ['左手首', '左親指０', '左親指１', '左人指１', '左足首', '左つま先', '左足', '左ひざ'];
const pa2: (number | null)[] = [null, 0, 1, 0, null, 4, null, 6];
const vc2 = [100, 30, 20, 25, 80, 10, 200, 150];
const fb = computeBoneMerge(nm2, pa2, vc2, 'coarse', 50);
check('回退：親指/人指并入左手首', [1, 2, 3].every((i) => fb.effectiveIndex[i] === 0));
check('回退：つま先并入左足首', fb.effectiveIndex[5] === 4);
check('回退：左足/左ひざ保持独立', fb.effectiveIndex[6] === 6 && fb.effectiveIndex[7] === 7);

// 手动合并通路（丙的引擎侧）：手指并入父链 → 闭包到手首
const mm = new Map<number, number>([[1, 0], [2, 1], [3, 0]]);
const withManual = computeBoneMerge(nm2, pa2, vc2, 'coarse', 50, mm);
check('手动合并：親指１经父链闭包到手首', withManual.effectiveIndex[2] === 0 && /手动/.test(withManual.reasons[2] ?? ''));

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
