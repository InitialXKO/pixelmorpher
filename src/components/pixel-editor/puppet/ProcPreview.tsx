'use client';

// ============================================================
// ProcPreview — 程序化预览
// 把当前角色经转换器打包成运行时包，用与导出完全相同的运行时模板
// 在 iframe 里跑：预览所见即导出所得。虚拟输入 = 模板内置控制
// （A/D 移动、W 跳、方向/服装/表演按钮、自动行走）。
// 转换 warnings 在下方逐条列出（不静默）。
// ============================================================

import React, { useMemo } from 'react';
import { useEditorStore, useProjectStore } from '@/lib/store';
import type { Character } from '@/lib/unified-types';
import { convertCharacterToRuntimePackage } from '@/lib/proc-runtime/convert';
import { buildRuntimeHtml } from '@/lib/proc-runtime/runtime-template';
import { allPatternTemplates } from '@/lib/proc-runtime/pattern-library';
import { allLibraryEntries } from '@/lib/library-entries';

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

export default function ProcPreview({ unifiedCharacters }: { unifiedCharacters: Record<string, Character> }) {
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  const character = activePuppetSkeletonId ? (unifiedCharacters[activePuppetSkeletonId] ?? null) : null;

  const projectSprites = useProjectStore((s) => s.sprites);
  const animationClips = useProjectStore((s) => s.animationClips);
  const built = useMemo(() => {
    if (!character) return null;
    // 精灵引用可能指向工程级全局表，必须随角色一起传给转换器（与主画布同口径）
    const pkg = convertCharacterToRuntimePackage(character, projectSprites, {
      frameRate: useProjectStore.getState().frameRate,
      totalFrames: useProjectStore.getState().totalFrames,
      clips: animationClips.filter((c) => c.puppetCharacterId === character.id),
      patternLibrary: allPatternTemplates(),
      libraryEntries: allLibraryEntries(),
      projectData: { proceduralAnimations: useProjectStore.getState().proceduralAnimations, globalModifiers: useProjectStore.getState().globalModifiers, globalBlueprint: useProjectStore.getState().globalBlueprint },
      projectExtras: {
        canvasModifierTrackCount: useProjectStore.getState().canvasModifierTracks?.length ?? 0,
        effectTrackCount: useProjectStore.getState().effectTracks?.length ?? 0,
        strokeCount: (useProjectStore.getState().motionBlurStrokes?.length ?? 0) + (useProjectStore.getState().effectStrokes?.length ?? 0),
        perspectiveForeshorten: useEditorStore.getState().perspectiveForeshorten,
      },
    });
    const html = buildRuntimeHtml(pkg);
    return { pkg, html, key: hashString(html) };
  }, [character, projectSprites, animationClips]);

  if (!character) return <p className="text-[10px] text-gray-500">先在左侧选择一个角色。</p>;
  if (!built) return null;
  const { pkg, html, key } = built;

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] text-gray-600 leading-relaxed">
        与导出共用同一运行时本体。点进画面后：A/D 移动、W 跳、数字键锁方向；
        右上可切服装/触发表演/自动行走。
      </p>
      <iframe
        key={key}
        title="程序化预览"
        srcDoc={html}
        sandbox="allow-scripts"
        className="w-full rounded border border-[#1e1e3a] bg-[#12122a]"
        style={{ height: 300 }}
      />
      <div className="text-[10px] text-gray-500">
        部件 {pkg.parts.length} · 服装 {Object.keys(pkg.costumes).length} · 表演 {pkg.performances.length}
      </div>
      {pkg.warnings.length > 0 && (
        <div className="rounded border border-amber-900/50 bg-amber-950/20 p-1.5 space-y-0.5">
          {pkg.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-300/90 leading-snug">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
