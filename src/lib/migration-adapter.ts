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

  // Transform from Part offsets and pivot
  node.transform = {
    x: pxToSub(part.offsetX ?? 0),
    y: pxToSub(part.offsetY ?? 0),
    angle: 0,    // Part rotation was driven by modifiers, not stored directly
    stretch: 1.0,
    variantIndex: 0,
  };

  // Attachment: fixed offset with optional parent
  node.attachment = {
    type: 'fixed',
    fixedOffset: { x: 0, y: 0 },
    inheritRotation: true,
  };
  if (part.parentId) {
    node.parentId = part.parentId;
  }

  // Copy edit modifiers and animation modifiers as node modifiers
  node.modifiers = [
    ...(part.editModifiers ?? []),
    ...(part.animationModifiers ?? []),
    ...(part.globalModifiers ?? []),
  ].map(convertOldModifier);

  // Convert keyframes to tracks
  node.tracks = convertPartKeyframesToTracks(part.partKeyframes ?? [], part.id);

  // Draw order
  node.zIndex = part.zIndex ?? 0;
  node.drawLayer = 'default';

  // Visibility
  node.visible = part.visible !== false;

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
    };
  } else {
    node.attachment = createDefaultAttachment();
  }

  // Convert sockets
  node.sockets = (pNode.sockets ?? []).map(s => convertPuppetSocket(s));

  // Draw order
  node.zIndex = pNode.zIndex ?? 0;
  node.drawLayer = 'default';
  node.visible = pNode.visible !== false;

  // Copy modifiers from the sprite Part.
  // PuppetNodes don't have their own modifier stacks — the modifiers live on the
  // Part that provides the sprite. We need to bring them into the unified Node
  // so the render pipeline can apply them (pixel edits, color replace, outline, etc.).
  if (spritePart) {
    node.modifiers = [
      ...(spritePart.editModifiers ?? []),
      ...(spritePart.animationModifiers ?? []),
      ...(spritePart.globalModifiers ?? []),
    ].map(convertOldModifier);
  }

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

// ============================================================
// Full Project Migration
// ============================================================

/**
 * Migrate an entire old Project to the new UnifiedProject format.
 * Returns the new project and a migration map for reference.
 */
