'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  ArrowRight,
  Users,
  CheckCircle2,
} from 'lucide-react';
import PuppetCreationWizard from './PuppetCreationWizard';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WORKFLOW_STEPS } from './puppet/types';
import type { PuppetPhase } from './puppet/types';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { useProjectStore } from '@/lib/store';
import SkeletonModePanel from './puppet/SkeletonModePanel';
import { CostumeManager } from './CostumeManager';
import { useCostumeManagerAdapter } from './puppet/useCostumeManagerAdapter';
import PerformPanel from './puppet/PerformPanel';
import type { PuppetDirection } from '@/lib/types';

// ---- Main Component ----

export default function PuppetPanel() {
  const phase = usePuppetSessionStore((s) => s.phase);
  const setPhase = usePuppetSessionStore((s) => s.setPhase);

  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const animationClips = useProjectStore((s) => s.animationClips);
  const parts = useProjectStore((s) => s.parts);
  const canvasSelectedNodeId = useProjectStore((s) => s.selectedPuppetNodeId);
  const setSelectedPuppetNodeId = useProjectStore((s) => s.setSelectedPuppetNodeId);

  // ---- rig 阶段本地状态 ----
  const [selectedSkeletonId, setSelectedSkeletonId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [direction, setDirection] = useState<PuppetDirection>('S');
  const [latitude, setLatitude] = useState(0);

  // ---- dress 阶段本地状态 ----
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedCostumeId, setSelectedCostumeId] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);

  const selectedSkeleton = puppetSkeletons.find((s) => s.id === selectedSkeletonId) ?? null;
  const selectedNode = selectedSkeleton?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // M1: 切换骨骼时用骨骼实际的方向/纬度回填，否则方向盘显示与骨骼脱节
  useEffect(() => {
    if (selectedSkeleton) {
      setDirection(selectedSkeleton.currentDirection ?? 'S');
      setLatitude(selectedSkeleton.viewLatitude ?? 0);
    }
  }, [selectedSkeletonId]);
  const selectedCharacter = puppetCharacters.find((c) => c.id === selectedCharacterId) ?? null;

  const costumeAdapter = useCostumeManagerAdapter({
    puppetCharacters,
    puppetSkeletons,
    parts,
    selectedCharacterId,
    selectedCostumeId,
    selectedCharacter,
    setSelectedCharacterId,
    setSelectedCostumeId,
  });

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
    const currentPhase = usePuppetSessionStore.getState().phase;
    if (currentPhase === 'perform') {
      const sess = usePuppetSessionStore.getState();
      if (sess.performNodeId !== canvasSelectedNodeId) {
        usePuppetSessionStore.setState({ performNodeId: canvasSelectedNodeId });
      }
    } else if (currentPhase === 'rig') {
      if (selectedSkeletonId !== skel.id) setSelectedSkeletonId(skel.id);
      if (selectedNodeId !== canvasSelectedNodeId) setSelectedNodeId(canvasSelectedNodeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSelectedNodeId]);

  const handleSelectNodeWithSync = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedPuppetNodeId(nodeId);
  };

  // M1: rig 阶段纬度写入 store，渲染端读的是 skeleton.viewLatitude
  const handleSetLatitude = useCallback((lat: number) => {
    setLatitude(lat);
    if (selectedSkeletonId) {
      useProjectStore.getState().setPuppetLatitude(selectedSkeletonId, lat);
    }
  }, [selectedSkeletonId]);

  const handleStepClick = (key: PuppetPhase) => {
    setPhase(key);
    // 进入操控阶段但还没有角色时，保持面板让用户先选角色
  };

  const hasSkeletons = puppetSkeletons.length > 0;
  const hasCharacters = puppetCharacters.length > 0;
  const hasClips = animationClips.some((c) => c.isPuppetClip);

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
        </div>

        {/* Step stepper */}
        <div className="flex items-center gap-0.5 flex-wrap">
          {WORKFLOW_STEPS.map((step, i) => {
            const isActive = phase === step.key;
            const isComplete =
              (step.key === 'rig' && hasSkeletons) ||
              (step.key === 'dress' && hasCharacters) ||
              (step.key === 'perform' && hasClips);
            return (
              <React.Fragment key={step.key}>
                {i > 0 && <ArrowRight className="size-2 text-gray-700 mx-0.5" />}
                <button
                  className={`flex items-center gap-0.5 px-1.5 py-1 rounded text-[9px] font-medium transition-colors ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : isComplete
                      ? 'text-emerald-400/70 hover:text-emerald-400 border border-transparent'
                      : 'text-gray-600 hover:text-gray-400 hover:bg-white/5 border border-transparent'
                  }`}
                  onClick={() => handleStepClick(step.key)}
                  title={step.desc}
                >
                  {isComplete && !isActive ? (
                    <CheckCircle2 className="size-2.5" />
                  ) : (
                    step.icon
                  )}
                  {step.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <PuppetCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* Empty state when nothing exists yet */}
      {!hasSkeletons && phase === 'rig' && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <Users className="size-8 text-cyan-500/30 mx-auto" />
            <div>
              <p className="text-[11px] text-gray-400 mb-1">开始创建木偶角色</p>
              <p className="text-[9px] text-gray-600 leading-relaxed">
                点击右上角 + 创建新角色，或使用创建向导
              </p>
            </div>
            <Button
              size="sm"
              className="text-[10px] bg-cyan-600 hover:bg-cyan-500"
              onClick={() => setWizardOpen(true)}
            >
              <Plus className="size-3 mr-1" /> 创建角色
            </Button>
          </div>
        </div>
      )}

      {/* Phase content */}
      {(hasSkeletons || phase !== 'rig') && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2">
            {/* ============ RIG ============ */}
            {phase === 'rig' && hasSkeletons && (
              <SkeletonModePanel
                puppetSkeletons={puppetSkeletons}
                puppetCharacters={puppetCharacters}
                parts={parts}
                selectedSkeletonId={selectedSkeletonId}
                setSelectedSkeletonId={setSelectedSkeletonId}
                selectedNodeId={selectedNodeId}
                selectedSkeleton={selectedSkeleton}
                selectedNode={selectedNode}
                direction={direction}
                setDirection={setDirection}
                latitude={latitude}
                setLatitude={handleSetLatitude}
                handleSelectNodeWithSync={handleSelectNodeWithSync}
              />
            )}

            {/* ============ DRESS ============ */}
            {phase === 'dress' && (
              <CostumeManager
                characters={costumeAdapter.characters}
                selectedCharacterId={costumeAdapter.selectedCharacterId}
                onCharacterSelect={costumeAdapter.handleCharacterSelect}
                onCharacterDelete={costumeAdapter.handleCharacterDelete}
                costumeSets={costumeAdapter.costumeSets}
                selectedCostumeId={costumeAdapter.selectedCostumeId}
                onCostumeSelect={costumeAdapter.handleCostumeSelect}
                onCostumeAdd={costumeAdapter.handleCostumeAdd}
                onCostumeDelete={costumeAdapter.handleCostumeDelete}
                activeCostumeSetId={costumeAdapter.activeCostumeSetId}
                onActiveCostumeSetChange={costumeAdapter.handleActiveCostumeSetChange}
                nodes={costumeAdapter.nodes}
                parts={costumeAdapter.parts}
                onSpriteAssign={costumeAdapter.handleSpriteAssign}
                onSpriteRemove={costumeAdapter.handleSpriteRemove}
              />
            )}

            {/* ============ PERFORM ============ */}
            {phase === 'perform' && <PerformPanel />}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
