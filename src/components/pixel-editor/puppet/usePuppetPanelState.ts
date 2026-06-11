'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import React from 'react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetNode,
  PuppetCharacter,
  CostumeSet,
  PuppetDirection,
  PuppetSocket,
  PuppetNodeKeyframe,
} from '@/lib/types';
import { updateSkeletonNode } from './updateSkeletonNode';
import type { PuppetWorkspaceMode } from './types';

export interface PuppetPanelState {
  // Store values
  puppetSkeletons: PuppetSkeleton[];
  puppetCharacters: PuppetCharacter[];
  animationClips: import('@/lib/types').AnimationClip[];
  activeAnimationClipId: string | null;
  currentFrame: number;
  parts: import('@/lib/types').Part[];

  // Component state
  mode: PuppetWorkspaceMode;
  setMode: (mode: PuppetWorkspaceMode) => void;
  selectedSkeletonId: string | null;
  setSelectedSkeletonId: (id: string | null) => void;
  selectedNodeId: string | null;
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
  selectedCostumeId: string | null;
  setSelectedCostumeId: (id: string | null) => void;
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;
  direction: PuppetDirection;
  setDirection: (dir: PuppetDirection) => void;
  latitude: number;
  setLatitude: (lat: number) => void;
  animateCharacterId: string | null;
  setAnimateCharacterId: (id: string | null) => void;
  animateDirection: PuppetDirection;
  setAnimateDirection: (dir: PuppetDirection) => void;
  animateSelectedNodeId: string | null;

  // Derived
  selectedSkeleton: PuppetSkeleton | null;
  selectedNode: PuppetNode | null;
  selectedCharacter: PuppetCharacter | null;
  selectedCostume: CostumeSet | null;
  animateCharacter: PuppetCharacter | null;
  animateSkeleton: PuppetSkeleton | null;
  animateSelectedNode: PuppetNode | null;
  activePuppetClip: import('@/lib/types').AnimationClip | null;
  rootNodes: PuppetNode[];
  hasSkeletons: boolean;
  hasCharacters: boolean;
  hasClips: boolean;
  autoCreatedRef: React.MutableRefObject<string | null>;

  // Shared handlers
  handleSelectNodeWithSync: (nodeId: string | null) => void;
  handleSelectAnimateNodeWithSync: (nodeId: string | null) => void;
}

