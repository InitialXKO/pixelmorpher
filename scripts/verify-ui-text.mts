// ============================================================
// 飘字轨（text_pop）探针：
//  1) 字表完整性：每字形 7 行 × 5 列 0/1 串；字符集覆盖
//     A-Z / 0-9 / 常用符号 / 空格；非空字形必有墨点。
//  2) 度量与光栅：宽度公式、墨点计数与回落（小写→大写、未知→?）。
//  3) 包络关键点：砸入过冲峰值/衰减、升起位移、淡入淡出端点。
//  4) 两端对拍：从 runtime-template.ts 抽出包内孪生（字表 +
//     fxTextPopEnvelope + fxMeasureTextPop）真求值，与编辑器
//     lib/text-pop.ts 在参数网格上逐值比对。
//  5) 事件存取往返：缺省播种、部分 params 规范化、
//     JSON 往返（存盘/读盘形态）后规范化结果稳定。
//  6) 接线断言：EffectType / EFFECT_CONFIG / 编辑器与包内分支齐备。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEXT_POP_DEFAULT_PARAMS,
  TEXT_POP_FONT_H,
  TEXT_POP_FONT_W,
  TEXT_POP_GLYPHS,
  measureTextPopUnits,
  normalizeTextPopEvent,
  rasterTextPop,
  textPopEnvelope,
} from '../src/lib/text-pop';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- 1) 字表完整性 ----------
const REQUIRED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-!?. ,:/%*()<>=#\'';
for (const [ch, rows] of Object.entries(TEXT_POP_GLYPHS)) {
  check(`字形 ${JSON.stringify(ch)} 恰 ${TEXT_POP_FONT_H} 行`, rows.length === TEXT_POP_FONT_H);
  check(
    `字形 ${JSON.stringify(ch)} 每行恰 ${TEXT_POP_FONT_W} 列 0/1`,
    rows.every((r) => r.length === TEXT_POP_FONT_W && /^[01]+$/.test(r)),
  );
  const ink = rows.join('').split('').filter((c) => c === '1').length;
  if (ch === ' ') check('空格字形无墨点', ink === 0);
  else check(`字形 ${JSON.stringify(ch)} 有墨点`, ink > 0);
}
for (const ch of REQUIRED) {
  check(`字符集覆盖 ${JSON.stringify(ch)}`, ch in TEXT_POP_GLYPHS);
}

// ---------- 2) 度量与光栅 ----------
check('空串宽度 0', measureTextPopUnits('') === 0);
check('单字宽度 5', measureTextPopUnits('1') === 5);
check('"100" 宽度 17', measureTextPopUnits('100') === 17);
check('"CRIT" 宽度 23', measureTextPopUnits('CRIT') === 23);
check('"-" 墨点 3', rasterTextPop('-').length === 3);
check('"1" 墨点 10', rasterTextPop('1').length === 10);
check(
  '光栅点全在界内',
  rasterTextPop('HELLO 42!').every(
    (p) => p.x >= 0 && p.x < measureTextPopUnits('HELLO 42!') && p.y >= 0 && p.y < TEXT_POP_FONT_H,
  ),
);
check(
  '小写回落大写',
  JSON.stringify(rasterTextPop('a')) === JSON.stringify(rasterTextPop('A')),
);
check(
  '未知字符回落 ?',
  JSON.stringify(rasterTextPop('~')) === JSON.stringify(rasterTextPop('?')),
);

