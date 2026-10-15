'use client';

// ============================================================
// PuppetModifierPanel — 木偶节点程序化修改器
// 挂在 Perform 阶段：给选中节点加 pendulum/breath/shake 等修改器，
// 逐帧叠加在关键帧插值之上。复用老系统的求值器 computePartAnimationTransform。
// ============================================================

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, ChevronDown, Network } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import {
  ANIMATION_MODIFIER_TYPES,
  getModifierDef,
  type AnimationModifierType,
  type PartAnimationModifier,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import BlueprintEditor from './BlueprintEditor';
import BlueprintTemplateLoader from './BlueprintTemplateLoader';
import PathEditor from './PathEditor';
import HeightmapEditor from './HeightmapEditor';
import { modifiersToBlueprint } from '@/lib/blueprint/migrate';
import type { BlueprintGraph } from '@/lib/blueprint/ir';

/** 高度图绘制区：读写 Part.heightmap */
function HeightmapSection({ partId }: { partId: string }) {
  const part = useProjectStore((s) => s.parts.find((p) => p.id === partId));
  const updatePart = useProjectStore((s) => s.updatePart);
  const [showEditor, setShowEditor] = useState(false);

  if (!part) return null;

  return (
    <div className="mt-2 pt-2 border-t border-[#2a2a4a]">
      <button
        onClick={() => setShowEditor(!showEditor)}
        className="text-[10px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1"
      >
        <span>{showEditor ? '▼' : '▶'}</span> 高度图绘制 {part.heightmap ? '(已绘制)' : '(空)'}
      </button>
      {showEditor && (
        <div className="mt-1">
          <HeightmapEditor
            value={part.heightmap}
            onChange={(hm) => updatePart(partId, { heightmap: hm })}
            width={part.width}
            height={part.height}
          />
        </div>
      )}
    </div>
  );
}

// 收录的修改器：变换类 + 像素类（用户要求像素层程序化动画也要支持）
const PUPPET_MODIFIER_TYPES: AnimationModifierType[] = [
  // 变换类
  'pendulum', 'bounce', 'breath', 'wobble', 'float', 'shake', 'elastic',
  'gait', 'noise', 'wave', 'spring', 'jitter', 'wheel', 'expression', 'path_move',
  // 像素类
  'texture_scroll', 'wave_deform', 'contour_scroll', 'reveal_hide',
  'shatter_dissolve', 'annihilate', 'teleport', 'crt_off',
  'bend', 'elliptical_compress', 'dumbbell_stretch', 'pillow_stretch',
  'hyperbolic_stretch', 'ring_ripple', 'local_inflate', 'path_follow', 'bump_light',
];

export default function PuppetModifierPanel() {
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons) ?? [];
  const addPuppetNodeModifier = useProjectStore((s) => s.addPuppetNodeModifier);
  const removePuppetNodeModifier = useProjectStore((s) => s.removePuppetNodeModifier);
  const updatePuppetNodeModifier = useProjectStore((s) => s.updatePuppetNodeModifier);
  const togglePuppetNodeModifier = useProjectStore((s) => s.togglePuppetNodeModifier);

  const [addingType, setAddingType] = useState<AnimationModifierType>('pendulum');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'modifiers' | 'blueprint' | 'templates'>('modifiers');

  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const selectedPuppetNodeId = useProjectStore((s) => s.selectedPuppetNodeId);

  const skeleton = useMemo(
    () => puppetSkeletons.find((sk) => sk.id === activePuppetSkeletonId) ?? null,
    [puppetSkeletons, activePuppetSkeletonId]
  );
  const node = useMemo(
    () => skeleton?.nodes.find((n) => n.id === selectedPuppetNodeId) ?? null,
    [skeleton, selectedPuppetNodeId]
  );
  const modifiers = node?.modifiers ?? [];

  // 蓝图：优先用节点自带的，没有则从 modifiers 即时转换
  const blueprint: BlueprintGraph | null = useMemo(() => {
    if (!node) return null;
    // 标记节点ID，供预览区分当前编辑节点
    const bp = node.blueprint ?? (modifiers.length > 0 ? modifiersToBlueprint(modifiers) : null);
    if (bp) (bp as any)._nodeId = node.id;
    return bp;
  }, [node, modifiers]);

  // 整角色预览数据：所有节点的精灵和蓝图（含层级）
  const characterNodes = useMemo(() => {
    if (!skeleton) return undefined;
    const parts = useProjectStore.getState().parts ?? [];
    const partMap = new Map(parts.map((p: any) => [p.id, p]));
    // 建 socket 位置映射：socketId -> {nodeId, x, y}
    const socketMap = new Map<string, { x: number; y: number }>();
    for (const n of skeleton.nodes) {
      for (const s of (n.sockets ?? [])) {
        socketMap.set(s.id, { x: s.localX ?? 0, y: s.localY ?? 0 });
      }
    }
    // 建 parent 映射：通过 plug.socketId 找到父节点
    const nodeBySocket = new Map<string, string>();
    for (const n of skeleton.nodes) {
      for (const s of (n.sockets ?? [])) {
        nodeBySocket.set(s.id, n.id);
      }
    }
    return skeleton.nodes.map((n: any) => {
      const part = n.spritePartId ? partMap.get(n.spritePartId) : null;
      const bp = n.blueprint ?? (n.modifiers?.length ? modifiersToBlueprint(n.modifiers) : null);
      const plug = n.plug;
      const parentId = plug?.socketId ? nodeBySocket.get(plug.socketId) ?? null : null;
      const sock = plug?.socketId ? socketMap.get(plug.socketId) : null;
      return {
        id: n.id,
        name: n.name,
        blueprint: bp,
        spritePixels: part?.pixels ?? null,
        spriteW: part?.width,
        spriteH: part?.height,
        heightmap: part?.heightmap ?? null,
        parentId,
        socketId: plug?.socketId ?? null,
        socketX: sock?.x ?? 0,
        socketY: sock?.y ?? 0,
        plugX: plug?.localX ?? 0,
        plugY: plug?.localY ?? 0,
      };
    });
  }, [skeleton]);

  const updateBlueprint = (g: BlueprintGraph) => {
    if (!skeleton || !node) return;
    const store = useProjectStore.getState();
    
    // 反向同步：蓝图 → modifiers 列表
    const modifiers = node.modifiers ?? [];
    
    // 3. 删节点 → 删 modifier：列表里有但蓝图里没 mod_* 节点的，收集待删除
    const toDelete = new Set<string>();
    for (const mod of modifiers) {
      const targetId = `mod_${mod.id.replace(/-/g, '').slice(0, 12)}`;
      const bpNode = g.nodes.find(n => n.id === targetId);
      if (!bpNode) {
        toDelete.add(mod.id);
      }
    }
    
    // 先保存蓝图 + 删除的 modifier（直接更新，不触发 sync，避免二次修改蓝图）
    let newModifiers = modifiers.filter(m => !toDelete.has(m.id));
    store.updatePuppetNode(skeleton.id, node.id, { 
      blueprint: g,
      modifiers: newModifiers,
    } as any);
    
    // 2&1. 参数、blendMode、时间范围的反向同步
    for (const mod of newModifiers) {
      const targetId = `mod_${mod.id.replace(/-/g, '').slice(0, 12)}`;
      const bpNode = g.nodes.find(n => n.id === targetId);
      if (!bpNode) continue;
      
      // 1. 参数同步：bpNode.params → mod.params（跳过 enabled）
      const bpParams = bpNode.params ?? {};
      const modParams = mod.params ?? {};
      let paramsChanged = false;
      const updatedParams: Record<string, any> = { ...modParams };
      
      for (const [k, v] of Object.entries(bpParams)) {
        if (k === 'enabled') continue; // enabled 单独处理（顶层字段）
        if (updatedParams[k] !== v) {
          updatedParams[k] = v;
          paramsChanged = true;
        }
      }
      
      // enabled 短路开关回写：bpNode.params.enabled → mod.enabled
      let enabledChanged = false;
      let newEnabled = (mod as any).enabled !== false;
      if ('enabled' in bpParams) {
        const bpEnabled = Boolean(bpParams.enabled);
        if (bpEnabled !== newEnabled) {
          newEnabled = bpEnabled;
          enabledChanged = true;
        }
      }
      
      // 2a. blendMode：找以该 modifier 为 b 输入的 blend 节点
      let newBlendMode = (mod as any).blendMode;
      let blendModeChanged = false;
      for (const bn of g.nodes) {
        if (bn.type !== 'blend') continue;
        const bInput = bn.inputs?.b;
        if (bInput && typeof bInput === 'object' && 'nodeId' in bInput && bInput.nodeId === targetId) {
          const mode = String(bn.params?.mode ?? 'add');
          if (mode !== newBlendMode && ['add', 'multiply', 'converge'].includes(mode)) {
            newBlendMode = mode;
            blendModeChanged = true;
          }
          break;
        }
      }
      
      // 2b. 时间范围：找 gate_<modId> 节点
      const timeUpdates: Record<string, any> = {};
      let timeChanged = false;
      const gateNode = g.nodes.find(n => n.id === `gate_${targetId}` && n.type === 'timeGate');
      if (gateNode) {
        const gp = gateNode.params ?? {};
        const start = Number(gp.start ?? -1);
        const end = Number(gp.end ?? -1);
        const fadeIn = Number(gp.fadeIn ?? 0);
        const fadeOut = Number(gp.fadeOut ?? 0);
        if ((mod as any).startFrame !== start) { timeUpdates.startFrame = start; timeChanged = true; }
        if ((mod as any).endFrame !== end) { timeUpdates.endFrame = end; timeChanged = true; }
        if ((mod as any).fadeInFrames !== fadeIn) { timeUpdates.fadeInFrames = fadeIn; timeChanged = true; }
        if ((mod as any).fadeOutFrames !== fadeOut) { timeUpdates.fadeOutFrames = fadeOut; timeChanged = true; }
      }
      
      // 写回（直接更新 modifiers 数组，不触发蓝图 sync）
      if (paramsChanged || blendModeChanged || timeChanged || enabledChanged) {
        const sk = useProjectStore.getState().puppetSkeletons.find(s => s.id === skeleton.id);
        const nd = sk?.nodes.find(n => n.id === node.id);
        if (nd) {
          const updatedMods = (nd.modifiers ?? []).map((m: any) => {
            if (m.id !== mod.id) return m;
            const updated: any = { ...m };
            if (paramsChanged) updated.params = updatedParams;
            if (blendModeChanged) updated.blendMode = newBlendMode;
            if (enabledChanged) updated.enabled = newEnabled;
            if (timeChanged) Object.assign(updated, timeUpdates);
            return updated;
          });
          useProjectStore.getState().updatePuppetNode(skeleton.id, node.id, { modifiers: updatedMods } as any);
        }
      }
    }
  };

  // 创建空蓝图（含输出节点）
  const createBlueprint = () => {
    if (!skeleton || !node) return;
    const outputId = `node_${Date.now().toString(36)}`;
    const graph: BlueprintGraph = {
      version: 1,
      nodes: [
        {
          id: outputId,
          type: 'transform',
          inputs: {},
          params: {},
          ui: { x: 200, y: 100 },
        },
      ],
      outputId,
    };
    useProjectStore.getState().updatePuppetNode(skeleton.id, node.id, { blueprint: graph });
  };

  if (!node || !skeleton) return null;

  const handleAdd = () => {
    addPuppetNodeModifier(skeleton.id, node.id, addingType);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-400">
          程序化修改器 · {node.name}
        </Label>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('modifiers')}
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              activeTab === 'modifiers'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            列表
          </button>
          <button
            onClick={() => setActiveTab('blueprint')}
            className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
              activeTab === 'blueprint'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Network className="size-2.5" />
            蓝图
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              activeTab === 'templates'
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            模板
          </button>
        </div>
      </div>

      {activeTab === 'templates' ? (
        <BlueprintTemplateLoader skeleton={skeleton} />
      ) : activeTab === 'blueprint' ? (
        <>
          {blueprint ? (
            <BlueprintEditor
              graph={blueprint}
              onChange={updateBlueprint}
              title={`${node.name} 的蓝图`}
              skeleton={skeleton}
              characterNodes={characterNodes}
            />
          ) : (
            <div className="text-center py-4 space-y-2">
              <div className="text-[10px] text-gray-600">
                暂无蓝图
              </div>
              <Button size="sm" onClick={createBlueprint} className="h-7 px-3 text-[10px]">
                <Plus className="size-3 mr-1" /> 创建蓝图
              </Button>
            </div>
          )}
        </>
      ) : (
      <>
      {/* 蓝图存在时，列表修改器不生效，给出警告 */}
      {node.blueprint && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 text-[9px] text-amber-300/90 leading-relaxed">
          ⚠️ 该节点有蓝图，列表里的修改器不会生效。去"蓝图" tab 编辑，或删掉蓝图再用列表。
        </div>
      )}
      {/* 添加 */}
      <div className="flex gap-1.5">
        <select
          value={addingType}
          onChange={(e) => setAddingType(e.target.value as AnimationModifierType)}
          className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1.5 py-1 text-[10px] text-gray-300"
        >
          {PUPPET_MODIFIER_TYPES.map((t) => {
            const def = getModifierDef(t);
            return (
              <option key={t} value={t}>
                {def?.label ?? t}
              </option>
            );
          })}
        </select>
        <Button size="sm" onClick={handleAdd} className="h-7 px-2 text-[10px]">
          <Plus className="size-3 mr-0.5" />
          添加
        </Button>
      </div>

      {/* 列表 */}
      {modifiers.length === 0 && (
        <div className="text-[10px] text-gray-600 text-center py-3">
          暂无修改器。加一个 pendulum 试试摆动。
        </div>
      )}
      <div className="space-y-1.5">
        {modifiers.map((m) => (
          <ModifierRow
            key={m.id}
            modifier={m}
            partId={node.spritePartId}
            expanded={expandedId === m.id}
            onToggleExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
            onToggle={() => togglePuppetNodeModifier(skeleton.id, node.id, m.id)}
            onRemove={() => removePuppetNodeModifier(skeleton.id, node.id, m.id)}
            onUpdateParam={(name, value) =>
              updatePuppetNodeModifier(skeleton.id, node.id, m.id, { [name]: value })
            }
            blueprintNode={node.blueprint?.nodes.find(
              n => n.id === `mod_${m.id.replace(/-/g, '').slice(0, 12)}`
            )}
          />
        ))}
      </div>
      </>
      )}
    </div>
  );
}

