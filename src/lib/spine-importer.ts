// ============================================================
// PixelMorpher - Spine Importer
// Imports Spine 4.x JSON + Atlas + PNG into the new Character model.
// ============================================================

import type { Character, Node, CostumeSet, Sprite, PixelGrid } from './unified-types';
import { createDefaultCharacter, createDefaultNode, createDefaultCostumeSet, createDefaultCostumePiece, pxToSub } from './unified-types';
import { guardCharacterBoneAxes } from './bone-axis-guard';

// ---- Spine JSON Types (4.x) ----

interface SpineBone {
  name: string;
  parent?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  length?: number;
  color?: string;
}

interface SpineSlot {
  name: string;
  bone: string;
  color?: string;
  attachment?: string;
}

interface SpineRegionAttachment {
  type?: string; // undefined = region, "mesh", "clipping", etc.
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  width?: number;
  height?: number;
  color?: string;
}

interface SpineSkin {
  name: string;
  attachments: Record<string, Record<string, SpineRegionAttachment>>;
}

interface SpineAnimation {
  bones?: Record<string, {
    rotate?: Array<{ time?: number; value?: number; angle?: number; curve?: string | number[] }>;
    translate?: Array<{ time?: number; x?: number; y?: number; curve?: string | number[] }>;
    scale?: Array<{ time?: number; x?: number; y?: number; curve?: string | number[] }>;
  }>;
  slots?: Record<string, {
    attachment?: Array<{ time: number; name: string | null }>;
    color?: Array<{ time: number; color: string }>;
  }>;
}

interface SpineJson {
  skeleton?: { spine?: string; width?: number; height?: number };
  bones: SpineBone[];
  slots: SpineSlot[];
  skins: SpineSkin[];
  animations: Record<string, SpineAnimation>;
}

// ---- Atlas Types ----

export interface AtlasRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate?: boolean;
}

/**
 * Parse a Spine .atlas file into region definitions.
 */
export function parseAtlas(atlasText: string): AtlasRegion[] {
  const regions: AtlasRegion[] = [];
  const lines = atlasText.split('\n');
  // First 4 lines are the page header (filename, size, filter, etc.)
  // Then each region: name, bounds, (optional rotate)
  let i = 0;
  // Skip page header (first non-empty line + 3 following)
  while (i < lines.length && lines[i].trim() === '') i++;
  i++; // filename
  while (i < lines.length && lines[i].trim() !== '') i++; // size, filter, etc.
  while (i < lines.length && lines[i].trim() === '') i++;

  while (i < lines.length) {
    const name = lines[i].trim();
    if (!name) { i++; continue; }
    i++;
    let x = 0, y = 0, width = 0, height = 0, rotate = false;
    while (i < lines.length && lines[i].startsWith('\t')) {
      const line = lines[i].trim();
      if (line.startsWith('bounds:')) {
        const parts = line.slice(7).split(',').map(s => parseInt(s.trim(), 10));
        x = parts[0]; y = parts[1]; width = parts[2]; height = parts[3];
      } else if (line.startsWith('rotate:')) {
        rotate = line.slice(7).trim() === 'true';
      }
      i++;
    }
    if (width > 0 && height > 0) {
      regions.push({ name, x, y, width, height, rotate });
    }
  }
  return regions;
}

/**
 * Extract sprite pixels from a PNG image using atlas region bounds.
 * One-time conversion: runs during import, result is stored in Character.sprites.
 * 
 * @param image - Loaded HTMLImageElement of the atlas PNG
 * @param regions - Parsed atlas regions
 * @returns Map from region name to {width, height, data (PixelGrid)}
 */
