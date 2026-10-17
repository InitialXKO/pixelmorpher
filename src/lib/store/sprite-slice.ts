// ============================================================
// PixelMorpher - Sprite Slice
// Global sprite table (replaces Part). Sprites are the single pixel
// asset type, referenced by ID from CostumePiece. No tracks — sprites
// are pure assets, not timeline items.
// ============================================================

import type { StateCreator } from 'zustand';
import type { ProjectStore } from './types';
import type { Sprite } from '../unified-types';
import { pxToSub, subToPx } from '../unified-types';
import {
  PixelGrid,
  PixelColor,
  createEmptyPixelGrid,
} from '../types';
import { markPartDirty, invalidateAnimModifierCache } from '../engine';
import { invalidateUnifiedPipelineCache } from '../unified-render';
import { rgbaToHexOrNull } from '@/lib/engine/utils';

export type SpriteSlice = {
  addSprite: ProjectStore['addSprite'];
  removeSprite: ProjectStore['removeSprite'];
  updateSprite: ProjectStore['updateSprite'];
  updateSpriteLandmarks: ProjectStore['updateSpriteLandmarks'];
  setSpritePixels: ProjectStore['setSpritePixels'];
  duplicateSprite: ProjectStore['duplicateSprite'];
  importSpriteFromImage: ProjectStore['importSpriteFromImage'];
  resizeSprite: ProjectStore['resizeSprite'];
  splitImageToSprites: ProjectStore['splitImageToSprites'];
  autoEstimatePlug: ProjectStore['autoEstimatePlug'];
};

