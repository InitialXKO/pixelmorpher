// ============================================================
// 包内笔触 Y 锚探针：运行时模板的 fxW2 把编辑器画布坐标（左上
// 原点、画布中心 = 角色原点行）映射到包内世界坐标，供四种画布
// 笔（动态模糊/辉光/粒子/残影）与画布效果轨 pixel_displace 的
// 逐行锚共用。历史病灶：fxW2 的 Y 锚用脚底 charFeetY()，而角色
// 本体落位（partCenter / 绘制基线）用原点 charOriginY()
// = charFeetY() − localGround（localGround ≤ −40），笔触整体
// 下移 |localGround| px、X 不差。
//
// 测法（如实说明）：不执行整份模板（依赖 DOM/WebGL），而是从
// 模板源码用锚定正则抽出 fxW2 / charOriginY / charFeetY 三个
// 函数的**原文**，在桩环境（char/FXW/FXH/localGround/moveMode
// 由探针按用例供给）里以 new Function 真求值——求值的是模板里
// 的真实代码，不是手抄副本。三个函数体除这五个自由变量外不
// 引用任何其它名字（已逐行核对），故桩环境完备。localGround
// 在真模板里是按烘焙部件累积的模块级 let（初值 −40、只减不
// 增），探针另断言其声明形态存在，用例取 −40 / −96 两档。
//
// 断言口径（独立第二实现）：期望映射 = [char.x + (px − FXW/2),
//   (top ? char.py : char.y) − localGround + (FXH/2 − py)]，
// 由探针按用例参数直接手算，不经被测函数。
// 另设锚区分度自检：把抽出的 fxW2 原文里的 charOriginY 换回
// charFeetY 求值，与真值之差必须恰为 −localGround——证明本探
// 针能分辨两锚、且历史误差量恰为 localGround。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = readFileSync(join(root, 'src/lib/proc-runtime/runtime-template.ts'), 'utf8');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------- 抽取模板原文 ----------
function extractFn(src: string, re: RegExp): string {
  const m = src.match(re);
  if (!m) throw new Error(`抽取失败：${re}`);
  return m[0];
}
const feetSrc = extractFn(tpl, /function charFeetY\(\) \{[^}]*\}/);
const originSrc = extractFn(tpl, /function charOriginY\(\) \{[^}]*\}/);
const fxSrc = extractFn(tpl, /function fxW2\(px, py\) \{[^}]*\}/);

check('0.1 抽到 charFeetY 原文（top 取 char.py、否则 char.y）',
  feetSrc.includes("moveMode === 'top' ? char.py : char.y"), feetSrc);
check('0.2 抽到 charOriginY 原文（= charFeetY() − localGround）',
  originSrc.includes('charFeetY() - localGround'), originSrc);
check('0.3 localGround 声明形态在（初值 −40、Math.min 只减不增）',
  /let localGround = -40;/.test(tpl) && /localGround = Math\.min\(localGround, low - 4\)/.test(tpl));
check('0.4 本体落位 partCenter 与 fxW2 同锚（都用 charOriginY）',
  /function partCenter\(params, an\) \{[\s\S]*?charOriginY\(\)/.test(tpl));

// ---------- 桩环境求值 ----------
type Cfg = {
  char: { x: number; y: number; py: number };
  FXW: number; FXH: number;
  localGround: number;
  moveMode: string;
};
function makeFx(cfg: Cfg, fxSource: string = fxSrc) {
  const factory = new Function(
    'char', 'FXW', 'FXH', 'localGround', 'moveMode',
    `${feetSrc}\n${originSrc}\n${fxSource}\nreturn { fxW2, charOriginY, charFeetY };`,
  ) as (...a: unknown[]) => {
    fxW2: (px: number, py: number) => [number, number];
    charOriginY: () => number;
    charFeetY: () => number;
  };
  return factory(cfg.char, cfg.FXW, cfg.FXH, cfg.localGround, cfg.moveMode);
}
// 独立第二实现：按规格手算期望值，不经被测函数。
function expected(cfg: Cfg, px: number, py: number): [number, number] {
  const feetY = cfg.moveMode === 'top' ? cfg.char.py : cfg.char.y;
  return [cfg.char.x + (px - cfg.FXW / 2), feetY - cfg.localGround + (cfg.FXH / 2 - py)];
}
const eq2 = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

function runCfg(tag: string, cfg: Cfg) {
  const { fxW2, charOriginY } = makeFx(cfg);
  const pts: Array<[number, number]> = [
    [cfg.FXW / 2, cfg.FXH / 2],
    [0, 0],
    [cfg.FXW, cfg.FXH],
    [37, 401],
    [cfg.FXW - 13, 7],
  ];
  check(`${tag}.1 画布中心 → [char.x, charOriginY]`,
    eq2(fxW2(cfg.FXW / 2, cfg.FXH / 2), [cfg.char.x, charOriginY()]),
    `got ${fxW2(cfg.FXW / 2, cfg.FXH / 2)} want [${cfg.char.x}, ${charOriginY()}]`);
  check(`${tag}.2 五个采样点与独立手算逐点一致`,
    pts.every(([px, py]) => eq2(fxW2(px, py), expected(cfg, px, py))),
    pts.map(([px, py]) => `${px},${py}:${fxW2(px, py)}vs${expected(cfg, px, py)}`).join(' '));
  // 锚区分度：旧锚（charFeetY）版本与真值之差必须恰为 −localGround。
  const oldFx = makeFx(cfg, fxSrc.replace('charOriginY()', 'charFeetY()')).fxW2;
  check(`${tag}.3 旧锚版本 Y 恰差 −localGround（探针可分辨两锚）`,
    pts.every(([px, py]) => fxW2(px, py)[1] - oldFx(px, py)[1] === -cfg.localGround
      && fxW2(px, py)[0] === oldFx(px, py)[0]),
    `delta=${fxW2(0, 0)[1] - oldFx(0, 0)[1]} want ${-cfg.localGround}`);
}

// ---------- 1) 横版 localGround = −40 ----------
runCfg('1', { char: { x: 100, y: 300, py: 999 }, FXW: 512, FXH: 512, localGround: -40, moveMode: 'side' });

// ---------- 2) 横版 localGround = −96（长腿） ----------
runCfg('2', { char: { x: -50, y: 120, py: 888 }, FXW: 640, FXH: 480, localGround: -96, moveMode: 'side' });

// ---------- 3) 俯视 localGround = −40（锚源 char.py） ----------
const topCfg: Cfg = { char: { x: 10, y: 777, py: 200 }, FXW: 512, FXH: 512, localGround: -40, moveMode: 'top' };
runCfg('3', topCfg);
{
  const a = makeFx(topCfg).fxW2(123, 45);
  const b = makeFx({ ...topCfg, char: { ...topCfg.char, y: -5555 } }).fxW2(123, 45);
  check('3.4 俯视下改 char.y 不影响映射（锚只源于 char.py）', eq2(a, b), `${a} vs ${b}`);
}

// ---------- 4) 源码口径：fxW2 本体不再直引 charFeetY ----------
check('4.1 fxW2 原文以 charOriginY() 为锚、且不直引 charFeetY',
  fxSrc.includes('charOriginY()') && !fxSrc.includes('charFeetY'), fxSrc);

console.log(`\n合计：${passed} 过 / ${failed} 败`);
process.exit(failed > 0 ? 1 : 0);
