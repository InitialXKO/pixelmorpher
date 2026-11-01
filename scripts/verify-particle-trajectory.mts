// verify-particle-trajectory.mts — 粒子轨迹升级探针（bun 运行）
// 口径：①地面关时与改动前实现逐值一致（参考实现 = git HEAD 旧函数
// 逐字拷贝，见文件后段）；②地面分段弹跳与小步长数值积分同弹道对拍
// （误差 ≤1px）；③落定后位置恒定；④死后链粒子只在父死后窗口内、
// cls=1 且位置逐值合公式；⑤落地派生 cls=2 且出生点 y 恰为地面线；
// ⑥自转角合哈希公式；⑦地面开但从未落地时与地面关逐值一致。
import { pxToSub, subToPx, type PixelGrid, type Sprite } from '../src/lib/unified-types';
import { markPointPx, markDirAngleDeg } from '../src/lib/sprite-marks';
import { hashPixelGrid } from '../src/lib/engine/render-cache';
import {
  defaultDynamicParams,
  dynamicDeformAt,
  normalizeDynamicParams,
  particleColorAt,
  postColorAt,
  type DynamicPatternParams,
  type ResolvedDynamicPattern,
} from '../src/lib/dynamic-patterns';
import {
  ballisticAt,
  simulateDynamicParticles,
  type ContourPoint,
} from '../src/lib/dynamic-pattern-sim';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; } else { fail++; console.log(`✗ ${name}`); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const gridB: (string | null)[][] = Array.from({ length: 5 }, () => Array(5).fill('#808080'));
const spriteB: Sprite = {
  width: 5, height: 5, data: gridB,
  plug: { x: pxToSub(1), y: pxToSub(2) },
} as Sprite;
const FR = 60;
const SEED = 'probe-seed';

function resolved(params: DynamicPatternParams): ResolvedDynamicPattern {
  return { instance: { id: 'probe1', slot: 's', enabled: true, params }, origin: 'node' };
}
function params(over: Partial<DynamicPatternParams>): DynamicPatternParams {
  return normalizeDynamicParams({ ...defaultDynamicParams(), ...over });
}

// ---- 回归参考实现：改动前（git HEAD）的模拟函数逐字拷贝（仅主粒子、
// 无 cls/rot），关地面/链/落地派生时新实现必须与它逐值一致 ----
interface RefParticle {
  x: number; y: number; size: number; alpha: number; color: string;
  shape: import('../src/lib/dynamic-patterns').ParticleShape;
  dirX: number; dirY: number;
}
function hash01(...nums: number[]): number {
  let h = 2166136261;
  for (const n of nums) {
    h ^= (n | 0) + 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 16777619);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

const solidAt = (grid: PixelGrid, x: number, y: number): boolean => {
  if (y < 0 || y >= grid.length) return false;
  const c = grid[y]?.[x];
  return c !== null && c !== undefined && c !== '';
};

/** 轮廓点 = 有空邻居的实心像素；法线 = 指向空邻居方向的合成 */
function refExtractContour(grid: PixelGrid): ContourPoint[] {
  const pts: ContourPoint[] = [];
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solidAt(grid, x, y)) continue;
      const l = !solidAt(grid, x - 1, y), r = !solidAt(grid, x + 1, y);
      const u = !solidAt(grid, x, y - 1), d = !solidAt(grid, x, y + 1);
      if (!l && !r && !u && !d) continue;
      let nx = (r ? 1 : 0) - (l ? 1 : 0);
      let ny = (d ? 1 : 0) - (u ? 1 : 0);
      const len = Math.hypot(nx, ny);
      if (len === 0) { nx = 0; ny = -1; } else { nx /= len; ny /= len; }
      pts.push({ x, y, nx, ny });
    }
  }
  return pts;
}

const contourCache = new Map<string, ContourPoint[]>();
function contourOf(sprite: Sprite): ContourPoint[] {
  const key = `${sprite.width}x${sprite.height}|${hashPixelGrid(sprite.data)}`;
  const hit = contourCache.get(key);
  if (hit) return hit;
  const pts = refExtractContour(sprite.data);
  if (contourCache.size > 32) contourCache.clear();
  contourCache.set(key, pts);
  return pts;
}

