// ============================================================
// 环绕方向缺省探针（2026-11-01：orbitAngleSpace 与辉光
// glowAngleSpace 同口径——按 2026-10-23 立规「方向默认世界、
// 可切精灵」，辉光已于 PR #80 翻 world，环绕同族参数同日定案
// 跟进。此前 orbit 缺省 sprite，与立规及自家注释「同发光方向
// 基准口径」均不符）：
//  1) DEFAULTS 为 world；normalize 对缺失/非法值回落 world，
//     显式存量 'sprite' 原样保留（不迁移、行为逐值不变）。
//  2) 消费端行为：orbitPointsAt 在字段缺失时与显式 'world'
//     逐点一致（随 worldAngleDeg 反转），与显式 'sprite'
//     （不随角度）有别；包内孪生 dynOrbitPoints 同口径。
//  3) 源码对拍：三处消费判定（dynamic-patterns / dynamic-src /
//     runtime-template）统一为 !== 'sprite'，src 内无
//     orbitAngleSpace === 'world' 旧判定与旧钳制残留。
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultDynamicParams, normalizeDynamicParams, orbitPointsAt,
  type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; return; }
  fail++; fails.push(name + (extra ? ' — ' + extra : ''));
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
type Pt = { x: number; y: number };
function ptsEq(a: Pt[], b: Pt[]): boolean {
  return a.length === b.length && a.every((q, i) => near(q.x, b[i]!.x) && near(q.y, b[i]!.y));
}
function ptsNe(a: Pt[], b: Pt[]): boolean {
  return a.length !== b.length || a.some((q, i) => !near(q.x, b[i]!.x, 1e-6) || !near(q.y, b[i]!.y, 1e-6));
}

// ---------- 1) 缺省与 normalize 口径 ----------
check('DEFAULTS orbitAngleSpace === world', defaultDynamicParams().orbitAngleSpace === 'world');
check('normalize 缺失字段回落 world',
  normalizeDynamicParams({} as DynamicPatternParams).orbitAngleSpace === 'world');
check('normalize 非法值回落 world',
  normalizeDynamicParams({ orbitAngleSpace: 'bogus' } as never).orbitAngleSpace === 'world');
check('normalize 显式 sprite 保留（存量不迁移）',
  normalizeDynamicParams({ orbitAngleSpace: 'sprite' } as never).orbitAngleSpace === 'sprite');
check('normalize 显式 world 保留',
  normalizeDynamicParams({ orbitAngleSpace: 'world' } as never).orbitAngleSpace === 'world');

// ---------- 2) orbitPointsAt 消费行为 ----------
const base = {
  ...defaultDynamicParams(),
  orbitEnabled: true, orbitCount: 4, orbitRadiusX: 20, orbitRadiusY: 10,
  orbitHz: 0.5, orbitPhase: 0,
} as DynamicPatternParams;
const missing = { ...base } as Record<string, unknown>;
delete missing.orbitAngleSpace;

const ANG = 40;
const mAng = orbitPointsAt(missing as never, 0.3, ANG);
const wAng = orbitPointsAt({ ...base, orbitAngleSpace: 'world' }, 0.3, ANG);
const sAng = orbitPointsAt({ ...base, orbitAngleSpace: 'sprite' }, 0.3, ANG);
const s0 = orbitPointsAt({ ...base, orbitAngleSpace: 'sprite' }, 0.3, 0);
const w0 = orbitPointsAt({ ...base, orbitAngleSpace: 'world' }, 0.3, 0);
check('缺失字段在 worldAngleDeg=40 时与显式 world 逐点一致', ptsEq(mAng, wAng));
check('显式 world 随角度改变点位（40° ≠ 0°）', ptsNe(wAng, w0));
check('缺失字段 ≠ 显式 sprite（缺省确已翻转）', ptsNe(mAng, sAng));
// 存量逐值不变：显式 sprite 在新旧口径下都是 counter=0——不随角度变，
// 且等于未旋转的椭圆参数点（手算 t=0.3、Hz=0.5 → 首点相位 0.15 圈）
check('显式 sprite 不随角度改变点位（40° ＝ 0°，存量行为逐值不变）', ptsEq(sAng, s0));
{
  const a = (0 + 0.3 * 0.5 + 0 / 4) * Math.PI * 2;
  check('显式 sprite 首点 = 未旋转椭圆点（手算对拍）',
    near(sAng[0]!.x, Math.cos(a) * 20) && near(sAng[0]!.y, Math.sin(a) * 10));
}
// 世界基准手算对拍：t=0、角度 40° 时首点 = 椭圆点 (20,0) 按 -40° 旋转
{
  const rad = (-40 * Math.PI) / 180;
  const w = orbitPointsAt({ ...base, orbitAngleSpace: 'world' }, 0, ANG);
  check('显式 world 首点 = 椭圆点按 -40° 旋转（手算对拍）',
    near(w[0]!.x, 20 * Math.cos(rad)) && near(w[0]!.y, 20 * Math.sin(rad)));
}

// ---------- 2b) 包内孪生 dynOrbitPoints 同口径 ----------
const rt = createDynamicRuntime() as unknown as {
  dynOrbitPoints: (p: unknown, t: number, ang?: number) => Pt[];
};
check('孪生：缺失字段在 40° 与编辑器缺失字段逐点一致',
  ptsEq(rt.dynOrbitPoints(missing, 0.3, ANG), mAng));
check('孪生：缺失字段 ≠ 显式 sprite',
  ptsNe(rt.dynOrbitPoints(missing, 0.3, ANG), rt.dynOrbitPoints({ ...base, orbitAngleSpace: 'sprite' }, 0.3, ANG)));
check('孪生：显式 sprite 不随角度变（存量逐值不变）',
  ptsEq(rt.dynOrbitPoints({ ...base, orbitAngleSpace: 'sprite' }, 0.3, ANG),
    rt.dynOrbitPoints({ ...base, orbitAngleSpace: 'sprite' }, 0.3, 0)));

// ---------- 3) 源码对拍 ----------
const dp = readFileSync(join(ROOT, 'src/lib/dynamic-patterns.ts'), 'utf8');
const ds = readFileSync(join(ROOT, 'src/lib/proc-runtime/dynamic-src.ts'), 'utf8');
const rtpl = readFileSync(join(ROOT, 'src/lib/proc-runtime/runtime-template.ts'), 'utf8');
check('dynamic-patterns 消费判定 !== sprite 在位',
  dp.includes("params.orbitAngleSpace !== 'sprite'"));
check('dynamic-src 消费判定 !== sprite 在位',
  ds.includes("params.orbitAngleSpace !== 'sprite'"));
check('runtime-template 预转判定 !== sprite 在位',
  rtpl.includes("inst.params.orbitAngleSpace !== 'sprite'"));
check('三处无 orbitAngleSpace === \'world\' 旧判定残留',
  !dp.includes("orbitAngleSpace === 'world'")
  && !ds.includes("orbitAngleSpace === 'world'")
  && !rtpl.includes("orbitAngleSpace === 'world'"));
check('normalize 钳制翻转在位',
  dp.includes("if (out.orbitAngleSpace !== 'sprite') out.orbitAngleSpace = 'world';"));
check('无旧钳制（!== world → sprite）残留',
  !dp.includes("out.orbitAngleSpace = 'sprite'"));

console.log(`verify-orbit-angle-space-default: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
