/**
 * sprite-folder.ts — 精灵文件夹：方向归档（出生方向）
 * （research/sprite-management，用户拍板落地）
 *
 * 口径（DESIGN 附节）：烘焙归档记的是出生方向——图就
 * 是朝那个方向烘出来的稳定事实，不是当前用途。文件夹
 * 在展示前先消掉方向维度，夹内靠部位轮廓认图。
 *
 * - Sprite.folder 是可选字符串（路径式，如「方向/南」），
 *   无字段 = 未分方向，零迁移。
 * - 烘焙在 skeleton-mapper 建精灵时按 dir.direction 写入。
 * - 存量烘焙图按 id 约定 spr_<角色>_<骨序>[_layerN]
 *   [_latN]_<方向> 在导入时一次性回填（只填未设 folder
 *   的，幂等；用户手动移过的夹不被覆盖）。
 */
import type { Sprite } from './unified-types';

/** 方向索引 → 中文名（0=东 起、每 45°；与 DressPanel 标称一致） */
export const DIRECTION_FOLDER_NAMES: Record<number, string> = {
  0: '东', 1: '东北', 2: '北', 3: '西北',
  4: '西', 5: '西南', 6: '南', 7: '东南',
};

/** 未分方向的展示名（folder 为空时的归属） */
export const NO_FOLDER_LABEL = '未分方向';

/** 方向 → 文件夹路径；非法方向返回 null */
export function directionFolder(direction: number): string | null {
  const name = DIRECTION_FOLDER_NAMES[direction];
  return name ? `方向/${name}` : null;
}

/**
 * 解析烘焙精灵 id 的出生方向：
 * spr_<角色>_<骨序>[_layer<层>][_lat<纬度>]_<方向 0-7>
 * 角色 id 本身可含下划线，故从尾部结构化解析。
 */
export function bakedDirectionFromId(id: string | undefined): number | null {
  if (!id || !id.startsWith('spr_')) return null;
  const parts = id.split('_');
  const last = parts[parts.length - 1];
  if (!/^[0-7]$/.test(last)) return null;
  // 骨序必须是数字（layer/lat 段在骨序与方向之间）
  const boneIdx = parts.findIndex((p, i) => i >= 2 && /^\d+$/.test(p));
  if (boneIdx < 0) return null;
  return Number(last);
}

/**
 * 解析烘焙精灵的出生标签（角色/骨）：
 * id 结构 spr_<角色>_<骨序>_…_<方向>（角色 id 可含下
 * 划线，骨序 = 首个纯数字段）；骨名从精灵名剥掉
 * 「 d<方向>」/「 lat<纬度> d<方向>」后缀得到（烘焙命
 * 名约定），剥不掉则不填骨名。非烘焙 id 返回 null。
 */
export function bakedOriginFromIdAndName(
  id: string | undefined, name: string | undefined,
): { characterId: string; boneName?: string } | null {
  if (bakedDirectionFromId(id) === null) return null;
  const parts = id!.split('_');
  const boneIdx = parts.findIndex((p, i) => i >= 2 && /^\d+$/.test(p));
  if (boneIdx < 2) return null;
  const characterId = parts.slice(1, boneIdx).join('_');
  if (!characterId) return null;
  let boneName: string | undefined;
  if (name) {
    const base = name.replace(/( lat\S+)? d[0-7]$/, '');
    if (base && base !== name) boneName = base;
  }
  return { characterId, boneName };
}

/**
 * 出生信息整表回填（folder + origin）：只填未设者，
 * 幂等，用户手动改过的不覆盖。返回变更数。
 */
export function backfillSpriteBirth(
  sprites: Record<string, Sprite>,
): { sprites: Record<string, Sprite>; changed: number } {
  let changed = 0;
  const out: Record<string, Sprite> = {};
  for (const [id, sp] of Object.entries(sprites)) {
    let next = sp;
    if (next.folder === undefined) {
      const dir = bakedDirectionFromId(next.id ?? id);
      const f = dir !== null ? directionFolder(dir) : null;
      if (f) next = { ...next, folder: f };
    }
    if (next.origin === undefined) {
      const o = bakedOriginFromIdAndName(next.id ?? id, next.name);
      if (o) next = { ...next, origin: o };
    }
    if (next !== sp) changed++;
    out[id] = next;
  }
  return { sprites: out, changed };
}

/** 单张精灵的回填后 folder（不回填返回原值） */
export function backfilledFolder(sprite: Pick<Sprite, 'id' | 'folder'>): string | undefined {
  if (sprite.folder !== undefined) return sprite.folder;
  const dir = bakedDirectionFromId(sprite.id);
  if (dir === null) return undefined;
  return directionFolder(dir) ?? undefined;
}

/** 整表回填：只动 folder 未设且 id 可解析者；返回是否有变更（幂等） */
export function backfillSpriteFolders(
  sprites: Record<string, Sprite>,
): { sprites: Record<string, Sprite>; changed: number } {
  let changed = 0;
  const out: Record<string, Sprite> = {};
  for (const [id, sp] of Object.entries(sprites)) {
    const f = backfilledFolder(sp);
    if (f !== undefined && f !== sp.folder) {
      out[id] = { ...sp, folder: f };
      changed++;
    } else {
      out[id] = sp;
    }
  }
  return { sprites: out, changed };
}

/** 文件夹排序：方向夹按方向序在前，其余按名序，未分方向（''）最后 */
export function compareFolderKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  const dirOrder = (key: string): number => {
    const m = /^方向\/(.+)$/.exec(key);
    if (!m) return Number.POSITIVE_INFINITY;
    const idx = Object.entries(DIRECTION_FOLDER_NAMES).find(([, n]) => n === m[1])?.[0];
    return idx === undefined ? Number.POSITIVE_INFINITY : Number(idx);
  };
  const da = dirOrder(a), db = dirOrder(b);
  if (da !== db) return da - db;
  return a.localeCompare(b);
}

/**
 * 按文件夹分组（呈现用）：方向夹按方向序在前，其余夹
 * 按名序，未分方向最后。组内保持输入顺序。
 */
export function groupSpritesByFolder<T extends Pick<Sprite, 'folder'>>(
  list: readonly T[],
): { folder: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const sp of list) {
    const key = sp.folder ?? '';
    const arr = map.get(key) ?? [];
    arr.push(sp);
    map.set(key, arr);
  }
  const keys = [...map.keys()].sort(compareFolderKeys);
  return keys.map((key) => ({
    folder: key,
    label: key === '' ? NO_FOLDER_LABEL : key,
    items: map.get(key)!,
  }));
}
