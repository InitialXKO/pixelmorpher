// ============================================================
// 模式库缩略图（纯 RGBA 计算，浏览器侧再编码为 data URL）：
// - 表面：条目图在标准瓦片上烘一张（烘焙器现成），按版本缓存。
// - 动态：定格图——示例精灵（程序生成的小史莱姆）+ 峰值时刻
//   一帧：发光场（带柔光）→ 背层粒子 → 形变精灵 → 前层粒子。
//   粒子走运行时同源 dynSimulate、形变走 dynamicDeformAt、
//   发光走 glowField，与真实渲染同口径、只是定格。
// 动态的「动」预览不在这里：面板详情复用程序化预览面板的
// 整包 iframe（见 PatternLibraryPanel 的条目预览）。
// ============================================================

import {
  displacePhaseAt, displacePixelGrid, spinAngleDegAt, arcPointsAt,
  dynamicDeformAt, glowField, glowPulseAt, type DynamicPatternInstance, type DynamicPatternParams,
} from './dynamic-patterns';
import { createSurfaceBaker } from './proc-runtime/bake-src';
import { shadeTileStatic } from './proc-runtime/main-canvas';
import { createDynamicRuntime } from './proc-runtime/dynamic-src';
import { expandSurfaceGraph, graphHasRefs, subgraphLibraryOf } from './proc-runtime/graph-expand';
import { createDefaultParametricAppearance } from './proc-runtime/surfaces';
import { allLibraryEntries, surfaceLibEntriesOf, type SurfaceEntryDef } from './library-entries';
import {
  createDefaultCharacter, createDefaultCostumePiece, createDefaultNode,
  type Character, type PixelGrid,
} from './unified-types';

export interface RGBAImage {
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

// ---------------- 示例精灵 ----------------

const SLIME_BODY = '#6fb7d6';
const SLIME_DARK = '#3d7ea6';
const SLIME_LIGHT = '#a8dcf0';

/** 20×20 小史莱姆（半圆身 + 眼睛 + 高光）：形变/发光/粒子都读得出 */
export function sampleSpriteGrid(): PixelGrid {
  const W = 20, H = 20;
  const grid: PixelGrid = Array.from({ length: H }, () => Array.from({ length: W }, () => null as string | null));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - 9.5) / 9.5;
      const dy = (y - 10.5) / 9.5;
      const d = dx * dx + dy * dy;
      if (y >= 3 && d <= 1 && y <= 18) {
        grid[y]![x] = d > 0.82 ? SLIME_DARK : SLIME_BODY;
      }
    }
  }
  // 眼睛与高光
  for (const [ex, ey] of [[6, 10], [13, 10]] as const) {
    grid[ey]![ex] = '#10303f';
    grid[ey + 1]![ex] = '#10303f';
  }
  grid[7]![6] = SLIME_LIGHT;
  grid[7]![7] = SLIME_LIGHT;
  grid[8]![6] = SLIME_LIGHT;
  // 取色靶区（发光叶子靠取色选区：示例精灵带几个标准靶色，
  // 发光定格图因此是真渲染而非示意）：暖色围巾、胸口蓝宝石
  // （与内置「辉光呼吸」的取色同值）、两侧毒绿符文。
  for (let x = 5; x <= 14; x++) grid[6]![x] = '#ff8a3c';
  for (const [gx, gy] of [[9, 13], [10, 13], [9, 14], [10, 14]] as const) grid[gy]![gx] = '#2ea8ff';
  grid[12]![4] = '#8dff57';
  grid[12]![15] = '#8dff57';
  return grid;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 条目动态预览用示例角色：单躯干部件挂一个动态实例。
 * 节点/角色必须走工厂构造——手写字面量缺 tracks/transform，
 * convert 的 FK 求值（interpolateTransformImpl 读 node.tracks.x）
 * 会当场崩；面板预览上线时正是因为没人跑过这条路径而漏掉。 */
export function samplePreviewCharacter(inst: DynamicPatternInstance): Character {
  const node = createDefaultNode('torso', '躯干');
  node.slot = createDefaultCostumePiece('torso');
  node.dynamicPatterns = [inst];
  const character = createDefaultCharacter('preview-char', '预览');
  character.nodes = { torso: node };
  character.rootNodeId = 'torso';
  character.costumeSets = [{
    id: 'set1', name: '默认',
    pieces: {
      torso: {
        nodeId: 'torso', zIndex: 0,
        parametric: createDefaultParametricAppearance(),
      } as unknown as Character['costumeSets'][number]['pieces'][string],
    },
  }];
  character.activeCostumeSetId = 'set1';
  return character;
}

// ---------------- 表面缩略图 ----------------

