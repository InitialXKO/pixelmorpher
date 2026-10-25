// ============================================================
// 动态模式库：模板 = 形变段 + 发射段 + 粒子段（参数化预设），
// 使用模型与静态模式库一致（内置模板 + 滑杆调参 + 我的模板）。
// 双挂载：同一模板实例可挂在节点（角色固有，不随换装变）或服装件
// （随当前服装集生效）。解析口径：按「效果位 slot」合并——服装件
// 同位实例替换节点实例；服装件同位「关闭」实例压掉节点实例；
// 不同效果位叠加运行。形变是节点精灵的本地叠加层（乘在现有
// scaleX/stretch 上），不替代蓝图与关键帧；粒子活在节点本地
// 绘制层（枢轴原点），不写回精灵像素。
// ============================================================

export type DynamicEmitSource = 'contour' | 'contour-top' | 'contour-bottom' | 'inside' | 'plug';
export type DynamicLayer = 'back' | 'front' | 'both';

export interface DynamicPatternParams {
  // 形变段（以枢轴为锚的挤压拉伸，波形为正弦脉冲 0..1）
  deformEnabled: boolean;
  squashY: number;    // 脉冲峰值时的 Y 缩放（<1 压扁）
  stretchX: number;   // 脉冲峰值时的 X 缩放（>1 拉宽）
  deformHz: number;   // 频率（次/秒）
  deformPhase: number; // 相位（周期数 0..1）
  // 置换段（D2，形变段的逐像素子段）：按值噪声场沿方向逐像素
  // 偏移采样——热浪/水面波动/火焰摇曳类。纯函数：相位由
  // frac(t×流速 + 相位) 给出，场在流动方向上以 K 个噪声格为
  // 周期（相位 1 ≡ 相位 0 逐像素恒等）。多实例同挂时只取第一
  // 个启用置换（编辑器与导出运行时同一口径）。
  displaceEnabled: boolean;
  displaceAmp: number;   // 置换幅度（px，沿方向峰值；垂直分量为其半）
  displaceFreq: number;  // 噪声频率（格/px）
  displaceDeg: number;   // 置换方向角（度，屏幕口径：0=东 90=南 180=西 270=北）
  displaceSpeed: number; // 场流动速度（圈/秒，0 = 冻结的静态扭曲）
  displacePhase: number; // 相位（周期数 0..1）
  // 自转段（D3，形变段子段）：精灵绕自身枢轴原地自转（不沿
  // 层级传播、不挪部件中心）——法阵/传送门/护盾类。纯函数：
  // 角 = 速度 × t + 相位；多实例的角度在消费端求和。
  spinEnabled: boolean;
  spinSpeedDeg: number;  // 角速度（度/秒，可负 = 反向）
  spinPhaseDeg: number;  // 相位偏置（度）
  // 追随段（形变段的跨部件驱动）：本部件渲染时叠加「源部件位姿的
  // 滞后差」——源部件当前位姿与 delay 秒前位姿之差 × amount，
  // 本部件就像被源部件拖着、慢半拍跟上（垂饰/披风/头发的次级运动）。
  // 无状态纯函数：任意帧只由源部件在 t 与 t−delay 的位姿决定。
  followEnabled: boolean;
  followSource: string;   // 源部件槽位键（slotKey）；空 = 未选源、不生效
  followDelaySec: number; // 滞后（秒）
  followAmount: number;   // 跟随强度 0..1（1 = 完全按滞后位姿走）
  followRotate: boolean;  // 是否连源部件的旋转滞后一起跟
  // 发射段
  emitEnabled: boolean;
  source: DynamicEmitSource;
  rate: number;          // 每秒生成数（峰值，受 linkToDeform 调制）
  linkToDeform: number;  // 发射率随形变脉冲的调制深度 0..1（0=恒定）
  speed: number;         // 初速（px/秒，沿发射方向 + 法线混合）
  directionDeg: number;  // 发射方向角（度，屏幕口径：0=东 90=南 180=西 270=北）
  spreadDeg: number;     // 方向散布（度）
  layer: DynamicLayer;   // 绘制层：身后 / 身前 / 两层按比例
  frontRatio: number;    // layer=both 时落身前的比例
  // 粒子段
  life: number;          // 生命（秒）
  sizeStart: number;     // 出生直径（px）
  sizeEnd: number;       // 死亡直径（px）
  rise: number;          // 上浮漂移（px/秒，负=下沉）
  buoy: number;          // 浮力加速度（px/秒²，正=向上，负=坠落）
  turbulence: number;    // 横向摆动幅度（px）
  color: string;         // 粒子颜色（#rrggbb，径向渐隐绘制）
  alpha: number;         // 峰值不透明度 0..1
  maxParticles: number;  // 单实例同时存活上限
  // 发光段（原地发光：选区内像素随呼吸曲线提亮，并向外扩一圈柔光）
  glowEnabled: boolean;
  glowColor: string;        // 辉光颜色（#rrggbb）：柔光圈颜色与提亮染色
  glowStrength: number;     // 峰值发光强度 0..2
  glowHz: number;           // 呼吸频率（次/秒）
  glowPhase: number;        // 相位（周期数 0..1）
  glowHalo: number;         // 柔光圈宽（px，0 = 只亮选区内）
  glowMaskSource: GlowMaskSource; // 选区来源：取色 / 手动标记
  glowPick: string;         // 取色选区：目标颜色（#rrggbb）
  glowTolerance: number;    // 取色容差 0..1（RGB 距离归一化；0 = 精确同色）
  glowMask?: GlowMaskData;  // 手动标记选区：位打包掩码（行优先，1 = 选中）
  glowFollowGroup: number;  // 第 4 个起的发光实例并入哪一组（0/1/2 = 第 1/2/3 组，
                            // 颜色与呼吸参数跟该组；自己的选区照常生效）。前 3 个不用此字段。
  glowShape: GlowShape;     // 柔光圈形状（衰减印章的几何）；square = 一直以来的方形圈
  glowShapeKernel?: GlowMaskData; // shape=custom 时的自绘印章轮廓（位打包，中心为印章中心）
  glowStarReach: number;    // 星形伸长：星芒沿轴向可达距离 ÷ 圈宽（1 = 与圈宽同距）
  glowFlameReach: number;   // 焰形伸长：焰尖向上可达距离 ÷ 圈宽
  glowAngleDeg: number;     // 辉光主方向（度，屏幕口径 0=东 90=南 180=西 270=北）：
                            // 星形 = 一条星芒的指向、焰形 = 焰尖指向、自定义 = 印章上方指向
  glowAngleSpace: 'sprite' | 'world'; // 方向基准：sprite = 跟随精灵旋转（缺省）；world = 恒为世界方向
}

