/**
 * 刀光：椭圆扇形状衰减生成器（用户 2026-10-24 给定机制）。
 *
 * 形状 = 椭圆扇形带：外边界是椭圆弧（归一化半径 rho = 1），内边界
 * rho_inner(u) = 1 − thick · A(u)；A(u) 是角向形状因子，尾部 → 0、
 * 头部 → 1——内边界在尾部贴上外弧，扇形向尾部收尖。随进度 p 推
 * 进：头部先展开（head）、尾部后收走（tail）。径向软边让靠近内
 * 边界处渐隐；颜色沿径向由外弧白黄向内边界橙红、尾部再加红；
 * 椭圆外有一圈柔和辉光。逐帧生成 RGBA 像素（帧序号对应 p）。
 *
 * 本文件是编辑器侧实现；运行时模板内有一份孪生实现，探针逐字节
 * 对拍（verify-proc-runtime W 组）。改一处必须同步另一处。
 *
 * 有效帧（包围盒口径）：帧画布不是写死的 w×h。用户盒 = 以 plug
 * （椭圆中心 cx/cy）为原点、左上 (−cx, −cy)、尺寸 (w, h) 的覆盖
 * 范围；几何紧包围盒 = 扇形（含 1.22 辉光外延、扫过角全程）在
 * plug 坐标系下的轴对齐包围盒。实际生成帧 = 两盒并集（尺寸与
 * 帧内 plug 位置由 slashFrameLayout 导出）：移动 cx/cy = 移动整
 * 个盒相对锚点的位置、放大 rx/ry = 盒随几何长大，扇体永不被裁。
 * 并集等于用户盒时布局与旧口径逐值一致（旧帧逐字节不变）。
 */

export interface SlashFanSpec {
  /** 锚点节点 id：刀光在表演/片段开始时定格锚点的位姿（位置+角度），之后不跟随 */
  anchorNodeId: string;
  /** 持续秒数；缺省/0 = 跟随所属表演（片段则为片段窗时长） */
  durationSec?: number;
  /** 生成帧数（2–12，默认 6） */
  frameCount: number;
  /** 帧画布宽/高 px（默认 64×64） */
  w: number;
  h: number;
  /** 椭圆中心（帧画布坐标，px）——同时是定格的对位点（plug） */
  cx: number;
  cy: number;
  /** 椭圆半轴 px */
  rx: number;
  ry: number;
  /** 椭圆旋转（度，画布坐标顺时针为正） */
  rotDeg: number;
  /** 扇形起始角（度；0 = +x 方向，画布坐标顺时针为正） */
  a0Deg: number;
  /** 扫过角（度） */
  sweepDeg: number;
  /** 厚度 0–1：头部处扇形带占半径的比例 */
  thick: number;
  /** 角向收尖指数：越大尾部收得越急 */
  gammaAng: number;
  /** 径向软边宽度（占带宽比例） */
  softRad: number;
  /** 颜色档（外弧→内界）；缺省用内置刀光调色板 */
  colors?: string[];
}

export const SLASH_PALETTE: string[] = [
  '#ffffff', '#fff8d6', '#ffeba1', '#ffd166',
  '#ffab2e', '#ff7a00', '#e8481f', '#b01a33',
];

export function defaultSlashSpec(anchorNodeId: string): SlashFanSpec {
  return {
    anchorNodeId,
    frameCount: 6,
    w: 64, h: 64,
    cx: 32, cy: 52, rx: 27, ry: 25,
    rotDeg: -12, a0Deg: -150, sweepDeg: 130,
    thick: 0.62, gammaAng: 1.4, softRad: 0.28,
  };
}

