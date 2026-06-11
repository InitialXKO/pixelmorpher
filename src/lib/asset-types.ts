// ============================================================
// PixelMorpher - Three-Layer Asset Management Types
//
// Layer 1: Asset Library (资产库) — global, persistent, cross-project
// Layer 2: Project Assets (项目资产) — per-project, persisted with project
// Layer 3: Workflow Assets (当前工作流资产) — ephemeral, session-scoped
// ============================================================

import type { PixelGrid, PixelAnimModifier, ModifierInstance, PartAnimationModifier } from './types';

// ============================================================
// Layer 1: Asset Library
// ============================================================

export type LibraryAssetType = 'sprite' | 'tileset' | 'skeleton_template' | 'modifier_preset';

/** A reusable asset in the global library */
export interface LibraryAsset {
  id: string;
  name: string;
  type: LibraryAssetType;
  /** User-defined tags for search/filter */
  tags: string[];
  /** Base64-encoded thumbnail for quick preview */
  thumbnail: string;
  /** ISO timestamp */
  createdAt: number;
  /** ISO timestamp */
  updatedAt: number;
  /** Type-specific payload */
  data: SpriteAssetData | TilesetAssetData | SkeletonTemplateData | ModifierPresetData;
}

export interface SpriteAssetData {
  pixels: PixelGrid;
  width: number;
  height: number;
  /** Optional pivot point */
  pivotX?: number;
  pivotY?: number;
}

export interface TilesetAssetData {
  tileWidth: number;
  tileHeight: number;
  tiles: TilesetTileData[];
}

export interface TilesetTileData {
  pixels: PixelGrid;
  animModifiers: PixelAnimModifier[];
  /** Property tags for game logic (e.g. 'solid', 'water') */
  tags: string[];
}

export interface SkeletonTemplateData {
  /** Serialized skeleton structure (bones, poses, constraints) */
  json: string;
  /** Number of bones for quick preview */
  boneCount: number;
}

export interface ModifierPresetData {
  /** Keyframe-level modifiers */
  modifiers: ModifierInstance[];
  /** Part-level animation modifiers */
  animationModifiers?: PartAnimationModifier[];
  /** Description of what this preset does */
  description: string;
}

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
  partCount: number;
}

/** Reference from a project asset back to its library source */
export interface AssetSourceRef {
  /** ID of the source library asset, if this was derived from one */
  libraryAssetId?: string;
  /** Whether the project asset has been modified from the library source */
  isModified: boolean;
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

// ============================================================
// Asset Search & Filter
// ============================================================

export interface AssetFilter {
  type?: LibraryAssetType;
  tags?: string[];
  searchText?: string;
}

// ============================================================
// UI State for Asset Panels
// ============================================================

export type AssetViewMode = 'library' | 'project_assets' | 'workflow';

export interface AssetPanelState {
  viewMode: AssetViewMode;
  filter: AssetFilter;
  selectedAssetId: string | null;
  /** Whether the project home screen is shown (replaces editor) */
  showProjectHome: boolean;
}
