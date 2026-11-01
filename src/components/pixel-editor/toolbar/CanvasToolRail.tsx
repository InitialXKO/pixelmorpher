'use client';

import React from 'react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { ToolType } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { TOOL_CONFIG } from './constants';

// ============================================================
// CanvasToolRail — 画布左缘竖排工具盘（原顶部工具栏的工具排迁来）
// 工具的选中与使用全程发生在画布上，工具盘贴画布；顶栏只留参数条
// 与全局件。两组分段：上 = 木偶台面工具，下 = 精灵像素工具（进精灵
// 编辑上下文）。切工具的联动（自动进 sprite_edit / 无精灵 toast）与
// 原顶栏 ToggleGroup 的 onValueChange 逐字一致，只是宿主换了位置。
// ============================================================

/** 精灵像素组：在精灵图上干活的工具（与 TOOL_CONFIG 的 pixel 组同界） */
const PIXEL_TOOLS: ToolType[] = ['landmark', 'mark', 'crop', 'lasso', 'magic_wand', 'smart_select', 'inpaint'];

export default function CanvasToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const { toast } = useToast();

  const handleSelectTool = (val: ToolType) => {
    setTool(val);
    const state = useEditorStore.getState();

    // Auto-enter sprite_edit when switching to brush/eraser/fill in non-correction mode.
    // Only auto-enter when a sprite is already selected; never silently pick the first one.
    const autoEnterSpriteEdit = (hint: string) => {
      const projectStore = useProjectStore.getState();
      const selectedSpriteId = state.selectedSpriteId;
      const sprite = selectedSpriteId ? projectStore.sprites[selectedSpriteId] : null;
      if (sprite) {
        state.enterSpriteEditMode(selectedSpriteId!);
      } else if (Object.keys(projectStore.sprites).length > 0) {
        toast({ title: '请先选择精灵', description: hint });
      }
    };
    if ((val === 'brush' || val === 'eraser' || val === 'fill') &&
        state.editMode !== 'correction' &&
        state.editMode !== 'sprite_edit') {
      autoEnterSpriteEdit('在精灵面板中选择一个精灵后再绘画');
    }
    // 选区工具的使用场景就是精灵像素编辑：lasso/magic_wand/smart_select 点选时
    // 有选中精灵则自动进 sprite_edit，无选中精灵则 toast（不静默）。
    if ((val === 'lasso' || val === 'magic_wand' || val === 'smart_select') &&
        state.editMode !== 'correction' &&
        state.editMode !== 'sprite_edit') {
      autoEnterSpriteEdit('在精灵面板中选择一个精灵后再框选');
    }
    // 特征点标注的使用场景也是精灵像素：landmark 点选时自动进 sprite_edit。
    if (val === 'landmark' &&
        state.editMode !== 'correction' &&
        state.editMode !== 'sprite_edit') {
      autoEnterSpriteEdit('在精灵面板中选择一个精灵后再标注特征点');
    }
    // 精灵标记同理：mark 的 handler 只在 sprite_edit 内工作，此前漏在
    // 自动进的枚举外——普通模式点它再点画布静默无反应（审计 F-24）。
    if (val === 'mark' &&
        state.editMode !== 'correction' &&
        state.editMode !== 'sprite_edit') {
      autoEnterSpriteEdit('在精灵面板中选择一个精灵后再打标记');
    }
    // 裁剪在 sprite_edit 里裁当前精灵（改尺寸/扩边），画布上仍裁项目画布：
    // 有选中精灵时先自动进 sprite_edit，与画笔/选区同一联动。
    if (val === 'crop' &&
        state.editMode !== 'correction' &&
        state.editMode !== 'sprite_edit') {
      autoEnterSpriteEdit('在精灵面板中选择一个精灵后再裁剪它');
    }
  };

  const renderButton = ({ value, icon, label }: (typeof TOOL_CONFIG)[number]) => (
    <Tooltip key={value}>
      <TooltipTrigger asChild>
        <Toggle
          pressed={tool === value}
          onPressedChange={(pressed) => { if (pressed) handleSelectTool(value); }}
          aria-label={label}
          className={`h-8 w-8 p-0 data-[state=on]:bg-purple-600/40 data-[state=on]:text-purple-300 data-[state=on]:ring-1 data-[state=on]:ring-purple-500/50 text-gray-400 hover:bg-white/5 hover:text-gray-200 rounded transition-colors ${
            value === 'motion_blur_brush' ? 'data-[state=on]:bg-cyan-600/40 data-[state=on]:text-cyan-300 data-[state=on]:ring-cyan-500/50' : ''
          } ${
            value === 'glow_brush' || value === 'particle_brush' || value === 'afterimage_brush' ? 'data-[state=on]:bg-amber-600/40 data-[state=on]:text-amber-300 data-[state=on]:ring-amber-500/50' : ''
          }`}
        >
          {icon}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );

  const stageTools = TOOL_CONFIG.filter((t) => !PIXEL_TOOLS.includes(t.value));
  const pixelTools = TOOL_CONFIG.filter((t) => PIXEL_TOOLS.includes(t.value));

  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5 w-10 shrink-0 h-full bg-[#12121f] border-r border-white/10 select-none overflow-y-auto">
      {stageTools.map(renderButton)}
      <Separator orientation="horizontal" className="w-5 my-1.5 bg-white/10" />
      {pixelTools.map(renderButton)}
    </div>
  );
}
