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
import { NodeTreeItemWrapper } from './puppet/NodeTree';
import type {
  PuppetSkeleton,
  PuppetCharacter,
  CostumeSet,
  PuppetDirection,
} from '@/lib/types';
import PuppetCreationWizard from './PuppetCreationWizard';
import RefAssemblyWizard from './puppet/RefAssemblyWizard';
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
  const refWizardOpen = useEditorStore((s) => s.refWizardOpen);
  const setRefWizardOpen = useEditorStore((s) => s.setRefWizardOpen);
  const [expandedChars, setExpandedChars] = useState<Set<string>>(new Set());
  const [sectionExpanded, setSectionExpanded] = useState({
    characters: true,
    nodes: true,
    sprites: true,
    clips: true,
  });
  // 添加节点对话框：选父节点+插槽
  const [addNodeDialog, setAddNodeDialog] = useState<{
    parentNodeId: string;
    socketId: string;
  } | null>(null);

  const puppetClips = animationClips;

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
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-amber-400 hover:text-amber-300"
          onClick={() => setRefWizardOpen(true)}
          title="从参考图装配"
        >
          <Image className="size-3" />
        </Button>
      </div>

      <PuppetCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      {refWizardOpen ? (
        <div className="flex-1 min-h-0">
          <RefAssemblyWizard
            onClose={() => {
              const store = useEditorStore.getState();
              // 清理：退出遮罩锁定，隐藏参考图
              if (store.editMode === 'mask') {
                store.setEditMode('normal');
                store.setMaskNodeId(null);
              }
              // 不清除 referenceImageUrl，用户可能还想看；但隐藏
              store.setReferenceImageVisible(false);
              setRefWizardOpen(false);
            }}
          />
        </div>
      ) : (
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
                          className={`group flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-cyan-500/15 text-cyan-300'
                              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                          }`}
                          onClick={() => {
                            if (skeleton) {
                              setActivePuppetSkeletonId(skeleton.id);
                              // 只开不关：避免点另一个角色时把骨骼显示关掉
                              if (!useEditorStore.getState().showPuppetSkeleton) {
                                togglePuppetSkeleton();
                              }
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
                          <span className="text-[10px] truncate flex-1 min-w-0">
                            {char.name}
                          </span>
                          <span className="text-[8px] text-gray-600">
                            {skeleton?.nodes.length ?? 0} 节点
                          </span>
                          <button
                            className="opacity-0 group-hover:opacity-100 hover:text-red-400 text-gray-600 transition-opacity"
                            title="删除角色"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`确定删除角色「${char.name}」吗？其骨架、服装和动画片段将一并删除，此操作不可撤销。`)) {
                                useProjectStore.getState().removePuppetCharacter(char.id);
                              }
                            }}
                          >
                            <Trash2 className="size-2.5" />
                          </button>
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

          {/* ---- Node Tree Section (共享，右侧三段共用) ---- */}
          <div>
            <div className="flex items-center gap-1">
              <button
                className="flex items-center gap-1 flex-1 px-1 py-1 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors"
                onClick={() => toggleSection('nodes')}
              >
                {sectionExpanded.nodes ? (
                  <ChevronDown className="size-2.5" />
                ) : (
                  <ChevronRight className="size-2.5" />
                )}
                <Bone className="size-2.5" />
                节点树
              </button>
              {/* 增删节点 */}
              {activePuppetSkeletonId && (() => {
                const skel = puppetSkeletons.find((s) => s.id === activePuppetSkeletonId);
                const dir = skel?.currentDirection ?? 'S';
                return (
                <>
                  {/* 方向选择 */}
                  <select
                    value={dir}
                    onChange={(e) => {
                      useProjectStore.getState().setPuppetDirection(activePuppetSkeletonId, e.target.value as any);
                    }}
                    className="h-5 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded px-1 text-gray-300"
                    title="切换方向"
                  >
                    <option value="S">南</option>
                    <option value="N">北</option>
                    <option value="E">东</option>
                    <option value="W">西</option>
                    <option value="NE">东北</option>
                    <option value="SE">东南</option>
                    <option value="SW">西南</option>
                    <option value="NW">西北</option>
                  </select>
                  <button
                    className="size-5 flex items-center justify-center text-cyan-400 hover:text-cyan-300"
                    title="添加节点（选择父节点插槽）"
                    onClick={() => {
                      const skel = puppetSkeletons.find((s) => s.id === activePuppetSkeletonId);
                      if (!skel || skel.nodes.length === 0) {
                        // 没有节点时直接创建根节点
                        const store = useProjectStore.getState();
                        const newNode = store.addPuppetNode(activePuppetSkeletonId, `节点_1`, {
                          mirrorFrom: false,
                          crossSectionTop: 4,
                          crossSectionBottom: 3,
                          zIndex: 0,
                        });
                        store.setSelectedPuppetNodeId(newNode.id);
                        return;
                      }
                      // 默认选第一个节点的第一个插槽
                      const firstNode = skel.nodes[0];
                      setAddNodeDialog({
                        parentNodeId: firstNode.id,
                        socketId: firstNode.sockets[0]?.id ?? '',
                      });
                    }}
                  >
                    <Plus className="size-3" />
                  </button>
                  <button
                    className="size-5 flex items-center justify-center text-red-400 hover:text-red-300"
                    title="删除选中节点"
                    onClick={() => {
                      const store = useProjectStore.getState();
                      const nodeId = store.selectedPuppetNodeId;
                      if (!nodeId) return;
                      if (!confirm('确定删除该节点吗？')) return;
                      store.removePuppetNode(activePuppetSkeletonId, nodeId);
                      store.setSelectedPuppetNodeId(null);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
                );
              })()}
            </div>
            {sectionExpanded.nodes && (() => {
              const activeSkeleton = puppetSkeletons.find((sk) => sk.id === activePuppetSkeletonId);
              const selectedNodeId = useProjectStore.getState().selectedPuppetNodeId;
              if (!activeSkeleton) {
                return <p className="text-[9px] text-gray-600 px-1 py-1">先选择骨架</p>;
              }
              return (
                <div className="bg-[#080818] rounded border border-[#1e1e3a] p-1 max-h-64 overflow-y-auto mt-1">
                  {activeSkeleton.nodes
                    .filter((node) => !node.plug)
                    .map((node) => (
                      <NodeTreeItemWrapper
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedNodeId={selectedNodeId}
                        onSelect={(id) => {
                          useProjectStore.getState().setSelectedPuppetNodeId(id);
                        }}
                        allNodes={activeSkeleton.nodes}
                      />
                    ))}
                </div>
              );
            })()}
          </div>

          {/* 添加节点对话框 */}
          {addNodeDialog && (() => {
            const skel = puppetSkeletons.find((s) => s.id === activePuppetSkeletonId);
            if (!skel) return null;
            const parentNode = skel.nodes.find((n) => n.id === addNodeDialog.parentNodeId);
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddNodeDialog(null)}>
                <div className="bg-[#0d0d1a] border border-[#1e1e3a] rounded p-4 w-64 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-xs font-medium text-gray-200">添加节点</h3>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">父节点</label>
                    <select
                      value={addNodeDialog.parentNodeId}
                      onChange={(e) => {
                        const pid = e.target.value;
                        const pnode = skel.nodes.find((n) => n.id === pid);
                        setAddNodeDialog({ parentNodeId: pid, socketId: pnode?.sockets[0]?.id ?? '' });
                      }}
                      className="w-full h-7 text-[11px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
                    >
                      {skel.nodes.map((n) => (
                        <option key={n.id} value={n.id}>{n.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">插槽</label>
                    <select
                      value={addNodeDialog.socketId}
                      onChange={(e) => setAddNodeDialog({ ...addNodeDialog, socketId: e.target.value })}
                      className="w-full h-7 text-[11px] bg-[#111128] border border-[#1e1e3a] rounded px-2 text-gray-300"
                    >
                      {(parentNode?.sockets ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name || s.id.slice(0, 8)}</option>
                      ))}
                      {(parentNode?.sockets ?? []).length === 0 && (
                        <option value="">（无插槽，将创建为根节点）</option>
                      )}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      className="px-3 h-7 text-[11px] text-gray-400 hover:text-gray-200"
                      onClick={() => setAddNodeDialog(null)}
                    >
                      取消
                    </button>
                    <button
                      className="px-3 h-7 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white rounded"
                      onClick={() => {
                        const store = useProjectStore.getState();
                        const nodeName = `节点_${skel.nodes.length + 1}`;
                        const plug = addNodeDialog.socketId
                          ? { socketId: addNodeDialog.socketId, localX: 0, localY: 0 }
                          : undefined;
                        const newNode = store.addPuppetNode(activePuppetSkeletonId!, nodeName, {
                          mirrorFrom: false,
                          crossSectionTop: 4,
                          crossSectionBottom: 3,
                          zIndex: 0,
                          ...(plug ? { plug } : {}),
                        });
                        store.setSelectedPuppetNodeId(newNode.id);
                        setAddNodeDialog(null);
                      }}
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

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
                    className="group flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded cursor-pointer transition-colors"
                  >
                    <div className="size-2 rounded-sm border border-gray-700 bg-gray-800 flex-shrink-0" />
                    <span className="truncate flex-1 min-w-0">{part.name}</span>
                    <span className="text-gray-700">
                      {part.width}x{part.height}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-white"
                      title="编辑像素"
                      onClick={(e) => {
                        e.stopPropagation();
                        useEditorStore.getState().enterPartEditMode(part.id);
                      }}
                    >
                      ✏️
                    </button>
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
                        <span className="text-[10px] truncate flex-1 min-w-0">
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
      )}
    </div>
  );
}
