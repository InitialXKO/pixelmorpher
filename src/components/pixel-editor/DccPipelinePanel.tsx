'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Zap,
  Tag,
  Box,
  Palette,
  Circle,
  Square,
  Hexagon,
  Pentagon,
  Eye,
  EyeOff,
  Settings2,
  X,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  AnimationEvent,
  FrameTag,
  HitboxShape,
  HitboxShapeType,
  Palette as PaletteData,
  PaletteColor,
  AnimationClip,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

// ---- Tab Type ----

type DccTab = 'events' | 'tags' | 'hitboxes' | 'palettes';

// ---- Color helpers ----

const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#64748b'];
const HITBOX_COLORS = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];

function randomColor(palette: string[]) {
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---- Main Component ----

export default function DccPipelinePanel() {
  const [activeTab, setActiveTab] = useState<DccTab>('events');

  const tabs: { key: DccTab; label: string; icon: React.ReactNode }[] = [
    { key: 'events', label: '事件', icon: <Zap className="size-3" /> },
    { key: 'tags', label: '标签', icon: <Tag className="size-3" /> },
    { key: 'hitboxes', label: '碰撞', icon: <Box className="size-3" /> },
    { key: 'palettes', label: '调色板', icon: <Palette className="size-3" /> },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d1a]">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-2 border-b border-[#1e1e3a]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2">
          {activeTab === 'events' && <EventsTab />}
          {activeTab === 'tags' && <TagsTab />}
          {activeTab === 'hitboxes' && <HitboxesTab />}
          {activeTab === 'palettes' && <PalettesTab />}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================
// Events Tab
// ============================================================

function EventsTab() {
  const animationClips = useProjectStore((s) => s.animationClips);
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const updateAnimationClip = useProjectStore((s) => s.updateAnimationClip);

  const activeClip = animationClips.find((c) => c.id === activeAnimationClipId) ?? null;
  const events = activeClip?.events ?? [];

  const handleAddEvent = useCallback(() => {
    if (!activeClip) return;
    const newEvent: AnimationEvent = {
      id: crypto.randomUUID(),
      frame: currentFrame,
      name: '新事件',
      stringValue: '',
      numberValue: 0,
      active: true,
      color: randomColor(TAG_COLORS),
    };
    updateAnimationClip(activeClip.id, {
      events: [...events, newEvent],
    });
  }, [activeClip, events, currentFrame, updateAnimationClip]);

  const handleRemoveEvent = useCallback(
    (eventId: string) => {
      if (!activeClip) return;
      updateAnimationClip(activeClip.id, {
        events: events.filter((e) => e.id !== eventId),
      });
    },
    [activeClip, events, updateAnimationClip]
  );

  const handleUpdateEvent = useCallback(
    (eventId: string, updates: Partial<AnimationEvent>) => {
      if (!activeClip) return;
      updateAnimationClip(activeClip.id, {
        events: events.map((e) => (e.id === eventId ? { ...e, ...updates } : e)),
      });
    },
    [activeClip, events, updateAnimationClip]
  );

  if (!activeClip) {
    return (
      <div className="text-center py-4">
        <Zap className="size-5 text-gray-700 mx-auto mb-1" />
        <p className="text-[10px] text-gray-600">请先选择动画片段</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">动画事件</Label>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-cyan-400"
          onClick={handleAddEvent}
          title="添加事件"
        >
          <Plus className="size-3" />
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-3">
          <Zap className="size-4 text-gray-700 mx-auto mb-1" />
          <p className="text-[9px] text-gray-600">暂无事件</p>
          <p className="text-[8px] text-gray-700">在当前帧添加动画事件</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map((event) => (
            <div
              key={event.id}
              className={`border rounded p-2 transition-colors ${
                event.active
                  ? 'bg-[#111128] border-[#1e1e3a]'
                  : 'bg-[#0a0a18] border-[#1e1e3a]/50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <div
                  className="size-2 rounded-full flex-shrink-0 cursor-pointer"
                  style={{ backgroundColor: event.color }}
                  onClick={() =>
                    handleUpdateEvent(event.id, { color: randomColor(TAG_COLORS) })
                  }
                />
                <Input
                  value={event.name}
                  onChange={(e) => handleUpdateEvent(event.id, { name: e.target.value })}
                  className="h-5 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className={`size-4 ${event.active ? 'text-cyan-400' : 'text-gray-700'}`}
                  onClick={() => handleUpdateEvent(event.id, { active: !event.active })}
                >
                  {event.active ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-4 text-red-400 hover:text-red-300"
                  onClick={() => handleRemoveEvent(event.id)}
                >
                  <Trash2 className="size-2.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1">
                  <Label className="text-[8px] text-gray-600 w-6">帧</Label>
                  <Input
                    type="number"
                    value={event.frame}
                    onChange={(e) =>
                      handleUpdateEvent(event.id, { frame: Number(e.target.value) })
                    }
                    className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-[8px] text-gray-600 w-6">字符串</Label>
                  <Input
                    value={event.stringValue ?? ''}
                    onChange={(e) =>
                      handleUpdateEvent(event.id, { stringValue: e.target.value })
                    }
                    className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-[8px] text-gray-600 w-6">数值</Label>
                  <Input
                    type="number"
                    value={event.numberValue ?? 0}
                    onChange={(e) =>
                      handleUpdateEvent(event.id, { numberValue: Number(e.target.value) })
                    }
                    className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tags Tab
// ============================================================

function TagsTab() {
  const animationClips = useProjectStore((s) => s.animationClips);
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const updateAnimationClip = useProjectStore((s) => s.updateAnimationClip);

  const activeClip = animationClips.find((c) => c.id === activeAnimationClipId) ?? null;
  const frameTags = activeClip?.frameTags ?? [];

  const handleAddTag = useCallback(() => {
    if (!activeClip) return;
    const newTag: FrameTag = {
      id: crypto.randomUUID(),
      name: '新标签',
      startFrame: 0,
      endFrame: 10,
      color: randomColor(TAG_COLORS),
      loop: 'loop',
      direction: 'forward',
    };
    updateAnimationClip(activeClip.id, {
      frameTags: [...frameTags, newTag],
    });
  }, [activeClip, frameTags, updateAnimationClip]);

  const handleRemoveTag = useCallback(
    (tagId: string) => {
      if (!activeClip) return;
      updateAnimationClip(activeClip.id, {
        frameTags: frameTags.filter((t) => t.id !== tagId),
      });
    },
    [activeClip, frameTags, updateAnimationClip]
  );

  const handleUpdateTag = useCallback(
    (tagId: string, updates: Partial<FrameTag>) => {
      if (!activeClip) return;
      updateAnimationClip(activeClip.id, {
        frameTags: frameTags.map((t) => (t.id === tagId ? { ...t, ...updates } : t)),
      });
    },
    [activeClip, frameTags, updateAnimationClip]
  );

  if (!activeClip) {
    return (
      <div className="text-center py-4">
        <Tag className="size-5 text-gray-700 mx-auto mb-1" />
        <p className="text-[10px] text-gray-600">请先选择动画片段</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">帧标签</Label>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-cyan-400"
          onClick={handleAddTag}
          title="添加标签"
        >
          <Plus className="size-3" />
        </Button>
      </div>

      {frameTags.length === 0 ? (
        <div className="text-center py-3">
          <Tag className="size-4 text-gray-700 mx-auto mb-1" />
          <p className="text-[9px] text-gray-600">暂无帧标签</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {frameTags.map((tag) => (
            <div
              key={tag.id}
              className="border rounded p-2 bg-[#111128] border-[#1e1e3a]"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <div
                  className="size-2.5 rounded-full flex-shrink-0 cursor-pointer"
                  style={{ backgroundColor: tag.color }}
                  onClick={() => handleUpdateTag(tag.id, { color: randomColor(TAG_COLORS) })}
                />
                <Input
                  value={tag.name}
                  onChange={(e) => handleUpdateTag(tag.id, { name: e.target.value })}
                  className="h-5 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-4 text-red-400 hover:text-red-300"
                  onClick={() => handleRemoveTag(tag.id)}
                >
                  <Trash2 className="size-2.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 flex-1">
                  <Label className="text-[8px] text-gray-600">起始</Label>
                  <Input
                    type="number"
                    min={0}
                    value={tag.startFrame}
                    onChange={(e) =>
                      handleUpdateTag(tag.id, { startFrame: Number(e.target.value) })
                    }
                    className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-12"
                  />
                </div>
                <span className="text-[9px] text-gray-600">→</span>
                <div className="flex items-center gap-1 flex-1">
                  <Label className="text-[8px] text-gray-600">结束</Label>
                  <Input
                    type="number"
                    min={0}
                    value={tag.endFrame}
                    onChange={(e) =>
                      handleUpdateTag(tag.id, { endFrame: Number(e.target.value) })
                    }
                    className="h-5 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-12"
                  />
                </div>
                <select
                  value={tag.loop}
                  onChange={(e) =>
                    handleUpdateTag(tag.id, { loop: e.target.value as FrameTag['loop'] })
                  }
                  className="h-5 text-[9px] bg-[#0d0d1a] border border-[#1e1e3a] rounded px-1 text-gray-400"
                >
                  <option value="loop">循环</option>
                  <option value="once">一次</option>
                  <option value="ping_pong">乒乓</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Hitboxes Tab
// ============================================================

function HitboxesTab() {
  const animationClips = useProjectStore((s) => s.animationClips);
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const updateAnimationClip = useProjectStore((s) => s.updateAnimationClip);
  const selectedHitboxId = useEditorStore((s) => s.selectedHitboxId);
  const currentFrame = useProjectStore((s) => s.currentFrame);

  const activeClip = animationClips.find((c) => c.id === activeAnimationClipId) ?? null;
  // Flatten all hitboxes from hitboxMap
  const allHitboxes: HitboxShape[] = useMemo(() => {
    if (!activeClip?.hitboxMap) return [];
    return Object.values(activeClip.hitboxMap).flat();
  }, [activeClip?.hitboxMap]);

  const handleAddHitbox = useCallback(
    (shapeType: HitboxShapeType) => {
      if (!activeClip) return;
      const newHitbox: HitboxShape = {
        id: crypto.randomUUID(),
        name: `碰撞_${shapeType}`,
        shapeType,
        data:
          shapeType === 'rect'
            ? { x: 0, y: 0, width: 16, height: 16 }
            : shapeType === 'circle'
            ? { x: 8, y: 8, radius: 8 }
            : shapeType === 'capsule'
            ? { x: 8, y: 8, radius: 4, height: 16 }
            : { vertices: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 16 }] },
        active: true,
        color: randomColor(HITBOX_COLORS),
      };
      // Add to a keyframe bucket for the current frame
      const keyframeKey = `frame_${currentFrame}`;
      const existingMap = activeClip.hitboxMap ?? {};
      const existingShapes = existingMap[keyframeKey] ?? [];
      updateAnimationClip(activeClip.id, {
        hitboxMap: {
          ...existingMap,
          [keyframeKey]: [...existingShapes, newHitbox],
        },
      });
    },
    [activeClip, currentFrame, updateAnimationClip]
  );

  const handleRemoveHitbox = useCallback(
    (hitboxId: string) => {
      if (!activeClip?.hitboxMap) return;
      const newMap: Record<string, HitboxShape[]> = {};
      for (const [key, shapes] of Object.entries(activeClip.hitboxMap)) {
        const filtered = shapes.filter((s) => s.id !== hitboxId);
        if (filtered.length > 0) {
          newMap[key] = filtered;
        }
      }
      updateAnimationClip(activeClip.id, { hitboxMap: newMap });
    },
    [activeClip, updateAnimationClip]
  );

  const handleUpdateHitbox = useCallback(
    (hitboxId: string, updates: Partial<HitboxShape>) => {
      if (!activeClip?.hitboxMap) return;
      const newMap: Record<string, HitboxShape[]> = {};
      for (const [key, shapes] of Object.entries(activeClip.hitboxMap)) {
        newMap[key] = shapes.map((s) => (s.id === hitboxId ? { ...s, ...updates } : s));
      }
      updateAnimationClip(activeClip.id, { hitboxMap: newMap });
    },
    [activeClip, updateAnimationClip]
  );

  if (!activeClip) {
    return (
      <div className="text-center py-4">
        <Box className="size-5 text-gray-700 mx-auto mb-1" />
        <p className="text-[10px] text-gray-600">请先选择动画片段</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500 uppercase tracking-wider">碰撞体</Label>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-cyan-400"
            onClick={() => handleAddHitbox('rect')}
            title="矩形"
          >
            <Square className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-cyan-400"
            onClick={() => handleAddHitbox('circle')}
            title="圆形"
          >
            <Circle className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-cyan-400"
            onClick={() => handleAddHitbox('capsule')}
            title="胶囊"
          >
            <Hexagon className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-cyan-400"
            onClick={() => handleAddHitbox('polygon')}
            title="多边形"
          >
            <Pentagon className="size-3" />
          </Button>
        </div>
      </div>

      {allHitboxes.length === 0 ? (
        <div className="text-center py-3">
          <Box className="size-4 text-gray-700 mx-auto mb-1" />
          <p className="text-[9px] text-gray-600">暂无碰撞体</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {allHitboxes.map((hitbox) => (
            <div
              key={hitbox.id}
              className={`border rounded p-2 transition-colors ${
                hitbox.active
                  ? 'bg-[#111128] border-[#1e1e3a]'
                  : 'bg-[#0a0a18] border-[#1e1e3a]/50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <div
                  className="size-2 rounded-full flex-shrink-0 cursor-pointer"
                  style={{ backgroundColor: hitbox.color }}
                  onClick={() =>
                    handleUpdateHitbox(hitbox.id, { color: randomColor(HITBOX_COLORS) })
                  }
                />
                <Input
                  value={hitbox.name}
                  onChange={(e) =>
                    handleUpdateHitbox(hitbox.id, { name: e.target.value })
                  }
                  className="h-5 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                />
                <span className="text-[8px] text-gray-600 uppercase">{hitbox.shapeType}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`size-4 ${hitbox.active ? 'text-cyan-400' : 'text-gray-700'}`}
                  onClick={() => handleUpdateHitbox(hitbox.id, { active: !hitbox.active })}
                >
                  {hitbox.active ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-4 text-red-400"
                  onClick={() => handleRemoveHitbox(hitbox.id)}
                >
                  <Trash2 className="size-2.5" />
                </Button>
              </div>

              {/* Shape-specific editors */}
              <div className="pl-4">
                {hitbox.shapeType === 'rect' && (
                  <div className="grid grid-cols-2 gap-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">X</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.x ?? 0)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, x: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">Y</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.y ?? 0)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, y: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">宽</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.width ?? 16)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, width: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">高</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.height ?? 16)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, height: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                  </div>
                )}

                {hitbox.shapeType === 'circle' && (
                  <div className="grid grid-cols-3 gap-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">X</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.x ?? 0)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, x: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">Y</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.y ?? 0)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, y: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">R</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.radius ?? 8)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, radius: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                  </div>
                )}

                {hitbox.shapeType === 'capsule' && (
                  <div className="grid grid-cols-2 gap-1">
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">X</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.x ?? 0)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, x: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">Y</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.y ?? 0)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, y: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">R</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.radius ?? 4)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, radius: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-[8px] text-gray-600">H</Label>
                      <Input
                        type="number"
                        value={Number(hitbox.data.height ?? 16)}
                        onChange={(e) =>
                          handleUpdateHitbox(hitbox.id, {
                            data: { ...hitbox.data, height: Number(e.target.value) },
                          })
                        }
                        className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                      />
                    </div>
                  </div>
                )}

                {hitbox.shapeType === 'polygon' && (
                  <div className="space-y-1">
                    {((hitbox.data.vertices as { x: number; y: number }[]) ?? []).map(
                      (vertex, vi) => (
                        <div key={vi} className="flex items-center gap-1">
                          <span className="text-[8px] text-gray-600 w-4">{vi}</span>
                          <Input
                            type="number"
                            value={vertex.x}
                            onChange={(e) => {
                              const verts = [
                                ...((hitbox.data.vertices as { x: number; y: number }[]) ?? []),
                              ];
                              verts[vi] = { ...verts[vi], x: Number(e.target.value) };
                              handleUpdateHitbox(hitbox.id, {
                                data: { ...hitbox.data, vertices: verts },
                              });
                            }}
                            className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-12"
                          />
                          <Input
                            type="number"
                            value={vertex.y}
                            onChange={(e) => {
                              const verts = [
                                ...((hitbox.data.vertices as { x: number; y: number }[]) ?? []),
                              ];
                              verts[vi] = { ...verts[vi], y: Number(e.target.value) };
                              handleUpdateHitbox(hitbox.id, {
                                data: { ...hitbox.data, vertices: verts },
                              });
                            }}
                            className="h-4 text-[9px] bg-[#0d0d1a] border-[#1e1e3a] w-12"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-3 text-red-400"
                            onClick={() => {
                              const verts = (
                                (hitbox.data.vertices as { x: number; y: number }[]) ?? []
                              ).filter((_, i) => i !== vi);
                              handleUpdateHitbox(hitbox.id, {
                                data: { ...hitbox.data, vertices: verts },
                              });
                            }}
                          >
                            <X className="size-2" />
                          </Button>
                        </div>
                      )
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[8px] text-cyan-400 gap-0.5"
                      onClick={() => {
                        const verts = [
                          ...((hitbox.data.vertices as { x: number; y: number }[]) ?? []),
                          { x: 0, y: 0 },
                        ];
                        handleUpdateHitbox(hitbox.id, {
                          data: { ...hitbox.data, vertices: verts },
                        });
                      }}
                    >
                      <Plus className="size-2" /> 添加顶点
                    </Button>
                  </div>
                )}

                {/* Metadata editor */}
                <div className="mt-1.5 pt-1.5 border-t border-[#1e1e3a]/30">
                  <div className="flex items-center gap-1">
                    <Label className="text-[8px] text-gray-600">元数据</Label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-3 text-cyan-400"
                      onClick={() => {
                        const meta = { ...(hitbox.metadata ?? {}) };
                        const key = `key_${Object.keys(meta).length}`;
                        meta[key] = '';
                        handleUpdateHitbox(hitbox.id, { metadata: meta });
                      }}
                    >
                      <Plus className="size-2" />
                    </Button>
                  </div>
                  {hitbox.metadata &&
                    Object.entries(hitbox.metadata).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-1 mt-0.5">
                        <Input
                          value={key}
                          onChange={(e) => {
                            const meta = { ...hitbox.metadata! };
                            delete meta[key];
                            meta[e.target.value] = value;
                            handleUpdateHitbox(hitbox.id, { metadata: meta });
                          }}
                          className="h-4 text-[8px] bg-[#0d0d1a] border-[#1e1e3a] w-16"
                        />
                        <Input
                          value={String(value ?? '')}
                          onChange={(e) => {
                            const meta = { ...hitbox.metadata!, [key]: e.target.value };
                            handleUpdateHitbox(hitbox.id, { metadata: meta });
                          }}
                          className="h-4 text-[8px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-3 text-red-400"
                          onClick={() => {
                            const meta = { ...hitbox.metadata! };
                            delete meta[key];
                            handleUpdateHitbox(hitbox.id, { metadata: meta });
                          }}
                        >
                          <X className="size-2" />
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Palettes Tab
// ============================================================

function PalettesTab() {
  const palettes = useProjectStore((s) => s.palettes) ?? [];
  const activePaletteId = useProjectStore((s) => s.activePaletteId);
  const paletteConstrained = useEditorStore((s) => s.paletteConstrained);

  const [selectedPaletteId, setSelectedPaletteId] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<number | null>(null);
  const [swapTarget, setSwapTarget] = useState<number | null>(null);

  const selectedPalette = palettes.find((p) => p.id === selectedPaletteId) ?? null;

  const handleAddPalette = useCallback(() => {
    const store = useProjectStore.getState();
    store.pushUndo('添加调色板');
    const newPalette: PaletteData = {
      id: crypto.randomUUID(),
      name: `调色板_${(palettes.length ?? 0) + 1}`,
      colors: Array.from({ length: 16 }, (_, i) => ({
        color: null,
        label: `颜色_${i}`,
      })),
      swappableIndices: [],
    };
    useProjectStore.setState({
      palettes: [...(store.palettes ?? []), newPalette],
    });
    setSelectedPaletteId(newPalette.id);
  }, [palettes]);

  const handleDeletePalette = useCallback(() => {
    if (!selectedPaletteId) return;
    const store = useProjectStore.getState();
    store.pushUndo('删除调色板');
    useProjectStore.setState({
      palettes: (store.palettes ?? []).filter((p) => p.id !== selectedPaletteId),
      activePaletteId:
        store.activePaletteId === selectedPaletteId ? null : store.activePaletteId,
    });
    setSelectedPaletteId(null);
  }, [selectedPaletteId]);

  const handleUpdatePalette = useCallback(
    (paletteId: string, updates: Partial<PaletteData>) => {
      const store = useProjectStore.getState();
      useProjectStore.setState({
        palettes: (store.palettes ?? []).map((p) =>
          p.id === paletteId ? { ...p, ...updates } : p
        ),
      });
    },
    []
  );

  const handleSetColor = useCallback(
    (paletteId: string, index: number, color: string | null) => {
      const store = useProjectStore.getState();
      const palette = (store.palettes ?? []).find((p) => p.id === paletteId);
      if (!palette) return;
      const newColors = [...palette.colors];
      newColors[index] = { ...newColors[index], color };
      handleUpdatePalette(paletteId, { colors: newColors });
    },
    [handleUpdatePalette]
  );

  const handleToggleSwappable = useCallback(
    (paletteId: string, index: number) => {
      const store = useProjectStore.getState();
      const palette = (store.palettes ?? []).find((p) => p.id === paletteId);
      if (!palette) return;
      const swappable = [...(palette.swappableIndices ?? [])];
      const idx = swappable.indexOf(index);
      if (idx >= 0) {
        swappable.splice(idx, 1);
      } else {
        swappable.push(index);
      }
      handleUpdatePalette(paletteId, { swappableIndices: swappable });
    },
    [handleUpdatePalette]
  );

  const handlePaletteSwap = useCallback(() => {
    if (!selectedPalette || swapSource == null || swapTarget == null) return;
    const newColors = [...selectedPalette.colors];
    const temp = newColors[swapSource];
    newColors[swapSource] = newColors[swapTarget];
    newColors[swapTarget] = temp;
    handleUpdatePalette(selectedPalette.id, { colors: newColors });
    setSwapSource(null);
    setSwapTarget(null);
  }, [selectedPalette, swapSource, swapTarget, handleUpdatePalette]);

  return (
    <div className="space-y-3">
      {/* Palette selector */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-500 uppercase tracking-wider">调色板</Label>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-cyan-400"
              onClick={handleAddPalette}
              title="添加调色板"
            >
              <Plus className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-red-400"
              onClick={handleDeletePalette}
              disabled={!selectedPaletteId}
              title="删除调色板"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
        <select
          value={selectedPaletteId ?? ''}
          onChange={(e) => setSelectedPaletteId(e.target.value || null)}
          className="w-full h-7 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
        >
          <option value="">— 选择调色板 —</option>
          {palettes.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Palette constraint toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={paletteConstrained}
          onChange={(e) => {
            useEditorStore.setState({ paletteConstrained: e.target.checked });
          }}
          className="accent-cyan-500"
        />
        <Label className="text-[9px] text-gray-500">调色板约束绘制</Label>
      </div>

      {/* Color grid */}
      {selectedPalette && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-[9px] text-gray-500">名称</Label>
            <Input
              value={selectedPalette.name}
              onChange={(e) =>
                handleUpdatePalette(selectedPalette.id, { name: e.target.value })
              }
              className="h-5 text-[10px] bg-[#0d0d1a] border-[#1e1e3a] flex-1"
            />
          </div>

          <Label className="text-[9px] text-gray-500 uppercase tracking-wider">颜色</Label>
          <div className="grid grid-cols-8 gap-1">
            {selectedPalette.colors.map((slot, i) => {
              const isSwappable = selectedPalette.swappableIndices?.includes(i) ?? false;
              const isSwapSource = swapSource === i;
              const isSwapTarget = swapTarget === i;
              return (
                <div
                  key={i}
                  className={`relative group rounded border transition-colors cursor-pointer ${
                    isSwapSource
                      ? 'border-cyan-400 ring-1 ring-cyan-400/50'
                      : isSwapTarget
                      ? 'border-emerald-400 ring-1 ring-emerald-400/50'
                      : isSwappable
                      ? 'border-yellow-500/40'
                      : 'border-[#1e1e3a]'
                  }`}
                  style={{
                    backgroundColor: slot.color ?? '#1a1a2e',
                    width: 24,
                    height: 24,
                  }}
                  onClick={() => {
                    if (swapSource != null && swapTarget == null && swapSource !== i) {
                      setSwapTarget(i);
                    } else {
                      setSwapSource(swapSource === i ? null : i);
                      setSwapTarget(null);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleToggleSwappable(selectedPalette.id, i);
                  }}
                  title={`${slot.label}${isSwappable ? ' (可交换)' : ''}`}
                >
                  <input
                    type="color"
                    value={slot.color ?? '#000000'}
                    onChange={(e) => handleSetColor(selectedPalette.id, i, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="absolute bottom-0 right-0 text-[6px] text-white/50 font-mono">
                    {i}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Swap UI */}
          {selectedPalette.swappableIndices && selectedPalette.swappableIndices.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[9px] text-gray-500 uppercase tracking-wider">
                交换索引
              </Label>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-gray-500">源:</span>
                <span className="text-[9px] text-cyan-400">
                  {swapSource != null ? swapSource : '?'}
                </span>
                <span className="text-[9px] text-gray-500">→</span>
                <span className="text-[9px] text-emerald-400">
                  {swapTarget != null ? swapTarget : '?'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[8px] text-cyan-400 ml-2 gap-0.5"
                  onClick={handlePaletteSwap}
                  disabled={swapSource == null || swapTarget == null}
                >
                  <RefreshCw className="size-2.5" /> 交换
                </Button>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {selectedPalette.swappableIndices.map((idx) => (
                  <span
                    key={idx}
                    className="text-[8px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-500/80 border border-yellow-500/20"
                  >
                    {idx}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
