// ============================================================
// PixelMorpher - Map Editor Store
// State management for the tile map creation and dynamic object subsystem
// ============================================================

import { create } from 'zustand';
import type {
  TileMap,
  MapLayer,
  MapTile,
  MapCollisionCell,
  MapDynamicObject,
  CollisionCellType,
  MapExportFormat,
  PixelAnimModifier,
  ModifierParamValue,
} from './types';

// ---- Types ----

export interface MapEditorState {
  // ---- Map Data ----
  currentMap: TileMap | null;
  /** All maps in the project */
  maps: TileMap[];

  // ---- Editor State ----
  selectedLayerId: string | null;
  selectedTileVariantId: string | null;
  /** Currently selected dynamic object */
  selectedObjectId: string | null;
  /** Paint mode: 'tile' = place tiles, 'collision' = paint collision, 'object' = place objects, 'erase' = erase */
  paintMode: 'tile' | 'collision' | 'object' | 'erase';
  /** Current collision type for painting */
  collisionBrushType: CollisionCellType;
  /** Zoom level for the map canvas */
  zoom: number;
  /** Pan offset */
  panX: number;
  panY: number;

  // ---- Actions ----
  createMap: (name: string, gridWidth: number, gridHeight: number, tileSize: number) => TileMap;
  deleteMap: (id: string) => void;
  setCurrentMap: (id: string) => void;

  // Layer actions
  addLayer: (name: string, type: MapLayer['type']) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<MapLayer>) => void;
  setSelectedLayer: (id: string | null) => void;

  // Tile placement actions
  placeTile: (x: number, y: number, variantId: string, layer: number) => void;
  eraseTile: (x: number, y: number, layer: number) => void;
  setSelectedTileVariant: (id: string | null) => void;

  // Collision actions
  paintCollision: (x: number, y: number, type: CollisionCellType) => void;
  clearCollision: (x: number, y: number) => void;
  setCollisionBrushType: (type: CollisionCellType) => void;

  // Dynamic object actions
  addDynamicObject: (obj: Omit<MapDynamicObject, 'id'>) => void;
  removeDynamicObject: (id: string) => void;
  updateDynamicObject: (id: string, updates: Partial<MapDynamicObject>) => void;
  /** Add a pixel animation modifier to a dynamic object */
  addAnimModifierToObject: (objectId: string, modifier: PixelAnimModifier) => void;
  removeAnimModifierFromObject: (objectId: string, modifierId: string) => void;
  updateAnimModifierForObject: (objectId: string, modifierId: string, params: Record<string, ModifierParamValue>) => void;
  setSelectedObject: (id: string | null) => void;

  // View actions
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setPaintMode: (mode: MapEditorState['paintMode']) => void;

  // Export
  exportMap: (format: MapExportFormat) => string;
}