function ModifierRow({
  modifier,
  partId,
  expanded,
  onToggleExpand,
  onToggle,
  onRemove,
  onUpdateParam,
  blueprintNode,
}: {
  modifier: PartAnimationModifier;
  partId: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onUpdateParam: (name: string, value: number | string | boolean | Array<{ x: number; y: number }>) => void;
  blueprintNode?: { inputs?: Record<string, any>; params?: Record<string, any> };
}) {
  const def = getModifierDef(modifier.type);

  // 检查参数是否被蓝图表达式驱动（inputs 里有连接，而非静态 params）
  const isParamDrivenByExpression = (paramName: string): string | null => {
    if (!blueprintNode?.inputs) return null;
    const input = blueprintNode.inputs[paramName];
    if (input && typeof input === 'object' && 'nodeId' in input) {
      return String(input.nodeId);
    }
    return null;
  };

  return (
    <div
      className={`rounded border ${
        modifier.enabled ? 'border-[#2a2a4a] bg-[#111128]' : 'border-[#1a1a2e] bg-[#0c0c1c] opacity-60'
      }`}
    >
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          onClick={onToggle}
          className="p-0.5 text-gray-400 hover:text-gray-200"
          title={modifier.enabled ? '禁用' : '启用'}
        >
          {modifier.enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 flex items-center gap-1 text-left"
        >
          <span className="text-[10px] text-gray-200 truncate flex-1 min-w-0">
            {def?.label ?? modifier.type}
          </span>
          <ChevronDown
            className={`size-3 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          onClick={onRemove}
          className="p-0.5 text-gray-500 hover:text-red-400"
          title="删除"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {expanded && def && (
        <div className="px-2 pb-2 space-y-1 border-t border-[#1e1e3a] pt-1.5">
          {def.params.map((p) => {
            const val = modifier.params[p.name] ?? p.default;
            const exprNodeId = isParamDrivenByExpression(p.name);
            return (
              <div key={p.name} className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-500 w-20 truncate flex-shrink-0" title={p.label}>
                  {p.label}
                </span>
                {exprNodeId ? (
                  // 参数被蓝图表达式驱动 → 显示表达式标识，不可直接编辑
                  <div
                    className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#3a3a6a] rounded px-1 py-0.5 text-[10px] text-purple-300 flex items-center gap-1"
                    title={`由蓝图节点驱动: ${exprNodeId}\n去蓝图 tab 编辑，或断开连接恢复静态值`}
                  >
                    <span className="truncate">ƒ {exprNodeId.slice(0, 12)}</span>
                  </div>
                ) : p.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => onUpdateParam(p.name, e.target.checked)}
                    className="size-3"
                  />
                ) : p.type === 'select' && p.options ? (
                  <select
                    value={String(val)}
                    onChange={(e) => onUpdateParam(p.name, e.target.value)}
                    className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
                  >
                    {p.options.map((opt) => (
                      <option key={String(opt.value)} value={String(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : p.type === 'color' ? (
                  <input
                    type="color"
                    value={String(val) || '#000000'}
                    onChange={(e) => onUpdateParam(p.name, e.target.value)}
                    className="flex-1 min-w-0 h-6 bg-[#0a0a1a] border border-[#2a2a4a] rounded cursor-pointer"
                  />
                ) : p.type === 'string' ? (
                  <input
                    type="text"
                    value={String(val ?? '')}
                    onChange={(e) => onUpdateParam(p.name, e.target.value)}
                    className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300"
                  />
                ) : p.type === 'path' ? (
                  <div className="flex-1 min-w-0">
                    <PathEditor
                      value={Array.isArray(val) ? (val as Array<{ x: number; y: number }>) : []}
                      onChange={(path) => onUpdateParam(p.name, path)}
                      pathType={String(modifier.params.pathType ?? 'polyline') as 'polyline' | 'bezier'}
                    />
                  </div>
                ) : (
                  <input
                    type="number"
                    value={Number(val)}
                    step={p.step ?? 0.1}
                    min={p.min}
                    max={p.max}
                    onChange={(e) => onUpdateParam(p.name, Number(e.target.value))}
                    className="flex-1 min-w-0 bg-[#0a0a1a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[10px] text-gray-300 tabular-nums"
                  />
                )}
              </div>
            );
          })}
          {def.params.length === 0 && (
            <div className="text-[9px] text-gray-600">无可调参数</div>
          )}
          {/* bump_light: 高度图绘制 */}
          {modifier.type === 'bump_light' && partId && (
            <HeightmapSection partId={partId} />
          )}
        </div>
      )}
    </div>
  );
}
