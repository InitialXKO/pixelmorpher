// ============================================================
// 动态模板粒子模拟：纯函数、无状态——粒子集合只由（实例、精灵、
// 帧、帧率、种子）决定，任意帧可直接求值（可拖动时间轴、确定性）。
// 坐标 = 节点本地像素（原点 = 精灵 plug，x 右 y 下），与主渲染
// renderNodeSprite 的变换空间一致；镜像时按绘制口径翻 x。
// 发射点来自精灵轮廓（实心像素的外沿 + 外法线），按精灵像素
// 哈希缓存。粒子运动：初速（方向 + 法线混合）→ 上浮漂移 +
// 浮力加速度 + 横向正弦摆动；透明度钟形包络；尺寸线性插值。
// 轨迹升级（可选，参数关时逐值同旧）：地面分段弹跳/落定、死后
// 链粒子（cls=1）、落地派生粒子（cls=2）——见 ballisticAt 注释。
// ============================================================

import { subToPx, type PixelGrid, type Sprite } from './unified-types';
import { markPointPx, markDirAngleDeg } from './sprite-marks';
import { hashPixelGrid } from './engine/render-cache';
import {
  dynamicDeformAt,
  particleColorAt,
  postColorAt,
  type DynamicPatternParams,
  type ResolvedDynamicPattern,
} from './dynamic-patterns';

export interface ContourPoint {
  x: number; y: number;   // 像素索引（产品空间）
  nx: number; ny: number; // 外法线（单位向量，y 向下口径）
}