export function migrateOldProject(oldProject: {
  parts: Part[];
  puppetSkeletons?: PuppetSkeleton[];
  puppetCharacters?: PuppetCharacter[];
  puppetNodeKeyframes?: PuppetNodeKeyframe[];
  animationClips?: OldAnimationClip[];
  costumeSets?: OldCostumeSet[];
  [key: string]: any;
}): { project: import('./unified-types').UnifiedProject; migrationMap: MigrationMap } {
  const migrationMap: MigrationMap = {
    partToNode: {},
    puppetNodeToNode: {},
    skeletonToCharacter: {},
    oldClipToNewClip: {},
  };

  const characters: Character[] = [];

  // 1. Convert puppet skeletons → characters
  if (oldProject.puppetSkeletons && oldProject.puppetSkeletons.length > 0) {
    for (const skeleton of oldProject.puppetSkeletons) {
      const character = puppetToCharacter(
        skeleton,
        oldProject.puppetCharacters ?? [],
        oldProject.parts,
        oldProject.puppetNodeKeyframes ?? [],
        oldProject.costumeSets ?? [],
        migrationMap,
      );
      characters.push(character);
      migrationMap.skeletonToCharacter[skeleton.id] = character.id;

      // Map puppet nodes
      for (const pNode of skeleton.nodes) {
        migrationMap.puppetNodeToNode[pNode.id] = pNode.id; // IDs preserved
      }
    }
  }

  // 2. Convert non-puppet parts → standalone character
  const puppetSpritePartIds = new Set<string>();
  if (oldProject.puppetSkeletons) {
    for (const skeleton of oldProject.puppetSkeletons) {
      for (const node of skeleton.nodes) {
        if (node.spritePartId) puppetSpritePartIds.add(node.spritePartId);
        if (node.directionSprites) {
          for (const partId of Object.values(node.directionSprites)) {
            if (partId) puppetSpritePartIds.add(partId);
          }
        }
      }
    }
  }

  const nonPuppetParts = oldProject.parts.filter(p => !puppetSpritePartIds.has(p.id));
  if (nonPuppetParts.length > 0) {
    const spriteCharId = '_sprite_character';
    const spriteChar = createDefaultCharacter(spriteCharId, 'Sprites');
    const spriteNodes: Record<string, Node> = {};

    for (const part of nonPuppetParts) {
      const node = partToNode(part, migrationMap);
      spriteNodes[node.id] = node;
      migrationMap.partToNode[part.id] = node.id;
    }

    // Build parent-child from part.parentId
    for (const part of nonPuppetParts) {
      if (part.parentId && spriteNodes[part.id] && spriteNodes[part.parentId]) {
        spriteNodes[part.id].parentId = part.parentId;
        if (!spriteNodes[part.parentId].children.includes(part.id)) {
          spriteNodes[part.parentId].children.push(part.id);
        }
      }
    }

    // Find root (first part with no parent, or first part)
    const rootPart = nonPuppetParts.find(p => !p.parentId) ?? nonPuppetParts[0];
    if (rootPart) spriteChar.rootNodeId = rootPart.id;

    spriteChar.nodes = spriteNodes;
    characters.push(spriteChar);
  }

  // 3. Build unified project
  const project: import('./unified-types').UnifiedProject = {
    id: oldProject.id,
    name: oldProject.name || 'Untitled',
    characters,
    animationClips: convertOldClips(oldProject.animationClips ?? [], migrationMap),
    globalModifiers: convertOldGlobalModifiers(oldProject.globalModifiers ?? []),
    animationVariables: convertOldAnimationVariables(oldProject.animationVariables ?? []),
    canvasWidth: oldProject.canvasWidth ?? 64,
    canvasHeight: oldProject.canvasHeight ?? 64,
    backgroundColor: oldProject.backgroundColor ?? '#000000',
    frameRate: oldProject.frameRate ?? 12,
    palettes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return { project, migrationMap };
}

// ============================================================
// Helper: Old Type Conversion Functions
// ============================================================

// ---- Param Value Filtering ----

/**
 * Filter old ModifierParamValue to only include types compatible with
 * the unified model (string | number | boolean | number[]).
 * Old params can contain BrushCommand[] and StyleAspect[] which are
 * not supported in the unified model and are dropped during migration.
 */
function filterUnifiedParams(
  params: Record<string, any>,
): Record<string, import('./unified-types').ModifierParamValue> {
  const result: Record<string, import('./unified-types').ModifierParamValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
      result[key] = value;
    }
    // Drop BrushCommand[], StyleAspect[], and other incompatible types
  }
  return result;
}

// ---- Effect Track Migration ----

/**
 * Convert old EffectTrack[] to unified EffectTrack[].
 * Old EffectTrack lacks the `locked` field present in the unified type.
 */
function convertOldEffectTracks(
  oldTracks: any[],
): import('./unified-types').EffectTrack[] {
  return oldTracks.map(track => ({
    id: track.id,
    type: track.type,
    name: track.name,
    keyframes: (track.keyframes ?? []).map((kf: any) => ({
      frame: kf.frame,
      params: filterUnifiedParams(kf.params ?? {}),
    })),
    visible: track.visible ?? true,
    locked: track.locked ?? false,
  }));
}

// ---- Canvas Modifier Track Migration ----

/**
 * Convert old CanvasModifierTrack[] to unified CanvasModifierTrack[].
 * Old CanvasModifierTrack has `visible` and `modifiers` fields not in unified.
 * Unified CanvasModifierTrack has `enabled` (maps from old `enabled`).
 */
function convertOldCanvasModifierTracks(
  oldTracks: any[],
): import('./unified-types').CanvasModifierTrack[] {
  return oldTracks.map(track => ({
    id: track.id,
    type: track.type,
    name: track.name,
    keyframes: (track.keyframes ?? []).map((kf: any) => ({
      frame: kf.frame,
      params: filterUnifiedParams(kf.params ?? {}),
    })),
    enabled: track.enabled ?? true,
  }));
}

