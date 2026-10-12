// ============================================================
// PixelMorpher - Migration Adapter Layer
// ============================================================
// Provides bidirectional conversion between old data model
// (Part + PuppetNode + PuppetSkeleton) and new unified model
// (Node + Character).
//
// Strategy: Old data can be imported into the new model, and
// new model can export back to old format for backward compat.
// During the transition period, both models coexist, with the
// adapter bridging between them.
// ============================================================

import type {
  Node, Character, NodeTransform, Attachment, Socket, GeneratedItem,
  CostumePiece, CostumeSet, KeyframeTrack, KeyframePoint, NodeTracks,
  ModifierInstance, MigrationMap, DirectionIndex, Point, Sprite, SubPixel,
  UnifiedAnimationClip, GlobalModifier as UnifiedGlobalModifier,
  AnimationVariable as UnifiedAnimationVariable,
  GlobalModifierKeyframe,
} from './unified-types';
import {
  createDefaultNode, createDefaultCharacter, createDefaultSocket,
  createDefaultAttachment, createDefaultCostumePiece, createDefaultCostumeSet,
  pxToSub, DEFAULT_MIRROR_MAP,
} from './unified-types';

// Import old types for conversion
import type {
  Part, PuppetNode, PuppetSkeleton, PuppetCharacter, PuppetSocket,
  PuppetNodeKeyframe, Keyframe as OldKeyframe, AnimationClip as OldAnimationClip,
  CostumeSet as OldCostumeSet, PuppetPlug,
  GlobalModifier as OldGlobalModifier,
  AnimationVariable as OldAnimationVariable,
  ClipPartData, Track as OldTrack,
} from './types';

// ============================================================
// Part → Node Conversion
// ============================================================

/**
 * Convert an old Part to a new Node.
 * The Part becomes a flat visual node with fixed attachment.
 * Its modifier stack, keyframes, and pixel data are preserved.
 */
function partToNode(part: Part, migrationMap?: MigrationMap): Node {
  const node = createDefaultNode(part.id, part.name || part.id);

  // Sprite from pixels
  if (part.pixels && part.pixels.length > 0 && (part.pixels[0]?.length ?? 0) > 0) {
    node.sprite = {
      width: part.pixels[0].length,
      height: part.pixels.length,
      data: part.pixels,
      // Preserve Part's pivot semantics: Part.pivotX/Y is the anchor point
      // relative to the sprite's top-left corner. Default is (0,0) = top-left.
      // This is critical for correct sprite positioning in the unified pipeline
      // where worldX/Y = where the plug (pivot) should land on canvas.
      plug: { x: pxToSub(part.pivotX ?? 0), y: pxToSub(part.pivotY ?? 0) },
    };
  }

  // Transform from Part offsets and pivot (Part 是纯精灵数据，无偏移)
  node.transform = {
    x: 0,
    y: 0,
    angle: 0,
    stretch: 1.0,
    variantIndex: 0,
  };

  // Attachment: fixed offset with optional parent
  node.attachment = {
    type: 'fixed',
    fixedOffset: { x: 0, y: 0 },
    inheritRotation: true,
  };

  // Part 不再有修改器
  node.modifiers = [];

  // Part 不再有关键帧
  node.tracks = {};

  // Draw order (Part 无 zIndex，默认 0)
  node.zIndex = 0;
  node.drawLayer = 'default';

  // Visibility (Part 恒可见)
  node.visible = true;

  return node;
}

// ============================================================
// PuppetNode → Node Conversion
// ============================================================

/**
 * Convert an old PuppetNode to a new Node.
 * Preserves socket/plug hierarchy, direction sprites, mirror config,
 * cross sections, and stretch/angle.
 */
