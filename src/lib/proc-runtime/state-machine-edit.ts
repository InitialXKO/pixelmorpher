// ============================================================
// StateMachinePanel 的纯函数层（可探针、无 DOM）：
// 状态改名/删除的级联、规格校验、可选表演清单。
// 语义与 convert.ts 的直通口径一致：
// - 表演状态（performanceId）经意图进入，播完按信号回落——
//   没有入转移是正常的，不算不可达；
// - 悬空表演引用在导出时降为常驻并点名，面板只预警、不拦截；
// - 窗内无贡献的片段导出时不生成段表演，面板无法在编辑时确知，
//   故可选清单含全部绑定片段，导出报告为准。
// ============================================================

import type { AnimationClip } from '../types';
import type {
  Character,
  StateMachineCondition,
  StateMachineSpec,
  StateMachineTransition,
} from '../unified-types';

export const KNOWN_SM_VARS = ['speed01', 'grounded', 'moveX'] as const;
export const SM_OPS: Array<{ op: StateMachineCondition['op']; label: string }> = [
  { op: 'lt', label: '<' },
  { op: 'lte', label: '≤' },
  { op: 'gt', label: '>' },
  { op: 'gte', label: '≥' },
  { op: 'eq', label: '=' },
  { op: 'neq', label: '≠' },
];

export function cloneSpec(spec: StateMachineSpec): StateMachineSpec {
  return {
    version: 1,
    initial: spec.initial,
    states: spec.states.map((s) => ({ ...s })),
    transitions: spec.transitions.map((t) => ({
      ...t,
      when: t.when.map((c) => ({ ...c })),
    })),
  };
}

export function newStateId(spec: StateMachineSpec): string {
  const taken = new Set(spec.states.map((s) => s.id));
  let i = 1;
  while (taken.has(`state${i}`)) i++;
  return `state${i}`;
}

/** 改名级联：状态 id + 所有转移 from/to + initial 一起改。撞名返回 null。 */
export function renameStateInSpec(
  spec: StateMachineSpec,
  oldId: string,
  newId: string,
): StateMachineSpec | null {
  const next = cloneSpec(spec);
  if (oldId === newId) return next;
  if (next.states.some((s) => s.id === newId)) return null;
  for (const s of next.states) if (s.id === oldId) s.id = newId;
  for (const t of next.transitions) {
    if (t.from === oldId) t.from = newId;
    if (t.to === oldId) t.to = newId;
  }
  if (next.initial === oldId) next.initial = newId;
  return next;
}

/** 删除级联：删状态 + 引用它的转移；initial 被删时退回首个剩余状态，没有则为空。 */
export function deleteStateFromSpec(spec: StateMachineSpec, id: string): StateMachineSpec {
  const next = cloneSpec(spec);
  next.states = next.states.filter((s) => s.id !== id);
  next.transitions = next.transitions.filter((t) => t.from !== id && t.to !== id);
  if (next.initial === id) next.initial = next.states[0]?.id ?? '';
  return next;
}

export function addStateToSpec(spec: StateMachineSpec): StateMachineSpec {
  const next = cloneSpec(spec);
  const id = newStateId(next);
  next.states.push({ id });
  if (!next.initial) next.initial = id;
  return next;
}

export function addTransitionToSpec(spec: StateMachineSpec): StateMachineSpec {
  const next = cloneSpec(spec);
  const first = next.states[0]?.id ?? '';
  next.transitions.push({ from: '*', to: first, when: [] });
  return next;
}

export function addConditionToSpec(
  spec: StateMachineSpec,
  transitionIndex: number,
): StateMachineSpec {
  const next = cloneSpec(spec);
  const t = next.transitions[transitionIndex];
  if (!t) return next;
  t.when.push({ var: 'speed01', op: 'gte', value: 0.05 });
  return next;
}

export interface OfferedPerformance {
  id: string;
  label: string;
  kind: 'performance' | 'tracks' | 'clip';
}

/** 面板可选的表演目标：作者表演（必进包）+ 轨道（有轨道贡献时才进包）
 *  + 绑定片段（窗内无贡献时导出不生成段表演，导出报告为准）。 */
export function listOfferedPerformances(
  character: Character,
  clips: AnimationClip[],
): OfferedPerformance[] {
  const out: OfferedPerformance[] = [];
  for (const p of character.performances ?? []) out.push({ id: p.id, label: p.name, kind: 'performance' });
  // 与 convert 的轨道表演生成口径一致：任一节点在姿态通道上有关键帧。
  const POSE_CHANNELS = ['angle', 'tilt', 'x', 'y', 'stretch', 'scaleX', 'variantIndex'] as const;
  const hasTracks = Object.values(character.nodes ?? {}).some((n) =>
    POSE_CHANNELS.some((ch) => (n.tracks?.[ch]?.keyframes?.length ?? 0) > 0),
  );
  if (hasTracks) out.push({ id: 'tracks', label: '轨道', kind: 'tracks' });
  for (const c of clips.filter((x) => x.puppetCharacterId === character.id)) {
    out.push({ id: `clip_${c.id}`, label: `片段：${c.name}`, kind: 'clip' });
  }
  return out;
}

/** 面板校验（只预警、不拦截；导出时 convert 另有降级 + 点名）：
 *  - initial 不存在或为空；
 *  - 表演状态引用的表演不在可选清单内（已删的表演/片段）；
 *  - 常驻非初始状态没有任何入转移（表演状态经意图进入，不在此列）。 */
export function validateStateMachineSpec(
  spec: StateMachineSpec,
  validPerfIds: Set<string>,
): string[] {
  const warnings: string[] = [];
  const stateIds = new Set(spec.states.map((s) => s.id));
  if (!spec.initial || !stateIds.has(spec.initial)) {
    warnings.push('初始状态不存在（导出时状态机没有合法起点）');
  }
  const hasIncoming = new Set<string>();
  for (const t of spec.transitions) {
    if (t.from === '*') {
      for (const id of stateIds) hasIncoming.add(id);
    } else {
      hasIncoming.add(t.to);
    }
    if (!stateIds.has(t.to)) warnings.push(`转移目标「${t.to}」不是现有状态`);
    if (t.from !== '*' && !stateIds.has(t.from)) warnings.push(`转移来源「${t.from}」不是现有状态`);
  }
  for (const s of spec.states) {
    if (s.performanceId && !validPerfIds.has(s.performanceId)) {
      warnings.push(`表演状态「${s.id}」引用的表演 ${s.performanceId} 不在包内（导出时降为常驻并点名）`);
    }
    if (!s.performanceId && s.id !== spec.initial && !hasIncoming.has(s.id)) {
      warnings.push(`常驻状态「${s.id}」没有任何入转移（只能作初始状态进入）`);
    }
  }
  return warnings;
}

export type { StateMachineSpec, StateMachineTransition };
