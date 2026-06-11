// ============================================================
// PixelMorpher - Skeleton & IK
// computeProceduralValue, solveIK, computeBoneTransforms, applyProceduralAnimations
// ============================================================

import type {
  ModifierInstance,
  ProceduralAnimation,
  ProceduralConfig,
  Skeleton,
  Bone,
  BonePose,
  BoneIKConstraint,
  BoneLimitConstraint,
} from '../types';
import { fbmNoise, seededRandom, simplex2D } from './noise';

// ============================================================
// V2.0: Procedural Animation System
// ============================================================

function computeProceduralValue(
  config: ProceduralConfig,
  frame: number,
): number {
  switch (config.type) {
    case 'noise': {
      return fbmNoise(frame * config.frequency, 0, config.octaves, config.seed) * config.amplitude;
    }
    case 'wave': {
      const t = frame * config.frequency + (config.phase / 360);
      const phase = t * Math.PI * 2;
      switch (config.waveType) {
        case 'sine': return Math.sin(phase) * config.amplitude;
        case 'triangle': return (2 * Math.abs(2 * (t % 1 - 0.5)) - 1) * config.amplitude;
        case 'square': return (Math.sin(phase) >= 0 ? 1 : -1) * config.amplitude;
        case 'sawtooth': return (2 * (t % 1) - 1) * config.amplitude;
        default: return Math.sin(phase) * config.amplitude;
      }
    }
    case 'spring': {
      // Damped spring oscillation
      const omega = Math.sqrt(config.stiffness / config.mass);
      const gamma = config.damping / (2 * config.mass);
      const dampedOmega = Math.sqrt(Math.max(0, omega * omega - gamma * gamma));
      const t = frame / 60; // time in seconds
      return (config.restLength > 0 ? config.restLength : 1) * Math.exp(-gamma * t) * Math.cos(dampedOmega * t) + config.restLength;
    }
    case 'jitter': {
      const seed = Math.floor(frame * config.frequency * 100);
      const rng = seededRandom(seed);
      if (config.smooth) {
        // Smooth jitter using noise
        return (simplex2D(frame * config.frequency, 0) * 2 - 1) * config.amount;
      } else {
        return (rng() * 2 - 1) * config.amount;
      }
    }
    default: return 0;
  }
}

// ============================================================
// V2.0: IK Solver (FABRIK Algorithm)
// ============================================================

function solveIK(
  bones: Bone[],
  rootBoneId: string,
  targetX: number,
  targetY: number,
  chainLength: number,
  iterations: number,
): Map<string, { x: number; y: number }> {
  // Build the bone chain from rootBoneId going down
  const chain: string[] = [];
  let currentId: string | null = rootBoneId;
  for (let i = 0; i < chainLength && currentId; i++) {
    chain.push(currentId);
    const bone = bones.find(b => b.id === currentId);
    currentId = null;
    if (bone) {
      // Find first child
      const child = bones.find(b => b.parentId === bone.id);
      if (child) currentId = child.id;
    }
  }

  // Initialize joint positions from bone heads/tails
  const positions = new Map<string, { x: number; y: number }>();
  for (const boneId of chain) {
    const bone = bones.find(b => b.id === boneId)!;
    positions.set(boneId + '_head', { x: bone.headX, y: bone.headY });
    positions.set(boneId + '_tail', { x: bone.tailX, y: bone.tailY });
  }

  // FABRIK iterations
  for (let iter = 0; iter < iterations; iter++) {
    // Forward pass: from end effector to root
    const lastBone = bones.find(b => b.id === chain[chain.length - 1])!;
    positions.set(lastBone.id + '_tail', { x: targetX, y: targetY });

    for (let i = chain.length - 1; i > 0; i--) {
      const bone = bones.find(b => b.id === chain[i])!;
      const parentBone = bones.find(b => b.id === chain[i - 1])!;
      const tail = positions.get(bone.id + '_tail')!;
      const boneLen = bone.length;
      const head = positions.get(parentBone.id + '_tail')!;
      const dx = head.x - tail.x;
      const dy = head.y - tail.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.001) {
        const ratio = boneLen / dist;
        positions.set(bone.id + '_head', {
          x: tail.x + dx * ratio,
          y: tail.y + dy * ratio,
        });
        positions.set(parentBone.id + '_tail', {
          x: tail.x + dx * ratio,
          y: tail.y + dy * ratio,
        });
      }
    }

    // Backward pass: from root to end effector
    const firstBone = bones.find(b => b.id === chain[0])!;
    positions.set(firstBone.id + '_head', { x: firstBone.headX, y: firstBone.headY });

    for (let i = 0; i < chain.length; i++) {
      const bone = bones.find(b => b.id === chain[i])!;
      const head = positions.get(bone.id + '_head')!;
      const boneLen = bone.length;
      const tail = positions.get(bone.id + '_tail') || { x: bone.tailX, y: bone.tailY };
      const dx = tail.x - head.x;
      const dy = tail.y - head.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.001) {
        const ratio = boneLen / dist;
        positions.set(bone.id + '_tail', {
          x: head.x + dx * ratio,
          y: head.y + dy * ratio,
        });
        if (i < chain.length - 1) {
          const nextBone = bones.find(b => b.id === chain[i + 1])!;
          positions.set(nextBone.id + '_head', {
            x: head.x + dx * ratio,
            y: head.y + dy * ratio,
          });
        }
      }
    }
  }

  return positions;
}