function puppetNodeToNode(
  pNode: PuppetNode,
  parts: Part[],
  skeleton: PuppetSkeleton,
  migrationMap?: MigrationMap,
): Node {
  const node = createDefaultNode(pNode.id, pNode.name || pNode.id);

  // Resolve sprite from parts
  const spritePart = parts.find(p => p.id === pNode.spritePartId);
  if (spritePart?.pixels && spritePart.pixels.length > 0 && (spritePart.pixels[0]?.length ?? 0) > 0) {
    // sprite.plug = the ROTATION/POSITIONING ANCHOR (part.pivotX/Y),
    // NOT the socket attachment point (pNode.plug.localX/Y).
    // The socket attachment point is stored separately in attachment.plug.
    // Using part.pivot as the anchor ensures rotation happens around the correct center
    // and draw positioning matches the old pipeline's behavior.
    node.sprite = {
      width: spritePart.pixels[0].length,
      height: spritePart.pixels.length,
      data: spritePart.pixels,
      plug: { x: pxToSub(spritePart.pivotX ?? 0), y: pxToSub(spritePart.pivotY ?? 0) },
    };
  }

  // Transform from PuppetNode properties
  node.transform = {
    x: pxToSub(pNode.offsetX ?? 0),
    y: pxToSub(pNode.offsetY ?? 0),
    angle: pNode.angle ?? 0,
    stretch: pNode.stretch ?? 1.0,
    variantIndex: directionToVariantIndex(skeleton.currentDirection),
  };

  // Attachment: socket-based
  if (pNode.plug && pNode.plug.socketId) {
    node.attachment = {
      type: 'socket',
      parentSocketId: pNode.plug.socketId,
      plug: { x: pxToSub(pNode.plug.localX), y: pxToSub(pNode.plug.localY) },
      discColor: pNode.plug.discColor ?? null,
      jointWidth: pNode.plug.jointWidth ?? null,
    };
  } else {
    node.attachment = createDefaultAttachment();
  }

  // Convert sockets
  node.sockets = (pNode.sockets ?? []).map(s => convertPuppetSocket(s));

  // Draw order
  node.zIndex = pNode.zIndex ?? 0;
  node.side = pNode.side;
  node.isCore = pNode.isCore;
  node.drawLayer = 'default';
  node.visible = pNode.visible !== false;

  // Copy modifiers from the PuppetNode (not the Part — Part 是纯精灵数据)
  // PuppetNode.modifiers 是 PartAnimationModifier[]，需要转成 ModifierInstance[]
  node.modifiers = (pNode.modifiers ?? []).map(convertOldModifier);

  // Direction sprites → CostumePiece reference
  if (pNode.directionSprites && Object.keys(pNode.directionSprites).length > 0) {
    node.costumePiece = convertDirectionSprites(pNode, parts);
  }

  // Cross sections → CostumePiece (for disc diameter) + Generated item
  // Even if there are no direction sprites, we need a costumePiece with crossSections
  // so that generateDiscInstructions can compute the disc diameter correctly.
  if (pNode.crossSectionTop || pNode.crossSectionBottom) {
    // Ensure costumePiece exists (may already have been created by convertDirectionSprites)
    if (!node.costumePiece) {
      node.costumePiece = createDefaultCostumePiece(pNode.id, pNode.color ?? '#808080');
    }
    // Add cross sections if not already present (convertDirectionSprites may have added them)
    const existingIds = new Set(node.costumePiece.crossSections.map(cs => cs.id));
    if (pNode.crossSectionTop && !existingIds.has('plug')) {
      node.costumePiece.crossSections.push({
        id: 'plug',
        mode: 'inside',
        diameter: pNode.crossSectionTop,
      });
    }
    if (pNode.crossSectionBottom && !existingIds.has('bottom')) {
      node.costumePiece.crossSections.push({
        id: 'bottom',
        mode: 'inside',
        diameter: pNode.crossSectionBottom,
      });
    }

    // Generated item (disc) — references the 'plug' crossSection for the child's top diameter
    node.generated = {
      type: 'disc',
      crossSectionId: 'plug',
    };
  }

  // Children: will be resolved after full skeleton conversion
  node.children = [];

  return node;
}

// ============================================================
// PuppetSkeleton + PuppetCharacter → Character Conversion
// ============================================================

/**
 * Convert an old PuppetSkeleton + PuppetCharacter to a new Character.
 * This is the main migration entry point for puppet data.
 */
