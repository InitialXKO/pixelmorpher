'use client';

import React from 'react';
import {
  Plug,
  Link2,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store';
import type {
  Character,
  Node,
} from '@/lib/unified-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NODE_COLOR_PRESETS } from './types';

/** 更新当前选中节点的 attachment.discColor */
function useUpdateDiscColor(
  characterId: string | null,
  selectedNodeId: string | null,
) {
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  return (discColor: string | null) => {
    if (!characterId || !selectedNodeId) return;
    const node = useProjectStore.getState().unifiedCharacters[characterId]?.nodes[selectedNodeId];
    if (!node) return;
    updateUnifiedNode(characterId, selectedNodeId, {
      attachment: { ...node.attachment, discColor },
    });
  };
}

/** 更新当前选中节点的 attachment（socket 模式字段） */
function useUpdateAttachment(
  characterId: string | null,
  selectedNodeId: string | null,
) {
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  return (updates: Partial<import('@/lib/unified-types').Attachment>) => {
    if (!characterId || !selectedNodeId) return;
    const node = useProjectStore.getState().unifiedCharacters[characterId]?.nodes[selectedNodeId];
    if (!node) return;
    updateUnifiedNode(characterId, selectedNodeId, {
      attachment: { ...node.attachment, ...updates },
    });
  };
}

/**
 * M2: 连接前环检测。沿 parent 链上行：若目标插口的属主是自身或自身的后代，
 * 则连接会形成环，导致渲染/编辑器叠加层无限递归栈溢出。
 */
function wouldCreateCycle(
  character: Character,
  childNodeId: string,
  targetSocketId: string,
): boolean {
  const nodes = Object.values(character.nodes);
  const owner = nodes.find((n) => n.sockets.some((so) => so.id === targetSocketId));
  if (!owner) return true; // 悬空插口：视为非法
  if (owner.id === childNodeId) return true;
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    const parentSocketId = n.attachment?.type === 'socket' ? n.attachment.parentSocketId : undefined;
    if (!parentSocketId) continue;
    const p = nodes.find((m) => m.sockets.some((so) => so.id === parentSocketId));
    if (p) parentOf.set(n.id, p.id);
  }
  let cur: string | undefined = owner.id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === childNodeId) return true;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}

interface PlugConnectionEditorProps {
  characterId: string | null;
  selectedNodeId: string | null;
  selectedNode: Node;
  character: Character;
}

