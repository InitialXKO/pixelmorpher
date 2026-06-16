// ============================================================
// PixelMorpher - Store Index
// Composes all Zustand slices into a unified ProjectStore and
// re-exports both useProjectStore and useEditorStore.
// ============================================================

import { create } from 'zustand';
import type { ProjectStore } from './types';
import { createPartSlice } from './part-slice';
import { createKeyframeSlice } from './keyframe-slice';
import { createModifierSlice } from './modifier-slice';
import { createAnimationSlice } from './animation-slice';
import { createEffectSlice } from './effect-slice';
import { createTrajectorySlice } from './trajectory-slice';
import { createSkeletonSlice } from './skeleton-slice';
import { createProjectSlice } from './project-slice';
import { createCorrectionSlice } from './correction-slice';
import { createGlobalModifierSlice } from './global-modifier-slice';
import { createPartGlobalModifierSlice } from './part-global-modifier-slice';
import { createPuppetSlice } from './puppet-slice';
import { createDccPipelineSlice } from './dcc-pipeline-slice';
import { createUnifiedSlice } from './unified-slice';
import { createV15Slice } from './v15-slice';

// NOTE: useEditorStore is NOT re-exported here to avoid a circular dependency.
// editor-store.ts uses require('./index').useProjectStore as a lazy import,
// which creates a cycle if this file also re-exports from editor-store.
// Import useEditorStore directly from './editor-store' instead.
export type { ProjectStore } from './types';

export const useProjectStore = create<ProjectStore>()(
  (...a) => ({
    ...createProjectSlice(...a),
    ...createPartSlice(...a),
    ...createKeyframeSlice(...a),
    ...createModifierSlice(...a),
    ...createAnimationSlice(...a),
    ...createEffectSlice(...a),
    ...createTrajectorySlice(...a),
    ...createSkeletonSlice(...a),
    ...createCorrectionSlice(...a),
    ...createGlobalModifierSlice(...a),
    ...createPartGlobalModifierSlice(...a),
    ...createPuppetSlice(...a),
    ...createDccPipelineSlice(...a),
    ...createUnifiedSlice(...a),
    ...createV15Slice(...a),
  }) as ProjectStore
);