export const useMapStore = create<MapEditorState>((set, get) => ({
  currentMap: null,
  maps: [],
  selectedLayerId: null,
  selectedTileVariantId: null,
  selectedObjectId: null,
  paintMode: 'tile',
  collisionBrushType: 'blocked',
  zoom: 1,
  panX: 0,
  panY: 0,

  createMap: (name, gridWidth, gridHeight, tileSize) => {
    const id = crypto.randomUUID();
    const groundLayer: MapLayer = {
      id: crypto.randomUUID(),
      name: '地面层',
      type: 'tile',
      visible: true,
      locked: false,
      opacity: 1,
      order: 0,
    };
    const map: TileMap = {
      id,
      name,
      gridWidth,
      gridHeight,
      tileSize,
      layers: [groundLayer],
      tiles: [],
      collisionData: [],
      dynamicObjects: [],
      tileSetId: '',
      backgroundColor: '#1a1a2e',
    };
    set((s) => ({ maps: [...s.maps, map], currentMap: map, selectedLayerId: groundLayer.id }));
    return map;
  },

  deleteMap: (id) => set((s) => ({
    maps: s.maps.filter((m) => m.id !== id),
    currentMap: s.currentMap?.id === id ? null : s.currentMap,
  })),

  setCurrentMap: (id) => set((s) => ({
    currentMap: s.maps.find((m) => m.id === id) ?? null,
  })),

  addLayer: (name, type) => {
    const state = get();
    if (!state.currentMap) return;
    const layer: MapLayer = {
      id: crypto.randomUUID(),
      name,
      type,
      visible: true,
      locked: false,
      opacity: 1,
      order: state.currentMap.layers.length,
    };
    set((s) => ({
      currentMap: s.currentMap ? {
        ...s.currentMap,
        layers: [...s.currentMap.layers, layer],
      } : null,
    }));
  },

  removeLayer: (id) => set((s) => ({
    currentMap: s.currentMap ? {
      ...s.currentMap,
      layers: s.currentMap.layers.filter((l) => l.id !== id),
    } : null,
    selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
  })),

  updateLayer: (id, updates) => set((s) => ({
    currentMap: s.currentMap ? {
      ...s.currentMap,
      layers: s.currentMap.layers.map((l) => l.id === id ? { ...l, ...updates } : l),
    } : null,
  })),

  setSelectedLayer: (id) => set({ selectedLayerId: id }),

  placeTile: (x, y, variantId, layer) => set((s) => {
    if (!s.currentMap) return {};
    const existing = s.currentMap.tiles.findIndex(
      (t) => t.x === x && t.y === y && t.layer === layer
    );
    const newTile: MapTile = { variantId, x, y, layer, flipH: false, flipV: false, rotation: 0 };
    const tiles = [...s.currentMap.tiles];
    if (existing >= 0) {
      tiles[existing] = newTile;
    } else {
      tiles.push(newTile);
    }
    return { currentMap: { ...s.currentMap, tiles } };
  }),

  eraseTile: (x, y, layer) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        tiles: s.currentMap.tiles.filter(
          (t) => !(t.x === x && t.y === y && t.layer === layer)
        ),
      },
    };
  }),

  setSelectedTileVariant: (id) => set({ selectedTileVariantId: id }),

  paintCollision: (x, y, type) => set((s) => {
    if (!s.currentMap) return {};
    const existing = s.currentMap.collisionData.findIndex(
      (c) => c.x === x && c.y === y
    );
    const cell: MapCollisionCell = { x, y, type };
    const collisionData = [...s.currentMap.collisionData];
    if (existing >= 0) {
      collisionData[existing] = cell;
    } else {
      collisionData.push(cell);
    }
    return { currentMap: { ...s.currentMap, collisionData } };
  }),

  clearCollision: (x, y) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        collisionData: s.currentMap.collisionData.filter((c) => !(c.x === x && c.y === y)),
      },
    };
  }),

  setCollisionBrushType: (type) => set({ collisionBrushType: type }),

  addDynamicObject: (obj) => {
    const id = crypto.randomUUID();
    const fullObj: MapDynamicObject = { ...obj, id };
    set((s) => {
      if (!s.currentMap) return {};
      return {
        currentMap: {
          ...s.currentMap,
          dynamicObjects: [...s.currentMap.dynamicObjects, fullObj],
        },
      };
    });
  },

  removeDynamicObject: (id) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        dynamicObjects: s.currentMap.dynamicObjects.filter((o) => o.id !== id),
      },
      selectedObjectId: s.selectedObjectId === id ? null : s.selectedObjectId,
    };
  }),

  updateDynamicObject: (id, updates) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        dynamicObjects: s.currentMap.dynamicObjects.map((o) =>
          o.id === id ? { ...o, ...updates } : o
        ),
      },
    };
  }),

  addAnimModifierToObject: (objectId, modifier) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        dynamicObjects: s.currentMap.dynamicObjects.map((o) => {
          if (o.id !== objectId) return o;
          const existing = o.animModifiers ?? [];
          return { ...o, animModifiers: [...existing, modifier] };
        }),
      },
    };
  }),

  removeAnimModifierFromObject: (objectId, modifierId) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        dynamicObjects: s.currentMap.dynamicObjects.map((o) => {
          if (o.id !== objectId) return o;
          const existing = o.animModifiers ?? [];
          return { ...o, animModifiers: existing.filter((m) => m.id !== modifierId) };
        }),
      },
    };
  }),

  updateAnimModifierForObject: (objectId, modifierId, params) => set((s) => {
    if (!s.currentMap) return {};
    return {
      currentMap: {
        ...s.currentMap,
        dynamicObjects: s.currentMap.dynamicObjects.map((o) => {
          if (o.id !== objectId) return o;
          const existing = o.animModifiers ?? [];
          return {
            ...o,
            animModifiers: existing.map((m) =>
              m.id === modifierId ? { ...m, params: { ...m.params, ...params } } : m
            ),
          };
        }),
      },
    };
  }),

  setSelectedObject: (id) => set({ selectedObjectId: id }),

  setZoom: (zoom) => set({ zoom }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setPaintMode: (mode) => set({ paintMode: mode }),

  exportMap: (format) => {
    const state = get();
    if (!state.currentMap) return '';
    const map = state.currentMap;

    if (format === 'json_custom') {
      // Full PixelMorpher custom format — includes everything
      return JSON.stringify({
        format: 'pixelmorpher_map',
        version: 1,
        map: {
          id: map.id,
          name: map.name,
          gridWidth: map.gridWidth,
          gridHeight: map.gridHeight,
          tileSize: map.tileSize,
          backgroundColor: map.backgroundColor,
          tileSetId: map.tileSetId,
          layers: map.layers,
          tiles: map.tiles,
          collisionData: map.collisionData,
          dynamicObjects: map.dynamicObjects,
        },
      }, null, 2);
    }

    if (format === 'ldtk') {
      // Simplified LDtk-compatible JSON structure
      const ldtkLayers = map.layers.map((layer, idx) => {
        const layerTiles = map.tiles.filter((t) => t.layer === idx);
        return {
          __identifier: layer.name,
          __type: layer.type === 'tile' ? 'Tiles' : layer.type === 'collision' ? 'IntGrid' : 'Entities',
          __gridSize: map.tileSize,
          __cWid: map.gridWidth,
          __cHei: map.gridHeight,
          identifier: layer.name,
          type: layer.type === 'tile' ? 'Tiles' : layer.type === 'collision' ? 'IntGrid' : 'Entities',
          gridTiles: layerTiles.map((t) => ({
            px: [t.x * map.tileSize, t.y * map.tileSize],
            src: [0, 0],
            t: t.variantId,
            flip: (t.flipH ? 1 : 0) | (t.flipV ? 2 : 0),
          })),
          intGridCsv: layer.type === 'collision'
            ? Array.from({ length: map.gridWidth * map.gridHeight }, (_, i) => {
                const cx = i % map.gridWidth;
                const cy = Math.floor(i / map.gridWidth);
                const cell = map.collisionData.find((c) => c.x === cx && c.y === cy);
                return cell ? 1 : 0;
              })
            : undefined,
        };
      });

      // Dynamic objects exported as LDtk entities
      const entityLayer = {
        __identifier: 'DynamicObjects',
        __type: 'Entities',
        __gridSize: map.tileSize,
        __cWid: map.gridWidth,
        __cHei: map.gridHeight,
        identifier: 'DynamicObjects',
        type: 'Entities',
        entityInstances: map.dynamicObjects.map((obj) => ({
          __identifier: obj.name,
          __grid: [Math.floor(obj.positionX / map.tileSize), Math.floor(obj.positionY / map.tileSize)],
          __pivot: [0, 0],
          px: [obj.positionX, obj.positionY],
          width: obj.width,
          height: obj.height,
          fieldInstances: [
            { __identifier: 'objectType', __value: obj.objectType },
            { __identifier: 'zIndex', __value: obj.zIndex },
            { __identifier: 'loop', __value: obj.loop },
            { __identifier: 'animationSpeed', __value: obj.animationSpeed },
            ...(obj.triggerId ? [{ __identifier: 'triggerId', __value: obj.triggerId }] : []),
          ],
        })),
      };

      return JSON.stringify({
        __header__: { version: '1.5.3', fileType: 'LDtk Project' },
        identifier: map.name,
        defaultGridSize: map.tileSize,
        bgColor: map.backgroundColor,
        levels: [{
          identifier: map.name,
          pxWid: map.gridWidth * map.tileSize,
          pxHei: map.gridHeight * map.tileSize,
          layerInstances: [...ldtkLayers, entityLayer],
        }],
      }, null, 2);
    }

    if (format === 'tiled') {
      // Tiled-compatible JSON structure
      const tiledLayers = map.layers.map((layer, idx) => {
        const layerTiles = map.tiles.filter((t) => t.layer === idx);
        // Build flat data array (row-major, tile index or 0 for empty)
        const data = Array.from(
          { length: map.gridWidth * map.gridHeight },
          (_, i) => {
            const tx = i % map.gridWidth;
            const ty = Math.floor(i / map.gridWidth);
            const tile = layerTiles.find((t) => t.x === tx && t.y === ty);
            return tile ? 1 : 0; // simplified: use 1 as placeholder for variant presence
          }
        );
        return {
          id: idx,
          name: layer.name,
          type: layer.type === 'collision' ? 'objectgroup' : 'tilelayer',
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          width: map.gridWidth,
          height: map.gridHeight,
          x: 0,
          y: 0,
          ...(layer.type === 'collision'
            ? {
                objects: map.collisionData.map((c) => ({
                  id: c.x * map.gridWidth + c.y,
                  type: c.type,
                  x: c.x * map.tileSize,
                  y: c.y * map.tileSize,
                  width: map.tileSize,
                  height: map.tileSize,
                  properties: c.metadata ?? {},
                })),
              }
            : { data }),
        };
      });

      // Dynamic objects exported as Tiled objects in an object layer
      const objectLayer = {
        id: map.layers.length,
        name: 'DynamicObjects',
        type: 'objectgroup' as const,
        visible: true,
        locked: false,
        opacity: 1,
        x: 0,
        y: 0,
        objects: map.dynamicObjects.map((obj, idx) => ({
          id: idx,
          name: obj.name,
          type: obj.objectType,
          x: obj.positionX,
          y: obj.positionY,
          width: obj.width,
          height: obj.height,
          visible: true,
          properties: {
            zIndex: obj.zIndex,
            loop: obj.loop,
            animationSpeed: obj.animationSpeed,
            ...(obj.triggerId ? { triggerId: obj.triggerId } : {}),
          },
        })),
      };

      return JSON.stringify({
        type: 'map',
        version: '1.10',
        tiledversion: '1.10.0',
        orientation: 'orthogonal',
        renderorder: 'right-down',
        width: map.gridWidth,
        height: map.gridHeight,
        tilewidth: map.tileSize,
        tileheight: map.tileSize,
        backgroundcolor: map.backgroundColor,
        layers: [...tiledLayers, objectLayer],
      }, null, 2);
    }

    // Fallback (should not reach here due to type constraint)
    return JSON.stringify({ format, map }, null, 2);
  },
}));