// ---- Animation Clip Migration ----

/**
 * Convert old AnimationClip[] to UnifiedAnimationClip[].
 *
 * Old clips come in two flavors:
 * - Non-puppet clips: keyframe data in clip.keyframes + clipPartData (per-part modifier stacks)
 * - Puppet clips: keyframe data in clip.puppetNodeKeyframes (per-node angle/stretch/offset/direction)
 *
 * In the unified model, both are represented as UnifiedAnimationClip with nodeTracks.
 * - Non-puppet part keyframes are converted using convertPartKeyframesToTracks()
 *   (extracts translate/rotate/scale from modifier stacks)
 * - Puppet node keyframes are converted using convertPuppetKeyframesToTracks()
 * - Effect tracks and canvas modifier tracks are carried over as-is (compatible interfaces)
 */
function convertOldClips(
  oldClips: OldAnimationClip[],
  migrationMap: MigrationMap,
): UnifiedAnimationClip[] {
  const result: UnifiedAnimationClip[] = [];

  for (const oldClip of oldClips) {
    // Determine the characterId this clip belongs to
    let characterId: string;
    if (oldClip.isPuppetClip && oldClip.puppetCharacterId) {
      characterId = oldClip.puppetCharacterId;
    } else {
      // Non-puppet clips animate the sprite character
      characterId = '_sprite_character';
    }

    // Build nodeTracks from all sources
    const nodeTracks: Record<string, NodeTracks> = {};

    // Source 1: Puppet node keyframes (angle, stretch, offsetX, offsetY, direction)
    if (oldClip.puppetNodeKeyframes && oldClip.puppetNodeKeyframes.length > 0) {
      const kfByNode: Record<string, PuppetNodeKeyframe[]> = {};
      for (const kf of oldClip.puppetNodeKeyframes) {
        if (!kfByNode[kf.nodeId]) kfByNode[kf.nodeId] = [];
        kfByNode[kf.nodeId].push(kf);
      }
      for (const [nodeId, kfs] of Object.entries(kfByNode)) {
        nodeTracks[nodeId] = convertPuppetKeyframesToTracks(kfs);
      }
    }

    // Source 2: ClipPartData keyframes (per-part modifier stacks at specific frames)
    if (oldClip.clipPartData && oldClip.clipPartData.length > 0) {
      for (const cpd of oldClip.clipPartData) {
        if (cpd.partKeyframes && cpd.partKeyframes.length > 0) {
          const nodeId = migrationMap.partToNode[cpd.partId] ?? cpd.partId;
          const tracks = convertPartKeyframesToTracks(cpd.partKeyframes, cpd.partId);
          if (nodeTracks[nodeId]) {
            nodeTracks[nodeId] = mergeNodeTracks(nodeTracks[nodeId], tracks);
          } else {
            nodeTracks[nodeId] = tracks;
          }
        }
        // Animation modifiers from clipPartData are converted as animation modifier tracks.
        // These drive transform properties (pendulum, bounce, etc.) and are stored as
        // ModifierInstances on the node itself — already handled by convertOldModifier
        // during partToNode/puppetNodeToNode conversion. The clipPartData.animationModifiers
        // per-clip override is a feature that requires per-clip node modifiers in the unified
        // model, which is a future enhancement. For now, the base node modifiers are used.
      }
    }

    // Source 3: Legacy keyframes (part-level modifier stacks at specific frames)
    if (oldClip.keyframes && oldClip.keyframes.length > 0) {
      const kfByPart: Record<string, OldKeyframe[]> = {};
      for (const kf of oldClip.keyframes) {
        if (!kfByPart[kf.partId]) kfByPart[kf.partId] = [];
        kfByPart[kf.partId].push(kf);
      }
      for (const [partId, kfs] of Object.entries(kfByPart)) {
        const nodeId = migrationMap.partToNode[partId] ?? partId;
        const tracks = convertPartKeyframesToTracks(
          kfs.map(kf => ({
            frame: kf.frame,
            editModifiers: kf.modifiers,
            modifiers: kf.modifiers,
          })),
          partId,
        );
        if (nodeTracks[nodeId]) {
          nodeTracks[nodeId] = mergeNodeTracks(nodeTracks[nodeId], tracks);
        } else {
          nodeTracks[nodeId] = tracks;
        }
      }
    }

    const newClip: UnifiedAnimationClip = {
      id: oldClip.id,
      name: oldClip.name,
      characterId,
      frameRate: oldClip.frameRate ?? 12,
      startFrame: 0,
      endFrame: oldClip.totalFrames ?? 60,
      loop: true,
      nodeTracks,
      effectTracks: convertOldEffectTracks(oldClip.effectTracks ?? []),
      canvasModifierTracks: convertOldCanvasModifierTracks(oldClip.canvasModifierTracks ?? []),
      createdAt: oldClip.createdAt ?? Date.now(),
      updatedAt: oldClip.updatedAt ?? Date.now(),
    };

    result.push(newClip);
    migrationMap.oldClipToNewClip[oldClip.id] = oldClip.id; // IDs preserved
  }

  return result;
}

