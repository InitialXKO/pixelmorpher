'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Bone as BoneIcon,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Lock,
  Unlock,
  Target,
  Zap,
  Link2,
} from 'lucide-react';

import { useProjectStore, useEditorStore } from '@/lib/store';
import type {
  Bone,
  BoneConstraint,
  BoneIKConstraint,
  BoneLimitConstraint,
  BoneCopyRotationConstraint,
  BoneStretchToConstraint,
} from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// ============================================================
// SkeletonPanel - Panel for skeleton/bone binding system
// ============================================================

// ---- Helper: Build bone tree from flat list ----

interface BoneTreeNode {
  bone: Bone;
  children: BoneTreeNode[];
}

function buildBoneTree(bones: Bone[]): BoneTreeNode[] {
  const map = new Map<string, BoneTreeNode>();
  const roots: BoneTreeNode[] = [];

  for (const bone of bones) {
    map.set(bone.id, { bone, children: [] });
  }

  for (const bone of bones) {
    const node = map.get(bone.id)!;
    if (bone.parentId && map.has(bone.parentId)) {
      map.get(bone.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---- Empty State ----

function EmptySkeletonState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <BoneIcon className="size-5 text-zinc-500" />
      </div>
      <p className="text-xs text-zinc-400 mb-1">No skeletons</p>
      <p className="text-[11px] text-zinc-500 mb-4">
        Create a skeleton to start bone binding
      </p>
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7 border-zinc-700 text-zinc-300 hover:text-zinc-100"
        onClick={onAdd}
      >
        <Plus className="size-3 mr-1" />
        Add Skeleton
      </Button>
    </div>
  );
}

// ---- Skeleton Row ----

function SkeletonRow({
  name,
  visible,
  isActive,
  onSelect,
  onToggleVisibility,
  onDelete,
}: {
  name: string;
  visible: boolean;
  isActive: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] cursor-pointer transition-colors group
        ${isActive
          ? 'bg-orange-500/10 border border-orange-500/30 text-orange-300'
          : 'hover:bg-zinc-800/50 border border-transparent text-zinc-300'
        }
      `}
    >
      <BoneIcon className="size-3 shrink-0" />
      <span className="flex-1 min-w-0 truncate">{name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
        className="size-5 flex items-center justify-center rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-zinc-300 shrink-0"
      >
        {visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="size-5 flex items-center justify-center rounded hover:bg-zinc-700/50 text-zinc-500 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

// ---- Bone Tree Node ----

function BoneTreeNodeView({
  node,
  depth,
  selectedBoneId,
  onSelectBone,
  skeletonId,
  onRemoveBone,
}: {
  node: BoneTreeNode;
  depth: number;
  selectedBoneId: string | null;
  onSelectBone: (id: string) => void;
  skeletonId: string;
  onRemoveBone: (skeletonId: string, boneId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedBoneId === node.bone.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => onSelectBone(node.bone.id)}
        className={`
          flex items-center gap-1 py-1 pr-1 rounded text-[11px] cursor-pointer transition-colors group
          ${isSelected
            ? 'bg-orange-500/10 border border-orange-500/30'
            : 'hover:bg-zinc-800/50 border border-transparent'
          }
        `}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className={`size-4 flex items-center justify-center shrink-0 ${hasChildren ? 'text-zinc-400' : 'text-transparent'}`}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>

        {/* Color dot */}
        <div
          className="size-2.5 rounded-full shrink-0 border border-white/20"
          style={{ backgroundColor: node.bone.color }}
        />

        {/* Name */}
        <span className={`flex-1 min-w-0 truncate ${isSelected ? 'text-orange-300' : 'text-zinc-300'}`}>
          {node.bone.name}
        </span>

        {/* Lock indicator */}
        {node.bone.locked && <Lock className="size-2.5 text-zinc-500 shrink-0" />}

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemoveBone(skeletonId, node.bone.id); }}
          className="size-4 flex items-center justify-center rounded hover:bg-zinc-700/50 text-zinc-600 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="size-2.5" />
        </button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <BoneTreeNodeView
              key={child.bone.id}
              node={child}
              depth={depth + 1}
              selectedBoneId={selectedBoneId}
              onSelectBone={onSelectBone}
              skeletonId={skeletonId}
              onRemoveBone={onRemoveBone}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Add Skeleton Dialog ----

function AddSkeletonDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState('Skeleton');

  const handleSubmit = useCallback(() => {
    if (name.trim()) {
      onAdd(name.trim());
      setName('Skeleton');
      onOpenChange(false);
    }
  }, [name, onAdd, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-200 max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Skeleton</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-zinc-400">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs h-7 bg-orange-600 hover:bg-orange-500 text-white"
            onClick={handleSubmit}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Add Bone Dialog ----

function AddBoneDialog({
  open,
  onOpenChange,
  onAdd,
  bones,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, parentId: string | null, headX: number, headY: number, tailX: number, tailY: number) => void;
  bones: Bone[];
}) {
  const [name, setName] = useState('Bone');
  const [parentId, setParentId] = useState<string>('__none__');
  const [headX, setHeadX] = useState(128);
  const [headY, setHeadY] = useState(100);
  const [tailX, setTailX] = useState(128);
  const [tailY, setTailY] = useState(140);

  const handleSubmit = useCallback(() => {
    if (name.trim()) {
      onAdd(
        name.trim(),
        parentId === '__none__' ? null : parentId,
        headX,
        headY,
        tailX,
        tailY,
      );
      setName('Bone');
      setParentId('__none__');
      onOpenChange(false);
    }
  }, [name, parentId, headX, headY, tailX, tailY, onAdd, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-200 max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Bone</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-zinc-400">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-zinc-400">Parent Bone</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200">
                <SelectValue placeholder="None (Root)" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-200">
                <SelectItem value="__none__" className="text-xs">None (Root)</SelectItem>
                {bones.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-zinc-500">Head X</Label>
              <Input
                type="number"
                value={headX}
                onChange={(e) => setHeadX(Number(e.target.value))}
                className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-zinc-500">Head Y</Label>
              <Input
                type="number"
                value={headY}
                onChange={(e) => setHeadY(Number(e.target.value))}
                className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-zinc-500">Tail X</Label>
              <Input
                type="number"
                value={tailX}
                onChange={(e) => setTailX(Number(e.target.value))}
                className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-zinc-500">Tail Y</Label>
              <Input
                type="number"
                value={tailY}
                onChange={(e) => setTailY(Number(e.target.value))}
                className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs h-7 bg-orange-600 hover:bg-orange-500 text-white"
            onClick={handleSubmit}
            disabled={!name.trim()}
          >
            Add Bone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Add Constraint Dialog ----

function AddConstraintDialog({
  open,
  onOpenChange,
  onAdd,
  bones,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (constraint: BoneConstraint) => void;
  bones: Bone[];
}) {
  const [type, setType] = useState<BoneConstraint['type']>('ik_solver');
  const [ikTargetX, setIkTargetX] = useState(128);
  const [ikTargetY, setIkTargetY] = useState(80);
  const [ikChainLength, setIkChainLength] = useState(2);
  const [ikIterations, setIkIterations] = useState(10);
  const [ikPoleAngle, setIkPoleAngle] = useState(0);
  const [limitMin, setLimitMin] = useState(-45);
  const [limitMax, setLimitMax] = useState(45);
  const [copyTargetBoneId, setCopyTargetBoneId] = useState(bones[0]?.id ?? '');
  const [copyInfluence, setCopyInfluence] = useState(1);
  const [stretchTargetX, setStretchTargetX] = useState(128);
  const [stretchTargetY, setStretchTargetY] = useState(60);
  const [stretchMaxLength, setStretchMaxLength] = useState(50);

  const handleSubmit = useCallback(() => {
    let constraint: BoneConstraint;

    switch (type) {
      case 'ik_solver':
        constraint = {
          type: 'ik_solver',
          targetX: ikTargetX,
          targetY: ikTargetY,
          chainLength: ikChainLength,
          iterations: ikIterations,
          poleAngle: ikPoleAngle,
        } satisfies BoneIKConstraint;
        break;
      case 'limit_rotation':
        constraint = {
          type: 'limit_rotation',
          minAngle: limitMin,
          maxAngle: limitMax,
        } satisfies BoneLimitConstraint;
        break;
      case 'copy_rotation':
        constraint = {
          type: 'copy_rotation',
          targetBoneId: copyTargetBoneId,
          influence: copyInfluence,
        } satisfies BoneCopyRotationConstraint;
        break;
      case 'stretch_to':
        constraint = {
          type: 'stretch_to',
          targetX: stretchTargetX,
          targetY: stretchTargetY,
          maxLength: stretchMaxLength,
        } satisfies BoneStretchToConstraint;
        break;
    }

    onAdd(constraint);
    onOpenChange(false);
  }, [
    type, ikTargetX, ikTargetY, ikChainLength, ikIterations, ikPoleAngle,
    limitMin, limitMax, copyTargetBoneId, copyInfluence,
    stretchTargetX, stretchTargetY, stretchMaxLength,
    onAdd, onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-200 max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Constraint</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-72 overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-zinc-400">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as BoneConstraint['type'])}>
              <SelectTrigger className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-200">
                <SelectItem value="ik_solver" className="text-xs">IK Solver</SelectItem>
                <SelectItem value="limit_rotation" className="text-xs">Limit Rotation</SelectItem>
                <SelectItem value="copy_rotation" className="text-xs">Copy Rotation</SelectItem>
                <SelectItem value="stretch_to" className="text-xs">Stretch To</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'ik_solver' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Target X</Label>
                  <Input type="number" value={ikTargetX} onChange={(e) => setIkTargetX(Number(e.target.value))} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Target Y</Label>
                  <Input type="number" value={ikTargetY} onChange={(e) => setIkTargetY(Number(e.target.value))} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Chain Length</Label>
                  <Input type="number" value={ikChainLength} onChange={(e) => setIkChainLength(Number(e.target.value))} min={1} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Iterations</Label>
                  <Input type="number" value={ikIterations} onChange={(e) => setIkIterations(Number(e.target.value))} min={1} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-500">Pole Angle</Label>
                <Slider value={[ikPoleAngle]} min={-180} max={180} step={1} onValueChange={([v]) => setIkPoleAngle(v)} />
                <span className="text-[10px] text-zinc-400">{ikPoleAngle}&deg;</span>
              </div>
            </>
          )}

          {type === 'limit_rotation' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-500">Min Angle</Label>
                <Input type="number" value={limitMin} onChange={(e) => setLimitMin(Number(e.target.value))} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-500">Max Angle</Label>
                <Input type="number" value={limitMax} onChange={(e) => setLimitMax(Number(e.target.value))} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
              </div>
            </div>
          )}

          {type === 'copy_rotation' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-zinc-400">Target Bone</Label>
                <Select value={copyTargetBoneId} onValueChange={setCopyTargetBoneId}>
                  <SelectTrigger className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200">
                    <SelectValue placeholder="Select bone" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-200">
                    {bones.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-500">Influence</Label>
                <Slider value={[copyInfluence]} min={0} max={1} step={0.01} onValueChange={([v]) => setCopyInfluence(v)} />
                <span className="text-[10px] text-zinc-400">{copyInfluence.toFixed(2)}</span>
              </div>
            </>
          )}

          {type === 'stretch_to' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Target X</Label>
                  <Input type="number" value={stretchTargetX} onChange={(e) => setStretchTargetX(Number(e.target.value))} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Target Y</Label>
                  <Input type="number" value={stretchTargetY} onChange={(e) => setStretchTargetY(Number(e.target.value))} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-500">Max Length</Label>
                <Input type="number" value={stretchMaxLength} onChange={(e) => setStretchMaxLength(Number(e.target.value))} min={1} className="h-6 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs h-7 bg-orange-600 hover:bg-orange-500 text-white"
            onClick={handleSubmit}
          >
            Add Constraint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Constraint Row ----

function ConstraintRow({
  constraint,
  constraintIndex,
  onRemove,
}: {
  constraint: BoneConstraint;
  constraintIndex: number;
  onRemove: (index: number) => void;
}) {
  const typeLabel = {
    ik_solver: 'IK Solver',
    limit_rotation: 'Limit Rotation',
    copy_rotation: 'Copy Rotation',
    stretch_to: 'Stretch To',
  }[constraint.type];

  const typeIcon = {
    ik_solver: <Target className="size-3" />,
    limit_rotation: <Lock className="size-3" />,
    copy_rotation: <Link2 className="size-3" />,
    stretch_to: <Zap className="size-3" />,
  }[constraint.type];

  const typeColor = {
    ik_solver: 'text-cyan-400',
    limit_rotation: 'text-amber-400',
    copy_rotation: 'text-violet-400',
    stretch_to: 'text-rose-400',
  }[constraint.type];

  let detail = '';
  switch (constraint.type) {
    case 'ik_solver':
      detail = `(${constraint.targetX}, ${constraint.targetY}) chain:${constraint.chainLength}`;
      break;
    case 'limit_rotation':
      detail = `${constraint.minAngle}\u00B0 ~ ${constraint.maxAngle}\u00B0`;
      break;
    case 'copy_rotation':
      detail = `inf: ${constraint.influence.toFixed(2)}`;
      break;
    case 'stretch_to':
      detail = `(${constraint.targetX}, ${constraint.targetY}) max:${constraint.maxLength}`;
      break;
  }

  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-zinc-800/60 group">
      <span className={typeColor}>{typeIcon}</span>
      <span className="text-[10px] text-zinc-300 flex-1 min-w-0 truncate">
        {typeLabel} <span className="text-zinc-500">{detail}</span>
      </span>
      <button
        onClick={() => onRemove(constraintIndex)}
        className="size-4 flex items-center justify-center rounded hover:bg-zinc-700/50 text-zinc-600 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
      >
        <Trash2 className="size-2.5" />
      </button>
    </div>
  );
}

// ---- Bone Properties Panel ----

function BoneProperties({
  bone,
  skeletonId,
  allBones,
  parts,
}: {
  bone: Bone;
  skeletonId: string;
  allBones: Bone[];
  parts: { id: string; name: string }[];
}) {
  const {
    updateBone,
    bindPartToBone,
    unbindPartFromBone,
    addBoneConstraint,
    removeBoneConstraint,
    addBonePose,
    beginDrag,
    endDrag,
  } = useProjectStore();

  const { currentFrame } = useProjectStore();

  const [showAddConstraint, setShowAddConstraint] = useState(false);
  const [bindPartId, setBindPartId] = useState<string>('');
  const [bindWeight, setBindWeight] = useState(1);

  // Computed rest rotation and length from head/tail
  const computedRestRotation = useMemo(() => {
    const dx = bone.tailX - bone.headX;
    const dy = bone.tailY - bone.headY;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }, [bone.headX, bone.headY, bone.tailX, bone.tailY]);

  const computedLength = useMemo(() => {
    const dx = bone.tailX - bone.headX;
    const dy = bone.tailY - bone.headY;
    return Math.sqrt(dx * dx + dy * dy);
  }, [bone.headX, bone.headY, bone.tailX, bone.tailY]);

  // Find IK constraint if any
  const ikConstraint = useMemo(
    () => bone.constraints.find((c): c is BoneIKConstraint => c.type === 'ik_solver'),
    [bone.constraints],
  );

  const handleUpdateName = useCallback(
    (name: string) => updateBone(skeletonId, bone.id, { name }),
    [skeletonId, bone.id, updateBone],
  );

  const handleUpdatePosition = useCallback(
    (field: 'headX' | 'headY' | 'tailX' | 'tailY', value: number) => {
      const updates: Partial<Bone> = { [field]: value };
      // Recompute rest rotation and length
      const hX = field === 'headX' ? value : bone.headX;
      const hY = field === 'headY' ? value : bone.headY;
      const tX = field === 'tailX' ? value : bone.tailX;
      const tY = field === 'tailY' ? value : bone.tailY;
      const dx = tX - hX;
      const dy = tY - hY;
      updates.restRotation = Math.atan2(dy, dx) * 180 / Math.PI;
      updates.length = Math.sqrt(dx * dx + dy * dy);
      updateBone(skeletonId, bone.id, updates);
    },
    [skeletonId, bone.id, bone.headX, bone.headY, bone.tailX, bone.tailY, updateBone],
  );

  const handlePoseRotation = useCallback(
    (poseRotation: number) => updateBone(skeletonId, bone.id, { poseRotation }),
    [skeletonId, bone.id, updateBone],
  );

  const handleColorChange = useCallback(
    (color: string) => updateBone(skeletonId, bone.id, { color }),
    [skeletonId, bone.id, updateBone],
  );

  const handleToggleLocked = useCallback(
    () => updateBone(skeletonId, bone.id, { locked: !bone.locked }),
    [skeletonId, bone.id, bone.locked, updateBone],
  );

  const handleRecordPose = useCallback(() => {
    addBonePose(skeletonId, bone.id, currentFrame, bone.poseRotation);
  }, [skeletonId, bone.id, currentFrame, bone.poseRotation, addBonePose]);

  const handleBindPart = useCallback(() => {
    if (bindPartId) {
      bindPartToBone(skeletonId, bone.id, bindPartId, bindWeight);
      setBindPartId('');
      setBindWeight(1);
    }
  }, [skeletonId, bone.id, bindPartId, bindWeight, bindPartToBone]);

  const handleAddConstraint = useCallback(
    (constraint: BoneConstraint) => addBoneConstraint(skeletonId, bone.id, constraint),
    [skeletonId, bone.id, addBoneConstraint],
  );

  const handleRemoveConstraint = useCallback(
    (index: number) => removeBoneConstraint(skeletonId, bone.id, index),
    [skeletonId, bone.id, removeBoneConstraint],
  );

  return (
    <div className="space-y-3">
      {/* Name + Lock */}
      <div className="flex items-center gap-2">
        <Input
          value={bone.name}
          onChange={(e) => handleUpdateName(e.target.value)}
          className="h-6 text-[11px] bg-zinc-800 border-zinc-700 text-zinc-200 flex-1"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`size-6 p-0 ${bone.locked ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
              onClick={handleToggleLocked}
            >
              {bone.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[11px]">
            {bone.locked ? 'Unlock bone' : 'Lock bone'}
          </TooltipContent>
        </Tooltip>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Position */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Position</span>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <Label className="text-[10px] text-zinc-500">Head X</Label>
            <Input
              type="number"
              value={bone.headX}
              onChange={(e) => handleUpdatePosition('headX', Number(e.target.value))}
              className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] text-zinc-500">Head Y</Label>
            <Input
              type="number"
              value={bone.headY}
              onChange={(e) => handleUpdatePosition('headY', Number(e.target.value))}
              className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] text-zinc-500">Tail X</Label>
            <Input
              type="number"
              value={bone.tailX}
              onChange={(e) => handleUpdatePosition('tailX', Number(e.target.value))}
              className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] text-zinc-500">Tail Y</Label>
            <Input
              type="number"
              value={bone.tailY}
              onChange={(e) => handleUpdatePosition('tailY', Number(e.target.value))}
              className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
            />
          </div>
        </div>
      </div>

      {/* Read-only computed */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <span className="text-[10px] text-zinc-500">Rest Rotation</span>
          <div className="text-[11px] text-zinc-400 font-mono">{computedRestRotation.toFixed(1)}&deg;</div>
        </div>
        <div className="flex-1">
          <span className="text-[10px] text-zinc-500">Length</span>
          <div className="text-[11px] text-zinc-400 font-mono">{computedLength.toFixed(1)}</div>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Pose Rotation */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Pose Rotation</span>
          <span className="text-[10px] text-orange-400 font-mono">{bone.poseRotation}&deg;</span>
        </div>
        <Slider
          value={[bone.poseRotation]}
          min={-180}
          max={180}
          step={1}
          onPointerDown={() => beginDrag('调整骨骼姿态')}
          onValueChange={([v]) => handlePoseRotation(v)}
          onValueCommit={([v]) => { handlePoseRotation(v); endDrag(); }}
        />
      </div>

      {/* Record pose */}
      <Button
        size="sm"
        variant="outline"
        className="w-full h-6 text-[10px] border-zinc-700 text-orange-400 hover:text-orange-300 hover:border-orange-500/30"
        onClick={handleRecordPose}
      >
        <Target className="size-3 mr-1" />
        Record Pose at Frame {currentFrame}
      </Button>

      <Separator className="bg-zinc-800" />

      {/* Color picker */}
      <div className="space-y-1">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Color</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={bone.color}
            onChange={(e) => handleColorChange(e.target.value)}
            className="size-6 rounded border border-zinc-700 cursor-pointer bg-transparent"
          />
          <span className="text-[11px] text-zinc-400 font-mono">{bone.color}</span>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Bound Parts */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Bound Parts</span>

        {bone.boundParts.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {bone.boundParts.map((bp) => {
              const part = parts.find((p) => p.id === bp.partId);
              return (
                <div key={bp.partId} className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-zinc-800/60 group">
                  <span className="text-[10px] text-zinc-300 flex-1 min-w-0 truncate">
                    {part?.name ?? bp.partId}
                  </span>
                  <Slider
                    className="w-16"
                    value={[bp.weight]}
                    min={0}
                    max={1}
                    step={0.01}
                    onPointerDown={() => beginDrag('调整绑定权重')}
                    onValueChange={([w]) => bindPartToBone(skeletonId, bone.id, bp.partId, w)}
                    onValueCommit={([w]) => { bindPartToBone(skeletonId, bone.id, bp.partId, w); endDrag(); }}
                  />
                  <span className="text-[9px] text-zinc-400 w-6 text-right font-mono">{bp.weight.toFixed(2)}</span>
                  <button
                    onClick={() => unbindPartFromBone(skeletonId, bone.id, bp.partId)}
                    className="size-4 flex items-center justify-center rounded hover:bg-zinc-700/50 text-zinc-600 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add part binding */}
        {parts.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select value={bindPartId} onValueChange={setBindPartId}>
              <SelectTrigger className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 flex-1">
                <SelectValue placeholder="Select part" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-200">
                {parts
                  .filter((p) => !bone.boundParts.some((bp) => bp.partId === p.id))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-[10px]">{p.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={bindWeight}
              onChange={(e) => setBindWeight(Number(e.target.value))}
              min={0}
              max={1}
              step={0.1}
              className="h-5 w-12 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1 py-0"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-5 p-0 text-zinc-500 hover:text-emerald-400"
              onClick={handleBindPart}
              disabled={!bindPartId}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        )}
      </div>

      <Separator className="bg-zinc-800" />

      {/* Constraints */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Constraints</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 p-0 text-zinc-500 hover:text-emerald-400"
            onClick={() => setShowAddConstraint(true)}
          >
            <Plus className="size-3" />
          </Button>
        </div>

        {bone.constraints.length > 0 ? (
          <div className="space-y-1">
            {bone.constraints.map((constraint, i) => (
              <ConstraintRow
                key={i}
                constraint={constraint}
                constraintIndex={i}
                onRemove={handleRemoveConstraint}
              />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-zinc-600 italic">No constraints</p>
        )}

        <AddConstraintDialog
          open={showAddConstraint}
          onOpenChange={setShowAddConstraint}
          onAdd={handleAddConstraint}
          bones={allBones.filter((b) => b.id !== bone.id)}
        />
      </div>

      {/* IK Target controls */}
      {ikConstraint && (
        <>
          <Separator className="bg-zinc-800" />
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Target className="size-3 text-cyan-400" />
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">IK Target</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-0.5">
                <Label className="text-[10px] text-zinc-500">Target X</Label>
                <Input
                  type="number"
                  value={ikConstraint.targetX}
                  onChange={(e) => {
                    const updated = bone.constraints.map((c) =>
                      c.type === 'ik_solver' ? { ...c, targetX: Number(e.target.value) } : c
                    );
                    updateBone(skeletonId, bone.id, { constraints: updated } as Partial<Bone>);
                  }}
                  className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] text-zinc-500">Target Y</Label>
                <Input
                  type="number"
                  value={ikConstraint.targetY}
                  onChange={(e) => {
                    const updated = bone.constraints.map((c) =>
                      c.type === 'ik_solver' ? { ...c, targetY: Number(e.target.value) } : c
                    );
                    updateBone(skeletonId, bone.id, { constraints: updated } as Partial<Bone>);
                  }}
                  className="h-5 text-[10px] bg-zinc-800 border-zinc-700 text-zinc-200 px-1.5 py-0"
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-zinc-500">Pole Angle</Label>
                <span className="text-[10px] text-cyan-400 font-mono">{ikConstraint.poleAngle}&deg;</span>
              </div>
              <Slider
                value={[ikConstraint.poleAngle]}
                min={-180}
                max={180}
                step={1}
                onPointerDown={() => beginDrag('调整IK极角')}
                onValueChange={([v]) => {
                  const updated = bone.constraints.map((c) =>
                    c.type === 'ik_solver' ? { ...c, poleAngle: v } : c
                  );
                  updateBone(skeletonId, bone.id, { constraints: updated } as Partial<Bone>);
                }}
                onValueCommit={([v]) => {
                  const updated = bone.constraints.map((c) =>
                    c.type === 'ik_solver' ? { ...c, poleAngle: v } : c
                  );
                  updateBone(skeletonId, bone.id, { constraints: updated } as Partial<Bone>);
                  endDrag();
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Main SkeletonPanel Component ----

export default function SkeletonPanel() {
  const {
    skeletons,
    addSkeleton,
    removeSkeleton,
    addBone,
    removeBone,
    toggleSkeletonVisibility,
    selectedBoneId,
    setSelectedBoneId,
    parts,
    currentFrame,
  } = useProjectStore();

  const { activeSkeletonId, setActiveSkeletonId } = useEditorStore();

  // Dialog states
  const [showAddSkeleton, setShowAddSkeleton] = useState(false);
  const [showAddBone, setShowAddBone] = useState(false);

  // Derived: active skeleton
  const activeSkeleton = useMemo(
    () => skeletons.find((s) => s.id === activeSkeletonId) ?? null,
    [skeletons, activeSkeletonId],
  );

  // Derived: selected bone
  const selectedBone = useMemo(() => {
    if (!activeSkeleton || !selectedBoneId) return null;
    return activeSkeleton.bones.find((b) => b.id === selectedBoneId) ?? null;
  }, [activeSkeleton, selectedBoneId]);

  // Derived: bone tree
  const boneTree = useMemo(
    () => activeSkeleton ? buildBoneTree(activeSkeleton.bones) : [],
    [activeSkeleton],
  );

  // Parts list for binding
  const partsList = useMemo(
    () => parts.map((p) => ({ id: p.id, name: p.name })),
    [parts],
  );

  // Handlers
  const handleAddSkeleton = useCallback(
    (name: string) => {
      const sk = addSkeleton(name);
      setActiveSkeletonId(sk.id);
    },
    [addSkeleton, setActiveSkeletonId],
  );

  const handleRemoveSkeleton = useCallback(
    (id: string) => {
      removeSkeleton(id);
      if (activeSkeletonId === id) {
        setActiveSkeletonId(skeletons.length > 1 ? skeletons.find((s) => s.id !== id)?.id ?? null : null);
        setSelectedBoneId(null);
      }
    },
    [removeSkeleton, activeSkeletonId, skeletons, setActiveSkeletonId, setSelectedBoneId],
  );

  const handleAddBone = useCallback(
    (name: string, parentId: string | null, headX: number, headY: number, tailX: number, tailY: number) => {
      if (!activeSkeletonId) return;
      addBone(activeSkeletonId, name, parentId, headX, headY, tailX, tailY);
    },
    [activeSkeletonId, addBone],
  );

  const handleSelectBone = useCallback(
    (id: string) => {
      if (selectedBoneId === id) {
        setSelectedBoneId(null);
      } else {
        setSelectedBoneId(id);
      }
    },
    [selectedBoneId, setSelectedBoneId],
  );

  return (
    <div className="flex flex-col h-full bg-zinc-950" style={{ width: 280 }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">Skeleton</h3>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-0 text-zinc-500 hover:text-emerald-400"
                onClick={() => setShowAddSkeleton(true)}
              >
                <Plus className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">Add Skeleton</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Skeleton list */}
      {skeletons.length > 0 && (
        <div className="px-2 py-1.5 border-b border-zinc-800 space-y-0.5 shrink-0 max-h-40 overflow-y-auto">
          {skeletons.map((sk) => (
            <SkeletonRow
              key={sk.id}
              name={sk.name}
              visible={sk.visible}
              isActive={activeSkeletonId === sk.id}
              onSelect={() => {
                setActiveSkeletonId(sk.id);
                setSelectedBoneId(null);
              }}
              onToggleVisibility={() => toggleSkeletonVisibility(sk.id)}
              onDelete={() => handleRemoveSkeleton(sk.id)}
            />
          ))}
        </div>
      )}

      {/* Bone tree + Add bone */}
      {activeSkeleton ? (
        <>
          <div className="px-2 py-1.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Bones ({activeSkeleton.bones.length})
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 p-0 text-zinc-500 hover:text-emerald-400"
              onClick={() => setShowAddBone(true)}
            >
              <Plus className="size-3" />
            </Button>
          </div>

          <div className="px-1 py-1 border-b border-zinc-800 shrink-0 max-h-52 overflow-y-auto">
            {boneTree.length > 0 ? (
              boneTree.map((node) => (
                <BoneTreeNodeView
                  key={node.bone.id}
                  node={node}
                  depth={0}
                  selectedBoneId={selectedBoneId}
                  onSelectBone={handleSelectBone}
                  skeletonId={activeSkeleton.id}
                  onRemoveBone={removeBone}
                />
              ))
            ) : (
              <div className="py-4 text-center">
                <p className="text-[10px] text-zinc-600">No bones in this skeleton</p>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Bone properties or empty state */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          {skeletons.length === 0 ? (
            <EmptySkeletonState onAdd={() => setShowAddSkeleton(true)} />
          ) : activeSkeleton && selectedBone ? (
            <BoneProperties
              bone={selectedBone}
              skeletonId={activeSkeleton.id}
              allBones={activeSkeleton.bones}
              parts={partsList}
            />
          ) : activeSkeleton ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="size-10 rounded-full bg-zinc-800 flex items-center justify-center mb-2">
                <BoneIcon className="size-4 text-zinc-600" />
              </div>
              <p className="text-[11px] text-zinc-500">Select a bone to edit</p>
              <p className="text-[10px] text-zinc-600 mt-1">
                Frame: {currentFrame}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="size-10 rounded-full bg-zinc-800 flex items-center justify-center mb-2">
                <BoneIcon className="size-4 text-zinc-600" />
              </div>
              <p className="text-[11px] text-zinc-500">Select a skeleton</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Dialogs */}
      <AddSkeletonDialog
        open={showAddSkeleton}
        onOpenChange={setShowAddSkeleton}
        onAdd={handleAddSkeleton}
      />

      {activeSkeletonId && (
        <AddBoneDialog
          open={showAddBone}
          onOpenChange={setShowAddBone}
          onAdd={handleAddBone}
          bones={activeSkeleton?.bones ?? []}
        />
      )}
    </div>
  );
}
