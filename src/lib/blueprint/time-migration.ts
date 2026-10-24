// ============================================================
// 时间单位迁移（图内时间：帧 → 秒）
//
// 旧口径：图内 time 节点输出帧号、周期/时长参数以帧计、宿主相位
// 以 60fps 帧计；而"帧"的速率随图的归属漂移——行为图/表演图 60、
// 节点蓝图工程帧率、烘焙 IK 蓝图 12、IK 目标蓝图工程帧率。
// 新口径：一切连续时间以秒计（time 节点 = frame/frameRate），
// 周期/时长参数以秒计、频率以 Hz 计、相位以圈数计；帧只保留为
// 关键帧位置这类编辑格子（不在本迁移范围）。
//
// 本模块在工程加载时一次性换算存量数据，由工程级标记
// timeUnitsVersion 守门（>=2 视为已换算，不重复执行）。
// ============================================================

import type { BlueprintGraph } from './ir';

type Params = Record<string, unknown>;

const divBy = (v: unknown, fps: number): unknown =>
  typeof v === 'number' && Number.isFinite(v) ? v / fps : v;
const mulBy = (v: unknown, fps: number): unknown =>
  typeof v === 'number' && Number.isFinite(v) ? v * fps : v;

function applyKeys(params: Params, keys: string[] | undefined, fn: (v: unknown) => unknown): void {
  if (!keys) return;
  for (const k of keys) {
    if (params[k] !== undefined) params[k] = fn(params[k]);
  }
}

/** 图节点：参数键 → 换算方向（÷fps = 帧→秒；×fps = 每帧速率→每秒速率） */
const NODE_DIV_KEYS: Record<string, string[]> = {
  pendulum: ['period'],
  breath: ['period'],
  float: ['period'],
  wobble: ['period'],
  bounce: ['period'],
  elastic: ['period'],
  wheel: ['period'],
  waveform: ['period'],
  expression: ['period'],
  trajectory_emitter: ['period'],
  particle: ['life'],
  gait: ['period', 'landBendDuration', 'liftoffBendDuration'],
  timeRemap: ['period', 'offset'],
};
const NODE_MUL_KEYS: Record<string, string[]> = {
  waveform: ['damping'],
  wobble: ['damping'],
  elastic: ['damping'],
  wave: ['frequency'],
  noise: ['frequency'],
  blend: ['convergeSpeed'],
};

/** 图节点输入端口里的时间量字面值（如 period 端口接的 {value:15}）：
 *  端口本身声明了量的种类，可按端口换算（÷fps = 时间量；×fps = 速率量）。
 *  经 const/var 节点间接喂入的值不在此列（用途不可知，不动）。 */
const INPUT_DIV_PORTS: Record<string, string[]> = {
  pendulum: ['t', 'period'],
  breath: ['t', 'period'],
  float: ['t', 'period'],
  wobble: ['t', 'period'],
  bounce: ['t', 'period'],
  elastic: ['t', 'period'],
  wheel: ['t', 'period'],
  waveform: ['t', 'period'],
  timeRemap: ['t', 'period', 'offset'],
  gait: ['t', 'period'],
  expression: ['t', 'period'],
  trajectory_emitter: ['t', 'period'],
  keyframes: ['t'],
  timeGate: ['t'],
  blend: ['t'],
  spring: ['t'],
  shake: ['t'],
  noise: ['t'],
  wave: ['t'],
  jitter: ['t'],
};
const INPUT_MUL_PORTS: Record<string, string[]> = {
  waveform: ['damping'],
  wobble: ['damping'],
  elastic: ['damping'],
  wave: ['frequency'],
  noise: ['frequency'],
};

function migrateLiteralInputs(node: { type: string; inputs?: Record<string, unknown> }, fps: number): void {
  const inputs = node.inputs;
  if (!inputs) return;
  const convert = (ports: string[] | undefined, fn: (v: unknown) => unknown) => {
    if (!ports) return;
    for (const port of ports) {
      const inp = inputs[port] as Record<string, unknown> | number | undefined;
      if (inp === undefined || inp === null) continue;
      if (typeof inp === 'number') { inputs[port] = fn(inp); continue; }
      if (typeof inp === 'object') {
        if ('nodeId' in inp) continue; // 连线到其他节点：不是字面值
        if (typeof inp.value === 'number') inp.value = fn(inp.value);
        else if (typeof (inp as { v?: unknown }).v === 'number') (inp as { v?: unknown }).v = fn((inp as { v: number }).v);
      }
    }
  };
  convert(INPUT_DIV_PORTS[node.type], (v) => divBy(v, fps));
  convert(INPUT_MUL_PORTS[node.type], (v) => mulBy(v, fps));
}

/** 把一张图（旧帧制）的全部时间参数换算为秒制（就地修改 params）。 */
export function migrateGraphTimeUnits(graph: BlueprintGraph | null | undefined, fps: number): void {
  if (!graph || !Array.isArray(graph.nodes) || !(fps > 0)) return;
  for (const node of graph.nodes) {
    migrateLiteralInputs(node as { type: string; inputs?: Record<string, unknown> }, fps);
    const params = (node.params ?? {}) as Params;
    applyKeys(params, NODE_DIV_KEYS[node.type], (v) => divBy(v, fps));
    applyKeys(params, NODE_MUL_KEYS[node.type], (v) => mulBy(v, fps));
    if (node.type === 'timeGate') {
      // start/end 的 -1 是"无限制"哨兵，不换算；fade 时长直接换算
      if (typeof params.start === 'number' && params.start >= 0) params.start = params.start / fps;
      if (typeof params.end === 'number' && params.end >= 0) params.end = params.end / fps;
      applyKeys(params, ['fadeIn', 'fadeOut'], (v) => divBy(v, fps));
    }
    if (node.type === 'keyframes') {
      // frames 是帧号数组（可能以 JSON 字符串存），逐个换算成秒，写回原形状
      const raw = params.frames;
      try {
        const arr: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) {
          const converted = arr.map((f) => divBy(f, fps));
          params.frames = typeof raw === 'string' ? JSON.stringify(converted) : converted;
        }
      } catch { /* 坏数据原样保留，求值端自有兜底 */ }
    }
  }
}