let bakerSingleton: ReturnType<typeof createSurfaceBaker> | null = null;

/** 表面条目某版 def → 标准瓦片预览图（48×48 圆角矩形）。
 * 注意 compileTileDAG 的 data 是档位索引编码（R=调色板档位、
 * G=闪光标志、B=轮廓外延），不是颜色图——必须再走主画布同款
 * 着色（shadeTileStatic：调色板+光照/描边，默认外观）才是真实
 * 观感。直接把索引图当 RGBA 显示会是一片绿色（档位值 ~33、
 * 闪光字节 255 落在 G 通道），上线实测踩过。 */
export function surfaceThumbRGBA(def: SurfaceEntryDef, size = 48): RGBAImage | null {
  try {
    bakerSingleton ??= createSurfaceBaker();
    let graph = JSON.parse(JSON.stringify(def.graph)) as typeof def.graph;
    graph.params = {};
    for (const p of def.params) graph.params[p.key] = p.def;
    // 组合模板含 ref：先按条目库展开成平图再烘（与进包/主画布同路）
    if (graphHasRefs(graph)) {
      graph = expandSurfaceGraph(graph, subgraphLibraryOf(surfaceLibEntriesOf(allLibraryEntries()))).graph;
    }
    const tile = bakerSingleton.compileTileDAG(
      { kind: 'rect', size: [size, size], roundness: 0.18 }, graph, 0);
    const grid = shadeTileStatic(tile, createDefaultParametricAppearance(), 0);
    const h = grid.length, w = grid[0]?.length ?? 0;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y]![x];
        if (!c) continue;
        const [r, g, b] = hexToRgb(c);
        const o = (y * w + x) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
    return { w, h, data };
  } catch {
    return null;
  }
}

// ---------------- 动态定格图 ----------------

const OUT = 72;
const SS = 3; // 示例精灵放大倍数（20px → 60px）

