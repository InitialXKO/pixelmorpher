'use client';

import React from 'react';
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
import type { PuppetWorkspaceMode } from './puppet/types';
import { usePuppetPanelState } from './puppet/usePuppetPanelState';
import SkeletonModePanel from './puppet/SkeletonModePanel';
import { CostumeManager } from './CostumeManager';
import { useCostumeManagerAdapter } from './puppet/useCostumeManagerAdapter';
import AnimateModePanel from './puppet/AnimateModePanel';

// ---- Main Component ----

export default function PuppetPanel() {
  const state = usePuppetPanelState();
  const costumeAdapter = useCostumeManagerAdapter(state);

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
            onClick={() => state.setWizardOpen(true)}
            title="创建木偶角色"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {/* Step stepper */}
        <div className="flex items-center gap-0.5">
          {WORKFLOW_STEPS.map((step, i) => {
            const isActive = state.mode === step.key;
            const isComplete =
              (step.key === 'skeleton' && state.hasSkeletons) ||
              (step.key === 'costume' && state.hasCharacters) ||
              (step.key === 'animate' && state.hasClips);
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
                  onClick={() => state.setMode(step.key)}
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

      <PuppetCreationWizard open={state.wizardOpen} onClose={() => state.setWizardOpen(false)} />

      {/* Empty state when no mode selected */}
      {state.mode === 'none' && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <Users className="size-8 text-cyan-500/30 mx-auto" />
            <div>
              <p className="text-[11px] text-gray-400 mb-1">开始创建木偶角色</p>
              <p className="text-[9px] text-gray-600 leading-relaxed">
                点击右上角 + 创建新角色，或选择上方工作流步骤开始编辑
              </p>
            </div>
            <Button
              size="sm"
              className="text-[10px] bg-cyan-600 hover:bg-cyan-500"
              onClick={() => state.setWizardOpen(true)}
            >
              <Plus className="size-3 mr-1" /> 创建角色
            </Button>
          </div>
        </div>
      )}

      {/* Mode content */}
      {state.mode !== 'none' && (
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2">
          {/* ============ SKELETON MODE ============ */}
          {state.mode === 'skeleton' && (
            <SkeletonModePanel
              puppetSkeletons={state.puppetSkeletons}
              puppetCharacters={state.puppetCharacters}
              parts={state.parts}
              selectedSkeletonId={state.selectedSkeletonId}
              setSelectedSkeletonId={state.setSelectedSkeletonId}
              selectedNodeId={state.selectedNodeId}
              selectedSkeleton={state.selectedSkeleton}
              selectedNode={state.selectedNode}
              direction={state.direction}
              setDirection={state.setDirection}
              latitude={state.latitude}
              setLatitude={state.setLatitude}
              handleSelectNodeWithSync={state.handleSelectNodeWithSync}
            />
          )}

          {/* ============ COSTUME MODE ============ */}
          {state.mode === 'costume' && (
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

          {/* ============ ANIMATE MODE ============ */}
          {state.mode === 'animate' && (
            <AnimateModePanel
              puppetCharacters={state.puppetCharacters}
              animationClips={state.animationClips}
              currentFrame={state.currentFrame}
              animateCharacterId={state.animateCharacterId}
              setAnimateCharacterId={state.setAnimateCharacterId}
              animateDirection={state.animateDirection}
              setAnimateDirection={state.setAnimateDirection}
              animateSelectedNodeId={state.animateSelectedNodeId}
              animateCharacter={state.animateCharacter}
              animateSkeleton={state.animateSkeleton}
              animateSelectedNode={state.animateSelectedNode}
              activePuppetClip={state.activePuppetClip}
              latitude={state.latitude}
              setLatitude={state.setLatitude}
              autoCreatedRef={state.autoCreatedRef}
              handleSelectAnimateNodeWithSync={state.handleSelectAnimateNodeWithSync}
            />
          )}
        </div>
      </ScrollArea>
      )}
    </div>
  );
}
