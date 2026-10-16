'use client';

import { create } from 'zustand';

// ============================================================
// PixelMorpher - Workspace Store
// workspace mode 已退役：puppet 是唯一工作流
// 仅保留编辑器布局配置
// ============================================================

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
  // workspace mode 已退役：puppet 是唯一工作流
  // 布局为单一对象（不再按 mode 区分）
  layouts: Record<'puppet', WorkspaceLayout>;
  // actions
  updateLayout: (updates: Partial<WorkspaceLayout>) => void;
}

const DEFAULT_LAYOUTS: Record<'puppet', WorkspaceLayout> = {
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

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  layouts: { ...DEFAULT_LAYOUTS },

  updateLayout: (updates) =>
    set((state) => ({
      layouts: {
        ...state.layouts,
        puppet: { ...state.layouts.puppet, ...updates },
      },
    })),
}));
