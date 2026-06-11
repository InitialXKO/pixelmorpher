'use client';

import React from 'react';
import { Film, Grid3x3, Home, Users } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { useEditorStore } from '@/lib/store';
import type { WorkspaceMode } from '@/lib/workspace-store';

// ============================================================
// WorkspaceSwitcher - Toggle between project_home, animation,
// and map_tile modes
// When switching modes, properly clean up mode-specific state:
//   - Switching to map_tile: exit part_edit mode
//   - Switching to animation: clear tile editing target
//   - Switching to project_home: save current project
// ============================================================

const MODE_CONFIG: { value: WorkspaceMode; icon: React.ReactNode; label: string; activeColor: string; activeBg: string }[] = [
  {
    value: 'project_home',
    icon: <Home className="size-3.5" />,
    label: '项目管理',
    activeColor: 'text-amber-300',
    activeBg: 'bg-amber-600/30',
  },
  {
    value: 'animation',
    icon: <Film className="size-3.5" />,
    label: '动画模式',
    activeColor: 'text-purple-300',
    activeBg: 'bg-purple-600/30',
  },
  {
    value: 'puppet',
    icon: <Users className="size-3.5" />,
    label: '木偶模式',
    activeColor: 'text-cyan-300',
    activeBg: 'bg-cyan-600/30',
  },
  {
    value: 'map_tile',
    icon: <Grid3x3 className="size-3.5" />,
    label: '地图瓦片模式',
    activeColor: 'text-emerald-300',
    activeBg: 'bg-emerald-600/30',
  },
];

export default function WorkspaceSwitcher() {
  const { mode, setMode } = useWorkspaceStore();

  const handleModeSwitch = (newMode: WorkspaceMode) => {
    if (newMode === mode) return;

    // Clean up mode-specific state when switching
    if (newMode === 'map_tile') {
      // Exit part_edit mode when entering tile mode
      const editorState = useEditorStore.getState();
      if (editorState.editMode === 'part_edit') {
        editorState.exitPartEditMode(true); // cancel, don't save
      }
    }

    if (newMode === 'puppet') {
      // Exit part_edit mode when entering puppet mode
      const editorState = useEditorStore.getState();
      if (editorState.editMode === 'part_edit') {
        editorState.exitPartEditMode(true);
      }
      // Enable puppet skeleton overlay when entering puppet mode
      if (!editorState.showPuppetSkeleton) {
        editorState.togglePuppetSkeleton();
      }
      // Auto-activate puppet tool as the default canvas tool
      if (editorState.tool !== 'puppet') {
        editorState.setTool('puppet');
      }
    }

    // When leaving puppet mode, disable skeleton overlay
    if (mode === 'puppet' && newMode !== 'puppet') {
      const editorState = useEditorStore.getState();
      if (editorState.showPuppetSkeleton) {
        editorState.togglePuppetSkeleton();
      }
    }

    if (newMode === 'project_home') {
      // Save current project before going home
      const { useAssetStore } = require('@/lib/asset-store') as { useAssetStore: any };
      useAssetStore.getState().saveCurrentProject();
      useAssetStore.getState().setShowProjectHome(true);
    }

    setMode(newMode);
  };

  return (
    <div className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5">
      {MODE_CONFIG.map(({ value, icon, label, activeColor, activeBg }) => {
        const isActive = mode === value;
        return (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleModeSwitch(value)}
                className={`
                  flex items-center justify-center h-6 w-7 rounded-sm transition-all duration-200
                  ${isActive
                    ? `${activeBg} ${activeColor} ring-1 ring-current/30`
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }
                `}
                aria-label={label}
              >
                {icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