/** 追随段的位姿（弧度 + px；空间由调用方定：编辑器画布系/运行时系，
 * 同一公式、各自空间内取样与应用，增量在两系间只差 y 与角度的符号约定） */
export interface FollowPose { a: number; x: number; y: number }

/** 追随增量：源部件滞后位姿 − 当前位姿，按强度缩放；角度差归一到
 * [−π, π]（跨 ±π 时取近路）。运行时孪生 = DYNAMIC_SRC 的 dynFollowDelta。 */
export function followDeltaAt(
  now: FollowPose,
  lag: FollowPose,
  amount: number,
  rotate: boolean,
): { dx: number; dy: number; da: number } {
  const k = Math.max(0, Math.min(1, amount));
  const raw = lag.a - now.a;
  const da = Math.atan2(Math.sin(raw), Math.cos(raw));
  return {
    dx: (lag.x - now.x) * k,
    dy: (lag.y - now.y) * k,
    da: rotate ? da * k : 0,
  };
}

/** 发光选区来源：color = 按像素颜色取色；marked = 手动标记的像素掩码 */
export type GlowMaskSource = 'color' | 'marked';

/** 柔光圈形状：square 方形圈（八邻域逐圈外扩）/ circle 圆形 / star 十字星形
 * （沿横竖轴伸长、对角收短）/ flame 焰形（向上伸长收尖、下方收短）/ custom 自绘印章 */
export type GlowShape = 'square' | 'circle' | 'star' | 'flame' | 'custom';

/** 手动标记掩码：bits 为 base64 位打包（行优先，每像素 1 位） */
export interface GlowMaskData {
  w: number;
  h: number;
  bits: string;
}

export interface DynamicPatternInstance {
  id: string;
  /** 效果位：双挂载合并的键（同位替换/压制） */
  slot: string;
  templateName?: string;
  enabled: boolean;
  params: DynamicPatternParams;
  /** 库引用（钉版本，DESIGN-DAG-LIBRARY）：params 是该引用的展开
   * 快照——编辑器在引用/覆盖变化时重展开保持新鲜，convert 拿到
   * 条目库时按钉版本权威重展开；缺省 = 内联实例（params 即定义） */
  patternRef?: { id: string; version: number };
  /** 挂载覆盖（链末裁决，不受参数口限）：展开时最后应用 */
  overrides?: Partial<DynamicPatternParams>;
}

export interface ResolvedDynamicPattern {
  instance: DynamicPatternInstance;
  origin: 'node' | 'costume';
}

export function defaultDynamicParams(): DynamicPatternParams {
  return {
    deformEnabled: false, squashY: 0.85, stretchX: 1.1, deformHz: 1, deformPhase: 0,
    displaceEnabled: false, displaceAmp: 2.5, displaceFreq: 0.12, displaceDeg: 270,
    displaceSpeed: 0.25, displacePhase: 0,
    spinEnabled: false, spinSpeedDeg: 45, spinPhaseDeg: 0,
    followEnabled: false, followSource: '', followDelaySec: 0.12, followAmount: 0.7, followRotate: true,
    emitEnabled: true, source: 'contour', rate: 12, linkToDeform: 0, speed: 6,
    directionDeg: 270, spreadDeg: 60, layer: 'both', frontRatio: 0.35,
    life: 0.9, sizeStart: 3, sizeEnd: 8, rise: 12, buoy: 0, turbulence: 4,
    color: '#ffb46b', alpha: 0.5, maxParticles: 90,
    glowEnabled: false, glowColor: '#7dd7ff', glowStrength: 1, glowHz: 0.8,
    glowPhase: 0, glowHalo: 2, glowMaskSource: 'color', glowPick: '#2ea8ff',
    glowTolerance: 0, glowMask: undefined, glowFollowGroup: 2,
    glowShape: 'square', glowShapeKernel: undefined,
    glowStarReach: 1.2, glowFlameReach: 1.8, glowAngleDeg: 270, glowAngleSpace: 'sprite',
  };
}