function sourcePoints(params: DynamicPatternParams, sprite: Sprite): ContourPoint[] {
  const all = contourOf(sprite);
  switch (params.source) {
    case 'contour-top': {
      const f = all.filter((p) => p.ny < -0.25);
      return f.length ? f : all;
    }
    case 'contour-bottom': {
      const f = all.filter((p) => p.ny > 0.25);
      return f.length ? f : all;
    }
    case 'inside': {
      const pts: ContourPoint[] = [];
      for (let y = 0; y < sprite.height; y++) {
        for (let x = 0; x < sprite.width; x++) {
          if (solidAt(sprite.data, x, y)) pts.push({ x, y, nx: 0, ny: -1 });
        }
      }
      return pts;
    }
    case 'plug': {
      const px = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
      const py = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
      return [{ x: px - 0.5, y: py - 0.5, nx: 0, ny: -1 }];
    }
    case 'mark': {
      // 精灵标记点（研究线 sprite-marks）：按名解析点标记；
      // 缺失/种类不符 → 回落 plug 点（解析层约定，永不崩）
      const mp = markPointPx(sprite, params.emitMark);
      if (mp) return [{ x: mp.x - 0.5, y: mp.y - 0.5, nx: 0, ny: -1 }];
      const px = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
      const py = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
      return [{ x: px - 0.5, y: py - 0.5, nx: 0, ny: -1 }];
    }
    default:
      return all;
  }
}

/**
 * 求某实例在给定帧、给定绘制层（back/front）的粒子集合。
 * 无状态：逐个出生帧回放（生命窗口内），发射数由出生帧的形变
 * 脉冲调制（linkToDeform），分数部分用哈希取整（无偏、确定性）。
 */