// ---- Global Modifier Migration ----

/**
 * Convert old GlobalModifier[] to unified GlobalModifier[].
 *
 * The old GlobalModifier is richer (startFrame, endFrame, fadeInFrames, fadeOutFrames,
 * blendMode, paramKeyframes with interpolation, paramDrivers). The unified GlobalModifier
 * is simplified to: id, type, enabled, params, keyframes.
 *
 * Migration strategy:
 * - Map core fields (id, type, enabled, params)
 * - Convert old paramKeyframes → GlobalModifierKeyframe[] (loses interpolation/bezier info)
 * - Convert old paramDrivers into keyframes by sampling their waveform at each frame
 *   (approximation — the unified model uses a simpler keyframe-only approach)
 * - startFrame/endFrame/fadeInFrames/fadeOutFrames are encoded into the keyframes:
 *   before startFrame: no keyframes (params inactive), after endFrame: no keyframes.
 *   Fade-in/out could be represented by interpolating params, but for migration we keep it simple.
 */
function convertOldGlobalModifiers(
  oldMods: OldGlobalModifier[],
): UnifiedGlobalModifier[] {
  return oldMods.map(mod => {
    const keyframes: GlobalModifierKeyframe[] = [];

    // Convert existing paramKeyframes (lose interpolation/bezier detail)
    if (mod.paramKeyframes && mod.paramKeyframes.length > 0) {
      for (const pkf of mod.paramKeyframes) {
        keyframes.push({
          frame: pkf.frame,
          params: filterUnifiedParams(pkf.params ?? {}),
        });
      }
    }

    // If there are paramDrivers, we could sample them into keyframes here.
    // For now, the unified animation resolver handles ParamDrivers at runtime
    // on the ModifierInstance level. Global modifiers in the unified model
    // use a simpler keyframe-only approach.

    // Sort keyframes by frame
    keyframes.sort((a, b) => a.frame - b.frame);

    return {
      id: mod.id,
      type: mod.type,
      enabled: mod.enabled,
      params: filterUnifiedParams(mod.params ?? {}),
      keyframes,
    };
  });
}

// ---- Animation Variable Migration ----

/**
 * Convert old AnimationVariable[] to unified AnimationVariable[].
 *
 * The old AnimationVariable has scope, partId, writerDriverId, defaultValue, mode.
 * The unified AnimationVariable is simplified to: id, name, value, min, max.
 *
 * Migration strategy:
 * - Map id, name
 * - defaultValue → value
 * - Set min/max to reasonable defaults (0, 100)
 * - scope and writerDriverId are lost — the unified model uses a different
 *   driver system. Old ParamDrivers with variable sources will need to be
 *   re-linked manually or via a future migration enhancement.
 * - mode ('value'/'accumulator') is lost — accumulator variables would need
 *   special handling in the unified model.
 */
