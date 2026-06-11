// ============================================================
// PixelMorpher - Skeleton Slice
// Skeleton/bone CRUD, bone poses, constraints, weight maps, IK
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  Skeleton,
  Bone,
  BonePose,
  BoneConstraint,
  ProceduralAnimation,
  ProceduralConfig,
  WeightMap,
} from '../types';

export type SkeletonSlice = {
  addSkeleton: ProjectStore['addSkeleton'];
  removeSkeleton: ProjectStore['removeSkeleton'];
  addBone: ProjectStore['addBone'];
  removeBone: ProjectStore['removeBone'];
  updateBone: ProjectStore['updateBone'];
  bindPartToBone: ProjectStore['bindPartToBone'];
  unbindPartFromBone: ProjectStore['unbindPartFromBone'];
  addBoneConstraint: ProjectStore['addBoneConstraint'];
  removeBoneConstraint: ProjectStore['removeBoneConstraint'];
  addBonePose: ProjectStore['addBonePose'];
  removeBonePose: ProjectStore['removeBonePose'];
  toggleSkeletonVisibility: ProjectStore['toggleSkeletonVisibility'];
  setSelectedBoneId: ProjectStore['setSelectedBoneId'];
  selectedBoneId: string | null;
  addProceduralAnimation: ProjectStore['addProceduralAnimation'];
  removeProceduralAnimation: ProjectStore['removeProceduralAnimation'];
  updateProceduralAnimation: ProjectStore['updateProceduralAnimation'];
  toggleProceduralAnimation: ProjectStore['toggleProceduralAnimation'];
  proceduralAnimations: ProceduralAnimation[];
  weightMaps: WeightMap[];
  setWeightMap: ProjectStore['setWeightMap'];
  getWeightMap: ProjectStore['getWeightMap'];
  skeletons: Skeleton[];
};

export const createSkeletonSlice: StateCreator<ProjectStore, [], [], SkeletonSlice> = (set, get) => ({
  selectedBoneId: null,
  proceduralAnimations: [],
  weightMaps: [],
  skeletons: [],

  addSkeleton: (name) => {
    get().pushUndo('添加骨骼');
    const skeleton: Skeleton = {
      id: crypto.randomUUID(),
      name,
      bones: [],
      poses: [],
      visible: true,
    };
    set((s) => ({ skeletons: [...s.skeletons, skeleton] }));
    return skeleton;
  },

  removeSkeleton: (id) => {
    get().pushUndo('删除骨骼');
    set((s) => ({
    skeletons: s.skeletons.filter((sk) => sk.id !== id),
    }));
  },

  addBone: (skeletonId, name, parentId, headX, headY, tailX, tailY) => {
    get().pushUndo('添加骨头');
    const dx = tailX - headX;
    const dy = tailY - headY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const restRotation = Math.atan2(dy, dx) * 180 / Math.PI;

    const bone: Bone = {
      id: crypto.randomUUID(),
      name,
      parentId,
      headX,
      headY,
      tailX,
      tailY,
      restRotation,
      poseRotation: 0,
      length,
      boundParts: [],
      constraints: [],
      visible: true,
      locked: false,
      color: '#ff6644',
    };

    set((s) => ({
      skeletons: s.skeletons.map((sk) =>
        sk.id === skeletonId ? { ...sk, bones: [...sk.bones, bone] } : sk
      ),
    }));
    return bone;
  },

  removeBone: (skeletonId, boneId) => {
    get().pushUndo('删除骨头');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      const bones = sk.bones
        .filter((b) => b.id !== boneId)
        .map((b) => b.parentId === boneId ? { ...b, parentId: null } : b);
      return { ...sk, bones, poses: sk.poses.filter((p) => p.boneId !== boneId) };
    }),
    }));
  },

  updateBone: (skeletonId, boneId, updates) => {
    get().pushUndo('更新骨头', 'updateBone');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      return {
        ...sk,
        bones: sk.bones.map((b) => b.id === boneId ? { ...b, ...updates } : b),
      };
    }),
    }));
  },

  bindPartToBone: (skeletonId, boneId, partId, weight) => {
    get().pushUndo('绑定部件到骨头', 'bindPartToBone');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      return {
        ...sk,
        bones: sk.bones.map((b) => {
          if (b.id !== boneId) return b;
          const existing = b.boundParts.find((bp) => bp.partId === partId);
          if (existing) {
            return { ...b, boundParts: b.boundParts.map((bp) => bp.partId === partId ? { ...bp, weight } : bp) };
          }
          return { ...b, boundParts: [...b.boundParts, { partId, weight }] };
        }),
      };
    }),
    }));
  },

  unbindPartFromBone: (skeletonId, boneId, partId) => {
    get().pushUndo('解绑部件');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      return {
        ...sk,
        bones: sk.bones.map((b) => {
          if (b.id !== boneId) return b;
          return { ...b, boundParts: b.boundParts.filter((bp) => bp.partId !== partId) };
        }),
      };
    }),
    }));
  },

  addBoneConstraint: (skeletonId, boneId, constraint) => {
    get().pushUndo('添加骨骼约束');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      return {
        ...sk,
        bones: sk.bones.map((b) => {
          if (b.id !== boneId) return b;
          return { ...b, constraints: [...b.constraints, constraint] };
        }),
      };
    }),
    }));
  },

  removeBoneConstraint: (skeletonId, boneId, constraintIndex) => {
    get().pushUndo('删除骨骼约束');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      return {
        ...sk,
        bones: sk.bones.map((b) => {
          if (b.id !== boneId) return b;
          return { ...b, constraints: b.constraints.filter((_, i) => i !== constraintIndex) };
        }),
      };
    }),
    }));
  },

  addBonePose: (skeletonId, boneId, frame, rotation, ikTargetX, ikTargetY) => {
    get().pushUndo('添加骨骼姿态', 'addBonePose');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      const pose: BonePose = { boneId, frame, rotation, ikTargetX, ikTargetY };
      const poses = sk.poses.filter((p) => !(p.boneId === boneId && p.frame === frame));
      poses.push(pose);
      return { ...sk, poses };
    }),
    }));
  },

  removeBonePose: (skeletonId, boneId, frame) => {
    get().pushUndo('删除骨骼姿态');
    set((s) => ({
    skeletons: s.skeletons.map((sk) => {
      if (sk.id !== skeletonId) return sk;
      return { ...sk, poses: sk.poses.filter((p) => !(p.boneId === boneId && p.frame === frame)) };
    }),
    }));
  },

  toggleSkeletonVisibility: (skeletonId) => set((s) => ({
    skeletons: s.skeletons.map((sk) =>
      sk.id === skeletonId ? { ...sk, visible: !sk.visible } : sk
    ),
  })),

  setSelectedBoneId: (boneId) => set({ selectedBoneId: boneId }),

  addProceduralAnimation: (partId, name, config, startFrame, endFrame) => {
    get().pushUndo('添加程序动画');
    const pa: ProceduralAnimation = {
      id: crypto.randomUUID(),
      name,
      partId,
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

  setWeightMap: (partId, weights) => {
    get().pushUndo('设置权重图');
    set((s) => {
      const maps = s.weightMaps.filter((wm) => wm.partId !== partId);
      maps.push({ partId, weights });
      return { weightMaps: maps };
    });
  },

  getWeightMap: (partId) => get().weightMaps.find((wm) => wm.partId === partId),
});