function refSimulateParticles(
  resolved: ResolvedDynamicPattern,
  sprite: Sprite,
  frame: number,
  frameRate: number,
  mirror: boolean,
  layer: 'back' | 'front',
  seedKey: string,
): RefParticle[] {
  const params = resolved.instance.params;
  if (!params.emitEnabled || params.rate <= 0 || params.life <= 0) return [];
  const pts = sourcePoints(params, sprite);
  if (pts.length === 0) return [];
  const plugX = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
  const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  const seedBase = seedFromString(`${seedKey}|${resolved.instance.id}`);
  const lifeFrames = params.life * frameRate;
  const firstBirth = Math.max(0, Math.ceil(frame - lifeFrames));
  const lastBirth = Math.floor(frame);
  // 发射方向绑定（sprite-marks）：emitDirMark 命中 direction/
  // vector 标记时以标记角为准，未命中回落 directionDeg
  const dirDeg = params.emitDirMark
    ? (markDirAngleDeg(sprite, params.emitDirMark) ?? params.directionDeg)
    : params.directionDeg;
  const dirRad = (dirDeg * Math.PI) / 180;
  const dirX = Math.cos(dirRad), dirY = Math.sin(dirRad);
  // 存活上限是单实例总量：both 分层时按身前比例拆给两层
  const cap = params.layer === 'both'
    ? Math.max(1, Math.round(params.maxParticles * (layer === 'front' ? params.frontRatio : 1 - params.frontRatio)))
    : params.maxParticles;
  const out: RefParticle[] = [];
  // 从最年轻的出生帧往回走，达上限即停（保留最年轻的一批）
  for (let b = lastBirth; b >= firstBirth; b--) {
    const tBirth = b / frameRate;
    const amount = dynamicDeformAt(params, tBirth).amount;
    const rateNow = params.rate * (1 - params.linkToDeform + params.linkToDeform * amount);
    const expected = rateNow / frameRate;
    let n = Math.floor(expected);
    if (hash01(seedBase, b, 991) < expected - n) n++;
    const age = (frame - b) / frameRate;
    const lifeRatio = age / params.life;
    if (lifeRatio < 0 || lifeRatio >= 1) continue;
    for (let k = 0; k < n; k++) {
      // 绘制层分配（both 时按哈希比例，出生即定）
      if (params.layer !== 'both') {
        if (params.layer !== layer) continue;
      } else if ((hash01(seedBase, b, k, 777) < params.frontRatio) !== (layer === 'front')) {
        continue;
      }
      const pick = Math.floor(hash01(seedBase, b, k, 13) * pts.length) % pts.length;
      const pt = pts[pick]!;
      const jx = hash01(seedBase, b, k, 21) - 0.5;
      const jy = hash01(seedBase, b, k, 22) - 0.5;
      const sx = pt.x + 0.5 + jx - plugX;
      const sy = pt.y + 0.5 + jy - plugY;
      // 初速：方向为主 + 法线一半；散布按哈希旋转
      const spread = (hash01(seedBase, b, k, 31) - 0.5) * params.spreadDeg * Math.PI / 180;
      let vx = dirX * params.speed + pt.nx * params.speed * 0.5;
      let vy = dirY * params.speed + pt.ny * params.speed * 0.5;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      const rvx = vx * cs - vy * sn, rvy = vx * sn + vy * cs;
      vx = rvx; vy = rvy;
      // 汇聚模式（Jeff 落地）：出生点沿外向速度方向外移 gatherRadius
      // （哈希 0.5~1 倍抖动），速度整体反向——粒子自外围飞向部件
      // （蓄力/虹流）。位置公式与普通模式共用（浮力/上浮照旧）。
      let spawnX = sx, spawnY = sy;
      if (params.emitMode === 'gather') {
        const vlen = Math.hypot(vx, vy);
        if (vlen > 1e-6) {
          const off = params.gatherRadius * (0.5 + 0.5 * hash01(seedBase, b, k, 51));
          spawnX += (vx / vlen) * off;
          spawnY += (vy / vlen) * off;
        }
        vx = -vx; vy = -vy;
      }
      // 位置：初速 + 上浮漂移 + 浮力（y 向下：向上为负）
      const sway = params.turbulence * Math.sin(age * 3.1 + hash01(seedBase, b, k, 41) * Math.PI * 2) * Math.min(1, age);
      const rawPx = spawnX + vx * age + sway * -vy * 0.14;
      const py = spawnY + vy * age - params.rise * age - 0.5 * params.buoy * age * age + sway * vx * 0.14;
      // 镜像：全程在未镜像空间算完，最终 x 反号（整条轨迹刚性翻转，
      // 与画布上预翻转的精灵图同口径；分开翻起点/法线会翻错符号）
      const px = mirror ? -rawPx : rawPx;
      const size = params.sizeStart + (params.sizeEnd - params.sizeStart) * lifeRatio;
      const env = lifeRatio < 0.15 ? lifeRatio / 0.15 : 1 - (lifeRatio - 0.15) / 0.85;
      // 图案级全局后期：抖动消散（包络概率哈希掉落，存活者全
      // alpha）/ 透明度分级（量化）——与运行时孪生同式
      let postAlpha = Math.max(0, params.alpha * env);
      if (params.postEnabled && params.postDither) {
        if (hash01(seedBase, b, k, 61) >= env) continue;
        postAlpha = params.alpha;
      } else if (params.postEnabled && params.postAlphaLevels >= 2) {
        const lv = params.postAlphaLevels;
        postAlpha = Math.round(postAlpha * lv) / lv;
      }
      const vlen = Math.hypot(vx, vy);
      const dirUx = vlen > 1e-6 ? vx / vlen : dirX;
      const dirUy = vlen > 1e-6 ? vy / vlen : dirY;
      out.push({
        x: px, y: py,
        size,
        alpha: postAlpha,
        color: postColorAt(params, particleColorAt(params, lifeRatio)),
        shape: params.particleShape,
        dirX: mirror ? -dirUx : dirUx,
        dirY: dirUy,
      });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

// ---- T1：地面/链/落地派生全关时与旧实现逐值一致 ----
{
  const sets: Partial<DynamicPatternParams>[] = [
    { source: 'contour', rate: 30, speed: 10, directionDeg: 270, spreadDeg: 60, life: 0.9, sizeStart: 3, sizeEnd: 8, rise: 12, buoy: 0, turbulence: 4, layer: 'both', frontRatio: 0.35 },
    { source: 'plug', emitMode: 'gather', gatherRadius: 20, rate: 24, speed: 14, directionDeg: 90, spreadDeg: 30, life: 1.2, rise: 4, buoy: -50, turbulence: 0, layer: 'front', postEnabled: true, postDither: true },
    { source: 'contour', rate: 45, speed: 6, directionDeg: 0, spreadDeg: 120, life: 0.7, rise: -6, buoy: 30, turbulence: 8, layer: 'back', rampEnabled: true },
  ];
  let allSame = true;
  let worst = '';
  sets.forEach((over, si) => {
    const p = params(over);
    const layers: ('back' | 'front')[] = p.layer === 'both' ? ['back', 'front'] : [p.layer as 'back' | 'front'];
    for (const layer of layers) {
      for (const mirror of si === 0 ? [false, true] : [false]) {
        for (let f = 0; f <= 120; f += 7) {
          const a = refSimulateParticles(resolved(p), spriteB, f, FR, mirror, layer, SEED);
          const b = simulateDynamicParticles(resolved(p), spriteB, f, FR, mirror, layer, SEED);
          if (a.length !== b.length) { allSame = false; worst = `set${si} f${f} 数量 ${a.length}≠${b.length}`; continue; }
          for (let i = 0; i < a.length; i++) {
            const u = a[i]!, v = b[i]!;
            if (!(u.x === v.x && u.y === v.y && u.size === v.size && u.alpha === v.alpha
              && u.color === v.color && u.shape === v.shape && u.dirX === v.dirX && u.dirY === v.dirY)) {
              allSame = false; worst = `set${si} f${f} 第${i}粒 (${u.x},${u.y})≠(${v.x},${v.y})`;
            }
            if (v.cls !== 0) { allSame = false; worst = `set${si} f${f} cls 非 0`; }
          }
        }
      }
    }
  });
  check(`T1 旧实现逐值一致 ${worst}`, allSame);
}

// ---- T2：分段弹跳闭式 vs 数值积分（同弹道同反射口径） ----
function integrateRef(
  p: DynamicPatternParams, sx: number, sy: number, vx: number, vy: number, age: number,
): { x: number; y: number } {
  const dt = 1 / 4800;
  let x = sx, y = sy, vxP = vx, vyP = vy, tau = 0, t = 0;
  while (t < age - 1e-12) {
    const h = Math.min(dt, age - t);
    const uMid = vyP - p.rise - p.buoy * (tau + h / 2);
    const yNew = y + uMid * h;
    if (uMid > 0 && y <= p.groundYPx + 1e-12 && yNew >= p.groundYPx && yNew > y) {
      const vyRef = -uMid * p.bounce;
      x += vxP * h * ((p.groundYPx - y) / (yNew - y || 1));
      y = p.groundYPx;
      if (p.bounce <= 0 || Math.abs(vyRef) < p.restVelPx) break; // 落定：冻结
      vxP *= 0.7; vyP = vyRef; tau = 0; t += h;
      continue;
    }
    x += vxP * h; y = yNew; tau += h; t += h;
  }
  return { x, y };
}
{
  const cases: { over: Partial<DynamicPatternParams>; sx: number; sy: number; vx: number; vy: number; span: number }[] = [
    { over: { groundYPx: 24, bounce: 0.5, restVelPx: 15, rise: 5, buoy: -60 }, sx: 0, sy: -10, vx: 14, vy: 25, span: 3 },
    { over: { groundYPx: 30, bounce: 0.6, restVelPx: 10, rise: 0, buoy: 40 }, sx: 5, sy: 0, vx: -8, vy: 90, span: 2.5 },
    { over: { groundYPx: 18, bounce: 0.9, restVelPx: 4, rise: -3, buoy: -120 }, sx: -6, sy: 2, vx: 22, vy: 10, span: 2 },
  ];
  let maxErr = 0;
  for (const c of cases) {
    const p = params({ groundEnabled: true, ...c.over });
    for (let f = 0; f <= c.span * FR; f++) {
      const age = f / FR;
      const closed = ballisticAt(p, c.sx, c.sy, c.vx, c.vy, age);
      const numeric = integrateRef(p, c.sx, c.sy, c.vx, c.vy, age);
      maxErr = Math.max(maxErr, Math.abs(closed.x - numeric.x), Math.abs(closed.y - numeric.y));
    }
  }
  check(`T2 弹跳闭式 vs 积分最大误差 ${maxErr.toFixed(4)}px ≤ 1`, maxErr <= 1);
}

// ---- T3：落定后位置恒定 ----
{
  const p = params({ groundEnabled: true, groundYPx: 10, bounce: 0.3, restVelPx: 80, rise: 0, buoy: -60 });
  const a = ballisticAt(p, 0, 0, 6, 20, 1.5);
  const b = ballisticAt(p, 0, 0, 6, 20, 2.5);
  check('T3 落定标记', a.rested && b.rested);
  check('T3 落定位置恒定且在地面线', a.x === b.x && a.y === b.y && a.y === 10);
  check('T3 落地记录一致', a.landAge !== null && a.landX === a.x);
}

// ---- T4：死后链粒子（窗口/cls/逐值位置） ----
{
  const p = params({
    source: 'plug', rate: 60, speed: 10, directionDeg: 270, spreadDeg: 40,
    life: 0.6, sizeStart: 2, sizeEnd: 6, rise: 10, buoy: -20, turbulence: 3,
    layer: 'front', alpha: 0.8,
    chainEnabled: true, chainLife: 0.9, chainSizeMul: 0.7, chainColor: '#6b6470',
  });
  const seedBase = seedFromString(`${SEED}|probe1`);
  const early = simulateDynamicParticles(resolved(p), spriteB, 10, FR, false, 'front', SEED);
  check('T4 首死前无链粒子', early.every((q) => q.cls !== 1));
  const F = 50;
  const got = simulateDynamicParticles(resolved(p), spriteB, F, FR, false, 'front', SEED)
    .filter((q) => q.cls === 1)
    .sort((u, v) => u.x - v.x);
  // 逐父重算期望：出生帧 b 的父粒子（k=0，plug 源）在死亡处的弹道状态
  const expected: { x: number; y: number; size: number; alpha: number }[] = [];
  for (let b = 0; b <= F; b++) {
    const age = (F - b) / FR;
    const age2 = age - p.life;
    if (age2 < 0 || age2 >= p.chainLife) continue;
    const env2 = age2 / p.chainLife < 0.15 ? (age2 / p.chainLife) / 0.15 : 1 - ((age2 / p.chainLife) - 0.15) / 0.85;
    const jx = hash01(seedBase, b, 0, 21) - 0.5;
    const jy = hash01(seedBase, b, 0, 22) - 0.5;
    const dirRad = (270 * Math.PI) / 180;
    let vx = Math.cos(dirRad) * p.speed + 0 * p.speed * 0.5;
    let vy = Math.sin(dirRad) * p.speed + -1 * p.speed * 0.5;
    const spread = (hash01(seedBase, b, 0, 31) - 0.5) * p.spreadDeg * Math.PI / 180;
    const cs = Math.cos(spread), sn = Math.sin(spread);
    const rvx = vx * cs - vy * sn, rvy = vx * sn + vy * cs;
    vx = rvx; vy = rvy;
    const dx = jx + vx * p.life;
    const dy = jy + vy * p.life - p.rise * p.life - 0.5 * p.buoy * p.life * p.life;
    const dvy = vy - p.rise - p.buoy * p.life;
    const cvx = vx * 0.6, cvy = dvy * 0.6 - p.rise;
    expected.push({
      x: dx + cvx * age2,
      y: dy + cvy * age2,
      size: p.sizeEnd * p.chainSizeMul * (1 + 0.5 * (age2 / p.chainLife)),
      alpha: p.alpha * env2,
    });
  }
  expected.sort((u, v) => u.x - v.x);
  check(`T4 链粒子数量 ${got.length} = 期望 ${expected.length}`, got.length === expected.length && got.length > 0);
  let ok = got.length === expected.length;
  for (let i = 0; i < got.length && ok; i++) {
    const g = got[i]!, e = expected[i]!;
    ok = near(g.x, e.x) && near(g.y, e.y) && near(g.size, e.size) && near(g.alpha, e.alpha)
      && g.shape === 'puff' && g.color === postColorAt(p, p.chainColor);
  }
  check('T4 链粒子逐值合公式（位置/尺寸/alpha/形状/颜色）', ok);
}

// ---- T5：落地派生（cls=2、出生点 y = 地面线、落地前无派生） ----
{
  const base = {
    source: 'plug' as const, rate: 60, speed: 30, directionDeg: 90, spreadDeg: 0,
    life: 3, sizeStart: 2, sizeEnd: 3, rise: 0, buoy: 0, turbulence: 0,
    layer: 'front' as const, alpha: 0.9,
    groundEnabled: true, groundYPx: 24, bounce: 0.45, restVelPx: 26,
    landEmitEnabled: true, landEmitRate: 120, landEmitDuration: 1.2, landEmitColor: '#ff8a2a', maxParticles: 240,
  };
  const p0 = params({ ...base, landEmitRise: 0 });
  const before = simulateDynamicParticles(resolved(p0), spriteB, 60, FR, false, 'front', SEED);
  check('T5 首次落地前无派生粒子', before.every((q) => q.cls !== 2));
  const after = simulateDynamicParticles(resolved(p0), spriteB, 132, FR, false, 'front', SEED);
  const lands = after.filter((q) => q.cls === 2);
  check(`T5 落地后有派生粒子（${lands.length}）`, lands.length > 0);
  check('T5 派生粒子 y 恒为地面线（上升=0 时）', lands.every((q) => q.y === 24));
  check('T5 派生形状/颜色', lands.every((q) => q.shape === 'dot' && q.color === postColorAt(p0, '#ff8a2a')));
  check('T5 落定的主粒子停在地面线', after.some((q) => q.cls === 0 && q.y === 24));
  const p1 = params({ ...base, landEmitRise: 26 });
  // 取首个父粒子刚落地不久的帧（F=100，t≈1.67；落地约在 t≈1.6）：
  // 此时派生量小、上限不截断，能看到恰生于本帧的那两粒
  const risen = simulateDynamicParticles(resolved(p1), spriteB, 100, FR, false, 'front', SEED)
    .filter((q) => q.cls === 2);
  check(`T5 上升派生：有恰生于本帧的（y=地面线）且有已升起的`, risen.some((q) => q.y === 24) && risen.some((q) => q.y < 24));
}

// ---- T6：自转角合哈希公式 ----
{
  const p = params({
    source: 'plug', rate: 60, speed: 8, directionDeg: 270, life: 1,
    sizeStart: 2, sizeEnd: 5, layer: 'front', particleShape: 'shard', particleSpinDeg: 120,
  });
  const seedBase = seedFromString(`${SEED}|probe1`);
  const out = simulateDynamicParticles(resolved(p), spriteB, 30, FR, false, 'front', SEED);
  const newborn = out.find((q) => q.cls === 0 && q.size === 2);
  check('T6 本帧新生粒子存在且形状为线片', !!newborn && newborn.shape === 'shard');
  check('T6 新生粒子 rot = 哈希初相', !!newborn && near(newborn.rot, hash01(seedBase, 30, 0, 72) * 360));
}

// ---- T7：地面开但从未落地 → 与地面关逐值一致 ----
{
  const over = {
    source: 'contour' as const, rate: 30, speed: 10, directionDeg: 90, life: 0.8,
    rise: 0, buoy: -30, turbulence: 3, layer: 'front' as const,
  };
  const off = params({ ...over, groundEnabled: false });
  const on = params({ ...over, groundEnabled: true, groundYPx: 96 });
  let same = true;
  for (let f = 0; f <= 90; f += 9) {
    const a = simulateDynamicParticles(resolved(off), spriteB, f, FR, false, 'front', SEED);
    const b = simulateDynamicParticles(resolved(on), spriteB, f, FR, false, 'front', SEED);
    if (a.length !== b.length) { same = false; break; }
    for (let i = 0; i < a.length; i++) {
      const u = a[i]!, v = b[i]!;
      if (!(u.x === v.x && u.y === v.y && u.dirX === v.dirX && u.dirY === v.dirY && u.rot === v.rot)) same = false;
    }
  }
  check('T7 无落地时地面开/关逐值一致', same);
}

// ---- T8：参数规范化（新字段缺省/钳制/形状白名单） ----
{
  const n = normalizeDynamicParams({ ...defaultDynamicParams(), particleShape: 'puff' });
  check('T8 puff 形状保留', n.particleShape === 'puff');
  const bad = normalizeDynamicParams({
    ...defaultDynamicParams(),
    particleShape: 'bogus' as never, bounce: Number.NaN, groundYPx: 999, chainLife: 0,
  });
  check('T8 坏值回缺省/钳制', bad.particleShape === 'dot' && bad.bounce === 0.45 && bad.groundYPx === 96 && bad.chainLife === 0.2);
  const d = defaultDynamicParams();
  check('T8 合同缺省', d.groundEnabled === false && d.groundYPx === 24 && d.bounce === 0.45 && d.restVelPx === 26
    && d.chainEnabled === false && d.chainLife === 0.9 && d.chainSizeMul === 0.7 && d.chainColor === '#6b6470'
    && d.landEmitEnabled === false && d.landEmitRate === 24 && d.landEmitDuration === 1.2
    && d.landEmitColor === '#ff8a2a' && d.landEmitRise === 26 && d.particleSpinDeg === 0);
}

console.log(`verify-particle-trajectory: ${pass} 过 / ${fail} 败`);
if (fail > 0) process.exit(1);
