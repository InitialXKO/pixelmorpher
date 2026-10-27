// ============================================================
// 动态模板粒子模拟：纯函数、无状态——粒子集合只由（实例、精灵、
// 帧、帧率、种子）决定，任意帧可直接求值（可拖动时间轴、确定性）。
// 坐标 = 节点本地像素（原点 = 精灵 plug，x 右 y 下），与主渲染
// renderNodeSprite 的变换空间一致；镜像时按绘制口径翻 x。
// 发射点来自精灵轮廓（实心像素的外沿 + 外法线），按精灵像素
// 哈希缓存。粒子运动：初速（方向 + 法线混合）→ 上浮漂移 +
// 浮力加速度 + 横向正弦摆动；透明度钟形包络；尺寸线性插值。
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
