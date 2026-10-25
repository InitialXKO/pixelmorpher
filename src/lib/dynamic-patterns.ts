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
  // 残影段（D5）：过去位姿的残影。两端都不破纯函数口径——
  // 编辑器在渲染计划里按过去帧的世界位姿差生成 ghost 增量
  // （与追随段同 machinery，位姿取剥离蓝图的轨道位姿，故
  // 蓝图驱动的运动不入残影）；导出运行时用部件 el 快照环
  // （与表演残影同机制，有界状态：个数 × 间隔，换装/跳时清环）。
  // 多实例只取第一个启用残影。
  trailEnabled: boolean;
  trailCount: number;       // 残影个数 1..6
  trailIntervalSec: number; // 残影间隔（秒）
  trailOpacity: number;     // 最近残影不透明度（编辑器口径；运行时为残影色剪影）
  // 弧线段（D4 一期，PROPOSAL spikes/arc-gen）：中点置换的折线
  // 几何（闪电弧）。生成是时间的纯函数（形状按 flicker 步进
  // 量化、种子确定性）；点列以部件插头为原点、部件本地像素
  // 坐标（x 右、y 下，方向角 0=东顺时针 90=南）。同部件多弧线
  // 全部生效（与粒子段同口径，可叠多条）。
  arcEnabled: boolean;
  arcLengthPx: number;  // 主弧长（px）
  arcDirDeg: number;    // 主弧方向（度）
  arcDisplace: number;  // 中点置换幅度（占段长比，0 = 直线）
  arcBranches: number;  // 分叉数 0..3
  arcWidthPx: number;   // 根部线宽（px，向尖端收细）
  arcFlicker: number;   // 形状步进（步/秒，0 = 静止形状）
  arcSeed: number;      // 形状种子
  arcColor: string;     // 弧线颜色
  // 二期（D4）：生成模式 / 生长 / 双锚点 / 细节数
  arcMode: 'arc' | 'vine' | 'stars'; // 弧线（闪电）/ 藤蔓 / 星座连线
  arcGrowHz: number;    // 生长循环（次/秒，0 = 恒满长）；周期内先生长后保持
  arcTarget: string;    // 双锚点：终点锚定的目标部件槽位键（仅弧线模式；空 = 方向+弧长）
  arcDetail: number;    // 细节数：藤蔓叶数 / 星座星数（0 = 按模式缺省）
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
    trailEnabled: false, trailCount: 3, trailIntervalSec: 0.06, trailOpacity: 0.35,
    arcEnabled: false, arcLengthPx: 26, arcDirDeg: 0, arcDisplace: 0.35,
    arcBranches: 1, arcWidthPx: 1.2, arcFlicker: 10, arcSeed: 7,
    arcColor: '#bfe3ff',
    arcMode: 'arc', arcGrowHz: 0, arcTarget: '', arcDetail: 0,
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
  out.trailEnabled = out.trailEnabled === true;
  out.trailCount = Number.isFinite(out.trailCount)
    ? Math.max(1, Math.min(6, Math.round(out.trailCount))) : 3;
  out.trailIntervalSec = Number.isFinite(out.trailIntervalSec)
    ? Math.max(0.02, Math.min(0.3, out.trailIntervalSec)) : 0.06;
  out.trailOpacity = Number.isFinite(out.trailOpacity)
    ? Math.max(0.05, Math.min(0.8, out.trailOpacity)) : 0.35;
  out.arcEnabled = out.arcEnabled === true;
  out.arcLengthPx = Number.isFinite(out.arcLengthPx)
    ? Math.max(4, Math.min(96, out.arcLengthPx)) : 26;
  out.arcDirDeg = Number.isFinite(out.arcDirDeg)
    ? ((out.arcDirDeg % 360) + 360) % 360 : 0;
  out.arcDisplace = Number.isFinite(out.arcDisplace)
    ? Math.max(0, Math.min(0.8, out.arcDisplace)) : 0.35;
  out.arcBranches = Number.isFinite(out.arcBranches)
    ? Math.max(0, Math.min(3, Math.round(out.arcBranches))) : 1;
  out.arcWidthPx = Number.isFinite(out.arcWidthPx)
    ? Math.max(0.4, Math.min(4, out.arcWidthPx)) : 1.2;
  out.arcFlicker = Number.isFinite(out.arcFlicker)
    ? Math.max(0, Math.min(30, out.arcFlicker)) : 10;
  out.arcSeed = Number.isFinite(out.arcSeed)
    ? Math.max(1, Math.min(9999, Math.round(out.arcSeed))) : 7;
  if (typeof out.arcColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(out.arcColor)) {
    out.arcColor = '#bfe3ff';
  }
  if (out.arcMode !== 'vine' && out.arcMode !== 'stars') out.arcMode = 'arc';
  out.arcGrowHz = Number.isFinite(out.arcGrowHz)
    ? Math.max(0, Math.min(2, out.arcGrowHz)) : 0;
  if (typeof out.arcTarget !== 'string') out.arcTarget = '';
  out.arcDetail = Number.isFinite(out.arcDetail)
    ? Math.max(0, Math.min(12, Math.round(out.arcDetail))) : 0;
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