/** 补齐缺省字段（旧工程存的实例没有发光段等新字段，读取处一律过这里） */
export function normalizeDynamicParams(p: DynamicPatternParams): DynamicPatternParams {
  const out = { ...defaultDynamicParams(), ...p };
  if (out.glowFollowGroup !== 0 && out.glowFollowGroup !== 1 && out.glowFollowGroup !== 2) {
    out.glowFollowGroup = 2;
  }
  if (!['square', 'circle', 'star', 'flame', 'custom'].includes(out.glowShape)) {
    out.glowShape = 'square';
  }
  out.glowStarReach = Number.isFinite(out.glowStarReach)
    ? Math.max(1, Math.min(2.5, out.glowStarReach)) : 1.2;
  out.glowFlameReach = Number.isFinite(out.glowFlameReach)
    ? Math.max(1, Math.min(3.5, out.glowFlameReach)) : 1.8;
  out.glowAngleDeg = Number.isFinite(out.glowAngleDeg)
    ? ((out.glowAngleDeg % 360) + 360) % 360 : 270;
  if (out.glowAngleSpace !== 'world') out.glowAngleSpace = 'sprite';
  if (typeof out.followSource !== 'string') out.followSource = '';
  out.followDelaySec = Number.isFinite(out.followDelaySec)
    ? Math.max(0, Math.min(1, out.followDelaySec)) : 0.12;
  out.followAmount = Number.isFinite(out.followAmount)
    ? Math.max(0, Math.min(1, out.followAmount)) : 0.7;
  out.followRotate = out.followRotate !== false;
  out.displaceEnabled = out.displaceEnabled === true;
  out.displaceAmp = Number.isFinite(out.displaceAmp)
    ? Math.max(0, Math.min(8, out.displaceAmp)) : 2.5;
  out.displaceFreq = Number.isFinite(out.displaceFreq)
    ? Math.max(0.02, Math.min(0.6, out.displaceFreq)) : 0.12;
  out.displaceDeg = Number.isFinite(out.displaceDeg)
    ? ((out.displaceDeg % 360) + 360) % 360 : 270;
  out.displaceSpeed = Number.isFinite(out.displaceSpeed)
    ? Math.max(0, Math.min(2, out.displaceSpeed)) : 0.25;
  out.displacePhase = Number.isFinite(out.displacePhase)
    ? ((out.displacePhase % 1) + 1) % 1 : 0;
  out.spinEnabled = out.spinEnabled === true;
  out.spinSpeedDeg = Number.isFinite(out.spinSpeedDeg)
    ? Math.max(-360, Math.min(360, out.spinSpeedDeg)) : 45;
  out.spinPhaseDeg = Number.isFinite(out.spinPhaseDeg)
    ? ((out.spinPhaseDeg % 360) + 360) % 360 : 0;
  return out;
}