export default function PlugConnectionEditor({
  characterId,
  selectedNodeId,
  selectedNode,
  character,
}: PlugConnectionEditorProps) {
  const updateDiscColor = useUpdateDiscColor(characterId, selectedNodeId);
  const updateAttachment = useUpdateAttachment(characterId, selectedNodeId);
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const attachment = selectedNode.attachment;
  const isSocketAttached = attachment?.type === 'socket' && !!attachment.parentSocketId;
  const discColor = attachment?.discColor ?? null;

  const setPlugNull = () => {
    if (!characterId || !selectedNodeId) return;
    // 断开连接：切回 fixed 模式（无父连接）
    updateUnifiedNode(characterId, selectedNodeId, {
      attachment: { ...attachment, type: 'fixed' as const, parentSocketId: undefined },
    });
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-[9px] text-gray-600 uppercase tracking-wider">连接 (Plug)</Label>
      {!isSocketAttached ? (
        <p className="text-[8px] text-gray-500">根节点 — 无父连接</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Plug className="size-2.5 text-yellow-500/70" />
            <select
              value={attachment.parentSocketId ?? ''}
              onChange={(e) => {
                const newSocketId = e.target.value;
                // M2: 空值 = 断开连接（之前会写成 socketId:"" 的悬空 plug）
                if (!newSocketId) {
                  setPlugNull();
                  return;
                }
                // M2: 环检测
                if (wouldCreateCycle(character, selectedNodeId!, newSocketId)) {
                  alert('无法连接：这会形成循环引用（目标是自身或自身的子孙节点）');
                  return;
                }
                updateAttachment({ type: 'socket', parentSocketId: newSocketId });
              }}
              className="flex-1 h-5 text-[8px] bg-[#080818] border border-[#1e1e3a] rounded px-1 text-gray-300"
            >
              <option value="">— 选择父插口 —</option>
              {Object.values(character.nodes)
                .filter(n => n.id !== selectedNodeId)
                .flatMap(n => n.sockets.map(s => (
                  <option key={s.id} value={s.id}>
                    {n.name} / {s.name}
                  </option>
                )))
              }
            </select>
          </div>
          <div className="flex items-center gap-1 pl-4">
            <Label className="text-[8px] text-gray-600 w-4">X</Label>
            <Input
              type="number"
              value={attachment.plug?.x ?? 0}
              onChange={(e) => {
                updateAttachment({ plug: { ...(attachment.plug ?? { x: 0, y: 0 }), x: Number(e.target.value) } });
              }}
              className="h-4 text-[8px] bg-[#080818] border-[#1e1e3a] w-12"
            />
            <Label className="text-[8px] text-gray-600 w-4">Y</Label>
            <Input
              type="number"
              value={attachment.plug?.y ?? 0}
              onChange={(e) => {
                updateAttachment({ plug: { ...(attachment.plug ?? { x: 0, y: 0 }), y: Number(e.target.value) } });
              }}
              className="h-4 text-[8px] bg-[#080818] border-[#1e1e3a] w-12"
            />
          </div>
          {/* 关节盘颜色：不限于预设枚举，可自定义；为空 = 自动取子节点精灵开口处颜色 */}
          <div className="space-y-1 pl-4 pt-1">
            <div className="flex items-center gap-1">
              <Label className="text-[8px] text-gray-600">关节盘颜色</Label>
              {discColor == null && (
                <span className="text-[8px] text-cyan-500/70">自动</span>
              )}
              {discColor != null && (
                <button
                  className="text-[8px] text-gray-600 hover:text-gray-300 ml-auto"
                  onClick={() => updateDiscColor(null)}
                  title="恢复自动（取开口处精灵颜色）"
                >
                  恢复自动
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5 flex-wrap">
              {NODE_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  className={`size-3.5 rounded-full border transition-transform ${
                    discColor === c
                      ? 'border-white scale-125'
                      : 'border-transparent hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => updateDiscColor(c)}
                  title={c}
                />
              ))}
              <label
                className="relative size-3.5 rounded-full border border-dashed border-gray-600 hover:scale-110 transition-transform cursor-pointer overflow-hidden"
                title="自定义颜色"
              >
                <input
                  type="color"
                  value={discColor ?? '#888888'}
                  onChange={(e) => updateDiscColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <span className="absolute inset-0 flex items-center justify-center text-[8px] text-gray-400 pointer-events-none">+</span>
              </label>
              {discColor != null && (
                <span
                  className="size-3.5 rounded-full border border-white/40"
                  style={{ backgroundColor: discColor }}
                  title={`当前: ${discColor}`}
                />
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[8px] h-5 text-yellow-500/70 hover:text-yellow-400"
            onClick={setPlugNull}
          >
            断开连接
          </Button>
        </div>
      )}
      {/* Allow connecting a root node to a parent */}
      {!isSocketAttached && Object.values(character.nodes).some(n => n.id !== selectedNodeId && n.sockets.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-[8px] h-5 text-cyan-400 hover:text-cyan-300"
          onClick={() => {
            const otherNode = Object.values(character.nodes).find(n => n.id !== selectedNodeId && n.sockets.length > 0);
            if (otherNode) {
              const firstSocket = otherNode.sockets[0];
              // M2: 环检测
              if (wouldCreateCycle(character, selectedNodeId!, firstSocket.id)) {
                alert('无法连接：这会形成循环引用（目标是自身的子孙节点）');
                return;
              }
              updateAttachment({ type: 'socket', parentSocketId: firstSocket.id, plug: { x: 0, y: 0 } });
            }
          }}
        >
          <Link2 className="size-2.5 mr-1" /> 连接到父节点
        </Button>
      )}
    </div>
  );
}
