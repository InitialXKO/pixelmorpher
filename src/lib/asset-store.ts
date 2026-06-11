// ============================================================
// PixelMorpher - Asset Store
// Three-layer asset management: Library → Project → Workflow
//
// Layer 1 (Asset Library): Global reusable assets persisted in IndexedDB
// Layer 2 (Project Assets): Project metadata list + current project state
// Layer 3 (Workflow Assets): Current editing workflow summary
// ============================================================

import { create } from 'zustand';
import type {
  LibraryAsset,
  LibraryAssetType,
  ProjectMeta,
  AssetFilter,
  AssetViewMode,
  WorkflowSummary,
  WorkflowType,
  SpriteAssetData,
  TilesetAssetData,
} from './asset-types';
import type { PixelGrid, PixelAnimModifier } from './types';
import {
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  STORES,
} from './db';

// ============================================================
// Store Types
// ============================================================

export interface AssetStore {
  // ---- Layer 1: Asset Library ----
  libraryAssets: LibraryAsset[];
  libraryLoaded: boolean;

  // ---- Layer 2: Project Assets ----
  projectList: ProjectMeta[];
  projectListLoaded: boolean;
  currentProjectId: string | null;

  // ---- Layer 3: Workflow Assets ----
  workflowSummary: WorkflowSummary;

  // ---- UI State ----
  viewMode: AssetViewMode;
  filter: AssetFilter;
  selectedAssetId: string | null;
  showProjectHome: boolean;

  // ---- Layer 1 Actions ----
  loadLibrary: () => Promise<void>;
  addAssetToLibrary: (asset: Omit<LibraryAsset, 'id' | 'createdAt' | 'updatedAt'>) => Promise<LibraryAsset>;
  updateAssetInLibrary: (id: string, updates: Partial<Pick<LibraryAsset, 'name' | 'tags' | 'thumbnail' | 'data'>>) => Promise<void>;
  removeAssetFromLibrary: (id: string) => Promise<void>;
  /** Save a sprite (pixel grid) to the library */
  saveSpriteToLibrary: (name: string, pixels: PixelGrid, width: number, height: number, thumbnail: string, tags?: string[]) => Promise<LibraryAsset>;
  /** Save a tile set to the library */
  saveTilesetToLibrary: (name: string, tileWidth: number, tileHeight: number, tiles: { pixels: PixelGrid; animModifiers: PixelAnimModifier[]; tags: string[] }[], thumbnail: string, tags?: string[]) => Promise<LibraryAsset>;
  /** Import a library asset into the current project as a Part */
  importAssetToProject: (assetId: string) => Promise<void>;
  getFilteredAssets: () => LibraryAsset[];

  // ---- Layer 2 Actions ----
  loadProjectList: () => Promise<void>;
  createProject: (name: string, canvasWidth?: number, canvasHeight?: number) => Promise<ProjectMeta>;
  openProject: (id: string) => Promise<void>;
  saveCurrentProject: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string, newName: string) => Promise<ProjectMeta | null>;
  renameProject: (id: string, newName: string) => Promise<void>;
  exportProjectAsFile: (id: string) => Promise<void>;
  importProjectFromFile: (file: File) => Promise<void>;
  updateCurrentProjectMeta: () => Promise<void>;

  // ---- Layer 3 Actions ----
  updateWorkflowSummary: (summary: Partial<WorkflowSummary>) => void;
  refreshWorkflowSummary: () => void;

  // ---- UI Actions ----
  setViewMode: (mode: AssetViewMode) => void;
  setFilter: (filter: Partial<AssetFilter>) => void;
  setSelectedAssetId: (id: string | null) => void;
  setShowProjectHome: (show: boolean) => void;
}

// ============================================================
// Store Implementation
// ============================================================