export function createDynamicInstance(
  templateName: string,
  params: DynamicPatternParams,
  slot = '环境效果',
): DynamicPatternInstance {
  return {
    id: `dyn_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    slot,
    templateName,
    enabled: true,
    params: structuredClone(params),
  };
}

/** 双挂载解析：节点为底，服装件同效果位替换、同位关闭压制 */
export function resolveDynamicPatterns(
  nodeList?: DynamicPatternInstance[],
  pieceList?: DynamicPatternInstance[],
): ResolvedDynamicPattern[] {
  const map = new Map<string, ResolvedDynamicPattern>();
  const norm = (inst: DynamicPatternInstance): DynamicPatternInstance =>
    ({ ...inst, params: normalizeDynamicParams(inst.params) });
  for (const inst of nodeList ?? []) {
    if (inst.enabled) map.set(inst.slot, { instance: norm(inst), origin: 'node' });
  }
  for (const inst of pieceList ?? []) {
    if (!inst.enabled) {
      map.delete(inst.slot);
      continue;
    }
    map.set(inst.slot, { instance: norm(inst), origin: 'costume' });
  }
  return [...map.values()];
}

/** 发光分组：解析序里前 3 个启用发光的实例各成一组（颜色/强度/频率/相位
 * 以它为准）；第 4 个起不再独立成组，按各自的 glowFollowGroup 并入所选组，
 * 只贡献自己的选区（取色/标记/圈宽）。主画布与运行时包共用此口径。 */
export interface ResolvedGlowGroup {
  /** 组参数来源（前 3 个实例之一）：颜色、强度、呼吸频率/相位以它为准 */
  representative: DynamicPatternParams;
  /** 本组全部选区来源（含 representative 自己），按解析序 */
  contributors: DynamicPatternParams[];
}

/** 第 4 个起的实例并入哪一组（0/1/2，非法值回落第 3 组） */
export function glowFollowTargetOf(params: DynamicPatternParams): 0 | 1 | 2 {
  const v = Math.round(params.glowFollowGroup ?? 2);
  return v === 0 || v === 1 ? (v as 0 | 1) : 2;
}

export function resolveGlowGroups(paramsList: DynamicPatternParams[]): ResolvedGlowGroup[] {
  const glows = paramsList.filter((p) => p.glowEnabled);
  const groups: ResolvedGlowGroup[] = glows.slice(0, 3).map((p) => ({
    representative: p,
    contributors: [p],
  }));
  for (const p of glows.slice(3)) {
    const g = groups[glowFollowTargetOf(p)];
    if (g) g.contributors.push(p);
  }
  return groups;
}

/** 双挂载解析后，各启用发光实例的组序（实例 id → 0 起序数；编辑器判「超过第 3 个」用） */
export function glowRankByInstanceId(
  nodeList?: DynamicPatternInstance[],
  pieceList?: DynamicPatternInstance[],
): Map<string, number> {
  const map = new Map<string, number>();
  let rank = 0;
  for (const r of resolveDynamicPatterns(nodeList, pieceList)) {
    if (r.instance.params.glowEnabled) map.set(r.instance.id, rank++);
  }
  return map;
}

/** 形变段在 t 秒的取值：脉冲 p∈0..1 驱动缩放，amount=p 供发射调制 */
export function dynamicDeformAt(
  params: DynamicPatternParams,
  tSec: number,
): { sx: number; sy: number; amount: number } {
  if (!params.deformEnabled) return { sx: 1, sy: 1, amount: 0 };
  const p = (Math.sin(2 * Math.PI * (params.deformHz * tSec + params.deformPhase)) + 1) / 2;
  return {
    sx: 1 + (params.stretchX - 1) * p,
    sy: 1 + (params.squashY - 1) * p,
    amount: p,
  };
}

// ---- 置换段（D2）：值噪声置换场。运行时孪生 = DYNAMIC_SRC 的
// dynValueNoiseU / dynDisplaceSrcMap（探针 R 组逐值对齐）。 ----

/** 与 dynHash01 / dynamic-pattern-sim 的 hash01 同一 FNV 混合 */
function displaceHash01(...nums: number[]): number {
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

/** u 轴周期值噪声：格点哈希的 u 索引按 period 取模（跨界插值
 * 回绕），故采样坐标 u 平移整数个 period 时场逐点恒等。 */
export function displaceNoiseU(u: number, v: number, period: number, seed: number): number {
  const xi = Math.floor(u), yi = Math.floor(v);
  const xf = u - xi, yf = v - yi;
  const su = xf * xf * (3 - 2 * xf), sv = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const a = displaceHash01(x0, yi, seed), b = displaceHash01(x1, yi, seed);
  const c = displaceHash01(x0, yi + 1, seed), d = displaceHash01(x1, yi + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** 置换场的流动周期（噪声格数）：相位每圈沿方向平移此格数 */
export const DISPLACE_PERIOD_CELLS = 8;

/**
 * 置换源图（图像空间：x 右、y 下，行优先）：dst 像素 i 的值 =
 * src[srcMap[i]]，-1 = 空。phase ∈ 0..1（1 ≡ 0，周期闭合）。
 * 后向采样 + 就近取整（像素风不插值）；位移 = 方向分量
 * （噪声1，峰值 amp）+ 垂直分量（噪声2，峰值 amp/2）。
 */
export function displaceSrcMap(
  params: DynamicPatternParams,
  w: number,
  h: number,
  phase: number,
): Int32Array {
  const out = new Int32Array(w * h);
  const amp = params.displaceEnabled ? Math.max(0, params.displaceAmp || 0) : 0;
  if (amp <= 0) {
    for (let i = 0; i < w * h; i++) out[i] = i;
    return out;
  }
  const f = Math.max(0.005, params.displaceFreq || 0.12);
  const rad = ((params.displaceDeg || 0) * Math.PI) / 180;
  const dirX = Math.cos(rad), dirY = Math.sin(rad);
  const K = DISPLACE_PERIOD_CELLS;
  const ph = ((phase % 1) + 1) % 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x * dirX + y * dirY;   // 沿方向坐标（px）
      const v = -x * dirY + y * dirX;  // 垂直坐标（px）
      const n1 = displaceNoiseU(u * f + ph * K, v * f, K, 7717);
      // 周期纪律：两路噪声的相位偏移都必须是周期 K 的整数倍，
      // 否则相位 1 ≠ 相位 0（n2 走 2 倍速 = 偏移 2K，仍恒等）
      const n2 = displaceNoiseU(u * f * 1.7 + ph * K * 2, v * f * 1.7 + 13.31, K, 31337);
      const a = (n1 - 0.5) * 2 * amp;
      const b = (n2 - 0.5) * 2 * amp * 0.5;
      const dx = dirX * a - dirY * b;
      const dy = dirY * a + dirX * b;
      const sx = Math.round(x - dx), sy = Math.round(y - dy);
      out[y * w + x] = sx < 0 || sy < 0 || sx >= w || sy >= h ? -1 : sy * w + sx;
    }
  }
  return out;
}

/** 把置换场作用到像素格（编辑器主画布 / 定格图用）：返回新格 */
export function displacePixelGrid<T>(
  grid: readonly (readonly T[])[],
  params: DynamicPatternParams,
  phase: number,
): T[][] {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const map = displaceSrcMap(params, w, h, phase);
  const out: T[][] = new Array(h);
  for (let y = 0; y < h; y++) {
    const row = new Array<T>(w);
    for (let x = 0; x < w; x++) {
      const s = map[y * w + x]!;
      row[x] = s < 0 ? (null as T) : grid[Math.floor(s / w)]![s % w]!;
    }
    out[y] = row;
  }
  return out;
}

/** t 秒 → 置换相位（圈）：frac(t × 流速 + 相位偏置） */
export function displacePhaseAt(params: DynamicPatternParams, tSec: number): number {
  const raw = tSec * (params.displaceSpeed || 0) + (params.displacePhase || 0);
  return ((raw % 1) + 1) % 1;
}

/** 自转段在 t 秒的角度（度，未取模——消费端多实例求和后自行
 * 取模/转弧度）。运行时孪生 = DYNAMIC_SRC 的 dynSpinRadAt。 */
export function spinAngleDegAt(params: DynamicPatternParams, tSec: number): number {
  if (!params.spinEnabled) return 0;
  return (params.spinSpeedDeg || 0) * tSec + (params.spinPhaseDeg || 0);
}

// ---- 发光段：呼吸脉冲 + 选区掩码 + 带柔光圈的权重场 ----

/** 发光段在 t 秒的呼吸脉冲 0..1（与形变段同一正弦口径） */
export function glowPulseAt(params: DynamicPatternParams, tSec: number): number {
  if (!params.glowEnabled) return 0;
  return (Math.sin(2 * Math.PI * (params.glowHz * tSec + params.glowPhase)) + 1) / 2;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 位打包掩码 → base64（行优先，每像素 1 位） */
export function packMaskBits(cells: Uint8Array): string {
  let out = '';
  for (let i = 0; i < cells.length; i += 6) {
    let v = 0;
    for (let k = 0; k < 6; k++) if (cells[i + k]) v |= 1 << (5 - k);
    out += B64_ALPHABET[v];
  }
  return out;
}

/** 字节数组 → base64（无填充；解码端用 atob 补填充） */
export function packBytesBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64_ALPHABET[a >> 2] + B64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64_ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64_ALPHABET[c & 63];
  }
  return out;
}

/** base64 → 位打包掩码（count = w*h，多余位丢弃） */
export function unpackMaskBits(bits: string, count: number): Uint8Array {
  const cells = new Uint8Array(count);
  for (let i = 0; i < bits.length; i++) {
    const v = B64_ALPHABET.indexOf(bits[i]);
    if (v < 0) continue;
    for (let k = 0; k < 6; k++) {
      const idx = i * 6 + k;
      if (idx < count && (v & (1 << (5 - k)))) cells[idx] = 1;
    }
  }
  return cells;
}

/** 布尔网格 → 手动标记掩码数据 */
export function encodeGlowMask(grid: boolean[][]): GlowMaskData {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y][x]) cells[y * w + x] = 1;
  return { w, h, bits: packMaskBits(cells) };
}

function normHex(c: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(c.trim());
  return m ? `#${m[1].toLowerCase()}` : c.toLowerCase();
}

/**
 * 按选区来源算出部件网格上的发光选区（1 = 选中）。无选中返回 null。
 * 取色：与 glowPick 的 RGB 距离 ≤ glowTolerance（0 = 精确同色，不分大小写；透明格不选）。
 * 手动标记：读 glowMask 位打包，坐标对齐网格左上，越界丢弃。
 */
export function glowMaskCells(
  params: DynamicPatternParams,
  grid: import('./unified-types').PixelGrid,
): Uint8Array | null {
  if (!params.glowEnabled) return null;
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  if (!w || !h) return null;
  const cells = new Uint8Array(w * h);
  let any = false;
  if (params.glowMaskSource === 'marked') {
    const m = params.glowMask;
    if (!m || !m.w || !m.h) return null;
    const src = unpackMaskBits(m.bits, m.w * m.h);
    const mw = Math.min(w, m.w);
    const mh = Math.min(h, m.h);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (src[y * m.w + x]) { cells[y * w + x] = 1; any = true; }
      }
    }
  } else {
    const pick = normHex(params.glowPick || '');
    if (!pick.startsWith('#')) return null;
    const tol = Math.max(0, Math.min(1, params.glowTolerance || 0));
    if (tol <= 0) {
      for (let y = 0; y < h; y++) {
        const row = grid[y];
        for (let x = 0; x < w; x++) {
          const c = row[x];
          if (c && normHex(c) === pick) { cells[y * w + x] = 1; any = true; }
        }
      }
    } else {
      // 容差选色：RGB 距离（归一化到 0..1）≤ 容差即选中——渐变美术下
      // 一次选住整片同色系；透明格永不选中。
      const pr = parseInt(pick.slice(1, 3), 16);
      const pg = parseInt(pick.slice(3, 5), 16);
      const pb = parseInt(pick.slice(5, 7), 16);
      const maxD = tol * 441.673; // sqrt(3)*255
      for (let y = 0; y < h; y++) {
        const row = grid[y];
        for (let x = 0; x < w; x++) {
          const c = row[x];
          if (!c) continue;
          const m = /^#([0-9a-fA-F]{6})$/.exec(c.trim());
          if (!m) continue;
          const dr = parseInt(m[1].slice(0, 2), 16) - pr;
          const dg = parseInt(m[1].slice(2, 4), 16) - pg;
          const db = parseInt(m[1].slice(4, 6), 16) - pb;
          if (Math.sqrt(dr * dr + dg * dg + db * db) <= maxD) { cells[y * w + x] = 1; any = true; }
        }
      }
    }
  }
  return any ? cells : null;
}

