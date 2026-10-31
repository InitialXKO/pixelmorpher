'use client';

// ============================================================
// GlobalBlueprintEditor — 全局蓝图编辑器
// 把各部件蓝图合并成一个大图，用 BlueprintEditor 统一编辑
// 保存时自动拆分回各部件
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import { Network } from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import type { BlueprintGraph } from '@/lib/blueprint/ir';
import { mergeBlueprints, splitBlueprints } from '@/lib/blueprint/global';
import BlueprintEditor from './BlueprintEditor';
import { useBlueprintPreviewData } from './use-blueprint-preview-data';

interface GlobalBlueprintEditorProps {
  character: Character | null;
}

export default function GlobalBlueprintEditor({ character }: GlobalBlueprintEditorProps) {
  // 合并后的图（本地编辑状态）
  const [mergedGraph, setMergedGraph] = useState<BlueprintGraph | null>(null);
  const [outputMap, setOutputMap] = useState<Map<string, string>>(new Map());
  // 打开时的快照：合并的部件清单（保存遍历以此为准）、部件顺序
  // （ui 偏移还原基准）、各部件 followMode（拆分写回通道）
  const [openPartIds, setOpenPartIds] = useState<string[]>([]);
  const [openPartOrder, setOpenPartOrder] = useState<string[]>([]);
  const [followMap, setFollowMap] = useState<Map<string, 'prev' | 'same'>>(new Map());
  // 当前选中的部件：新节点归属到它
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  // 预览接线：与 PuppetModifierPanel 同一构造（服装/变体解析 + 整角色预览数据）
  const { spritesTable, costumeSetsNewFormat, characterNodes } = useBlueprintPreviewData(character);

  // 从 character 重新合并（打开编辑器时）
  const merged = useMemo(() => {
    if (!character) return null;
    // 如果本地有编辑状态，优先用本地的（避免 character 更新时丢失编辑）
    if (mergedGraph) return { graph: mergedGraph, outputMap };
    const result = mergeBlueprints(character);
    return result;
  }, [character, mergedGraph, outputMap]);

  // 打开全局编辑器
  const handleOpen = useCallback(() => {
    if (!character) return;
    const result = mergeBlueprints(character);
    setMergedGraph(result.graph);
    setOutputMap(result.outputMap);
    setOpenPartIds(result.partIds);
    setOpenPartOrder(result.partOrder);
    setFollowMap(result.followMap);
  }, [character]);

  // 关闭（丢弃未保存）
  const handleClose = useCallback(() => {
    setMergedGraph(null);
    setOutputMap(new Map());
    setOpenPartIds([]);
    setOpenPartOrder([]);
    setFollowMap(new Map());
  }, []);

  // 保存：拆分回各部件
  // 遍历以「打开时合并的部件清单」为准：拆回结果里有的写新图，
  // 在合并图里被删光的部件写 blueprint 清除（否则旧蓝图会原样留着）。
  // 拆回结果里多出的部件（编辑期间在全局图里给原本无蓝图的部件新建的图）一并写回；
  // 打开后在别处新增的部件不在清单也不在拆回结果里，不动。
  const handleSave = useCallback(() => {
    if (!character || !mergedGraph) return;
    const split = splitBlueprints(mergedGraph, character, outputMap, {
      partOrder: openPartOrder,
      followMap,
    });
    const store = useProjectStore.getState();
    store.pushUndo('保存全局蓝图');
    const targets = new Set<string>([...openPartIds, ...split.keys()]);
    for (const puppetNodeId of targets) {
      store.updateUnifiedNode(character.id, puppetNodeId, { blueprint: split.get(puppetNodeId) });
    }
    setMergedGraph(null);
    setOutputMap(new Map());
    setOpenPartIds([]);
    setOpenPartOrder([]);
    setFollowMap(new Map());
  }, [character, mergedGraph, outputMap, openPartIds, openPartOrder, followMap]);

  if (!character) return null;

  const nodeList = Object.values(character.nodes);
  const hasAnyBlueprint = nodeList.some((n) => n.blueprint);

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
            {nodeList.filter((n) => n.blueprint).length}/{nodeList.length} 有蓝图
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
            打开全局蓝图编辑器（{nodeList.filter((n) => n.blueprint).length} 个部件）
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
        frameRate={useProjectStore.getState().frameRate}
        graph={mergedGraph}
        onChange={setMergedGraph}
        skeleton={{ nodes: nodeList.map((n) => ({ id: n.id, name: n.name })) }}
        idPrefix={selectedNodeId ?? undefined}
        requireIdPrefix
        character={character}
        characterNodes={characterNodes}
        costumeSets={costumeSetsNewFormat}
        activeCostumeSetId={character.activeCostumeSetId}
        slotVariants={character.slotVariants}
        spritesTable={spritesTable as any}
      />
    </div>
  );
}
