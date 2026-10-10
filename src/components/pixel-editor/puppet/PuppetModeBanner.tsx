'use client';

import React from 'react';
import { Users, Bone, Shirt, Grab } from 'lucide-react';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { useProjectStore } from '@/lib/store';

/** 画布顶部：木偶工作区阶段提示条 */
export default function PuppetModeBanner() {
  const phase = usePuppetSessionStore((s) => s.phase);
  const performArmed = usePuppetSessionStore((s) => s.performArmed);
  const performCharacterId = usePuppetSessionStore((s) => s.performCharacterId);
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters) ?? [];

  const character = puppetCharacters.find((c) => c.id === performCharacterId);

  const config = {
    rig: {
      icon: <Bone className="size-3.5 text-cyan-400" />,
      title: '搭建',
      hint: '在右侧面板定义骨骼结构、节点层级与静止姿态',
    },
    dress: {
      icon: <Shirt className="size-3.5 text-cyan-400" />,
      title: '换装',
      hint: '为每个节点分配精灵与方向（8 方向）',
    },
    perform: {
      icon: <Grab className="size-3.5 text-emerald-400" />,
      title: performArmed ? `操控中 · ${character?.name ?? ''}` : '操控',
      hint: performArmed
        ? '拖动肢体旋转 · Shift+拖移动节点 · Alt+拖移动整体 · Q/E 旋转 · 双击节点编辑精灵'
        : '在右侧面板选择角色并点击「开始操控」',
    },
  }[phase];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 border-b border-cyan-500/20 shrink-0">
      {config.icon}
      <span className="text-xs font-medium text-cyan-300 flex items-center gap-1 min-w-0 truncate flex-shrink-0 max-w-[45%]">
        <Users className="size-3 text-cyan-500/60 flex-shrink-0" />
        <span className="truncate">{config.title}</span>
      </span>
      <span className="text-[10px] text-cyan-400/50 truncate flex-1 min-w-0">— {config.hint}</span>
      {phase === 'perform' && performArmed && (
        <span className="ml-auto size-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" title="操控已武装" />
      )}
    </div>
  );
}
