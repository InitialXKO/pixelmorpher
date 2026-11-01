// ============================================================
// PixelMorpher - 表演事件消费（pattern_cue 命中事件 → 定格/震屏）
// ============================================================
// 蓝图 pattern_cue 节点（时序编排）在命中帧经 hitstop / shake 两路
// 输出给出事件量（定格秒数 / 震屏幅度 px），蓝图侧只负责给值，
// 消费在本模块，两头接：
//   - 发布：PixelCanvas 主渲染每帧把 aggregateCueEvents 的聚合结果
//     经 performFx.publish 写入（与渲染同一批可见角色、同一帧）；
//   - 消费：playback-scheduler 推进工程帧前 performFx.observe——
//     边沿触发后定格期内不推进 currentFrame（效果/姿态/标靶同冻，
//     与 pixelfx act 的 stop 同义），PixelCanvas 平移量叠加
//     performFx.shakeOffset 的震屏偏移（60Hz 离散方波 × 衰减包络）。
//
// 聚合口径：全部可见角色 × 各节点生效图（effectivePatternGraph，
// 与渲染同路）里的 pattern_cue 节点，evaluateNodeOutput 按渲染
// 同形 ctx 求值，hitstop / shake 各取最大值（多 cue 同帧命中不
// 叠加扣时/叠幅，取最重的一记）。触发按记判别：同一记事件在
// 其事件窗口（pulseWidth）内各帧的聚合值恒定，故「与上一帧同
// 值相邻」视为同一记的延续、不重复触发；值变化或隔了无事件
// 帧的再起视为新的一记（含紧邻两记同值连击会被并作一记——
// 仅凭聚合输出无从区分，与窗口延续同形，如实记此边界）。
// 回退/循环回绕使帧号变小视为新一遍，判别状态复位、同一事件
// 可再触发。聚合只在发布帧与观测帧相同时有效（陈旧发布按无
// 事件处理），渲染发布滞后于推进的极端情形下事件可能漏触发
// 一次（与 cue 节点自身的帧离散口径同级）。
//
// 边界（与蓝图接线同界）：进包时蓝图接线按 params 固化、包内无
// 蓝图求值器，且包内播放是状态机驱动的交互场景、没有工程时间
// 轴原点，cue 的事件时刻（工程时间轴秒数）无从映射——消费只在
// 编辑器播放生效；convert 对带事件的 cue 点名（见 convert.ts）。
// 与既有机制的关系：全局修改器的 shake 是用户自编的持续抖动，
// 与本事件通道互不相干、视觉上偏移叠加；本通道的定格只停工程
// 时间推进，不冻结 UI 与渲染循环本身。

import { evaluateNodeOutput } from './blueprint/eval';
import { effectivePatternGraph } from './blueprint/pattern-sync';
import { asNumber, type BlueprintGraph, type BlueprintValue } from './blueprint/ir';
import type { Character } from './unified-types';

export const CUE_NODE_TYPE = 'pattern_cue';

export interface CueEventAggregate {
  /** 定格秒数（>0 才有事件） */
  hitstop: number;
  /** 震屏幅度 px（>0 才有事件） */
  shake: number;
}

export const NO_CUE_EVENTS: CueEventAggregate = { hitstop: 0, shake: 0 };

type CueNodeEvaluator = (
  graph: BlueprintGraph,
  nodeId: string,
  ctx: {
    frame: number;
    frameRate: number;
    vars: Record<string, number | string | boolean>;
    costumes: Character['costumeSets'];
    costumeSlot: string | undefined;
  },
) => Record<string, BlueprintValue> | null;

export interface AggregateCueDeps {
  /** 求值器注入（缺省走蓝图 evaluateNodeOutput；探针可替身） */
  evaluateNode?: CueNodeEvaluator;
  /** 每角色的蓝图变量（缺省空表；编辑器侧按渲染同口径构建后注入） */
  varsForCharacter?: (character: Character) => Record<string, number | string | boolean>;
}

/** 图中是否存在 pattern_cue 节点（聚合前的廉价预扫） */
export function graphHasCueNodes(graph: BlueprintGraph | null | undefined): boolean {
  return !!graph?.nodes?.some((n) => n.type === CUE_NODE_TYPE);
}

/**
 * 解析 cues 参数判断 cue 节点是否带事件量（hitstop/shake > 0）。
 * 与求值器同口径：cues 缺失/损坏/空数组时求值器回落缺省示例，
 * 示例自带一次事件（0.5s 处 hitstop 0.08 / shake 3），故亦算带事件。
 */
export function cueNodeHasEvents(node: { type: string; params: Record<string, unknown> }): boolean {
  if (node.type !== CUE_NODE_TYPE) return false;
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(node.params.cues ?? ''));
  } catch { /* 损坏按回落缺省示例处理 */ }
  if (!Array.isArray(raw) || raw.length === 0) return true;
  return raw.some((c) => {
    if (!c || typeof c !== 'object') return false;
    const r = c as Record<string, unknown>;
    return Math.max(0, Number(r.hitstop ?? 0)) > 0 || Math.max(0, Number(r.shake ?? 0)) > 0;
  });
}

/** 角色任一节点蓝图是否含带事件的 cue（convert 点名用，只读原始蓝图不求值） */
export function characterHasCueEvents(character: Character): boolean {
  for (const node of Object.values(character.nodes ?? {})) {
    const graph = node.blueprint;
    if (!graphHasCueNodes(graph)) continue;
    if (graph!.nodes.some((n) => cueNodeHasEvents(n as never))) return true;
  }
  return false;
}

/**
 * 聚合某一帧全部角色的 cue 事件（hitstop/shake 各取最大值）。
 * 只对原始蓝图含 cue 节点的节点走生效图求值，其余零开销跳过。
 */
