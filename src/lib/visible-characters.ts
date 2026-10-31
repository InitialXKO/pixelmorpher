// ============================================================
// 角色可见集：「显示全部角色」开关的唯一过滤口径。
// 开关状态 showAllCharacters 在 puppet-session-store；「选中
// 角色」的解析走候选链：先 editor-store 的 activePuppetSkeletonId
// （资产面板当前角色，日常编辑流点选写入），后 puppet-session 的
// performCharacterId（操控角色，仅 enterPerform 写）——操控中
// PerformPanel 保持两者同步、互为回退。普通编辑流里
// performCharacterId 常为 null 或旧值，只认它会让开关在编辑流
// 点了没反应（PR #76 接线后的口径缺口）。
// 主渲染、拾取编号图与其读侧、骨骼覆盖层、洋葱皮共用同一份
// 语义，避免各处内联过滤口径漂移（历史上洋葱皮有一份内联
// 复制、主渲染则根本没接线，开关点了没反应）。
// ============================================================

/**
 * 过滤所需的会话字段：showAllCharacters / performCharacterId 取自
 * puppet-session-store 状态，activeCharacterId 取自 editor-store
 * 的 activePuppetSkeletonId，由调用点拼齐后传入。
 */
export interface CharacterVisibilitySession {
  showAllCharacters: boolean;
  performCharacterId: string | null;
  /** 资产面板当前角色；选中解析的第一候选。 */
  activeCharacterId?: string | null;
}

/**
 * 角色显示过滤：互斥模式下只返回选中角色。
 * - showAllCharacters=true → 全部
 * - 否则按候选链解析选中：activeCharacterId（资产面板当前角色）
 *   优先、performCharacterId（操控角色）次之，第一个能在角色表
 *   里找到的胜出 → 仅该角色
 * - 候选都无值 / 都不在表中 → 全部（无选中时的回退，避免画布空白）
 */
export function filterVisibleCharacters<T extends { id: string }>(
  characters: T[],
  session: CharacterVisibilitySession,
): T[] {
  if (session.showAllCharacters) {
    return characters;
  }
  for (const candidateId of [session.activeCharacterId, session.performCharacterId]) {
    if (!candidateId) continue;
    const selected = characters.filter((c) => c.id === candidateId);
    if (selected.length > 0) return selected;
  }
  return characters;
}

// visibleCharactersRecord 的单槽记忆：拾取戳记按对象同一性校验
// （pick-buffer 的 sameStamp 用 === 比 characters），绘制侧
// （PixelCanvas 的 beginPickFrame）与读侧（use-canvas-state 的
// readPick 期望戳记）必须拿到同一个 Record 对象，戳记才对得上；
// 输入（角色表同一性 + 会话三字段）不变时复用上次结果。
let recordMemo: {
  table: Record<string, { id: string }>;
  showAllCharacters: boolean;
  performCharacterId: string | null;
  activeCharacterId: string | null;
  result: Record<string, { id: string }>;
} | null = null;

/**
 * 角色表的可见集（Record 形态，与 renderUnified / beginPickFrame
 * 现行消费形态一致）：
 * - 过滤结果为全部时原表直传（保对象同一性，未过滤路径与旧行为逐字一致）；
 * - 真过滤时按 filterVisibleCharacters 的结果重建 Record，并按输入记忆，
 *   同一输入下多次调用返回同一对象。
 */
export function visibleCharactersRecord<T extends { id: string }>(
  characters: Record<string, T> | undefined,
  session: CharacterVisibilitySession,
): Record<string, T> | undefined {
  if (!characters) return characters;
  const all = Object.values(characters);
  const visible = filterVisibleCharacters(all, session);
  if (visible.length === all.length) {
    return characters;
  }
  const activeCharacterId = session.activeCharacterId ?? null;
  if (
    recordMemo &&
    recordMemo.table === characters &&
    recordMemo.showAllCharacters === session.showAllCharacters &&
    recordMemo.performCharacterId === session.performCharacterId &&
    recordMemo.activeCharacterId === activeCharacterId
  ) {
    return recordMemo.result as Record<string, T>;
  }
  const result: Record<string, T> = {};
  for (const c of visible) result[c.id] = c;
  recordMemo = {
    table: characters,
    showAllCharacters: session.showAllCharacters,
    performCharacterId: session.performCharacterId,
    activeCharacterId,
    result,
  };
  return result;
}
