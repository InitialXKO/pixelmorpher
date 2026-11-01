// ============================================================
// 效果轨关键帧参数探针（审计 F-05 / F-29=E1 修复验收）
//  F-05：glow/particle/afterimage/pixel_displace/motion_blur 五类
//        关键帧 params 此前在 UI 内无写入路径（建帧恒 {}、对话框
//        不能新增字段）。修复 = 参数表（lib/effect-track-params）
//        单一口径：slice 建帧按类型播种全字段缺省、对话框以缺省
//        垫底渲染全字段。本探针验：
//   A) 三方对拍：参数表 ↔ 编辑器 renderEffectTrackFrame 源码读点
//      ↔ 包内 fxRenderSet 源码读点（字段集+缺省逐项相同）；且
//      effect-render 轨路径再无 `Number(params.x) || 缺省` 残留；
//   B) 读法行为：抽出的读参数纯函数 numEffectParam /
//      colorEffectParam 在值网格上与包内 num() 语义逐值一致
//      （核心断言：0 → 0，不被缺省顶替）；
//   C) slice 播种（真 store）：六类建帧都带非空缺省 params、键集
//      与字段表一致；显式 params 不被播种覆盖；
//   D) 对话框底表纯函数 effectKeyframeEditorParams：{} 帧得全
//      字段、显式 0 保留、额外键保留、text_pop 不回归。
// 测法说明：渲染读法经「纯函数行为（B）+ 源码结构绑定（A）」
// 双路验证——renderEffectTrackFrame 本体需 Canvas 2D 上下文，
// 不在无头环境直跑；其每个读点都已改走 B 所验的纯函数，A 保证
// 读点与字段表/包内逐项对齐，无第四处手写读法。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EFFECT_PARAM_FIELDS,
  colorEffectParam,
  effectKeyframeDefaultParams,
  effectKeyframeEditorParams,
  numEffectParam,
  type OverlayEffectType,
} from '../src/lib/effect-track-params';
import { TEXT_POP_DEFAULT_PARAMS } from '../src/lib/text-pop';
import { useProjectStore } from '../src/lib/store';
import type { EffectType } from '../src/lib/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}
const FIVE: OverlayEffectType[] = ['glow', 'particle', 'afterimage', 'pixel_displace', 'motion_blur'];

function bagEq(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return false;
  return ka.every((k) => a[k] === b[k]);
}
function tableBag(type: OverlayEffectType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EFFECT_PARAM_FIELDS[type]) out[f.key] = f.defaultValue;
  return out;
}

// ---------- A) 三方对拍：字段表 ↔ 编辑器源码 ↔ 包内源码 ----------
{
  const editorSrc = readFileSync(join(ROOT, 'src/lib/engine/effect-render.ts'), 'utf8');
  const fnStart = editorSrc.indexOf('export function renderEffectTrackFrame');
  check('A0 找到 renderEffectTrackFrame', fnStart >= 0);
  const fnSrc = editorSrc.slice(fnStart);
  check('A0b 轨路径无 Number(params./String(params. 旧读法残留',
    !fnSrc.includes('Number(params.') && !fnSrc.includes('String(params.'));

  const caseSegs = fnSrc.split(/case '(\w+)':/).slice(1);
  const editorReads = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < caseSegs.length; i += 2) {
    const type = caseSegs[i], body = caseSegs[i + 1];
    const bag: Record<string, unknown> = {};
    for (const m of body.matchAll(/numEffectParam\(params, '(\w+)', ([\d.]+)\)/g)) bag[m[1]] = Number(m[2]);
    for (const m of body.matchAll(/colorEffectParam\(params, '(\w+)', '([^']+)'\)/g)) bag[m[1]] = m[2];
    editorReads.set(type, bag);
  }

  const pkgSrc = readFileSync(join(ROOT, 'src/lib/proc-runtime/runtime-template.ts'), 'utf8');
  const fxStart = pkgSrc.indexOf('function fxRenderSet');
  const fxEnd = pkgSrc.indexOf('for (const st of set.motionBlurStrokes', fxStart);
  check('A0c 找到包内 fxRenderSet 五类分支区', fxStart >= 0 && fxEnd > fxStart);
  const fxSrc = pkgSrc.slice(fxStart, fxEnd);
  const typeSegs = fxSrc.split(/tr\.type === '(\w+)'/).slice(1);
  const pkgReads = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < typeSegs.length; i += 2) {
    const type = typeSegs[i], body = typeSegs[i + 1];
    const bag: Record<string, unknown> = {};
    for (const m of body.matchAll(/num\(P\.(\w+), ([\d.]+)\)/g)) bag[m[1]] = Number(m[2]);
    for (const m of body.matchAll(/P\.color \|\| '([^']+)'/g)) bag['color'] = m[1];
    pkgReads.set(type, bag);
  }

  for (const t of FIVE) {
    const want = tableBag(t);
    check(`A[${t}] 编辑器读点字段集+缺省与参数表一致`, bagEq(editorReads.get(t) ?? {}, want),
      JSON.stringify(editorReads.get(t)));
    check(`A[${t}] 包内读点字段集+缺省与参数表一致`, bagEq(pkgReads.get(t) ?? {}, want),
      JSON.stringify(pkgReads.get(t)));
  }
}

