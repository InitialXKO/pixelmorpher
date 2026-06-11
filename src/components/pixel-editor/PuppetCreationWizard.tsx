'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Bone,
  Shirt,
  Film,
  User,
  Dog,
  Box,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type {
  PuppetSkeleton,
  PuppetNode,
  PuppetSocket,
  PuppetPlug,
  PuppetCharacter,
  CostumeSet,
  PuppetDirection,
} from '@/lib/types';
import { PUPPET_DIRECTIONS } from '@/lib/types';
import { generateDefaultCostumeSprite } from '@/lib/engine/default-costume-sprites';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

// ---- Template Definitions ----

interface TemplateNodeDef {
  name: string;
  sockets: { name: string; localX: number; localY: number }[];
  plug: { socketName: string; localX: number; localY: number } | null;
  defaultAngle: number;
  defaultStretch: number;
  defaultOffsetX: number;
  defaultOffsetY: number;
  crossSectionTop: number;
  crossSectionBottom: number;
  zIndex: number;
}

interface PuppetTemplate {
  name: string;
  label: string;
  icon: React.ReactNode;
  nodes: TemplateNodeDef[];
}

const HUMANOID_TEMPLATE: PuppetTemplate = {
  name: 'humanoid',
  label: '人形',
  icon: <User className="size-4" />,
  nodes: [
    {
      name: 'torso', sockets: [
        { name: 'neck', localX: 0, localY: -2 },
        { name: 'shoulder_L', localX: -5, localY: 0 },
        { name: 'shoulder_R', localX: 5, localY: 0 },
        { name: 'hip_L', localX: -3, localY: 16 },
        { name: 'hip_R', localX: 3, localY: 16 },
      ], plug: null, defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 8, crossSectionBottom: 6, zIndex: 5,
    },
    {
      name: 'head', sockets: [], plug: { socketName: 'neck', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 6, crossSectionBottom: 5, zIndex: 10,
    },
    {
      name: 'upper_arm_L', sockets: [{ name: 'elbow_L', localX: 0, localY: 12 }],
      plug: { socketName: 'shoulder_L', localX: 0, localY: 0 },
      defaultAngle: 10, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 3, zIndex: 6,
    },
    {
      name: 'lower_arm_L', sockets: [],
      plug: { socketName: 'elbow_L', localX: 0, localY: 0 },
      defaultAngle: -5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 7,
    },
    {
      name: 'upper_arm_R', sockets: [{ name: 'elbow_R', localX: 0, localY: 12 }],
      plug: { socketName: 'shoulder_R', localX: 0, localY: 0 },
      defaultAngle: -10, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 3, zIndex: 4,
    },
    {
      name: 'lower_arm_R', sockets: [],
      plug: { socketName: 'elbow_R', localX: 0, localY: 0 },
      defaultAngle: 5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'upper_leg_L', sockets: [{ name: 'knee_L', localX: 0, localY: 12 }],
      plug: { socketName: 'hip_L', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 4, crossSectionBottom: 3, zIndex: 2,
    },
    {
      name: 'lower_leg_L', sockets: [],
      plug: { socketName: 'knee_L', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 2, zIndex: 1,
    },
    {
      name: 'upper_leg_R', sockets: [{ name: 'knee_R', localX: 0, localY: 12 }],
      plug: { socketName: 'hip_R', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 4, crossSectionBottom: 3, zIndex: 2,
    },
    {
      name: 'lower_leg_R', sockets: [],
      plug: { socketName: 'knee_R', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 2, zIndex: 1,
    },
  ],
};

const QUADRUPED_TEMPLATE: PuppetTemplate = {
  name: 'quadruped',
  label: '四足',
  icon: <Dog className="size-4" />,
  nodes: [
    {
      name: 'body', sockets: [
        { name: 'head_attach', localX: 0, localY: -4 },
        { name: 'tail_attach', localX: 3, localY: 2 },
        { name: 'front_leg_L', localX: -7, localY: 3 },
        { name: 'front_leg_R', localX: -3, localY: 3 },
        { name: 'back_leg_L', localX: 2, localY: 3 },
        { name: 'back_leg_R', localX: 5, localY: 3 },
      ], plug: null, defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 8, crossSectionBottom: 8, zIndex: 5,
    },
    {
      name: 'head', sockets: [],
      plug: { socketName: 'head_attach', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 5, crossSectionBottom: 4, zIndex: 10,
    },
    {
      name: 'tail', sockets: [],
      plug: { socketName: 'tail_attach', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 1, zIndex: 4,
    },
    {
      name: 'front_leg_L', sockets: [],
      plug: { socketName: 'front_leg_L', localX: 0, localY: 0 },
      defaultAngle: 5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'front_leg_R', sockets: [],
      plug: { socketName: 'front_leg_R', localX: 0, localY: 0 },
      defaultAngle: -5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 2,
    },
    {
      name: 'back_leg_L', sockets: [],
      plug: { socketName: 'back_leg_L', localX: 0, localY: 0 },
      defaultAngle: 5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'back_leg_R', sockets: [],
      plug: { socketName: 'back_leg_R', localX: 0, localY: 0 },
      defaultAngle: -5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 2,
    },
  ],
};

const SIMPLE_TEMPLATE: PuppetTemplate = {
  name: 'simple',
  label: '简单',
  icon: <Box className="size-4" />,
  nodes: [
    {
      name: 'body', sockets: [
        { name: 'head_attach', localX: 0, localY: -2 },
      ], plug: null, defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 6, crossSectionBottom: 6, zIndex: 5,
    },
    {
      name: 'head', sockets: [],
      plug: { socketName: 'head_attach', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 5, crossSectionBottom: 4, zIndex: 10,
    },
  ],
};

const TEMPLATES: PuppetTemplate[] = [HUMANOID_TEMPLATE, QUADRUPED_TEMPLATE, SIMPLE_TEMPLATE];

// ---- Node Colors ----
const NODE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f43f5e', '#a855f7',
];

// ---- Props ----

interface PuppetCreationWizardProps {
  open: boolean;
  onClose: () => void;
}

// ---- Component ----

export default function PuppetCreationWizard({ open, onClose }: PuppetCreationWizardProps) {
  const parts = useProjectStore((s) => s.parts);
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];
  const addAnimationClip = useProjectStore((s) => s.addAnimationClip);

  const [step, setStep] = useState(0);
  const [characterName, setCharacterName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<PuppetTemplate>(HUMANOID_TEMPLATE);
  const [spriteAssignments, setSpriteAssignments] = useState<Record<string, string | null>>({});
  const [createClip, setCreateClip] = useState(true);
  const [clipName, setClipName] = useState('');

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setCharacterName('');
      setSelectedTemplate(HUMANOID_TEMPLATE);
      setSpriteAssignments({});
      setCreateClip(true);
      setClipName('');
    }
  }, [open]);

  const handleNext = useCallback(() => setStep((s) => Math.min(s + 1, 2)), []);
  const handlePrev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  const handleAssignSprite = useCallback((nodeName: string, partId: string | null) => {
    setSpriteAssignments((prev) => ({ ...prev, [nodeName]: partId }));
  }, []);

  const handleCreate = useCallback(() => {
    const store = useProjectStore.getState();
    store.pushUndo('创建木偶角色');

    // ---- Generate default costume sprites for nodes without manual assignments ----
    // For each template node that has no user-assigned sprite, auto-create a Part
    // with a prefabricated default pixel art sprite.
    const autoGeneratedPartIds: Record<string, string> = {};
    for (const def of selectedTemplate.nodes) {
      if (!spriteAssignments[def.name]) {
        const nodeColor = NODE_COLORS[selectedTemplate.nodes.indexOf(def) % NODE_COLORS.length];
        const spriteResult = generateDefaultCostumeSprite(def.name, selectedTemplate.name, nodeColor);
        // Create the Part in the store with correct pivot (at the attachment point, not center)
        const part = store.addPart(
          `${characterName || '角色'}_${spriteResult.partName}`,
          spriteResult.width,
          spriteResult.height,
          { pivotX: spriteResult.pivotX, pivotY: spriteResult.pivotY },
        );
        // Paint the default sprite pixels onto the part
        store.setPartPixels(part.id, spriteResult.pixels);
        autoGeneratedPartIds[def.name] = part.id;
      }
    }

    // Build skeleton nodes
    const nodeIdMap: Record<string, string> = {};
    const socketIdMap: Record<string, string> = {};

    // First pass: create node IDs
    for (const def of selectedTemplate.nodes) {
      nodeIdMap[def.name] = crypto.randomUUID();
      for (const sock of def.sockets) {
        socketIdMap[`${def.name}:${sock.name}`] = crypto.randomUUID();
      }
    }

    // Second pass: build full nodes
    const builtNodes: PuppetNode[] = selectedTemplate.nodes.map((def, idx) => {
      const sockets: PuppetSocket[] = def.sockets.map((sock) => ({
        id: socketIdMap[`${def.name}:${sock.name}`],
        name: sock.name,
        localX: sock.localX,
        localY: sock.localY,
      }));

      let plug: PuppetPlug | null = null;
      if (def.plug) {
        // Find the parent node that has the socket
        const parentNodeDef = selectedTemplate.nodes.find((n) =>
          n.sockets.some((s) => s.name === def.plug!.socketName)
        );
        if (parentNodeDef) {
          const socketId = socketIdMap[`${parentNodeDef.name}:${def.plug!.socketName}`];
          plug = {
            socketId,
            localX: def.plug.localX,
            localY: def.plug.localY,
          };
        }
      }

      // Resolve sprite: user assignment > auto-generated default
      const assignedPartId = spriteAssignments[def.name] ?? autoGeneratedPartIds[def.name] ?? null;

      // mirrorFrom should only be true for LEFT-side limbs that mirror from right-side.
      // Convention: node names ending with '_L' are left-side limbs.
      const isLeftLimb = def.name.endsWith('_L');

      return {
        id: nodeIdMap[def.name],
        name: def.name,
        sockets,
        plug,
        spritePartId: assignedPartId,
        directionSprites: {},
        mirrorFrom: isLeftLimb,
        angle: def.defaultAngle,
        stretch: def.defaultStretch,
        offsetX: def.defaultOffsetX,
        offsetY: def.defaultOffsetY,
        crossSectionTop: def.crossSectionTop,
        crossSectionBottom: def.crossSectionBottom,
        zIndex: def.zIndex,
        visible: true,
        color: NODE_COLORS[idx % NODE_COLORS.length],
      };
    });

    // Create skeleton
    const skeleton: PuppetSkeleton = {
      id: crypto.randomUUID(),
      name: `${characterName || '角色'}_骨骼`,
      nodes: builtNodes,
      currentDirection: 'S',
      viewLatitude: 0,
    };

    // Create default costume set
    const costumeSet: CostumeSet = {
      id: crypto.randomUUID(),
      name: '默认服装',
      spriteMap: {},
    };
    // Populate sprite map from ALL sprite assignments (both manual and auto-generated)
    const allSpriteAssignments: Record<string, string | null> = {};
    for (const def of selectedTemplate.nodes) {
      allSpriteAssignments[def.name] = spriteAssignments[def.name] ?? autoGeneratedPartIds[def.name] ?? null;
    }
    for (const [nodeName, partId] of Object.entries(allSpriteAssignments)) {
      if (partId) {
        const node = builtNodes.find((n) => n.name === nodeName);
        if (node) {
          for (const dir of PUPPET_DIRECTIONS) {
            costumeSet.spriteMap[`${node.id}:${dir}`] = partId;
          }
        }
      }
    }

    // Create character
    const character: PuppetCharacter = {
      id: crypto.randomUUID(),
      name: characterName || '新角色',
      puppetSkeletonId: skeleton.id,
      costumeSets: [costumeSet],
      activeCostumeSetId: costumeSet.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Update store state
    const currentSkeletons = store.puppetSkeletons ?? [];
    const currentCharacters = store.puppetCharacters ?? [];
    useProjectStore.setState({
      puppetSkeletons: [...currentSkeletons, skeleton],
      puppetCharacters: [...currentCharacters, character],
    });

    // Optionally create animation clip
    if (createClip) {
      const name = clipName || `${character.name}_动画`;
      const clip = addAnimationClip(name);
      useProjectStore.setState((s) => ({
        animationClips: s.animationClips.map((c) =>
          c.id === clip.id
            ? { ...c, isPuppetClip: true, puppetCharacterId: character.id }
            : c
        ),
      }));
    }

    onClose();
  }, [characterName, selectedTemplate, spriteAssignments, createClip, clipName, addAnimationClip, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#0d0d1a] border border-[#1e1e3a] rounded-lg shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e3a]">
          <h3 className="text-sm font-semibold text-gray-200">创建木偶角色</h3>
          <Button variant="ghost" size="icon" className="size-6 text-gray-400" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e1e3a]/50">
          {[
            { label: '名称与模板', icon: <Bone className="size-3" /> },
            { label: '分配精灵', icon: <Shirt className="size-3" /> },
            { label: '确认创建', icon: <Check className="size-3" /> },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="size-3 text-gray-600" />}
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium ${
                  i === step
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : i < step
                    ? 'text-emerald-400'
                    : 'text-gray-600'
                }`}
              >
                {s.icon}
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4">
            {/* Step 0: Name & Template */}
            {step === 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">角色名称</Label>
                  <Input
                    value={characterName}
                    onChange={(e) => setCharacterName(e.target.value)}
                    placeholder="输入角色名称..."
                    className="h-8 text-sm bg-[#0d0d1a] border-[#1e1e3a] text-gray-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">选择模板</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.name}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-md border transition-colors ${
                          selectedTemplate.name === tmpl.name
                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                            : 'bg-[#111128] border-[#1e1e3a] text-gray-400 hover:border-gray-600'
                        }`}
                        onClick={() => setSelectedTemplate(tmpl)}
                      >
                        {tmpl.icon}
                        <span className="text-[11px] font-medium">{tmpl.label}</span>
                        <span className="text-[9px] text-gray-500">{tmpl.nodes.length} 节点</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">模板节点预览</Label>
                  <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2 max-h-40 overflow-y-auto">
                    {selectedTemplate.nodes.map((node, idx) => (
                      <div key={node.name} className="flex items-center gap-2 py-0.5">
                        <div
                          className="size-2 rounded-full"
                          style={{ backgroundColor: NODE_COLORS[idx % NODE_COLORS.length] }}
                        />
                        <span className="text-[10px] text-gray-300">{node.name}</span>
                        <span className="text-[9px] text-gray-600">
                          {node.sockets.length > 0 ? `${node.sockets.length} 插口` : '叶节点'}
                          {node.plug ? ` · 插入 ${node.plug.socketName}` : ' · 根节点'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: Assign Sprites */}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-[10px] text-gray-500">
                  为每个节点分配精灵部件（可选，未分配的节点将自动生成默认服装精灵）
                </p>
                {selectedTemplate.nodes.map((nodeDef) => (
                  <div
                    key={nodeDef.name}
                    className="flex items-center gap-2 p-2 rounded bg-[#111128] border border-[#1e1e3a]"
                  >
                    <span className="text-[11px] text-gray-300 w-24 truncate">{nodeDef.name}</span>
                    <select
                      value={spriteAssignments[nodeDef.name] ?? ''}
                      onChange={(e) =>
                        handleAssignSprite(nodeDef.name, e.target.value || null)
                      }
                      className="flex-1 h-7 text-[10px] bg-[#0d0d1a] border border-[#1e1e3a] rounded px-2 text-gray-300"
                    >
                      <option value="">— 未分配 —</option>
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.width}×{p.height})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* Step 2: Review & Create */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">创建摘要</Label>
                  <div className="bg-[#080818] rounded border border-[#1e1e3a] p-3 space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">角色名称</span>
                      <span className="text-gray-300">{characterName || '未命名'}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">模板</span>
                      <span className="text-gray-300">{selectedTemplate.label} ({selectedTemplate.nodes.length} 节点)</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">手动分配精灵</span>
                      <span className="text-gray-300">
                        {Object.values(spriteAssignments).filter(Boolean).length} / {selectedTemplate.nodes.length}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">自动生成精灵</span>
                      <span className="text-cyan-400">
                        {selectedTemplate.nodes.length - Object.values(spriteAssignments).filter(Boolean).length} 个节点
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createClip}
                    onChange={(e) => setCreateClip(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <Label className="text-[11px] text-gray-400">同时创建动画片段</Label>
                </div>
                {createClip && (
                  <div className="space-y-1.5 ml-5">
                    <Label className="text-[10px] text-gray-500">片段名称</Label>
                    <Input
                      value={clipName}
                      onChange={(e) => setClipName(e.target.value)}
                      placeholder={`${characterName || '角色'}_动画`}
                      className="h-7 text-xs bg-[#0d0d1a] border-[#1e1e3a] text-gray-200"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">节点一览</Label>
                  <div className="bg-[#080818] rounded border border-[#1e1e3a] p-2 max-h-32 overflow-y-auto">
                    {selectedTemplate.nodes.map((nodeDef, idx) => {
                      const assignedPart = spriteAssignments[nodeDef.name]
                        ? parts.find((p) => p.id === spriteAssignments[nodeDef.name])
                        : null;
                      const willAutoGenerate = !spriteAssignments[nodeDef.name];
                      return (
                        <div key={nodeDef.name} className="flex items-center gap-2 py-0.5">
                          <div
                            className="size-2 rounded-full"
                            style={{ backgroundColor: NODE_COLORS[idx % NODE_COLORS.length] }}
                          />
                          <span className="text-[10px] text-gray-300 flex-1">{nodeDef.name}</span>
                          <span className={`text-[9px] ${willAutoGenerate ? 'text-cyan-500' : 'text-gray-500'}`}>
                            {assignedPart ? assignedPart.name : '自动生成默认精灵'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e3a]">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-gray-400"
            onClick={step === 0 ? onClose : handlePrev}
          >
            {step === 0 ? '取消' : <><ArrowLeft className="size-3 mr-1" /> 上一步</>}
          </Button>
          {step < 2 ? (
            <Button
              size="sm"
              className="text-xs bg-cyan-600 hover:bg-cyan-500"
              onClick={handleNext}
              disabled={step === 0 && !characterName.trim()}
            >
              下一步 <ArrowRight className="size-3 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="text-xs bg-emerald-600 hover:bg-emerald-500"
              onClick={handleCreate}
            >
              <Check className="size-3 mr-1" /> 创建角色
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