/** 柔光圈印章：相对选区像素的偏移权重表（中心权重 1，向外衰减）。
 * square 与旧逐圈外扩逐值一致（切比雪夫距离、线性衰减）；circle 用欧氏
 * 距离；star 星芒沿轴向伸长（glowStarReach 倍）、对角收至 0.45 倍；flame
 * 向主方向拉长（glowFlameReach 倍）且随高度收窄（横向 ×(1+高度×0.3)）、
 * 反向压短（×1.7）；custom 用自绘轮廓：权重 = 轮廓内到边界的深度占比。
 * 方向：glowAngleDeg 为主方向（屏幕口径）；基准为 world 时再减去
 * frameAngleDeg（精灵当前世界角，由调用方给），形状不跟随精灵旋转。 */
function glowStamp(
  params: DynamicPatternParams,
  frameAngleDeg = 0,
): { dx: number; dy: number; w: number }[] {
  const halo = Math.max(0, Math.min(8, Math.round(params.glowHalo || 0)));
  const shape = params.glowShape ?? 'square';
  const mainDeg = (params.glowAngleDeg ?? 270)
    - (params.glowAngleSpace === 'world' ? frameAngleDeg : 0);
  // 印章原生主方向：star 的星芒沿坐标轴（基准 0°），flame/custom 原生向上（基准 270°）
  const phiDeg = shape === 'star' ? mainDeg : mainDeg - 270;
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  if (shape === 'custom') {
    const k = params.glowShapeKernel;
    if (k && k.w > 0 && k.h > 0) {
      const cells = unpackMaskBits(k.bits, k.w * k.h);
      if (cells.some((c) => c)) {
        const depth = new Int16Array(k.w * k.h);
        let maxD = 1;
        for (let y = 0; y < k.h; y++) {
          for (let x = 0; x < k.w; x++) {
            if (!cells[y * k.w + x]) continue;
            let d = 0;
            for (let r = 1; r <= Math.max(k.w, k.h); r++) {
              let edge = false;
              for (let dy = -r; dy <= r && !edge; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                  if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                  const nx = x + dx, ny = y + dy;
                  if (nx < 0 || ny < 0 || nx >= k.w || ny >= k.h || !cells[ny * k.w + nx]) { edge = true; break; }
                }
              }
              if (edge) { d = r; break; }
              d = r;
            }
            depth[y * k.w + x] = d;
            if (d > maxD) maxD = d;
          }
        }
        const cx = Math.floor(k.w / 2), cy = Math.floor(k.h / 2);
        const byKey = new Map<string, { dx: number; dy: number; w: number }>();
        for (let y = 0; y < k.h; y++) {
          for (let x = 0; x < k.w; x++) {
            const d = depth[y * k.w + x];
            if (d <= 0) continue;
            const ox = x - cx, oy = y - cy;
            const rx = Math.round(ox * cosP - oy * sinP);
            const ry = Math.round(ox * sinP + oy * cosP);
            const key = `${rx},${ry}`;
            const wgt = d / maxD;
            const prev = byKey.get(key);
            if (!prev || wgt > prev.w) byKey.set(key, { dx: rx, dy: ry, w: wgt });
          }
        }
        if (byKey.size > 0) return [...byKey.values()];
      }
    }
    // 没有可用印章时回落方形（与缺省形状一致，不静默消失）
  }
  if (halo <= 0) return [{ dx: 0, dy: 0, w: 1 }];
  const reach = shape === 'star'
    ? Math.max(1, Math.min(2.5, params.glowStarReach || 1.2))
    : shape === 'flame'
      ? Math.max(1, Math.min(3.5, params.glowFlameReach || 1.8))
      : 1;
  const out: { dx: number; dy: number; w: number }[] = [];
  const R = shape === 'star' || shape === 'flame' ? Math.ceil(halo * reach) + 1 : halo;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let wgt = 0;
      if (shape === 'circle') {
        const d = Math.hypot(dx, dy);
        if (d <= halo) wgt = 1 - d / (halo + 1);
      } else if (shape === 'star' || shape === 'flame') {
        // 先转回印章原生坐标（逆旋转），再按原生形状求值
        const lx = dx * cosP + dy * sinP;
        const ly = -dx * sinP + dy * cosP;
        if (shape === 'star') {
          const d = Math.hypot(lx, ly);
          if (d > 0) {
            const axis = Math.abs(Math.cos(2 * Math.atan2(ly, lx)));
            const f = 0.45 + (reach - 0.45) * Math.pow(axis, 1.5);
            const dEff = d / f;
            if (dEff <= halo) wgt = 1 - dEff / (halo + 1);
          } else wgt = 1;
        } else {
          const dxs = ly < 0 ? lx * (1 + (-ly) * 0.3) : lx;
          const dys = ly < 0 ? ly / reach : ly * 1.7;
          const d = Math.hypot(dxs, dys);
          if (d <= halo) wgt = 1 - d / (halo + 1);
        }
      } else {
        const r = Math.max(Math.abs(dx), Math.abs(dy));
        if (r <= halo) wgt = 1 - r / (halo + 1);
      }
      if (wgt > 0) out.push({ dx, dy, w: wgt });
    }
  }
  return out;
}

