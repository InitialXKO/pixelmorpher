'use client';

// ============================================================
// ProcPreview — 程序化预览
// 把当前角色经转换器打包成运行时包，用与导出完全相同的运行时模板
// 在 iframe 里跑：预览所见即导出所得。虚拟输入 = 模板内置控制
// （A/D 移动、W 跳、方向/服装/表演按钮、自动行走）。
// 转换 warnings 在下方逐条列出（不静默）。
// 显示方式四种：面板内嵌（默认）/ 与主渲染同框（iframe 经 portal
// 覆盖主画布容器）/ 全屏（预览容器 requestFullscreen）/ 新标签页
// （同一份 html 以 blob URL 打开）。
// 重建依赖：projectData 与 projectExtras 的每个字段都单独订阅进
// useMemo 依赖——改全局修改器、画布特效轨等不必重开面板即重建。
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

  // —— 重建依赖：逐个订阅，任一变化都触发重建（不再走 getState 快照漏订） ——
  const projectSprites = useProjectStore((s) => s.sprites);
  const animationClips = useProjectStore((s) => s.animationClips);
  const frameRate = useProjectStore((s) => s.frameRate);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const proceduralAnimations = useProjectStore((s) => s.proceduralAnimations);
  const globalModifiers = useProjectStore((s) => s.globalModifiers);
  const globalBlueprint = useProjectStore((s) => s.globalBlueprint);
  const canvasModifierTracks = useProjectStore((s) => s.canvasModifierTracks);
  const effectTracks = useProjectStore((s) => s.effectTracks);
  const motionBlurStrokes = useProjectStore((s) => s.motionBlurStrokes);
  const effectStrokes = useProjectStore((s) => s.effectStrokes);
  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);
  const palettes = useProjectStore((s) => s.palettes);
  const activePaletteId = useProjectStore((s) => s.activePaletteId);
  const perspectiveForeshorten = useEditorStore((s) => s.perspectiveForeshorten);

  const built = useMemo(() => {
    if (!character) return null;
    // 精灵引用可能指向工程级全局表，必须随角色一起传给转换器（与主画布同口径）
    const pkg = convertCharacterToRuntimePackage(character, projectSprites, {
      frameRate,
      totalFrames,
      clips: animationClips.filter((c) => c.puppetCharacterId === character.id),
      patternLibrary: allPatternTemplates(),
      libraryEntries: allLibraryEntries(),
      projectData: { proceduralAnimations, globalModifiers, globalBlueprint, canvasModifierTracks, effectTracks, motionBlurStrokes, effectStrokes, canvasWidth, canvasHeight, palettes, activePaletteId },
      projectExtras: { perspectiveForeshorten },
    });
    // 预览是观看宿主：改用墙钟模式按真实时间播。包缺省的 frame 模式
    // 每 rAF tick 恰走一包帧（为录制/回放的确定性而设）——12fps 工程
    // 在 60Hz 屏上就是 5 倍速、120Hz 屏 10 倍速。只改预览自己的包
    // 副本，导出包的缺省不受影响。
    pkg.simMode = 'wall';
    const html = buildRuntimeHtml(pkg);
    return { pkg, html, key: hashString(html) };
  }, [character, projectSprites, animationClips, frameRate, totalFrames, proceduralAnimations, globalModifiers, globalBlueprint, canvasModifierTracks, effectTracks, motionBlurStrokes, effectStrokes, canvasWidth, canvasHeight, perspectiveForeshorten]);

  // —— 显示方式 ——
  const dock = useEditorStore((s) => s.procPreviewDock);
  const setDock = useEditorStore((s) => s.setProcPreviewDock);
  const frameBoxRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mainHost, setMainHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // 同框宿主 = 主画布根容器（PixelCanvas 根元素 id）；切到 main 时查找，
  // 首帧未挂载好则下一帧再试一次。
  useEffect(() => {
    if (dock !== 'main') { setMainHost(null); return; }
    const el = document.getElementById('pixel-canvas-root');
    if (el) { setMainHost(el); return; }
    const raf = requestAnimationFrame(() => setMainHost(document.getElementById('pixel-canvas-root')));
    return () => cancelAnimationFrame(raf);
  }, [dock]);

  if (!character) return <p className="text-[10px] text-gray-500">先在左侧选择一个角色。</p>;
  if (!built) return null;
  const { pkg, html, key } = built;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    const box = frameBoxRef.current;
    if (box) void box.requestFullscreen().catch(() => { /* 浏览器拒绝时保持现状 */ });
  };
  const openInNewTab = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const modeBtn = (active: boolean) =>
    `px-1.5 py-0.5 rounded border text-[10px] ${active ? 'border-cyan-500/70 text-cyan-300 bg-cyan-950/40' : 'border-[#2a2a4a] text-gray-400 hover:text-gray-200'}`;

  const frame = (
    <div ref={frameBoxRef} className={isFullscreen ? 'w-full h-full bg-[#12122a]' : 'w-full'}>
      <iframe
        key={key}
        title="程序化预览"
        srcDoc={html}
        sandbox="allow-scripts"
        className="w-full rounded border border-[#1e1e3a] bg-[#12122a] block"
        style={{ height: isFullscreen ? '100%' : dock === 'main' ? '100%' : 300 }}
      />
    </div>
  );

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] text-gray-600 leading-relaxed">
        与导出共用同一运行时本体。点进画面后：A/D 移动、W 跳、数字键锁方向；
        右上可切服装/触发表演/自动行走。
      </p>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={modeBtn(dock === 'panel')} onClick={() => setDock('panel')}>面板</button>
        <button type="button" className={modeBtn(dock === 'main')} onClick={() => setDock('main')}>与主渲染同框</button>
        <button type="button" className={modeBtn(isFullscreen)} onClick={toggleFullscreen}>全屏</button>
        <button type="button" className={modeBtn(false)} onClick={openInNewTab}>新标签页打开</button>
      </div>
      {dock === 'main' ? (
        <>
          {mainHost
            ? createPortal(<div className="absolute inset-0 z-30">{frame}</div>, mainHost)
            : <p className="text-[10px] text-gray-500">主画布未就绪，稍候切回面板再试。</p>}
          <p className="text-[10px] text-gray-500">预览正在主画布框内显示（覆盖主渲染）。</p>
        </>
      ) : frame}
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
