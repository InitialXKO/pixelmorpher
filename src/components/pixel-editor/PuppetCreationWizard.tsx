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
  Bot,
  Shield,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type {
  PuppetDirection,
} from '@/lib/types';
import { PUPPET_DIRECTIONS } from '@/lib/types';
import { generateDefaultCostumeSprite, generateDefaultCostumeSideSprite, type DefaultSpriteResult } from '@/lib/engine/default-costume-sprites';
import { applyJointOpenings, type JointOpeningSpec } from '@/lib/engine/render-helpers/puppet-joint-color';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

export type { TemplateNodeDef };

interface PuppetTemplate {
  name: string;
  label: string;
  icon: React.ReactNode;
  nodes: TemplateNodeDef[];
}

export type { PuppetTemplate };

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

// ---- 测试用纯上半身模板（全新编写，不抄老模板） ----
const TEST_UPPER_BODY_TEMPLATE: PuppetTemplate = {
  name: 'test_upper_body',
  label: '测试上半身',
  icon: <User className="size-4" />,
  nodes: [
    {
      name: 'torso', sockets: [
        { name: 'neck', localX: 0, localY: -2 },
        { name: 'shoulderA', localX: -5, localY: 0 },
        { name: 'shoulderB', localX: 5, localY: 0 },
      ], plug: null, defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 8, crossSectionBottom: 6, zIndex: 5,
    },
    {
      name: 'head', sockets: [], plug: { socketName: 'neck', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 6, crossSectionBottom: 5, zIndex: 10,
    },
    {
      name: 'armA', sockets: [], plug: { socketName: 'shoulderA', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 3, zIndex: 6,
    },
    {
      name: 'armB', sockets: [], plug: { socketName: 'shoulderB', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 3, zIndex: 4,
    },
  ],
};

// ---- Additional character templates (full sprite sets) ----

/** Shallow-copy node defs so templates never share mutable arrays */
function cloneNodes(nodes: TemplateNodeDef[]): TemplateNodeDef[] {
  return nodes.map((n) => ({ ...n, sockets: n.sockets.map((s) => ({ ...s })) }));
}

/**
 * 机甲：与人形相同的 10 节点骨骼，机甲风精灵（装甲 + 反应堆 + 能量条纹）。
 * 精灵分发见 generateDefaultCostumeSprite(templateName='mecha')。
 */
const MECHA_TEMPLATE: PuppetTemplate = {
  ...HUMANOID_TEMPLATE,
  name: 'mecha',
  label: '机甲',
  icon: <Bot className="size-4" />,
  nodes: cloneNodes(HUMANOID_TEMPLATE.nodes),
};

/**
 * 小狗：13 节点。四肢为两段式（大腿+小腿，膝关节可动）+ 独立耳朵。
 */
export const DOG_TEMPLATE: PuppetTemplate = {
  name: 'dog',
  label: '小狗',
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
      name: 'head', sockets: [
        { name: 'ear_L', localX: -3, localY: -7 },
        { name: 'ear_R', localX: 3, localY: -7 },
      ],
      plug: { socketName: 'head_attach', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 5, crossSectionBottom: 4, zIndex: 10,
    },
    {
      name: 'ear_L', sockets: [],
      plug: { socketName: 'ear_L', localX: 0, localY: 0 },
      defaultAngle: -8, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 1, zIndex: 11,
    },
    {
      name: 'ear_R', sockets: [],
      plug: { socketName: 'ear_R', localX: 0, localY: 0 },
      defaultAngle: 8, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 1, zIndex: 11,
    },
    {
      name: 'tail', sockets: [],
      plug: { socketName: 'tail_attach', localX: 0, localY: 0 },
      defaultAngle: -15, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 1, zIndex: 4,
    },
    // ---- 前腿（两段） ----
    {
      name: 'front_upper_leg_L', sockets: [
        { name: 'knee_FL', localX: 0, localY: 7 },
      ],
      plug: { socketName: 'front_leg_L', localX: 0, localY: 0 },
      defaultAngle: 5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'front_lower_leg_L', sockets: [],
      plug: { socketName: 'knee_FL', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'front_upper_leg_R', sockets: [
        { name: 'knee_FR', localX: 0, localY: 7 },
      ],
      plug: { socketName: 'front_leg_R', localX: 0, localY: 0 },
      defaultAngle: -5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 2, zIndex: 2,
    },
    {
      name: 'front_lower_leg_R', sockets: [],
      plug: { socketName: 'knee_FR', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 2,
    },
    // ---- 后腿（两段） ----
    {
      name: 'back_upper_leg_L', sockets: [
        { name: 'knee_BL', localX: 0, localY: 7 },
      ],
      plug: { socketName: 'back_leg_L', localX: 0, localY: 0 },
      defaultAngle: 5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'back_lower_leg_L', sockets: [],
      plug: { socketName: 'knee_BL', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 3,
    },
    {
      name: 'back_upper_leg_R', sockets: [
        { name: 'knee_BR', localX: 0, localY: 7 },
      ],
      plug: { socketName: 'back_leg_R', localX: 0, localY: 0 },
      defaultAngle: -5, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 3, crossSectionBottom: 2, zIndex: 2,
    },
    {
      name: 'back_lower_leg_R', sockets: [],
      plug: { socketName: 'knee_BR', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 2, zIndex: 2,
    },
  ],
};

/**
 * 骑士：人形 10 节点 + 披风（躯干背后）+ 长剑（右手）。
 * torso 增加 cape_attach 插口，lower_arm_R 增加 hand_R 插口。
 */
const KNIGHT_TEMPLATE: PuppetTemplate = {
  name: 'knight',
  label: '骑士',
  icon: <Shield className="size-4" />,
  nodes: [
    ...cloneNodes(HUMANOID_TEMPLATE.nodes).map((n) => {
      if (n.name === 'torso') {
        return { ...n, sockets: [...n.sockets, { name: 'cape_attach', localX: 0, localY: -1 }] };
      }
      if (n.name === 'lower_arm_R') {
        return { ...n, sockets: [...n.sockets, { name: 'hand_R', localX: 0, localY: 9 }] };
      }
      return n;
    }),
    {
      name: 'cape', sockets: [],
      plug: { socketName: 'cape_attach', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 6, crossSectionBottom: 4, zIndex: 1,
    },
    {
      name: 'sword', sockets: [],
      plug: { socketName: 'hand_R', localX: 0, localY: 0 },
      defaultAngle: 0, defaultStretch: 1, defaultOffsetX: 0, defaultOffsetY: 0,
      crossSectionTop: 2, crossSectionBottom: 1, zIndex: 8,
    },
  ],
};

const ALL_TEMPLATES: PuppetTemplate[] = [
  HUMANOID_TEMPLATE,
  MECHA_TEMPLATE,
  KNIGHT_TEMPLATE,
  QUADRUPED_TEMPLATE,
  DOG_TEMPLATE,
  SIMPLE_TEMPLATE,
  TEST_UPPER_BODY_TEMPLATE,
];

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
  const sprites = useProjectStore((s) => s.sprites);
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};
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

    // ---- Pass 1: 生成默认精灵（正面 + 侧面），计算每根 plug 的 jointWidth ----
    // jointWidth = 关节开口宽度（= 关节盘直径），两侧开口与 disc 共用，不再与 parent bottom 求平均。
    const spriteResults: Record<string, DefaultSpriteResult> = {};
    const sideSpriteResults: Record<string, DefaultSpriteResult> = {};
    const jointWidths: Record<string, number> = {};
    for (const def of selectedTemplate.nodes) {
      if (spriteAssignments[def.name]) continue;
      const nodeColor = NODE_COLORS[selectedTemplate.nodes.indexOf(def) % NODE_COLORS.length];
      const r = generateDefaultCostumeSprite(def.name, selectedTemplate.name, nodeColor);
      spriteResults[def.name] = r;
      if (def.plug) {
        const plugY = r.pivotY + def.plug.localY;
        jointWidths[def.name] = plugY >= r.height / 2 ? def.crossSectionBottom : def.crossSectionTop;
      }
      const side = generateDefaultCostumeSideSprite(def.name, selectedTemplate.name, nodeColor);
      if (side) sideSpriteResults[def.name] = side;
    }

    // ---- Pass 2: 建 Sprite 并 carve 关节开口 ----
    const autoGeneratedSpriteIds: Record<string, string> = {};
    const autoGeneratedSideSpriteIds: Record<string, string> = {};
    const carveFor = (
      sr: DefaultSpriteResult,
      def: TemplateNodeDef,
    ) => {
      const openings: JointOpeningSpec[] = [];
      if (def.plug) {
        openings.push({
          x: sr.pivotX + def.plug.localX,
          y: sr.pivotY + def.plug.localY,
          width: jointWidths[def.name] ?? 4,
        });
      }
      for (const sock of def.sockets) {
        // socket 侧开口宽度 = 接入子节点的 jointWidth（两侧一致）
        const childDef = selectedTemplate.nodes.find((n) => n.plug?.socketName === sock.name);
        openings.push({
          x: sr.pivotX + sock.localX,
          y: sr.pivotY + sock.localY,
          width: (childDef ? jointWidths[childDef.name] : null) ?? 4,
        });
      }
      applyJointOpenings(sr.pixels, openings);
    };
    for (const def of selectedTemplate.nodes) {
      const r = spriteResults[def.name];
      if (!r) continue;
      carveFor(r, def);
      // Create the Sprite in the store with correct plug (at the attachment point, not center)
      const sprite = store.addSprite(
        `${characterName || '角色'}_${r.partName}`,
        r.width,
        r.height,
        { plugX: r.pivotX, plugY: r.pivotY },
      );
      // Paint the default sprite pixels onto the sprite
      store.setSpritePixels(sprite.id!, r.pixels);
      autoGeneratedSpriteIds[def.name] = sprite.id!;

      // 侧面版（E 方向；W 自动镜像）
      const side = sideSpriteResults[def.name];
      if (side) {
        carveFor(side, def);
        const sideSprite = store.addSprite(
          `${characterName || '角色'}_${side.partName}_侧面`,
          side.width,
          side.height,
          { plugX: side.pivotX, plugY: side.pivotY },
        );
        store.setSpritePixels(sideSprite.id!, side.pixels);
        autoGeneratedSideSpriteIds[def.name] = sideSprite.id!;
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

    // ---- New model: Create Character via addUnifiedCharacter ----
    const newCharacter = store.addUnifiedCharacter(characterName || '新角色');
    const characterId = newCharacter.id;

    // Helper: Sprite ID -> table entry for Character.sprites
    const spriteIdToTableEntry = (id: string) => {
      const gs = store.sprites[id];
      if (!gs?.data || gs.data.length === 0) return null;
      return {
        width: gs.data[0]?.length ?? gs.width,
        height: gs.data.length,
        data: gs.data,
        plug: gs.plug ?? { x: 0, y: 0 },
        heightmap: gs.heightmap,
      };
    };

    const spritesTable: Record<string, any> = {};
    const directionToIndex: Record<string, number> = { S: 0, SE: 1, E: 2, NE: 3, N: 4, NW: 5, W: 6, SW: 7 };

    // Create nodes in new model
    for (const def of selectedTemplate.nodes) {
      const idx = selectedTemplate.nodes.indexOf(def);
      // Convert sockets: PuppetSocket -> Socket
      const sockets = def.sockets.map((sock) => ({
        id: socketIdMap[`${def.name}:${sock.name}`],
        name: sock.name,
        basePosition: { x: sock.localX, y: sock.localY },
        directionOffsets: {},
      }));

      // Convert plug -> attachment
      let attachment: any;
      let parentName: string | null = null;
      if (def.plug) {
        const parentNodeDef = selectedTemplate.nodes.find((n) =>
          n.sockets.some((s) => s.name === def.plug!.socketName)
        );
        if (parentNodeDef) {
          parentName = parentNodeDef.name;
          const socketId = socketIdMap[`${parentNodeDef.name}:${def.plug!.socketName}`];
          attachment = {
            type: 'socket',
            parentSocketId: socketId,
            plug: { x: def.plug.localX, y: def.plug.localY },
            discColor: null,
            jointWidth: jointWidths[def.name] ?? null,
          };
        } else {
          attachment = { type: 'fixed', fixedOffset: { x: 0, y: 0 }, inheritRotation: true };
        }
      } else {
        attachment = { type: 'fixed', fixedOffset: { x: 0, y: 0 }, inheritRotation: true };
      }

      // Resolve sprite IDs (global sprite table for auto-generated, parts table for manual)
      const assignedSpriteId = spriteAssignments[def.name] ?? autoGeneratedSpriteIds[def.name] ?? null;
      const sideSpriteId = autoGeneratedSideSpriteIds[def.name] ?? null;

      // Build costumePiece with SpriteRef
      const pieceSprites: Record<number, { spriteId: string }> = {};
      if (assignedSpriteId) {
        const entry = spriteIdToTableEntry(assignedSpriteId);
        if (entry) {
          spritesTable[assignedSpriteId] = entry;
          pieceSprites[0] = { spriteId: assignedSpriteId };
        }
      }
      if (sideSpriteId) {
        const sideEntry = spriteIdToTableEntry(sideSpriteId);
        if (sideEntry) {
          spritesTable[sideSpriteId] = sideEntry;
          for (const dir of ['E', 'W', 'NE', 'SE', 'NW', 'SW']) {
            const dIdx = directionToIndex[dir];
            if (dIdx !== undefined) pieceSprites[dIdx] = { spriteId: sideSpriteId };
          }
        }
      }

      const node = store.addUnifiedNode(characterId, def.name, {
        id: nodeIdMap[def.name],
        sockets,
        attachment,
        transform: {
          x: def.defaultOffsetX ?? 0,
          y: def.defaultOffsetY ?? 0,
          angle: def.defaultAngle ?? 0,
          stretch: def.defaultStretch ?? 1,
          variantIndex: 0,
        },
        zIndex: def.zIndex ?? 0,
        visible: true,
        parentId: parentName ? nodeIdMap[parentName] : undefined,
        costumePiece: {
          slotKey: def.name,
          fillColor: NODE_COLORS[idx % NODE_COLORS.length],
          sprites: pieceSprites,
          scaleVariants: {},
          mirrorMap: {},
          crossSections: [],
        },
      });
    }

    // Set children arrays and rootNodeId, populate sprites table
    const createdChar = store.unifiedCharacters[characterId];
    if (createdChar) {
      const childMap: Record<string, string[]> = {};
      for (const node of Object.values(createdChar.nodes)) {
        if (node.parentId) {
          if (!childMap[node.parentId]) childMap[node.parentId] = [];
          childMap[node.parentId].push(node.id);
        }
      }
      for (const [parentId, childIds] of Object.entries(childMap)) {
        const parent = createdChar.nodes[parentId];
        if (parent) {
          store.updateUnifiedNode(characterId, parentId, {
            children: [...(parent.children || []), ...childIds],
          });
        }
      }
      const rootNode = Object.values(createdChar.nodes).find((n) => !n.parentId);
      store.updateUnifiedCharacter(characterId, {
        rootNodeId: rootNode?.id ?? '',
        sprites: spritesTable,
      });
    }

    // Create default costume set (new format)
    const costumeSetId = crypto.randomUUID();
    const newCostumeSet = {
      id: costumeSetId,
      name: '默认服装',
      pieces: {} as Record<string, any>,
    };
    const finalChar = store.unifiedCharacters[characterId];
    if (finalChar) {
      for (const node of Object.values(finalChar.nodes)) {
        if (node.costumePiece) {
          newCostumeSet.pieces[node.costumePiece.slotKey] = node.costumePiece;
        }
      }
      store.updateUnifiedCharacter(characterId, {
        costumeSets: [newCostumeSet],
        activeCostumeSetId: costumeSetId,
      });
    }

    // Optionally create animation clip
    if (createClip) {
      const name = clipName || `${characterName || '新角色'}_动画`;
      const clip = addAnimationClip(name);
      useProjectStore.setState((s) => ({
        animationClips: s.animationClips.map((c) =>
          c.id === clip.id
            ? { ...c, isPuppetClip: true, puppetCharacterId: newCharacter.id }
            : c
        ),
      }));
    }

    onClose();
  }, [characterName, selectedTemplate, spriteAssignments, createClip, clipName, addAnimationClip, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#0d0d1a] border border-[#1e1e3a] rounded-lg shadow-2xl w-[520px] max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e3a]">
          <h3 className="text-sm font-semibold text-gray-200">创建木偶角色</h3>
          <Button variant="ghost" size="icon" className="size-6 text-gray-400" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e1e3a]/50 flex-wrap">
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

        {/* Content：原生滚动（Radix ScrollArea 在 flex 布局下高度约束不可靠，改用原生 overflow） */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
                    {ALL_TEMPLATES.map((tmpl) => (
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
                      className="flex-1 min-w-0 h-7 text-[10px] bg-[#0d0d1a] border border-[#1e1e3a] rounded px-2 text-gray-300"
                    >
                      <option value="">— 未分配 —</option>
                      {Object.values(sprites).map((p) => (
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
                    <div className="flex justify-between gap-2 text-[11px]">
                      <span className="text-gray-500 flex-shrink-0">角色名称</span>
                      <span className="text-gray-300 truncate min-w-0 text-right">{characterName || '未命名'}</span>
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
                      const assignedSprite = spriteAssignments[nodeDef.name]
                        ? sprites[spriteAssignments[nodeDef.name] ?? '']
                        : null;
                      const willAutoGenerate = !spriteAssignments[nodeDef.name];
                      return (
                        <div key={nodeDef.name} className="flex items-center gap-2 py-0.5">
                          <div
                            className="size-2 rounded-full"
                            style={{ backgroundColor: NODE_COLORS[idx % NODE_COLORS.length] }}
                          />
                          <span className="text-[10px] text-gray-300 flex-1 truncate min-w-0">{nodeDef.name}</span>
                          <span className={`text-[9px] truncate min-w-0 max-w-[50%] text-right flex-shrink-0 ${willAutoGenerate ? 'text-cyan-500' : 'text-gray-500'}`}>
                            {assignedSprite ? assignedSprite.name : '自动生成默认精灵'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

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
