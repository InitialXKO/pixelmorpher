// ============================================================
// 移植存根（2026-10-25）：3Dto2Dshape 的 facialSurfaces.ts 仅以类型方式
// 引用上游 modelParts.ts 的 ProjectionPartSource；pixelmorpher 的
// Live2D 构建器（build-live2d.ts）自带拆分，不构造该类型的完整对象，
// 这里只保留类型定义本身（源自 ANGJustinl/3Dto2Dshape，MIT）。
// ============================================================

import type * as THREE from 'three';

export type PaintLayerKind = 'shadow' | 'base' | 'highlight';
export type FocusLevel = 'auto' | 'focal' | 'support' | 'abstract';
export type MacroGroup = 'face' | 'hair' | 'torso' | 'lowerMass' | 'accent' | 'other';

export type ProjectionTriangleSource = {
    vertexIndices: [number, number, number];
    vertexPositionKeys: [string, string, string];
};

export type ProjectionPartSource = {
    /** Original draw side and segmented material, used before depth visibility. */
    materialSide?: THREE.Side;
    materialIndex?: number;
    textureOpacity?: number;
    /** Visible-region experiment has already decided which small regions survive. */
    preserveSmallPaintRegions?: boolean;
    /** Original material alpha; undefined means opaque for legacy sources. */
    opacity?: number;
    leafId: string;
    label: string;
    materialNames: string[];
    parentPath: string;
    focusLevel?: Exclude<FocusLevel, 'auto'>;
    macroGroup?: MacroGroup;
    shapeBudget?: number;
    simplifyMultiplier?: number;
    accentScore?: number;
    connectivityRole?: 'normal' | 'bridge' | 'accent';
    sourceLeafId?: string;
    paintLayer?: PaintLayerKind;
    mesh: THREE.Mesh | THREE.SkinnedMesh;
    triangleCount: number;
    color: string;
    triangles: ProjectionTriangleSource[];
};