// ---------- 3) 包络关键点 ----------
const D = { durationSec: 0.9, risePx: 18, slam: true };
check('t<0 不活跃', !textPopEnvelope(-0.01, D).active);
check('t=duration 不活跃', !textPopEnvelope(0.9, D).active);
check('t 接近 duration 仍活跃', textPopEnvelope(0.899, D).active);
check('砸入峰值 scaleMul=2.1（t=0）', near(textPopEnvelope(0, D).scaleMul, 2.1));
check('砸入段末 scaleMul=1（t=0.14）', near(textPopEnvelope(0.14, D).scaleMul, 1));
check('无砸入峰值 scaleMul=1.35', near(textPopEnvelope(0, { ...D, slam: false }).scaleMul, 1.35));
check('无砸入段末 scaleMul=1（t=0.07）', near(textPopEnvelope(0.07, { ...D, slam: false }).scaleMul, 1));
{
  let mono = true;
  let prev = Infinity;
  for (let t = 0; t <= 0.14; t += 0.01) {
    const s = textPopEnvelope(t, D).scaleMul;
    if (s > prev + 1e-12) mono = false;
    prev = s;
  }
  check('砸入段 scaleMul 单调衰减', mono);
}
check('升起 t=0 为 0', near(textPopEnvelope(0, D).riseNow, 0));
check('升起 70% 时程升满', near(textPopEnvelope(0.63, D).riseNow, 18));
check('升起升满后保持', near(textPopEnvelope(0.85, D).riseNow, 18));
check('alpha t=0 为 0（淡入起点）', near(textPopEnvelope(0, D).alpha, 0));
check('alpha 淡入完成 = 1（t=0.03）', near(textPopEnvelope(0.03, D).alpha, 1));
check('alpha 淡出起点仍 = 1（t=0.54）', near(textPopEnvelope(0.54, D).alpha, 1));
check('alpha 淡出中点 = 0.5（t=0.72）', near(textPopEnvelope(0.72, D).alpha, 0.5, 1e-6));

// ---------- 4) 两端对拍（抽包内孪生真求值） ----------
const tplSrc = readFileSync(join(ROOT, 'src/lib/proc-runtime/runtime-template.ts'), 'utf8');
function extractFn(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('未找到 ' + header);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('括号不配平 ' + header);
}
const glyphStart = tplSrc.indexOf('const FX_TEXT_POP_GLYPHS');
check('包内字表存在', glyphStart >= 0);
const glyphEnd = tplSrc.indexOf('};', glyphStart) + 2;
const twinCode =
  tplSrc.slice(glyphStart, glyphEnd) +
  '\n' +
  extractFn(tplSrc, 'function fxMeasureTextPop') +
  '\n' +
  extractFn(tplSrc, 'function fxTextPopEnvelope') +
  '\nreturn { FX_TEXT_POP_GLYPHS, fxMeasureTextPop, fxTextPopEnvelope };';
const twin = new Function(twinCode)() as {
  FX_TEXT_POP_GLYPHS: Record<string, number[]>;
  fxMeasureTextPop: (t: string) => number;
  fxTextPopEnvelope: (
    t: number,
    d: number,
    r: number,
    s: boolean,
  ) => { active: boolean; scaleMul: number; riseNow: number; alpha: number };
};
// 字表逐字逐行对拍
{
  let same = true;
  const chars = new Set([...Object.keys(TEXT_POP_GLYPHS), ...Object.keys(twin.FX_TEXT_POP_GLYPHS)]);
  for (const ch of chars) {
    const ed = TEXT_POP_GLYPHS[ch];
    const pk = twin.FX_TEXT_POP_GLYPHS[ch];
    if (!ed || !pk || pk.length !== TEXT_POP_FONT_H) { same = false; break; }
    for (let row = 0; row < TEXT_POP_FONT_H && same; row++) {
      for (let col = 0; col < TEXT_POP_FONT_W; col++) {
        const bit = (pk[row]! >> (TEXT_POP_FONT_W - 1 - col)) & 1;
        if ((ed[row]![col] === '1' ? 1 : 0) !== bit) { same = false; break; }
      }
    }
    if (!same) break;
  }
  check('包内字表与编辑器字表逐位一致', same);
}
for (const s of ['', '1', '100', 'CRIT!', 'HELLO 42', '-27']) {
  check(`度量对拍 ${JSON.stringify(s)}`, twin.fxMeasureTextPop(s) === measureTextPopUnits(s));
}
{
  let same = true;
  let worst = '';
  for (const durationSec of [0.9, 0.4, 2]) {
    for (const slam of [true, false]) {
      for (let t = -0.1; t <= durationSec + 0.1; t += 0.01) {
        const a = textPopEnvelope(t, { durationSec, risePx: 18, slam });
        const b = twin.fxTextPopEnvelope(t, durationSec, 18, slam);
        if (
          a.active !== b.active ||
          !near(a.scaleMul, b.scaleMul, 1e-12) ||
          !near(a.riseNow, b.riseNow, 1e-12) ||
          !near(a.alpha, b.alpha, 1e-12)
        ) {
          same = false;
          worst = `d=${durationSec} slam=${slam} t=${t.toFixed(2)}`;
          break;
        }
      }
    }
  }
  check('包络两端逐值一致（参数网格）', same, worst);
}

