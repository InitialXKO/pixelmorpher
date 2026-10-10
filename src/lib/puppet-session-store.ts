'use client';

// ============================================================
// PixelMorpher - Puppet Session Store
// 木偶操控会话状态：统一管理木偶工作流的 UI 会话，
// 替代原来 skeleton/costume/animate 三套平行的选择状态。
// 这是纯 UI 会话状态（不进项目文件），与项目数据（ProjectStore）分离。
// ============================================================

import { create } from 'zustand';
import { useProjectStore, useEditorStore } from './store';
import { interpolateNodeKeyframes } from './engine/render-helpers/puppet-keyframe-interpolation';

/** 木偶工作流阶段：搭建 → 换装 → 操控 */
export type PuppetPhase = 'rig' | 'dress' | 'perform';

export interface PuppetSessionState {
  // ---- 当前阶段 ----
  phase: PuppetPhase;
  setPhase: (phase: PuppetPhase) => void;

  // ---- 操控会话 ----
  /** 正在操控的角色 id */
  performCharacterId: string | null;
  /** 操控中选中的节点 id（与 ProjectStore.selectedPuppetNodeId 单向同步） */
  performNodeId: string | null;
  /** 画布直接操控是否已激活 */
  performArmed: boolean;
  /** 自动关键帧：拖动/按键是否自动写入关键帧（默认开） */
  autoKeyframe: boolean;
  /** 木偶洋葱皮（默认开） */
  puppetOnionSkin: boolean;

  setPerformNodeId: (id: string | null) => void;
  setAutoKeyframe: (v: boolean) => void;
  setPuppetOnionSkin: (v: boolean) => void;

  /**
   * 进入操控：一键完成全部准备工作
   * - 确保木偶动画片段存在并设为 active clip
   * - 切换画布工具为 puppet、显示骨骼叠加层
   * - 选中根节点
   */
  enterPerform: (characterId: string) => void;
  /** 退出操控：解除画布工具武装，保留关键帧数据 */
  exitPerform: () => void;

  /**
   * 确保角色的木偶动画片段存在，返回 clip id。
   * 不存在则创建（12fps / 24 帧默认值）。
   */
  ensurePuppetClip: (characterId: string) => string | null;

  /** 录制当前全部节点姿态到当前帧（整姿态关键帧） */
  recordFullPose: () => void;
  /** 清除当前帧该角色的全部木偶关键帧 */
  clearFramePose: () => void;
}

function getRootNodeId(skeletonId: string): string | null {
  const skel = useProjectStore.getState().puppetSkeletons.find((s) => s.id === skeletonId);
  if (!skel) return null;
  return skel.nodes.find((n) => !n.plug)?.id ?? skel.nodes[0]?.id ?? null;
}

