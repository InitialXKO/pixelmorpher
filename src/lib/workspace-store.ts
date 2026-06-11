'use client';

import { create } from 'zustand';
import type { WorkspaceMode } from './types';

// ============================================================
// PixelMorpher - Workspace Store
// Manages workspace mode switching and layout configuration
// ============================================================

// Re-export WorkspaceMode from canonical types.ts for backward compatibility
export type { WorkspaceMode };

export interface WorkspaceLayout {
  leftPanelWidth: number;     // pixels
  leftPanelVisible: boolean;
  rightPanelWidth: number;    // pixels
  rightPanelVisible: boolean;
  timelineHeight: number;     // pixels
  timelineCollapsed: boolean;
  rightPanelDefaultTab: string;
}

export interface TilePreviewSettings {
  cols: number;               // tile repeat columns (1-8)
  rows: number;               // tile repeat rows (1-8)
  gap: number;                // pixels between tiles
  gapColor: string;           // gap background color
  seamlessHighlight: boolean; // highlight edge pixels for seamless check
  zoom: number;               // preview zoom level
}

/** Tile workflow step (1=materials, 2=template, 3=tiles) */
export type TileWorkflowStep = 1 | 2 | 3;

export interface TileWorkflowSettings {
  defaultStep: TileWorkflowStep;
  tileSize: number;           // default tile size for new projects
  autoGenerateOnSwitch: boolean; // auto-generate when switching to step 3
}

export interface WorkspaceState {
  mode: WorkspaceMode;
  layouts: Record<WorkspaceMode, WorkspaceLayout>;
  tilePreview: TilePreviewSettings;
  tileWorkflow: TileWorkflowSettings;
  // actions
  setMode: (mode: WorkspaceMode) => void;
  updateLayout: (mode: WorkspaceMode, updates: Partial<WorkspaceLayout>) => void;
  updateTilePreview: (updates: Partial<TilePreviewSettings>) => void;
  updateTileWorkflow: (updates: Partial<TileWorkflowSettings>) => void;
}

const DEFAULT_LAYOUTS: Record<WorkspaceMode, WorkspaceLayout> = {
  project_home: {
    leftPanelWidth: 0,
    leftPanelVisible: false,
    rightPanelWidth: 0,
    rightPanelVisible: false,
    timelineHeight: 0,
    timelineCollapsed: true,
    rightPanelDefaultTab: '',
  },
  animation: {
    leftPanelWidth: 240,
    leftPanelVisible: true,
    rightPanelWidth: 280,
    rightPanelVisible: true,
    timelineHeight: 200,
    timelineCollapsed: false,
    rightPanelDefaultTab: 'modifiers',
  },
  map_tile: {
    leftPanelWidth: 180,
    leftPanelVisible: true,
    rightPanelWidth: 360,
    rightPanelVisible: true,
    timelineHeight: 120,
    timelineCollapsed: true,
    rightPanelDefaultTab: 'tile_workflow',
  },
  puppet: {
    leftPanelWidth: 240,
    leftPanelVisible: true,
    rightPanelWidth: 340,
    rightPanelVisible: true,
    timelineHeight: 220,
    timelineCollapsed: false,
    rightPanelDefaultTab: 'puppet_workflow',
  },
};

const DEFAULT_TILE_PREVIEW: TilePreviewSettings = {
  cols: 3,
  rows: 3,
  gap: 1,
  gapColor: '#1a1a2e',
  seamlessHighlight: false,
  zoom: 2,
};

const DEFAULT_TILE_WORKFLOW: TileWorkflowSettings = {
  defaultStep: 1,
  tileSize: 16,
  autoGenerateOnSwitch: true,
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  mode: 'animation',
  layouts: { ...DEFAULT_LAYOUTS },
  tilePreview: { ...DEFAULT_TILE_PREVIEW },
  tileWorkflow: { ...DEFAULT_TILE_WORKFLOW },

  setMode: (mode) => set({ mode }),

  updateLayout: (mode, updates) =>
    set((state) => ({
      layouts: {
        ...state.layouts,
        [mode]: { ...state.layouts[mode], ...updates },
      },
    })),

  updateTilePreview: (updates) =>
    set((state) => ({
      tilePreview: { ...state.tilePreview, ...updates },
    })),

  updateTileWorkflow: (updates) =>
    set((state) => ({
      tileWorkflow: { ...state.tileWorkflow, ...updates },
    })),
}));
