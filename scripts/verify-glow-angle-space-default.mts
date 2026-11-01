// ============================================================
// 辉光方向缺省探针（2026-11-01 用户裁定：glowAngleSpace 缺省按
// 2026-10-23 立规翻为 world——此前实现缺省 sprite，与立规相反）：
//  1) DEFAULTS 为 world；normalize 对缺失/非法值回落 world，
//     显式存量 'sprite' 原样保留（不迁移）。
//  2) 消费端行为：glowField 在字段缺失时与显式 'world' 逐格
//     一致（随帧角反转），与显式 'sprite'（不随帧角）有别。
//  3) 源码对拍：编辑器渲染（unified-render 签名/hasWorld）与
//     进包（convert 印章签名、runtime-template glowSpace）
//     的读缺省均为 world，src 内无 'sprite' 缺省残留。
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultDynamicParams, normalizeDynamicParams, glowField,
  type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}

// ---------- 1) 缺省与 normalize 口径 ----------
check('DEFAULTS glowAngleSpace === world', defaultDynamicParams().glowAngleSpace === 'world');
check('normalize 缺失字段回落 world',
  normalizeDynamicParams({} as DynamicPatternParams).glowAngleSpace === 'world');
check('normalize 非法值回落 world',
  normalizeDynamicParams({ glowAngleSpace: 'bogus' } as never).glowAngleSpace === 'world');
check('normalize 显式 sprite 保留（存量不迁移）',
  normalizeDynamicParams({ glowAngleSpace: 'sprite' } as never).glowAngleSpace === 'sprite');
check('normalize 显式 world 保留',
  normalizeDynamicParams({ glowAngleSpace: 'world' } as never).glowAngleSpace === 'world');

// ---------- 2) glowField 消费行为 ----------
const grid: string[][] = Array.from({ length: 5 }, () => Array(5).fill(''));
grid[2][2] = '#2ea8ff';
const base = {
  ...defaultDynamicParams(),
  glowEnabled: true, glowMaskSource: 'color', glowPick: '#2ea8ff',
  glowShape: 'flame', glowHalo: 3, glowFlameReach: 2, glowAngleDeg: 270,
} as DynamicPatternParams;
const missing = { ...base } as Record<string, unknown>;
delete missing.glowAngleSpace;

function fieldEq(a: ReturnType<typeof glowField>, b: ReturnType<typeof glowField>): boolean {
  if (!a || !b) return false;
  if (a.w !== b.w || a.h !== b.h || a.field.length !== b.field.length) return false;
  for (let i = 0; i < a.field.length; i++) if (Math.abs(a.field[i] - b.field[i]) > 1e-9) return false;
  return true;
}
const THETA = 40;
const fMissing = glowField(missing as never, grid as never, THETA);
const fWorld = glowField({ ...base, glowAngleSpace: 'world' } as never, grid as never, THETA);
const fSprite = glowField({ ...base, glowAngleSpace: 'sprite' } as never, grid as never, THETA);
const fSprite0 = glowField({ ...base, glowAngleSpace: 'sprite' } as never, grid as never, 0);
const fWorld0 = glowField({ ...base, glowAngleSpace: 'world' } as never, grid as never, 0);
check('缺失字段在帧角 40° 时与显式 world 逐格一致', fieldEq(fMissing, fWorld));
check('显式 world 随帧角改变场（40° ≠ 0°）', !fieldEq(fWorld, fWorld0));
check('显式 sprite 不随帧角改变场（40° ＝ 0°）', fieldEq(fSprite, fSprite0));
check('缺失字段 ≠ 显式 sprite（缺省确已翻转）', !fieldEq(fMissing, fSprite));

// ---------- 3) 源码对拍 ----------
function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
}
const srcFiles: string[] = [];
walk(join(ROOT, 'src'), srcFiles);
const allSrc = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
check('src 内无 glowAngleSpace ?? \'sprite\' 缺省残留', !allSrc.includes("glowAngleSpace ?? 'sprite'"));
check('src 内无 normalize 旧钳制（!== world → sprite）',
  !allSrc.includes("out.glowAngleSpace !== 'world') out.glowAngleSpace = 'sprite'"));

const dp = readFileSync(join(ROOT, 'src/lib/dynamic-patterns.ts'), 'utf8');
check('dynamic-patterns 钳制翻转在位',
  dp.includes("if (out.glowAngleSpace !== 'sprite') out.glowAngleSpace = 'world';"));
check('dynamic-patterns glowStamp 按 !== sprite 判 world',
  dp.includes("params.glowAngleSpace !== 'sprite' ? frameAngleDeg : 0"));

const ur = readFileSync(join(ROOT, 'src/lib/unified-render.ts'), 'utf8');
check('unified-render 签名读缺省为 world', ur.includes("c.glowAngleSpace ?? 'world'"));
check('unified-render hasWorld 按 !== sprite 判', ur.includes("c.glowAngleSpace !== 'sprite'"));

const cv = readFileSync(join(ROOT, 'src/lib/proc-runtime/convert.ts'), 'utf8');
check('convert 印章签名读缺省为 world', cv.includes("params.glowAngleSpace ?? 'world'"));

const rt = readFileSync(join(ROOT, 'src/lib/proc-runtime/runtime-template.ts'), 'utf8');
check('runtime-template glowSpace 按 !== sprite 判 world',
  rt.includes("x.params.glowAngleSpace !== 'sprite' ? 1 : 0"));

console.log(`verify-glow-angle-space-default: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
