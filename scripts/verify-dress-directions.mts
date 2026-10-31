// 换装八方向验收探针（用户裁定：换装页签应为八个方向）
// 覆盖：
//  A) 源码级——DressPanel 的 DIRECTIONS 恰含 0-7 八个方向值、标签与
//     sprite-folder 的 DIRECTION_FOLDER_NAMES 规范名逐一相等、排列为
//     罗盘顺时针自南起；文件内不再残留「四个方向」类文案
//  B) 构造级——resolvePieceSprite 对斜向（7 东南）：直配图优先于
//     mirrorMap 镜像回落；无直配时才走镜像（对照组，证明 A 的对拍
//     不是空转）；变体层斜向直达优先于基础层斜向直达

import { readFileSync } from 'node:fs';
import { DIRECTION_FOLDER_NAMES } from '../src/lib/sprite-folder';
import { resolvePieceSprite } from '../src/lib/sprite-resolve';
import type { CostumePiece, DirectionIndex, Sprite } from '../src/lib/unified-types';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

// ---------- A) DIRECTIONS 常量 ----------
const src = readFileSync(new URL('../src/components/pixel-editor/puppet/DressPanel.tsx', import.meta.url), 'utf8');
const blockMatch = src.match(/const DIRECTIONS[^[]*\[([\s\S]*?)\];/);
ok(!!blockMatch, 'DressPanel 中找到 DIRECTIONS 常量');
const entries: { value: number; label: string }[] = [];
if (blockMatch) {
  for (const m of blockMatch[1].matchAll(/\{\s*value:\s*(\d+),\s*label:\s*'([^']+)'\s*\}/g)) {
    entries.push({ value: Number(m[1]), label: m[2] });
  }
}
ok(entries.length === 8, `DIRECTIONS 恰 8 条（实际 ${entries.length}）`);
const values = entries.map((e) => e.value);
ok(new Set(values).size === 8 && [0, 1, 2, 3, 4, 5, 6, 7].every((v) => values.includes(v)), '方向值恰含 0-7 各一次');
ok(entries.every((e) => DIRECTION_FOLDER_NAMES[e.value] === e.label), '每个标签与 sprite-folder 规范名相等');
ok(JSON.stringify(values) === JSON.stringify([6, 7, 0, 1, 2, 3, 4, 5]), '排列为罗盘顺时针自南起（南/东南/东/东北/北/西北/西/西南）');
ok(!src.includes('四个方向') && !src.includes('四方向精灵编辑器'), '文件内无四向残留文案');

// ---------- B) 斜向解析：直达优先于镜像 ----------
const spr = (id: string) => ({ id } as unknown as Sprite);
const pieceBase = {
  slotKey: 'torso',
  fillColor: '#888888',
  scaleVariants: {},
  crossSections: [],
} as unknown as CostumePiece;

const pieceDirect: CostumePiece = {
  ...pieceBase,
  sprites: { 7: spr('se-direct'), 0: spr('e-base') },
  mirrorMap: { 7: 0 as DirectionIndex },
};
const rDirect = resolvePieceSprite(pieceDirect, 7 as DirectionIndex, undefined);
ok(rDirect.sprite?.id === 'se-direct' && rDirect.mirror === false, '东南(7)有直配图时直达命中且 mirror=false（不走 mirrorMap[7]=0）');

const pieceMirrorOnly: CostumePiece = {
  ...pieceBase,
  sprites: { 0: spr('e-base') },
  mirrorMap: { 7: 0 as DirectionIndex },
};
const rMirror = resolvePieceSprite(pieceMirrorOnly, 7 as DirectionIndex, undefined);
ok(rMirror.sprite?.id === 'e-base' && rMirror.mirror === true, '对照组：东南(7)无直配时回落镜像东(0)且 mirror=true');

const pieceVariant: CostumePiece = {
  ...pieceBase,
  sprites: { 7: spr('se-base') },
  variantSprites: { v1: { 7: spr('se-variant') } },
  mirrorMap: { 7: 0 as DirectionIndex },
};
const rVariant = resolvePieceSprite(pieceVariant, 7 as DirectionIndex, 'v1');
ok(rVariant.sprite?.id === 'se-variant' && rVariant.mirror === false, '变体层东南(7)直达优先于基础层东南(7)直达');

console.log(`\nverify-dress-directions: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
