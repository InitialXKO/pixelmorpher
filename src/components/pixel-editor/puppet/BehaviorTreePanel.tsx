'use client';

// ============================================================
// BehaviorTreePanel — 行为树编排（角色级）
// 编辑 Character.behaviorTree（作者规格）：不进运行时包，宿主侧运行。
// 语义（与 behavior-tree.ts 一致）：树是"大脑"、状态机是"身体"；
// 每 tick 从根重跑，按世界变量决策，只输出意图/移动/写变量。
// 试运行用模拟世界变量步进 tick；mock 按模板口径实现：
// 意图命中=可选表演或 jump；写变量转发进运行时变量表（状态机条件
// 随后能读到），保留名 t/phase/speed01/grounded 拒收只留黑板。
// ============================================================

import React, { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  BehaviorTreeNode,
  BehaviorTreeNodeType,
  BehaviorTreeSpec,
  Character,
} from '@/lib/unified-types';
import { SM_OPS, listOfferedPerformances } from '@/lib/proc-runtime/state-machine-edit';
import {
  BT_ALL_TYPES,
  BT_INTERNAL_PREFIX,
  BT_TYPE_LABELS,
  type BTState,
  type BTTickResult,
  addChildToSpec,
  addSiblingToSpec,
  canHaveChildren,
  collectBTVarNames,
  createBTState,
  defaultBTNode,
  isDecorator,
  moveNodeInSpec,
  removeNodeFromSpec,
  tickBehaviorTree,
  updateNodeInSpec,
  validateBehaviorTreeSpec,
} from '@/lib/proc-runtime/behavior-tree';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 px-1';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a] w-16';
const txtCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a] w-24';
const btnCls = 'h-6 px-1.5 text-[10px] rounded border border-[#1e1e3a] text-gray-400 hover:text-gray-200 hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent';

const STATUS_LABEL: Record<BTTickResult['status'], string> = {
  success: '成功',
  failure: '失败',
  running: '运行中',
};
const STATUS_CLS: Record<BTTickResult['status'], string> = {
  success: 'text-emerald-300',
  failure: 'text-gray-500',
  running: 'text-amber-300',
};