/**
 * 发光权重场：选区内 1，柔光圈按印章盖出。返回的场带外扩边距
 * （w/h = 网格 + 2×pad，网格像素 (x,y) 位于场 (x+padX, y+padY)），
 * 辉光可溢出精灵包围盒；frameAngleDeg 供 world 基准方向用（精灵世界角）。
 */
export function glowField(
  params: DynamicPatternParams,
  grid: import('./unified-types').PixelGrid,
  frameAngleDeg = 0,
): { w: number; h: number; field: Float32Array; padX: number; padY: number } | null {
  const cells = glowMaskCells(params, grid);
  if (!cells) return null;
  const h = grid.length;
  const w = grid[0].length;
  const stamp = glowStamp(params, frameAngleDeg);
  let padX = 0, padY = 0;
  for (const s of stamp) {
    if (Math.abs(s.dx) > padX) padX = Math.abs(s.dx);
    if (Math.abs(s.dy) > padY) padY = Math.abs(s.dy);
  }
  const W = w + padX * 2;
  const H = h + padY * 2;
  const field = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue;
      field[(y + padY) * W + (x + padX)] = 1;
      for (const s of stamp) {
        const ni = (y + s.dy + padY) * W + (x + s.dx + padX);
        if (s.w > field[ni]) field[ni] = s.w;
      }
    }
  }
  return { w: W, h: H, field, padX, padY };
}

