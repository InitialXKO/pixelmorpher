// ============================================================
// 片段结构迁移（导入时一次性执行，幂等）
//
// 背景：动画统一到节点轨道（甲案）——姿态的唯一数据源是 node.tracks；
// AnimationClip 不再持有 nodeKeyframes 平表，改为「归属必填 + 自带时间窗」
// 的段描述。本迁移把旧文件收敛到新形状：
//
// 1) 归属补绑：puppetCharacterId 缺失/悬空时——单角色工程绑该角色；
//    多角色工程绑第一个角色（警告列名，可在片段面板改绑）；无角色绑 ''
//    并警告。已绑且角色存在的片段不动。
// 2) 时间窗：startFrame/endFrame/loop 缺失时由旧 totalFrames（无则工程
//    总帧数）换算成 [0, totalFrames-1]；旧 frameRate/totalFrames 字段删除
//    （片段不自带帧率，时长换算只在导出时按工程帧率做一次）。
// 3) 关键帧迁轨：旧 nodeKeyframes 里只有三类数据是活的——每帧修改器组
//    （按参数在帧间插值）、转面 yaw/pitch、图层 zIndex。它们迁入所属节点
//    的轨道附件轨：modifierKeys / faceTurnKeys / zIndex。姿态值（角度/位移
//    等）不迁：渲染从未读过片段里的姿态，姿态一直在 node.tracks 里。
//    一次只迁「主片段」：旧求值的回退口径本就一次只读一个片段（拖拽/
//    面板读激活片段，表演面板读归属片段），其余片段的同类数据若一并迁入
//    会拼出从未被求值过的组合——不迁，逐片段计数进警告。
//    主片段口径：激活片段 → 第一个有归属的片段 → 第一个片段。
// 4) 清除 puppetNodeKeyframes 幻影字段（旧录制误写的字段名，无任何读者）。
//
// 幂等：已是新形状的片段（有 startFrame 且无 nodeKeyframes）跳过；
// 轨道点按帧 upsert，重跑结果不变。
// ============================================================

import type { AnimationClip } from './types';
import type { Character, KeyframeTrack, ModifierInstance, NodeTracks } from './unified-types';

export interface ClipMigrationReport {
  /** 补绑了归属的片段（原归属缺失或悬空） */
  boundClips: { clipName: string; characterId: string }[];
  /** 补了时间窗的片段数 */
  windowsFixed: number;
  /** 成功迁入轨道的点数（按轨计） */
  migratedPoints: { modifierKeys: number; faceTurnKeys: number; zIndexKeys: number };
  /** 未迁的数据（非主片段的活数据 + 指向不存在节点的点），逐片段计数 */
  dropped: { clipName: string; modifiers: number; faceTurn: number; zIndex: number }[];
  /** 清除的幻影字段数 */
  phantomFieldsRemoved: number;
}

type RawClip = Record<string, any>;

function upsertPoint<T>(track: KeyframeTrack<T> | undefined, frame: number, value: T): KeyframeTrack<T> {
  const t: KeyframeTrack<T> = track ?? { keyframes: [], interpolation: 'linear' };
  const idx = t.keyframes.findIndex((k) => k.frame === frame);
  if (idx >= 0) {
    const keyframes = t.keyframes.slice();
    keyframes[idx] = { ...keyframes[idx], value };
    return { ...t, keyframes };
  }
  return { ...t, keyframes: [...t.keyframes, { frame, value }].sort((a, b) => a.frame - b.frame) };
}

function kfLiveCounts(kfs: RawClip[]): { modifiers: number; faceTurn: number; zIndex: number } {
  let modifiers = 0, faceTurn = 0, zIndex = 0;
  for (const kf of kfs) {
    if (Array.isArray(kf.modifiers) && kf.modifiers.length > 0) modifiers++;
    if (kf.faceTurn) faceTurn++;
    if (kf.zIndex !== undefined) zIndex++;
  }
  return { modifiers, faceTurn, zIndex };
}

