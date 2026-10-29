'use client';

import { useProjectStore } from '@/lib/store';
import { AnimationClip } from '@/lib/types';
import { Plus, Trash2, Film, Settings, ChevronRight, Clock, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useCallback } from 'react';
import SlashEffectEditor from './puppet/SlashEffectEditor';
import { BEAT_TEMPLATES } from '@/lib/beat-templates';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export default function AnimationClipPanel() {
  const {
    animationClips,
    activeAnimationClipId,
    addAnimationClip,
    removeAnimationClip,
    updateAnimationClip,
    setActiveAnimationClip,
    applyBeatTemplate,
  } = useProjectStore();
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters);
  const selectedCharacterId = useProjectStore((s) => s.selectedCharacterId);
  const characterList = Object.values(unifiedCharacters ?? {});
  // 新片段的缺省归属：当前选中角色，否则第一个角色；无角色时不可建
  const defaultOwnerId =
    (selectedCharacterId && unifiedCharacters[selectedCharacterId] ? selectedCharacterId : null) ??
    characterList[0]?.id ??
    null;

  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [newClipName, setNewClipName] = useState('');
  const [beatTemplateId, setBeatTemplateId] = useState('attack');

  const activeClip = animationClips.find(c => c.id === activeAnimationClipId) ?? null;

  const handleAddClip = useCallback(() => {
    if (!defaultOwnerId) return;
    const name = newClipName.trim() || `动画 ${animationClips.length + 1}`;
    addAnimationClip(name, defaultOwnerId);
    setNewClipName('');
  }, [addAnimationClip, animationClips.length, newClipName, defaultOwnerId]);

  const handleSelectClip = useCallback((clipId: string) => {
    setActiveAnimationClip(clipId);
  }, [setActiveAnimationClip]);

  const handleDeleteClip = useCallback((clipId: string) => {
    if (animationClips.length <= 1) return; // Don't delete the last clip
    const clip = animationClips.find((c) => c.id === clipId);
    const name = clip?.name ?? '该片段';
    if (!confirm(`确定删除动画片段「${name}」吗？片段的状态轨道、事件与时间窗将一并删除（节点轨道属于角色，不受影响），此操作不可撤销。`)) return;
    removeAnimationClip(clipId);
  }, [removeAnimationClip, animationClips]);

  const handleRenameClip = useCallback((clipId: string, name: string) => {
    updateAnimationClip(clipId, { name });
    setEditingClipId(null);
  }, [updateAnimationClip]);

  const handleDuplicateClip = useCallback((clip: AnimationClip) => {
    const copy = addAnimationClip(`${clip.name} 副本`, clip.puppetCharacterId);
    updateAnimationClip(copy.id, {
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
      loop: clip.loop,
      description: clip.description,
      stateKeyframes: structuredClone(clip.stateKeyframes ?? []),
      effectTracks: structuredClone(clip.effectTracks ?? []),
      canvasModifierTracks: structuredClone(clip.canvasModifierTracks ?? []),
      motionBlurStrokes: structuredClone(clip.motionBlurStrokes ?? []),
      effectStrokes: structuredClone(clip.effectStrokes ?? []),
      tags: [...(clip.tags ?? [])],
      events: structuredClone(clip.events ?? []),
      frameTags: structuredClone(clip.frameTags ?? []),
      hitboxMap: structuredClone(clip.hitboxMap ?? {}),
    });
  }, [addAnimationClip, updateAnimationClip]);

  return (
    <div className="flex flex-col h-full bg-[#0e0e1c]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800/50 shrink-0">
        <Film className="size-3.5 text-amber-400" />
        <span className="text-[10px] font-medium text-zinc-300 uppercase tracking-wider">
          动画片段
        </span>
        <span className="text-[10px] text-zinc-500 ml-1">
          ({animationClips.length})
        </span>
      </div>

      {/* Clip List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {animationClips.map(clip => {
          const isActive = clip.id === activeAnimationClipId;
          const stateKeyCount = clip.stateKeyframes?.length ?? 0;
          const ownerName = unifiedCharacters[clip.puppetCharacterId]?.name ?? '（归属失效）';

          return (
          <ContextMenu key={clip.id}>
            <ContextMenuTrigger asChild>
            <div
              className={`group flex flex-col border-b border-zinc-800/30 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-amber-500/10 border-l-2 border-l-amber-500'
                  : 'hover:bg-white/5 border-l-2 border-l-transparent'
              }`}
              onClick={() => handleSelectClip(clip.id)}
              onContextMenu={() => handleSelectClip(clip.id)}
            >
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <ChevronRight
                  className={`size-3 text-zinc-500 transition-transform ${
                    isActive ? 'rotate-90' : ''
                  }`}
                />
                {editingClipId === clip.id ? (
                  <Input
                    className="h-5 text-[11px] bg-zinc-800 border-zinc-700 px-1.5 py-0 flex-1"
                    defaultValue={clip.name}
                    autoFocus
                    onBlur={(e) => handleRenameClip(clip.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleRenameClip(clip.id, (e.target as HTMLInputElement).value);
                      }
                      if (e.key === 'Escape') setEditingClipId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={`text-[11px] flex-1 truncate min-w-0 ${
                    isActive ? 'text-amber-200 font-medium' : 'text-zinc-300'
                  }`}>
                    {clip.name}
                  </span>
                )}
                {isActive && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-zinc-500 hover:text-zinc-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingClipId(clip.id);
                      }}
                    >
                      <Settings className="size-2.5" />
                    </Button>
                    {animationClips.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-zinc-500 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClip(clip.id);
                        }}
                      >
                        <Trash2 className="size-2.5" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {/* Clip metadata */}
              {isActive && (
                <div className="flex items-center gap-3 px-2 pb-1.5 pl-6">
                  <span className="text-[9px] text-zinc-500 flex items-center gap-0.5">
                    <Clock className="size-2.5" />
                    {clip.startFrame}–{clip.endFrame}帧{clip.loop ? ' · 循环' : ''}
                  </span>
                  <span className="text-[9px] text-zinc-500">
                    {ownerName} · {stateKeyCount}状态键
                  </span>
                </div>
              )}
            </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-36">
              <ContextMenuItem onSelect={() => handleSelectClip(clip.id)}>
                设为当前片段
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  handleSelectClip(clip.id);
                  setEditingClipId(clip.id);
                }}
              >
                重命名
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleDuplicateClip(clip)}>
                复制片段
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={animationClips.length <= 1}
                className="text-red-400 focus:text-red-300"
                onSelect={() => handleDeleteClip(clip.id)}
              >
                删除片段
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          );
        })}
      </div>

      {/* Add New Clip */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-zinc-800/50 shrink-0">
        <Input
          className="h-6 text-[10px] bg-zinc-900 border-zinc-700 px-1.5 flex-1"
          placeholder="新动画片段名称..."
          value={newClipName}
          onChange={(e) => setNewClipName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddClip();
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
          onClick={handleAddClip}
          disabled={!defaultOwnerId}
          title={defaultOwnerId ? '新建片段' : '先创建角色——片段必须归属一个角色'}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {/* Active Clip Details */}
      {activeClip && (
        <div className="border-t border-zinc-800/50 px-2 py-2 shrink-0">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5">
            片段设置
          </div>
          <div className="space-y-1.5">
            <div>
              <label className="text-[9px] text-zinc-500 block mb-0.5">归属角色</label>
              <select
                className="h-5 text-[10px] bg-zinc-900 border border-zinc-700 rounded px-1 w-full text-zinc-300"
                value={activeClip.puppetCharacterId}
                onChange={(e) => updateAnimationClip(activeClip.id, { puppetCharacterId: e.target.value })}
              >
                {!characterList.some((c) => c.id === activeClip.puppetCharacterId) && (
                  <option value={activeClip.puppetCharacterId}>（归属失效，请改绑）</option>
                )}
                {characterList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[9px] text-zinc-500 block mb-0.5">开始帧</label>
                <Input
                  type="number"
                  className="h-5 text-[10px] bg-zinc-900 border-zinc-700 px-1.5 w-full"
                  value={activeClip.startFrame}
                  min={0}
                  max={600}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(600, parseInt(e.target.value) || 0));
                    updateAnimationClip(activeClip.id, {
                      startFrame: v,
                      endFrame: Math.max(v, activeClip.endFrame),
                    });
                  }}
                />
              </div>
              <div>
                <label className="text-[9px] text-zinc-500 block mb-0.5">结束帧</label>
                <Input
                  type="number"
                  className="h-5 text-[10px] bg-zinc-900 border-zinc-700 px-1.5 w-full"
                  value={activeClip.endFrame}
                  min={0}
                  max={600}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(600, parseInt(e.target.value) || 0));
                    updateAnimationClip(activeClip.id, {
                      endFrame: Math.max(activeClip.startFrame, v),
                    });
                  }}
                />
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                className="size-3 accent-amber-500"
                checked={activeClip.loop}
                onChange={(e) => updateAnimationClip(activeClip.id, { loop: e.target.checked })}
              />
              窗内循环
            </label>
            <div>
              <label className="text-[9px] text-zinc-500 block mb-0.5">节拍模板</label>
              <div className="flex items-center gap-1">
                <select
                  className="h-5 text-[10px] bg-zinc-900 border border-zinc-700 rounded px-1 flex-1 text-zinc-300"
                  value={beatTemplateId}
                  onChange={(e) => setBeatTemplateId(e.target.value)}
                >
                  {BEAT_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                  onClick={() => applyBeatTemplate(activeClip.id, beatTemplateId)}
                  title="按节拍把片段窗切成帧标签（替换既有标签），并按模板设定循环"
                >
                  套用
                </Button>
              </div>
              <p className="text-[9px] text-zinc-600 mt-0.5">
                按节拍阶段切分片段窗为帧标签：时间轴上方会画出标签条，边界可在左侧「DCC管线」页签里调整。
              </p>
            </div>
            <div className="mt-2">
              <SlashEffectEditor
                value={activeClip.slashEffect}
                onChange={(next) => updateAnimationClip(activeClip.id, { slashEffect: next })}
                nodes={Object.values(unifiedCharacters?.[activeClip.puppetCharacterId]?.nodes ?? {}).map((n) => ({ id: n.id, name: n.name }))}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
