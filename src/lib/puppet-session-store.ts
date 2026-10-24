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
export interface PuppetSessionState {

  // ---- 操控会话 ----
  /** 正在操控的角色 id */
  performCharacterId: string | null;
  /** 操控中选中的节点 id（与 ProjectStore.selectedNodeId 单向同步） */
  performNodeId: string | null;
  /** 画布直接操控是否已激活 */
  performArmed: boolean;
  /** 自动关键帧：拖动/按键是否自动写入关键帧（默认开） */
  autoKeyframe: boolean;
  /** 木偶洋葱皮（默认开） */
  puppetOnionSkin: boolean;
  /**
   * 显示全部角色（默认关，即互斥只显示选中角色）。
   * rig/dress 阶段强制互斥；perform 阶段用户可切换。
   */
  showAllCharacters: boolean;

  setPerformNodeId: (id: string | null) => void;
  setAutoKeyframe: (v: boolean) => void;
  setPuppetOnionSkin: (v: boolean) => void;
  setShowAllCharacters: (v: boolean) => void;

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
   * 不存在则创建一个归属该角色的片段（时间窗缺省为工程全程）。
   */
  ensurePuppetClip: (characterId: string) => string | null;

  /** 录制当前全部节点姿态到当前帧（整姿态关键帧） */
  recordFullPose: () => void;
  /** 清除当前帧该角色的全部木偶关键帧 */
  clearFramePose: () => void;
}

function getRootNodeId(characterId: string): string | null {
  const character = Object.values(useProjectStore.getState().unifiedCharacters ?? {}).find((c) => c.id === characterId);
  if (!character) return null;
  return character.rootNodeId ?? Object.keys(character.nodes)[0] ?? null;
}

export const usePuppetSessionStore = create<PuppetSessionState>()((set, get) => ({
  performCharacterId: null,
  performNodeId: null,
  performArmed: false,
  autoKeyframe: true,
  puppetOnionSkin: true,
  showAllCharacters: false,

  setPerformNodeId: (id) => {
    set({ performNodeId: id });
    // 单向同步到画布高亮
    useProjectStore.getState().setSelectedNodeId(id);
  },

  setAutoKeyframe: (v) => set({ autoKeyframe: v }),
  setPuppetOnionSkin: (v) => set({ puppetOnionSkin: v }),
  setShowAllCharacters: (v) => set({ showAllCharacters: v }),

  ensurePuppetClip: (characterId) => {
    const project = useProjectStore.getState();
    const character = Object.values(project.unifiedCharacters ?? {}).find((c) => c.id === characterId);
    if (!character) return null;
    const existing = project.animationClips.find(
      (c) => true && c.puppetCharacterId === characterId
    );
    if (existing) {
      if (project.activeAnimationClipId !== existing.id) {
        project.setActiveAnimationClip(existing.id);
      }
      return existing.id;
    }
    const clip = project.addAnimationClip(`${character.name}动画`, characterId);
    return clip.id;
  },

  enterPerform: (characterId) => {
    const project = useProjectStore.getState();
    const editor = useEditorStore.getState();
    const character = Object.values(project.unifiedCharacters ?? {}).find((c) => c.id === characterId);
    if (!character) return;

    // 1. 确保木偶片段存在并激活
    get().ensurePuppetClip(characterId);

    // 2. 画布进入木偶操控：工具 + 骨骼叠加层
    editor.setTool('puppet');
    editor.setActivePuppetSkeletonId(characterId);
    if (!editor.showPuppetSkeleton) editor.togglePuppetSkeleton();

    // 3. 选中根节点
    const rootId = getRootNodeId(characterId);

    set({
      performCharacterId: characterId,
      performNodeId: rootId,
      performArmed: true,
    });
    project.setSelectedNodeId(rootId);
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
    const character = project.unifiedCharacters[performCharacterId];
    if (!character) return;

    const frame = project.currentFrame;

    // 录制“当前可见姿态”：用关键帧插值求出每节点在当前帧的实际值，
    // 而不是 rest pose（perform 阶段拖动只写轨道，不碰 rest pose）。
    // 姿态写入节点轨道的通道点（渲染的唯一姿态数据源）；同帧的修饰器/
    // 转面/图层附件点不属于姿态，保持不动。
    const interpolated = interpolateNodeKeyframes(character, frame);

    project.pushUndo('录制姿态');
    useProjectStore.setState((st) => {
      const ch = st.unifiedCharacters[performCharacterId];
      if (!ch) return st;
      const nodes: typeof ch.nodes = {};
      for (const node of Object.values(ch.nodes)) {
        const iv = interpolated.get(node.id);
        const setTrack = (
          tracks: typeof node.tracks,
          name: 'angle' | 'x' | 'y' | 'stretch' | 'scaleX',
          value: number,
        ) => {
          const track = tracks?.[name] ?? { keyframes: [], interpolation: 'linear' as const };
          const idx = track.keyframes.findIndex((k) => k.frame === frame);
          const keyframes = idx >= 0
            ? track.keyframes.map((k, i) => (i === idx ? { ...k, value } : k))
            : [...track.keyframes, { frame, value }].sort((a, b) => a.frame - b.frame);
          return { ...track, keyframes };
        };
        let tracks = node.tracks ?? {};
        tracks = { ...tracks, angle: setTrack(tracks, 'angle', iv?.angle ?? node.transform.angle) };
        tracks = { ...tracks, stretch: setTrack(tracks, 'stretch', iv?.stretch ?? node.transform.stretch) };
        tracks = { ...tracks, scaleX: setTrack(tracks, 'scaleX', iv?.scaleX ?? node.transform.scaleX ?? 1) };
        tracks = { ...tracks, x: setTrack(tracks, 'x', iv?.x ?? node.transform.x) };
        tracks = { ...tracks, y: setTrack(tracks, 'y', iv?.y ?? node.transform.y) };
        nodes[node.id] = { ...node, tracks };
      }
      return {
        unifiedCharacters: {
          ...st.unifiedCharacters,
          [performCharacterId]: { ...ch, nodes },
        },
      };
    });
  },

  clearFramePose: () => {
    const { performCharacterId } = get();
    if (!performCharacterId) return;
    const project = useProjectStore.getState();
    const character = project.unifiedCharacters[performCharacterId];
    if (!character) return;

    const frame = project.currentFrame;
    project.pushUndo('清除本帧姿态');
    useProjectStore.setState((st) => {
      const ch = st.unifiedCharacters[performCharacterId];
      if (!ch) return st;
      const nodes: typeof ch.nodes = {};
      for (const node of Object.values(ch.nodes)) {
        if (!node.tracks) { nodes[node.id] = node; continue; }
        const tracks: typeof node.tracks = {};
        for (const [key, track] of Object.entries(node.tracks)) {
          if (!track) continue;
          tracks[key as keyof typeof tracks] = {
            ...track,
            keyframes: track.keyframes.filter((k: { frame: number }) => k.frame !== frame),
          } as never;
        }
        nodes[node.id] = { ...node, tracks };
      }
      return {
        unifiedCharacters: {
          ...st.unifiedCharacters,
          [performCharacterId]: { ...ch, nodes },
        },
      };
    });
  },
}));
