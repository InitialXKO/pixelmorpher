'use client';

import { useCallback, useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import { DIR_INDEX_TO_PUPPET_DIR, PUPPET_DIR_TO_INDEX, DEFAULT_MIRROR_MAP } from '@/lib/unified-types';
import type { DirectionIndex } from '@/lib/unified-types';
import type { PuppetCharacter, PuppetSkeleton, CostumeSet, PuppetDirection } from '@/lib/types';
import type { Part, PixelGrid } from '@/lib/types';
import type {
  CharacterInfo,
  CostumeSetInfo,
  CostumePieceInfo,
  NodeInfo,
  PartInfo,
} from '../CostumeManager';

// ---- Thumbnail Generation ----

/** Cache for generated thumbnails (partId → data URL) */
const thumbnailCache = new WeakMap<PixelGrid, string>();

/**
 * Convert a PixelGrid to a small data URL for use as a thumbnail.
 * Renders at 2× scale with nearest-neighbor interpolation for crisp pixel art.
 * Results are cached by PixelGrid reference to avoid re-rendering.
 */
function pixelsToDataUrl(pixels: PixelGrid, width: number, height: number): string | undefined {
  if (!pixels || pixels.length === 0 || width <= 0 || height <= 0) return undefined;

  // Check cache first
  const cached = thumbnailCache.get(pixels);
  if (cached) return cached;

  const scale = 2;
  const canvasW = width * scale;
  const canvasH = height * scale;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;

  // Disable anti-aliasing for crisp pixel art
  ctx.imageSmoothingEnabled = false;

  // Render pixel grid at 1:1 first, then scale up
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d')!;
  const imageData = srcCtx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const row = pixels[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const color = row[x];
      const i = (y * width + x) * 4;
      if (color) {
        // Parse hex color
        const h = color.replace('#', '');
        if (h.length === 6) {
          imageData.data[i]     = parseInt(h.slice(0, 2), 16);
          imageData.data[i + 1] = parseInt(h.slice(2, 4), 16);
          imageData.data[i + 2] = parseInt(h.slice(4, 6), 16);
          imageData.data[i + 3] = 255;
        }
      }
      // null → transparent (alpha stays 0)
    }
  }

  srcCtx.putImageData(imageData, 0, 0);

  // Scale up with nearest-neighbor
  ctx.drawImage(srcCanvas, 0, 0, canvasW, canvasH);

  const dataUrl = canvas.toDataURL('image/png');
  thumbnailCache.set(pixels, dataUrl);
  return dataUrl;
}

// ---- SpriteMap Key Conversion ----

/**
 * Convert old-style spriteMap keys ("nodeId:E") to numeric keys ("nodeId:0").
 * CostumeManager uses numeric DirectionIndex keys.
 */
function convertSpriteMapToNumeric(
  oldMap: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(oldMap)) {
    const colonIdx = key.lastIndexOf(':');
    if (colonIdx === -1) {
      result[key] = value;
      continue;
    }
    const nodeId = key.slice(0, colonIdx);
    const dirStr = key.slice(colonIdx + 1);
    const dirIndex = PUPPET_DIR_TO_INDEX[dirStr];
    if (dirIndex !== undefined) {
      result[`${nodeId}:${dirIndex}`] = value;
    } else {
      // Not a direction key — keep as-is
      result[key] = value;
    }
  }
  return result;
}

/**
 * Migrate old CostumeSet format: fill in mirrorMap for every node that has
 * sprite assignments. Old CostumeSets only had spriteMap ("nodeId:E" → partId)
 * with no explicit mirror info. We apply DEFAULT_MIRROR_MAP as the baseline,
 * then prune entries where the left-side direction already has its own sprite
 * (i.e., it's NOT mirrored — the artist drew it explicitly).
 *
 * This produces a proper `pieces` record with mirrorMap per node, which the
 * CostumeManager uses to show mirror indicators in the mapping grid.
 */