// ---------- B) 读法行为：与包内 num() 语义逐值对拍 ----------
{
  // 包内 num() 原式（runtime-template fxRenderSet 首行）复刻为参照
  const pkgNum = (v: unknown, d: number) =>
    v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v);
  const grid: unknown[] = [0, '0', 0.5, 2, '2.5', -1, undefined, null, NaN, 'abc', '', true];
  for (const v of grid) {
    const got = numEffectParam({ x: v as never }, 'x', 7);
    const want = pkgNum(v, 7);
    check(`B numEffectParam(${JSON.stringify(v) ?? String(v)}) = ${want}`, got === want, `got ${got}`);
  }
  check('B 核心：intensity=0 读回 0 而非缺省 0.5', numEffectParam({ intensity: 0 }, 'intensity', 0.5) === 0);
  check('B 核心：rate=0 读回 0 而非缺省 10', numEffectParam({ rate: 0 }, 'rate', 10) === 0);
  check('B 核心：gravity=0 读回 0 而非缺省 0.5', numEffectParam({ gravity: 0 }, 'gravity', 0.5) === 0);
  check('B 颜色缺失回缺省（旧 String() 读法得 "undefined"）', colorEffectParam({}, 'color', '#ffff00') === '#ffff00');
  check('B 颜色空串回缺省', colorEffectParam({ color: '' }, 'color', '#ffff00') === '#ffff00');
  check('B 颜色有值原样', colorEffectParam({ color: '#123456' }, 'color', '#ffff00') === '#123456');
}

// ---------- C) slice 播种（真 store） ----------
{
  const st = useProjectStore.getState();
  const sixTypes: EffectType[] = [...FIVE, 'text_pop'];
  for (const t of sixTypes) {
    const before = new Set(useProjectStore.getState().effectTracks.map((x) => x.id));
    st.addEffectTrack(t, `probe-${t}`);
    const track = useProjectStore.getState().effectTracks.find((x) => !before.has(x.id) && x.type === t);
    check(`C[${t}] 加轨成功`, !!track);
    if (!track) continue;
    st.addEffectKeyframe(track.id, 7);
    const kf = useProjectStore.getState().effectTracks.find((x) => x.id === track.id)?.keyframes.find((k) => k.frame === 7);
    check(`C[${t}] 无参建帧 params 非空`, !!kf && Object.keys(kf.params).length > 0, JSON.stringify(kf?.params));
    if (t === 'text_pop') {
      check('C[text_pop] 播种 = TEXT_POP_DEFAULT_PARAMS（不回归）',
        !!kf && bagEq(kf.params as Record<string, unknown>, TEXT_POP_DEFAULT_PARAMS as Record<string, unknown>));
    } else {
      check(`C[${t}] 播种键集+缺省与字段表一致`,
        !!kf && bagEq(kf.params as Record<string, unknown>, tableBag(t)));
      check(`C[${t}] 播种 = effectKeyframeDefaultParams`,
        !!kf && bagEq(kf.params as Record<string, unknown>, effectKeyframeDefaultParams(t) as Record<string, unknown>));
    }
    // 显式 params：原样落袋、不被播种顶替
    st.addEffectKeyframe(track.id, 9, { intensity: 0 } as never);
    const kf9 = useProjectStore.getState().effectTracks.find((x) => x.id === track.id)?.keyframes.find((k) => k.frame === 9);
    check(`C[${t}] 显式 params 原样保留`, !!kf9 && bagEq(kf9.params as Record<string, unknown>, { intensity: 0 }),
      JSON.stringify(kf9?.params));
  }
}

// ---------- D) 对话框底表：缺省垫底 + 已有值覆盖 ----------
{
  for (const t of FIVE) {
    const fromEmpty = effectKeyframeEditorParams(t, {});
    check(`D[${t}] 存量 {} 帧得全字段缺省`, bagEq(fromEmpty as Record<string, unknown>, tableBag(t)),
      JSON.stringify(fromEmpty));
    const withZero = effectKeyframeEditorParams(t, { [EFFECT_PARAM_FIELDS[t][0].key]: 0 } as never);
    check(`D[${t}] 已有 0 值不被缺省顶替`,
      (withZero as Record<string, unknown>)[EFFECT_PARAM_FIELDS[t][0].key] === 0);
    const withExtra = effectKeyframeEditorParams(t, { custom: 'x' } as never);
    check(`D[${t}] 表外已有键保留`, (withExtra as Record<string, unknown>).custom === 'x'
      && Object.keys(withExtra).length === EFFECT_PARAM_FIELDS[t].length + 1);
  }
  const tp = effectKeyframeEditorParams('text_pop', {});
  check('D[text_pop] {} 帧得事件全字段（不回归）', bagEq(tp as Record<string, unknown>, TEXT_POP_DEFAULT_PARAMS as Record<string, unknown>));
  const tp2 = effectKeyframeEditorParams('text_pop', { text: '777' });
  check('D[text_pop] 已有值覆盖缺省', tp2.text === '777' && tp2.color === TEXT_POP_DEFAULT_PARAMS.color);
}

// ---------- E) 接线断言 ----------
{
  const sliceSrc = readFileSync(join(ROOT, 'src/lib/store/effect-slice.ts'), 'utf8');
  check('E1 slice 建帧走 effectKeyframeDefaultParams 播种', sliceSrc.includes('effectKeyframeDefaultParams(track?.type)'));
  check('E2 slice 不再有 text_pop-only 播种分支', !sliceSrc.includes("text_pop' ? { ...TEXT_POP_DEFAULT_PARAMS }"));
  const dlgSrc = readFileSync(join(ROOT, 'src/components/pixel-editor/timeline/dialogs/EffectKeyframeEditDialog.tsx'), 'utf8');
  check('E3 对话框走 effectKeyframeEditorParams 垫底', dlgSrc.includes('effectKeyframeEditorParams(effectTrack?.type, keyframe.params)'));
}

console.log(`\nverify-effect-keyframe-params: ${pass} 过 / ${fail} 败`);
if (fail > 0) {
  console.log('失败项：');
  for (const f of fails) console.log('  ✗', f);
  process.exit(1);
}
