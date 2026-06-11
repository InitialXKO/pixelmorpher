'use client';

import { useState, useCallback } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Move,
  RotateCw,
  Maximize2,
  Zap,
  ArrowUpFromLine,
  Heart,
  Cloud,
  Rotate3d,
  Timer,
  Radio,
  Activity,
  Code2,
  Shuffle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/components/ui/context-menu';
import { useProjectStore } from '@/lib/store';
import { GLOBAL_MODIFIER_DEFINITIONS } from '@/lib/types';
import type { GlobalModifierType, GlobalModifier, ModifierParamValue } from '@/lib/types';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  translate: <Move className="size-3" />,
  rotate: <RotateCw className="size-3" />,
  uniform_scale: <Maximize2 className="size-3" />,
  shake: <Zap className="size-3" />,
  bounce: <ArrowUpFromLine className="size-3" />,
  breath: <Heart className="size-3" />,
  float: <Cloud className="size-3" />,
  wobble: <Rotate3d className="size-3" />,
  pendulum: <Timer className="size-3" />,
  noise: <Radio className="size-3" />,
  wave: <Activity className="size-3" />,
  spring: <Zap className="size-3" />,
  jitter: <Shuffle className="size-3" />,
  expression: <Code2 className="size-3" />,
};

function GlobalModifierCard({ modifier }: { modifier: GlobalModifier }) {
  const {
    updateGlobalModifier,
    updateGlobalModifierParams,
    toggleGlobalModifier,
    removeGlobalModifier,
    reorderGlobalModifier,
  } = useProjectStore();

  const [collapsed, setCollapsed] = useState(!modifier.enabled);
  const def = GLOBAL_MODIFIER_DEFINITIONS.find((d) => d.type === modifier.type);

  const handleParamChange = useCallback((paramName: string, value: ModifierParamValue) => {
    updateGlobalModifierParams(modifier.id, { [paramName]: value });
  }, [modifier.id, updateGlobalModifierParams]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={`group border rounded-md transition-colors ${
          modifier.enabled
            ? 'bg-zinc-900/80 border-zinc-800'
            : 'bg-zinc-950/50 border-zinc-800/50 opacity-60'
        }`}>
          {/* Header */}
          <div
            className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none"
            onClick={() => setCollapsed(!collapsed)}
          >
            <span className="text-zinc-500">
              {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
            </span>
            <span className="text-purple-400">
              {TYPE_ICONS[modifier.type] || <Globe className="size-3" />}
            </span>
            <span className="text-[10px] font-medium text-zinc-200 flex-1 truncate">
              {modifier.name}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={`h-4 w-4 p-0 ${modifier.enabled ? 'text-purple-400' : 'text-zinc-600'}`}
                onClick={(e) => { e.stopPropagation(); toggleGlobalModifier(modifier.id); }}
                title={modifier.enabled ? '禁用' : '启用'}
              >
                {modifier.enabled ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
              </Button>
            </div>
          </div>

          {/* Parameters */}
          {!collapsed && def && (
            <div className="px-2 pb-2 space-y-1.5 border-t border-zinc-800/50 pt-1.5">
              {def.params.map((param) => (
                <div key={param.name} className="flex items-center gap-2">
                  <label className="text-[9px] text-zinc-500 w-16 shrink-0 truncate" title={param.label}>
                    {param.label}
                  </label>
                  {param.type === 'boolean' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-5 text-[9px] px-2 ${modifier.params[param.name] ? 'text-purple-400' : 'text-zinc-600'}`}
                      onClick={() => handleParamChange(param.name, !modifier.params[param.name])}
                    >
                      {modifier.params[param.name] ? '开' : '关'}
                    </Button>
                  ) : param.type === 'select' ? (
                    <select
                      value={String(modifier.params[param.name] ?? param.default)}
                      onChange={(e) => handleParamChange(param.name, e.target.value)}
                      className="h-5 text-[9px] bg-zinc-800 border border-zinc-700 rounded px-1 flex-1 text-zinc-300"
                    >
                      {param.options?.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : param.type === 'color' ? (
                    <input
                      type="color"
                      value={String(modifier.params[param.name] ?? param.default)}
                      onChange={(e) => handleParamChange(param.name, e.target.value)}
                      className="h-5 w-8 bg-transparent border-0 cursor-pointer"
                    />
                  ) : (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        type="number"
                        value={Number(modifier.params[param.name] ?? param.default)}
                        onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                        step={param.step ?? 1}
                        min={param.min}
                        max={param.max}
                        className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                      />
                      {param.min !== undefined && param.max !== undefined && (
                        <input
                          type="range"
                          value={Number(modifier.params[param.name] ?? param.default)}
                          onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                          min={param.min}
                          max={param.max}
                          step={param.step ?? 1}
                          className="flex-1 h-1 accent-purple-500"
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Effective range */}
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/30">
                <label className="text-[9px] text-zinc-600 w-16 shrink-0">起始帧</label>
                <Input
                  type="number"
                  value={modifier.startFrame === -1 ? '' : modifier.startFrame}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateGlobalModifier(modifier.id, { startFrame: v === '' ? -1 : Number(v) });
                  }}
                  placeholder="始终"
                  className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[9px] text-zinc-600 w-16 shrink-0">结束帧</label>
                <Input
                  type="number"
                  value={modifier.endFrame === -1 ? '' : modifier.endFrame}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateGlobalModifier(modifier.id, { endFrame: v === '' ? -1 : Number(v) });
                  }}
                  placeholder="始终"
                  className="h-5 text-[9px] bg-zinc-800 border-zinc-700 flex-1"
                />
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="bg-zinc-900 border-zinc-700 min-w-[140px]">
        <ContextMenuLabel className="text-[10px] text-zinc-400 py-1.5">
          {modifier.name}
        </ContextMenuLabel>
        <ContextMenuSeparator className="bg-zinc-800" />
        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => toggleGlobalModifier(modifier.id)}
        >
          {modifier.enabled ? <EyeOff className="size-3 mr-1.5 text-zinc-400" /> : <Eye className="size-3 mr-1.5 text-zinc-400" />}
          {modifier.enabled ? '禁用' : '启用'}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => reorderGlobalModifier(modifier.id, 'up')}
        >
          <ArrowUp className="size-3 mr-1.5 text-zinc-400" />
          上移
        </ContextMenuItem>
        <ContextMenuItem
          className="text-[11px] text-zinc-300 focus:bg-zinc-700 focus:text-zinc-100 py-1.5 cursor-pointer"
          onClick={() => reorderGlobalModifier(modifier.id, 'down')}
        >
          <ArrowDown className="size-3 mr-1.5 text-zinc-400" />
          下移
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-zinc-800" />
        <ContextMenuItem
          className="text-[11px] text-red-400 focus:bg-red-600/20 focus:text-red-300 py-1.5 cursor-pointer"
          variant="destructive"
          onClick={() => removeGlobalModifier(modifier.id)}
        >
          <Trash2 className="size-3 mr-1.5" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function GlobalModifierPanel() {
  const { globalModifiers = [], addGlobalModifier } = useProjectStore();
  const [showAddMenu, setShowAddMenu] = useState(false);

  const handleAdd = useCallback((type: GlobalModifierType) => {
    addGlobalModifier(type);
    setShowAddMenu(false);
  }, [addGlobalModifier]);

  const transformTypes = GLOBAL_MODIFIER_DEFINITIONS.filter((d) => d.category === 'transform');
  const animTypes = GLOBAL_MODIFIER_DEFINITIONS.filter((d) => d.category === 'animation');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-800/50">
        <div className="flex items-center gap-1.5">
          <Globe className="size-3 text-purple-400" />
          <span className="text-[10px] font-medium text-zinc-300">全局修改器</span>
          <span className="text-[9px] text-zinc-600">({globalModifiers.length})</span>
        </div>
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-zinc-500 hover:text-purple-400"
            onClick={() => setShowAddMenu(!showAddMenu)}
            title="添加全局修改器"
          >
            <Plus className="size-3" />
          </Button>
          {showAddMenu && (
            <div className="absolute right-0 top-6 z-50 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg min-w-[140px] py-1">
              <div className="px-2 py-1 text-[9px] text-zinc-500 uppercase tracking-wider">变换</div>
              {transformTypes.map((def) => (
                <button
                  key={def.type}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                  onClick={() => handleAdd(def.type)}
                >
                  {TYPE_ICONS[def.type]}
                  {def.label}
                </button>
              ))}
              <div className="px-2 py-1 mt-1 text-[9px] text-zinc-500 uppercase tracking-wider border-t border-zinc-800">动画</div>
              {animTypes.map((def) => (
                <button
                  key={def.type}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                  onClick={() => handleAdd(def.type)}
                >
                  {TYPE_ICONS[def.type]}
                  {def.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modifier list */}
      <div className="flex-1 overflow-auto py-1 px-1">
        {globalModifiers.length === 0 ? (
          <div className="text-center py-6">
            <Globe className="size-6 text-zinc-800 mx-auto mb-2" />
            <p className="text-[10px] text-zinc-600">暂无全局修改器</p>
            <p className="text-[9px] text-zinc-700 mt-0.5">点击 + 添加全局效果</p>
          </div>
        ) : (
          <div className="space-y-1">
            {globalModifiers.map((mod) => (
              <GlobalModifierCard key={mod.id} modifier={mod} />
            ))}
          </div>
        )}
      </div>

      {/* Click outside to close add menu */}
      {showAddMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowAddMenu(false)}
        />
      )}
    </div>
  );
}
