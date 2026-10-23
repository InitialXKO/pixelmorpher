// ============================================================
// PixelMorpher - Asset Management Types
//
// Layer 2: Project Assets (项目资产) — per-project, persisted with project
// Layer 3: Workflow Assets (当前工作流资产) — ephemeral, session-scoped
// （Layer 1 跨项目资产库已退役，相关类型一并删除。）
// ============================================================

// ============================================================
// Layer 2: Project Assets
// ============================================================

/** Metadata for a project — used in project list without loading full data */
export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  /** Base64 thumbnail of the first frame */
  thumbnail: string;
  createdAt: number;
  updatedAt: number;
  canvasWidth: number;
  canvasHeight: number;
  frameCount: number;
  frameRate: number;
  spriteCount: number;
}

// ============================================================
// Layer 3: Workflow Assets
// ============================================================

/** Current workflow context — what the user is actively working on */
export type WorkflowType = 'tile_creation' | 'map_editing' | 'animation_editing' | 'none';

/** Summary of current workflow assets for the workflow panel */
export interface WorkflowSummary {
  type: WorkflowType;
  /** Tile workflow: step number, material status, tile count */
  tileStep?: number;
  tileMaterialAReady?: boolean;
  tileMaterialBReady?: boolean;
  tileGeneratedCount?: number;
  /** Map editing: map name, layer count, dynamic object count */
  mapName?: string;
  mapLayerCount?: number;
  mapDynamicObjectCount?: number;
  /** Animation editing: part count, keyframe count, skeleton count */
  animPartCount?: number;
  animKeyframeCount?: number;
  animSkeletonCount?: number;
}