// ---------- 5) 事件存取往返 ----------
{
  const ev = normalizeTextPopEvent(TEXT_POP_DEFAULT_PARAMS);
  check(
    '缺省事件形态',
    ev.text === '100' && ev.anchor === 'char' && ev.x === 0 && ev.y === 24 &&
      ev.color === '#ffffff' && ev.scale === 2 && ev.risePx === 18 &&
      ev.durationSec === 0.9 && ev.slam === true,
    JSON.stringify(ev),
  );
  check(
    '空 params 归缺省',
    JSON.stringify(normalizeTextPopEvent({})) === JSON.stringify(ev),
  );
  const custom = normalizeTextPopEvent({
    text: 'CRIT!', anchor: 'canvas', x: 120, y: 40, color: '#ffd23e',
    scale: 3, risePx: 26, durationSec: 1.2, slam: false,
  });
  check(
    '自定义事件保真',
    custom.text === 'CRIT!' && custom.anchor === 'canvas' && custom.x === 120 &&
      custom.scale === 3 && custom.slam === false,
  );
  // 存盘形态：EffectTrack JSON 往返后逐事件再规范化，结果稳定
  const trackJson = JSON.stringify({
    id: 't1', type: 'text_pop', name: '飘字', visible: true,
    keyframes: [
      { id: 'k1', frame: 4, params: { ...TEXT_POP_DEFAULT_PARAMS } },
      { id: 'k2', frame: 30, params: { text: '-27', color: '#ff5544', slam: 'false' } },
    ],
  });
  const back = JSON.parse(trackJson) as {
    keyframes: { params: Record<string, unknown> }[];
  };
  const ev1 = normalizeTextPopEvent(back.keyframes[0]!.params as never);
  const ev2 = normalizeTextPopEvent(back.keyframes[1]!.params as never);
  check('往返事件 1 稳定', JSON.stringify(ev1) === JSON.stringify(ev));
  check(
    '往返事件 2 稳定（字符串 false 归布尔）',
    ev2.text === '-27' && ev2.color === '#ff5544' && ev2.slam === false && ev2.anchor === 'char',
  );
}

// ---------- 6) 接线断言 ----------
const typesSrc = readFileSync(join(ROOT, 'src/lib/types.ts'), 'utf8');
check("EffectType 含 'text_pop'", typesSrc.includes("'text_pop'"));
const cfgSrc = readFileSync(
  join(ROOT, 'src/components/pixel-editor/timeline/constants.tsx'),
  'utf8',
);
check('EFFECT_CONFIG 含 text_pop（加轨菜单自动跟随）', cfgSrc.includes('text_pop'));
const renderSrc = readFileSync(join(ROOT, 'src/lib/engine/effect-render.ts'), 'utf8');
check("编辑器渲染含 case 'text_pop'", renderSrc.includes("case 'text_pop'"));
check('包内 fxRenderSet 含 text_pop 分支', tplSrc.includes("tr.type === 'text_pop'"));
check(
  '包内飘字走 fxQuad 顶点管线',
  tplSrc.includes('fxTextPopEnvelope') && tplSrc.includes('fxMeasureTextPop'),
);

console.log(`\nverify-ui-text: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
