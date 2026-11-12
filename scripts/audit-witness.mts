// 几何出处审计（防漏一号 + 四号关）：
//  ① 每份被消费的几何记录须带出处（样本 + 部位），无出处自动进
//     嫌疑名单；② 共用缺省被多族共用时，出处必须覆盖每一个使用
//     族的自家样本（共用出处不顶数）；③ 未被任何头规格消费的条
//     目只列“未消费”，不算嫌疑。④ 规格覆盖的几何记录须带出处
//     （角色/色调覆写走展开继承；点列与元组覆盖的出处记在
//     HeadSpec.witness 表里）。
// 用法：bun scripts/audit-witness.mts；有嫌疑或四号违规 → exit 1。
import { HEAD_GEOM, FIN_GEOM_STD, HORN_GEOM_STD, ANT_GEOM_STD, FACE_DESCENT_STD } from '../src/lib/mecha/head-geom.ts';
import { mechaHeadSpecOf } from '../src/lib/mecha/parts.ts';
import { libraryIndexOf, BUILTIN_ENTRIES, mechaDefOf } from '../src/lib/library-entries.ts';
import { HEAD_VERDICTS } from './head-verdicts.ts';

// 族样本池（四号关的“自家样本”）：出处里须出现该族池里的样本名
const FAMILY_SAMPLES: Record<string, string[]> = {
  olive: ['mecha-side'],
  agile: ['mecha-agile-side', 'ann-h2', 'ann-g3'],
  powersuit: ['powersuit-side', 'ann-g1', 'ann-k4'],
};
// 判定表 src → 几何键（gate-4 的“使用族”由此取）
const SRC_TO_KEY: Record<string, string> = {
  base: 'base', dome: 'dome', shellStep: 'shellStep', shellSeams: 'shellSeams',
  cheek: 'cheek', cheekLines: 'cheekLines', cheekPlate: 'cheekPlate', cheekPlateF: 'cheekPlateF',
  cheekSeam: 'cheekSeam', maskPlate: 'maskPlate', maskLines: 'maskLines', jawPlate: 'jawPlate',
  templeBolt: 'templeBolt', templeDisc: 'templeDisc', respTube: 'respTube', respMouth: 'respMouth',
  breatherPipe: 'breatherPipe', breatherTip: 'breatherTip', jawBlock: 'jawBlock', jawSmall: 'jawSmall',
  jawWedge: 'jawWedge', earGrille: 'earGrille', earSensor: 'earSensor', earPlateStripe: 'earPlateStripe',
  earCover: 'earCover', earDisc: 'earDisc', earPlate: 'earPlate', brow: 'brow', finBase: 'finBase',
  cheekRibbon: 'cheekRibbon', descent: 'FACE_DESCENT_STD', 'wing:horn': 'HORN_GEOM_STD',
  'wing:main': 'FIN_GEOM_STD', 'wing:rear': 'FIN_GEOM_STD',
  ribbon: 'cheekRibbon', // ribbon 步读 cheekRibbon 入参（src 是算子名、键是数据名）
};
// 须带出处的几何记录键（HEAD_GEOM 内；标量档位与画法档位不在此列）
const RECORD_KEYS = ['base', 'shellStep', 'shellSeams', 'dome', 'crownSteps', 'brow', 'finBase',
  'cheek', 'cheekLines', 'cheekPlate', 'cheekPlateF', 'cheekSeam', 'maskPlate', 'maskLines',
  'jawPlate', 'templeBolt', 'templeDisc', 'respTube', 'respMouth', 'breatherPipe', 'breatherTip',
  'jawBlock', 'jawSmall', 'jawWedge', 'earGrille', 'earSensor', 'earPlateStripe', 'earCover',
  'earDisc', 'earPlate', 'antThin', 'antBase', 'cheekRibbon'];

const witnessOf = (v: unknown): string | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) return (v as any[]).find((e) => e?.witness)?.witness;
  return (v as any).witness;
};
// 使用族：判定表里该键出现过的族
const usersOf = (key: string): string[] => {
  const fams = new Set<string>();
  for (const k of Object.keys(HEAD_VERDICTS)) {
    const [fam, src] = k.split(/:(.+)/).filter(Boolean);
    if (SRC_TO_KEY[src] === key) fams.add(fam);
  }
  return [...fams].sort();
};

