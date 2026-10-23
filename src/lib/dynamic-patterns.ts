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
  glowPick: string;         // 取色选区：目标颜色（#rrggbb，与像素色精确匹配）
  glowMask?: GlowMaskData;  // 手动标记选区：位打包掩码（行优先，1 = 选中）
}

/** 发光选区来源：color = 按像素颜色取色；marked = 手动标记的像素掩码 */
export type GlowMaskSource = 'color' | 'marked';

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
}

export interface ResolvedDynamicPattern {
  instance: DynamicPatternInstance;
  origin: 'node' | 'costume';
}

export function defaultDynamicParams(): DynamicPatternParams {
  return {
    deformEnabled: false, squashY: 0.85, stretchX: 1.1, deformHz: 1, deformPhase: 0,
    emitEnabled: true, source: 'contour', rate: 12, linkToDeform: 0, speed: 6,
    directionDeg: 270, spreadDeg: 60, layer: 'both', frontRatio: 0.35,
    life: 0.9, sizeStart: 3, sizeEnd: 8, rise: 12, buoy: 0, turbulence: 4,
    color: '#ffb46b', alpha: 0.5, maxParticles: 90,
    glowEnabled: false, glowColor: '#7dd7ff', glowStrength: 1, glowHz: 0.8,
    glowPhase: 0, glowHalo: 2, glowMaskSource: 'color', glowPick: '#2ea8ff',
    glowMask: undefined,
  };
}

/** 补齐缺省字段（旧工程存的实例没有发光段等新字段，读取处一律过这里） */
export function normalizeDynamicParams(p: DynamicPatternParams): DynamicPatternParams {
  return { ...defaultDynamicParams(), ...p };
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
 * 取色：像素颜色与 glowPick 精确相等（不分大小写；透明格不选）。
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
    for (let y = 0; y < h; y++) {
      const row = grid[y];
      for (let x = 0; x < w; x++) {
        const c = row[x];
        if (c && normHex(c) === pick) { cells[y * w + x] = 1; any = true; }
      }
    }
  }
  return any ? cells : null;
}

/**
 * 发光权重场：选区内 1，向外柔光圈内按距离线性衰减（圈外 0）。
 * 柔光圈按整数层逐圈外扩（8 邻域），场值供画布/运行时两端同口径消费。
 */
export function glowField(
  params: DynamicPatternParams,
  grid: import('./unified-types').PixelGrid,
): { w: number; h: number; field: Float32Array } | null {
  const cells = glowMaskCells(params, grid);
  if (!cells) return null;
  const h = grid.length;
  const w = grid[0].length;
  const field = new Float32Array(w * h);
  for (let i = 0; i < cells.length; i++) if (cells[i]) field[i] = 1;
  const halo = Math.max(0, Math.min(8, Math.round(params.glowHalo || 0)));
  if (halo > 0) {
    let frontier: number[] = [];
    for (let i = 0; i < cells.length; i++) if (cells[i]) frontier.push(i);
    for (let ring = 1; ring <= halo; ring++) {
      const next: number[] = [];
      const v = 1 - ring / (halo + 1);
      for (const idx of frontier) {
        const x = idx % w;
        const y = (idx - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (field[ni] === 0) { field[ni] = v; next.push(ni); }
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }
  return { w, h, field };
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
];
