// ============================================================
// 刀光共享定义（用户裁决的第四种模型）：定义一处存（角色级
// character.slashDefs）、片段与表演两处活引用（slashDefId）。
//
// - 活引用：解析时实时解引用定义的当前规格，改定义一处、全部
//   引用处同时生效——编辑器预览（片段窗）与 convert 进包（片段
//   段表演 + 作者表演）同源读定义，不经任何逐 owner 同步落盘，
//   定义内容绝不复制固化进各 owner。
// - 表演侧与表演图合成：绑定表演的图面板节点是「引用形态」
//   （只带 __defId），解引用在 blueprint/slash-sync 的
//   resolvePerfSlash 里先于接线覆盖发生；接线覆盖由 convert
//   进包时以表演本地 t=0 单点求值消费、固化进包（见 slash-sync）。
// - 片段侧无图：绑定直接存片段字段 slashDefId，两条消费路
//   （unified-render 预览、convert 烘焙）都经 resolveClipSlash
//   解引用，保证同源。
// - 解绑 = 物化：把定义当前规格复制为 owner 的私有规格（见
//   cloneSlashSpec），解绑瞬间解析结果不变、其后与定义脱钩。
// - 悬空（slashDefId 指向不存在的定义）：解析一律视为无刀光，
//   绝不静默回落私有字段冒充；编辑面删除定义前先查引用计数
//   （countSlashDefRefs）预防悬空，防不住的由 convert 点名。
// ============================================================

import type { AnimationClip } from './types';
import type { Character, SlashDefinition } from './unified-types';
import type { SlashFanSpec } from './slash-fan';

export type { SlashDefinition };

/** 按 id 查共享定义（defs 可缺省 = 该角色无定义表） */
export function findSlashDef(
  defs: readonly SlashDefinition[] | undefined,
  id: string | undefined,
): SlashDefinition | undefined {
  if (!id) return undefined;
  return defs?.find((d) => d.id === id);
}

/** 片段刀光的统一解析（预览/进包共用）：绑定 → 活引用定义规格
 *  （悬空 → undefined）；未绑定 → 私有字段 slashEffect */
export function resolveClipSlash(
  clip: AnimationClip,
  defs: readonly SlashDefinition[] | undefined,
): SlashFanSpec | undefined {
  if (clip.slashDefId) return findSlashDef(defs, clip.slashDefId)?.spec;
  return clip.slashEffect;
}

/** 规格深拷贝（解绑物化用；colors 数组一并复制，免与定义共用引用） */
export function cloneSlashSpec(spec: SlashFanSpec): SlashFanSpec {
  return { ...spec, ...(spec.colors ? { colors: [...spec.colors] } : {}) };
}

/** 定义被引用计数：该角色的表演 + 归属该角色的片段（删除预防口径：
 *  计数 > 0 时编辑面禁止删除，须先逐处解绑物化） */
export function countSlashDefRefs(
  character: Character,
  clips: readonly AnimationClip[] | undefined,
  defId: string,
): number {
  let n = 0;
  for (const p of character.performances ?? []) {
    if (p.slashDefId === defId) n++;
  }
  for (const c of clips ?? []) {
    if (c.puppetCharacterId === character.id && c.slashDefId === defId) n++;
  }
  return n;
}
