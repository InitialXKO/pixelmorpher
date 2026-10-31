'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import PixelCanvas from '@/components/pixel-editor/PixelCanvas';
import CanvasToolRail from '@/components/pixel-editor/toolbar/CanvasToolRail';
import { CanvasViewToggles, CanvasZoomDock } from '@/components/pixel-editor/toolbar/CanvasViewOverlays';
import PuppetPanel from '@/components/pixel-editor/PuppetPanel';
import PuppetAssetPanel from '@/components/pixel-editor/PuppetAssetPanel';
import StrokePanel from '@/components/pixel-editor/StrokePanel';
import DccPipelinePanel from '@/components/pixel-editor/DccPipelinePanel';
import ProceduralPanel from '@/components/pixel-editor/ProceduralPanel';
import ScriptPanel from '@/components/pixel-editor/ScriptPanel';
import PluginPanel from '@/components/pixel-editor/PluginPanel';
import CanvasModifierPanel from '@/components/pixel-editor/CanvasModifierPanel';
import AnimationClipPanel from '@/components/pixel-editor/AnimationClipPanel';
import GlobalModifierPanel from '@/components/pixel-editor/GlobalModifierPanel';
import ProjectHomeScreen from '@/components/pixel-editor/ProjectHomeScreen';
import Timeline from '@/components/pixel-editor/Timeline';
import Toolbar from '@/components/pixel-editor/Toolbar';
import ExportDialog from '@/components/pixel-editor/ExportDialog';
import { useProjectStore } from '@/lib/store';
import { pxToSub } from '@/lib/unified-types';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { useAssetStore } from '@/lib/asset-store';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  saveAutosaveToOPFS,
  checkAutosaveInOPFS,
  loadAutosaveFromOPFS,
  clearAutosaveInOPFS,
  migrateLegacyAutosave,
} from '@/lib/autosave-opfs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import SidePanelTabs from '@/components/pixel-editor/shared/SidePanelTabs';
import { Pencil, ChevronDown, ChevronUp, Film, Users, PenLine, Layers, Route, Globe, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function Home() {
  const { sprites, animationClips, activeAnimationClipId, setActiveAnimationClip } = useProjectStore();
  const { selectPart, editMode, exitSpriteEditMode, spriteEditSpriteId, leftPanelTab, setLeftPanelTab } = useEditorStore();
  const isMasking = editMode === 'mask';
  // 遮罩中：锁定不相干操作
  const isLocked = isMasking;
  const { layouts } = useWorkspaceStore();
  const [exportOpen, setExportOpen] = useState(false);
  const initializedRef = useRef(false);
  const { showProjectHome, setShowProjectHome, loadProjectList } = useAssetStore();

  // 单一编辑器布局（workspace mode 已退役，puppet 是唯一工作流）
  const currentLayout = layouts['puppet'];

  // Timeline collapsed state — locally managed, initialized from workspace layout
  const [timelineCollapsed, setTimelineCollapsed] = useState(() => currentLayout.timelineCollapsed);

  // ---- Check for autosave on startup ----
  const [autosaveDialogOpen, setAutosaveDialogOpen] = useState(false);

  // Load project list on mount
  useEffect(() => {
    loadProjectList();
  }, [loadProjectList]);

  // Check for autosave after mount (avoids SSR issues)
  // Uses OPFS; migrates legacy localStorage autosave on first run.
  useEffect(() => {
    (async () => {
      try {
        await migrateLegacyAutosave();
        const meta = await checkAutosaveInOPFS();
        if (meta) {
          setTimeout(() => setAutosaveDialogOpen(true), 0);
        }
      } catch (e) {
        console.error('[autosave] Check failed:', e);
      }
    })();
  }, []);

  // ---- Auto-save: 5-minute interval + beforeunload (OPFS) ----
  useEffect(() => {
    const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // Save if there's any meaningful work (not just sprites)
    const hasWork = () => {
      const state = useProjectStore.getState();
      return (
        Object.keys(state.sprites).length > 0 ||
        Object.keys(state.unifiedCharacters ?? {}).length > 0 ||
        (state.animationClips ?? []).length > 0
      );
    };

    const autoSave = () => {
      if (!hasWork()) return;
      const state = useProjectStore.getState();
      const data = state.exportProjectFile();
      // Fire and forget; errors are logged in saveAutosaveToOPFS
      saveAutosaveToOPFS(data);
    };

    const interval = setInterval(autoSave, AUTO_SAVE_INTERVAL);

    const handleUnload = () => autoSave();
    window.addEventListener('beforeunload', handleUnload);

    // Page Lifecycle 推荐：切到后台时保存（页面还活着，OPFS 异步写能完成；
    // beforeunload 不等 Promise，OPFS 写大概率被撕掉，只当最后兜底）
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') autoSave();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const handleRestoreAutosave = useCallback(async () => {
    try {
      const projectFile = await loadAutosaveFromOPFS();
      if (projectFile) {
        useProjectStore.getState().importProjectFile(projectFile as any);
      } else {
        console.error('[autosave] Restore failed: no data loaded from OPFS');
      }
    } catch (e) {
      console.error('[autosave] Restore failed:', e);
    }
    await clearAutosaveInOPFS();
    setAutosaveDialogOpen(false);
  }, []);

  const handleDiscardAutosave = useCallback(async () => {
    await clearAutosaveInOPFS();
    setAutosaveDialogOpen(false);
  }, []);

  // Create demo parts on first load — Kirby-like walking animation
  useEffect(() => {
    if (initializedRef.current || Object.keys(sprites).length > 0) return;
    initializedRef.current = true;

    const store = useProjectStore.getState();

    // V3.0: Ensure an animation clip exists — auto-migrate if needed
    if (store.animationClips.length === 0) {
      // Create a default animation clip for the demo
      const clip = store.addAnimationClip('行走动画', '');
      // 片段时间窗：16 帧行走循环（工程帧率/总帧数在工程设置里另行给定）
      store.updateAnimationClip(clip.id, { startFrame: 0, endFrame: 15 });
    } else if (!store.activeAnimationClipId) {
      store.setActiveAnimationClip(store.animationClips[0].id);
    }

    // ============================================================
    // Helper: draw a filled ellipse on a pixel grid
    // ============================================================
    const fillEllipse = (
      pixels: string[][],
      cx: number, cy: number,
      rx: number, ry: number,
      fill: string, outline?: string,
    ) => {
      const h = pixels.length;
      const w = pixels[0]?.length || 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 1) {
            pixels[y][x] = fill;
          }
          if (outline && d2 > 0.7 && d2 <= 1) {
            pixels[y][x] = outline;
          }
        }
      }
    };

    // ============================================================
    // Part 1: Body (24×24) — Round pink Kirby-like body with face
    // ============================================================
    const body = store.addSprite('身体', 24, 24);
    {
      const pixels = body.data.map((row) => [...row] as string[]);
      // Main round body
      fillEllipse(pixels, 12, 12, 10, 10, '#ff88aa', '#cc4477');

      // --- Face (facing right, 3/4 view) ---
      // Right eye (near, larger) — white sclera
      fillEllipse(pixels, 16, 8, 2.5, 3, '#ffffff');
      // Right eye — blue iris
      fillEllipse(pixels, 16.5, 9, 1.5, 2, '#4466ff');
      // Right eye — highlight
      pixels[7][17] = '#ffffff';

      // Left eye (far, smaller) — white sclera
      fillEllipse(pixels, 11, 8, 2, 2.5, '#ffffff');
      // Left eye — blue iris
      fillEllipse(pixels, 11.5, 9, 1, 1.5, '#4466ff');
      // Left eye — highlight
      pixels[7][12] = '#ffffff';

      // Blush marks
      fillEllipse(pixels, 7, 12, 2, 1.5, '#ff6688');

      // Mouth — small happy curve
      pixels[14][14] = '#ee3355';
      pixels[14][15] = '#ee3355';
      pixels[13][13] = '#ee3355';
      pixels[15][13] = '#ee3355';
      pixels[15][14] = '#ee3355';

      store.setSpritePixels(body.id!, pixels);
      store.updateSprite(body.id!, { plug: { x: pxToSub(12), y: pxToSub(12) } });
    }

    // ============================================================
    // Part 2: Left Arm (10×8) — Stubby round arm (far arm in side view)
    // ============================================================
    const leftArm = store.addSprite('左臂', 10, 8);
    {
      const pixels = leftArm.data.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 4, 4, 3.5, '#ff88aa', '#cc4477');
      store.setSpritePixels(leftArm.id!, pixels);
      store.updateSprite(leftArm.id!, { plug: { x: pxToSub(5), y: pxToSub(0) } });
    }

    // ============================================================
    // Part 3: Right Arm (10×8) — Stubby round arm (near arm)
    // ============================================================
    const rightArm = store.addSprite('右臂', 10, 8);
    {
      const pixels = rightArm.data.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 4, 4, 3.5, '#ff88aa', '#cc4477');
      store.setSpritePixels(rightArm.id!, pixels);
      store.updateSprite(rightArm.id!, { plug: { x: pxToSub(5), y: pxToSub(0) } });
    }

    // ============================================================
    // Part 4: Left Foot (10×6) — Stubby red foot (far foot)
    // ============================================================
    const leftFoot = store.addSprite('左脚', 10, 6);
    {
      const pixels = leftFoot.data.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 3, 4, 2.5, '#dd3366', '#aa1144');
      store.setSpritePixels(leftFoot.id!, pixels);
      store.updateSprite(leftFoot.id!, { plug: { x: pxToSub(5), y: pxToSub(0) } });
    }

    // ============================================================
    // Part 5: Right Foot (10×6) — Stubby red foot (near foot)
    // ============================================================
    const rightFoot = store.addSprite('右脚', 10, 6);
    {
      const pixels = rightFoot.data.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 3, 4, 2.5, '#dd3366', '#aa1144');
      store.setSpritePixels(rightFoot.id!, pixels);
      store.updateSprite(rightFoot.id!, { plug: { x: pxToSub(5), y: pxToSub(0) } });
    }

    // ============================================================
    // Z-order: far arm < far foot < body < near foot < near arm
    // ============================================================
    // 演示行走动画原本靠旧工程关键帧（已退役）：精灵资产保留播种，
    // 动画部分不再写死数据（旧关键帧无任何消费端）。

    // Select body part by default
    selectPart(body.id!);
  }, [Object.keys(sprites).length]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-screen w-screen bg-[#0a0a16] text-gray-200 overflow-hidden">
        {/* Toolbar - top (对位中禁用) */}
        <div className={isLocked ? 'pointer-events-none opacity-40' : ''}>
          <Toolbar onExportClick={() => setExportOpen(true)} />
        </div>

        {/* Project Home Screen (replaces editor when no project is open) */}
        {showProjectHome ? (
          <ProjectHomeScreen />
        ) : (
        /* Main content area with resizable panels */
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1 min-h-0"
        >
          {/* Left panel - Parts (对位中禁用) */}
          {currentLayout.leftPanelVisible && (
            <>
              <ResizablePanel
                defaultSize={currentLayout.leftPanelWidth / 12}
                minSize={12}
                maxSize={30}
                order={1}
                className="transition-all duration-300"
              >
                <div className={isLocked ? 'pointer-events-none opacity-40 h-full' : 'h-full'}>
                  {/* 侧面页签切换：一栏一次只显示一块、独占整高（取代
                      原来的自上而下堆叠 + 分高——堆叠必然溢出，分高
                      只是把每块压小）。各面板自带 h-full 根与内部
                      滚动，整高下滚自己内部 */}
                  <SidePanelTabs
                    side="left"
                    ariaLabel="左栏面板"
                    activeId={leftPanelTab}
                    onChange={setLeftPanelTab}
                    tabs={[
                      {
                        id: 'assets',
                        label: '资产',
                        icon: <Users className="size-4" />,
                        content: <PuppetAssetPanel />,
                      },
                      {
                        id: 'clips',
                        label: '片段',
                        icon: <Film className="size-4" />,
                        content: <AnimationClipPanel />,
                      },
                      {
                        id: 'strokes',
                        label: '笔触',
                        icon: <PenLine className="size-4" />,
                        content: <StrokePanel />,
                      },
                      // 工程数据类面板归左栏（与资产/片段/笔触同类，不随
                      // 画布选择走）：画布轨道、精灵轨迹、工程级全局变换、
                      // 片段的事件/标签/碰撞（2026-10-29 用户裁定归左）
                      {
                        id: 'canvas',
                        label: '画布效果',
                        icon: <Layers className="size-4" />,
                        content: <CanvasModifierPanel />,
                      },
                      {
                        id: 'global',
                        label: '全局',
                        icon: <Globe className="size-4" />,
                        content: <GlobalModifierPanel />,
                      },
                      {
                        id: 'dcc',
                        label: 'DCC管线',
                        icon: <Zap className="size-4" />,
                        content: <DccPipelinePanel />,
                      },
                    ]}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle className="bg-zinc-800/80 hover:bg-purple-600/30 transition-colors w-px" />
            </>
          )}

          {/* Center - Canvas + Timeline (vertical split) */}
          <ResizablePanel
            defaultSize={100 - currentLayout.leftPanelWidth / 12 - currentLayout.rightPanelWidth / 12}
            minSize={30}
            order={2}
          >
            <ResizablePanelGroup direction="vertical">
              {/* Canvas area */}
              <ResizablePanel
                defaultSize={timelineCollapsed ? 95 : 70}
                minSize={30}
                order={1}
              >
                <div className="flex h-full min-w-0">
                  {/* 画布左缘工具盘（遮罩对位中与顶栏同等禁用） */}
                  <div className={isLocked ? 'pointer-events-none opacity-40' : ''}>
                    <CanvasToolRail />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0 h-full">
                  {/* Part Edit Mode banner — only in animation mode */}
                  {editMode === 'sprite_edit' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/15 border-b border-cyan-500/30 shrink-0">
                      <Pencil className="size-3.5 text-cyan-400" />
                      <span className="text-xs font-medium text-cyan-300">
                        部件编辑模式
                      </span>
                      <span className="text-[10px] text-cyan-400/60">
                        — {sprites[spriteEditSpriteId ?? '']?.name ?? ''}
                      </span>
                      <div className="ml-auto flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-zinc-400 hover:text-zinc-200 px-2"
                          onClick={() => exitSpriteEditMode(true)}
                        >
                          取消
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] bg-cyan-600 hover:bg-cyan-500 px-2"
                          onClick={() => exitSpriteEditMode(false)}
                        >
                          确认
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="relative flex-1 min-h-0">
                    <PixelCanvas />
                    {/* 画布悬浮视图控制（遮罩对位中与顶栏同等禁用） */}
                    <div className={isLocked ? 'pointer-events-none opacity-40' : ''}>
                      <CanvasViewToggles />
                      <CanvasZoomDock />
                    </div>
                  </div>
                  </div>
                </div>
              </ResizablePanel>

              {/* Timeline */}
              <ResizableHandle className="bg-zinc-800/80 hover:bg-amber-600/30 transition-colors h-px" />
              <ResizablePanel
                defaultSize={timelineCollapsed ? 5 : 30}
                minSize={5}
                maxSize={60}
                order={2}
                collapsible
                onCollapse={() => setTimelineCollapsed(true)}
                onExpand={() => setTimelineCollapsed(false)}
                ref={(panel) => {
                  if (panel) {
                    // Persist collapsed state to workspace store
                    if (timelineCollapsed && !panel.isCollapsed()) {
                      // Will be handled by the panel's own state
                    }
                  }
                }}
              >
                <div className="flex flex-col h-full bg-[#0e0e1c]">
                  {/* Timeline collapse toggle header with clip selector */}
                  <div
                    className="flex items-center h-6 px-2 border-b border-zinc-800/50 cursor-pointer hover:bg-white/5 shrink-0 select-none"
                    onClick={() => {
                      setTimelineCollapsed(!timelineCollapsed);
                    }}
                  >
                    <Film className="size-3 text-amber-400 mr-1" />
                    {/* Animation clip selector */}
                    <select
                      className="text-[10px] font-medium bg-transparent border-none text-amber-300 outline-none cursor-pointer mr-1"
                      value={activeAnimationClipId ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        setActiveAnimationClip(e.target.value || null);
                      }}
                    >
                      {animationClips.map(clip => (
                        <option key={clip.id} value={clip.id} className="bg-zinc-900">
                          {clip.name}
                        </option>
                      ))}
                    </select>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                      时间轴
                    </span>
                    <span className="ml-auto">
                      {timelineCollapsed ? (
                        <ChevronUp className="size-3 text-zinc-500" />
                      ) : (
                        <ChevronDown className="size-3 text-zinc-500" />
                      )}
                    </span>
                  </div>
                  {/* Timeline content */}
                  {!timelineCollapsed && (
                    <div className="flex-1 min-h-0">
                      <Timeline />
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Right panel (对位中禁用) */}
          {currentLayout.rightPanelVisible && (
            <>
              <ResizableHandle className="bg-zinc-800/80 hover:bg-purple-600/30 transition-colors w-px" />
              <ResizablePanel
                defaultSize={currentLayout.rightPanelWidth / 12}
                minSize={15}
                maxSize={40}
                order={3}
                className="border-l border-zinc-800 transition-all duration-300"
              >
                <div className={isLocked ? 'pointer-events-none opacity-40 h-full' : 'h-full'}>
                  {/* 右栏页签在 PuppetPanel 内部（它本身就是页签容器：
                      骨架/换装/操控/行为/状态机/行为树/预览 + 恢复的动画
                      工具面板同排），此处不套第二层页签 */}
                  <PuppetPanel />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        )}

        {/* Export Dialog */}
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />

        {/* Autosave Restore Dialog */}
        <Dialog open={autosaveDialogOpen} onOpenChange={setAutosaveDialogOpen}>
          <DialogContent className="bg-zinc-900 border-zinc-700 max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm text-zinc-100">
                发现自动保存
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                检测到上次会话的自动保存数据。是否恢复？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                  onClick={handleDiscardAutosave}
                >
                  丢弃
                </Button>
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={handleRestoreAutosave}
                >
                  恢复
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
