/**
 * verify-sprite-mgmt.mts — 精灵管理纵切探针
 * （research/sprite-management）
 *
 * 断言：等比适配不变形（宽/高/极端比/零尺寸）、名字过
 * 滤口径、共用选择器接线（DressPanel 无本地缩略图实
 * 现、左侧列表用共用缩略图+搜索）。
 */
import { readFileSync } from 'node:fs';
import { thumbFitRect, filterSpritesByQuery, THUMB_MAX } from '../src/lib/sprite-thumb';

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`✓ ${name}`);
}

// ---------- 1) 等比适配 ----------
{
  const sq = thumbFitRect(32, 32, 36);
  check('1a 正方形铺满方框', sq.w === 36 && sq.h === 36 && sq.x === 0 && sq.y === 0);
  const wide = thumbFitRect(64, 16, 36);
  check('1b 宽精灵：宽铺满、高等比、垂直居中',
    wide.w === 36 && wide.h === 9 && wide.x === 0 && wide.y === 13);
  const tall = thumbFitRect(16, 64, 36);
  check('1c 高精灵：高铺满、宽等比、水平居中',
    tall.h === 36 && tall.w === 9 && tall.x === 13 && tall.y === 0);
  const tiny = thumbFitRect(2, 2, 36);
  check('1d 小精灵放大到方框（像素图靠 imageRendering 保持锐利）', tiny.w === 36 && tiny.h === 36);
  check('1e 零尺寸不产出 NaN', (() => {
    const z = thumbFitRect(0, 10, 36);
    return z.w === 0 && z.h === 0 && Number.isFinite(z.x);
  })());
  check('1f 缓存封顶常量在位', THUMB_MAX === 96);
}

// ---------- 2) 名字过滤 ----------
{
  const list = [
    { name: '头部_正面' }, { name: '头部_侧面' }, { name: '左手' }, { name: undefined },
  ];
  check('2a 子串过滤', filterSpritesByQuery(list, '头部').length === 2);
  check('2b 大小写不敏感 + 前后空白',
    filterSpritesByQuery([{ name: 'Arm_L' }], ' arm ').length === 1);
  check('2c 空查询返回全部（含无名）', filterSpritesByQuery(list, '').length === 4);
  check('2d 无名精灵不匹配非空查询', filterSpritesByQuery(list, 'x').length === 0);
}

// ---------- 3) 接线（字符串把守真实消费点） ----------
{
  const dress = readFileSync(new URL('../src/components/pixel-editor/puppet/DressPanel.tsx', import.meta.url), 'utf8');
  check('3a DressPanel：本地逐像素 SpriteThumbnail 已删除',
    !dress.includes('function SpriteThumbnail'));
  check('3b DressPanel：选择器与槽位图走共用组件',
    dress.includes("from '../SpritePicker'") && dress.includes("from '../SpriteThumb'"));
  const panel = readFileSync(new URL('../src/components/pixel-editor/PuppetAssetPanel.tsx', import.meta.url), 'utf8');
  check('3c 左侧列表：行内共用缩略图 + 搜索过滤',
    panel.includes('<SpriteThumb sprite={sprite} size={18}')
    && panel.includes('filterSpritesByQuery(Object.values(sprites), spriteQuery)'));
}

console.log(`\n精灵管理探针全过（${passed} 项）`);