function puppetToCharacter(
  skeleton: PuppetSkeleton,
  characters: PuppetCharacter[],
  parts: Part[],
  nodeKeyframes: PuppetNodeKeyframe[],
  oldCostumeSets: OldCostumeSet[],
  migrationMap?: MigrationMap,
): Character {
  const character = characters.find(c => c.puppetSkeletonId === skeleton.id);
  const charId = character?.id ?? skeleton.id;

  const result = createDefaultCharacter(charId, skeleton.name || 'Character');

  // Convert all puppet nodes to unified nodes
  const nodeMap: Record<string, Node> = {};
  const childParentMap: Record<string, string> = {}; // childId → parentId

  for (const pNode of skeleton.nodes) {
    const node = puppetNodeToNode(pNode, parts, skeleton, migrationMap);
    nodeMap[pNode.id] = node;

    // Build parent-child map from plug.socketId
    if (pNode.plug?.socketId) {
      // Find which parent node owns this socket
      const parentNode = skeleton.nodes.find(n =>
        n.sockets?.some(s => s.id === pNode.plug!.socketId)
      );
      if (parentNode) {
        childParentMap[pNode.id] = parentNode.id;
        node.parentId = parentNode.id;
        node.attachment = {
          type: 'socket',
          parentSocketId: pNode.plug.socketId,
          plug: { x: pxToSub(pNode.plug.localX), y: pxToSub(pNode.plug.localY) },
          discColor: pNode.plug.discColor ?? null,
          jointWidth: pNode.plug.jointWidth ?? null,
        };
      }
    }
  }

  // Resolve children arrays
  for (const [childId, parentId] of Object.entries(childParentMap)) {
    const parentNode = nodeMap[parentId];
    if (parentNode && !parentNode.children.includes(childId)) {
      parentNode.children.push(childId);
    }
  }

  // Find root node (node with no parent)
  const rootNode = skeleton.nodes.find(n => !childParentMap[n.id]);
  if (rootNode) {
    result.rootNodeId = rootNode.id;
  }

  result.nodes = nodeMap;

  // Convert puppet node keyframes to tracks
  const nodeKeyframeMap: Record<string, PuppetNodeKeyframe[]> = {};
  for (const kf of nodeKeyframes) {
    if (!nodeKeyframeMap[kf.nodeId]) nodeKeyframeMap[kf.nodeId] = [];
    nodeKeyframeMap[kf.nodeId].push(kf);
  }
  for (const [nodeId, kfs] of Object.entries(nodeKeyframeMap)) {
    const node = nodeMap[nodeId];
    if (node) {
      node.tracks = mergeNodeTracks(node.tracks, convertPuppetKeyframesToTracks(kfs));
    }
  }

  // Convert costume sets
  if (character) {
    result.costumeSets = (character.costumeSets ?? []).map(cs =>
      convertOldCostumeSet(cs, skeleton, parts)
    );
    result.activeCostumeSetId = character.activeCostumeSetId ?? undefined;
  }

  // Latitude
  result.latitude = skeleton.viewLatitude ?? 0;

  return result;
}

function convertOldModifier(mod: any): ModifierInstance {
  return {
    id: mod.id,
    type: mod.type as any,
    enabled: mod.enabled ?? true,
    collapsed: mod.collapsed ?? false,
    params: mod.params ?? {},
    coordinateMode: mod.coordinateMode ?? 'local',
    blendMode: mod.blendMode,
    startFrame: mod.startFrame ?? -1,
    endFrame: mod.endFrame ?? -1,
    fadeInFrames: mod.fadeInFrames ?? 0,
    fadeOutFrames: mod.fadeOutFrames ?? 0,
    paramKeyframes: mod.paramKeyframes ?? [],
    paramDrivers: mod.paramDrivers ?? [],
  };
}

