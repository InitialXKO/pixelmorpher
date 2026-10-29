// ============================================================
// PixelMorpher - Procedural Animation Slice
// 程序化动画 CRUD（原寄居于已删除的旧骨骼 slice，2026-10-26 迁出独立成片）
// 数据为活功能：ProceduralPanel 编辑、unified-render 按 spriteId/nodeId 消费。
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type { ProceduralAnimation } from '../types';

export type ProceduralSlice = {
  addProceduralAnimation: ProjectStore['addProceduralAnimation'];
  removeProceduralAnimation: ProjectStore['removeProceduralAnimation'];
  updateProceduralAnimation: ProjectStore['updateProceduralAnimation'];
  toggleProceduralAnimation: ProjectStore['toggleProceduralAnimation'];
  proceduralAnimations: ProceduralAnimation[];
};

export const createProceduralSlice: StateCreator<ProjectStore, [], [], ProceduralSlice> = (set, get) => ({
  proceduralAnimations: [],

  addProceduralAnimation: (spriteId, name, config, startFrame, endFrame, nodeId) => {
    get().pushUndo('添加程序动画');
    const pa: ProceduralAnimation = {
      id: crypto.randomUUID(),
      name,
      spriteId,
      // 节点级条目（新管线唯一生效口径：主渲染与 convert 都按 nodeId
      // 匹配）；spriteId 传 '' 表示不挂精灵，引擎侧空串不算匹配。
      ...(nodeId ? { nodeId } : {}),
      config,
      enabled: true,
      startFrame,
      endFrame,
    };
    set((s) => ({ proceduralAnimations: [...s.proceduralAnimations, pa] }));
    return pa;
  },

  removeProceduralAnimation: (id) => {
    get().pushUndo('删除程序动画');
    set((s) => ({
      proceduralAnimations: s.proceduralAnimations.filter((pa) => pa.id !== id),
    }));
  },

  updateProceduralAnimation: (id, updates) => {
    get().pushUndo('更新程序动画', 'updateProceduralAnimation');
    set((s) => ({
      proceduralAnimations: s.proceduralAnimations.map((pa) =>
        pa.id === id ? { ...pa, ...updates } : pa
      ),
    }));
  },

  toggleProceduralAnimation: (id) => {
    get().pushUndo('切换程序动画');
    set((s) => ({
      proceduralAnimations: s.proceduralAnimations.map((pa) =>
        pa.id === id ? { ...pa, enabled: !pa.enabled } : pa
      ),
    }));
  },
});
