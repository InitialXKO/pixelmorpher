// ============================================================
// Sync old Puppet* data to new unifiedCharacters store
// One-time conversion (not per-frame), replaces LiveAdapter in render path
// ============================================================

import type { ProjectStore } from './types';
import { LiveAdapter } from '../migration-adapter';

/**
 * Convert all puppetSkeletons/puppetCharacters to new Character objects
 * and store in unifiedCharacters. Call on app load and when old data changes.
 */
export function syncUnifiedCharacters(
  set: (partial: Partial<ProjectStore>) => void,
  get: () => ProjectStore,
): void {
  const state = get();
  const puppetSkeletons = (state as any).puppetSkeletons ?? [];
  const puppetCharacters = (state as any).puppetCharacters ?? [];
  const parts = (state as any).parts ?? [];
  const animationClips = (state as any).animationClips ?? [];

  if (puppetSkeletons.length === 0) return;

  const adapter = new LiveAdapter();
  const unifiedCharacters: Record<string, import('../unified-types').Character> = {};

  for (const character of puppetCharacters) {
    const skeleton = puppetSkeletons.find((s: any) => s.id === character.puppetSkeletonId);
    if (!skeleton) continue;

    const clip = animationClips.find((c: any) => c.puppetCharacterId === character.id);
    const nodeKeyframes = clip?.puppetNodeKeyframes ?? [];

    try {
      const unified = adapter.getCharacter(
        skeleton,
        [character],
        parts,
        nodeKeyframes,
        character.costumeSets ?? [],
      );
      // 用旧 character.id 和 skeleton.id 双索引，方便 UI 查找
      unifiedCharacters[character.id] = unified;
      unifiedCharacters[skeleton.id] = unified;
    } catch {
      // Skip characters that fail conversion
    }
  }

  set({ unifiedCharacters } as Partial<ProjectStore>);
}