// ---- 弧线段（D4 一期）：中点置换折线生成。运行时孪生 =
// DYNAMIC_SRC 的 dynArcPoints（探针 AD 组逐点对拍）。 ----

export interface ArcPoint { x: number; y: number; w: number }
export interface ArcShape { main: ArcPoint[]; branches: ArcPoint[][]; dots: ArcPoint[]; alpha: number }

/** 生长系数 0..1：growHz ≤ 0 恒满长；否则每个周期内前 70%
 * 时间平滑长满、其余保持（到周期尾跳回 0——藤蔓/弧线的循环
 * 生长以跳变收尾，与跳动步进口径一致）。 */
export function arcGrowFrac(p: DynamicPatternParams, t: number): number {
  if (!(p.arcGrowHz > 0)) return 1;
  const ph = ((Math.max(0, t) * p.arcGrowHz) % 1 + 1) % 1;
  const f = Math.min(1, ph / 0.7);
  return f * f * (3 - 2 * f);
}

/** 按弧长把点列截断到 frac（端点线性插值，宽度同步插值） */
function arcClipToFrac(pts: ArcPoint[], frac: number): ArcPoint[] {
  if (frac >= 1 || pts.length < 2) return pts;
  if (frac <= 0) return pts.slice(0, 1);
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  let want = total * frac;
  const out: ArcPoint[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (want >= seg) { out.push(b); want -= seg; continue; }
    const f = seg > 0 ? want / seg : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f });
    break;
  }
  return out;
}

/** 一条直线的中点置换细分：每级在每段中点沿法线偏移
 * (哈希 − 0.5) × 段长 × disp × 衰减；哈希计数 k 贯穿主弧与
 * 分叉，保证同一 (种子, 步进) 下全图逐点确定。 */
function arcDisplaceLine(
  x0: number, y0: number, x1: number, y1: number,
  disp: number, levels: number, seed: number, step: number, kStart: number,
): { pts: { x: number; y: number }[]; k: number } {
  let pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  let k = kStart;
  for (let lv = 0; lv < levels; lv++) {
    const next: { x: number; y: number }[] = [pts[0]];
    const decay = Math.pow(0.72, lv);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy) || 1;
      const off = (displaceHash01(seed, step, k++) - 0.5) * segLen * disp * decay;
      next.push({
        x: (a.x + b.x) / 2 + (-dy / segLen) * off,
        y: (a.y + b.y) / 2 + (dx / segLen) * off,
      });
      next.push(b);
    }
    pts = next;
  }
  return { pts, k };
}

/** t 时刻的弧线形状（插头原点、部件本地 px）：主弧 + 分叉 +
 * 光点 + 本步的不透明度（闪烁）。flicker = 0 时形状静止、
 * alpha 恒定。endOverride（双锚点）由消费端按目标部件位姿
 * 算好传入（本地坐标终点），仅弧线模式用；生长系数对三种
 * 模式都生效（主线按弧长截断、分叉/光点按出现位置过滤）。 */
