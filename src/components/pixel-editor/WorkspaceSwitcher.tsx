'use client';

import React from 'react';
import { Home } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useEditorStore } from '@/lib/store';
import { useAssetStore } from '@/lib/asset-store';

// ============================================================
// WorkspaceSwitcher - 退役 workspace mode 后，仅保留"返回主页"按钮
// ============================================================

export default function WorkspaceSwitcher() {
  const handleGoHome = () => {
    // 保存当前项目
    useAssetStore.getState().saveCurrentProject();
    // 退出精灵编辑模式
    const editorState = useEditorStore.getState();
    if (editorState.editMode === 'sprite_edit') {
      editorState.exitSpriteEditMode(true);
    }
    // 显示主页
    useAssetStore.getState().setShowProjectHome(true);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-gray-300 hover:text-white hover:bg-white/10"
          onClick={handleGoHome}
        >
          <Home className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">返回项目主页</TooltipContent>
    </Tooltip>
  );
}