export function migrateClipStructure(
  rawClips: RawClip[],
  characters: Record<string, Character>,
  opts: { projectTotalFrames: number; activeClipId?: string | null },
): { clips: AnimationClip[]; characters: Record<string, Character>; report: ClipMigrationReport } {
  const report: ClipMigrationReport = {
    boundClips: [],
    windowsFixed: 0,
    migratedPoints: { modifierKeys: 0, faceTurnKeys: 0, zIndexKeys: 0 },
    dropped: [],
    phantomFieldsRemoved: 0,
  };
  const charIds = Object.keys(characters);
  const firstCharId = charIds[0] ?? '';

  // ---- 主片段解析（按迁移前的原始归属，与旧求值回退口径一致）----
  const primary =
    rawClips.find((c) => c.id === opts.activeClipId) ??
    rawClips.find((c) => c.puppetCharacterId && characters[c.puppetCharacterId as string]) ??
    rawClips[0];

  // ---- 关键帧迁轨（仅主片段；写进角色节点的轨道）----
  let nextCharacters = characters;
  if (primary && Array.isArray(primary.nodeKeyframes) && primary.nodeKeyframes.length > 0) {
    const charId: string = primary.puppetCharacterId && characters[primary.puppetCharacterId]
      ? primary.puppetCharacterId
      : firstCharId;
    const character = charId ? characters[charId] : undefined;
    const lost = { modifiers: 0, faceTurn: 0, zIndex: 0 };
    if (character) {
      const nodes: Record<string, Character['nodes'][string]> = { ...character.nodes };
      let nodesChanged = false;
      for (const kf of primary.nodeKeyframes as RawClip[]) {
        const node = nodes[kf.nodeId as string];
        if (!node) {
          if (Array.isArray(kf.modifiers) && kf.modifiers.length > 0) lost.modifiers++;
          if (kf.faceTurn) lost.faceTurn++;
          if (kf.zIndex !== undefined) lost.zIndex++;
          continue;
        }
        let tracks: NodeTracks = node.tracks ?? {};
        let changed = false;
        if (Array.isArray(kf.modifiers) && kf.modifiers.length > 0) {
          tracks = {
            ...tracks,
            modifierKeys: upsertPoint<ModifierInstance[]>(
              tracks.modifierKeys, kf.frame, structuredClone(kf.modifiers) as ModifierInstance[],
            ),
          };
          report.migratedPoints.modifierKeys++;
          changed = true;
        }
        if (kf.faceTurn) {
          tracks = {
            ...tracks,
            faceTurnKeys: upsertPoint<{ yaw: number; pitch: number }>(
              tracks.faceTurnKeys, kf.frame, { yaw: kf.faceTurn.yaw ?? 0, pitch: kf.faceTurn.pitch ?? 0 },
            ),
          };
          report.migratedPoints.faceTurnKeys++;
          changed = true;
        }
        if (kf.zIndex !== undefined) {
          tracks = { ...tracks, zIndex: upsertPoint<number>(tracks.zIndex, kf.frame, kf.zIndex) };
          report.migratedPoints.zIndexKeys++;
          changed = true;
        }
        if (changed) {
          nodes[node.id] = { ...node, tracks };
          nodesChanged = true;
        }
      }
      if (nodesChanged) {
        nextCharacters = { ...characters, [charId]: { ...character, nodes } };
      }
    }
    if (lost.modifiers + lost.faceTurn + lost.zIndex > 0) {
      report.dropped.push({ clipName: String(primary.name ?? primary.id), ...lost });
    }
  }

  // ---- 逐片段收敛形状 ----
  const clips: AnimationClip[] = rawClips.map((raw) => {
    const clip: RawClip = { ...raw };

    if ('puppetNodeKeyframes' in clip) {
      delete clip.puppetNodeKeyframes;
      report.phantomFieldsRemoved++;
    }

    // 归属补绑
    const ownerOk = typeof clip.puppetCharacterId === 'string'
      && clip.puppetCharacterId !== ''
      && !!characters[clip.puppetCharacterId];
    if (!ownerOk) {
      const bound = charIds.length === 1 ? charIds[0] : firstCharId;
      if (clip.puppetCharacterId !== bound) {
        report.boundClips.push({ clipName: String(clip.name ?? clip.id), characterId: bound });
      }
      clip.puppetCharacterId = bound;
    }

    // 时间窗
    if (typeof clip.startFrame !== 'number' || typeof clip.endFrame !== 'number') {
      const total = typeof clip.totalFrames === 'number' && clip.totalFrames > 0
        ? clip.totalFrames
        : Math.max(1, opts.projectTotalFrames || 24);
      clip.startFrame = 0;
      clip.endFrame = total - 1;
      if (typeof clip.loop !== 'boolean') clip.loop = false;
      report.windowsFixed++;
    }
    if (typeof clip.loop !== 'boolean') clip.loop = false;
    delete clip.frameRate;
    delete clip.totalFrames;

    // 非主片段的活数据不迁（计数警告）；主片段的已在上面迁完
    if (Array.isArray(clip.nodeKeyframes)) {
      if (raw !== primary) {
        const counts = kfLiveCounts(clip.nodeKeyframes);
        if (counts.modifiers + counts.faceTurn + counts.zIndex > 0) {
          report.dropped.push({ clipName: String(clip.name ?? clip.id), ...counts });
        }
      }
      delete clip.nodeKeyframes;
    }

    return clip as AnimationClip;
  });

  return { clips, characters: nextCharacters, report };
}