export const usePuppetSessionStore = create<PuppetSessionState>()((set, get) => ({
  phase: 'rig',
  performCharacterId: null,
  performNodeId: null,
  performArmed: false,
  autoKeyframe: true,
  puppetOnionSkin: true,

  setPhase: (phase) => {
    // 离开操控阶段时自动解除武装
    if (phase !== 'perform' && get().performArmed) {
      get().exitPerform();
    }
    set({ phase });
  },

  setPerformNodeId: (id) => {
    set({ performNodeId: id });
    // 单向同步到画布高亮
    useProjectStore.getState().setSelectedPuppetNodeId(id);
  },

  setAutoKeyframe: (v) => set({ autoKeyframe: v }),
  setPuppetOnionSkin: (v) => set({ puppetOnionSkin: v }),

  ensurePuppetClip: (characterId) => {
    const project = useProjectStore.getState();
    const character = (project.puppetCharacters ?? []).find((c) => c.id === characterId);
    if (!character) return null;
    const existing = project.animationClips.find(
      (c) => c.isPuppetClip && c.puppetCharacterId === characterId
    );
    if (existing) {
      if (project.activeAnimationClipId !== existing.id) {
        project.setActiveAnimationClip(existing.id);
      }
      return existing.id;
    }
    const clip = project.addAnimationClip(`${character.name}动画`);
    project.updateAnimationClip(clip.id, {
      isPuppetClip: true,
      puppetCharacterId: characterId,
      frameRate: 12,
      totalFrames: 24,
    });
    return clip.id;
  },

  enterPerform: (characterId) => {
    const project = useProjectStore.getState();
    const editor = useEditorStore.getState();
    const character = (project.puppetCharacters ?? []).find((c) => c.id === characterId);
    if (!character) return;

    // 1. 确保木偶片段存在并激活
    get().ensurePuppetClip(characterId);

    // 2. 画布进入木偶操控：工具 + 骨骼叠加层
    editor.setTool('puppet');
    editor.setActivePuppetSkeletonId(character.puppetSkeletonId);
    if (!editor.showPuppetSkeleton) editor.togglePuppetSkeleton();

    // 3. 选中根节点
    const rootId = getRootNodeId(character.puppetSkeletonId);

    set({
      phase: 'perform',
      performCharacterId: characterId,
      performNodeId: rootId,
      performArmed: true,
    });
    project.setSelectedPuppetNodeId(rootId);
  },

  exitPerform: () => {
    set({ performArmed: false });
    // 保留角色/节点选择，只解除画布武装
    const editor = useEditorStore.getState();
    if (editor.tool === 'puppet') editor.setTool('select');
  },

  recordFullPose: () => {
    const { performCharacterId } = get();
    if (!performCharacterId) return;
    const project = useProjectStore.getState();
    const character = (project.puppetCharacters ?? []).find((c) => c.id === performCharacterId);
    const skeleton = (project.puppetSkeletons ?? []).find((s) => s.id === character?.puppetSkeletonId);
    const clipId = get().ensurePuppetClip(performCharacterId);
    if (!skeleton || !clipId) return;

    const frame = project.currentFrame;
    const direction = skeleton.currentDirection;
    const latitude = skeleton.viewLatitude ?? 0;

    // 录制“当前可见姿态”：用关键帧插值求出每节点在当前帧的实际值，
    // 而不是 rest pose（perform 阶段拖动只写关键帧，不碰 rest pose）。
    const clip = project.animationClips.find((c) => c.id === clipId);
    const interpolated = interpolateNodeKeyframes(
      skeleton,
      clip?.puppetNodeKeyframes ?? [],
      frame
    );

    project.pushUndo('录制姿态');
    useProjectStore.setState((st) => ({
      animationClips: st.animationClips.map((c) => {
        if (c.id !== clipId) return c;
        const existing = c.puppetNodeKeyframes ?? [];
        // 该帧该节点的旧关键帧全部替换
        const nodeIds = new Set(skeleton.nodes.map((n) => n.id));
        const kept = existing.filter((kf) => !(kf.frame === frame && nodeIds.has(kf.nodeId)));
        const fresh = skeleton.nodes.map((node) => {
          const iv = interpolated.get(node.id);
          return {
            id: crypto.randomUUID(),
            nodeId: node.id,
            frame,
            angle: iv?.angle ?? node.angle,
            stretch: iv?.stretch ?? node.stretch,
            offsetX: iv?.offsetX ?? node.offsetX,
            offsetY: iv?.offsetY ?? node.offsetY,
            direction,
            viewLatitude: latitude,
          };
        });
        return { ...c, puppetNodeKeyframes: [...kept, ...fresh] };
      }),
    }));
  },

  clearFramePose: () => {
    const { performCharacterId } = get();
    if (!performCharacterId) return;
    const project = useProjectStore.getState();
    const character = (project.puppetCharacters ?? []).find((c) => c.id === performCharacterId);
    const skeleton = (project.puppetSkeletons ?? []).find((s) => s.id === character?.puppetSkeletonId);
    const clip = project.animationClips.find(
      (c) => c.isPuppetClip && c.puppetCharacterId === performCharacterId
    );
    if (!skeleton || !clip) return;

    const frame = project.currentFrame;
    const nodeIds = new Set(skeleton.nodes.map((n) => n.id));
    project.pushUndo('清除本帧姿态');
    useProjectStore.setState((st) => ({
      animationClips: st.animationClips.map((c) =>
        c.id === clip.id
          ? {
              ...c,
              puppetNodeKeyframes: (c.puppetNodeKeyframes ?? []).filter(
                (kf) => !(kf.frame === frame && nodeIds.has(kf.nodeId))
              ),
            }
          : c
      ),
    }));
  },
}));
