// ============================================================
// 动态模式展开（DESIGN-DAG-LIBRARY §四）：父模式递归解析为
// 扁平 DynamicPatternParams。按实例去重、段冲突点名拒绝、
// 按条目 id 判环（跨版本同 id 亦算环）。配合边折叠：
// followParams 先行裁决（leader 胜、其键免冲突检查）→ 段合并
// → phase 对齐 → modulate（v1 只认 形变量→发射率 通道，折为
// linkToDeform；其余组合点名拒绝，不静默丢弃）。
// 父→子覆盖受参数口约束（叶子看声明 expose，父模式看展开
// 键集）；挂载点覆盖不受口限（链末作者的最终裁决）。
// ============================================================

import {
  defaultDynamicParams, normalizeDynamicParams, type DynamicPatternParams,
} from './dynamic-patterns';
import {
  defOf, type DynParamKey, type LibraryIndex,
} from './library-entries';

const MAX_DEPTH = 16;

interface SegmentsResult {
  segments: Partial<DynamicPatternParams>;
  keySet: Set<string>;
}

function expandSegments(
  index: LibraryIndex,
  id: string,
  version: number,
  stack: string[],
  errors: string[],
): SegmentsResult | undefined {
  if (stack.includes(id)) {
    errors.push(`模式库：引用「${id}」成环（展开栈 ${[...stack, id].join(' → ')}）`);
    return undefined;
  }
  if (stack.length >= MAX_DEPTH) {
    errors.push(`模式库：引用「${id}」嵌套过深（>${MAX_DEPTH} 层）`);
    return undefined;
  }
  const found = defOf(index, id, version);
  if (!found) {
    errors.push(`模式库：未解析的引用「${id}@${version}」`);
    return undefined;
  }
  const def = found.def;
  if (!('kind' in def)) {
    errors.push(`模式库：「${id}@${version}」是表面条目，不能当动态模式展开`);
    return undefined;
  }
  if (def.kind === 'chain') {
    errors.push(`模式库：「${id}@${version}」是链条目，不能当动态模式展开`);
    return undefined;
  }
  if (def.kind === 'leaf') {
    return { segments: { ...def.segments }, keySet: new Set(Object.keys(def.segments)) };
  }
  // 父模式：子引用按实例去重（同 id@版本 + 同覆盖只算一份）
  const canonOf = new Map<number, number>();
  const canonKey = new Map<string, number>();
  def.children.forEach((c, i) => {
    const k = `${c.entry}@${c.version}|${JSON.stringify(c.overrides ?? {})}`;
    const prev = canonKey.get(k);
    if (prev === undefined) { canonKey.set(k, i); canonOf.set(i, i); }
    else canonOf.set(i, prev);
  });
  const contributions = new Map<number, SegmentsResult>();
  for (const [i, c] of def.children.entries()) {
    if (canonOf.get(i) !== i) continue;
    const sub = expandSegments(index, c.entry, c.version, [...stack, id], errors);
    if (!sub) return undefined;
    // 覆盖受参数口约束：叶子看声明、父模式看展开键集
    const childDef = defOf(index, c.entry, c.version)?.def;
    const expose = childDef && 'kind' in childDef && childDef.kind === 'leaf'
      ? new Set<string>(childDef.expose)
      : sub.keySet;
    const segs = { ...sub.segments };
    for (const [k, v] of Object.entries(c.overrides ?? {})) {
      if (!expose.has(k)) {
        errors.push(`模式库：父模式「${id}」覆盖子模式「${c.entry}」的参数「${k}」不在其参数口内`);
        return undefined;
      }
      (segs as Record<string, unknown>)[k] = v;
    }
    contributions.set(i, { segments: segs, keySet: new Set(Object.keys(segs)) });
  }
  const contrib = (origIdx: number): SegmentsResult | undefined =>
    contributions.get(canonOf.get(origIdx) ?? origIdx);
  // followParams 裁决集：被跟随的键由 leader 定夺，免冲突检查
  const adjudicated = new Set<string>();
  for (const e of def.coordination) {
    if (e.type === 'followParams') for (const k of e.keys) adjudicated.add(k);
  }
  // 段合并 + 冲突检查
  const merged: Partial<DynamicPatternParams> = {};
  const writers = new Map<string, number>();
  for (const [i] of def.children.entries()) {
    if (canonOf.get(i) !== i) continue;
    const c = contrib(i)!;
    for (const [k, v] of Object.entries(c.segments)) {
      const prev = writers.get(k);
      if (prev !== undefined && prev !== i && !adjudicated.has(k)) {
        errors.push(
          `模式库：父模式「${id}」段冲突——参数「${k}」被子模式 #${prev} 与 #${i} 同时写下，须用覆盖或配合边显式裁决`);
        return undefined;
      }
      writers.set(k, i);
      (merged as Record<string, unknown>)[k] = v;
    }
  }
  // 配合边折叠
  for (const e of def.coordination) {
    if (e.type === 'followParams') {
      const leader = contrib(e.leader);
      if (!leader) continue;
      for (const k of e.keys) {
        if (k in leader.segments) (merged as Record<string, unknown>)[k] = leader.segments[k];
      }
    } else if (e.type === 'phase') {
      const base = contrib(e.baseChild);
      if (!base) continue;
      // 基准相位 = 基准子模式自己的相位（形变相位优先，其次发光相位）
      const basePhase = typeof base.segments.deformPhase === 'number'
        ? base.segments.deformPhase
        : typeof base.segments.glowPhase === 'number' ? base.segments.glowPhase : 0;
      for (const [idxStr, off] of Object.entries(e.offsets)) {
        const target = contrib(Number(idxStr));
        if (!target) continue;
        for (const pk of ['deformPhase', 'glowPhase'] as DynParamKey[]) {
          if (!(pk in target.segments)) continue;
          const wrapped = (((basePhase + off) % 1) + 1) % 1;
          (merged as Record<string, unknown>)[pk] = wrapped;
        }
      }
    } else if (e.type === 'modulate') {
      if (e.from === 'deformAmount' && e.toKey === 'rate') {
        (merged as Record<string, unknown>)['linkToDeform'] = e.depth;
      } else {
        errors.push(
          `模式库：父模式「${id}」的调制边（${e.from} → ${e.toKey}）在 v1 无对应通道，未折叠`);
        return undefined;
      }
    }
  }
  return { segments: merged, keySet: new Set(Object.keys(merged)) };
}

/** 展开一个动态条目为扁平参数（挂载覆盖最后应用、不受口限） */
export function expandDynamicEntry(
  index: LibraryIndex,
  id: string,
  version: number,
  mountOverrides?: Partial<DynamicPatternParams>,
): { params?: DynamicPatternParams; errors: string[] } {
  const errors: string[] = [];
  const r = expandSegments(index, id, version, [], errors);
  if (!r || errors.length > 0) return { errors };
  const params = normalizeDynamicParams({
    ...defaultDynamicParams(),
    ...r.segments,
    ...(mountOverrides ?? {}),
  });
  return { params, errors };
}
