// 钳制锚定会话层（裁决 6：片段起点状态缓存）：
// 冻结状态只能顺序步进得到。本层持有每角色一份步进状态 + 每片段
// 起点的状态快照缓存：顺序播放时逐帧步进；scrub 跳帧时取目标片段
// 起点的快照为初态、只重演片段内的帧；编辑（角色节点对象/锚定定义
// 变化）使全部缓存失效、从最近仍有效的快照重建（本实现以角色对象
// 身份为纪元，编辑即换对象 → 整表失效，简单且正确，成本是重演到
// 目标片段起点，片段通常短）。
// 触发步进只读平结算位（computeWorldTransforms 无 ctx 的结果），
// 与是否施加反移无关——状态演化因此可独立预演。
import {
  computeWorldTransforms,
  stepClampState,
  type ClampContext,
  type ClampStateMap,
  type ClampFrozen,
} from './unified-render';
import type { Character } from './unified-types';
import type { AnimationClip } from './types';
import type { Sprite } from './unified-types';

interface SessionEntry {
  epochObj: Character;
  state: ClampStateMap;
  /** state 已步进到的帧（含） */
  steppedTo: number;
  /** 片段起点 → 该起点之前（startFrame-1 步进完）的状态快照 */
  clipStarts: Map<number, ClampStateMap>;
  lastReportFrame: number;
}

const sessions = new Map<string, SessionEntry>();

function cloneState(state: ClampStateMap): ClampStateMap {
  const out: ClampStateMap = new Map();
  for (const [k, v] of state) {
    out.set(k, v ? { points: v.points.map((p) => ({ ...p })) } : null);
  }
  return out;
}

export interface ClampSessionOpts {
  canvasWidth: number;
  canvasHeight: number;
  frameRate?: number;
  sprites?: Record<string, Sprite>;
}

/** 取某帧的锚定上下文（编辑器主画布用）。无锚定定义返回 undefined。 */
export function editorClampContextFor(
  character: Character,
  frame: number,
  clips: AnimationClip[] | undefined,
  opts: ClampSessionOpts,
): ClampContext | undefined {
  const anchors = character.clampAnchors;
  if (!anchors || anchors.length === 0) return undefined;
  // 纪元 = 角色对象身份：store 的不可变更新在任何编辑后都换对象，
  // 对象一换即整表失效（状态与片段快照全部重建），不会读到旧姿态的冻结。
  let entry = sessions.get(character.id);
  if (!entry || entry.epochObj !== character) {
    entry = { epochObj: character, state: new Map(), steppedTo: -1, clipStarts: new Map(), lastReportFrame: -1 };
    sessions.set(character.id, entry);
  }
  const stepOnce = (f: number) => {
    const plain = computeWorldTransforms(character, f, opts.canvasWidth, opts.canvasHeight, opts.frameRate);
    stepClampState(character, plain, entry!.state, opts.sprites);
    entry!.steppedTo = f;
  };
  if (entry.steppedTo !== frame) {
    if (entry.steppedTo === frame - 1) {
      stepOnce(frame);
    } else {
      // 跳帧：定位片段起点 → 取/建快照 → 从片段内首帧演到目标帧
      const sorted = [...(clips ?? [])].sort((a, b) => a.startFrame - b.startFrame);
      const clip = sorted.find((c) => frame >= c.startFrame && frame <= c.endFrame);
      const start = clip ? clip.startFrame : 0;
      let snap = entry.clipStarts.get(start);
      if (!snap) {
        // 从最近的更早快照（或零点）顺演到 start-1
        let bestStart = 0;
        let best: ClampStateMap | null = null;
        let bestTo = -1;
        for (const [s0, snap0] of entry.clipStarts) {
          if (s0 <= start && s0 > bestStart) { bestStart = s0; best = snap0; bestTo = s0 - 1; }
        }
        entry.state = best ? cloneState(best) : new Map();
        entry.steppedTo = bestTo;
        while (entry.steppedTo < start - 1) stepOnce(entry.steppedTo + 1);
        snap = cloneState(entry.state);
        entry.clipStarts.set(start, snap);
      } else {
        entry.state = cloneState(snap);
        entry.steppedTo = start - 1;
      }
      while (entry.steppedTo < frame) stepOnce(entry.steppedTo + 1);
    }
  }
  entry.lastReportFrame = frame;
  return { frozen: entry.state, sprites: opts.sprites };
}

/** 覆盖层 gizmo 读最近一次步进的冻结状态（只读展示用） */
export function peekClampFrozen(characterId: string): ClampStateMap | null {
  return sessions.get(characterId)?.state ?? null;
}

/** 测试/导出用：从零顺序步进到目标帧的独立状态（不碰编辑器会话） */
export function steppedClampState(
  character: Character,
  toFrame: number,
  fromFrame: number,
  opts: ClampSessionOpts,
  initial?: ClampStateMap,
): ClampStateMap {
  const state: ClampStateMap = initial ? cloneState(initial) : new Map();
  for (let f = fromFrame; f <= toFrame; f++) {
    const plain = computeWorldTransforms(character, f, opts.canvasWidth, opts.canvasHeight, opts.frameRate);
    stepClampState(character, plain, state, opts.sprites);
  }
  return state;
}

export type { ClampFrozen };

/** 状态深拷贝（convert 快照用） */
export function cloneClampState(state: ClampStateMap): ClampStateMap {
  return cloneState(state);
}