function migrateCostumeSetPieces(
  oldMap: Record<string, string>,
  nodes: NodeInfo[]
): Record<string, CostumePieceInfo> | undefined {
  const pieces: Record<string, CostumePieceInfo> = {};
  let hasAnyPiece = false;

  for (const node of nodes) {
    // Only build a piece entry if this node has at least one sprite assignment
    const hasAnySprite = Object.keys(oldMap).some((key) => {
      const colonIdx = key.lastIndexOf(':');
      return colonIdx !== -1 && key.slice(0, colonIdx) === node.id;
    });

    if (!hasAnySprite) continue;

    // Start with DEFAULT_MIRROR_MAP as baseline, then prune entries
    // where the target direction has its own sprite (not mirrored).
    const mirrorMap: Record<number, number> = {};
    for (const [fromStr, toStr] of Object.entries(DEFAULT_MIRROR_MAP)) {
      const from = Number(fromStr) as DirectionIndex;
      const to = toStr as DirectionIndex;
      // numeric keys since spriteMap is already converted
      const targetKey = `${node.id}:${from}`;
      // If the left-side (from) direction has NO own sprite, it mirrors from the right (to)
      if (!oldMap[targetKey]) {
        mirrorMap[from] = to;
      }
    }

    pieces[node.id] = {
      slotKey: node.id,
      fillColor: node.color || '#888',
      mirrorMap,
    };
    hasAnyPiece = true;
  }

  return hasAnyPiece ? pieces : undefined;
}

// ---- Adapter Hook ----

interface AdapterState {
  puppetCharacters: PuppetCharacter[];
  puppetSkeletons: PuppetSkeleton[];
  parts: Part[];
  selectedCharacterId: string | null;
  selectedCostumeId: string | null;
  selectedCharacter: PuppetCharacter | null;
  setSelectedCharacterId: (id: string | null) => void;
  setSelectedCostumeId: (id: string | null) => void;
}

