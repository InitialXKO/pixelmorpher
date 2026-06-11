// ============================================================
// PixelMorpher - Trajectory Slice
// Trajectory actions (add/update points, clear, toggle, auto-record,
// generate tween, afterimage sequence)
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import {
  TrajectoryCurvePoint,
  AfterimageConfig,
} from '../types';

export type TrajectorySlice = {
  addTrajectoryPoint: ProjectStore['addTrajectoryPoint'];
  updateTrajectoryPoint: ProjectStore['updateTrajectoryPoint'];
  clearTrajectory: ProjectStore['clearTrajectory'];
  toggleTrajectoryVisibility: ProjectStore['toggleTrajectoryVisibility'];
  autoRecordTrajectory: ProjectStore['autoRecordTrajectory'];
  generateTweenFromTrajectory: ProjectStore['generateTweenFromTrajectory'];
  generateAfterimageSequence: ProjectStore['generateAfterimageSequence'];
};

export const createTrajectorySlice: StateCreator<ProjectStore, [], [], TrajectorySlice> = (set, get) => ({
  addTrajectoryPoint: (partId, frame, x, y, rotation) => {
    get().pushUndo('添加轨迹点');
    set((s) => {
      const trajectories = [...s.trajectories];
      let traj = trajectories.find((t) => t.partId === partId);
      if (!traj) {
        traj = { partId, points: [] as TrajectoryCurvePoint[], visible: true };
        trajectories.push(traj);
      }
      const existing = traj.points.findIndex((p) => p.frame === frame);
      const newPoint: TrajectoryCurvePoint = { frame, x, y, rotation, cp1x: 0, cp1y: 0, cp2x: 0, cp2y: 0 };
      if (existing >= 0) {
        const existingCp = traj.points[existing];
        newPoint.cp1x = existingCp.cp1x;
        newPoint.cp1y = existingCp.cp1y;
        newPoint.cp2x = existingCp.cp2x;
        newPoint.cp2y = existingCp.cp2y;
        traj.points[existing] = newPoint;
      } else {
        traj.points.push(newPoint);
        traj.points.sort((a, b) => a.frame - b.frame);
      }
      return { trajectories };
    });
  },

  clearTrajectory: (partId) => {
    get().pushUndo('清除轨迹');
    set((s) => ({
    trajectories: s.trajectories.map((t) => (t.partId === partId ? { ...t, points: [] } : t)),
    }));
  },

  toggleTrajectoryVisibility: (partId) => set((s) => ({
    trajectories: s.trajectories.map((t) => (t.partId === partId ? { ...t, visible: !t.visible } : t)),
  })),

  updateTrajectoryPoint: (partId, frame, updates) => {
    get().pushUndo('更新轨迹点', 'updateTrajectoryPoint');
    set((s) => {
      const trajectories = s.trajectories.map((t) => {
        if (t.partId !== partId) return t;
        const points = t.points.map((p) =>
          p.frame === frame ? { ...p, ...updates } : p
        );
        return { ...t, points };
      });
      return { trajectories };
    });
  },

  autoRecordTrajectory: (partId) => {
    get().pushUndo('自动记录轨迹');
    const state = get();
    const kfs = state.keyframes
      .filter((k) => k.partId === partId)
      .sort((a, b) => a.frame - b.frame);

    const points: TrajectoryCurvePoint[] = [];

    for (const kf of kfs) {
      let x = 0;
      let y = 0;
      let rotation = 0;

      for (const mod of kf.modifiers) {
        if (!mod.enabled) continue;
        if (mod.type === 'translate') {
          x += Number(mod.params.offsetX) || 0;
          y += Number(mod.params.offsetY) || 0;
        }
        if (mod.type === 'rotate') {
          rotation += Number(mod.params.angle) || 0;
        }
      }

      points.push({ frame: kf.frame, x, y, rotation, cp1x: 0, cp1y: 0, cp2x: 0, cp2y: 0 });
    }

    set((s) => {
      const trajectories = [...s.trajectories];
      const idx = trajectories.findIndex((t) => t.partId === partId);
      if (idx >= 0) {
        trajectories[idx] = { ...trajectories[idx], points };
      } else {
        trajectories.push({ partId, points, visible: true });
      }
      return { trajectories };
    });
  },

  generateTweenFromTrajectory: (partId, startFrame, endFrame, step) => {
    get().pushUndo('从轨迹生成补间');
    const state = get();
    const traj = state.trajectories.find((t) => t.partId === partId);
    if (!traj || traj.points.length < 2) return;

    const points = traj.points;

    for (let frame = startFrame; frame <= endFrame; frame += step) {
      let prevPt = points[0];
      let nextPt = points[points.length - 1];
      let t = 0;

      for (let i = 0; i < points.length - 1; i++) {
        if (frame >= points[i].frame && frame <= points[i + 1].frame) {
          prevPt = points[i];
          nextPt = points[i + 1];
          const frameRange = nextPt.frame - prevPt.frame;
          t = frameRange > 0 ? (frame - prevPt.frame) / frameRange : 0;
          break;
        }
      }

      const x = prevPt.x + (nextPt.x - prevPt.x) * t;
      const y = prevPt.y + (nextPt.y - prevPt.y) * t;
      const rotation = prevPt.rotation + (nextPt.rotation - prevPt.rotation) * t;

      let kf = state.keyframes.find((k) => k.partId === partId && k.frame === frame);
      if (!kf) {
        kf = get().addKeyframe(partId, frame);
      }

      const translateMod = kf.modifiers.find((m) => m.type === 'translate');
      if (translateMod) {
        get().updateModifier(kf.id, translateMod.id, { offsetX: Math.round(x), offsetY: Math.round(y) });
      } else {
        get().addModifier(kf.id, 'translate');
        const updatedKf = get().keyframes.find((k) => k.id === kf!.id);
        if (updatedKf) {
          const newMod = updatedKf.modifiers.find((m) => m.type === 'translate');
          if (newMod) {
            get().updateModifier(updatedKf.id, newMod.id, { offsetX: Math.round(x), offsetY: Math.round(y) });
          }
        }
      }

      const rotateMod = kf.modifiers.find((m) => m.type === 'rotate');
      if (Math.abs(rotation) > 0.01) {
        if (rotateMod) {
          get().updateModifier(kf.id, rotateMod.id, { angle: Math.round(rotation) });
        } else {
          get().addModifier(kf.id, 'rotate');
          const updatedKf = get().keyframes.find((k) => k.id === kf!.id);
          if (updatedKf) {
            const newMod = updatedKf.modifiers.find((m) => m.type === 'rotate');
            if (newMod) {
              get().updateModifier(updatedKf.id, newMod.id, { angle: Math.round(rotation) });
            }
          }
        }
      }
    }

    get().autoRecordTrajectory(partId);
  },

  generateAfterimageSequence: (partId, config) => {
    get().pushUndo('生成残影序列');
    const state = get();
    const traj = state.trajectories.find((t) => t.partId === partId);
    if (!traj || traj.points.length < 2) return;

    const { count, opacityDecay, spacing } = config;
    const points = traj.points;

    for (const pt of points) {
      const kf = state.keyframes.find((k) => k.partId === partId && k.frame === pt.frame);
      if (!kf) continue;

      const existingAfterimage = kf.modifiers.find((m) => m.type === 'afterimage');
      if (existingAfterimage) {
        get().updateModifier(kf.id, existingAfterimage.id, {
          count,
          opacity: opacityDecay,
          spacing,
        });
      } else {
        get().addModifier(kf.id, 'afterimage');
        const updatedKf = get().keyframes.find((k) => k.id === kf.id);
        if (updatedKf) {
          const newMod = updatedKf.modifiers.find((m) => m.type === 'afterimage');
          if (newMod) {
            get().updateModifier(updatedKf.id, newMod.id, {
              count,
              opacity: opacityDecay,
              spacing,
            });
          }
        }
      }
    }
  },
});
