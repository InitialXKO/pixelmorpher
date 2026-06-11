// ============================================================
// PixelMorpher - Tile Workflow Store
// State management for the 3-step blob tile creation workflow:
//   Step 1: Import/generate 2 base materials
//   Step 2: Compose 3×3 template with dynamic blend params
//   Step 3: Generate 47 tiles from template with variation params
// ============================================================

import { create } from 'zustand';
import type { PixelGrid, PixelAnimModifier, TileTag, ModifierParamValue, Part, BlobMaterial, MaterialSource } from './types';
import {
  BlobGenParams,
  DEFAULT_BLOB_GEN_PARAMS,
  TemplateBlendParams,
  DEFAULT_TEMPLATE_BLEND_PARAMS,
  TileGenParams,
  DEFAULT_TILE_GEN_PARAMS,
  TileMask,
  generateBlobMaterial,
  composeTileFromTemplate,
  generateAllTiles,
  getAllTileMasks,
} from './tile-blob-engine';
import { useProjectStore } from './store';

// ---- Types ----

// MaterialSource is now in types.ts (canonical location)
export type { MaterialSource } from './types';

export type WorkflowStep = 1 | 2 | 3;

/** What the user is currently editing on the main canvas */
export type TileEditTargetType = 'material_A' | 'material_B' | 'template_tile' | 'generated_tile';

export interface TileEditTarget {
  type: TileEditTargetType;
  /** Index for template_tile (0-8) or generated_tile (0-N) */
  index?: number;
  /** Human-readable label */
  label: string;
}

// BlobMaterial is now in types.ts (canonical location)
export type { BlobMaterial } from './types';

export interface TemplatePreview {
  /** Corner mask for the currently previewed template tile */
  cornerMask: [boolean, boolean, boolean, boolean]; // [NE, SE, SW, NW]
  /** Generated tile pixels */
  pixels: PixelGrid | null;
}

export interface GeneratedTile {
  mask: TileMask;
  pixels: PixelGrid;
  /** Whether this tile has been manually edited */
  isEdited: boolean;
  /** Pixel-level animation modifiers — shared infrastructure for animated tiles */
  animModifiers: PixelAnimModifier[];
  /** Property tags for game logic */
  tags: TileTag[];
  /** Number of animation frames (1 = static, >1 = animated) */
  animationFrameCount: number;
  /** Animation speed in fps */
  animationSpeed: number;
}

interface TileWorkflowState {
  // ---- Step tracking ----
  currentStep: WorkflowStep;

  // ---- Canvas editing target ----
  /** What is currently being edited on the main canvas */
  editingTarget: TileEditTarget | null;

  // ---- Step 1: Base Materials ----
  materialA: BlobMaterial;
  materialB: BlobMaterial;

  // ---- Step 2: Template ----
  tileWidth: number;
  tileHeight: number;
  blendParams: TemplateBlendParams;
  /** Preview corner masks for the 3×3 template grid (9 tiles) */
  templatePreviewMasks: [boolean, boolean, boolean, boolean][];
  /** Preview edge masks for the 3×3 template grid (9 tiles) */
  templatePreviewEdgeMasks: [boolean, boolean, boolean, boolean][];
  /** Manual edits per tile in the 3×3 template (key = "row-col") */
  templateManualEdits: Record<string, PixelGrid>;

  // ---- Step 3: Tile Set ----
  genParams: TileGenParams;
  /** All generated tiles */
  tiles: GeneratedTile[];
  /** Manual edits per tile (key = tile index) */
  tileManualEdits: Record<number, PixelGrid>;

  // ---- Actions ----
  setCurrentStep: (step: WorkflowStep) => void;

  // Canvas editing actions
  setEditingTarget: (target: TileEditTarget | null) => void;
  /** Get the pixel grid of the current editing target */
  getEditingTargetPixels: () => PixelGrid | null;
  /** Get the dimensions (width, height) of the current editing target */
  getEditingTargetSize: () => { width: number; height: number };
  /** Update the pixel grid of the current editing target (called by brush) */
  setEditingTargetPixels: (pixels: PixelGrid) => void;
  /** Paint a single pixel on the current editing target at (lx, ly) */
  paintPixel: (lx: number, ly: number, color: string | null) => void;

  // Step 1 actions
  setMaterialSource: (slot: 'A' | 'B', source: MaterialSource) => void;
  setMaterialPixels: (slot: 'A' | 'B', pixels: PixelGrid) => void;
  setMaterialGenParams: (slot: 'A' | 'B', updates: Partial<BlobGenParams>) => void;
  generateMaterial: (slot: 'A' | 'B') => void;
  setMaterialName: (slot: 'A' | 'B', name: string) => void;

