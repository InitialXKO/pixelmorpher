// verify-particle-twin-align.mts — 粒子孪生对齐探针（bun 运行）
// 口径：编辑器 simulateDynamicParticles（产品侧唯一口径）vs 包侧
// dynSimulate 在参数网格上 JSON 逐值全等：
//   {地面关/开 × 弹跳 0/0.45} × {链关/开} × {落地派生关/开}
//   × particleSpinDeg {0, 120}
// 精灵/瓦片 = L18 同款 20×20 实心网格；帧 30/60/90/150、双层
// (back/front)。另设见证断言防网格空转：链开须见 cls=1、落地
// 派生开须见 cls=2、spinDeg=0 时 rot 仍须有哈希初相（非恒 0）。
import { pxToSub } from '../src/lib/unified-types';
import {
  defaultDynamicParams,
  normalizeDynamicParams,
  type DynamicPatternParams,
} from '../src/lib/dynamic-patterns';
import { simulateDynamicParticles } from '../src/lib/dynamic-pattern-sim';
import { createDynamicRuntime } from '../src/lib/proc-runtime/dynamic-src';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}

const dyn = createDynamicRuntime() as unknown as {
  dynSimulate: (i: never, t: never, f: number, fr: number, l: string, s: string) =>
    { cls: number; rot: number }[];
};

// L18 同款 20×20 实心网格：产品吃精灵、包侧吃等价瓦片
const grid20: (string | null)[][] = Array.from({ length: 20 }, () => Array(20).fill('#3366aa'));
const sprite20 = { width: 20, height: 20, data: grid20, plug: { x: pxToSub(10), y: pxToSub(10) } };
const tileData20 = new Uint8Array(20 * 20 * 4);
for (let q = 0; q < 400; q++) tileData20[q * 4] = 2;
const tile20 = { w: 20, h: 20, cx: 10, cy: 10, data: tileData20 };

const FR = 60;
const FRAMES = [30, 60, 90, 150];
const LAYERS = ['back', 'front'] as const;
const ID = 'dyn_twin_1';
const SEED = 'torso';

function makeParams(over: Partial<DynamicPatternParams>): DynamicPatternParams {
  return normalizeDynamicParams({
    ...defaultDynamicParams(),
    // 基础形态：向下喷、带重力/上浮/摆动，让弹跳、链、落地派生
    // 三条路径在网格内都被真正走到（rise/buoy/turbulence 非零，
    // 段间 rise 口径与 sway 相位差也能被对拍抓住）
    rate: 60, life: 1.2, speed: 30, directionDeg: 90, spreadDeg: 40,
    turbulence: 3, rise: 8, buoy: -900,
    sizeStart: 4, sizeEnd: 2, alpha: 0.9,
    layer: 'both', frontRatio: 0.5, maxParticles: 400,
    groundYPx: 14, restVelPx: 26,
    chainLife: 0.9, landEmitRate: 24, landEmitDuration: 1.2, landEmitRise: 26,
    ...over,
  });
}

let combos = 0;
let compared = 0;
let witnessParticles = 0;
let witnessChain = 0;
let witnessLand = 0;
let witnessSpinPhase = 0;
for (const groundEnabled of [false, true]) {
  for (const bounce of [0, 0.45]) {
    for (const chainEnabled of [false, true]) {
      for (const landEmitEnabled of [false, true]) {
        for (const particleSpinDeg of [0, 120]) {
          combos++;
          const params = makeParams({
            groundEnabled, bounce, chainEnabled, landEmitEnabled, particleSpinDeg,
          });
          const tag = `ground=${groundEnabled} bounce=${bounce} chain=${chainEnabled} land=${landEmitEnabled} spin=${particleSpinDeg}`;
          let eq = true;
          for (const f of FRAMES) {
            for (const layer of LAYERS) {
              const prod = simulateDynamicParticles(
                { instance: { id: ID, slot: '身体', enabled: true, params }, origin: 'node' } as never,
                sprite20 as never, f, FR, false, layer, SEED);
              const rt = dyn.dynSimulate(
                { id: ID, slot: '身体', params } as never, tile20 as never, f, FR, layer, SEED);
              compared++;
              if (JSON.stringify(prod) !== JSON.stringify(rt)) {
                eq = false;
                if (fail < 40) {
                  const a = JSON.stringify(prod), b = JSON.stringify(rt);
                  let d = 0;
                  while (d < Math.min(a.length, b.length) && a[d] === b[d]) d++;
                  console.log(`  首差@${d} prod …${a.slice(Math.max(0, d - 40), d + 60)}`);
                  console.log(`  首差@${d} rt   …${b.slice(Math.max(0, d - 40), d + 60)}`);
                }
              }
              witnessParticles += prod.length;
              witnessChain += prod.filter((p) => p.cls === 1).length;
              witnessLand += prod.filter((p) => p.cls === 2).length;
              if (particleSpinDeg === 0) witnessSpinPhase += prod.filter((p) => p.rot !== 0).length;
            }
          }
          check(`孪生逐值一致 ${tag}`, eq);
        }
      }
    }
  }
}

check(`网格规模（32 组合 × 4 帧 × 2 层 = ${32 * 4 * 2} 次对拍）`, combos === 32 && compared === 32 * 4 * 2);
check('见证：网格内确有粒子', witnessParticles > 0);
check('见证：链开组合确有 cls=1', witnessChain > 0);
check('见证：落地派生开组合确有 cls=2', witnessLand > 0);
check('见证：spinDeg=0 时 rot 哈希初相非恒 0', witnessSpinPhase > 0);

console.log(`verify-particle-twin-align: ${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