export function useCostumeManagerAdapter(state: AdapterState) {
  const store = useProjectStore;

  const {
    puppetCharacters,
    puppetSkeletons,
    parts,
    selectedCharacterId,
    selectedCostumeId,
    selectedCharacter,
    setSelectedCharacterId,
    setSelectedCostumeId,
  } = state;

  // ---- Adapt characters ----
  const characters: CharacterInfo[] = useMemo(
    () => puppetCharacters.map((c) => ({
      id: c.id,
      name: c.name,
      skeletonId: c.puppetSkeletonId,
    })),
    [puppetCharacters]
  );

  // ---- Adapt nodes (from skeleton) ----
  const skeleton = useMemo(
    () =>
      selectedCharacter
        ? puppetSkeletons.find((s) => s.id === selectedCharacter.puppetSkeletonId) ?? null
        : null,
    [selectedCharacter, puppetSkeletons]
  );

  const nodes: NodeInfo[] = useMemo(
    () =>
      (skeleton?.nodes ?? []).map((n) => ({
        id: n.id,
        name: n.name,
        color: n.color,
        sockets: n.sockets.map((s) => ({ id: s.id, name: s.name })),
      })),
    [skeleton]
  );

  // ---- Adapt costume sets (convert spriteMap keys to numeric) ----
  const selectedCostume = useMemo(
    () =>
      selectedCharacter?.costumeSets.find((cs) => cs.id === selectedCostumeId) ?? null,
    [selectedCharacter, selectedCostumeId]
  );

  const costumeSets: CostumeSetInfo[] = useMemo(() => {
    if (!selectedCharacter) return [];
    return selectedCharacter.costumeSets.map((cs: CostumeSet) => {
      const numericSpriteMap = convertSpriteMapToNumeric(cs.spriteMap);
      const pieces = migrateCostumeSetPieces(numericSpriteMap, nodes);
      return {
        id: cs.id,
        name: cs.name,
        spriteMap: numericSpriteMap,
        pieces,
      };
    });
  }, [selectedCharacter, nodes]);

  // ---- Adapt parts (with thumbnail generation) ----
  const adaptedParts: PartInfo[] = useMemo(
    () => parts.map((p) => {
      // Use existing thumbnail if present, otherwise generate from pixels
      let thumbnail = p.thumbnail;
      if (!thumbnail && p.pixels) {
        thumbnail = pixelsToDataUrl(p.pixels, p.width, p.height);
      }
      return {
        id: p.id,
        name: p.name,
        width: p.width,
        height: p.height,
        thumbnail,
      };
    }),
    [parts]
  );

  // ---- Active costume set ----
  const activeCostumeSetId = selectedCharacter?.activeCostumeSetId ?? null;

  // ---- Handlers ----

  const handleCharacterSelect = useCallback(
    (id: string | null) => {
      setSelectedCharacterId(id);
      setSelectedCostumeId(null);
    },
    [setSelectedCharacterId, setSelectedCostumeId]
  );

  const handleCharacterDelete = useCallback(
    (id: string) => {
      const s = store.getState();
      s.pushUndo('删除角色');
      store.setState({
        puppetCharacters: (s.puppetCharacters ?? []).filter((c) => c.id !== id),
      });
      if (selectedCharacterId === id) {
        setSelectedCharacterId(null);
        setSelectedCostumeId(null);
      }
    },
    [store, selectedCharacterId, setSelectedCharacterId, setSelectedCostumeId]
  );

  const handleCostumeSelect = useCallback(
    (id: string | null) => {
      setSelectedCostumeId(id);
    },
    [setSelectedCostumeId]
  );

  const handleCostumeAdd = useCallback(() => {
    if (!selectedCharacterId) return;
    const s = store.getState();
    s.pushUndo('添加服装');
    const newCostume: CostumeSet = {
      id: crypto.randomUUID(),
      name: `服装_${((selectedCharacter?.costumeSets.length ?? 0) + 1)}`,
      spriteMap: {},
    };
    store.setState({
      puppetCharacters: (s.puppetCharacters ?? []).map((c) =>
        c.id === selectedCharacterId
          ? { ...c, costumeSets: [...c.costumeSets, newCostume] }
          : c
      ),
    });
    setSelectedCostumeId(newCostume.id);
  }, [store, selectedCharacterId, selectedCharacter, setSelectedCostumeId]);

  const handleCostumeDelete = useCallback(
    (id: string) => {
      if (!selectedCharacterId) return;
      const s = store.getState();
      s.pushUndo('删除服装');
      store.setState({
        puppetCharacters: (s.puppetCharacters ?? []).map((c) =>
          c.id === selectedCharacterId
            ? {
                ...c,
                costumeSets: c.costumeSets.filter((cs) => cs.id !== id),
                activeCostumeSetId:
                  c.activeCostumeSetId === id
                    ? c.costumeSets.find((cs) => cs.id !== id)?.id ?? null
                    : c.activeCostumeSetId,
              }
            : c
        ),
      });
      if (selectedCostumeId === id) {
        setSelectedCostumeId(null);
      }
    },
    [store, selectedCharacterId, selectedCostumeId, setSelectedCostumeId]
  );

  const handleActiveCostumeSetChange = useCallback(
    (id: string | null) => {
      if (!selectedCharacterId) return;
      const s = store.getState();
      s.pushUndo('切换激活服装');
      store.setState({
        puppetCharacters: (s.puppetCharacters ?? []).map((c) =>
          c.id === selectedCharacterId
            ? { ...c, activeCostumeSetId: id }
            : c
        ),
      });
    },
    [store, selectedCharacterId]
  );

  const handleSpriteAssign = useCallback(
    (nodeId: string, direction: number, partId: string | null) => {
      if (!selectedCharacterId || !selectedCostumeId) return;
      const puppetDir = DIR_INDEX_TO_PUPPET_DIR[direction as DirectionIndex];
      if (!puppetDir) return;
      const key = `${nodeId}:${puppetDir}`;
      const s = store.getState();
      s.pushUndo('分配精灵', 'assignSprite');
      if (partId) {
        store.setState({
          puppetCharacters: (s.puppetCharacters ?? []).map((c) =>
            c.id === selectedCharacterId
              ? {
                  ...c,
                  costumeSets: c.costumeSets.map((cs) =>
                    cs.id === selectedCostumeId
                      ? { ...cs, spriteMap: { ...cs.spriteMap, [key]: partId } }
                      : cs
                  ),
                }
              : c
          ),
        });
      } else {
        // Remove assignment
        store.setState({
          puppetCharacters: (s.puppetCharacters ?? []).map((c) =>
            c.id === selectedCharacterId
              ? {
                  ...c,
                  costumeSets: c.costumeSets.map((cs) => {
                    if (cs.id !== selectedCostumeId) return cs;
                    const newMap = { ...cs.spriteMap };
                    delete newMap[key];
                    return { ...cs, spriteMap: newMap };
                  }),
                }
              : c
          ),
        });
      }
    },
    [store, selectedCharacterId, selectedCostumeId]
  );

  const handleSpriteRemove = useCallback(
    (nodeId: string, direction: number) => {
      // Delegate to assign with null partId
      handleSpriteAssign(nodeId, direction, null);
    },
    [handleSpriteAssign]
  );

  return {
    characters,
    costumeSets,
    nodes,
    parts: adaptedParts,
    activeCostumeSetId,
    selectedCharacterId,
    selectedCostumeId,
    handleCharacterSelect,
    handleCharacterDelete,
    handleCostumeSelect,
    handleCostumeAdd,
    handleCostumeDelete,
    handleActiveCostumeSetChange,
    handleSpriteAssign,
    handleSpriteRemove,
  };
}