  // Step 2 actions
  setTileSize: (width: number, height: number) => void;
  setBlendParams: (updates: Partial<TemplateBlendParams>) => void;
  setTemplatePreviewMask: (index: number, mask: [boolean, boolean, boolean, boolean]) => void;
  setTemplatePreviewEdgeMask: (index: number, mask: [boolean, boolean, boolean, boolean]) => void;
  setTemplateManualEdit: (key: string, pixels: PixelGrid | null) => void;
  /** Generate the 3×3 template preview */
  generateTemplatePreview: () => void;

  // Step 3 actions
  setGenParams: (updates: Partial<TileGenParams>) => void;
  setTileManualEdit: (index: number, pixels: PixelGrid | null) => void;
  /** Generate all 47 tiles */
  generateAllTiles: () => void;
  /** Regenerate a single tile */
  regenerateTile: (index: number) => void;
  /** Add a pixel animation modifier to a generated tile */
  addTileAnimModifier: (tileIndex: number, modifier: PixelAnimModifier) => void;
  /** Remove a pixel animation modifier from a generated tile */
  removeTileAnimModifier: (tileIndex: number, modifierId: string) => void;
  /** Update a pixel animation modifier's params on a generated tile */
  updateTileAnimModifier: (tileIndex: number, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  /** Toggle a tag on a generated tile */
  toggleTileTag: (tileIndex: number, tag: TileTag) => void;
  /** Set animation frame count for a tile */
  setTileAnimationFrameCount: (tileIndex: number, count: number) => void;
  /** Set animation speed for a tile */
  setTileAnimationSpeed: (tileIndex: number, speed: number) => void;

  // ---- Bridge to Main Project Store ----
  /** Commit selected tiles as Parts in the main project store.
   *  Each tile becomes a new Part with its pixels, allowing
   *  the tile assets to be used in the main animation editor. */
  commitTilesToProject: (tileIndices: number[], groupName?: string) => Part[];
  /** Commit a single tile as a Part in the main project store */
  commitTileToProject: (tileIndex: number) => Part | null;
  /** Commit all generated tiles as Parts */
  commitAllTilesToProject: (groupName?: string) => Part[];
  /** Export generated tiles as a tile set data structure for the map editor */
  exportToMapStore: (tileSetName: string) => void;
}

// ---- Default Materials ----

const createDefaultMaterial = (name: string, genOverrides: Partial<BlobGenParams> = {}): BlobMaterial => ({
  id: crypto.randomUUID(),
  name,
  source: 'generate',
  pixels: null,
  width: 16,
  height: 16,
  genParams: { ...DEFAULT_BLOB_GEN_PARAMS, ...genOverrides },
});

/** Default 3×3 template preview corner masks */
const DEFAULT_TEMPLATE_CORNER_MASKS: [boolean, boolean, boolean, boolean][] = [
  // Row 0: mixed transition
  [false, false, true, true],   // NW corner: SW+NW B
  [false, false, true, false],  // N edge: SW B
  [true, false, true, false],   // NE corner: NE+SW B
  // Row 1:
  [false, false, false, true],  // W edge: NW B
  [false, false, false, false], // Center: all A
  [true, false, false, false],  // E edge: NE B
  // Row 2:
  [false, true, false, true],   // SW corner: SE+NW B
  [false, true, false, false],  // S edge: SE B
  [true, true, false, false],   // SE corner: NE+SE B
];

/** Default 3×3 template preview edge masks */
const DEFAULT_TEMPLATE_EDGE_MASKS: [boolean, boolean, boolean, boolean][] = [
  // Row 0: NW corner B on top-left
  [false, false, true, true],   // NW corner tile: S+W edges B
  [false, false, true, false],  // N edge tile: S edge B
  [true, true, true, false],    // NE corner tile: N+E+S edges B
  // Row 1:
  [false, false, false, true],  // W edge tile: W edge B
  [false, false, false, false], // Center: no edges B
  [true, false, false, false],  // E edge tile: N edge B (just NE corner implies N)
  // Row 2:
  [false, true, false, true],   // SW corner tile: E+W edges B
  [false, true, false, false],  // S edge tile: E edge B (SE corner implies E)
  [true, true, false, false],   // SE corner tile: N+E edges B
];

export const useTileWorkflowStore = create<TileWorkflowState>((set, get) => ({
  // ---- Initial State ----
  currentStep: 1,
  editingTarget: null,

  materialA: createDefaultMaterial('材质 A', {
    seed: 42,
    color1: '#4a7c3f',
    color2: '#3d6633',
    scale: 0.1,
    threshold: 0.5,
  }),

  materialB: createDefaultMaterial('材质 B', {
    seed: 137,
    color1: '#8b6b3d',
    color2: '#7a5c33',
    scale: 0.12,
    threshold: 0.45,
  }),

  tileWidth: 16,
  tileHeight: 16,
  blendParams: { ...DEFAULT_TEMPLATE_BLEND_PARAMS },
  templatePreviewMasks: DEFAULT_TEMPLATE_CORNER_MASKS,
  templatePreviewEdgeMasks: DEFAULT_TEMPLATE_EDGE_MASKS,
  templateManualEdits: {},

  genParams: { ...DEFAULT_TILE_GEN_PARAMS },
  tiles: [],
  tileManualEdits: {},

  // ---- Actions ----

  setCurrentStep: (step) => set({ currentStep: step }),

  // Canvas editing
  setEditingTarget: (target) => set({ editingTarget: target }),

  getEditingTargetPixels: () => {
    const state = get();
    const target = state.editingTarget;
    if (!target) return null;

    switch (target.type) {
      case 'material_A':
        return state.materialA.pixels;
      case 'material_B':
        return state.materialB.pixels;
      case 'template_tile': {
        const idx = target.index ?? 0;
        const key = `${Math.floor(idx / 3)}-${idx % 3}`;
        // If manually edited, return edited version
        if (state.templateManualEdits[key]) return state.templateManualEdits[key];
        // Otherwise compute from template
        if (!state.materialA.pixels || !state.materialB.pixels) return null;
        return composeTileFromTemplate(
          state.materialA.pixels, state.materialB.pixels,
          state.tileWidth, state.tileHeight, state.blendParams,
          state.templatePreviewMasks[idx], state.templatePreviewEdgeMasks[idx],
        );
      }
      case 'generated_tile': {
        const idx = target.index ?? 0;
        if (idx >= state.tiles.length) return null;
        return state.tiles[idx].pixels;
      }
      default:
        return null;
    }
  },

  getEditingTargetSize: () => {
    const state = get();
    const target = state.editingTarget;
    if (!target) return { width: 16, height: 16 };

    switch (target.type) {
      case 'material_A':
        return { width: state.materialA.width, height: state.materialA.height };
      case 'material_B':
        return { width: state.materialB.width, height: state.materialB.height };
      case 'template_tile':
      case 'generated_tile':
        return { width: state.tileWidth, height: state.tileHeight };
      default:
        return { width: 16, height: 16 };
    }
  },

  setEditingTargetPixels: (pixels) => {
    const state = get();
    const target = state.editingTarget;
    if (!target) return;

    switch (target.type) {
      case 'material_A':
        state.setMaterialPixels('A', pixels);
        break;
      case 'material_B':
        state.setMaterialPixels('B', pixels);
        break;
      case 'template_tile': {
        const idx = target.index ?? 0;
        const key = `${Math.floor(idx / 3)}-${idx % 3}`;
        state.setTemplateManualEdit(key, pixels);
        break;
      }
      case 'generated_tile': {
        const idx = target.index ?? 0;
        state.setTileManualEdit(idx, pixels);
        // Also update tiles array to reflect edit
        set((s) => ({
          tiles: s.tiles.map((t, i) =>
            i === idx ? { ...t, pixels, isEdited: true } : t
          ),
        }));
        break;
      }
    }
  },

  paintPixel: (lx, ly, color) => {
    const state = get();
    const target = state.editingTarget;
    if (!target) return;

    const pixels = state.getEditingTargetPixels();
    if (!pixels) return;

    const { width, height } = state.getEditingTargetSize();
    // For materials, use their actual size (pixels dimensions)
    const gridH = pixels.length;
    const gridW = gridH > 0 ? pixels[0].length : 0;

    if (ly < 0 || ly >= gridH || lx < 0 || lx >= gridW) return;

    const newPixels = pixels.map(row => [...row]);
    newPixels[ly][lx] = color;
    state.setEditingTargetPixels(newPixels);
  },

  // Step 1
  setMaterialSource: (slot, source) => {
    const key = slot === 'A' ? 'materialA' : 'materialB';
    set((s) => ({
      [key]: { ...s[key], source },
    }));
  },

  setMaterialPixels: (slot, pixels) => {
    const key = slot === 'A' ? 'materialA' : 'materialB';
    const h = pixels.length;
    const w = h > 0 ? pixels[0].length : 0;
    set((s) => ({
      [key]: { ...s[key], pixels, width: w, height: h },
    }));
  },

  setMaterialGenParams: (slot, updates) => {
    const key = slot === 'A' ? 'materialA' : 'materialB';
    set((s) => ({
      [key]: {
        ...s[key],
        genParams: { ...s[key].genParams, ...updates },
      },
    }));
  },

  generateMaterial: (slot) => {
    const state = get();
    const mat = slot === 'A' ? state.materialA : state.materialB;
    const pixels = generateBlobMaterial(mat.width, mat.height, mat.genParams);
    const key = slot === 'A' ? 'materialA' : 'materialB';
    set((s) => ({
      [key]: { ...s[key], pixels },
    }));
  },

  setMaterialName: (slot, name) => {
    const key = slot === 'A' ? 'materialA' : 'materialB';
    set((s) => ({
      [key]: { ...s[key], name },
    }));
  },

  // Step 2
  setTileSize: (width, height) => set({ tileWidth: width, tileHeight: height }),

  setBlendParams: (updates) => set((s) => ({
    blendParams: { ...s.blendParams, ...updates },
  })),

  setTemplatePreviewMask: (index, mask) => set((s) => {
    const masks = [...s.templatePreviewMasks] as [boolean, boolean, boolean, boolean][];
    masks[index] = mask;
    return { templatePreviewMasks: masks };
  }),

  setTemplatePreviewEdgeMask: (index, mask) => set((s) => {
    const masks = [...s.templatePreviewEdgeMasks] as [boolean, boolean, boolean, boolean][];
    masks[index] = mask;
    return { templatePreviewEdgeMasks: masks };
  }),

  setTemplateManualEdit: (key, pixels) => set((s) => {
    const edits = { ...s.templateManualEdits };
    if (pixels === null) {
      delete edits[key];
    } else {
      edits[key] = pixels;
    }
    return { templateManualEdits: edits };
  }),

  generateTemplatePreview: () => {
    // This is a no-op for the store — the preview is computed reactively
    // in the component from the current materials and blend params.
    // Calling this signals the component to re-render.
    set((s) => ({ blendParams: { ...s.blendParams } }));
  },

  // Step 3
  setGenParams: (updates) => set((s) => ({
    genParams: { ...s.genParams, ...updates },
  })),

  setTileManualEdit: (index, pixels) => set((s) => {
    const edits = { ...s.tileManualEdits };
    if (pixels === null) {
      delete edits[index];
    } else {
      edits[index] = pixels;
    }
    return { tileManualEdits: edits };
  }),

  generateAllTiles: () => {
    const state = get();
    const matA = state.materialA.pixels;
    const matB = state.materialB.pixels;

    if (!matA || !matB) return;

    const results = generateAllTiles(
      matA,
      matB,
      state.tileWidth,
      state.tileHeight,
      state.blendParams,
      state.genParams,
    );

    const tiles: GeneratedTile[] = results.map((r, i) => {
      const manualEdit = state.tileManualEdits[i];
      return {
        mask: r.mask,
        pixels: manualEdit ?? r.pixels,
        isEdited: !!manualEdit,
        animModifiers: [],
        tags: [],
        animationFrameCount: 1,
        animationSpeed: 12,
      };
    });

    set({ tiles });
  },

  regenerateTile: (index) => {
    const state = get();
    const matA = state.materialA.pixels;
    const matB = state.materialB.pixels;

    if (!matA || !matB) return;
    if (index < 0 || index >= state.tiles.length) return;

    const mask = state.tiles[index].mask;
    const pixels = composeTileFromTemplate(
      matA,
      matB,
      state.tileWidth,
      state.tileHeight,
      state.blendParams,
      mask.corners,
      mask.edges,
    );

    set((s) => ({
      tiles: s.tiles.map((t, i) =>
        i === index ? { ...t, pixels, isEdited: false } : t
      ),
    }));
  },

  // ---- Tile Animation Modifier Actions ----

  addTileAnimModifier: (tileIndex, modifier) => set((s) => ({
    tiles: s.tiles.map((t, i) =>
      i === tileIndex
        ? { ...t, animModifiers: [...t.animModifiers, modifier], animationFrameCount: Math.max(t.animationFrameCount, 2) }
        : t
    ),
  })),

  removeTileAnimModifier: (tileIndex, modifierId) => set((s) => ({
    tiles: s.tiles.map((t, i) =>
      i === tileIndex
        ? { ...t, animModifiers: t.animModifiers.filter((m) => m.id !== modifierId) }
        : t
    ),
  })),

  updateTileAnimModifier: (tileIndex, modifierId, params) => set((s) => ({
    tiles: s.tiles.map((t, i) =>
      i === tileIndex
        ? {
            ...t,
            animModifiers: t.animModifiers.map((m) =>
              m.id === modifierId ? { ...m, params: { ...m.params, ...params } } : m
            ),
          }
        : t
    ),
  })),

  toggleTileTag: (tileIndex, tag) => set((s) => ({
    tiles: s.tiles.map((t, i) => {
      if (i !== tileIndex) return t;
      const has = t.tags.includes(tag);
      return {
        ...t,
        tags: has ? t.tags.filter((t2) => t2 !== tag) : [...t.tags, tag],
      };
    }),
  })),

  setTileAnimationFrameCount: (tileIndex, count) => set((s) => ({
    tiles: s.tiles.map((t, i) =>
      i === tileIndex ? { ...t, animationFrameCount: count } : t
    ),
  })),

  setTileAnimationSpeed: (tileIndex, speed) => set((s) => ({
    tiles: s.tiles.map((t, i) =>
      i === tileIndex ? { ...t, animationSpeed: speed } : t
    ),
  })),

  // ---- Bridge to Main Project Store ----

  commitTileToProject: (tileIndex) => {
    const state = get();
    if (tileIndex < 0 || tileIndex >= state.tiles.length) return null;
    const tile = state.tiles[tileIndex];
    const projectStore = useProjectStore.getState();

    projectStore.pushUndo('提交瓦片到项目');
    const part = projectStore.addPart(
      `瓦片_${tileIndex}`,
      tile.pixels[0]?.length ?? state.tileWidth,
      tile.pixels.length ?? state.tileHeight,
    );
    // Copy tile pixels into the new part
    projectStore.setPartPixels(part.id, tile.pixels.map(row => [...row]));
    return part;
  },

  commitTilesToProject: (tileIndices, groupName) => {
    const state = get();
    const projectStore = useProjectStore.getState();
    projectStore.pushUndo('批量提交瓦片到项目');

    const parts: Part[] = [];
    for (const idx of tileIndices) {
      if (idx < 0 || idx >= state.tiles.length) continue;
      const tile = state.tiles[idx];

      const part = projectStore.addPart(
        groupName ? `${groupName}_${idx}` : `瓦片_${idx}`,
        tile.pixels[0]?.length ?? state.tileWidth,
        tile.pixels.length ?? state.tileHeight,
      );
      projectStore.setPartPixels(part.id, tile.pixels.map(row => [...row]));
      parts.push(part);
    }
    return parts;
  },

  commitAllTilesToProject: (groupName) => {
    const state = get();
    const indices = state.tiles.map((_, i) => i);
    return get().commitTilesToProject(indices, groupName);
  },

  exportToMapStore: (tileSetName) => {
    const state = get();
    // Import map store lazily to avoid circular dependency at module level
    const { useMapStore } = require('./map-store') as { useMapStore: any };
    const mapStore = useMapStore.getState();

    // If no current map in map-store, create one matching tile dimensions
    if (!mapStore.currentMap) {
      const cols = Math.ceil(Math.sqrt(state.tiles.length));
      const rows = Math.ceil(state.tiles.length / cols);
      mapStore.createMap(tileSetName, cols, rows, state.tileWidth);
    }

    // Place each generated tile as a dynamic object on the current map
    // so it appears in the map editor for arrangement
    const tileSize = state.tileWidth;
    for (let idx = 0; idx < state.tiles.length; idx++) {
      const tile = state.tiles[idx];
      const col = idx % Math.ceil(Math.sqrt(state.tiles.length));
      const row = Math.floor(idx / Math.ceil(Math.sqrt(state.tiles.length)));

      mapStore.addDynamicObject({
        name: `${tileSetName}_${idx}`,
        objectType: 'prop',
        positionX: col * tileSize,
        positionY: row * tileSize,
        width: state.tileWidth,
        height: state.tileHeight,
        zIndex: 0,
        pixels: tile.pixels.map(r => [...r]),
        animModifiers: tile.animModifiers ?? [],
        loop: true,
        animationSpeed: tile.animationSpeed,
        triggerId: undefined,
      });
    }
  },
}));