// ---- 模板库 ----

export interface DynamicPatternTemplate {
  name: string;
  cluster: string;
  params: DynamicPatternParams;
}

function tpl(name: string, cluster: string, over: Partial<DynamicPatternParams>): DynamicPatternTemplate {
  return { name, cluster, params: { ...defaultDynamicParams(), ...over } };
}

export const DYNAMIC_PATTERN_TEMPLATES: DynamicPatternTemplate[] = [
  tpl('挤压冒热气', '形变', {
    deformEnabled: true, squashY: 0.84, stretchX: 1.1, deformHz: 1.2,
    source: 'contour-top', rate: 16, linkToDeform: 0.8, speed: 5,
    life: 0.9, sizeStart: 3, sizeEnd: 9, rise: 16, turbulence: 5,
    color: '#ffb46b', alpha: 0.5,
  }),
  tpl('呼吸起伏', '形变', {
    deformEnabled: true, squashY: 0.96, stretchX: 1.03, deformHz: 0.35,
    emitEnabled: false,
  }),
  tpl('弹跳挤压', '形变', {
    deformEnabled: true, squashY: 0.78, stretchX: 1.18, deformHz: 1.8,
    emitEnabled: false,
  }),
  tpl('垂饰滞后', '形变', {
    followEnabled: true, followDelaySec: 0.12, followAmount: 0.7, followRotate: true,
    emitEnabled: false,
  }),
  tpl('火焰环绕', '元素', {
    source: 'contour', rate: 26, speed: 7, life: 0.6,
    sizeStart: 2, sizeEnd: 5, rise: 20, turbulence: 3,
    color: '#ff7a2a', alpha: 0.65,
  }),
  tpl('水滴滴落', '元素', {
    source: 'contour-bottom', rate: 7, speed: 4, directionDeg: 90, spreadDeg: 30,
    life: 1.1, sizeStart: 2, sizeEnd: 1.5, rise: 0, buoy: -70, turbulence: 0,
    color: '#7ac7ff', alpha: 0.8, layer: 'front', frontRatio: 1,
  }),
  tpl('烟雾缭绕', '氛围', {
    source: 'contour-top', rate: 8, speed: 3, life: 1.8,
    sizeStart: 5, sizeEnd: 14, rise: 10, turbulence: 7,
    color: '#b8b8c8', alpha: 0.32,
  }),
  tpl('星光闪烁', '氛围', {
    source: 'inside', rate: 8, speed: 0, life: 0.7,
    sizeStart: 1, sizeEnd: 2, rise: 0, turbulence: 0,
    color: '#ffe9a0', alpha: 0.85, layer: 'front', frontRatio: 1,
  }),
  tpl('辉光呼吸', '发光', {
    glowEnabled: true, glowHz: 0.7, glowStrength: 1.1, glowHalo: 2,
    glowColor: '#7dd7ff', emitEnabled: false,
  }),
];

export function findDynamicTemplate(name?: string): DynamicPatternTemplate | undefined {
  return DYNAMIC_PATTERN_TEMPLATES.find((t) => t.name === name);
}

// ---- 我的模板（localStorage，与静态模式库同惯例）----

const LS_KEY = 'pm-user-dynamic-patterns-v1';

export function loadUserDynamicPatterns(): DynamicPatternTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as DynamicPatternTemplate[];
    return Array.isArray(arr) ? arr.filter((t) => t && t.name && t.params) : [];
  } catch {
    return [];
  }
}

