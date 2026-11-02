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
 * 有效帧（包围盒口径）：帧画布不是写死的 w×h。坐标系以锚点
 * （对位点 plug）为原点：椭圆中心 = 锚点 + 偏移 (cx, cy)；用户
 * 盒 = 以锚点为中心、尺寸 (w, h) 的覆盖范围；几何紧包围盒 =
 * 扇形（含 1.22 辉光外延、扫过角全程）在锚点本地系下的轴对齐
 * 包围盒。实际生成帧 = 两盒并集（尺寸与帧内 plug 位置由
 * slashFrameLayout 导出）：改 cx/cy = 扇面整体相对锚点平移、
 * 放大 rx/ry = 盒随几何长大，扇体永不被裁。
 *
 * 中心语义沿革（2026-10-28 改版）：旧语义 cx/cy 是帧画布坐标、
 * 兼任对位点——中心与锚点永远重合，改 cx/cy 对画面零作用（仅
 * 帧尺寸变）。现改为相对锚点的偏移；旧语义下任何规格的扇面相
 * 对锚点偏移恒为 0，故存量工程一次性迁移 cx/cy 归零即逐像素
 * 保真（帧尺寸随覆盖盒新定义变化、画面相对锚点不变），标记
 * slashCenterVersion，见 store 导入规范化链。
 *
 * 前沿弧度与图层段（2026-11 追加）：headCurve 按带内径向位置 s
 * 的圆弧剖面 (1 − (2s−1)²) 调整前沿阈值 headEff——正值前沿中段
 * 后缩、负值外凸，缺省 0 时 headEff = head、与旧行为逐像素一致。
 * layerSegs 按进度 p 分段指定刀光画在角色前/后（归一化与查询见
 * normalizeSlashLayerSegs / slashLayerAt；无有效段 = 全程在前），
 * 绘制分遍由消费端负责。mode = 'trail' 时改走轨迹带生成器
 * （slash-trail.ts），与本文件共用头尾窗 slashWindow 与调色板。
 */

/** 刀光图层段：按进度 p 分段指定刀光画在角色前（front）还是
 * 后（back）。until = 该段覆盖到的进度上界（0, 1]；段表经
 * normalizeSlashLayerSegs 归一化后按 until 升序、末段 until = 1。
 * 无有效段 = 全程在前。 */
export interface SlashLayerSeg {
  until: number;
  layer: 'front' | 'back';
}

export interface SlashFanSpec {
  /** 锚点节点 id：刀光在表演/片段开始时定格锚点的位姿（位置+角度），之后不跟随 */
  anchorNodeId: string;
  /** 生成模式：'fan' / 缺省 = 椭圆扇面；'trail' = 轨迹带——片段窗
   * 内采样锚点（刃根）与 tipNodeId（刃尖）的运动成带，见
   * slash-trail.ts */
  mode?: 'fan' | 'trail';
  /** 轨迹模式的刃尖节点 id（anchorNodeId 为刃根）；扇面模式不用 */
  tipNodeId?: string;
  /** 持续秒数；缺省/0 = 跟随所属表演（片段则为片段窗时长） */
  durationSec?: number;
  /** 生成帧数（2–12，默认 6） */
  frameCount: number;
  /** 覆盖盒宽/高 px（默认 64×64）：以锚点为中心的覆盖范围，
   *  几何超出时有效帧随几何长大（并集不裁） */
  w: number;
  h: number;
  /** 椭圆中心相对锚点的偏移（锚点本地坐标系，px，可正负）：
   *  对位点（plug）恒为锚点定格位置、不是参数；改 cx/cy =
   *  扇面整体相对锚点平移 */
  cx: number;
  cy: number;
  /** 扫向：1 / 缺省 = 顺时针（自起始角向扫过角正向行进）；
   *  -1 = 逆时针（反向行进）。进度语义跟随扫向：头部始终在
   *  行进方向领先、尾部收尖跟随（非静态镜像） */
  dir?: 1 | -1;
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
  /** 扇面前沿弧度 -1..1，缺省 0：正值 = 前沿中段后缩、负值 =
   * 前沿外凸；偏移量按带内径向位置 s 的圆弧剖面
   * (1 − (2s−1)²) 分配——带中段最强、内外两边为 0 */
  headCurve?: number;
  /** 图层段：按进度 p 分段指定刀光画在角色前/后（见
   * SlashLayerSeg）；缺省/空 = 全程在前。消费端绘制时按当帧
   * 图层分两遍夹角色绘制 */
  layerSegs?: SlashLayerSeg[];
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
    cx: 0, cy: 0, rx: 27, ry: 25,
    rotDeg: -12, a0Deg: -150, sweepDeg: 130,
    thick: 0.62, gammaAng: 1.4, softRad: 0.28,
  };
}