/** 修改器（含剪辑关键帧修改器、全局修改器）：参数键 → 换算方向。
 *  与图节点的差异：pendulum/bounce 的 damping 是无量纲（每周期/每次
 *  弹跳），不换算；spring 本来就是秒制物理量，不换算。 */
const MOD_DIV_KEYS: Record<string, string[]> = {
  pendulum: ['period'],
  breath: ['period'],
  float: ['period'],
  wobble: ['period'],
  bounce: ['period'],
  elastic: ['period'],
  wheel: ['period'],
  expression: ['period'],
  shake: ['period'],
  particle: ['life'],
  gait: ['period', 'landBendDuration', 'liftoffBendDuration'],
};
const MOD_MUL_KEYS: Record<string, string[]> = {
  wobble: ['damping'],
  elastic: ['damping'],
  wave: ['frequency'],
  noise: ['frequency'],
};

export function migrateModifierTimeUnits(
  mod: { type?: string; params?: Params; paramDrivers?: unknown } | null | undefined,
  fps: number,
): void {
  if (!mod || !(fps > 0)) return;
  if (mod.type && mod.params) {
    applyKeys(mod.params, MOD_DIV_KEYS[mod.type], (v) => divBy(v, fps));
    applyKeys(mod.params, MOD_MUL_KEYS[mod.type], (v) => mulBy(v, fps));
  }
  // 参数驱动（ParamDriver）：period 是时长 → 秒；其 paramSources 里的
  // 次级驱动 period 同样换算（startFrame/endFrame 是位置，保持帧）
  const drivers = (mod as { paramDrivers?: Array<Record<string, any>> }).paramDrivers;
  if (Array.isArray(drivers)) {
    for (const d of drivers) {
      if (!d) continue;
      if (typeof d.period === 'number') d.period = d.period / fps;
      const sources = d.paramSources as Record<string, any> | undefined;
      for (const src of Object.values(sources ?? {})) {
        if (src?.type === 'secondary_driver' && src.driver && typeof src.driver.period === 'number') {
          src.driver.period = src.driver.period / fps;
        }
      }
    }
  }
}

/**
 * 工程级一次性迁移：遍历全部角色与剪辑，按各自旧口径换算。
 * - 行为图、表演图：旧口径 60fps 帧
 * - 节点蓝图、节点修改器、IK 目标蓝图、剪辑关键帧修改器、全局修改器：工程帧率
 * - 烘焙 IK 蓝图（ikBlueprint）：旧求值上下文写死 12
 */
export function migrateProjectTimeUnits(
  characters: Record<string, unknown> | null | undefined,
  clips: Array<Record<string, unknown>> | null | undefined,
  globalModifiers: Array<{ type?: string; params?: Params }> | null | undefined,
  projectFps: number,
): void {
  const fps = projectFps > 0 ? projectFps : 12;
  for (const ch of Object.values(characters ?? {}) as Array<Record<string, any>>) {
    if (!ch) continue;
    for (const g of Object.values(ch.behaviorGraphs ?? {}) as BlueprintGraph[]) {
      migrateGraphTimeUnits(g, 60);
    }
    for (const perf of (ch.performances ?? []) as Array<Record<string, any>>) {
      for (const g of Object.values(perf?.graphs ?? {}) as BlueprintGraph[]) {
        migrateGraphTimeUnits(g, 60);
      }
    }
    migrateGraphTimeUnits(ch.ikBlueprint as BlueprintGraph, 12);
    for (const chain of (ch.ikChains ?? []) as Array<Record<string, any>>) {
      migrateGraphTimeUnits(chain?.targetBlueprint as BlueprintGraph, fps);
    }
    for (const node of Object.values(ch.nodes ?? {}) as Array<Record<string, any>>) {
      if (!node) continue;
      migrateGraphTimeUnits(node.blueprint as BlueprintGraph, fps);
      for (const mod of (node.modifiers ?? []) as Array<{ type?: string; params?: Params }>) {
        migrateModifierTimeUnits(mod, fps);
      }
      // 修饰器组轨上的修饰器（旧片段关键帧迁入，导入顺序上在本迁移之前）
      for (const pt of ((node.tracks as any)?.modifierKeys?.keyframes ?? []) as Array<Record<string, any>>) {
        for (const mod of (pt?.value ?? []) as Array<{ type?: string; params?: Params }>) {
          migrateModifierTimeUnits(mod, fps);
        }
      }
    }
  }
  // 注：旧片段关键帧的修饰器已由片段结构迁移并入上面的轨道附件轨，
  // clips 参数保留仅为签名兼容，不再单独遍历。
  for (const mod of globalModifiers ?? []) {
    migrateModifierTimeUnits(mod, fps);
  }
}