export function saveUserDynamicPattern(name: string, params: DynamicPatternParams): void {
  try {
    const list = loadUserDynamicPatterns().filter((t) => t.name !== name);
    list.push({ name, cluster: '我的', params: structuredClone(params) });
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch { /* 存储不可用时静默 */ }
}

export function deleteUserDynamicPattern(name: string): void {
  try {
    const list = loadUserDynamicPatterns().filter((t) => t.name !== name);
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch { /* 同上 */ }
}

// ---- 编辑器参数规格（滑杆生成）----

export interface DynamicParamDef {
  key: keyof DynamicPatternParams;
  label: string;
  section: '形变' | '发射' | '粒子' | '发光';
  min: number;
  max: number;
  step: number;
}

export const DYNAMIC_PARAM_DEFS: DynamicParamDef[] = [
  { key: 'squashY', label: '纵向挤压（峰值）', section: '形变', min: 0.5, max: 1.1, step: 0.01 },
  { key: 'stretchX', label: '横向拉伸（峰值）', section: '形变', min: 0.9, max: 1.5, step: 0.01 },
  { key: 'deformHz', label: '形变频率（次/秒）', section: '形变', min: 0, max: 4, step: 0.05 },
  { key: 'deformPhase', label: '形变相位', section: '形变', min: 0, max: 1, step: 0.01 },
  { key: 'displaceAmp', label: '置换幅度（px）', section: '形变', min: 0, max: 8, step: 0.25 },
  { key: 'displaceFreq', label: '置换频率（格/px）', section: '形变', min: 0.02, max: 0.6, step: 0.01 },
  { key: 'displaceDeg', label: '置换方向（度，0=东 90=南 180=西 270=北）', section: '形变', min: 0, max: 359, step: 5 },
  { key: 'displaceSpeed', label: '置换流速（圈/秒）', section: '形变', min: 0, max: 2, step: 0.05 },
  { key: 'displacePhase', label: '置换相位', section: '形变', min: 0, max: 1, step: 0.01 },
  { key: 'spinSpeedDeg', label: '自转速度（度/秒，可负）', section: '形变', min: -360, max: 360, step: 5 },
  { key: 'spinPhaseDeg', label: '自转相位（度）', section: '形变', min: 0, max: 359, step: 5 },
  { key: 'followDelaySec', label: '追随延迟（秒）', section: '形变', min: 0, max: 1, step: 0.01 },
  { key: 'followAmount', label: '追随强度', section: '形变', min: 0, max: 1, step: 0.05 },
  { key: 'rate', label: '发射率（个/秒）', section: '发射', min: 0, max: 60, step: 1 },
  { key: 'linkToDeform', label: '发射随形变调制', section: '发射', min: 0, max: 1, step: 0.05 },
  { key: 'speed', label: '初速（px/秒）', section: '发射', min: 0, max: 40, step: 0.5 },
  { key: 'directionDeg', label: '发射方向角（度）', section: '发射', min: 0, max: 359, step: 5 },
  { key: 'spreadDeg', label: '方向散布（度）', section: '发射', min: 0, max: 180, step: 5 },
  { key: 'frontRatio', label: '身前比例（两层时）', section: '发射', min: 0, max: 1, step: 0.05 },
  { key: 'life', label: '生命（秒）', section: '粒子', min: 0.2, max: 3, step: 0.05 },
  { key: 'sizeStart', label: '出生直径（px）', section: '粒子', min: 1, max: 12, step: 0.5 },
  { key: 'sizeEnd', label: '死亡直径（px）', section: '粒子', min: 1, max: 20, step: 0.5 },
  { key: 'rise', label: '上浮漂移（px/秒）', section: '粒子', min: -30, max: 40, step: 1 },
  { key: 'buoy', label: '浮力加速度（px/秒²）', section: '粒子', min: -120, max: 120, step: 5 },
  { key: 'turbulence', label: '横向摆动（px）', section: '粒子', min: 0, max: 12, step: 0.5 },
  { key: 'alpha', label: '不透明度', section: '粒子', min: 0.05, max: 1, step: 0.05 },
  { key: 'maxParticles', label: '存活上限', section: '粒子', min: 8, max: 240, step: 4 },
  { key: 'glowStrength', label: '发光强度（峰值）', section: '发光', min: 0, max: 2, step: 0.05 },
  { key: 'glowHz', label: '呼吸频率（次/秒）', section: '发光', min: 0, max: 3, step: 0.05 },
  { key: 'glowPhase', label: '呼吸相位', section: '发光', min: 0, max: 1, step: 0.01 },
  { key: 'glowHalo', label: '柔光圈宽（px）', section: '发光', min: 0, max: 6, step: 1 },
  { key: 'glowTolerance', label: '取色容差（0=精确同色）', section: '发光', min: 0, max: 0.6, step: 0.01 },
  { key: 'glowStarReach', label: '星形伸长（倍）', section: '发光', min: 1, max: 2.5, step: 0.05 },
  { key: 'glowFlameReach', label: '焰形伸长（倍）', section: '发光', min: 1, max: 3.5, step: 0.05 },
  { key: 'glowAngleDeg', label: '辉光方向（度，0=东 90=南 180=西 270=北）', section: '发光', min: 0, max: 359, step: 5 },
];
