'use client';

import React, { useState, useMemo } from 'react';
import {
  Users,
  Bone,
  Shirt,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Image,
  Film,
} from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetCharacter,
  CostumeSet,
  PuppetDirection,
} from '@/lib/types';
import PuppetCreationWizard from './PuppetCreationWizard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

// ============================================================
// PuppetAssetPanel — Left panel for puppet mode
// Browses puppet characters, skeletons, sprite parts, and clips
// ============================================================

export default function PuppetAssetPanel() {
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const parts = useProjectStore((s) => s.parts);
  const animationClips = useProjectStore((s) => s.animationClips);
  const activeAnimationClipId = useProjectStore((s) => s.activeAnimationClipId);
  const setActiveAnimationClip = useProjectStore((s) => s.setActiveAnimationClip);

  const showPuppetSkeleton = useEditorStore((s) => s.showPuppetSkeleton);
  const togglePuppetSkeleton = useEditorStore((s) => s.togglePuppetSkeleton);
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const setActivePuppetSkeletonId = useEditorStore((s) => s.setActivePuppetSkeletonId);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [expandedChars, setExpandedChars] = useState<Set<string>>(new Set());
  const [sectionExpanded, setSectionExpanded] = useState({
    characters: true,
    sprites: true,
    clips: true,
  });

  const puppetClips = useMemo(
    () => animationClips.filter((c) => c.isPuppetClip),
    [animationClips]
  );

  const toggleCharExpand = (id: string) => {
    setExpandedChars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (key: keyof typeof sectionExpanded) => {
    setSectionExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-[#1e1e3a]">
        <Users className="size-3.5 text-cyan-400" />
        <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider flex-1">
          木偶资产
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-cyan-400 hover:text-cyan-300"
          onClick={() => setWizardOpen(true)}
          title="创建木偶角色"
        >
          <Plus className="size-3" />
        </Button>
      </div>

      <PuppetCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">

          {/* ---- Characters Section ---- */}
          <div>
            <button
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
              onClick={() => toggleSection('characters')}
            >
              {sectionExpanded.characters ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              <Users className="size-2.5" />
              角色 ({puppetCharacters.length})
            </button>

            {sectionExpanded.characters && (
              <div className="space-y-0.5 mt-0.5">
                {puppetCharacters.length === 0 ? (
                  <div className="text-center py-4 px-2">
                    <Users className="size-5 text-gray-700 mx-auto mb-1" />
                    <p className="text-[9px] text-gray-600 mb-2">尚无木偶角色</p>
                    <Button
                      size="sm"
                      className="text-[9px] h-6 bg-cyan-600 hover:bg-cyan-500"
                      onClick={() => setWizardOpen(true)}
                    >
                      <Plus className="size-2.5 mr-0.5" /> 创建角色
                    </Button>
                  </div>
                ) : (
                  puppetCharacters.map((char) => {
                    const skeleton = puppetSkeletons.find(
                      (s) => s.id === char.puppetSkeletonId
                    );
                    const isExpanded = expandedChars.has(char.id);
                    const clip = puppetClips.find(
                      (c) => c.puppetCharacterId === char.id
                    );
                    const isActive =
                      activePuppetSkeletonId === skeleton?.id;

                    return (
                      <div key={char.id}>
                        <div
                          className={`flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-cyan-500/15 text-cyan-300'
                              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                          }`}
                          onClick={() => {
                            if (skeleton) {
                              setActivePuppetSkeletonId(skeleton.id);
                              togglePuppetSkeleton();
                            }
                            toggleCharExpand(char.id);
                          }}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-2.5 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="size-2.5 flex-shrink-0" />
                          )}
                          <Shirt className="size-2.5 text-cyan-500/70 flex-shrink-0" />
                          <span className="text-[10px] truncate flex-1">
                            {char.name}
                          </span>
                          <span className="text-[8px] text-gray-600">
                            {skeleton?.nodes.length ?? 0} 节点
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="ml-4 space-y-0.5 mt-0.5">
                            {/* Skeleton info */}
                            {skeleton && (
                              <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-gray-500">
                                <Bone className="size-2" />
                                <span className="truncate">
                                  {skeleton.name}
                                </span>
                                <span className="text-gray-700">
                                  方向: {skeleton.currentDirection}
                                </span>
                              </div>
                            )}
                            {/* Costume sets */}
                            {char.costumeSets.map((cs) => (
                              <div
                                key={cs.id}
                                className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-gray-500"
                              >
                                <Shirt className="size-2" />
                                <span className="truncate">{cs.name}</span>
                                <span className="text-gray-700">
                                  {Object.keys(cs.spriteMap).length} 映射
                                </span>
                              </div>
                            ))}
                            {/* Linked clip */}
                            {clip && (
                              <div className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-gray-500">
                                <Film className="size-2" />
                                <span className="truncate">{clip.name}</span>
                                <span className="text-gray-700">
                                  {(clip.puppetNodeKeyframes ?? []).length} K帧
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <Separator className="bg-[#1e1e3a]" />

          {/* ---- Sprite Parts Section ---- */}
          <div>
            <button
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
              onClick={() => toggleSection('sprites')}
            >
              {sectionExpanded.sprites ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              <Image className="size-2.5" />
              精灵部件 ({parts.length})
            </button>

            {sectionExpanded.sprites && (
              <div className="space-y-0.5 mt-0.5 max-h-32 overflow-y-auto">
                {parts.map((part) => (
                  <div
                    key={part.id}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded cursor-pointer transition-colors"
                  >
                    <div className="size-2 rounded-sm border border-gray-700 bg-gray-800 flex-shrink-0" />
                    <span className="truncate flex-1">{part.name}</span>
                    <span className="text-gray-700">
                      {part.width}x{part.height}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator className="bg-[#1e1e3a]" />

          {/* ---- Puppet Clips Section ---- */}
          <div>
            <button
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
              onClick={() => toggleSection('clips')}
            >
              {sectionExpanded.clips ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              <Film className="size-2.5" />
              木偶片段 ({puppetClips.length})
            </button>

            {sectionExpanded.clips && (
              <div className="space-y-0.5 mt-0.5">
                {puppetClips.length === 0 ? (
                  <p className="text-[9px] text-gray-700 text-center py-2">
                    尚无木偶动画片段
                  </p>
                ) : (
                  puppetClips.map((clip) => {
                    const char = puppetCharacters.find(
                      (c) => c.id === clip.puppetCharacterId
                    );
                    return (
                      <div
                        key={clip.id}
                        className={`flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                          activeAnimationClipId === clip.id
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                        onClick={() => setActiveAnimationClip(clip.id)}
                      >
                        <Film className="size-2.5 text-amber-500/70 flex-shrink-0" />
                        <span className="text-[10px] truncate flex-1">
                          {clip.name}
                        </span>
                        <span className="text-[8px] text-gray-600">
                          {(clip.puppetNodeKeyframes ?? []).length} K帧
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* ---- Skeleton Overlay Toggle ---- */}
          <Separator className="bg-[#1e1e3a]" />
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <button
              className={`flex items-center gap-1.5 text-[10px] transition-colors ${
                showPuppetSkeleton
                  ? 'text-cyan-400'
                  : 'text-gray-600 hover:text-gray-300'
              }`}
              onClick={togglePuppetSkeleton}
            >
              {showPuppetSkeleton ? (
                <Eye className="size-3" />
              ) : (
                <EyeOff className="size-3" />
              )}
              骨骼叠加显示
            </button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