export const useAssetStore = create<AssetStore>((set, get) => ({
  // ---- Initial State ----
  libraryAssets: [],
  libraryLoaded: false,

  projectList: [],
  projectListLoaded: false,
  currentProjectId: null,

  workflowSummary: { type: 'none' },

  viewMode: 'library',
  filter: {},
  selectedAssetId: null,
  showProjectHome: true, // Start on project home screen

  // ============================================================
  // Layer 1: Asset Library Actions
  // ============================================================

  loadLibrary: async () => {
    try {
      const assets = await dbGetAll<LibraryAsset>('assetLibrary');
      set({ libraryAssets: assets || [], libraryLoaded: true });
    } catch {
      // IndexedDB might not be available (SSR) — fail silently
      set({ libraryLoaded: true });
    }
  },

  addAssetToLibrary: async (assetInput) => {
    const now = Date.now();
    const asset: LibraryAsset = {
      ...assetInput,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    await dbPut('assetLibrary', asset);
    set((s) => ({ libraryAssets: [...s.libraryAssets, asset] }));
    return asset;
  },

  updateAssetInLibrary: async (id, updates) => {
    const asset = get().libraryAssets.find((a) => a.id === id);
    if (!asset) return;

    const updated: LibraryAsset = {
      ...asset,
      ...updates,
      updatedAt: Date.now(),
    };

    await dbPut('assetLibrary', updated);
    set((s) => ({
      libraryAssets: s.libraryAssets.map((a) => (a.id === id ? updated : a)),
    }));
  },

  removeAssetFromLibrary: async (id) => {
    await dbDelete('assetLibrary', id);
    set((s) => ({
      libraryAssets: s.libraryAssets.filter((a) => a.id !== id),
      selectedAssetId: s.selectedAssetId === id ? null : s.selectedAssetId,
    }));
  },

  saveSpriteToLibrary: async (name, pixels, width, height, thumbnail, tags = []) => {
    return get().addAssetToLibrary({
      name,
      type: 'sprite',
      tags,
      thumbnail,
      data: { pixels, width, height } as SpriteAssetData,
    });
  },

  saveTilesetToLibrary: async (name, tileWidth, tileHeight, tiles, thumbnail, tags = []) => {
    return get().addAssetToLibrary({
      name,
      type: 'tileset',
      tags,
      thumbnail,
      data: { tileWidth, tileHeight, tiles } as TilesetAssetData,
    });
  },

  importAssetToProject: async (assetId) => {
    const asset = get().libraryAssets.find((a) => a.id === assetId);
    if (!asset) return;

    // Lazy import to avoid circular dependency
    const { useProjectStore } = await import('./store');
    const projectStore = useProjectStore.getState();

    switch (asset.type) {
      case 'sprite': {
        const spriteData = asset.data as SpriteAssetData;
        projectStore.pushUndo('从资产库导入精灵');
        const part = projectStore.addPart(
          asset.name,
          spriteData.width,
          spriteData.height,
        );
        projectStore.setPartPixels(part.id, spriteData.pixels.map((row) => [...row]));
        if (spriteData.pivotX != null && spriteData.pivotY != null) {
          projectStore.updatePart(part.id, { pivotX: spriteData.pivotX, pivotY: spriteData.pivotY });
        }
        break;
      }
      case 'tileset': {
        const tilesetData = asset.data as TilesetAssetData;
        // Import tiles as individual parts
        projectStore.pushUndo('从资产库导入瓦片集');
        for (let i = 0; i < tilesetData.tiles.length; i++) {
          const tile = tilesetData.tiles[i];
          const part = projectStore.addPart(
            `${asset.name}_${i}`,
            tilesetData.tileWidth,
            tilesetData.tileHeight,
          );
          projectStore.setPartPixels(part.id, tile.pixels.map((r) => [...r]));
        }
        break;
      }
      case 'modifier_preset': {
        // Apply modifiers to the currently selected part's current keyframe
        // This is more contextual — handled by the UI directly
        break;
      }
      case 'skeleton_template': {
        // Skeleton templates are handled by the skeleton panel
        break;
      }
    }
  },

  getFilteredAssets: () => {
    const { libraryAssets, filter } = get();
    let result = libraryAssets;

    if (filter.type) {
      result = result.filter((a) => a.type === filter.type);
    }
    if (filter.tags && filter.tags.length > 0) {
      result = result.filter((a) => filter.tags!.some((t) => a.tags.includes(t)));
    }
    if (filter.searchText) {
      const search = filter.searchText.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(search) ||
          a.tags.some((t) => t.toLowerCase().includes(search)),
      );
    }

    return result;
  },

  // ============================================================
  // Layer 2: Project Assets Actions
  // ============================================================

  loadProjectList: async () => {
    try {
      const projects = await dbGetAll<ProjectMeta>('projectMeta');
      // Sort by most recently updated
      const sorted = (projects || []).sort((a, b) => b.updatedAt - a.updatedAt);
      set({ projectList: sorted, projectListLoaded: true });
    } catch {
      set({ projectListLoaded: true });
    }
  },

  createProject: async (name, canvasWidth = 256, canvasHeight = 256) => {
    const now = Date.now();
    const id = crypto.randomUUID();
    const meta: ProjectMeta = {
      id,
      name,
      description: '',
      thumbnail: '',
      createdAt: now,
      updatedAt: now,
      canvasWidth,
      canvasHeight,
      frameCount: 16,
      frameRate: 8,
      partCount: 0,
    };

    await dbPut('projectMeta', meta);

    // Also initialize and save a default project to the 'projects' store
    // so openProject can find it later
    try {
      const { useProjectStore } = await import('./store');
      const projectStore = useProjectStore.getState();
      projectStore.resetProject();
      projectStore.setProjectName(name);
      projectStore.setCanvasSize(canvasWidth, canvasHeight);
      projectStore.setFrameRate(8);
      projectStore.setTotalFrames(16);
      const projectFile = projectStore.exportProjectFile();
      await dbPut('projects', { id, ...projectFile });
    } catch {
      // If project store init fails, the project will be created on first save
    }

    set((s) => ({ projectList: [meta, ...s.projectList] }));
    return meta;
  },

  openProject: async (id) => {
    try {
      const projectData = await dbGet<Record<string, unknown>>('projects', id);
      if (!projectData) {
        // Project data not found — initialize a default project for this meta
        const meta = get().projectList.find((p) => p.id === id);
        if (meta) {
          const { useProjectStore } = await import('./store');
          const projectStore = useProjectStore.getState();
          projectStore.resetProject();
          projectStore.setProjectName(meta.name);
          projectStore.setCanvasSize(meta.canvasWidth, meta.canvasHeight);
          const projectFile = projectStore.exportProjectFile();
          await dbPut('projects', { id, ...projectFile });
        } else {
          return;
        }
      } else {
        // Lazy import
        const { useProjectStore } = await import('./store');
        const projectStore = useProjectStore.getState();
        projectStore.importProjectFile(projectData as any);
      }

      // Switch workspace mode to animation editor
      try {
        const { useWorkspaceStore } = await import('./workspace-store');
        useWorkspaceStore.getState().setMode('animation');
      } catch {}

      set({ currentProjectId: id, showProjectHome: false });
    } catch {
      // Project not found or corrupt
    }
  },

  saveCurrentProject: async () => {
    const { currentProjectId } = get();
    if (!currentProjectId) return;

    try {
      // Lazy import
      const { useProjectStore } = await import('./store');
      const projectStore = useProjectStore.getState();
      const projectFile = projectStore.exportProjectFile();

      // Save project data
      await dbPut('projects', { id: currentProjectId, ...projectFile });

      // Update metadata
      await get().updateCurrentProjectMeta();
    } catch {
      // Silent fail
    }
  },

  deleteProject: async (id) => {
    await dbDelete('projectMeta', id);
    await dbDelete('projects', id);
    set((s) => ({
      projectList: s.projectList.filter((p) => p.id !== id),
      currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
    }));
  },

  duplicateProject: async (id, newName) => {
    const original = get().projectList.find((p) => p.id === id);
    if (!original) return null;

    const now = Date.now();
    const duplicate: ProjectMeta = {
      ...original,
      id: crypto.randomUUID(),
      name: newName,
      createdAt: now,
      updatedAt: now,
    };

    await dbPut('projectMeta', duplicate);

    // Also copy project data
    const projectData = await dbGet<Record<string, unknown>>('projects', id);
    if (projectData) {
      await dbPut('projects', { id: duplicate.id, ...projectData });
    }

    set((s) => ({ projectList: [duplicate, ...s.projectList] }));
    return duplicate;
  },

  renameProject: async (id, newName) => {
    const project = get().projectList.find((p) => p.id === id);
    if (!project) return;

    const updated = { ...project, name: newName, updatedAt: Date.now() };
    await dbPut('projectMeta', updated);
    set((s) => ({
      projectList: s.projectList.map((p) => (p.id === id ? updated : p)),
    }));
  },

  exportProjectAsFile: async (id) => {
    const projectData = await dbGet<Record<string, unknown>>('projects', id);
    if (!projectData) return;

    const meta = get().projectList.find((p) => p.id === id);
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta?.name ?? 'project'}.pxm`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importProjectFromFile: async (file) => {
    try {
      const text = await file.text();
      const projectData = JSON.parse(text);

      // Lazy import
      const { useProjectStore } = await import('./store');
      const projectStore = useProjectStore.getState();

      // Generate new ID to avoid collisions
      const newId = crypto.randomUUID();
      projectData.id = newId;

      // Load into editor
      projectStore.importProjectFile(projectData);

      // Save to IndexedDB
      await dbPut('projects', { id: newId, ...projectData });

      // Create metadata
      const state = projectStore;
      const meta: ProjectMeta = {
        id: newId,
        name: file.name.replace(/\.pxm$/, ''),
        description: '',
        thumbnail: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        frameCount: state.totalFrames,
        frameRate: state.frameRate,
        partCount: state.parts.length,
      };

      await dbPut('projectMeta', meta);

      // Switch workspace mode to animation editor
      try {
        const { useWorkspaceStore } = await import('./workspace-store');
        useWorkspaceStore.getState().setMode('animation');
      } catch {}

      set((s) => ({
        projectList: [meta, ...s.projectList],
        currentProjectId: newId,
        showProjectHome: false,
      }));
    } catch {
      // Invalid file
    }
  },

  updateCurrentProjectMeta: async () => {
    const { currentProjectId } = get();
    if (!currentProjectId) return;

    try {
      const { useProjectStore } = await import('./store');
      const projectStore = useProjectStore.getState();

      const updated: ProjectMeta = {
        id: currentProjectId,
        name: (projectStore as any).name || '未命名项目',
        description: '',
        thumbnail: '',
        updatedAt: Date.now(),
        canvasWidth: projectStore.canvasWidth,
        canvasHeight: projectStore.canvasHeight,
        frameCount: projectStore.totalFrames,
        frameRate: projectStore.frameRate,
        partCount: projectStore.parts.length,
      } as ProjectMeta;

      await dbPut('projectMeta', updated);
      set((s) => ({
        projectList: s.projectList.map((p) => (p.id === currentProjectId ? updated : p)),
      }));
    } catch {
      // Silent fail
    }
  },

  // ============================================================
  // Layer 3: Workflow Assets Actions
  // ============================================================

  updateWorkflowSummary: (summary) => {
    set((s) => ({
      workflowSummary: { ...s.workflowSummary, ...summary },
    }));
  },

  refreshWorkflowSummary: () => {
    const { useWorkspaceStore } = require('./workspace-store') as { useWorkspaceStore: any };
    const { useProjectStore } = require('./store') as { useProjectStore: any };
    const { useTileWorkflowStore } = require('./tile-workflow-store') as { useTileWorkflowStore: any };
    const { useMapStore } = require('./map-store') as { useMapStore: any };

    const workspaceMode = useWorkspaceStore.getState().mode;
    const projectStore = useProjectStore.getState();
    const tileStore = useTileWorkflowStore.getState();

    let type: WorkflowType = 'none';
    const summary: Partial<WorkflowSummary> = {};

    if (workspaceMode === 'map_tile') {
      const mapStore = useMapStore.getState();
      if (tileStore.tiles.length > 0) {
        type = 'tile_creation';
        summary.tileStep = tileStore.currentStep;
        summary.tileMaterialAReady = !!tileStore.materialA.pixels;
        summary.tileMaterialBReady = !!tileStore.materialB.pixels;
        summary.tileGeneratedCount = tileStore.tiles.length;
      } else if (mapStore.currentMap) {
        type = 'map_editing';
        summary.mapName = mapStore.currentMap.name;
        summary.mapLayerCount = mapStore.currentMap.layers.length;
        summary.mapDynamicObjectCount = mapStore.currentMap.dynamicObjects.length;
      }
    } else {
      type = 'animation_editing';
      summary.animPartCount = projectStore.parts.length;
      summary.animKeyframeCount = projectStore.keyframes.length;
      summary.animSkeletonCount = projectStore.skeletons.length;
    }

    summary.type = type;
    set({ workflowSummary: summary as WorkflowSummary });
  },

  // ============================================================
  // UI Actions
  // ============================================================

  setViewMode: (mode) => set({ viewMode: mode }),
  setFilter: (filter) => set((s) => ({ filter: { ...s.filter, ...filter } })),
  setSelectedAssetId: (id) => set({ selectedAssetId: id }),
  setShowProjectHome: (show) => set({ showProjectHome: show }),
}));