export interface SimParticle {
  x: number; y: number;   // 本地 px（原点 = plug）
  size: number;           // 直径 px
  alpha: number;          // 0..1（已乘实例 alpha 与生命包络）
  color: string;
  shape: import('./dynamic-patterns').ParticleShape;
  dirX: number; dirY: number; // 运动方向（单位向量，绘制空间：已含镜像翻转）——'line' 形状取向用
  cls: 0 | 1 | 2;         // 0 = 主粒子 / 1 = 死后链粒子 / 2 = 落地派生粒子
  rot: number;            // 绘制自转角（度，shard/chunk/star 取向用）
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
export function extractContour(grid: PixelGrid): ContourPoint[] {
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
  const pts = extractContour(sprite.data);
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

// ============================================================
// 粒子轨迹升级（pixelfx 分流·模式库新算子）：地面分段轨迹。
// 段参数 = 出生口径 (x0, y0, vx0, vy0)，段内公式与单段旧公式同形：
//   x(τ) = x0 + vx0·τ
//   y(τ) = y0 + vy0·τ − rise·τ − 0.5·buoy·τ²    （τ = 段内时间）
//   速度（导数） = (vx0, vy0 − rise − buoy·τ)
// 地面线 y = groundYPx（本地坐标：插头为原点、向下为正）。段界 =
// y 曲线与地面线的交点（二次方程取段内导数向下（> 0）的最小正根）；
// 交点处反射：新段发射参数 vy' = −入射 vy × bounce、vx' = vx × 0.7
// （rise/buoy 是环境量，新段同旧公式再施加，与出生口径一致）；
// |vy'| < restVelPx 或 bounce = 0 → 落定：位置冻结于落点、速度清零，
// 余生继续（alpha 包络照旧）。段数有界（≤16），超界冻结防发散。
// sway 侧偏是绘制摆动，不进交点求解（交点只看弹道 y 曲线）。
// 地面关闭时整段退化为原单段闭式，与旧行为逐值一致。
// ============================================================

interface BallisticState {
  x: number; y: number;         // 弹道位置（不含 sway 侧偏）
  vx: number; vy: number;       // 当前速度（位置导数）；落定时为 0
  segVx: number; segVy: number; // 当前段发射参数（sway 取向用）；落定时为 0
  rested: boolean;
  landAge: number | null;       // 首次落地时刻（age 口径，秒）；从未落地 = null
  landX: number;                // 首次落地点 x（landAge 非空时有效）
}

const TRAJ_EPS = 1e-6;

export function ballisticAt(
  params: DynamicPatternParams,
  sx: number, sy: number, vx: number, vy: number,
  age: number,
): BallisticState {
  const rise = params.rise, buoy = params.buoy;
  if (!params.groundEnabled) {
    return {
      x: sx + vx * age,
      y: sy + vy * age - rise * age - 0.5 * buoy * age * age,
      vx, vy: vy - rise - buoy * age,
      segVx: vx, segVy: vy,
      rested: false, landAge: null, landX: 0,
    };
  }
  const GY = params.groundYPx;
  let segT = 0;
  let x0 = sx, y0 = sy, vx0 = vx, vy0 = vy;
  let landAge: number | null = null;
  let landX = 0;
  for (let seg = 0; seg < 16; seg++) {
    const tau = age - segT;
    const A = -0.5 * buoy, B = vy0 - rise, C = y0 - GY;
    // 段内首次向下穿越地面：A·τ² + B·τ + C = 0
    let hitTau: number | null = null;
    let hitVy = 0;
    if (Math.abs(C) <= 1e-9 && B > 0) {
      hitTau = 0; hitVy = B; // 贴地出生/起段且向下：当场判落地
    } else if (Math.abs(A) < 1e-12) {
      if (B > 0) {
        const t = -C / B;
        if (t > TRAJ_EPS) { hitTau = t; hitVy = B; }
      }
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const r1 = (-B - sq) / (2 * A), r2 = (-B + sq) / (2 * A);
        for (const r of [Math.min(r1, r2), Math.max(r1, r2)]) {
          if (r <= TRAJ_EPS) continue;
          const d = B + 2 * A * r;
          if (d > 0) { hitTau = r; hitVy = d; break; }
        }
      }
    }
    if (hitTau === null || hitTau > tau) {
      return {
        x: x0 + vx0 * tau,
        y: y0 + vy0 * tau - rise * tau - 0.5 * buoy * tau * tau,
        vx: vx0, vy: vy0 - rise - buoy * tau,
        segVx: vx0, segVy: vy0,
        rested: false, landAge, landX,
      };
    }
    const xImp = x0 + vx0 * hitTau;
    if (landAge === null) { landAge = segT + hitTau; landX = xImp; }
    const vyRef = -hitVy * params.bounce;
    if (params.bounce <= 0 || Math.abs(vyRef) < params.restVelPx) {
      return { x: xImp, y: GY, vx: 0, vy: 0, segVx: 0, segVy: 0, rested: true, landAge, landX };
    }
    if (hitTau >= tau) {
      // 求值时刻恰在落点：位置在落点，速度取反射后新段的初速口径
      return {
        x: xImp, y: GY,
        vx: vx0 * 0.7, vy: vyRef - rise,
        segVx: vx0 * 0.7, segVy: vyRef,
        rested: false, landAge, landX,
      };
    }
    segT += hitTau;
    x0 = xImp; y0 = GY; vx0 = vx0 * 0.7; vy0 = vyRef;
  }
  // 弹跳段数超界（病态参数组合）：冻结在当前段起点，避免发散
  return { x: x0, y: y0, vx: 0, vy: 0, segVx: 0, segVy: 0, rested: true, landAge, landX };
}

/** 绘制自转角：particleSpinDeg × age × 哈希符号 + 哈希初相（度） */
function spinRot(
  params: DynamicPatternParams, age: number,
  seedBase: number, b: number, k: number, saltSign: number, saltPhase: number,
): number {
  const sign = hash01(seedBase, b, k, saltSign) < 0.5 ? -1 : 1;
  return params.particleSpinDeg * age * sign + hash01(seedBase, b, k, saltPhase) * 360;
}

/**
 * 求某实例在给定帧、给定绘制层（back/front）的粒子集合。
 * 无状态：逐个出生帧回放（生命窗口内），发射数由出生帧的形变
 * 脉冲调制（linkToDeform），分数部分用哈希取整（无偏、确定性）。
 */
export function simulateDynamicParticles(
  resolved: ResolvedDynamicPattern,
  sprite: Sprite,
  frame: number,
  frameRate: number,
  mirror: boolean,
  layer: 'back' | 'front',
  seedKey: string,
): SimParticle[] {
  const params = resolved.instance.params;
  if (!params.emitEnabled || params.rate <= 0 || params.life <= 0) return [];
  const pts = sourcePoints(params, sprite);
  if (pts.length === 0) return [];
  const plugX = sprite.plug ? subToPx(sprite.plug.x) : sprite.width / 2;
  const plugY = sprite.plug ? subToPx(sprite.plug.y) : sprite.height / 2;
  const seedBase = seedFromString(`${seedKey}|${resolved.instance.id}`);
  // 出生回放窗口前扩：死后链粒子在父死后 chainLife 内可见、落地
  // 派生在落地后 landEmitDuration 内可见，二者取大（均关时同旧）
  const extSec = Math.max(
    params.chainEnabled ? params.chainLife : 0,
    params.landEmitEnabled ? params.landEmitDuration : 0,
  );
  const lifeFrames = (params.life + extSec) * frameRate;
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
  const out: SimParticle[] = [];
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
    const parentAlive = lifeRatio >= 0 && lifeRatio < 1;
    const chainAlive = params.chainEnabled && age >= params.life && age - params.life < params.chainLife;
    const mayLand = params.landEmitEnabled && params.groundEnabled;
    if (!parentAlive && !chainAlive && !mayLand) continue;
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
      // ---- 主粒子（cls=0）----
      // 地面开时先走分段轨迹；链/落地派生与主粒子共用同一 out，
      // 一并计入现行 maxParticles 上限（cap）口径
      let trajMain: BallisticState | null = null;
      if (params.groundEnabled && parentAlive) {
        trajMain = ballisticAt(params, spawnX, spawnY, vx, vy, age);
      }
      if (parentAlive) {
        let rawPx: number;
        let py: number;
        let velX = vx, velY = vy;
        if (trajMain) {
          // 弹道位置 + sway 侧偏（取向随当前段发射参数；落定时段
          // 速度为 0、无侧偏，位置冻结在落点）
          const sway = params.turbulence * Math.sin(age * 3.1 + hash01(seedBase, b, k, 41) * Math.PI * 2) * Math.min(1, age);
          rawPx = trajMain.x + sway * -trajMain.segVy * 0.14;
          py = trajMain.y + sway * trajMain.segVx * 0.14;
          // 方向口径与旧公式一致：取（当前段的）发射参数而非瞬时导数
          velX = trajMain.segVx; velY = trajMain.segVy;
        } else {
          // 位置：初速 + 上浮漂移 + 浮力（y 向下：向上为负）——旧公式
          const sway = params.turbulence * Math.sin(age * 3.1 + hash01(seedBase, b, k, 41) * Math.PI * 2) * Math.min(1, age);
          rawPx = spawnX + vx * age + sway * -vy * 0.14;
          py = spawnY + vy * age - params.rise * age - 0.5 * params.buoy * age * age + sway * vx * 0.14;
        }
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
        const vlen = Math.hypot(velX, velY);
        const dirUx = vlen > 1e-6 ? velX / vlen : dirX;
        const dirUy = vlen > 1e-6 ? velY / vlen : dirY;
        out.push({
          x: px, y: py,
          size,
          alpha: postAlpha,
          color: postColorAt(params, particleColorAt(params, lifeRatio)),
          shape: params.particleShape,
          dirX: mirror ? -dirUx : dirUx,
          dirY: dirUy,
          cls: 0,
          rot: spinRot(params, age, seedBase, b, k, 71, 72),
        });
        if (out.length >= cap) return out;
      }
      // ---- 死后链粒子（cls=1）：父死亡位置派生，形状强制 puff ----
      let evTraj: BallisticState | null = null;
      if (chainAlive) {
        evTraj = ballisticAt(params, spawnX, spawnY, vx, vy, params.life);
        const age2 = age - params.life;
        const ratio2 = age2 / params.chainLife;
        // 简单弹道：初速 = 父死亡速度 × 0.6 并叠加上浮漂移（向上
        // 分量），之后匀速——buoy 不再叠加、无 sway、不与地面作用；
        // 死亡位置取弹道口径（不含 sway 侧偏）
        const cvx = evTraj.vx * 0.6;
        const cvy = evTraj.vy * 0.6 - params.rise;
        const env2 = ratio2 < 0.15 ? ratio2 / 0.15 : 1 - (ratio2 - 0.15) / 0.85;
        const cAlpha = Math.max(0, params.alpha * env2);
        {
          const cxRaw = evTraj.x + cvx * age2;
          const cl = Math.hypot(cvx, cvy);
          out.push({
            x: mirror ? -cxRaw : cxRaw,
            y: evTraj.y + cvy * age2,
            size: params.sizeEnd * params.chainSizeMul * (1 + 0.5 * ratio2),
            alpha: cAlpha,
            color: postColorAt(params, params.chainColor),
            shape: 'puff',
            dirX: cl > 1e-6 ? (mirror ? -(cvx / cl) : cvx / cl) : 0,
            dirY: cl > 1e-6 ? cvy / cl : -1,
            cls: 1,
            rot: spinRot(params, age2, seedBase, b, k, 73, 74),
          });
          if (out.length >= cap) return out;
        }
      }
      // ---- 落地派生粒子（cls=2）：父首次落地窗内派生，只一代 ----
      if (mayLand) {
        const lt = parentAlive
          ? trajMain
          : (evTraj ?? ballisticAt(params, spawnX, spawnY, vx, vy, params.life));
        if (lt && lt.landAge !== null) {
          const tLand = tBirth + lt.landAge;
          const tNow = frame / frameRate;
          const landLife = params.life * 0.5;
          // 窗外（落地尚在未来 / 派生粒子已全灭）整段跳过
          if (tNow >= tLand && tNow < tLand + params.landEmitDuration + landLife) {
            const fFrom = Math.max(
              Math.ceil(tLand * frameRate),
              Math.ceil((tNow - landLife) * frameRate),
            );
            const fTo = Math.min(frame, Math.ceil((tLand + params.landEmitDuration) * frameRate) - 1);
            for (let fL = fFrom; fL <= fTo; fL++) {
              // 出生帧量化 + 哈希取整（与主粒子出生口径同法）
              const expectedL = params.landEmitRate / frameRate;
              let nL = Math.floor(expectedL);
              if (hash01(seedBase, b, k, fL, 881) < expectedL - nL) nL++;
              const ageL = tNow - fL / frameRate;
              if (ageL < 0 || ageL >= landLife) continue;
              for (let j = 0; j < nL; j++) {
                const vxL = (hash01(seedBase, b, k, fL, j, 883) - 0.5) * 16;
                const vyL = -params.landEmitRise * (0.7 + 0.6 * hash01(seedBase, b, k, fL, j, 884));
                const ratioL = ageL / landLife;
                const envL = ratioL < 0.15 ? ratioL / 0.15 : 1 - (ratioL - 0.15) / 0.85;
                const lAlpha = Math.max(0, params.alpha * envL);
                const vl = Math.hypot(vxL, vyL);
                const lSign = hash01(seedBase, b, k, fL, j, 885) < 0.5 ? -1 : 1;
                out.push({
                  x: mirror ? -(lt.landX + vxL * ageL) : lt.landX + vxL * ageL,
                  // 出生点 = 落点（y 恰为地面线），之后简单弹道（buoy
                  // 照参数、无 rise/sway/地面）
                  y: params.groundYPx + vyL * ageL - 0.5 * params.buoy * ageL * ageL,
                  size: params.sizeStart + (params.sizeEnd - params.sizeStart) * ratioL,
                  alpha: lAlpha,
                  color: postColorAt(params, params.landEmitColor),
                  shape: 'dot',
                  dirX: vl > 1e-6 ? (mirror ? -(vxL / vl) : vxL / vl) : 0,
                  dirY: vl > 1e-6 ? vyL / vl : -1,
                  cls: 2,
                  rot: params.particleSpinDeg * ageL * lSign + hash01(seedBase, b, k, fL, j, 886) * 360,
                });
                if (out.length >= cap) return out;
              }
            }
          }
        }
      }
    }
  }
  return out;
}
