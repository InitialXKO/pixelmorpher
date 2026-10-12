'use client';

// ============================================================
// GlobalBlueprintEditor — 全局蓝图编辑器
// 把各部件蓝图合并成一个大图，用 BlueprintEditor 统一编辑
// 保存时自动拆分回各部件
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import { Network } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { PuppetSkeleton } from '@/lib/types';
import type { BlueprintGraph } from '@/lib/blueprint/ir';
import { mergeBlueprints, splitBlueprints } from '@/lib/blueprint/global';
import BlueprintEditor from './BlueprintEditor';

interface GlobalBlueprintEditorProps {
  skeleton: PuppetSkeleton | null;
}

export default function GlobalBlueprintEditor({ skeleton }: GlobalBlueprintEditorProps) {
  // 合并后的图（本地编辑状态）
  const [mergedGraph, setMergedGraph] = useState<BlueprintGraph | null>(null);
  const [outputMap, setOutputMap] = useState<Map<string, string>>(new Map());
  // 当前选中的部件：新节点归属到它
  const selectedPuppetNodeId = useProjectStore((s) => s.selectedPuppetNodeId);

  // 从 skeleton 重新合并（打开编辑器时）
  const merged = useMemo(() => {
    if (!skeleton) return null;
    // 如果本地有编辑状态，优先用本地的（避免 skeleton 更新时丢失编辑）
    if (mergedGraph) return { graph: mergedGraph, outputMap };
    const result = mergeBlueprints(skeleton);
    return result;
  }, [skeleton, mergedGraph, outputMap]);

  // 打开全局编辑器
  const handleOpen = useCallback(() => {
    if (!skeleton) return;
    const result = mergeBlueprints(skeleton);
    setMergedGraph(result.graph);
    setOutputMap(result.outputMap);
  }, [skeleton]);

  // 关闭（丢弃未保存）
  const handleClose = useCallback(() => {
    setMergedGraph(null);
    setOutputMap(new Map());
  }, []);

  // 保存：拆分回各部件
  const handleSave = useCallback(() => {
    if (!skeleton || !mergedGraph) return;
    const split = splitBlueprints(mergedGraph, skeleton, outputMap);
    const store = useProjectStore.getState();
    for (const [puppetNodeId, graph] of split) {
      store.updatePuppetNode(skeleton.id, puppetNodeId, { blueprint: graph });
    }
    setMergedGraph(null);
    setOutputMap(new Map());
  }, [skeleton, mergedGraph, outputMap]);

  if (!skeleton) return null;

  const hasAnyBlueprint = skeleton.nodes.some((n) => n.blueprint);

  // 未打开时显示入口
  if (!mergedGraph) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
            <Network className="size-3" />
            全局蓝图
          </span>
          <span className="text-[9px] text-gray-500">
            {skeleton.nodes.filter((n) => n.blueprint).length}/{skeleton.nodes.length} 有蓝图
          </span>
        </div>
        {!hasAnyBlueprint ? (
          <p className="text-[9px] text-gray-600 text-center py-2">
            还没有蓝图 — 先用模板应用或为单个节点创建
          </p>
        ) : (
          <button
            onClick={handleOpen}
            className="w-full px-2 py-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] text-cyan-300 transition-colors"
          >
            打开全局蓝图编辑器（{skeleton.nodes.filter((n) => n.blueprint).length} 个部件）
          </button>
        )}
      </div>
    );
  }

  // 编辑中
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-300 font-medium flex items-center gap-1">
          <Network className="size-3 text-cyan-400" />
          全局蓝图编辑中
        </span>
        <div className="flex gap-1">
          <button
            onClick={handleClose}
            className="px-2 h-6 text-[10px] text-gray-400 hover:text-gray-200"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-2 h-6 text-[10px] bg-cyan-600 hover:bg-cyan-500 text-white rounded"
          >
            保存
          </button>
        </div>
      </div>
      <p className="text-[8px] text-gray-600 leading-relaxed">
        各部件蓝图已合并显示（按部件分组排列）。拖动节点、连线、改参数均可。保存时自动拆分回各部件。跨部件连线会被丢弃。
      </p>
      <BlueprintEditor
        graph={mergedGraph}
        onChange={setMergedGraph}
        skeleton={skeleton}
        idPrefix={selectedPuppetNodeId ?? undefined}
      />
    </div>
  );
}