export async function extractSpritesFromAtlas(
  image: HTMLImageElement,
  regions: AtlasRegion[],
): Promise<Map<string, { width: number; height: number; data: PixelGrid }>> {
  const result = new Map<string, { width: number; height: number; data: PixelGrid }>();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return result;

  for (const region of regions) {
    canvas.width = region.width;
    canvas.height = region.height;
    ctx.clearRect(0, 0, region.width, region.height);
    // Handle rotated regions (Spine atlas rotate: 90° clockwise)
    if (region.rotate) {
      ctx.save();
      ctx.translate(region.width / 2, region.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(
        image,
        region.x, region.y, region.height, region.width,  // source (swapped)
        -region.height / 2, -region.width / 2, region.height, region.width  // dest (swapped)
      );
      ctx.restore();
    } else {
      ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
    }
    const imageData = ctx.getImageData(0, 0, region.width, region.height);
    // Convert to PixelGrid: 2D array of hex color or null
    const grid: PixelGrid = [];
    for (let y = 0; y < region.height; y++) {
      const row: (string | null)[] = [];
      for (let x = 0; x < region.width; x++) {
        const idx = (y * region.width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const a = imageData.data[idx + 3];
        if (a === 0) {
          row.push(null);
        } else {
          // Convert to hex color string
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
          row.push(hex);
        }
      }
      grid.push(row);
    }
    result.set(region.name, { width: region.width, height: region.height, data: grid });
  }
  return result;
}

/**
 * Load an image from a File object.
 */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Import a Spine project (JSON + pre-extracted sprites) into a Character.
 * One-time conversion: call once during import, result is persisted.
 */
export function importSpineToCharacter(
  spineJson: SpineJson,
  atlasRegions: AtlasRegion[],
  sprites: Map<string, { width: number; height: number; data: PixelGrid }>,
  characterName: string,
): { character: Character; sprites: Record<string, Sprite> } {
  const character = createDefaultCharacter(`spine_${Date.now().toString(36)}`, characterName);
  const outSprites: Record<string, Sprite> = {};
  const regionByName = new Map(atlasRegions.map(r => [r.name, r]));

  // ---- Bones → Nodes ----
  const boneToNodeId = new Map<string, string>();
  for (const bone of spineJson.bones) {
    const node = createDefaultNode(`bone_${bone.name}`, bone.name);
    node.transform.x = pxToSub(bone.x ?? 0);
    node.transform.y = pxToSub(bone.y ?? 0);
    node.transform.angle = bone.rotation ?? 0;
    // Note: scaleX/scaleY not in NodeTransform; apply via stretch if needed
    if (bone.parent) {
      const parentId = boneToNodeId.get(bone.parent);
      if (parentId) {
        node.parentId = parentId;
        node.attachment = {
          type: 'fixed',
          fixedOffset: { x: pxToSub(bone.x ?? 0), y: pxToSub(bone.y ?? 0) },
          inheritRotation: true,
        };
        // Add to parent's children
        const parent = character.nodes[parentId];
        if (parent) parent.children.push(node.id);
      }
    } else {
      // Root bone
      character.rootNodeId = node.id;
    }
    character.nodes[node.id] = node;
    boneToNodeId.set(bone.name, node.id);
  }

  // ---- Slots → map slot name to bone (node) ----
  const slotToNodeId = new Map<string, string>();
  for (const slot of spineJson.slots) {
    const nodeId = boneToNodeId.get(slot.bone);
    if (nodeId) slotToNodeId.set(slot.name, nodeId);
  }

  // ---- Skins → CostumeSets ----
  for (const skin of spineJson.skins) {
    const costumeSet = createDefaultCostumeSet(`skin_${skin.name}`, skin.name);
    for (const [slotName, attachments] of Object.entries(skin.attachments)) {
      const nodeId = slotToNodeId.get(slotName);
      if (!nodeId) continue;
      // Use first region attachment (skip clipping/mesh for now)
      for (const [attName, att] of Object.entries(attachments)) {
        if (att.type === 'clipping') continue;
        const pixels = sprites.get(attName);
        if (!pixels) continue;
        const spriteId = `spine_${skin.name}_${slotName}_${attName}`;
        const sprite: Sprite = {
          id: spriteId,
          name: `${slotName}/${attName}`,
          width: pixels.width,
          height: pixels.height,
          data: pixels.data,
        };
        outSprites[spriteId] = sprite;
        // Add to costume piece (direction 0 = default)
        if (!costumeSet.pieces[nodeId]) {
          costumeSet.pieces[nodeId] = createDefaultCostumePiece(nodeId);
        }
        costumeSet.pieces[nodeId].sprites[0] = { spriteId };
        break; // Only first attachment per slot for now
      }
    }
    character.costumeSets.push(costumeSet);
  }
  if (character.costumeSets.length > 0) {
    character.activeCostumeSetId = character.costumeSets[0].id;
  }

  // ---- Animations → NodeTracks ----
  // Each Spine animation becomes keyframes on node.tracks.
  // For now, we import the first animation into the base tracks.
  // (Multi-clip support can be added later via AnimationClip.)
  const FRAME_RATE = 30; // Spine default
  const animationNames = Object.keys(spineJson.animations);
  if (animationNames.length > 0) {
    // Use 'idle' if available, else first animation
    const animName = animationNames.includes('idle') ? 'idle' : animationNames[0];
    const anim = spineJson.animations[animName];
    if (anim.bones) {
      for (const [boneName, timelines] of Object.entries(anim.bones)) {
        const nodeId = boneToNodeId.get(boneName);
        if (!nodeId) continue;
        const node = character.nodes[nodeId];
        if (!node) continue;

        // Rotate → angle track
        if (timelines.rotate) {
          node.tracks.angle = {
            keyframes: timelines.rotate.map((kf, idx) => ({
              frame: Math.round((kf.time ?? 0) * FRAME_RATE),
              value: kf.value ?? kf.angle ?? 0,
            })),
            interpolation: 'linear',
          };
        }
        // Translate → x/y tracks
        if (timelines.translate) {
          const xKfs: { frame: number; value: number }[] = [];
          const yKfs: { frame: number; value: number }[] = [];
          for (const kf of timelines.translate) {
            const frame = Math.round((kf.time ?? 0) * FRAME_RATE);
            if (kf.x !== undefined) xKfs.push({ frame, value: pxToSub(kf.x) as number });
            if (kf.y !== undefined) yKfs.push({ frame, value: pxToSub(kf.y) as number });
          }
          if (xKfs.length > 0) node.tracks.x = { keyframes: xKfs, interpolation: 'linear' };
          if (yKfs.length > 0) node.tracks.y = { keyframes: yKfs, interpolation: 'linear' };
        }
        // Scale → stretch track (uniform scale only for now)
        if (timelines.scale) {
          node.tracks.stretch = {
            keyframes: timelines.scale.map(kf => ({
              frame: Math.round((kf.time ?? 0) * FRAME_RATE),
              value: kf.x ?? kf.y ?? 1,
            })),
            interpolation: 'linear',
          };
        }
      }
    }
    // Store animation name for reference
    (character as any).spineAnimation = animName;
    (character as any).spineAnimations = animationNames;
  }

  // 骨轴守卫（数据入口）：Spine 骨沿 +X 走，横骨链在东/西向会落
  // 进 IK 两角反解的纵深奇异带——导入成型即改轴（静止几何不变），
  // 与工程读入规范化同一守卫。合规则零改动。
  guardCharacterBoneAxes(character, outSprites);

  return { character, sprites: outSprites };
}
