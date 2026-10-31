'use client';

// ============================================================
// StateMachinePanel — 运行时状态机编排（角色级）
// 编辑 Character.stateMachine（作者规格）：convert 直通进运行时包，
// 缺省由 convert 按包内表演自动生成默认机（idle/move/air + 表演状态）。
// 语义（与模板一致）：常驻状态靠转移切换；表演状态经意图进入，
// 播完按当前信号回落；转移按数组顺序首个命中；from='*' = 任意状态。
// 面板只预警、不拦截：悬空表演引用在导出时降为常驻并点名。
// ============================================================

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { Character, StateMachineCondition, StateMachineSpec } from '@/lib/unified-types';
import { defaultStateMachine } from '@/lib/proc-runtime/convert';
import {
  KNOWN_SM_VARS,
  SM_OPS,
  addConditionToSpec,
  addStateToSpec,
  addTransitionToSpec,
  deleteStateFromSpec,
  listOfferedPerformances,
  moveTransitionInSpec,
  renameStateInSpec,
  validateStateMachineSpec,
} from '@/lib/proc-runtime/state-machine-edit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 px-1';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a] w-14';

export default function StateMachinePanel({ unifiedCharacters }: { unifiedCharacters: Record<string, Character> }) {
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const animationClips = useProjectStore((s) => s.animationClips);
  const [editError, setEditError] = useState<string | null>(null);
  const character = activePuppetSkeletonId ? (unifiedCharacters[activePuppetSkeletonId] ?? null) : null;

  if (!character) {
    return <p className="text-[10px] text-gray-500">先在左侧选择一个角色。</p>;
  }
  const charId = character.id;
  const spec = character.stateMachine ?? null;
  const offered = listOfferedPerformances(character, animationClips);
  const validPerfIds = new Set(offered.map((o) => o.id));
  // 已禁用的作者表演：不在可选清单内，但与「已删」区分——校验单独预警、
  // 状态的表演下拉里以「已禁用」占位显示，不冒充已删。
  const disabledPerfs = (character.performances ?? []).filter((p) => p.enabled === false);
  const disabledPerfIds = new Set(disabledPerfs.map((p) => p.id));
  const warnings = spec ? validateStateMachineSpec(spec, validPerfIds, disabledPerfIds) : [];
  // 默认机（与 convert 同一函数；可选清单含全部绑定片段，窗内无贡献的
  // 片段导出时不生成段表演，引用它的状态届时降为常驻并在导出报告里点名）
  const defaultSpec = defaultStateMachine(offered.map((o) => ({ id: o.id })));

  const patchSpec = (next: StateMachineSpec | undefined, label: string) => {
    const store = useProjectStore.getState();
    store.pushUndo(label, 'stateMachine');
    store.updateUnifiedCharacter(charId, { stateMachine: next });
  };
  const commit = (next: StateMachineSpec | null) => {
    if (!next) { setEditError('状态 id 已存在，改名未保存'); return; }
    setEditError(null);
    patchSpec(next, '状态机');
  };

  return (
    <div className="space-y-2">
      <p className="text-[9px] text-gray-600 leading-relaxed">
        常驻状态靠转移切换；表演状态经意图进入，播完按当前信号回落；转移按顺序首个命中，来源 * = 任意状态。
        行为树（世界判定）归宿主，不进包，这里只编身体状态机。
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400">
          {spec ? '使用作者编排' : '当前使用默认机（未编排）'}
        </span>
        <div className="flex-1" />
        {!spec && (
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => patchSpec(defaultSpec, '状态机')}>
            开始编排
          </Button>
        )}
        {spec && (
          <>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => patchSpec(defaultSpec, '状态机')}>
              恢复默认机
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => patchSpec(undefined, '状态机')}>
              清除编排
            </Button>
          </>
        )}
      </div>

      {!spec && (
        <div className="rounded border border-white/10 p-2 space-y-1">
          <p className="text-[10px] text-gray-400">默认机预览（只读，点「开始编排」后可改）：</p>
          <p className="text-[10px] text-gray-300">
            状态：{defaultSpec.states.map((s) => (s.performanceId ? `${s.id}（表演）` : s.id)).join('、')}
          </p>
          <p className="text-[10px] text-gray-300">初始：{defaultSpec.initial} · 转移：{defaultSpec.transitions.length} 条</p>
        </div>
      )}

      {spec && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400">初始状态</span>
            <select
              className={selCls}
              value={spec.initial}
              onChange={(e) => commit({ ...spec, initial: e.target.value })}
            >
              {spec.states.map((s) => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-medium text-gray-300">状态（{spec.states.length}）</p>
            {spec.states.map((s) => (
              <div key={s.id} className="flex items-center gap-1">
                <Input
                  className="h-6 text-[10px]"
                  value={s.id}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === '') { setEditError('状态名不能为空'); return; }
                    commit(renameStateInSpec(spec, s.id, v));
                  }}
                />
                <select
                  className={selCls}
                  value={s.performanceId ? 'perf' : 'resident'}
                  onChange={(e) => {
                    if (e.target.value === 'resident') {
                      commit({ ...spec, states: spec.states.map((x) => (x.id === s.id ? { id: x.id } : x)) });
                    } else {
                      const first = offered[0]?.id ?? '';
                      commit({ ...spec, states: spec.states.map((x) => (x.id === s.id ? { id: x.id, performanceId: first } : x)) });
                    }
                  }}
                >
                  <option value="resident">常驻</option>
                  <option value="perf" disabled={offered.length === 0}>表演</option>
                </select>
                {s.performanceId !== undefined && (
                  <select
                    className={selCls}
                    value={s.performanceId}
                    onChange={(e) => commit({ ...spec, states: spec.states.map((x) => (x.id === s.id ? { ...x, performanceId: e.target.value } : x)) })}
                  >
                    {offered.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                    {disabledPerfIds.has(s.performanceId) ? (
                      <option value={s.performanceId} disabled>
                        已禁用：{disabledPerfs.find((p) => p.id === s.performanceId)?.name ?? s.performanceId}
                      </option>
                    ) : !validPerfIds.has(s.performanceId) && (
                      <option value={s.performanceId} disabled>已删：{s.performanceId}</option>
                    )}
                  </select>
                )}
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => commit(deleteStateFromSpec(spec, s.id))}>
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => commit(addStateToSpec(spec))}>
              <Plus size={12} className="mr-1" />新增状态
            </Button>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-medium text-gray-300">转移（{spec.transitions.length}）</p>
            {spec.transitions.map((t, ti) => (
              <div key={ti} className="rounded border border-white/10 p-1.5 space-y-1">
                <div className="flex items-center gap-1">
                  <select
                    className={selCls}
                    value={t.from}
                    onChange={(e) => commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, from: e.target.value } : x)) })}
                  >
                    <option value="*">*（任意）</option>
                    {spec.states.map((s) => (
                      <option key={s.id} value={s.id}>{s.id}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-gray-500">→</span>
                  <select
                    className={selCls}
                    value={t.to}
                    onChange={(e) => commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, to: e.target.value } : x)) })}
                  >
                    {spec.states.map((s) => (
                      <option key={s.id} value={s.id}>{s.id}</option>
                    ))}
                  </select>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="上移（顺序即优先级）" disabled={ti === 0} onClick={() => commit(moveTransitionInSpec(spec, ti, -1))}>
                    <ArrowUp size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="下移（顺序即优先级）" disabled={ti === spec.transitions.length - 1} onClick={() => commit(moveTransitionInSpec(spec, ti, 1))}>
                    <ArrowDown size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => commit({ ...spec, transitions: spec.transitions.filter((_, xi) => xi !== ti) })}>
                    <Trash2 size={12} />
                  </Button>
                </div>
                {t.when.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-1 pl-2">
                    <span className="text-[10px] text-gray-500">{ci === 0 ? '当' : '且'}</span>
                    {(KNOWN_SM_VARS as readonly string[]).includes(c.var) ? (
                      <select
                        className={selCls}
                        value={c.var}
                        onChange={(e) => {
                          // 选「自定义…」时先把变量名清掉、露出文本框（不把 __custom 当变量名存进去）
                          const v = e.target.value === '__custom' ? '' : e.target.value;
                          commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, when: x.when.map((y, yi) => (yi === ci ? { ...y, var: v } : y)) } : x)) });
                        }}
                      >
                        {KNOWN_SM_VARS.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                        <option value="__custom">自定义…</option>
                      </select>
                    ) : (
                      <Input
                        className="h-6 text-[10px] w-20"
                        value={c.var}
                        placeholder="变量名"
                        onChange={(e) => commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, when: x.when.map((y, yi) => (yi === ci ? { ...y, var: e.target.value } : y)) } : x)) })}
                      />
                    )}
                    <select
                      className={selCls}
                      value={c.op}
                      onChange={(e) => commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, when: x.when.map((y, yi) => (yi === ci ? { ...y, op: e.target.value as StateMachineCondition['op'] } : y)) } : x)) })}
                    >
                      {SM_OPS.map((o) => (
                        <option key={o.op} value={o.op}>{o.label}</option>
                      ))}
                    </select>
                    <Input
                      className={numCls}
                      type="number"
                      step="any"
                      value={c.value}
                      onChange={(e) => {
                        // 清空中的空串是未完成输入，不提交（Number('')===0 会把清空误落成 0）
                        if (e.target.value.trim() === '') return;
                        const v = Number(e.target.value);
                        if (Number.isNaN(v)) return;
                        commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, when: x.when.map((y, yi) => (yi === ci ? { ...y, value: v } : y)) } : x)) });
                      }}
                    />
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => commit({ ...spec, transitions: spec.transitions.map((x, xi) => (xi === ti ? { ...x, when: x.when.filter((_, yi) => yi !== ci) } : x)) })}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => commit(addConditionToSpec(spec, ti))}>
                  <Plus size={12} className="mr-1" />新增条件
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => commit(addTransitionToSpec(spec))}>
              <Plus size={12} className="mr-1" />新增转移
            </Button>
          </div>

          {(editError || warnings.length > 0) && (
            <div className="rounded border border-amber-900/50 bg-amber-950/20 p-1.5 space-y-0.5">
              {editError && <p className="text-[10px] text-amber-300/90">⚠ {editError}</p>}
              {warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-300/90 leading-snug">⚠ {w}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
