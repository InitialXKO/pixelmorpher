'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Undo2, Redo2 } from 'lucide-react';
import { useProjectStore } from '@/lib/store';

// ============================================================
// Undo/Redo Controls with history context menus
// ============================================================

export function UndoRedoControls() {
  const maxUndoLevels = useProjectStore((s) => s.maxUndoLevels);
  const setMaxUndoLevels = useProjectStore((s) => s.setMaxUndoLevels);
  const [showUndoSettings, setShowUndoSettings] = useState(false);

  return (
    <>
      {/* Undo */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-500 hover:bg-white/5 hover:text-gray-300 disabled:opacity-30"
            disabled={useProjectStore.getState().undoStack.length === 0}
            onClick={() => useProjectStore.getState().undo()}
          >
            <Undo2 className="size-3.5" />
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64 bg-[#1a1a2e] border-white/10 text-gray-200 max-h-80 overflow-y-auto">
          <ContextMenuLabel className="text-xs text-gray-400">撤销历史 ({useProjectStore.getState().undoStack.length})</ContextMenuLabel>
          <ContextMenuSeparator className="bg-white/10" />
          {useProjectStore.getState().undoStack.slice().reverse().slice(0, 20).map((entry, idx) => (
            <ContextMenuItem
              key={idx}
              className="text-[11px] text-gray-300 focus:bg-white/10 focus:text-gray-100 cursor-default"
              onSelect={() => {
                const store = useProjectStore.getState();
                const steps = idx + 1;
                for (let i = 0; i < steps; i++) {
                  store.undo();
                }
              }}
            >
              <span className="truncate flex-1">{entry.description}</span>
              <span className="text-[9px] text-gray-500 ml-2 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </ContextMenuItem>
          ))}
          {useProjectStore.getState().undoStack.length > 20 && (
            <ContextMenuLabel className="text-[10px] text-gray-500 text-center">... 还有 {useProjectStore.getState().undoStack.length - 20} 条</ContextMenuLabel>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Redo */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-500 hover:bg-white/5 hover:text-gray-300 disabled:opacity-30"
            disabled={useProjectStore.getState().redoStack.length === 0}
            onClick={() => useProjectStore.getState().redo()}
          >
            <Redo2 className="size-3.5" />
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64 bg-[#1a1a2e] border-white/10 text-gray-200 max-h-80 overflow-y-auto">
          <ContextMenuLabel className="text-xs text-gray-400">重做历史 ({useProjectStore.getState().redoStack.length})</ContextMenuLabel>
          <ContextMenuSeparator className="bg-white/10" />
          {useProjectStore.getState().redoStack.slice().reverse().slice(0, 20).map((entry, idx) => (
            <ContextMenuItem
              key={idx}
              className="text-[11px] text-gray-300 focus:bg-white/10 focus:text-gray-100 cursor-default"
              onSelect={() => {
                const store = useProjectStore.getState();
                const steps = idx + 1;
                for (let i = 0; i < steps; i++) {
                  store.redo();
                }
              }}
            >
              <span className="truncate flex-1">{entry.description}</span>
              <span className="text-[9px] text-gray-500 ml-2 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </ContextMenuItem>
          ))}
          {useProjectStore.getState().redoStack.length > 20 && (
            <ContextMenuLabel className="text-[10px] text-gray-500 text-center">... 还有 {useProjectStore.getState().redoStack.length - 20} 条</ContextMenuLabel>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Undo levels setting */}
      <Popover open={showUndoSettings} onOpenChange={setShowUndoSettings}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[9px] text-gray-500 hover:bg-white/5 hover:text-gray-300"
          >
            <span className="font-mono">↩{maxUndoLevels}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 bg-[#1a1a2e] border-white/10 text-gray-200" side="bottom">
          <div className="space-y-3">
            <div className="text-xs font-medium text-gray-300">撤销设置</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">级数:</span>
              <Input
                type="number"
                min={10}
                max={200}
                value={maxUndoLevels}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setMaxUndoLevels(val);
                }}
                className="h-6 w-16 text-xs text-center bg-white/5 border-white/10 text-gray-300 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <p className="text-[10px] text-gray-500">范围: 10-200, 默认50</p>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