export const SLASH_PRESETS: { name: string; params: Partial<SlashFanSpec> }[] = [
  { name: '上挑斩', params: { cx: 0, cy: 0, rx: 27, ry: 25, rotDeg: -12, a0Deg: -150, sweepDeg: 130, thick: 0.62, gammaAng: 1.4, softRad: 0.28 } },
  { name: '横斩', params: { cx: 0, cy: 0, rx: 31, ry: 20, rotDeg: 0, a0Deg: -170, sweepDeg: 150, thick: 0.55, gammaAng: 1.2, softRad: 0.24 } },
  { name: '下劈', params: { cx: 0, cy: 0, rx: 24, ry: 30, rotDeg: 6, a0Deg: 20, sweepDeg: 130, thick: 0.7, gammaAng: 1.6, softRad: 0.3 } },
  { name: '大回旋', params: { cx: 0, cy: 0, rx: 26, ry: 24, rotDeg: 18, a0Deg: -200, sweepDeg: 250, thick: 0.72, gammaAng: 1.1, softRad: 0.32 } },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function smooth01(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * 头尾窗：进度 p → 可见段 [tail, head]（头部先展开、尾部后收走）。
 * 扇面与轨迹带（slash-trail.ts）共用同一节奏，数值不得单边改。
 */
export function slashWindow(p: number): { head: number; tail: number } {
  return {
    head: 0.14 + 0.86 * smooth01(p / 0.58),
    tail: smooth01((p - 0.44) / 0.56) * 1.06,
  };
}

/**
 * 调色板解析：规格自带 ≥2 档颜色则用之、否则用内置调色板，
 * 返回 RGB 三元组列（外弧→内界）。轨迹带生成器共用同一口径。
 */
export function slashPaletteRgb(spec: SlashFanSpec): [number, number, number][] {
  return (spec.colors && spec.colors.length >= 2 ? spec.colors : SLASH_PALETTE).map(hexToRgb);
}

/**
 * 图层段归一化：过滤非法项（until 非有限数、layer 非 front/back）、
 * until 钳到 (0, 1]、按 until 升序、合并相邻同层段（取较大 until）、
 * 末段 until 不足 1 时拉到 1。空/全非法 → []（= 全程在前）。
 */
export function normalizeSlashLayerSegs(
  segs: readonly SlashLayerSeg[] | undefined | null,
): SlashLayerSeg[] {
  if (!segs || segs.length === 0) return [];
  const cleaned: SlashLayerSeg[] = [];
  for (const s of segs) {
    if (!s || typeof s.until !== 'number' || !Number.isFinite(s.until)) continue;
    if (s.layer !== 'front' && s.layer !== 'back') continue;
    cleaned.push({ until: Math.min(1, Math.max(1e-6, s.until)), layer: s.layer });
  }
  cleaned.sort((a, b) => a.until - b.until);
  const merged: SlashLayerSeg[] = [];
  for (const s of cleaned) {
    const prev = merged[merged.length - 1];
    if (prev && prev.layer === s.layer) prev.until = s.until;
    else merged.push({ until: s.until, layer: s.layer });
  }
  if (merged.length > 0) merged[merged.length - 1]!.until = 1;
  return merged;
}

/**
 * 进度 p 处刀光的图层：无有效图层段 → 'front'；否则取第一个
 * until >= p 的段的 layer（段表先经 normalizeSlashLayerSegs
 * 归一化，p 钳 [0, 1]）。
 */
export function slashLayerAt(spec: SlashFanSpec, p: number): 'front' | 'back' {
  const segs = normalizeSlashLayerSegs(spec.layerSegs);
  if (segs.length === 0) return 'front';
  const pc = Math.min(1, Math.max(0, p));
  for (const s of segs) {
    if (pc <= s.until) return s.layer;
  }
  return segs[segs.length - 1]!.layer;
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
 * 有效帧布局 = 用户盒 ∪ 几何紧包围盒（见文件头），锚点本地系：
 * 几何盒 = 扇形外弧（半径 1.22 含辉光）在扫过角全程内的极值
 * （候选点 = 两端点 + 外弧上 x/y 驻点（扇区内才算）+ 椭圆中心）
 * 再平移到椭圆中心 (cx, cy)；用户盒以锚点为中心。plug = 锚点
 * 在帧内位置。扫向 dir 只改扇区行进方向：端点取 a0 与
 * a0 + dir·sweep、扇区判定按带符号角距。
 */
export function slashFrameLayout(spec: SlashFanSpec): SlashFrameLayout {
  const outW = Math.max(4, Math.round(spec.w));
  const outH = Math.max(4, Math.round(spec.h));
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rot = (spec.rotDeg * Math.PI) / 180;
  const a0 = (spec.a0Deg * Math.PI) / 180;
  const dirSign = spec.dir === -1 ? -1 : 1;
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
  eat(a0 + dirSign * sweep);
  const TWO_PI = Math.PI * 2;
  const inRange = (t: number) => {
    let r = (dirSign * (t - a0)) % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r <= sweep + 1e-12;
  };
  const tx = Math.atan2(-(ry * sr), rx * cr);
  if (inRange(tx)) eat(tx);
  if (inRange(tx + Math.PI)) eat(tx + Math.PI);
  const ty = Math.atan2(ry * cr, rx * sr);
  if (inRange(ty)) eat(ty);
  if (inRange(ty + Math.PI)) eat(ty + Math.PI);
  const ux0 = Math.min(-outW / 2, spec.cx + gx0), ux1 = Math.max(outW / 2, spec.cx + gx1);
  const uy0 = Math.min(-outH / 2, spec.cy + gy0), uy1 = Math.max(outH / 2, spec.cy + gy1);
  const ox = Math.floor(ux0), oy = Math.floor(uy0);
  return {
    w: Math.ceil(ux1) - ox,
    h: Math.ceil(uy1) - oy,
    plugX: -ox,
    plugY: -oy,
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
  const palette = slashPaletteRgb(spec);

  // 椭圆中心在帧内 = plug（锚点） + 偏移 (cx, cy)
  const cx = lay.plugX + spec.cx, cy = lay.plugY + spec.cy;
  const rx = Math.max(2, spec.rx), ry = Math.max(2, spec.ry);
  const rotRad = (spec.rotDeg * Math.PI) / 180;
  const a0 = (spec.a0Deg * Math.PI) / 180;
  const dirSign = spec.dir === -1 ? -1 : 1;
  const sweep = Math.max(0.06, Math.min(5.8, (spec.sweepDeg * Math.PI) / 180));
  const thick = Math.max(0.04, Math.min(0.97, spec.thick));
  const gammaAng = Math.max(0.25, spec.gammaAng);
  const softRad = Math.max(0.01, spec.softRad);
  const TWO_PI = Math.PI * 2;

  const cosR = Math.cos(-rotRad), sinR = Math.sin(-rotRad);

  // 扫过进度：头部先出，尾部后收（头尾窗与轨迹带共用同一节奏）
  const { head, tail } = slashWindow(p);
  const headCurve = Math.max(-1, Math.min(1, spec.headCurve ?? 0));
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
        // 参数角（按扫向取带符号角距：逆时针时自 a0 反向行进，
        // u 仍为 0=尾端(a0) → 1=头端，头部领先语义跟随扫向）
        const t = Math.atan2(ey, ex);
        let rel = dirSign * (t - a0);
        rel = ((rel % TWO_PI) + TWO_PI) % TWO_PI;
        if (rel > sweep) continue;
        const u = rel / sweep;
        // 角向归一化位置：0 = 尾部，1 = 头部。钳到 1：headCurve
        // 外凸时新增的 u > head 像素按头部取值着色（避免亮度溢
        // 出）；headCurve = 0 时 u 本就在 [tail, head] 内、钳制
        // 无副作用。头尾窗判定移到带内 s 算出之后（headEff 需要
        // s），辉光区仍在 else 分支内按原窗判定。
        const uNorm = Math.min(1, (u - tail) / Math.max(0.001, head - tail));
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
          // 头尾窗（含前沿弧度）：headCurve 按圆弧剖面
          // (1 − (2s−1)²) 调整前沿——带中段最强、内外两边为 0；
          // headCurve = 0 时 headEff = head，与旧口径逐像素一致
          const headEff = head - headCurve * 0.3 * (1 - (2 * s - 1) * (2 * s - 1));
          if (u < tail || u > headEff) continue;
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
          // 辉光区无带内 s，前沿弧度不作用于此，按原头尾窗判定
          if (u < tail || u > head) continue;
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