export const SLASH_PRESETS: { name: string; params: Partial<SlashFanSpec> }[] = [
  { name: '上挑斩', params: { cx: 32, cy: 52, rx: 27, ry: 25, rotDeg: -12, a0Deg: -150, sweepDeg: 130, thick: 0.62, gammaAng: 1.4, softRad: 0.28 } },
  { name: '横斩', params: { cx: 32, cy: 54, rx: 31, ry: 20, rotDeg: 0, a0Deg: -170, sweepDeg: 150, thick: 0.55, gammaAng: 1.2, softRad: 0.24 } },
  { name: '下劈', params: { cx: 32, cy: 10, rx: 24, ry: 30, rotDeg: 6, a0Deg: 20, sweepDeg: 130, thick: 0.7, gammaAng: 1.6, softRad: 0.3 } },
  { name: '大回旋', params: { cx: 32, cy: 42, rx: 26, ry: 24, rotDeg: 18, a0Deg: -200, sweepDeg: 250, thick: 0.72, gammaAng: 1.1, softRad: 0.32 } },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function smooth01(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** 有效帧布局：生成帧的实际尺寸与帧内 plug 坐标（未镜像参照系；
 * 镜像帧是未镜像帧的水平翻转，其 plug 横坐标 = w − plugX） */
export interface SlashFrameLayout {
  w: number;
  h: number;
  plugX: number;
  plugY: number;
}

/**
 * 有效帧布局 = 用户盒 ∪ 几何紧包围盒（见文件头）。
 * 紧包围盒取扇形外弧（半径 1.22 含辉光）在扫过角全程内的极值：
 * 候选点 = 两端点 + 外弧上 x/y 驻点（扇区内才算）+ 椭圆中心。
 */
export function slashFrameLayout(spec: SlashFanSpec): SlashFrameLayout {
  const outW = Math.max(4, Math.round(spec.w));
  const outH = Math.max(4, Math.round(spec.h));
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rot = (spec.rotDeg * Math.PI) / 180;
  const a0 = (spec.a0Deg * Math.PI) / 180;
  const sweep = Math.max(0.06, Math.min(5.8, (spec.sweepDeg * Math.PI) / 180));
  const S = 1.22;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let gx0 = 0, gy0 = 0, gx1 = 0, gy1 = 0;
  const eat = (t: number) => {
    const lx = S * rx * Math.cos(t), ly = S * ry * Math.sin(t);
    const x = lx * cr - ly * sr, y = lx * sr + ly * cr;
    if (x < gx0) gx0 = x;
    if (x > gx1) gx1 = x;
    if (y < gy0) gy0 = y;
    if (y > gy1) gy1 = y;
  };
  eat(a0);
  eat(a0 + sweep);
  const TWO_PI = Math.PI * 2;
  const inRange = (t: number) => {
    let r = (t - a0) % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r <= sweep + 1e-12;
  };
  const tx = Math.atan2(-(ry * sr), rx * cr);
  if (inRange(tx)) eat(tx);
  if (inRange(tx + Math.PI)) eat(tx + Math.PI);
  const ty = Math.atan2(ry * cr, rx * sr);
  if (inRange(ty)) eat(ty);
  if (inRange(ty + Math.PI)) eat(ty + Math.PI);
  const ux0 = Math.min(0, spec.cx + gx0), ux1 = Math.max(outW, spec.cx + gx1);
  const uy0 = Math.min(0, spec.cy + gy0), uy1 = Math.max(outH, spec.cy + gy1);
  const ox = Math.floor(ux0), oy = Math.floor(uy0);
  return {
    w: Math.ceil(ux1) - ox,
    h: Math.ceil(uy1) - oy,
    plugX: spec.cx - ox,
    plugY: spec.cy - oy,
  };
}

export interface SlashFrame {
  w: number;
  h: number;
  /** 帧内 plug 坐标（布局参照系，未镜像；镜像帧 plug 横坐标 = w − plugX） */
  plugX: number;
  plugY: number;
  /** RGBA，行主序，y 向下（与画布/精灵图同向） */
  rgba: Uint8Array;
}

/** 生成进度 p（0–1）处的一帧；mirrored 时整帧水平翻转（朝向镜像用） */
export function generateSlashFrame(spec: SlashFanSpec, p: number, mirrored = false): SlashFrame {
  const lay = slashFrameLayout(spec);
  const outW = lay.w;
  const outH = lay.h;
  const buf = new Uint8Array(outW * outH * 4);
  const palette = (spec.colors && spec.colors.length >= 2 ? spec.colors : SLASH_PALETTE).map(hexToRgb);

  const cx = lay.plugX, cy = lay.plugY;
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rotRad = (spec.rotDeg * Math.PI) / 180;
  const a0 = (spec.a0Deg * Math.PI) / 180;
  const sweep = Math.max(0.06, Math.min(5.8, (spec.sweepDeg * Math.PI) / 180));
  const thick = Math.max(0.04, Math.min(0.97, spec.thick));
  const gammaAng = Math.max(0.25, spec.gammaAng);
  const softRad = Math.max(0.01, spec.softRad);
  const TWO_PI = Math.PI * 2;

  const cosR = Math.cos(-rotRad), sinR = Math.sin(-rotRad);

  // 扫过进度：头部先出，尾部后收
  const head = 0.14 + 0.86 * smooth01(p / 0.58);
  const tail = smooth01((p - 0.44) / 0.56) * 1.06;
  if (head - tail >= 0.018) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const px = x + 0.5 - cx;
        const py = y + 0.5 - cy;
        // 旋转到椭圆本地坐标
        const lx = px * cosR - py * sinR;
        const ly = px * sinR + py * cosR;
        // 椭圆归一化半径
        const ex = lx / rx, ey = ly / ry;
        const rho = Math.sqrt(ex * ex + ey * ey);
        if (rho > 1.22) continue;
        // 参数角
        const t = Math.atan2(ey, ex);
        let rel = t - a0;
        rel = ((rel % TWO_PI) + TWO_PI) % TWO_PI;
        if (rel > sweep) continue;
        const u = rel / sweep;
        if (u < tail || u > head) continue;
        // 角向归一化位置：0 = 尾部，1 = 头部
        const uNorm = (u - tail) / Math.max(0.001, head - tail);
        // 角向形状因子：尾部 → 0，头部 → 1（带头部微圆润）
        let A = Math.pow(Math.max(0, uNorm), gammaAng);
        A *= smooth01(0.15 + 0.85 * uNorm);
        if (A < 0.004) continue;
        // 内边界半径
        const inner = 1 - thick * A;
        const o = (y * outW + x) * 4;
        if (rho <= 1) {
          if (rho < inner - 0.015) continue;
          // 径向位置 s：0 = 内边界，1 = 外弧
          const s = (rho - inner) / Math.max(0.001, 1 - inner);
          if (s < 0) continue;
          // 径向软边（向内收尖）
          const edge = smooth01(s / softRad);
          if (edge < 0.02) continue;
          // 亮度层次
          const radB = Math.pow(Math.min(1, s), 0.75);
          const angB = Math.pow(uNorm, 0.55);
          const bright = edge * (0.35 + 0.65 * radB) * (0.35 + 0.65 * angB);
          // 颜色：外弧白黄、内边界橙红、尾部更红
          let colIdx = Math.floor((1 - s) * palette.length);
          colIdx += Math.floor((1 - uNorm) * 2.2);
          if (colIdx > palette.length - 1) colIdx = palette.length - 1;
          if (colIdx < 0) colIdx = 0;
          const rgb = palette[colIdx]!;
          const a8 = (bright * 255) | 0;
          if (a8 < 6) continue;
          buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = a8;
        } else {
          // 外弧外的柔和辉光
          const glow = smooth01(1 - (rho - 1) / 0.28);
          if (glow < 0.04) continue;
          const g = glow * 0.24 * A;
          if (g < 0.02) continue;
          const rgb = palette[palette.length - 1]!;
          const a8 = (g * 255) | 0;
          buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = a8;
        }
      }
    }
  }

  if (mirrored) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < (outW >> 1); x++) {
        const a = (y * outW + x) * 4;
        const b = (y * outW + (outW - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) {
          const tmp = buf[a + k]!;
          buf[a + k] = buf[b + k]!;
          buf[b + k] = tmp;
        }
      }
    }
  }
  return { w: outW, h: outH, plugX: lay.plugX, plugY: lay.plugY, rgba: buf };
}

/** 帧画布缓存（编辑器预览用）：同一帧内容只生成一次 */
const frameCanvasCache = new Map<string, HTMLCanvasElement>();
export function slashFrameCanvas(spec: SlashFanSpec, frameIdx: number, mirrored = false): HTMLCanvasElement {
  const n = Math.max(2, Math.round(spec.frameCount));
  const idx = Math.min(n - 1, Math.max(0, frameIdx));
  const key = `${idx}|${mirrored ? 1 : 0}|${JSON.stringify(spec)}`;
  let c = frameCanvasCache.get(key);
  if (c) return c;
  const frame = generateSlashFrame(spec, n > 1 ? idx / (n - 1) : 0.5, mirrored);
  c = document.createElement('canvas');
  c.width = frame.w;
  c.height = frame.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(frame.w, frame.h);
  img.data.set(frame.rgba);
  ctx.putImageData(img, 0, 0);
  if (frameCanvasCache.size > 64) frameCanvasCache.clear();
  frameCanvasCache.set(key, c);
  return c;
}