function convertPartKeyframesToTracks(
  partKeyframes: any[],
  partId: string,
): NodeTracks {
  // Part keyframes in the old model store full modifier stacks per frame.
  // In the unified model, transform properties are driven by KeyframeTracks,
  // and modifier data is preserved in ModifierInstance.paramKeyframes.
  //
  // Strategy:
  // 1. Extract transform-related values (translate, rotate, scale) from each
  //    keyframe's modifier stack into separate tracks
  // 2. Non-transform modifiers stay as ModifierInstance with their paramKeyframes
  //
  // This provides a best-effort decomposition. Some modifier combinations
  // (e.g., multiple translates on one keyframe) will be summed into a single
  // value per property per frame.

  if (!partKeyframes || partKeyframes.length === 0) return {};

  const xPoints: KeyframePoint[] = [];
  const yPoints: KeyframePoint[] = [];
  const anglePoints: KeyframePoint[] = [];
  const stretchPoints: KeyframePoint[] = [];

  for (const pkf of partKeyframes) {
    const frame = pkf.frame;
    let translateX = 0;
    let translateY = 0;
    let rotation = 0;
    let scaleX = 1;
    let scaleY = 1;

    // Extract transform contributions from this keyframe's modifiers
    const modifiers = pkf.editModifiers ?? pkf.modifiers ?? [];
    for (const mod of modifiers) {
      if (!mod.enabled && mod.enabled !== undefined) continue;

      switch (mod.type) {
        case 'translate': {
          translateX += (mod.params?.offsetX as number) ?? 0;
          translateY += (mod.params?.offsetY as number) ?? 0;
          break;
        }
        case 'rotate': {
          rotation += (mod.params?.angle as number) ?? 0;
          break;
        }
        case 'uniform_scale': {
          const s = (mod.params?.scale as number) ?? 1;
          scaleX *= s;
          scaleY *= s;
          break;
        }
        case 'non_uniform_stretch': {
          scaleX *= (mod.params?.scaleX as number) ?? 1;
          scaleY *= (mod.params?.scaleY as number) ?? 1;
          break;
        }
        default:
          // Non-transform modifiers are preserved in the modifier stack
          break;
      }
    }

    // Only add keyframe points if values differ from default
    if (translateX !== 0) {
      xPoints.push({ frame, value: pxToSub(translateX), interpolation: 'step' });
    }
    if (translateY !== 0) {
      yPoints.push({ frame, value: pxToSub(translateY), interpolation: 'step' });
    }
    if (rotation !== 0) {
      anglePoints.push({ frame, value: rotation, interpolation: 'step' });
    }
    if (scaleY !== 1) {
      stretchPoints.push({ frame, value: scaleY, interpolation: 'step' });
    }
  }

  const tracks: NodeTracks = {};

  if (xPoints.length > 0) {
    tracks.x = { keyframes: xPoints.sort((a, b) => a.frame - b.frame), interpolation: 'step' };
  }
  if (yPoints.length > 0) {
    tracks.y = { keyframes: yPoints.sort((a, b) => a.frame - b.frame), interpolation: 'step' };
  }
  if (anglePoints.length > 0) {
    tracks.angle = { keyframes: anglePoints.sort((a, b) => a.frame - b.frame), interpolation: 'step' };
  }
  if (stretchPoints.length > 0) {
    tracks.stretch = { keyframes: stretchPoints.sort((a, b) => a.frame - b.frame), interpolation: 'step' };
  }

  return tracks;
}

function convertPuppetKeyframesToTracks(
  keyframes: PuppetNodeKeyframe[],
): NodeTracks {
  const tracks: NodeTracks = {};

  // Angle track (step interpolation)
  if (keyframes.some(kf => kf.angle !== undefined)) {
    tracks.angle = {
      keyframes: keyframes
        .filter(kf => kf.angle !== undefined)
        .map(kf => ({
          frame: kf.frame,
          value: kf.angle!,
          interpolation: 'step' as const,
        }))
        .sort((a, b) => a.frame - b.frame),
      interpolation: 'step',
    };
  }

  // Stretch track (linear interpolation)
  if (keyframes.some(kf => kf.stretch !== undefined)) {
    tracks.stretch = {
      keyframes: keyframes
        .filter(kf => kf.stretch !== undefined)
        .map(kf => ({
          frame: kf.frame,
          value: kf.stretch!,
          interpolation: 'linear' as const,
        }))
        .sort((a, b) => a.frame - b.frame),
      interpolation: 'linear',
    };
  }

  // Offset X track (linear interpolation)
  if (keyframes.some(kf => kf.offsetX !== undefined)) {
    tracks.x = {
      keyframes: keyframes
        .filter(kf => kf.offsetX !== undefined)
        .map(kf => ({
          frame: kf.frame,
          value: pxToSub(kf.offsetX!),
          interpolation: 'linear' as const,
        }))
        .sort((a, b) => a.frame - b.frame),
      interpolation: 'linear',
    };
  }

  // Offset Y track (linear interpolation)
  if (keyframes.some(kf => kf.offsetY !== undefined)) {
    tracks.y = {
      keyframes: keyframes
        .filter(kf => kf.offsetY !== undefined)
        .map(kf => ({
          frame: kf.frame,
          value: pxToSub(kf.offsetY!),
          interpolation: 'linear' as const,
        }))
        .sort((a, b) => a.frame - b.frame),
      interpolation: 'linear',
    };
  }

  // Direction → variantIndex track (step interpolation)
  if (keyframes.some(kf => kf.direction !== undefined)) {
    tracks.variantIndex = {
      keyframes: keyframes
        .filter(kf => kf.direction !== undefined)
        .map(kf => ({
          frame: kf.frame,
          value: directionToVariantIndex(kf.direction!),
          interpolation: 'step' as const,
        }))
        .sort((a, b) => a.frame - b.frame),
      interpolation: 'step',
    };
  }

  return tracks;
}