export function aggregateCueEvents(
  characters: Record<string, Character>,
  frame: number,
  frameRate: number,
  deps: AggregateCueDeps = {},
): CueEventAggregate {
  const evaluate: CueNodeEvaluator = deps.evaluateNode
    ?? ((graph, nodeId, ctx) => evaluateNodeOutput(graph, nodeId, ctx as never));
  let hitstop = 0;
  let shake = 0;
  for (const character of Object.values(characters)) {
    let vars: Record<string, number | string | boolean> | undefined;
    for (const node of Object.values(character.nodes ?? {})) {
      if (!graphHasCueNodes(node.blueprint)) continue;
      const graph = effectivePatternGraph(character, node as never);
      if (!graph) continue;
      if (vars === undefined) {
        try { vars = deps.varsForCharacter?.(character) ?? {}; } catch { vars = {}; }
      }
      for (const gn of graph.nodes) {
        if (gn.type !== CUE_NODE_TYPE) continue;
        let outs: Record<string, BlueprintValue> | null = null;
        try {
          outs = evaluate(graph, gn.id, {
            frame, frameRate, vars,
            costumes: character.costumeSets,
            costumeSlot: node.slot?.slotKey,
          });
        } catch { outs = null; }
        if (!outs) continue;
        const h = outs.hitstop !== undefined ? asNumber(outs.hitstop) : 0;
        const s = outs.shake !== undefined ? asNumber(outs.shake) : 0;
        if (Number.isFinite(h) && h > hitstop) hitstop = h;
        if (Number.isFinite(s) && s > shake) shake = s;
      }
    }
  }
  return { hitstop, shake };
}

/** 震屏包络最短时长（毫秒）：shake-only 的 cue 没有定格时长可依，按此下限衰减 */
export const SHAKE_MIN_DURATION_MS = 250;

export class PerformFxDriver {
  private published: { frame: number; events: CueEventAggregate } | null = null;
  /** 上一帧已判别的聚合值（同值相邻 = 同一记事件的窗口延续） */
  private prevFrameEvents: { frame: number; hitstop: number; shake: number } | null = null;
  /** 已判别过的（遍次，帧号）：每帧只判别一次，定格期反复观测同帧不重判 */
  private processedKey = '';
  private pass = 0;
  private lastFrame = -1;
  private freezeEndMs = 0;
  private shakeStartMs = 0;
  private shakeAmp = 0;
  private shakeDurationMs = 0;

  reset(): void {
    this.published = null;
    this.prevFrameEvents = null;
    this.processedKey = '';
    this.pass = 0;
    this.lastFrame = -1;
    this.freezeEndMs = 0;
    this.shakeStartMs = 0;
    this.shakeAmp = 0;
    this.shakeDurationMs = 0;
  }

  /** 渲染侧每帧发布该帧的聚合事件（发布与观测帧号须一致才被消费） */
  publish(frame: number, events: CueEventAggregate): void {
    this.published = { frame, events };
  }

  /**
   * 播放推进前观测当前帧：按记触发定格/震屏；返回 true 表示本
   * tick 处于定格期（工程帧不推进）。nowMs 与 rAF 时间戳同钟。
   */
  observe(frame: number, nowMs: number): boolean {
    if (this.lastFrame >= 0 && frame < this.lastFrame) {
      // 回退/跳帧/循环回绕 = 新一遍：判别状态复位，事件可再触发
      this.pass++;
      this.prevFrameEvents = null;
    }
    this.lastFrame = frame;
    // 只认与观测帧同号的新鲜发布，且每（遍，帧）只判别一次；
    // 陈旧发布不动判别状态（防渲染滞后一帧时把跨帧窗口的同一
    // 记事件误判成新的一记）
    const key = `${this.pass}:${frame}`;
    if (this.published && this.published.frame === frame && this.processedKey !== key) {
      this.processedKey = key;
      const ev = this.published.events;
      const hasEvent = ev.hitstop > 0 || ev.shake > 0;
      const prev = this.prevFrameEvents;
      const continuation = hasEvent && prev !== null
        && prev.frame === frame - 1
        && prev.hitstop === ev.hitstop && prev.shake === ev.shake;
      if (hasEvent && !continuation) {
        if (ev.hitstop > 0) this.freezeEndMs = nowMs + ev.hitstop * 1000;
        if (ev.shake > 0) {
          this.shakeAmp = ev.shake;
          this.shakeStartMs = nowMs;
          this.shakeDurationMs = Math.max(SHAKE_MIN_DURATION_MS, ev.hitstop * 1000);
        }
      }
      this.prevFrameEvents = { frame, hitstop: ev.hitstop, shake: ev.shake };
    }
    return nowMs < this.freezeEndMs;
  }

  /** 当前震屏偏移（px）：60Hz 离散方波 × 二次衰减包络；y 轴错半步相位 */
  shakeOffset(nowMs: number): { x: number; y: number } {
    if (this.shakeAmp <= 0 || this.shakeDurationMs <= 0) return { x: 0, y: 0 };
    const elapsed = nowMs - this.shakeStartMs;
    if (elapsed < 0 || elapsed >= this.shakeDurationMs) return { x: 0, y: 0 };
    const k = 1 - elapsed / this.shakeDurationMs;
    const env = this.shakeAmp * k * k;
    const stepMs = 1000 / 60;
    const sx = Math.floor(elapsed / stepMs) % 2 === 0 ? 1 : -1;
    const sy = Math.floor((elapsed + stepMs / 2) / stepMs) % 2 === 0 ? 1 : -1;
    return { x: env * sx, y: env * sy };
  }
}

/** 全局单例：scheduler 消费、PixelCanvas 发布并读偏移 */
export const performFx = new PerformFxDriver();