// ============================================================
// V2.0: Bone-Driven Transforms
// ============================================================

export function computeBoneTransforms(
  skeleton: Skeleton,
  frame: number,
): Map<string, { rotation: number; headX: number; headY: number; tailX: number; tailY: number }> {
  const result = new Map<string, { rotation: number; headX: number; headY: number; tailX: number; tailY: number }>();

  // Pre-compute interpolated rotation for each bone by finding surrounding poses
  const boneRotations = new Map<string, number>();
  // Also collect interpolated IK targets from poses
  const boneIKTargets = new Map<string, { targetX: number; targetY: number }>();

  for (const bone of skeleton.bones) {
    const bonePoses = skeleton.poses
      .filter(p => p.boneId === bone.id)
      .sort((a, b) => a.frame - b.frame);

    let prevPose: BonePose | null = null;
    let nextPose: BonePose | null = null;

    for (const pose of bonePoses) {
      if (pose.frame <= frame) prevPose = pose;
      if (pose.frame > frame && !nextPose) nextPose = pose;
    }

    if (prevPose && nextPose && prevPose.frame !== nextPose.frame) {
      // Interpolate rotation between surrounding poses
      const t = (frame - prevPose.frame) / (nextPose.frame - prevPose.frame);
      boneRotations.set(bone.id, prevPose.rotation + (nextPose.rotation - prevPose.rotation) * t);

      // Interpolate IK target if present in poses
      if (prevPose.ikTargetX != null && prevPose.ikTargetY != null &&
          nextPose.ikTargetX != null && nextPose.ikTargetY != null) {
        boneIKTargets.set(bone.id, {
          targetX: prevPose.ikTargetX + (nextPose.ikTargetX - prevPose.ikTargetX) * t,
          targetY: prevPose.ikTargetY + (nextPose.ikTargetY - prevPose.ikTargetY) * t,
        });
      }
    } else if (prevPose) {
      boneRotations.set(bone.id, prevPose.rotation);
      // Use IK target from pose
      if (prevPose.ikTargetX != null && prevPose.ikTargetY != null) {
        boneIKTargets.set(bone.id, { targetX: prevPose.ikTargetX, targetY: prevPose.ikTargetY });
      }
    } else {
      // No pose at or before current frame, use bone's default poseRotation
      boneRotations.set(bone.id, bone.poseRotation);
    }
  }

  // Process bones in hierarchy order (forward kinematics pass)
  const processBone = (bone: Bone, parentTransform?: { rotation: number; headX: number; headY: number; tailX: number; tailY: number }) => {
    const rotation = boneRotations.get(bone.id) ?? bone.poseRotation;

    let headX = bone.headX;
    let headY = bone.headY;

    // If has parent, transform head position by parent's transform
    if (parentTransform && bone.parentId) {
      const parentBone = skeleton.bones.find(b => b.id === bone.parentId);
      if (parentBone) {
        // Head connects to parent's tail
        headX = parentTransform.tailX;
        headY = parentTransform.tailY;
      }
    }

    // Apply limit_rotation constraint before computing tail
    let effectiveRotation = rotation;
    const limitConstraint = bone.constraints.find((c): c is BoneLimitConstraint => c.type === 'limit_rotation');
    if (limitConstraint) {
      effectiveRotation = Math.max(limitConstraint.minAngle, Math.min(limitConstraint.maxAngle, rotation));
    }

    // Compute tail based on rotation
    const angle = (bone.restRotation + effectiveRotation) * Math.PI / 180;
    const tailX = headX + Math.cos(angle) * bone.length;
    const tailY = headY + Math.sin(angle) * bone.length;

    result.set(bone.id, { rotation: effectiveRotation + bone.restRotation, headX, headY, tailX, tailY });

    // Process children
    const children = skeleton.bones.filter(b => b.parentId === bone.id);
    for (const child of children) {
      processBone(child, result.get(bone.id));
    }
  };

  // Start from root bones — forward kinematics pass
  const rootBones = skeleton.bones.filter(b => !b.parentId);
  for (const root of rootBones) {
    processBone(root);
  }

  // ---- IK solver pass ----
  // After forward kinematics, apply IK constraints by running the FABRIK solver
  // on bones that have an ik_solver constraint, then update their transforms.
  for (const bone of skeleton.bones) {
    const ikConstraint = bone.constraints.find((c): c is BoneIKConstraint => c.type === 'ik_solver');
    if (!ikConstraint) continue;

    // Determine IK target: prefer animated pose target, fall back to constraint default
    const poseTarget = boneIKTargets.get(bone.id);
    const targetX = poseTarget?.targetX ?? ikConstraint.targetX;
    const targetY = poseTarget?.targetY ?? ikConstraint.targetY;

    // Find the root of this IK chain (walk up chainLength ancestors)
    let chainRootId: string | null = bone.id;
    for (let i = 0; i < ikConstraint.chainLength - 1 && chainRootId; i++) {
      const current = skeleton.bones.find(b => b.id === chainRootId);
      if (current?.parentId) {
        chainRootId = current.parentId;
      } else {
        break;
      }
    }

    // Run FABRIK solver
    const ikPositions = solveIK(
      skeleton.bones,
      chainRootId,
      targetX,
      targetY,
      ikConstraint.chainLength,
      ikConstraint.iterations || 10,
    );

    // Apply IK results back to the bone transforms
    // Walk the IK chain and update head/tail/rotation from solver positions
    let currentId: string | null = chainRootId;
    for (let i = 0; i < ikConstraint.chainLength && currentId; i++) {
      const ikBone = skeleton.bones.find(b => b.id === currentId);
      if (!ikBone) break;

      const headPos = ikPositions.get(currentId + '_head');
      const tailPos = ikPositions.get(currentId + '_tail');

      if (headPos && tailPos) {
        // Compute rotation from head→tail direction
        const dx = tailPos.x - headPos.x;
        const dy = tailPos.y - headPos.y;
        const ikRotation = Math.atan2(dy, dx) * 180 / Math.PI - ikBone.restRotation;

        result.set(currentId, {
          rotation: ikRotation + ikBone.restRotation,
          headX: headPos.x,
          headY: headPos.y,
          tailX: tailPos.x,
          tailY: tailPos.y,
        });
      }

      // Move to next bone in chain
      const childBone = skeleton.bones.find(b => b.parentId === currentId);
      currentId = childBone?.id ?? null;
    }

    // Re-propagate transforms for any bones downstream of the IK chain
    // that were not part of the chain itself
    const lastBoneInChain = (() => {
      let id: string | null = chainRootId;
      let last: string | null = null;
      for (let i = 0; i < ikConstraint.chainLength && id; i++) {
        last = id;
        const b = skeleton.bones.find(b => b.id === id);
        id = b ? (skeleton.bones.find(c => c.parentId === b.id)?.id ?? null) : null;
      }
      return last;
    })();

    if (lastBoneInChain) {
      const lastTransform = result.get(lastBoneInChain);
      if (lastTransform) {
        const repropagate = (boneId: string, parentTf: { rotation: number; headX: number; headY: number; tailX: number; tailY: number }) => {
          const children = skeleton.bones.filter(b => b.parentId === boneId);
          for (const child of children) {
            const childRotation = boneRotations.get(child.id) ?? child.poseRotation;
            const headX = parentTf.tailX;
            const headY = parentTf.tailY;
            const angle = (child.restRotation + childRotation) * Math.PI / 180;
            const tailX = headX + Math.cos(angle) * child.length;
            const tailY = headY + Math.sin(angle) * child.length;
            result.set(child.id, { rotation: childRotation + child.restRotation, headX, headY, tailX, tailY });
            repropagate(child.id, result.get(child.id)!);
          }
        };
        repropagate(lastBoneInChain, lastTransform);
      }
    }
  }

  return result;
}