function mergeNodeTracks(base: NodeTracks, overlay: NodeTracks): NodeTracks {
  return {
    angle: overlay.angle ?? base.angle,
    x: overlay.x ?? base.x,
    y: overlay.y ?? base.y,
    stretch: overlay.stretch ?? base.stretch,
    variantIndex: overlay.variantIndex ?? base.variantIndex,
  };
}

function convertPuppetSocket(socket: PuppetSocket): Socket {
  return {
    id: socket.id,
    name: socket.name || socket.id,
    basePosition: { x: pxToSub(socket.localX ?? 0), y: pxToSub(socket.localY ?? 0) },
    directionOffsets: {}, // Will be populated from direction-specific data if available
    templateOffsets: {},  // L0 template suggestions — not present in old data
  };
}

function convertDirectionSprites(
  pNode: PuppetNode,
  parts: Part[],
): CostumePiece {
  const piece = createDefaultCostumePiece(pNode.id, pNode.color ?? '#808080');

  // Convert direction sprites
  if (pNode.directionSprites) {
    for (const [dir, partId] of Object.entries(pNode.directionSprites)) {
      if (!partId) continue;
      const dirIndex = directionToVariantIndex(dir);
      const part = parts.find(p => p.id === partId);
      if (part?.pixels && part.pixels.length > 0 && (part.pixels[0]?.length ?? 0) > 0) {
        // sprite.plug = part.pivotX/Y (rotation anchor), NOT pNode.plug (socket attachment point)
        piece.sprites[dirIndex] = {
          width: part.pixels[0].length,
          height: part.pixels.length,
          data: part.pixels,
          plug: { x: pxToSub(part.pivotX ?? 0), y: pxToSub(part.pivotY ?? 0) },
        };
      }
    }
  }

  // Default sprite for variant 0 if not already set
  if (!piece.sprites[0]) {
    const part = parts.find(p => p.id === pNode.spritePartId);
    if (part?.pixels && part.pixels.length > 0 && (part.pixels[0]?.length ?? 0) > 0) {
      piece.sprites[0] = {
        width: part.pixels[0].length,
        height: part.pixels.length,
        data: part.pixels,
        plug: { x: pxToSub(part.pivotX ?? 0), y: pxToSub(part.pivotY ?? 0) },
      };
    }
  }

  // Mirror config

  // Cross sections
  if (pNode.crossSectionTop) {
    piece.crossSections.push({
      id: 'plug',
      mode: 'inside',
      diameter: pNode.crossSectionTop,
    });
  }
  if (pNode.crossSectionBottom) {
    piece.crossSections.push({
      id: 'bottom',
      mode: 'inside',
      diameter: pNode.crossSectionBottom,
    });
  }

  return piece;
}