function convertOldAnimationVariables(
  oldVars: OldAnimationVariable[],
): UnifiedAnimationVariable[] {
  return oldVars.map(v => ({
    id: v.id,
    name: v.name,
    value: v.defaultValue ?? 0,
    min: 0,
    max: 100,
  }));
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
  if (pNode.mirrorFrom) {
    piece.mirrorMap = { ...DEFAULT_MIRROR_MAP };
  }

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
// Reverse Conversion: New → Old (for backward compatibility)
// ============================================================

/**
 * Convert a unified Character back to old PuppetSkeleton + PuppetNode + Part format.
 * Used for exporting to old project format or for components not yet migrated.
 */
function characterToOldFormat(character: Character): {
  skeleton: PuppetSkeleton;
  parts: Part[];
  nodeKeyframes: PuppetNodeKeyframe[];
} {
  const nodes: PuppetNode[] = [];
  const parts: Part[] = [];
  const keyframes: PuppetNodeKeyframe[] = [];

  for (const [id, node] of Object.entries(character.nodes)) {
    // Convert to PuppetNode
    const pNode: PuppetNode = {
      id: node.id,
      name: node.name,
      sockets: node.sockets.map(s => ({
        id: s.id,
        name: s.name,
        localX: s.basePosition.x / 16,
        localY: s.basePosition.y / 16,
      })),
      plug: node.attachment.type === 'socket' && node.attachment.plug && node.attachment.parentSocketId
        ? { socketId: node.attachment.parentSocketId, localX: node.attachment.plug.x / 16, localY: node.attachment.plug.y / 16 }
        : null,
      spritePartId: `${node.id}_sprite`,
      directionSprites: {},
      mirrorFrom: node.costumePiece ? Object.keys(node.costumePiece.mirrorMap).length > 0 : false,
      angle: node.transform.angle,
      stretch: node.transform.stretch,
      offsetX: node.transform.x / 16,
      offsetY: node.transform.y / 16,
      zIndex: node.zIndex,
      visible: node.visible,
      color: node.costumePiece?.fillColor ?? '#808080',
      crossSectionTop: node.generated?.type === 'disc'
        ? (node.costumePiece?.crossSections.find(cs => cs.id === 'plug')?.diameter ?? 4)
        : 0,
      crossSectionBottom: node.costumePiece?.crossSections.find(cs => cs.id === 'bottom')?.diameter ?? 0,
    };

    // Convert sprite to Part
    if (node.sprite) {
      const part: Part = {
        id: `${node.id}_sprite`,
        name: `${node.name}_sprite`,
        width: node.sprite.width,
        height: node.sprite.height,
        pixels: node.sprite.data,
        pivotX: 0,
        pivotY: 0,
        offsetX: 0,
        offsetY: 0,
        zIndex: node.zIndex,
        visible: node.visible,
        locked: false,
        parentId: node.parentId ?? null,
        editModifiers: node.modifiers.filter(m =>
          !['pendulum', 'wheel', 'bounce', 'breath', 'wobble', 'gait', 'custom_wave'].includes(m.type)
        ).map(convertNewModifier),
        animationModifiers: node.modifiers.filter(m =>
          ['pendulum', 'wheel', 'bounce', 'breath', 'wobble', 'gait', 'custom_wave'].includes(m.type)
        ).map(convertNewModifierToAnim),
        globalModifiers: [],
        modifierGroups: [],
        partKeyframes: [],
      };
      parts.push(part);
    }

    // Convert direction sprites from costume piece
    if (node.costumePiece) {
      for (const [dirIdx, sprite] of Object.entries(node.costumePiece.sprites)) {
        const dirName = variantIndexToDirection(Number(dirIdx) as DirectionIndex);
        if (sprite) {
          const spritePartId = `${node.id}_sprite_${dirIdx}`;
          pNode.directionSprites[dirName] = spritePartId;
          parts.push({
            id: spritePartId,
            name: `${node.name}_${dirName}`,
            width: sprite.width,
            height: sprite.height,
            pixels: sprite.data,
            pivotX: 0, pivotY: 0, offsetX: 0, offsetY: 0,
            zIndex: node.zIndex, visible: node.visible, locked: false,
            parentId: null,
            editModifiers: [], animationModifiers: [], globalModifiers: [], modifierGroups: [], partKeyframes: [],
          });
        }
      }
    }

    nodes.push(pNode);

    // Convert tracks to keyframes
    if (node.tracks.angle?.keyframes) {
      for (const kf of node.tracks.angle.keyframes) {
        keyframes.push({
          id: `${node.id}_angle_${kf.frame}`,
          nodeId: node.id,
          frame: kf.frame,
          angle: kf.value,
        });
      }
    }
    if (node.tracks.stretch?.keyframes) {
      for (const kf of node.tracks.stretch.keyframes) {
        // Merge with existing keyframe or create new
        const existing = keyframes.find(k => k.nodeId === node.id && k.frame === kf.frame);
        if (existing) {
          existing.stretch = kf.value;
        } else {
          keyframes.push({ id: `${node.id}_stretch_${kf.frame}`, nodeId: node.id, frame: kf.frame, stretch: kf.value });
        }
      }
    }
    if (node.tracks.x?.keyframes) {
      for (const kf of node.tracks.x.keyframes) {
        const existing = keyframes.find(k => k.nodeId === node.id && k.frame === kf.frame);
        if (existing) {
          existing.offsetX = kf.value / 16;
        } else {
          keyframes.push({ id: `${node.id}_ox_${kf.frame}`, nodeId: node.id, frame: kf.frame, offsetX: kf.value / 16 });
        }
      }
    }
    if (node.tracks.y?.keyframes) {
      for (const kf of node.tracks.y.keyframes) {
        const existing = keyframes.find(k => k.nodeId === node.id && k.frame === kf.frame);
        if (existing) {
          existing.offsetY = kf.value / 16;
        } else {
          keyframes.push({ id: `${node.id}_oy_${kf.frame}`, nodeId: node.id, frame: kf.frame, offsetY: kf.value / 16 });
        }
      }
    }
  }

  const skeleton: PuppetSkeleton = {
    id: character.id,
    name: character.name,
    nodes,
    currentDirection: variantIndexToDirection(
      character.nodes[character.rootNodeId]?.transform.variantIndex ?? 0
    ),
    viewLatitude: character.latitude,
  };

  return { skeleton, parts, nodeKeyframes: keyframes };
}

function convertNewModifier(mod: ModifierInstance): any {
  return {
    id: mod.id,
    type: mod.type,
    enabled: mod.enabled,
    collapsed: mod.collapsed,
    params: mod.params,
    coordinateMode: mod.coordinateMode ?? 'local',
    blendMode: mod.blendMode,
    startFrame: mod.startFrame,
    endFrame: mod.endFrame,
    paramKeyframes: mod.paramKeyframes,
    paramDrivers: mod.paramDrivers,
  };
}

function convertNewModifierToAnim(mod: ModifierInstance): any {
  return {
    id: mod.id,
    type: mod.type,
    enabled: mod.enabled,
    collapsed: mod.collapsed,
    params: mod.params,
    startFrame: mod.startFrame ?? 0,
    endFrame: mod.endFrame ?? -1,
    blendMode: mod.blendMode ?? 'add',
    groupId: undefined,
    paramKeyframes: mod.paramKeyframes,
    paramDrivers: mod.paramDrivers,
  };
}

function variantIndexToDirection(idx: DirectionIndex): import('./types').PuppetDirection {
  const map: Record<DirectionIndex, import('./types').PuppetDirection> = {
    0: 'E', 1: 'NE', 2: 'N', 3: 'NW',
    4: 'W', 5: 'SW', 6: 'S', 7: 'SE',
  };
  return map[idx] ?? 'E';
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

    // Build parent-child
    for (const part of nonPuppetParts) {
      if (part.parentId && nodes[part.parentId]) {
        nodes[part.id].parentId = part.parentId;
        if (!nodes[part.parentId].children.includes(part.id)) {
          nodes[part.parentId].children.push(part.id);
        }
      }
    }

    const rootPart = nonPuppetParts.find(p => !p.parentId) ?? nonPuppetParts[0];
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
