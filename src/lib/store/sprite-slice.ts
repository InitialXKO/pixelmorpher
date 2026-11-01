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
import { markPartDirty, invalidateAnimModifierCache, bakeCanvasAffine } from '../engine';
import { invalidateUnifiedPipelineCache, pixelsToCanvas, canvasToPixels } from '../unified-render';
import {
  d4MapPoint,
  d4TransformGrid,
  d4TransformLandmarks,
  affineTransformLandmarks,
  rotationMatrixAbout,
  mirrorAxisMatrixAbout,
  classifyRotate,
  classifyMirrorAxis,
  resampleGridAffine,
  darkenPixelGrid,
} from '../sprite-transform';
import type { D4Op, SpriteTransformRequest } from '../sprite-transform';
import { remapMarksForCrop, transformMarksD4, transformMarksAffine } from '../sprite-marks';
import type { Affine2D } from '../engine/affine';
import { rgbaToHexOrNull } from '@/lib/engine/utils';

export type SpriteSlice = {
  addSprite: ProjectStore['addSprite'];
  removeSprite: ProjectStore['removeSprite'];
  removeSprites: ProjectStore['removeSprites'];
  updateSprite: ProjectStore['updateSprite'];
  updateSpriteLandmarks: ProjectStore['updateSpriteLandmarks'];
  updateSpriteMarks: ProjectStore['updateSpriteMarks'];
  setSpritePixels: ProjectStore['setSpritePixels'];
  duplicateSprite: ProjectStore['duplicateSprite'];
  importSpriteFromImage: ProjectStore['importSpriteFromImage'];
  resizeSprite: ProjectStore['resizeSprite'];
  transformSprite: ProjectStore['transformSprite'];
  deriveSpriteFrom: ProjectStore['deriveSpriteFrom'];
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

  removeSprites: (ids, undoLabel) => {
    if (ids.length === 0) return;
    get().pushUndo(undoLabel ?? '删除精灵');
    set((s) => {
      const sprites = { ...s.sprites };
      for (const id of ids) delete sprites[id];
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

  updateSpriteMarks: (id, marks) => {
    get().pushUndo('更新精灵标记', 'updateSpriteMarks');
    markPartDirty(id);
    set((s) => ({
      sprites: s.sprites[id] ? { ...s.sprites, [id]: { ...s.sprites[id]!, marks } } : s.sprites,
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

      // heightmap 与像素同口径裁切（界外补 0）
      const newHeightmap = sprite.heightmap
        ? Array.from({ length: newHeight }, (_, y) =>
            Array.from({ length: newWidth }, (_, x) => {
              const srcX = x - cropOffsetX;
              const srcY = y - cropOffsetY;
              return srcY >= 0 && srcY < oldH && srcX >= 0 && srcX < oldW
                ? sprite.heightmap![srcY]?.[srcX] ?? 0
                : 0;
            }))
        : undefined;
      // landmarks 是相对坐标：经绝对坐标平移后重新归一化，界外贴边
      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
      const remapLm = (p?: { x: number; y: number }) => p
        ? {
            x: clamp01((p.x * oldW + cropOffsetX) / newWidth),
            y: clamp01((p.y * oldH + cropOffsetY) / newHeight),
          }
        : undefined;
      const newLandmarks = sprite.landmarks
        ? {
            leftEye: remapLm(sprite.landmarks.leftEye),
            rightEye: remapLm(sprite.landmarks.rightEye),
            nose: remapLm(sprite.landmarks.nose),
            mouth: remapLm(sprite.landmarks.mouth),
          }
        : undefined;
      // marks 与 landmarks 同路重映射（此前原样保留、坐标相对内容漂移，审计 F-32）
      const newMarks = remapMarksForCrop(sprite.marks, oldW, oldH, cropOffsetX, cropOffsetY, newWidth, newHeight);

      return {
        sprites: {
          ...s.sprites,
          [id]: {
            ...sprite,
            width: newWidth,
            height: newHeight,
            data: newData,
            plug: { x: pxToSub(newPlugX), y: pxToSub(newPlugY) },
            ...(newHeightmap ? { heightmap: newHeightmap } : {}),
            ...(newLandmarks ? { landmarks: newLandmarks } : {}),
            ...(newMarks ? { marks: newMarks } : {}),
          },
        },
      };
    });
  },

  transformSprite: (id, t) => {
    // 一次快照读全输入、内存里算完、单次 set 落账（Zustand 快照纪律）
    const sprite = get().sprites[id];
    if (!sprite) return;
    const w = sprite.width;
    const h = sprite.height;
    const plugX = sprite.plug ? subToPx(sprite.plug.x) : w / 2;
    const plugY = sprite.plug ? subToPx(sprite.plug.y) : h / 2;

    // ---- 路由：90°/45° 倍数落 D4 无损置换，其余绕锚点走任意仿射 ----
    let d4: D4Op | null = null;
    let matrix: Affine2D | null = null;
    if (t.kind === 'd4') {
      d4 = t.op;
    } else if (t.kind === 'rotate') {
      const c = classifyRotate(t.angleDeg);
      if (c === 'identity') return;
      if (c) d4 = c;
      else matrix = rotationMatrixAbout(t.angleDeg, plugX, plugY);
    } else {
      const c = classifyMirrorAxis(t.axisDeg);
      if (c) d4 = c;
      else matrix = mirrorAxisMatrixAbout(t.axisDeg, plugX, plugY);
    }

    if (d4) {
      const newData = d4TransformGrid(sprite.data, d4, null);
      const dims = d4MapPoint(d4, 0, 0, w, h);
      const plugAbs = d4MapPoint(d4, plugX, plugY, w, h);
      const newHeightmap = sprite.heightmap ? d4TransformGrid(sprite.heightmap, d4, 0) : undefined;
      const newLandmarks = sprite.landmarks ? d4TransformLandmarks(sprite.landmarks, d4, w, h) : undefined;
      const newMarks = transformMarksD4(sprite.marks, d4, w, h);
      get().pushUndo('变换精灵');
      markPartDirty(id);
      set((s) => (s.sprites[id] ? {
        sprites: {
          ...s.sprites,
          [id]: {
            ...s.sprites[id]!,
            width: dims.w,
            height: dims.h,
            data: newData,
            plug: { x: pxToSub(plugAbs.x), y: pxToSub(plugAbs.y) },
            ...(newHeightmap ? { heightmap: newHeightmap } : {}),
            ...(newLandmarks ? { landmarks: newLandmarks } : {}),
            ...(newMarks ? { marks: newMarks } : {}),
          },
        },
      } : s));
      return;
    }

    // ---- 仿射烘焙：像素走 4× 超采样画布管线（与主渲染同口径），不走渲染缓存 ----
    if (!matrix) return;
    const srcCanvas = pixelsToCanvas(sprite.data, w, h);
    if (!srcCanvas) return;
    const baked = bakeCanvasAffine(srcCanvas, matrix, plugX, plugY);
    if (!baked) return;
    const newData = canvasToPixels(baked.canvas);
    const newHeightmap = sprite.heightmap
      ? resampleGridAffine(sprite.heightmap, matrix, baked.minX, baked.minY, baked.width, baked.height, 0) ?? undefined
      : undefined;
    const newLandmarks = sprite.landmarks
      ? affineTransformLandmarks(sprite.landmarks, matrix, baked.minX, baked.minY, baked.width, baked.height, w, h)
      : undefined;
    const newMarks = transformMarksAffine(sprite.marks, matrix, baked.minX, baked.minY, baked.width, baked.height, w, h);
    get().pushUndo('变换精灵');
    markPartDirty(id);
    set((s) => (s.sprites[id] ? {
      sprites: {
        ...s.sprites,
        [id]: {
          ...s.sprites[id]!,
          width: baked.width,
          height: baked.height,
          data: newData,
          plug: { x: pxToSub(baked.pivotX), y: pxToSub(baked.pivotY) },
          ...(newHeightmap ? { heightmap: newHeightmap } : {}),
          ...(newLandmarks ? { landmarks: newLandmarks } : {}),
          ...(newMarks ? { marks: newMarks } : {}),
        },
      },
    } : s));
  },

  deriveSpriteFrom: (sourceSpriteId, opts) => {
    // 烘焙式派生：从源精灵一次性生成独立新精灵（复制/镜像 + 可选压暗），
    // 源后续修改不跟随。镜像的轴/plug/heightmap/landmarks 口径与 transformSprite 一致。
    const src = get().sprites[sourceSpriteId];
    if (!src) return undefined;
    const w = src.width;
    const h = src.height;
    const plugX = src.plug ? subToPx(src.plug.x) : w / 2;
    const plugY = src.plug ? subToPx(src.plug.y) : h / 2;
    const cloneLandmarks = () =>
      src.landmarks
        ? {
            leftEye: src.landmarks.leftEye && { ...src.landmarks.leftEye },
            rightEye: src.landmarks.rightEye && { ...src.landmarks.rightEye },
            nose: src.landmarks.nose && { ...src.landmarks.nose },
            mouth: src.landmarks.mouth && { ...src.landmarks.mouth },
          }
        : undefined;

    let data: PixelGrid;
    let newW = w;
    let newH = h;
    let newPlugX = plugX;
    let newPlugY = plugY;
    let heightmap = src.heightmap?.map((r) => r.slice());
    let landmarks: import('../unified-types').SpriteLandmarks | undefined = cloneLandmarks();
    // marks 随派生走（此前整表丢失，审计 F-32）：复制=原样深拷贝，
    // 镜像=按与像素/landmarks 同一变换重映射
    let marks: import('../unified-types').SpriteMark[] | undefined = src.marks
      ? src.marks.map((mk) => (mk.kind === 'region' ? { ...mk, region: { ...mk.region } } : { ...mk }))
      : undefined;

    if (opts.mode === 'copy') {
      data = src.data.map((r) => r.slice());
    } else {
      const axisDeg = opts.axisDeg ?? 90;
      const d4 = classifyMirrorAxis(axisDeg);
      if (d4) {
        data = d4TransformGrid(src.data, d4, null);
        const dims = d4MapPoint(d4, 0, 0, w, h);
        const pa = d4MapPoint(d4, plugX, plugY, w, h);
        newW = dims.w;
        newH = dims.h;
        newPlugX = pa.x;
        newPlugY = pa.y;
        heightmap = src.heightmap ? d4TransformGrid(src.heightmap, d4, 0) : undefined;
        landmarks = src.landmarks ? d4TransformLandmarks(src.landmarks, d4, w, h) : undefined;
        marks = transformMarksD4(src.marks, d4, w, h);
      } else {
        const m = mirrorAxisMatrixAbout(axisDeg, plugX, plugY);
        const srcCanvas = pixelsToCanvas(src.data, w, h);
        if (!srcCanvas) return undefined;
        const baked = bakeCanvasAffine(srcCanvas, m, plugX, plugY);
        if (!baked) return undefined;
        data = canvasToPixels(baked.canvas);
        newW = baked.width;
        newH = baked.height;
        newPlugX = baked.pivotX;
        newPlugY = baked.pivotY;
        heightmap = src.heightmap
          ? resampleGridAffine(src.heightmap, m, baked.minX, baked.minY, baked.width, baked.height, 0) ?? undefined
          : undefined;
        landmarks = src.landmarks
          ? affineTransformLandmarks(src.landmarks, m, baked.minX, baked.minY, baked.width, baked.height, w, h)
          : undefined;
        marks = transformMarksAffine(src.marks, m, baked.minX, baked.minY, baked.width, baked.height, w, h);
      }
    }

    const darkenF = opts.darken ?? 1;
    if (darkenF < 1) data = darkenPixelGrid(data, darkenF);

    const newId = crypto.randomUUID();
    const sprite: Sprite = {
      id: newId,
      name: opts.name ?? `${opts.mode === 'mirror' ? '镜像' : '复制'}_${src.name ?? sourceSpriteId}`,
      width: newW,
      height: newH,
      data,
      plug: { x: pxToSub(newPlugX), y: pxToSub(newPlugY) },
      ...(heightmap ? { heightmap } : {}),
      ...(landmarks ? { landmarks } : {}),
      ...(marks ? { marks } : {}),
    };
    get().pushUndo(opts.mode === 'mirror' ? '镜像生成精灵' : '复制生成精灵');
    set((s) => ({ sprites: { ...s.sprites, [newId]: sprite } }));
    return sprite;
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