function convertOldCostumeSet(
  oldCS: OldCostumeSet,
  skeleton: PuppetSkeleton,
  parts: Part[],
): CostumeSet {
  const newCS = createDefaultCostumeSet(oldCS.id, oldCS.name);

  // Old costumeSet.spriteMap: Record<"nodeId:direction", partId>
  if (oldCS.spriteMap) {
    for (const [key, partId] of Object.entries(oldCS.spriteMap)) {
      if (!partId) continue;
      const [nodeId, dir] = key.split(':');
      const dirIndex = directionToVariantIndex(dir);
      const part = parts.find(p => p.id === partId);

      if (!newCS.pieces[nodeId]) {
        newCS.pieces[nodeId] = createDefaultCostumePiece(nodeId);
      }

      // sprite.plug = part.pivotX/Y (rotation anchor)
      if (part?.pixels && part.pixels.length > 0 && (part.pixels[0]?.length ?? 0) > 0) {
        newCS.pieces[nodeId].sprites[dirIndex] = {
          width: part.pixels[0].length,
          height: part.pixels.length,
          data: part.pixels,
          plug: { x: pxToSub(part.pivotX ?? 0), y: pxToSub(part.pivotY ?? 0) },
        };
      }
    }
  }

  return newCS;
}

// ============================================================
// Direction String → DirectionIndex Conversion
// ============================================================

const DIRECTION_MAP: Record<string, DirectionIndex> = {
  'east': 0, 'E': 0, 'right': 0,
  'ne': 1, 'NE': 1, 'northeast': 1,
  'north': 2, 'N': 2, 'up': 2,
  'nw': 3, 'NW': 3, 'northwest': 3,
  'west': 4, 'W': 4, 'left': 4,
  'sw': 5, 'SW': 5, 'southwest': 5,
  'south': 6, 'S': 6, 'down': 6,
  'se': 7, 'SE': 7, 'southeast': 7,
};

function directionToVariantIndex(direction: string): DirectionIndex {
  const lower = direction?.toLowerCase?.() ?? '';
  return (DIRECTION_MAP[lower] ?? DIRECTION_MAP[direction] ?? 0) as DirectionIndex;
}

// ============================================================
// Live Adapter: Query unified model from old store data
// ============================================================

/**
 * LiveAdapter provides a read-only unified view over the old store data.
 * It creates Character objects on-the-fly from the old Part + PuppetNode
 * data, without persisting the unified model.
 *
 * This is the bridge that allows the new render pipeline to consume
 * old store data while the migration is in progress.
 */
export class LiveAdapter {
  private characterCache: Map<string, Character> = new Map();
  private cacheKey: string = '';

  /**
   * Get a unified Character view from old store data.
   * Results are cached until invalidate() is called.
   */
  getCharacter(
    skeleton: PuppetSkeleton,
    characters: PuppetCharacter[],
    parts: Part[],
    nodeKeyframes: PuppetNodeKeyframe[],
    costumeSets: OldCostumeSet[],
  ): Character {
    const key = `${skeleton.id}:${skeleton.currentDirection}:${skeleton.nodes.map(n => n.id).join(',')}`;
    if (this.cacheKey === key && this.characterCache.has(skeleton.id)) {
      return this.characterCache.get(skeleton.id)!;
    }

    const character = puppetToCharacter(skeleton, characters, parts, nodeKeyframes, costumeSets);
    this.characterCache.set(skeleton.id, character);
    this.cacheKey = key;
    return character;
  }

  /**
   * Get sprite nodes (non-puppet parts) as a flat Character.
   */
  getSpriteCharacter(parts: Part[], puppetSpritePartIds: Set<string>): Character | null {
    const nonPuppetParts = parts.filter(p => !puppetSpritePartIds.has(p.id));
    if (nonPuppetParts.length === 0) return null;

    const charId = '_live_sprite_character';
    if (this.characterCache.has(charId)) {
      return this.characterCache.get(charId)!;
    }

    const char = createDefaultCharacter(charId, 'Sprites');
    const nodes: Record<string, Node> = {};

    for (const part of nonPuppetParts) {
      nodes[part.id] = partToNode(part);
    }

    // Part 不再有 parentId 层级，全部作为根节点的子节点（扁平）
    const rootPart = nonPuppetParts[0];
    if (rootPart) char.rootNodeId = rootPart.id;
    char.nodes = nodes;

    this.characterCache.set(charId, char);
    return char;
  }

  /** Invalidate cache when store data changes */
  invalidate(): void {
    this.characterCache.clear();
    this.cacheKey = '';
  }
}
