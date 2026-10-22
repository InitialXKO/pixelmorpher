'use client';

// ============================================================
// BehaviorPanel — 程序化行为与表演（角色级）
// 行为与表演同源同工具（蓝图，按节点存图）：
// - 行为 character.behaviorGraphs[nodeId]：输入驱动的无限过程，
//   运行时实时求值；宿主 vars = t/phase/moveX/speed01/grounded。
// - 表演 character.performances：有限时长触发式，导出时采样烘焙。
// 服务于程序化预览与「程序化运行时包」导出；编辑器关键帧系统不消费。
// ============================================================

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { Character, ProcPerformance } from '@/lib/unified-types';
import type { BlueprintGraph } from '@/lib/blueprint/ir';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import BlueprintEditor from './BlueprintEditor';

const selCls = 'h-6 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300 px-1';
const numCls = 'h-6 text-[10px] bg-[#111128] border-[#1e1e3a]';

function emptyGraph(): BlueprintGraph {
  return {
    version: 1,
    outputId: 'out',
    nodes: [
      { id: 't', type: 'time', inputs: {}, params: {}, ui: { x: 40, y: 120 } },
      { id: 'out', type: 'transform', inputs: {}, params: {}, ui: { x: 320, y: 120 } },
    ],
  };
}

export default function BehaviorPanel({ unifiedCharacters }: { unifiedCharacters: Record<string, Character> }) {
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const character = activePuppetSkeletonId ? (unifiedCharacters[activePuppetSkeletonId] ?? null) : null;
  const [selPerfId, setSelPerfId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ perfId: string; nodeId: string; graph: BlueprintGraph } | null>(null);
  const [editingBehavior, setEditingBehavior] = useState<{ nodeId: string; graph: BlueprintGraph } | null>(null);

  if (!character) {
    return <p className="text-[10px] text-gray-500">先在左侧选择一个角色。</p>;
  }
  const charId = character.id;
  const behaviorGraphs = character.behaviorGraphs ?? {};
  const performances = character.performances ?? [];
  const nodes = Object.values(character.nodes);

  const patchCharacter = (updates: Partial<Character>, undoLabel: string) => {
    const store = useProjectStore.getState();
    store.pushUndo(undoLabel, 'behavior');
    store.updateUnifiedCharacter(charId, updates);
  };
  const patchPerf = (id: string, p: Partial<ProcPerformance>) => {
    patchCharacter(
      { performances: performances.map((x) => (x.id === id ? { ...x, ...p } : x)) },
      '表演',
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-[9px] text-gray-600 leading-relaxed">
        行为与表演都是蓝图（按节点存图、同一个编辑器）：行为是输入驱动的无限过程，
        运行时实时求值；表演是有限时长，导出时采样烘焙。编辑器关键帧不消费这些数据。
      </p>

      {/* ---------- 行为蓝图 ---------- */}
      <div>
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">行为蓝图（按节点）</Label>
        <p className="mt-0.5 text-[9px] text-gray-600 leading-relaxed">
          时间基 = 60fps 帧（time 节点输出帧数）。宿主 vars（用 var 节点读）：
          t=秒、phase=步态相位帧（移动约 30/s、静止 4/s、腾空 18/s）、
          moveX=-1/0/1、speed01、grounded=1/0。跨节点跟随用 nodeRef（读上一帧输出）。
          节点徽标为行为语境方言：可求值 / 不支持（gait、expression 暂未移植）。
        </p>
        <div className="mt-1 max-h-56 overflow-y-auto space-y-1 pr-1">
          {nodes.map((n) => {
            const g = behaviorGraphs[n.id];
            return (
              <div key={n.id} className="flex items-center gap-1.5 text-[10px]">
                <span className="flex-1 truncate text-gray-300" title={n.name}>{n.name}</span>
                {g
                  ? <span className="text-gray-500">{g.nodes.length} 节点</span>
                  : <span className="text-gray-600">无行为图</span>}
                <Button
                  size="sm" variant="outline" className="h-5 text-[9px] px-1.5"
                  onClick={() => setEditingBehavior({ nodeId: n.id, graph: g ?? emptyGraph() })}
                >
                  {g ? '编辑行为图' : '创建行为图'}
                </Button>
                {g && (
                  <Button
                    size="sm" variant="ghost" className="size-5 text-red-400 hover:text-red-300"
                    onClick={() => {
                      const next = { ...behaviorGraphs };
                      delete next[n.id];
                      patchCharacter({ behaviorGraphs: next }, '删除行为图');
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- 行为图编辑（内嵌蓝图编辑器，行为语境） ---------- */}
      {editingBehavior && (
        <div className="pt-2 border-t border-[#1e1e3a] space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-300">
              行为图：{character.nodes[editingBehavior.nodeId]?.name}
            </span>
            <div className="flex-1" />
            <Button
              size="sm" className="h-7 text-[11px]"
              onClick={() => {
                patchCharacter(
                  { behaviorGraphs: { ...behaviorGraphs, [editingBehavior.nodeId]: editingBehavior.graph } },
                  '行为图',
                );
                setEditingBehavior(null);
              }}
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEditingBehavior(null)}>取消</Button>
          </div>
          <BlueprintEditor
            graph={editingBehavior.graph}
            onChange={(g) => setEditingBehavior({ ...editingBehavior, graph: g })}
            title="行为图"
            character={character}
            spaceContext="behavior"
            frameRate={60}
          />
        </div>
      )}
      {/* ---------- 表演清单 ---------- */}
      <div className="pt-2 border-t border-[#1e1e3a]">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">表演（挂蓝图）</Label>
          <Button
            size="sm" variant="ghost" className="size-6 text-cyan-400 hover:text-cyan-300"
            onClick={() => {
              const perf: ProcPerformance = {
                id: crypto.randomUUID(), name: `表演 ${performances.length + 1}`, trigger: 'attack',
                duration: 0.5, envelopeIn: 0.05, envelopeOut: 0.15, mode: 'override',
                maskNodeIds: [], graphs: {}, enabled: true,
              };
              patchCharacter({ performances: [...performances, perf] }, '新增表演');
              setSelPerfId(perf.id);
            }}
            title="新增表演"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="mt-1 space-y-1.5">
          {performances.length === 0 && <p className="text-[10px] text-gray-600">尚无表演。表演 = 一段按包络淡入淡出的蓝图演出，掩码外的部件继续程序化。</p>}
          {performances.map((perf) => (
            <div key={perf.id} className="rounded border border-[#1e1e3a] p-1.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input type="checkbox" checked={perf.enabled} onChange={(e) => patchPerf(perf.id, { enabled: e.target.checked })} title="启用" />
                <Input value={perf.name} onChange={(e) => patchPerf(perf.id, { name: e.target.value })} className={numCls + ' flex-1'} />
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={() => setSelPerfId(selPerfId === perf.id ? null : perf.id)}>
                  {selPerfId === perf.id ? '收起' : '展开'}
                </Button>
                <Button size="sm" variant="ghost" className="size-6 text-red-400 hover:text-red-300" onClick={() => patchCharacter({ performances: performances.filter((x) => x.id !== perf.id) }, '删除表演')}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
              {selPerfId === perf.id && (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <Label className="text-[9px] text-gray-600">触发动作（宿主输入名）</Label>
                      <Input value={perf.trigger} onChange={(e) => patchPerf(perf.id, { trigger: e.target.value })} className={numCls + ' w-full'} placeholder="attack" />
                    </div>
                    <div>
                      <Label className="text-[9px] text-gray-600">时长（秒）</Label>
                      <Input type="number" step="0.05" value={perf.duration} onChange={(e) => patchPerf(perf.id, { duration: Math.max(0.05, Number(e.target.value) || 0.5) })} className={numCls + ' w-full'} />
                    </div>
                    <div>
                      <Label className="text-[9px] text-gray-600">合成口径</Label>
                      <select value={perf.mode} onChange={(e) => patchPerf(perf.id, { mode: e.target.value as 'add' | 'override' })} className={selCls + ' w-full'}>
                        <option value="override">接管（包络混合）</option>
                        <option value="add">加算</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[9px] text-gray-600">残影部件</Label>
                      <select value={perf.afterimageNodeId ?? ''} onChange={(e) => patchPerf(perf.id, { afterimageNodeId: e.target.value || undefined })} className={selCls + ' w-full'}>
                        <option value="">（无）</option>
                        {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[9px] text-gray-600">淡入（秒）</Label>
                      <Input type="number" step="0.01" value={perf.envelopeIn} onChange={(e) => patchPerf(perf.id, { envelopeIn: Math.max(0, Number(e.target.value) || 0) })} className={numCls + ' w-full'} />
                    </div>
                    <div>
                      <Label className="text-[9px] text-gray-600">淡出（秒）</Label>
                      <Input type="number" step="0.01" value={perf.envelopeOut} onChange={(e) => patchPerf(perf.id, { envelopeOut: Math.max(0, Number(e.target.value) || 0) })} className={numCls + ' w-full'} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[9px] text-gray-600">部件掩码与表演图（每节点一张图，在蓝图编辑器里以该节点为目标编辑）</Label>
                    <div className="mt-1 max-h-48 overflow-y-auto space-y-1 pr-1">
                      {nodes.map((n) => {
                        const inMask = perf.maskNodeIds.includes(n.id);
                        return (
                          <div key={n.id} className="flex items-center gap-1.5 text-[10px]">
                            <input
                              type="checkbox" checked={inMask}
                              onChange={(e) => patchPerf(perf.id, {
                                maskNodeIds: e.target.checked ? [...perf.maskNodeIds, n.id] : perf.maskNodeIds.filter((x) => x !== n.id),
                              })}
                            />
                            <span className="flex-1 truncate text-gray-300">{n.name}</span>
                            {inMask && (
                              <Button
                                size="sm" variant="outline" className="h-5 text-[9px] px-1.5"
                                onClick={() => setEditing({ perfId: perf.id, nodeId: n.id, graph: perf.graphs[n.id] ?? emptyGraph() })}
                              >
                                {perf.graphs[n.id] ? '编辑表演图' : '创建表演图'}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- 表演图编辑（内嵌蓝图编辑器，运行时语境） ---------- */}
      {editing && (
        <div className="pt-2 border-t border-[#1e1e3a] space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-300">
              表演图：{performances.find((p) => p.id === editing.perfId)?.name} → {character.nodes[editing.nodeId]?.name}
            </span>
            <div className="flex-1" />
            <Button
              size="sm" className="h-7 text-[11px]"
              onClick={() => {
                const perf = performances.find((p) => p.id === editing.perfId);
                if (perf) patchPerf(perf.id, { graphs: { ...perf.graphs, [editing.nodeId]: editing.graph } });
                setEditing(null);
              }}
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEditing(null)}>取消</Button>
          </div>
          <p className="text-[9px] text-gray-600">
            时间基 = 表演时长（time 节点的 t 按帧计，采样时以时长换算）；节点徽标为运行时方言：可求值 / 采样烘焙 / 不支持。
          </p>
          <BlueprintEditor
            graph={editing.graph}
            onChange={(g) => setEditing({ ...editing, graph: g })}
            title="表演图"
            character={character}
            spaceContext="performance"
          />
        </div>
      )}
    </div>
  );
}