// ============================================================
// V2.0: Apply Procedural Animations to Modifiers
// ============================================================

export function applyProceduralAnimations(
  modifiers: ModifierInstance[],
  proceduralAnimations: ProceduralAnimation[],
  partId: string,
  frame: number,
): ModifierInstance[] {
  // Deep-clone modifiers (shallow copy of each modifier + its params)
  // to prevent mutating the store's original modifier objects.
  // Without this, the render loop would accumulate procedural values
  // on every frame because it ADDS to existing values.
  const result = modifiers.map(m => ({
    ...m,
    params: { ...m.params },
  }));

  for (const pa of proceduralAnimations) {
    if (!pa.enabled || pa.partId !== partId) continue;
    if (frame < pa.startFrame || frame > pa.endFrame) continue;

    const value = computeProceduralValue(pa.config, frame);

    switch (pa.config.targetProperty) {
      case 'translateX': {
        const translateMod = result.find(m => m.type === 'translate');
        if (translateMod) {
          translateMod.params = { ...translateMod.params, offsetX: (Number(translateMod.params.offsetX) || 0) + value };
        }
        break;
      }
      case 'translateY': {
        const translateMod = result.find(m => m.type === 'translate');
        if (translateMod) {
          translateMod.params = { ...translateMod.params, offsetY: (Number(translateMod.params.offsetY) || 0) + value };
        }
        break;
      }
      case 'rotation': {
        const rotateMod = result.find(m => m.type === 'rotate');
        if (rotateMod) {
          rotateMod.params = { ...rotateMod.params, angle: (Number(rotateMod.params.angle) || 0) + value };
        }
        break;
      }
      case 'scale': {
        const scaleMod = result.find(m => m.type === 'uniform_scale');
        if (scaleMod) {
          scaleMod.params = { ...scaleMod.params, scale: Math.max(0.1, (Number(scaleMod.params.scale) || 1) + value / 10) };
        }
        break;
      }
    }
  }

  return result;
}
