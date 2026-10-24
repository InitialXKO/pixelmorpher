// ============================================================
// 模式库管理：内置模板（pattern-templates）+ 用户自存模板。
// 用户模板与内置同格（PatternTemplate），存 localStorage。
// 存模板时参数定义优先沿用来源模板；无来源时按 graph.params
// 当前值自动生成（范围取 0.25×~2.5× 的经验区间）。
// ============================================================

import type { SurfaceGraph } from '../unified-types';
import {
  PATTERN_TEMPLATES, patternTemplateByName,
  type PatternParamDef, type PatternTemplate,
} from './pattern-templates';

const KEY = 'pm-user-patterns-v1';

export interface UserPatternTemplate extends PatternTemplate {
  user: true;
}

function isUserPattern(t: PatternTemplate): t is UserPatternTemplate {
  return (t as UserPatternTemplate).user === true;
}

export function loadUserPatterns(): UserPatternTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as UserPatternTemplate[];
    return Array.isArray(arr) ? arr.filter((t) => t && t.id && t.graph) : [];
  } catch {
    return [];
  }
}

function persist(list: UserPatternTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存储不可用时静默（库管理降级为会话内） */
  }
}

/** 由 graph.params 自动生成参数定义（无来源模板时） */
export function deriveParamDefs(graph: SurfaceGraph): PatternParamDef[] {
  return Object.entries(graph.params ?? {}).map(([key, v]) => {
    const av = Math.abs(v);
    return {
      key,
      label: key,
      min: 0,
      max: av > 0 ? Math.round(av * 2.5 * 100) / 100 : 1,
      step: av >= 2 ? 0.5 : 0.05,
      def: v,
    };
  });
}

export function saveUserPattern(
  name: string,
  graph: SurfaceGraph,
  paramDefs?: PatternParamDef[],
  outputs?: Record<string, string>,
): UserPatternTemplate {
  const g = JSON.parse(JSON.stringify(graph)) as SurfaceGraph;
  const t: UserPatternTemplate = {
    user: true,
    id: `user-${Date.now().toString(36)}`,
    name,
    cluster: '我的',
    params: paramDefs && paramDefs.length > 0 ? paramDefs : deriveParamDefs(g),
    graph: g,
    ...(outputs && Object.keys(outputs).length > 0 ? { outputs } : {}),
  };
  const list = loadUserPatterns();
  list.push(t);
  persist(list);
  return t;
}

export function deleteUserPattern(id: string): void {
  persist(loadUserPatterns().filter((t) => t.id !== id));
}

export function renameUserPattern(id: string, name: string): void {
  const list = loadUserPatterns();
  const t = list.find((x) => x.id === id);
  if (t) {
    t.name = name;
    persist(list);
  }
}

/** 全库按名查（内置优先，其次用户） */
export function findPatternTemplate(name: string | undefined): PatternTemplate | undefined {
  if (!name) return undefined;
  return patternTemplateByName(name) ?? loadUserPatterns().find((t) => t.name === name);
}

export function allPatternTemplates(): PatternTemplate[] {
  return [...PATTERN_TEMPLATES, ...loadUserPatterns()];
}

export { isUserPattern };
