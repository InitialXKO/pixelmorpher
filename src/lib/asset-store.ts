// ============================================================
// PixelMorpher - Asset Store
// Two-layer asset management: Project → Workflow
//
// Layer 2 (Project Assets): Project metadata list + current project state
// Layer 3 (Workflow Assets): Current editing workflow summary
// （Layer 1 跨项目资产库已退役：存的单位是单个精灵/tileset，与现行
//  以角色为单位的工作流错位，面板与库动作一并删除。）
// ============================================================

import { create } from 'zustand';
import type {
  ProjectMeta,
  WorkflowSummary,
  WorkflowType,
} from './asset-types';
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
  // ---- Layer 2: Project Assets ----
  projectList: ProjectMeta[];
  projectListLoaded: boolean;
  currentProjectId: string | null;

  // ---- Layer 3: Workflow Assets ----
  workflowSummary: WorkflowSummary;

  // ---- UI State ----
  showProjectHome: boolean;

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
  setShowProjectHome: (show: boolean) => void;
}

// ============================================================
// Store Implementation
// ============================================================

export const useAssetStore = create<AssetStore>((set, get) => ({
  // ---- Initial State ----

  projectList: [],
  projectListLoaded: false,
  currentProjectId: null,

  workflowSummary: { type: 'none' },

  showProjectHome: true, // Start on project home screen

  // ============================================================
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
      spriteCount: 0,
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
      // workspace mode 已退役：puppet 是唯一工作流，无需 setMode

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
        spriteCount: Object.keys(state.sprites).length,
      };

      await dbPut('projectMeta', meta);

      // workspace mode 已退役：puppet 是唯一工作流，无需 setMode

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
        spriteCount: Object.keys(projectStore.sprites).length,
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

    const workspaceMode = useWorkspaceStore.getState().mode;
    const projectStore = useProjectStore.getState();

    let type: WorkflowType = 'none';
    const summary: Partial<WorkflowSummary> = {};

    {
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

  setShowProjectHome: (show) => set({ showProjectHome: show }),
}));