export function arcPointsAt(
  p: DynamicPatternParams, t: number, endOverride?: { x: number; y: number },
): ArcShape {
  const step = p.arcFlicker > 0 ? Math.floor(Math.max(0, t) * p.arcFlicker) : 0;
  const dir = (p.arcDirDeg * Math.PI) / 180;
  const grow = arcGrowFrac(p, t);
  const alpha = p.arcFlicker > 0 ? 0.55 + 0.45 * displaceHash01(p.arcSeed, step, 999) : 0.9;

  if (p.arcMode === 'vine') {
    // 藤蔓：等步长链 + 逐节角度漂移（哈希决定弯向，无跳动量化
    // ——藤蔓不抖）；叶子 = 主链旁的光点（分叉让位给叶）
    const segLen = 6;
    const segs = Math.max(2, Math.round(p.arcLengthPx / segLen));
    const pts: ArcPoint[] = [{ x: 0, y: 0, w: p.arcWidthPx }];
    let cx = 0, cy = 0, ang = dir;
    for (let i = 1; i <= segs; i++) {
      ang += (displaceHash01(p.arcSeed, 0, 500 + i) - 0.5) * 0.55;
      cx += Math.cos(ang) * segLen; cy += Math.sin(ang) * segLen;
      pts.push({ x: cx, y: cy, w: Math.max(0.15, p.arcWidthPx * (1 - 0.6 * (i / segs))) });
    }
    const leaves = p.arcDetail > 0 ? p.arcDetail : 5;
    const dots: ArcPoint[] = [];
    for (let j = 0; j < leaves; j++) {
      const s = 0.15 + 0.8 * ((j + 0.5) / leaves);
      const fi = s * segs;
      const i0 = Math.min(segs - 1, Math.floor(fi));
      const fr = fi - i0;
      const qx = pts[i0].x + (pts[i0 + 1].x - pts[i0].x) * fr;
      const qy = pts[i0].y + (pts[i0 + 1].y - pts[i0].y) * fr;
      const side = displaceHash01(p.arcSeed, 0, 700 + j) < 0.5 ? -1 : 1;
      const off = 2 + 2.5 * displaceHash01(p.arcSeed, 0, 720 + j);
      const nx = -(pts[i0 + 1].y - pts[i0].y), ny = pts[i0 + 1].x - pts[i0].x;
      const nl = Math.hypot(nx, ny) || 1;
      if (s <= grow) dots.push({ x: qx + (nx / nl) * off * side, y: qy + (ny / nl) * off * side, w: 1.5 });
    }
    return { main: arcClipToFrac(pts, grow), branches: [], dots, alpha };
  }

  if (p.arcMode === 'stars') {
    // 星座：盘内哈希散点 + 贪心最近邻串成连线；星点即光点
    const count = p.arcDetail > 0 ? p.arcDetail : 6;
    const raw: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < count; i++) {
      const rr = p.arcLengthPx * Math.sqrt(displaceHash01(p.arcSeed, 0, 300 + i));
      const th = displaceHash01(p.arcSeed, 0, 340 + i) * Math.PI * 2;
      raw.push({ x: Math.cos(th) * rr, y: Math.sin(th) * rr, r: rr });
    }
    const order: number[] = [0];
    const seen = new Set([0]);
    while (order.length < count) {
      const last = raw[order[order.length - 1]];
      let best = -1, bestD = Infinity;
      for (let i = 0; i < count; i++) {
        if (seen.has(i)) continue;
        const d = Math.hypot(raw[i].x - last.x, raw[i].y - last.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      order.push(best); seen.add(best);
    }
    const mainFull: ArcPoint[] = order.map((i) => ({ x: raw[i].x, y: raw[i].y, w: Math.max(0.3, p.arcWidthPx * 0.7) }));
    const dots: ArcPoint[] = order
      .filter((i) => raw[i].r <= p.arcLengthPx * grow + 1e-6)
      .map((i) => ({ x: raw[i].x, y: raw[i].y, w: 1.3 + 1.1 * displaceHash01(p.arcSeed, step, 380 + i) }));
    return { main: arcClipToFrac(mainFull, grow), branches: [], dots, alpha };
  }

  // 弧线（闪电）：中点置换 + 分叉（双锚点时终点由消费端给）
  const ex = endOverride ? endOverride.x : Math.cos(dir) * p.arcLengthPx;
  const ey = endOverride ? endOverride.y : Math.sin(dir) * p.arcLengthPx;
  const mainLen = Math.hypot(ex, ey);
  const disp = p.arcDisplace * 2;
  const main0 = arcDisplaceLine(0, 0, ex, ey, disp, 4, p.arcSeed, step, 0);
  const n = main0.pts.length;
  const mainFull: ArcPoint[] = main0.pts.map((q, i) => ({
    x: q.x, y: q.y, w: Math.max(0.15, p.arcWidthPx * (1 - 0.72 * (i / (n - 1)))),
  }));
  const branches: ArcPoint[][] = [];
  let k = main0.k;
  for (let b = 0; b < p.arcBranches; b++) {
    const s = 0.25 + 0.55 * displaceHash01(p.arcSeed, step, k++);
    if (s > grow) { k += 3; continue; }
    const fi = s * (n - 1);
    const i0 = Math.min(n - 2, Math.floor(fi));
    const fr = fi - i0;
    const bx = main0.pts[i0].x + (main0.pts[i0 + 1].x - main0.pts[i0].x) * fr;
    const by = main0.pts[i0].y + (main0.pts[i0 + 1].y - main0.pts[i0].y) * fr;
    const side = displaceHash01(p.arcSeed, step, k++) < 0.5 ? -1 : 1;
    const bang = dir + (side * (24 + 22 * displaceHash01(p.arcSeed, step, k++)) * Math.PI) / 180;
    const blen = mainLen * (1 - s) * (0.45 + 0.3 * displaceHash01(p.arcSeed, step, k++));
    const bp = arcDisplaceLine(bx, by, bx + Math.cos(bang) * blen, by + Math.sin(bang) * blen, disp, 3, p.arcSeed, step, k);
    k = bp.k;
    const m = bp.pts.length;
    const branchFull = bp.pts.map((q, i) => ({
      x: q.x, y: q.y, w: Math.max(0.1, p.arcWidthPx * 0.62 * (1 - 0.85 * (i / (m - 1)))),
    }));
    branches.push(arcClipToFrac(branchFull, Math.min(1, (grow - s) / Math.max(0.01, 1 - s))));
  }
  return { main: arcClipToFrac(mainFull, grow), branches, dots: [], alpha };
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
  section: '形变' | '发射' | '粒子' | '发光' | '弧线';
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
  { key: 'trailCount', label: '残影个数', section: '形变', min: 1, max: 6, step: 1 },
  { key: 'trailIntervalSec', label: '残影间隔（秒）', section: '形变', min: 0.02, max: 0.3, step: 0.01 },
  { key: 'trailOpacity', label: '残影不透明度', section: '形变', min: 0.05, max: 0.8, step: 0.05 },
  { key: 'arcLengthPx', label: '弧长（像素）', section: '弧线', min: 4, max: 96, step: 1 },
  { key: 'arcDirDeg', label: '弧线方向（度）', section: '弧线', min: 0, max: 359, step: 5 },
  { key: 'arcDisplace', label: '曲折幅度', section: '弧线', min: 0, max: 0.8, step: 0.05 },
  { key: 'arcBranches', label: '分叉数', section: '弧线', min: 0, max: 3, step: 1 },
  { key: 'arcWidthPx', label: '线宽（像素）', section: '弧线', min: 0.4, max: 4, step: 0.2 },
  { key: 'arcFlicker', label: '跳动（步/秒，0=静止）', section: '弧线', min: 0, max: 30, step: 1 },
  { key: 'arcSeed', label: '形状种子', section: '弧线', min: 1, max: 9999, step: 1 },
  { key: 'arcGrowHz', label: '生长循环（次/秒，0=恒满长）', section: '弧线', min: 0, max: 2, step: 0.05 },
  { key: 'arcDetail', label: '细节数（藤蔓叶/星座星，0=缺省）', section: '弧线', min: 0, max: 12, step: 1 },
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