export function usePuppetPanelState(): PuppetPanelState {
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const animationClips = useProjectStore((s) => s.animationClips);
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const parts = useProjectStore((s) => s.parts);

  const [mode, setMode] = useState<PuppetWorkspaceMode>('none');
  const [selectedSkeletonId, setSelectedSkeletonId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedCostumeId, setSelectedCostumeId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [direction, setDirection] = useState<PuppetDirection>('S');
  const [latitude, setLatitude] = useState(0);
  const [animateCharacterId, setAnimateCharacterId] = useState<string | null>(null);
  const [animateDirection, setAnimateDirection] = useState<PuppetDirection>('S');
  const [animateSelectedNodeId, setAnimateSelectedNodeId] = useState<string | null>(null);

  const autoCreatedRef = useRef<string | null>(null);

  // Derived
  const selectedSkeleton = puppetSkeletons.find((s) => s.id === selectedSkeletonId) ?? null;
  const selectedNode = selectedSkeleton?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedCharacter = puppetCharacters.find((c) => c.id === selectedCharacterId) ?? null;
  const selectedCostume = selectedCharacter?.costumeSets.find((cs) => cs.id === selectedCostumeId) ?? null;
  const animateCharacter = puppetCharacters.find((c) => c.id === animateCharacterId) ?? null;
  const animateSkeleton = animateCharacter
    ? puppetSkeletons.find((s) => s.id === animateCharacter.puppetSkeletonId) ?? null
    : null;
  const animateSelectedNode = animateSkeleton?.nodes.find((n) => n.id === animateSelectedNodeId) ?? null;

  // Sync animateDirection with skeleton's currentDirection
  React.useEffect(() => {
    if (animateSkeleton) {
      setAnimateDirection(animateSkeleton.currentDirection);
    }
  }, [animateSkeleton?.id, animateSkeleton?.currentDirection]);

  // Derived: active puppet clip for the animate character
  const activePuppetClip = animateCharacterId
    ? animationClips.find((c) => c.isPuppetClip && c.puppetCharacterId === animateCharacterId) ?? null
    : null;

  // ---- Auto-create puppet clip & auto-activate ----
  useEffect(() => {
    if (mode !== 'animate' || !animateCharacterId) return;

    const store = useProjectStore.getState();
    const existingClip = store.animationClips.find(
      (c) => c.isPuppetClip && c.puppetCharacterId === animateCharacterId
    );

    if (existingClip) {
      if (store.activeAnimationClipId !== existingClip.id) {
        store.setActiveAnimationClip(existingClip.id);
      }
    } else if (autoCreatedRef.current !== animateCharacterId) {
      autoCreatedRef.current = animateCharacterId;
      const character = (store.puppetCharacters ?? []).find((c) => c.id === animateCharacterId);
      if (!character) return;

      const clipName = character.name + '动画';
      const clip = store.addAnimationClip(clipName);
      store.updateAnimationClip(clip.id, {
        isPuppetClip: true,
        puppetCharacterId: animateCharacterId,
        frameRate: 12,
        totalFrames: 24,
      });
    }
  }, [mode, animateCharacterId]);

  // ---- Sync: Canvas puppet node selection → Panel ----
  const canvasSelectedPuppetNodeId = useProjectStore((s) => s.selectedPuppetNodeId);
  useEffect(() => {
    if (!canvasSelectedPuppetNodeId) return;
    const store = useProjectStore.getState();
    const skeletons = store.puppetSkeletons ?? [];
    for (const skel of skeletons) {
      const node = skel.nodes.find(n => n.id === canvasSelectedPuppetNodeId);
      if (node) {
        if (selectedSkeletonId !== skel.id) {
          setSelectedSkeletonId(skel.id);
          useEditorStore.getState().setActivePuppetSkeletonId(skel.id);
        }
        if (selectedNodeId !== canvasSelectedPuppetNodeId) {
          setSelectedNodeId(canvasSelectedPuppetNodeId);
        }
        const character = (store.puppetCharacters ?? []).find(c => c.puppetSkeletonId === skel.id);
        if (character) {
          if (animateCharacterId !== character.id) {
            setAnimateCharacterId(character.id);
          }
          if (animateSelectedNodeId !== canvasSelectedPuppetNodeId) {
            setAnimateSelectedNodeId(canvasSelectedPuppetNodeId);
          }
          if (mode === 'none') {
            setMode('animate');
          }
        }
        break;
      }
    }
  }, [canvasSelectedPuppetNodeId]);

  // ---- Sync: Panel node selection → Canvas (selectedPuppetNodeId) ----
  const setSelectedPuppetNodeId = useProjectStore((s) => s.setSelectedPuppetNodeId);
  const handleSelectNodeWithSync = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedPuppetNodeId(nodeId);
    if (nodeId && selectedSkeletonId) {
      useEditorStore.getState().setActivePuppetSkeletonId(selectedSkeletonId);
    }
  }, [selectedSkeletonId, setSelectedPuppetNodeId]);

  const handleSelectAnimateNodeWithSync = useCallback((nodeId: string | null) => {
    setAnimateSelectedNodeId(nodeId);
    setSelectedPuppetNodeId(nodeId);
    if (nodeId && animateSkeleton) {
      useEditorStore.getState().setActivePuppetSkeletonId(animateSkeleton.id);
    }
  }, [animateSkeleton, setSelectedPuppetNodeId]);

  // Root nodes for tree
  const rootNodes = useMemo(() => {
    if (!selectedSkeleton) return [];
    const socketIds = new Set(selectedSkeleton.nodes.flatMap((n) => n.sockets.map((s) => s.id)));
    return selectedSkeleton.nodes.filter((n) => !n.plug || !socketIds.has(n.plug.socketId) || !selectedSkeleton.nodes.some((parent) => parent.sockets.some((s) => s.id === n.plug!.socketId)));
  }, [selectedSkeleton]);

  // Workflow validation
  const hasSkeletons = puppetSkeletons.length > 0;
  const hasCharacters = puppetCharacters.length > 0;
  const hasClips = animationClips.some((c) => c.isPuppetClip);

  return {
    puppetSkeletons,
    puppetCharacters,
    animationClips,
    activeAnimationClipId,
    currentFrame,
    parts,
    mode,
    setMode,
    selectedSkeletonId,
    setSelectedSkeletonId,
    selectedNodeId,
    selectedCharacterId,
    setSelectedCharacterId,
    selectedCostumeId,
    setSelectedCostumeId,
    wizardOpen,
    setWizardOpen,
    direction,
    setDirection,
    latitude,
    setLatitude,
    animateCharacterId,
    setAnimateCharacterId,
    animateDirection,
    setAnimateDirection,
    animateSelectedNodeId,
    selectedSkeleton,
    selectedNode,
    selectedCharacter,
    selectedCostume,
    animateCharacter,
    animateSkeleton,
    animateSelectedNode,
    activePuppetClip,
    rootNodes,
    hasSkeletons,
    hasCharacters,
    hasClips,
    autoCreatedRef,
    handleSelectNodeWithSync,
    handleSelectAnimateNodeWithSync,
  };
}
