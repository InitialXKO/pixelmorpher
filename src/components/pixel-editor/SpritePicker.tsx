'use client';
/**
 * SpritePicker — 全仓共用精灵选择器（research/sprite-management）
 *
 * 盘点实锤：选精灵的界面现有三套互不相通的写法（DressPanel
 * 内嵌缩略图网格、SkeletonPanel 文字名单、左侧列表纯文字
 * 行）。这里收成一个组件：搜索框（名字过滤）+ 缩略图网格
 * + 当前选中高亮，各调用面只给 sprites 与 onPick。
 *
 * 不含数据层改动：分组/标签的组织模型在 DESIGN 里列为
 * 待决选项，本组件先按「全部 + 搜索」呈现，留 groupBy
 * 扩展口（传入分组函数即按组分段渲染）。
 */
import { useMemo, useState } from 'react';
import type { Sprite } from '@/lib/unified-types';
import { filterSpritesByQuery } from '@/lib/sprite-thumb';
import { compareFolderKeys, NO_FOLDER_LABEL } from '@/lib/sprite-folder';
import SpriteThumb from './SpriteThumb';

export default function SpritePicker({
  sprites,
  onPick,
  selectedId,
  thumbSize = 36,
  maxHeightClass = 'max-h-40',
  groupBy,
}: {
  sprites: readonly Sprite[];
  onPick: (spriteId: string | null, sprite: Sprite) => void;
  selectedId?: string | null;
  thumbSize?: number;
  maxHeightClass?: string;
  /** 可选分组：返回组名（'' = 不分组，排最前一段无标题） */
  groupBy?: (sprite: Sprite) => string;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterSpritesByQuery(sprites, query), [sprites, query]);
  const groups = useMemo(() => {
    if (!groupBy) return [{ name: '', items: filtered }];
    const map = new Map<string, Sprite[]>();
    for (const sp of filtered) {
      const g = groupBy(sp);
      const arr = map.get(g) ?? [];
      arr.push(sp);
      map.set(g, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => compareFolderKeys(a, b))
      .map(([name, items]) => ({ name: name === '' ? NO_FOLDER_LABEL : name, items }));
  }, [filtered, groupBy]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`搜索精灵（共 ${sprites.length} 张）`}
        className="h-6 w-full text-[10px] bg-[#0a0a1e] border border-[#1e1e3a] rounded px-1.5 text-gray-300 mb-1"
      />
      <div className={`${maxHeightClass} overflow-y-auto`}>
        {filtered.length === 0 && (
          <div className="text-[9px] text-gray-600 py-2 text-center">没有匹配的精灵</div>
        )}
        {groups.map((g) => (
          <div key={g.name || '_'} className="mb-1">
            {g.name && <div className="text-[9px] text-gray-500 px-0.5 py-0.5">{g.name}（{g.items.length}）</div>}
            <div className="grid grid-cols-3 gap-1">
              {g.items.map((sp) => (
                <div
                  key={sp.id ?? sp.name}
                  onClick={() => onPick(sp.id ?? null, sp)}
                  className={`p-1 rounded cursor-pointer flex flex-col items-center gap-0.5 ${
                    sp.id && sp.id === selectedId
                      ? 'bg-cyan-500/30 outline outline-1 outline-cyan-400/60'
                      : 'bg-black/30 hover:bg-cyan-500/20'
                  }`}
                  title={sp.name ?? sp.id}
                >
                  <SpriteThumb sprite={sp} size={thumbSize} />
                  <span className="text-[8px] text-gray-400 truncate w-full text-center">{sp.name ?? sp.id?.slice(0, 12)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
