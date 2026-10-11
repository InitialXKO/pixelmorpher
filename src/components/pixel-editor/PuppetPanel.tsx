'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  ArrowRight,
  Users,
  CheckCircle2,
  Box,
  Dog,
} from 'lucide-react';
import PuppetCreationWizard from './PuppetCreationWizard';
import { Button } from '@/components/ui/button';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { useProjectStore, useEditorStore } from '@/lib/store';
import RigPanel from './puppet/RigPanel';
import DressPanel from './puppet/DressPanel';
import PerformPanel from './puppet/PerformPanel';
import type { PuppetDirection } from '@/lib/types';

// ---- Main Component ----

export default function PuppetPanel() {
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const animationClips = useProjectStore((s) => s.animationClips);
  const parts = useProjectStore((s) => s.parts);
  const canvasSelectedNodeId = useProjectStore((s) => s.selectedPuppetNodeId);
  const setSelectedPuppetNodeId = useProjectStore((s) => s.setSelectedPuppetNodeId);

  // ---- 骨架选择用左侧的 activePuppetSkeletonId，不再用本地 state ----
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  // 节点选择用 store（与左侧共享树同步），不再用本地 state
  const selectedNodeId = useProjectStore((s) => s.selectedPuppetNodeId);
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedPuppetNodeId);
  const [direction, setDirection] = useState<PuppetDirection>('S');
  const [latitude, setLatitude] = useState(0);

  // ---- dress 阶段本地状态 ----
  const [selectedCostumeId, setSelectedCostumeId] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);

  const selectedSkeleton = puppetSkeletons.find((s) => s.id === activePuppetSkeletonId) ?? null;
  const selectedNode = selectedSkeleton?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // M1: 切换骨骼时用骨骼实际的方向/纬度回填，否则方向盘显示与骨骼脱节
  useEffect(() => {
    if (selectedSkeleton) {
      setDirection(selectedSkeleton.currentDirection ?? 'S');
      setLatitude(selectedSkeleton.viewLatitude ?? 0);
    }
  }, [activePuppetSkeletonId]);

  // ---- 画布 → 面板：单向同步选中节点 ----
  // 画布点击节点只写 ProjectStore.selectedPuppetNodeId，
  // 这里按当前阶段分发：perform 阶段进 session，其它阶段进本地 rig 状态。
  useEffect(() => {
    if (!canvasSelectedNodeId) return;
    const st = useProjectStore.getState();
    const skel = (st.puppetSkeletons ?? []).find((sk) =>
      sk.nodes.some((n) => n.id === canvasSelectedNodeId)
    );
    if (!skel) return;
    // 合并后面板不再分 phase，统一同步选中
    const sess = usePuppetSessionStore.getState();
    if (sess.performNodeId !== canvasSelectedNodeId) {
      usePuppetSessionStore.setState({ performNodeId: canvasSelectedNodeId });
    }
    const editorStore = useEditorStore.getState();
    if (editorStore.activePuppetSkeletonId !== skel.id) {
      editorStore.setActivePuppetSkeletonId(skel.id);
    }
    if (selectedNodeId !== canvasSelectedNodeId) setSelectedNodeId(canvasSelectedNodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSelectedNodeId]);

  const handleSelectNodeWithSync = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedPuppetNodeId(nodeId);
  };

  // M1: rig 阶段纬度写入 store，渲染端读的是 skeleton.viewLatitude
  const handleSetLatitude = useCallback((lat: number) => {
    setLatitude(lat);
    const skelId = useEditorStore.getState().activePuppetSkeletonId;
    if (skelId) {
      useProjectStore.getState().setPuppetLatitude(skelId, lat);
    }
  }, [activePuppetSkeletonId]);

  const hasSkeletons = puppetSkeletons.length > 0;
  const hasCharacters = puppetCharacters.length > 0;
  const hasClips = animationClips.some((c) => true);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d1a]">
      {/* Workflow Header */}
      <div className="px-2 py-2 border-b border-[#1e1e3a]">
        {/* Title row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <Users className="size-3.5 text-cyan-400" />
          <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider flex-1">
            木偶工作流
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-cyan-400 hover:text-cyan-300"
            onClick={() => setWizardOpen(true)}
            title="创建木偶角色"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-amber-400 hover:text-amber-300"
            onClick={() => {
              const store = useProjectStore.getState();
              store.addPropCharacter(`道具${store.puppetCharacters.length + 1}`);
            }}
            title="新建道具（单节点木偶，用于背景/道具/UI 动画）"
          >
            <Box className="size-3.5" />
          </Button>
        </div>

      </div>

      <PuppetCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* Empty state when nothing exists yet */}
      {!hasSkeletons && !hasCharacters && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <Users className="size-8 text-cyan-500/30 mx-auto" />
            <div>
              <p className="text-[11px] text-gray-400 mb-1">开始创建木偶角色</p>
              <p className="text-[9px] text-gray-600 leading-relaxed">
                点击右上角 + 创建新角色，或使用创建向导
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button
                size="sm"
                className="text-[10px] bg-cyan-600 hover:bg-cyan-500"
                onClick={() => setWizardOpen(true)}
              >
                <Plus className="size-3 mr-1" /> 创建角色
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] border-[#2a2a4a] text-gray-300"
                onClick={() => {
                  import('@/lib/blueprint/examples/quadruped-run').then((m) => {
                    const sessionStore = usePuppetSessionStore.getState();
                    const id = m.createPuppyRunExampleCharacter(useProjectStore, sessionStore);
                    if (!id) {
                      alert('小狗创建失败，请看控制台');
                    }
                  });
                }}
              >
                <Dog className="size-3 mr-1" /> 小狗奔跑示例
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Phase content - 三段合一，不再按 phase 切换 */}
      {(hasSkeletons || hasCharacters) && (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="p-2 space-y-2">
            {/* ============ 搭建 RIG ============ */}
            {hasSkeletons && (
              <details open className="bg-white/[0.02] border border-white/10 rounded">
                <summary className="px-2 py-1.5 text-[11px] font-medium text-gray-300 cursor-pointer select-none">
                  🦴 搭建骨架
                </summary>
                <div className="p-2 pt-0">
                  <RigPanel
                    puppetSkeletons={puppetSkeletons}
                    selectedNodeId={selectedNodeId}
                    selectedNode={selectedNode}
                    handleSelectNodeWithSync={handleSelectNodeWithSync}
                    
                  />
                </div>
              </details>
            )}

            {/* ============ 换装 DRESS ============ */}
            <details open className="bg-white/[0.02] border border-white/10 rounded">
              <summary className="px-2 py-1.5 text-[11px] font-medium text-gray-300 cursor-pointer select-none">
                👗 换装
              </summary>
              <div className="p-2 pt-0">
                <DressPanel
                  puppetCharacters={puppetCharacters}
                  puppetSkeletons={puppetSkeletons}
                  parts={parts}
                  selectedCostumeId={selectedCostumeId}
                  setSelectedCostumeId={setSelectedCostumeId}
                  selectedNodeId={selectedNodeId}
                  handleSelectNodeWithSync={handleSelectNodeWithSync}
                  hideNodeList={true}
                />
              </div>
            </details>

            {/* ============ 操控 PERFORM ============ */}
            <details open className="bg-white/[0.02] border border-white/10 rounded">
              <summary className="px-2 py-1.5 text-[11px] font-medium text-gray-300 cursor-pointer select-none">
                🎬 操控动画
              </summary>
              <div className="p-2 pt-0">
                <PerformPanel hideNodeList={true} />
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