export const createSpriteSlice: StateCreator<ProjectStore, [], [], SpriteSlice> = (set, get) => ({
  addSprite: (name, width, height, opts) => {
    get().pushUndo('添加精灵');
    const id = crypto.randomUUID();
    const data = createEmptyPixelGrid(width, height);
    const sprite: Sprite = {
      id,
      name,
      width,
      height,
      data,
      plug: { x: pxToSub(opts?.plugX ?? Math.floor(width / 2)), y: pxToSub(opts?.plugY ?? Math.floor(height / 2)) },
    };
    set((s) => ({
      sprites: { ...s.sprites, [id]: sprite },
    }));
    return sprite;
  },

  removeSprite: (id) => {
    get().pushUndo('删除精灵');
    set((s) => {
      const sprites = { ...s.sprites };
      delete sprites[id];
      return { sprites };
    });
  },

  updateSprite: (id, updates) => {
    get().pushUndo('更新精灵', 'updateSprite');
    markPartDirty(id);
    set((s) => ({
      sprites: s.sprites[id] ? { ...s.sprites, [id]: { ...s.sprites[id]!, ...updates } } : s.sprites,
    }));
  },

  updateSpriteLandmarks: (id, landmarks) => {
    get().pushUndo('更新特征点标注', 'updateSpriteLandmarks');
    markPartDirty(id);
    set((s) => ({
      sprites: s.sprites[id] ? { ...s.sprites, [id]: { ...s.sprites[id]!, landmarks } } : s.sprites,
    }));
  },

  setSpritePixels: (id, pixels) => {
    get().pushUndo('设置精灵像素', 'setSpritePixels');
    markPartDirty(id);
    invalidateUnifiedPipelineCache();
    set((s) => ({
      sprites: s.sprites[id]
        ? { ...s.sprites, [id]: { ...s.sprites[id]!, data: pixels, width: pixels[0]?.length ?? 0, height: pixels.length } }
        : s.sprites,
    }));
  },

  duplicateSprite: (id) => {
    get().pushUndo('复制精灵');
    const sprite = get().sprites[id];
    if (!sprite) return;
    const newId = crypto.randomUUID();
    const copy: Sprite = {
      ...sprite,
      id: newId,
      name: `${sprite.name ?? '精灵'} 副本`,
      data: sprite.data.map((row) => [...row]),
      heightmap: sprite.heightmap?.map((row) => [...row]),
    };
    set((s) => ({
      sprites: { ...s.sprites, [newId]: copy },
    }));
    return copy;
  },

  importSpriteFromImage: (name, imageData) => {
    get().pushUndo('导入图像精灵');
    const { width, height, data } = imageData;
    const id = crypto.randomUUID();
    const pixels: PixelGrid = [];
    for (let y = 0; y < height; y++) {
      const row: PixelColor[] = [];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        row.push(rgbaToHexOrNull(r, g, b, a));
      }
      pixels.push(row);
    }
    const sprite: Sprite = {
      id,
      name,
      width,
      height,
      data: pixels,
      plug: { x: pxToSub(Math.floor(width / 2)), y: pxToSub(Math.floor(height / 2)) },
    };
    set((s) => ({
      sprites: { ...s.sprites, [id]: sprite },
    }));
    return sprite;
  },

  resizeSprite: (id, newWidth, newHeight, cropOffsetX = 0, cropOffsetY = 0) => {
    get().pushUndo('调整精灵尺寸');
    if (newWidth < 1 || newHeight < 1) return;
    set((s) => {
      const sprite = s.sprites[id];
      if (!sprite) return s;

      const oldW = sprite.width;
      const oldH = sprite.height;
      if (oldW === newWidth && oldH === newHeight && cropOffsetX === 0 && cropOffsetY === 0) return s;

      const newData: PixelGrid = Array.from({ length: newHeight }, (_, y) =>
        Array.from({ length: newWidth }, (_, x) => {
          const srcX = x - cropOffsetX;
          const srcY = y - cropOffsetY;
          if (srcY >= 0 && srcY < oldH && srcX >= 0 && srcX < oldW) {
            return sprite.data[srcY]?.[srcX] ?? null;
          }
          return null;
        })
      );

      const oldPlugX = sprite.plug ? subToPx(sprite.plug.x) : oldW / 2;
      const oldPlugY = sprite.plug ? subToPx(sprite.plug.y) : oldH / 2;
      const newPlugX = Math.max(0, Math.min(oldPlugX + cropOffsetX, newWidth - 1));
      const newPlugY = Math.max(0, Math.min(oldPlugY + cropOffsetY, newHeight - 1));

      return {
        sprites: {
          ...s.sprites,
          [id]: {
            ...sprite,
            width: newWidth,
            height: newHeight,
            data: newData,
            plug: { x: pxToSub(newPlugX), y: pxToSub(newPlugY) },
          },
        },
      };
    });
  },

  splitImageToSprites: (name, imageData, regions) => {
    get().pushUndo('拆分图像');
    const { width, height, data } = imageData;
    const created: Sprite[] = [];

    for (const region of regions) {
      if (region.length === 0) continue;

      // Compute bounding box
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (const p of region) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const pixels: PixelGrid = [];
      for (let y = 0; y < h; y++) {
        const row: PixelColor[] = [];
        for (let x = 0; x < w; x++) {
          const sx = minX + x;
          const sy = minY + y;
          const i = (sy * width + sx) * 4;
          row.push(rgbaToHexOrNull(data[i], data[i + 1], data[i + 2], data[i + 3]));
        }
        pixels.push(row);
      }
      const id = crypto.randomUUID();
      const sprite: Sprite = {
        id,
        name: `${name} ${created.length + 1}`,
        width: w,
        height: h,
        data: pixels,
        plug: { x: pxToSub(Math.floor(w / 2)), y: pxToSub(Math.floor(h / 2)) },
      };
      created.push(sprite);
    }

    set((s) => {
      const sprites = { ...s.sprites };
      for (const sp of created) sprites[sp.id!] = sp;
      return { sprites };
    });
    return created;
  },

  autoEstimatePlug: (spriteId) => {
    const sprite = get().sprites[spriteId];
    if (!sprite) return;
    // Estimate plug as center of non-transparent bounding box
    let minX = sprite.width, minY = sprite.height, maxX = -1, maxY = -1;
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        if (sprite.data[y]?.[x]) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return; // empty
    const cx = Math.floor((minX + maxX) / 2);
    const cy = Math.floor((minY + maxY) / 2);
    get().updateSprite(spriteId, { plug: { x: pxToSub(cx), y: pxToSub(cy) } });
  },
});
