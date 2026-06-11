'use client';

import { useProjectStore } from '@/lib/store';
import { AnimationClip } from '@/lib/types';
import { Plus, Trash2, Film, Settings, ChevronRight, Clock, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useCallback } from 'react';

export default function AnimationClipPanel() {
  const {
    animationClips,
    activeAnimationClipId,
    addAnimationClip,
    removeAnimationClip,
    updateAnimationClip,
    setActiveAnimationClip,
    parts,
  } = useProjectStore();

  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [newClipName, setNewClipName] = useState('');

  const activeClip = animationClips.find(c => c.id === activeAnimationClipId) ?? null;

  const handleAddClip = useCallback(() => {
    const name = newClipName.trim() || `动画 ${animationClips.length + 1}`;
    addAnimationClip(name);
    setNewClipName('');
  }, [addAnimationClip, animationClips.length, newClipName]);

  const handleSelectClip = useCallback((clipId: string) => {
    setActiveAnimationClip(clipId);
  }, [setActiveAnimationClip]);

  const handleDeleteClip = useCallback((clipId: string) => {
    if (animationClips.length <= 1) return; // Don't delete the last clip
    removeAnimationClip(clipId);
  }, [removeAnimationClip, animationClips.length]);

  const handleRenameClip = useCallback((clipId: string, name: string) => {
    updateAnimationClip(clipId, { name });
    setEditingClipId(null);
  }, [updateAnimationClip]);

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
          const keyframeCount = clip.keyframes.length;
          const partCount = clip.tracks.length;

          return (
            <div
              key={clip.id}
              className={`group flex flex-col border-b border-zinc-800/30 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-amber-500/10 border-l-2 border-l-amber-500'
                  : 'hover:bg-white/5 border-l-2 border-l-transparent'
              }`}
              onClick={() => handleSelectClip(clip.id)}
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
                  <span className={`text-[11px] flex-1 truncate ${
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
                    {clip.frameRate}fps · {clip.totalFrames}帧
                  </span>
                  <span className="text-[9px] text-zinc-500">
                    {partCount}部件 · {keyframeCount}关键帧
                  </span>
                </div>
              )}
            </div>
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
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[9px] text-zinc-500 block mb-0.5">帧率</label>
              <Input
                type="number"
                className="h-5 text-[10px] bg-zinc-900 border-zinc-700 px-1.5 w-full"
                value={activeClip.frameRate}
                min={1}
                max={60}
                onChange={(e) => {
                  const fps = parseInt(e.target.value) || 12;
                  updateAnimationClip(activeClip.id, { frameRate: Math.max(1, Math.min(60, fps)) });
                }}
              />
            </div>
            <div>
              <label className="text-[9px] text-zinc-500 block mb-0.5">总帧数</label>
              <Input
                type="number"
                className="h-5 text-[10px] bg-zinc-900 border-zinc-700 px-1.5 w-full"
                value={activeClip.totalFrames}
                min={1}
                max={600}
                onChange={(e) => {
                  const frames = parseInt(e.target.value) || 24;
                  updateAnimationClip(activeClip.id, { totalFrames: Math.max(1, Math.min(600, frames)) });
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