function boxBlurAlpha(buf: Float32Array, w: number, h: number, radius: number): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(buf.length);
  const out = new Float32Array(buf.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        s += buf[y * w + xx]!; n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        s += tmp[yy * w + x]!; n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** 动态参数 → 定格 RGBA（峰值时刻一帧） */
export function dynamicPosterRGBA(params: DynamicPatternParams): RGBAImage {
  const grid = sampleSpriteGrid();
  const gh = grid.length, gw = grid[0]!.length;
  // 峰值时刻：扫 2 秒取 形变量 + 发光脉冲 的加权峰
  let bestT = 0.5, bestScore = -1;
  for (let i = 0; i <= 120; i++) {
    const t = i / 60;
    const score = dynamicDeformAt(params, t).amount + glowPulseAt(params, t) * 0.8
      + (params.emitEnabled ? Math.min(t / Math.max(params.life, 0.01), 1) * 0.3 : 0);
    if (score > bestScore) { bestScore = score; bestT = t; }
  }
  const t = bestT;
  const deform = dynamicDeformAt(params, t);
  // 置换段（D2）：定格图同样过置换场（相位取峰值时刻口径）
  const drawGrid = params.displaceEnabled
    ? displacePixelGrid(grid, params, displacePhaseAt(params, t))
    : grid;
  // 合成缓冲（float RGBA，src-over）
  const acc = new Float32Array(OUT * OUT * 4);
  const plot = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= OUT || y >= OUT || a <= 0) return;
    const i = (y * OUT + x) * 4;
    const ia = acc[i + 3]!;
    const na = a + ia * (1 - a);
    if (na <= 0) return;
    acc[i] = (r * a + acc[i]! * ia * (1 - a)) / na;
    acc[i + 1] = (g * a + acc[i + 1]! * ia * (1 - a)) / na;
    acc[i + 2] = (b * a + acc[i + 2]! * ia * (1 - a)) / na;
    acc[i + 3] = na;
  };
  // 精灵落位：水平居中、底边贴近画布底（留粒子升空的头顶空间）
  const bottomY = OUT - 4;
  const cxPx = OUT / 2;
  const spriteTop = bottomY - gh * SS;
  // 1) 发光层（独立强度场，两遍盒式模糊当柔光，再以 lighter 近似叠加）
  if (params.glowEnabled) {
    const gf = glowField(params, grid);
    if (gf) {
      const pulse = glowPulseAt(params, t);
      const strength = Math.max(0, Math.min(1.5, params.glowStrength)) * (0.35 + 0.65 * pulse);
      let layer = new Float32Array(OUT * OUT);
      for (let y = 0; y < gf.h; y++) {
        for (let x = 0; x < gf.w; x++) {
          const v = gf.field[y * gf.w + x]!;
          if (v <= 0) continue;
          const ox = Math.round(cxPx + (x - gf.padX - gw / 2) * SS);
          const oy = Math.round(spriteTop + (y - gf.padY) * SS);
          for (let yy = 0; yy < SS; yy++) {
            for (let xx = 0; xx < SS; xx++) {
              const px = ox + xx, py = oy + yy;
              if (px < 0 || py < 0 || px >= OUT || py >= OUT) continue;
              layer[py * OUT + px] = Math.max(layer[py * OUT + px]!, v);
            }
          }
        }
      }
      layer = boxBlurAlpha(boxBlurAlpha(layer, OUT, OUT, 2), OUT, OUT, 2);
      const [gr, gg, gb] = hexToRgb(params.glowColor);
      for (let i = 0; i < OUT * OUT; i++) {
        const a = Math.min(1, layer[i]! * strength * 0.75);
        if (a > 0.01) plot(i % OUT, Math.floor(i / OUT), gr, gg, gb, a);
      }
    }
  }
  // 粒子（运行时同源模拟；坐标相对精灵中心）
  const rt = createDynamicRuntime();
  const tileData = new Uint8Array(gw * gh * 4);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      tileData[(y * gw + x) * 4] = grid[y]![x] ? 0 : 255; // R<128 = 占据
    }
  }
  const tile = { w: gw, h: gh, cx: gw / 2, cy: gh / 2, data: tileData };
  const frame = Math.round(t * 24);
  const drawParticles = (layerName: 'back' | 'front') => {
    const ps = rt.dynSimulate(
      { id: 'thumb', slot: 'main', params } as never,
      tile as never, frame, 24, layerName, 'thumb');
    for (const p of ps) {
      const [r, g, b] = hexToRgb(p.color);
      const px = cxPx + p.x * SS;
      const py = spriteTop + gh * SS / 2 + p.y * SS;
      const rad = Math.max(0.6, (p.size * SS) / 2);
      for (let yy = Math.floor(py - rad); yy <= py + rad; yy++) {
        for (let xx = Math.floor(px - rad); xx <= px + rad; xx++) {
          const d2 = (xx - px) ** 2 + (yy - py) ** 2;
          if (d2 <= rad * rad) plot(xx, yy, r, g, b, Math.max(0, Math.min(1, p.alpha)));
        }
      }
    }
  };
  if (params.emitEnabled) drawParticles('back');
  // 2) 精灵本体（形变 = 底边中心锚的整体缩放；自转 = 绕精灵
  // 中心后向旋转采样，仅本体近似——发光/粒子层不跟着转）
  const dw = gw * SS * deform.sx;
  const dh = gh * SS * deform.sy;
  const dx0 = cxPx - dw / 2;
  const dy0 = bottomY - dh;
  const spinRad = (spinAngleDegAt(params, t) * Math.PI) / 180;
  const spinCos = Math.cos(spinRad), spinSin = Math.sin(spinRad);
  const drawBody = (alphaMul: number, offX: number) => {
    for (let y = 0; y < OUT; y++) {
      for (let x = 0; x < OUT; x++) {
        if (x < dx0 || x >= dx0 + dw || y < dy0 || y >= dy0 + dh) continue;
        let fx = ((x - dx0) / dw) * gw;
        let fy = ((y - dy0) / dh) * gh;
        if (spinRad !== 0) {
          const lx = fx - gw / 2, ly = fy - gh / 2;
          fx = lx * spinCos + ly * spinSin + gw / 2;
          fy = -lx * spinSin + ly * spinCos + gh / 2;
        }
        const sx = Math.floor(fx);
        const sy = Math.floor(fy);
        const c = drawGrid[sy]?.[sx];
        if (!c) continue;
        const [r, g, b] = hexToRgb(c);
        plot(x + offX, y, r, g, b, alphaMul);
      }
    }
  };
  // 残影段（D5）定格近似：无位姿历史可采，按蓝图残影的缺省口径
  // 向左拖影两道（旧→新），仅示意
  if (params.trailEnabled) {
    const n = Math.max(1, Math.min(6, Math.round(params.trailCount || 3)));
    for (let k = n; k >= 1; k--) {
      drawBody((params.trailOpacity || 0.35) * (1 - (k - 1) / n) * 0.8, -k * Math.max(2, Math.round(gw * SS * 0.14)));
    }
  }
  drawBody(1, 0);
  // 弧线段（D4 一期）定格：与编辑器同一生成器，沿折线逐段盖点
  // （原点 = 精灵中心近似插头，缩放 = 本体输出比例）
  if (params.arcEnabled) {
    const shape = arcPointsAt(params, t);
    const [ar, ag, ab] = hexToRgb(params.arcColor || '#bfe3ff');
    const ox = dx0 + dw / 2, oy = dy0 + dh / 2, k = dw / gw;
    const stampLine = (pts: { x: number; y: number; w: number }[], alphaMul: number, widthMul: number) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const x0 = ox + pts[i].x * k, y0 = oy + pts[i].y * k;
        const x1 = ox + pts[i + 1].x * k, y1 = oy + pts[i + 1].y * k;
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
        const rad = Math.max(0.6, (pts[i].w * k * widthMul) / 2);
        for (let s2 = 0; s2 <= steps; s2++) {
          const cx = x0 + ((x1 - x0) * s2) / steps, cy = y0 + ((y1 - y0) * s2) / steps;
          for (let yy = Math.floor(cy - rad); yy <= cy + rad; yy++) {
            for (let xx = Math.floor(cx - rad); xx <= cx + rad; xx++) {
              if ((xx - cx) ** 2 + (yy - cy) ** 2 <= rad * rad) plot(xx, yy, ar, ag, ab, shape.alpha * alphaMul);
            }
          }
        }
      }
    };
    for (const line of [shape.main, ...shape.branches]) {
      stampLine(line, 0.22, 2.6);
      stampLine(line, 1, 1);
    }
    // 光点（藤蔓叶/星座星）：单点盖圆
    for (const d of shape.dots) {
      const cx = ox + d.x * k, cy = oy + d.y * k;
      const rad = Math.max(0.6, d.w * k);
      for (let yy = Math.floor(cy - rad); yy <= cy + rad; yy++) {
        for (let xx = Math.floor(cx - rad); xx <= cx + rad; xx++) {
          if ((xx - cx) ** 2 + (yy - cy) ** 2 <= rad * rad) plot(xx, yy, ar, ag, ab, shape.alpha);
        }
      }
    }
  }
  if (params.emitEnabled) drawParticles('front');
  const data = new Uint8ClampedArray(OUT * OUT * 4);
  for (let i = 0; i < acc.length; i++) data[i] = Math.round(Math.max(0, Math.min(1, acc[i]!)) * 255);
  return { w: OUT, h: OUT, data };
}