let suspect: string[] = [], gate4: string[] = [], unconsumed: string[] = [];
const G = HEAD_GEOM as Record<string, unknown>;
for (const key of RECORD_KEYS) {
  const w = witnessOf(G[key]);
  const users = usersOf(key);
  if (users.length === 0) { unconsumed.push(`${key}（未消费）`); continue; }
  if (!w) { suspect.push(`${key}（${users.join('/')} 在用，无出处）`); continue; }
  const missing = users.filter((f) => !(FAMILY_SAMPLES[f] ?? []).some((s) => w.includes(s)));
  if (missing.length > 0) gate4.push(`${key}：出处只覆盖 ${w}，缺 ${missing.join('/')} 自家样本`);
}
// 标准档（派生组合亦用）：出处只核对已知的族内使用，派生组合的刃用标准档另记待核
const stds: [string, unknown, string[]][] = [
  ['FIN_GEOM_STD.main', FIN_GEOM_STD.main, ['agile']],
  ['FIN_GEOM_STD.rear', FIN_GEOM_STD.rear, ['agile']],
  ['HORN_GEOM_STD', HORN_GEOM_STD, ['olive']],
  ['ANT_GEOM_STD', ANT_GEOM_STD, ['olive']],
  ['FACE_DESCENT_STD', FACE_DESCENT_STD, ['olive']],
];
for (const [name, rec, fams] of stds) {
  const w = witnessOf(rec);
  if (!w) { suspect.push(`${name}（标准档，无出处）`); continue; }
  const missing = fams.filter((f) => !(FAMILY_SAMPLES[f] ?? []).some((s) => w.includes(s)));
  if (missing.length > 0) gate4.push(`${name}：出处缺 ${missing.join('/')} 自家样本`);
}
// 规格覆盖：几何记录须带出处（展开继承），点列与元组覆盖看 witness 表
const specProblems: string[] = [];
const index = libraryIndexOf(BUILTIN_ENTRIES);
const checkSpec = (label: string, spec: any) => {
  for (const [k, v] of Object.entries(spec.geom ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !witnessOf(v)) specProblems.push(`${label} geom.${k} 覆盖无出处`);
  }
  for (const k of ['finGeom', 'hornGeom', 'finBaseGeom'] as const) {
    const o = spec[k];
    if (!o) continue;
    for (const [sub, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !witnessOf(v)) specProblems.push(`${label} ${k}.${sub} 覆盖无出处`);
    }
    if (typeof o === 'object' && 'witness' in o && !o.witness) specProblems.push(`${label} ${k} 覆盖无出处`);
  }
  for (const k of ['visorPts', 'breatherPts', 'fairingPts', 'faceDescent', 'echoSecond']) {
    if (spec[k] !== undefined && !(spec.witness ?? {})[k]) specProblems.push(`${label} ${k} 点列/元组覆盖无出处（记 HeadSpec.witness）`);
  }
};
for (const fam of ['olive', 'agile', 'powersuit'] as const) checkSpec(`族 ${fam}`, mechaHeadSpecOf(fam));
{
  const def = (mechaDefOf(index, 'mecha-head-agile-finbrow', 1) as any).def;
  checkSpec('眉鳍条目', { ...mechaHeadSpecOf('agile'), ...(def.overrides?.head ?? {}) });
}

console.log('—— 嫌疑名单（被消费、无出处）——');
console.log(suspect.length ? suspect.map((s) => '  ✗ ' + s).join('\n') : '  （空）');
console.log('—— 四号违规（共用出处不顶数）——');
console.log(gate4.length ? gate4.map((s) => '  ✗ ' + s).join('\n') : '  （空）');
console.log('—— 未消费（只列、不算嫌疑）——');
console.log(unconsumed.length ? unconsumed.map((s) => '  - ' + s).join('\n') : '  （空）');
console.log('—— 规格覆盖问题 ——');
console.log(specProblems.length ? specProblems.map((s) => '  ✗ ' + s).join('\n') : '  （空）');
console.log('—— 待核（机制外、须人工核）——');
console.log('  - FIN_GEOM_STD 主/后鳍标准档亦被派生组合（agile-mech/ps-blade 的刃）所用：ps-blade 属动力服族，powersuit-side 有无刃见证未核');
console.log('  - 点列缺省（crestStd/fairingStd/visorStd/breatherStd）与元组（respAnchor/respTip/blockTip）：现均被规格覆盖、未消费；一旦启用须先补出处');
if (suspect.length > 0 || gate4.length > 0 || specProblems.length > 0) {
  console.log('审计不通过：先补出处再关轮。');
  process.exit(1);
}
console.log('审计通过。');
