'use client';

import React, { useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type {
  ModifierInstance,
  ModifierType,
  PartAnimationModifier,
  AnimationModifierType,
} from '@/lib/types';
import { getModifierDef } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { LIMB_EDIT_MOD_TYPES, LIMB_ANIM_MOD_TYPES } from './types';

function NodeModifierSection({
  part,
  editMods,
  animMods,
  globalMods,
  allModsCount,
}: {
  part: import('@/lib/types').Part;
  editMods: ModifierInstance[];
  animMods: PartAnimationModifier[];
  globalMods: import('@/lib/types').GlobalModifier[];
  allModsCount: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState<'edit' | 'anim' | null>(null);
  const addPartAnimationModifier = useProjectStore((s) => s.addPartAnimationModifier);
  const removePartAnimationModifier = useProjectStore((s) => s.removePartAnimationModifier);
  const removePartGlobalModifier = useProjectStore((s) => s.removePartGlobalModifier);
  const pushUndo = useProjectStore((s) => s.pushUndo);

  const handleAddEditMod = useCallback((type: ModifierType) => {
    pushUndo('添加编辑修改器');
    // Add to the Part's editModifiers directly
    const { createDefaultModifier } = require('@/lib/types');
    const newMod = createDefaultModifier(type);
    useProjectStore.setState((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== part.id) return p;
        return { ...p, editModifiers: [...(p.editModifiers ?? []), newMod] };
      }),
    }));
    setShowAddMenu(null);
  }, [part.id, pushUndo]);

  const handleRemoveEditMod = useCallback((modId: string) => {
    pushUndo('删除编辑修改器');
    useProjectStore.setState((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== part.id) return p;
        return { ...p, editModifiers: (p.editModifiers ?? []).filter((m) => m.id !== modId) };
      }),
    }));
  }, [part.id, pushUndo]);

  const handleToggleEditMod = useCallback((modId: string) => {
    useProjectStore.setState((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== part.id) return p;
        return {
          ...p,
          editModifiers: (p.editModifiers ?? []).map((m) =>
            m.id === modId ? { ...m, enabled: !m.enabled } : m
          ),
        };
      }),
    }));
  }, [part.id]);

  const handleAddAnimMod = useCallback((type: AnimationModifierType) => {
    addPartAnimationModifier(part.id, type);
    setShowAddMenu(null);
  }, [part.id, addPartAnimationModifier]);

  const handleRemoveAnimMod = useCallback((modId: string) => {
    removePartAnimationModifier(part.id, modId);
  }, [part.id, removePartAnimationModifier]);

  const handleToggleAnimMod = useCallback((modId: string) => {
    useProjectStore.setState((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== part.id) return p;
        return {
          ...p,
          animationModifiers: (p.animationModifiers ?? []).map((m) =>
            m.id === modId ? { ...m, enabled: !m.enabled } : m
          ),
        };
      }),
    }));
  }, [part.id]);

  const handleRemoveGlobalMod = useCallback((modId: string) => {
    removePartGlobalModifier(part.id, modId);
  }, [part.id, removePartGlobalModifier]);

  const handleToggleGlobalMod = useCallback((modId: string) => {
    useProjectStore.setState((s) => ({
      parts: s.parts.map((p) => {
        if (p.id !== part.id) return p;
        return {
          ...p,
          globalModifiers: (p.globalModifiers ?? []).map((m) =>
            m.id === modId ? { ...m, enabled: !m.enabled } : m
          ),
        };
      }),
    }));
  }, [part.id]);

  return (
    <div className="space-y-1.5 mt-2">
      {/* Section header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1">
          {expanded ? <ChevronDown className="size-2.5 text-gray-500" /> : <ChevronRight className="size-2.5 text-gray-500" />}
          <Sparkles className="size-2.5 text-cyan-400" />
          <Label className="text-[9px] text-gray-400 cursor-pointer">修改器</Label>
          {allModsCount > 0 && (
            <span className="text-[8px] text-cyan-400 bg-cyan-400/10 px-1 rounded">{allModsCount}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="size-4 flex items-center justify-center text-cyan-400 hover:text-cyan-300 rounded hover:bg-cyan-400/10"
            title="添加编辑修改器（颜色、轮廓等）"
            onClick={(e) => { e.stopPropagation(); setShowAddMenu(showAddMenu === 'edit' ? null : 'edit'); }}
          >
            <Plus className="size-2.5" />
          </button>
          <button
            className="size-4 flex items-center justify-center text-purple-400 hover:text-purple-300 rounded hover:bg-purple-400/10"
            title="添加动画修改器（波浪、滚动等）"
            onClick={(e) => { e.stopPropagation(); setShowAddMenu(showAddMenu === 'anim' ? null : 'anim'); }}
          >
            <Wand2 className="size-2.5" />
          </button>
        </div>
      </div>

      {/* Add menu */}
      {showAddMenu && (
        <div className="bg-[#0a0a1a] border border-[#1e1e3a] rounded p-1 max-h-40 overflow-y-auto space-y-0.5">
          <div className="text-[8px] text-gray-600 px-1 uppercase tracking-wider">
            {showAddMenu === 'edit' ? '编辑修改器' : '动画修改器'}
          </div>
          {(showAddMenu === 'edit' ? LIMB_EDIT_MOD_TYPES : LIMB_ANIM_MOD_TYPES).map((type) => {
            const def = getModifierDef(type as ModifierType);
            if (!def) return null;
            return (
              <button
                key={type}
                className="w-full text-left text-[9px] text-gray-300 hover:text-cyan-300 hover:bg-cyan-400/5 px-1.5 py-0.5 rounded flex items-center gap-1.5"
                onClick={() => {
                  if (showAddMenu === 'edit') {
                    handleAddEditMod(type as ModifierType);
                  } else {
                    handleAddAnimMod(type as AnimationModifierType);
                  }
                }}
              >
                <span className="text-gray-500">{def.icon || '○'}</span>
                <span>{def.label}</span>
                <span className="text-gray-600 text-[8px] ml-auto">{def.category}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Modifier list */}
      {expanded && (
        <div className="space-y-0.5">
          {allModsCount === 0 && (
            <div className="text-[8px] text-gray-600 px-1 italic">
              暂无修改器 — 点击 + 添加
            </div>
          )}

          {/* Edit modifiers */}
          {editMods.map((mod) => {
            const def = getModifierDef(mod.type);
            return (
              <div
                key={mod.id}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] group ${mod.enabled ? 'text-gray-300' : 'text-gray-600 line-through'}`}
              >
                <button
                  className="size-3 flex items-center justify-center rounded hover:bg-white/5"
                  onClick={() => handleToggleEditMod(mod.id)}
                  title={mod.enabled ? '禁用' : '启用'}
                >
                  <Eye className={`size-2 ${mod.enabled ? 'text-cyan-400' : 'text-gray-600'}`} />
                </button>
                <span className="text-gray-500 flex-shrink-0">{def?.icon || '○'}</span>
                <span className="truncate flex-1">{def?.label || mod.type}</span>
                <button
                  className="size-3 flex items-center justify-center text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveEditMod(mod.id)}
                  title="删除"
                >
                  <Trash2 className="size-2" />
                </button>
              </div>
            );
          })}

          {/* Animation modifiers */}
          {animMods.map((mod) => {
            const def = getModifierDef(mod.type as ModifierType);
            return (
              <div
                key={mod.id}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] group ${mod.enabled ? 'text-purple-300' : 'text-gray-600 line-through'}`}
              >
                <button
                  className="size-3 flex items-center justify-center rounded hover:bg-white/5"
                  onClick={() => handleToggleAnimMod(mod.id)}
                  title={mod.enabled ? '禁用' : '启用'}
                >
                  <Eye className={`size-2 ${mod.enabled ? 'text-purple-400' : 'text-gray-600'}`} />
                </button>
                <span className="text-purple-500 flex-shrink-0">~</span>
                <span className="truncate flex-1">{def?.label || mod.type}</span>
                <span className="text-[7px] text-gray-600">
                  F{mod.startFrame ?? 0}{mod.endFrame >= 0 ? `→${mod.endFrame}` : ''}
                </span>
                <button
                  className="size-3 flex items-center justify-center text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveAnimMod(mod.id)}
                  title="删除"
                >
                  <Trash2 className="size-2" />
                </button>
              </div>
            );
          })}

          {/* Global modifiers */}
          {globalMods.map((mod) => (
            <div
              key={mod.id}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] group ${mod.enabled !== false ? 'text-amber-300' : 'text-gray-600 line-through'}`}
            >
              <button
                className="size-3 flex items-center justify-center rounded hover:bg-white/5"
                onClick={() => handleToggleGlobalMod(mod.id)}
                title={mod.enabled !== false ? '禁用' : '启用'}
              >
                <Eye className={`size-2 ${mod.enabled !== false ? 'text-amber-400' : 'text-gray-600'}`} />
              </button>
              <span className="text-amber-500 flex-shrink-0">★</span>
              <span className="truncate flex-1">{mod.type}</span>
              <button
                className="size-3 flex items-center justify-center text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemoveGlobalMod(mod.id)}
                title="删除"
              >
                <Trash2 className="size-2" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NodeModifierSection;