// ---------------- 脸型缩略图 ----------------

import { faceFeaturePoints, faceHalfWidths, type FaceFeatureParams } from './face-features';

/** 脸型条目缩略图：头部框（蛋形填充）+ 五官点位线段（纯 RGBA 栅格） */
export function faceThumbRGBA(p: FaceFeatureParams, size = 48): RGBAImage {
  const w = size, h = size;
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
    const i = (yi * w + xi) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  // 头蛋形：中心 (0.5, 0.52)、半宽 0.36、半高 0.48（框内）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x / w - 0.5) / 0.36, dy = (y / h - 0.52) / 0.48;
      if (dx * dx + dy * dy <= 1) set(x, y, 143, 155, 176, 255);
    }
  }
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * size));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      set((x0 + (x1 - x0) * t) * w, (y0 + (y1 - y0) * t) * h, 30, 34, 48, 255);
      set((x0 + (x1 - x0) * t) * w + 1, (y0 + (y1 - y0) * t) * h, 30, 34, 48, 255);
    }
  };
  const pts = faceFeaturePoints(p);
  const hw = faceHalfWidths(p);
  line(pts.browL.x - hw.eye, pts.browL.y, pts.browL.x + hw.eye, pts.browL.y);
  line(pts.browR.x - hw.eye, pts.browR.y, pts.browR.x + hw.eye, pts.browR.y);
  line(pts.eyeL.x - hw.eye, pts.eyeL.y, pts.eyeL.x + hw.eye, pts.eyeL.y);
  line(pts.eyeR.x - hw.eye, pts.eyeR.y, pts.eyeR.x + hw.eye, pts.eyeR.y);
  line(pts.noseBase.x - hw.nose, pts.noseBase.y, pts.noseBase.x + hw.nose, pts.noseBase.y);
  line(pts.mouth.x - hw.mouth, pts.mouth.y, pts.mouth.x + hw.mouth, pts.mouth.y);
  return { w, h, data: data as Uint8ClampedArray<ArrayBuffer> };
}

// ---------------- 编码与缓存（浏览器侧） ----------------

const thumbCache = new Map<string, string>();

/** RGBA → data URL（无 document 时返回 undefined） */
export function rgbaToDataUrl(img: RGBAImage): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = img.w;
  canvas.height = img.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
  return canvas.toDataURL();
}

/** 带缓存取缩略图 data URL（key = 调用方给的版本键） */
export function cachedThumb(key: string, make: () => RGBAImage | null): string | undefined {
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const img = make();
  if (!img) return undefined;
  const url = rgbaToDataUrl(img);
  if (url) thumbCache.set(key, url);
  return url;
}
