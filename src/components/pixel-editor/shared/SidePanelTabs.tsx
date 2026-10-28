'use client';

import { useState, type ReactNode } from 'react';

export interface SidePanelTabDef<T extends string = string> {
  id: T;
  /** 页签短标签（竖排页签栏里图标下的小字） */
  label: string;
  icon: ReactNode;
  content: ReactNode;
  /**
   * 内容高度/滚动模型：
   * - 'panel'（缺省）：面板自带 h-full 根与内部滚动，容器只给整高。
   * - 'scroll'：内容是无根片段（如右栏各段），容器提供整高滚动。
   */
  scrollMode?: 'panel' | 'scroll';
}

interface Props<T extends string = string> {
  tabs: SidePanelTabDef<T>[];
  activeId: T;
  onChange: (id: T) => void;
  /** 页签栏贴哪一侧栏边：左栏贴左、右栏贴右（屏幕外缘） */
  side: 'left' | 'right';
  ariaLabel: string;
}

/**
 * 侧面页签容器：一次只显示一个面板、独占整栏高度，取代多面板自上
 * 而下堆叠（堆叠必然溢出：每块都想占高，分高只是把溢出变小）。
 *
 * 挂载策略：页签内容「首次激活才挂载、挂载后永不卸载」，非激活以
 * hidden 隐藏——① 保住各面板本地 UI 状态（展开/编辑中状态不丢）；
 * ② 免于重复挂载成本（如程序化预览的播放器）；③ 避免面板在
 * display:none 下以 0 尺寸初始化（预览播放器按容器尺寸建画布）。
 */
export default function SidePanelTabs<T extends string>({ tabs, activeId, onChange, side, ariaLabel }: Props<T>) {
  const [visited, setVisited] = useState<ReadonlySet<T>>(() => new Set([activeId]));
  const activate = (id: T) => {
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    onChange(id);
  };

  const rail = (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex flex-col shrink-0 w-[46px] py-1 gap-0.5 bg-[#0a0a14] ${
        side === 'left' ? 'border-r border-zinc-800/70' : 'border-l border-zinc-800/70'
      }`}
    >
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => activate(t.id)}
            className={`relative flex flex-col items-center gap-0.5 py-2 mx-1 rounded transition-colors ${
              active
                ? 'bg-white/10 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
            }`}
          >
            {active && (
              <span
                className={`absolute top-1.5 bottom-1.5 w-0.5 rounded bg-cyan-400 ${
                  side === 'left' ? '-left-1' : '-right-1'
                }`}
              />
            )}
            {t.icon}
            <span className="text-[9px] leading-tight">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {side === 'left' && rail}
      <div className="flex-1 min-w-0 min-h-0">
        {tabs.map((t) => {
          // 外部直接改 activeId（如统一新建入口切页签）时也要能显示
          if (!visited.has(t.id) && t.id !== activeId) return null;
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              role="tabpanel"
              className={
                active
                  ? t.scrollMode === 'scroll'
                    ? 'h-full min-h-0 overflow-y-auto overflow-x-hidden'
                    : 'h-full min-h-0'
                  : 'hidden'
              }
            >
              {t.content}
            </div>
          );
        })}
      </div>
      {side === 'right' && rail}
    </div>
  );
}