interface RowProps {
  node: BehaviorTreeNode;
  depth: number;
  isRoot: boolean;
  collapsed: Set<string>;
  offered: Array<{ id: string; label: string }>;
  onToggleCollapse: (id: string) => void;
  onPatch: (id: string, patch: Partial<BehaviorTreeNode>) => void;
  onAddChild: (parentId: string, type: BehaviorTreeNodeType) => void;
  onAddSibling: (id: string, type: BehaviorTreeNodeType) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

function BTNodeRow(props: RowProps) {
  const { node, depth, isRoot, collapsed, offered } = props;
  const [addType, setAddType] = useState<BehaviorTreeNodeType>('condition');
  const kids = node.children ?? [];
  const isCollapsed = collapsed.has(node.id);
  const container = canHaveChildren(node.type);
  const decoratorFull = isDecorator(node.type) && kids.length > 0;
  const intentKnown = node.intentName === 'jump' || offered.some((o) => o.id === node.intentName);

  const num = (v: number | undefined, onChange: (n: number) => void) => (
    <Input
      type="number"
      className={numCls}
      value={v ?? 0}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );

  return (
    <div>
      <div
        className="flex items-center gap-1 flex-wrap py-0.5"
        style={{ marginLeft: depth * 14 }}
      >
        {container ? (
          <button
            className="text-[10px] text-gray-500 w-3"
            onClick={() => props.onToggleCollapse(node.id)}
            title={isCollapsed ? '展开' : '折叠'}
          >
            {kids.length === 0 ? '·' : isCollapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <span className={`text-[10px] px-1 rounded ${container ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/5 text-gray-300'}`}>
          {BT_TYPE_LABELS[node.type]}
        </span>
        <span className="text-[9px] text-gray-600">{node.id}</span>

        {node.type === 'condition' && (
          <>
            <Input
              className={txtCls}
              list="bt-var-names"
              placeholder="变量名"
              value={node.var ?? ''}
              onChange={(e) => props.onPatch(node.id, { var: e.target.value })}
            />
            <select
              className={selCls}
              value={node.op ?? 'gte'}
              onChange={(e) => props.onPatch(node.id, { op: e.target.value as BehaviorTreeNode['op'] })}
            >
              {SM_OPS.map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>
            {num(node.value, (n) => props.onPatch(node.id, { value: n }))}
          </>
        )}

        {node.type === 'intent' && (
          <>
            <select
              className={selCls}
              value={intentKnown ? (node.intentName ?? '') : '__custom'}
              onChange={(e) => {
                const v = e.target.value;
                props.onPatch(node.id, { intentName: v === '__custom' ? '' : v });
              }}
            >
              <option value="jump">jump（模板内置）</option>
              {offered.map((o) => (
                <option key={o.id} value={o.id}>{o.label}（{o.id}）</option>
              ))}
              <option value="__custom">自定义…</option>
            </select>
            {!intentKnown && (
              <Input
                className={txtCls}
                placeholder="意图名"
                value={node.intentName ?? ''}
                onChange={(e) => props.onPatch(node.id, { intentName: e.target.value })}
              />
            )}
          </>
        )}

        {node.type === 'setMove' && num(node.moveX, (n) => props.onPatch(node.id, { moveX: n }))}

        {node.type === 'setVar' && (
          <>
            <Input
              className={txtCls}
              list="bt-var-names"
              placeholder="变量名"
              value={node.setVarName ?? ''}
              onChange={(e) => props.onPatch(node.id, { setVarName: e.target.value })}
            />
            <span className="text-[10px] text-gray-500">=</span>
            {num(node.setVarValue, (n) => props.onPatch(node.id, { setVarValue: n }))}
          </>
        )}

        {node.type === 'repeat' && (
          <>
            {num(node.repeatCount, (n) => props.onPatch(node.id, { repeatCount: n }))}
            <span className="text-[9px] text-gray-600">遍（0=一直跑）</span>
          </>
        )}

        {node.type === 'wait' && (
          <>
            {num(node.waitSeconds, (n) => props.onPatch(node.id, { waitSeconds: n }))}
            <span className="text-[9px] text-gray-600">秒</span>
          </>
        )}

        {container && <span className="text-[9px] text-gray-600">{kids.length} 个子节点</span>}

        <div className="flex-1" />

        {container && (
          <>
            <select className={selCls} value={addType} onChange={(e) => setAddType(e.target.value as BehaviorTreeNodeType)}>
              {BT_ALL_TYPES.map((t) => (
                <option key={t} value={t}>{BT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <button
              className={btnCls}
              disabled={decoratorFull}
              title={decoratorFull ? '修饰节点只能有 1 个子节点' : '加子节点'}
              onClick={() => props.onAddChild(node.id, addType)}
            >
              +子
            </button>
          </>
        )}
        {!isRoot && (
          <>
            <button className={btnCls} title="加兄弟节点（类型同上方选择）" onClick={() => props.onAddSibling(node.id, addType)}>
              +兄弟
            </button>
            <button className={btnCls} title="上移" onClick={() => props.onMove(node.id, -1)}>↑</button>
            <button className={btnCls} title="下移" onClick={() => props.onMove(node.id, 1)}>↓</button>
          </>
        )}
        <button
          className={`${btnCls} hover:text-red-300`}
          title={isRoot ? '删除根节点（树变空）' : '删除节点（含子树）'}
          onClick={() => props.onRemove(node.id)}
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {container && !isCollapsed &&
        kids.map((c) => (
          <BTNodeRow key={c.id} {...props} node={c} depth={depth + 1} isRoot={false} />
        ))}
    </div>
  );
}

export default function BehaviorTreePanel({ unifiedCharacters }: { unifiedCharacters: Record<string, Character> }) {
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const animationClips = useProjectStore((s) => s.animationClips);
  const [editError, setEditError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [worldRows, setWorldRows] = useState<Array<{ name: string; value: string }>>([
    { name: 'enemyDist', value: '100' },
  ]);
  const [dtStr, setDtStr] = useState('0.1');
  const [tickCount, setTickCount] = useState(0);
  const [lastResult, setLastResult] = useState<BTTickResult | null>(null);
  const [callLog, setCallLog] = useState<string[]>([]);
  const [varsSnapshot, setVarsSnapshot] = useState<Record<string, number>>({});
  const btStateRef = useRef<BTState>(createBTState());
  const trialCharRef = useRef<string | null>(null);

  const character = activePuppetSkeletonId ? (unifiedCharacters[activePuppetSkeletonId] ?? null) : null;

  if (!character) {
    return <p className="text-[10px] text-gray-500">先在左侧选择一个角色。</p>;
  }
  const charId = character.id;
  const spec = character.behaviorTree ?? null;
  const offered = listOfferedPerformances(character, animationClips);
  const offeredIds = new Set([...offered.map((o) => o.id), 'jump']);
  const warnings = spec ? validateBehaviorTreeSpec(spec, offeredIds) : [];
  const varSuggestions = [
    ...new Set([...(spec ? collectBTVarNames(spec) : []), 'speed01', 'grounded', 'moveX']),
  ];

  const patchSpec = (next: BehaviorTreeSpec | undefined, label: string) => {
    const store = useProjectStore.getState();
    store.pushUndo(label, 'behaviorTree');
    store.updateUnifiedCharacter(charId, { behaviorTree: next });
  };
  const commit = (next: BehaviorTreeSpec | null) => {
    if (!next) { setEditError('操作被拒绝（修饰节点已有子节点 / 根节点无兄弟 / 已到边界）'); return; }
    setEditError(null);
    patchSpec(next, '行为树');
  };

  const resetTrial = () => {
    btStateRef.current = createBTState();
    trialCharRef.current = charId;
    setTickCount(0);
    setLastResult(null);
    setCallLog([]);
    setVarsSnapshot({});
  };

  const runTick = () => {
    if (!spec) return;
    if (trialCharRef.current !== charId) resetTrial();
    const worldVars: Record<string, number> = {};
    for (const r of worldRows) {
      const name = r.name.trim();
      const v = parseFloat(r.value);
      if (name && !Number.isNaN(v)) worldVars[name] = v;
    }
    const dtParsed = parseFloat(dtStr);
    const dt = Number.isNaN(dtParsed) || dtParsed < 0 ? 0 : dtParsed;
    const calls: string[] = [];
    const result = tickBehaviorTree(spec, btStateRef.current, {
      dt,
      worldVars,
      runtime: {
        intent: (name) => {
          const ok = offeredIds.has(name);
          calls.push(`intent(${name}) → ${ok ? '命中' : '未命中'}`);
          return ok;
        },
        setMove: (x) => { calls.push(`setMove(${x})`); },
        setVar: (name, value) => {
          const ok = !['t', 'phase', 'speed01', 'grounded'].includes(name);
          calls.push(`setVar(${name}, ${value}) → ${ok ? '模板接受（进变量表）' : '模板拒收（保留名，只留黑板）'}`);
          return ok;
        },
      },
    });
    setLastResult(result);
    setCallLog((prev) => [...calls, ...prev].slice(0, 60));
    setVarsSnapshot({ ...btStateRef.current.vars });
    setTickCount((c) => c + 1);
  };

  const normalVars = Object.entries(varsSnapshot).filter(([k]) => !k.startsWith(BT_INTERNAL_PREFIX));
  const internalVars = Object.entries(varsSnapshot).filter(([k]) => k.startsWith(BT_INTERNAL_PREFIX));

  return (
    <div className="space-y-2">
      <p className="text-[9px] text-gray-600 leading-relaxed">
        行为树是决策层（大脑），状态机是身体：每 tick 从根重跑，按世界变量决策，只输出意图、移动、写变量。
        树不进运行时包，宿主侧运行；世界变量的名字由宿主定，树只按名字读。
        写变量会转发运行时并进变量表，状态机条件和行为图随后能读到；保留名 t/phase/speed01/grounded 由模板逐帧计算，不接受外部写入。
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400">
          {spec ? '使用作者编排' : '未编排（角色没有行为树）'}
        </span>
        <div className="flex-1" />
        {!spec && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={() => patchSpec({ version: 1, root: defaultBTNode('selector', 'bt1') }, '行为树')}
          >
            开始编排
          </Button>
        )}
        {spec && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={() => patchSpec(undefined, '行为树')}
          >
            清除编排
          </Button>
        )}
      </div>

      {editError && <p className="text-[10px] text-red-300">{editError}</p>}

      {spec && (
        <>
          <datalist id="bt-var-names">
            {varSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>

          <div className="rounded border border-white/10 p-1.5">
            {spec.root ? (
              <BTNodeRow
                node={spec.root}
                depth={0}
                isRoot
                collapsed={collapsed}
                offered={offered}
                onToggleCollapse={(id) =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })
                }
                onPatch={(id, patch) => commit(updateNodeInSpec(spec, id, patch))}
                onAddChild={(parentId, type) => commit(addChildToSpec(spec, parentId, type))}
                onAddSibling={(id, type) => commit(addSiblingToSpec(spec, id, type))}
                onRemove={(id) => commit(removeNodeFromSpec(spec, id))}
                onMove={(id, dir) => commit(moveNodeInSpec(spec, id, dir))}
              />
            ) : (
              <div className="flex items-center gap-2 py-1">
                <span className="text-[10px] text-gray-500">树是空的。</span>
                <button className={btnCls} onClick={() => patchSpec({ version: 1, root: defaultBTNode('selector', 'bt1') }, '行为树')}>
                  <Plus className="size-3 inline" /> 建根选择器
                </button>
              </div>
            )}
          </div>

          {warnings.length > 0 && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-0.5">
              {warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-200/80">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* ---- 试运行 ---- */}
          <div className="rounded border border-white/10 p-2 space-y-1.5">
            <p className="text-[10px] font-medium text-gray-300">试运行（模拟世界变量，步进 tick）</p>
            <div className="space-y-1">
              {worldRows.map((r, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    className={txtCls}
                    placeholder="世界变量名"
                    value={r.name}
                    onChange={(e) =>
                      setWorldRows((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <span className="text-[10px] text-gray-500">=</span>
                  <Input
                    className={numCls}
                    type="number"
                    value={r.value}
                    onChange={(e) =>
                      setWorldRows((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                  />
                  <button
                    className={btnCls}
                    onClick={() => setWorldRows((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
              <button className={btnCls} onClick={() => setWorldRows((prev) => [...prev, { name: '', value: '0' }])}>
                <Plus className="size-3 inline" /> 世界变量
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">每步</span>
              <Input className={numCls} type="number" step="0.05" value={dtStr} onChange={(e) => setDtStr(e.target.value)} />
              <span className="text-[10px] text-gray-400">秒</span>
              <Button size="sm" className="h-6 text-[10px]" onClick={runTick}>
                步进 tick
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={resetTrial}>
                重置
              </Button>
              <span className="text-[9px] text-gray-600">
                已 tick {tickCount} 次 · 时钟 {btStateRef.current.clock.toFixed(2)}s
              </span>
            </div>
            {lastResult && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-gray-300">
                  本步结果：<span className={STATUS_CLS[lastResult.status]}>{STATUS_LABEL[lastResult.status]}</span>
                  {lastResult.firedIntents.length > 0 && (
                    <span className="text-gray-400"> · 发出意图：{lastResult.firedIntents.join('、')}</span>
                  )}
                </p>
                {lastResult.trace.map((t, i) => (
                  <p key={i} className="text-[9px] text-gray-500 font-mono" style={{ paddingLeft: t.depth * 12 }}>
                    {BT_TYPE_LABELS[t.type]} <span className={STATUS_CLS[t.status]}>{STATUS_LABEL[t.status]}</span>
                    {t.detail && <span className="text-gray-600"> · {t.detail}</span>}
                  </p>
                ))}
              </div>
            )}
            {(normalVars.length > 0 || internalVars.length > 0) && (
              <p className="text-[9px] text-gray-500 leading-relaxed">
                黑板：
                {normalVars.map(([k, v]) => `${k}=${v}`).join('、') || '（空）'}
                {internalVars.length > 0 && (
                  <span className="text-gray-600"> · 内部进度：{internalVars.map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join('、')}</span>
                )}
              </p>
            )}
            {callLog.length > 0 && (
              <div className="max-h-24 overflow-y-auto space-y-0.5">
                {callLog.map((c, i) => (
                  <p key={i} className="text-[9px] text-gray-600 font-mono">{c}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
