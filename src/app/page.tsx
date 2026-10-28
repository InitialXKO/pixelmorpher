'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import PixelCanvas from '@/components/pixel-editor/PixelCanvas';
import TrajectoryPanel from '@/components/pixel-editor/TrajectoryPanel';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Settings, Route, Activity, Terminal, Puzzle, Layers, Pencil, ChevronDown, ChevronUp, Grid3x3, Eye, Paintbrush, Globe, Film, Shirt, Zap } from 'lucide-react';
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
  const { selectPart, editMode, exitSpriteEditMode, spriteEditSpriteId } = useEditorStore();
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

    // ============================================================
    // Walking Animation — Using Animation Modifiers
    // ============================================================

    // Helper: create a keyframe with translate + optional rotate
    const addKf = (
      spriteId: string, frame: number,
      offsetX: number, offsetY: number, angle?: number,
    ) => {
      const kf = store.addKeyframe(spriteId, frame);
      store.addModifier(kf.id, 'translate');
      if (angle !== undefined && angle !== 0) {
        store.addModifier(kf.id, 'rotate');
      }
      const updated = store.keyframes.find(k => k.id === kf.id);
      if (updated) {
        const tMod = updated.modifiers.find(m => m.type === 'translate');
        if (tMod) store.updateModifier(kf.id, tMod.id, { offsetX, offsetY });
        if (angle !== undefined && angle !== 0) {
          const rMod = updated.modifiers.find(m => m.type === 'rotate');
          if (rMod) store.updateModifier(kf.id, rMod.id, { angle });
        }
      }
    };

    // Neutral standing offsets:
    //   Body:  (0, -10)      Left arm:  (-12, -16)     Right arm: (6, -16)
    //   Left foot: (-4, 2)   Right foot: (2, 2)

    // ---- Frame 0: Contact 1 (right foot forward, left foot back) ----
    addKf(body.id!,     0,   0, -10);
    addKf(leftArm.id!,  0, -12, -16);
    addKf(rightArm.id!, 0,   6, -16);
    addKf(leftFoot.id!, 0,  -4,   2);
    addKf(rightFoot.id!,0,   2,   2);

    // Add pendulum to arms


    // Add gait to feet


    // ---- Frame 4: Passing ----
    addKf(body.id!,     4,   0, -12);
    addKf(leftArm.id!,  4, -12, -18);
    addKf(rightArm.id!, 4,   6, -18);
    addKf(leftFoot.id!, 4,  -4,  -1);
    addKf(rightFoot.id!,4,   2,  -1);

    // ---- Frame 8: Contact 2 ----
    addKf(body.id!,     8,   0, -10);
    addKf(leftArm.id!,  8, -12, -16);
    addKf(rightArm.id!, 8,   6, -16);
    addKf(leftFoot.id!, 8,  -4,   2);
    addKf(rightFoot.id!,8,   2,   2);

    // ---- Frame 12: Passing back ----
    addKf(body.id!,     12,  0, -12);
    addKf(leftArm.id!,  12,-12, -18);
    addKf(rightArm.id!, 12,  6, -18);
    addKf(leftFoot.id!, 12, -4,  -1);
    addKf(rightFoot.id!,12,  2,  -1);

    // Select body part by default
    selectPart(body.id!);

    // Auto-record trajectories for all parts
    for (const sprite of Object.values(useProjectStore.getState().sprites)) {
      useProjectStore.getState().autoRecordTrajectory(sprite.id!);
    }

    // Enable trajectory display by default
    useEditorStore.getState().toggleTrajectories();

    // V3.0: Migrate legacy data into the active animation clip
    // After all parts, keyframes, and modifiers are created at the Project level,
  }, [Object.keys(sprites).length]);

  // ---- Right panel content based on workspace mode ----
  const renderRightPanel = () => {
    // Puppet 是唯一工作流：单 focused 面板（rig → dress → perform）
    return <PuppetPanel />;
    return (
      <Tabs defaultValue={currentLayout.rightPanelDefaultTab} className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-zinc-950 h-auto min-h-8 px-0.5 py-0.5 flex-wrap">
          <TabsTrigger
            value="canvas"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Layers className="size-3 mr-0.5" />
            画布效果
          </TabsTrigger>
          <TabsTrigger
            value="trajectory"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Route className="size-3 mr-0.5" />
            轨迹
          </TabsTrigger>
          <TabsTrigger
            value="procedural"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Activity className="size-3 mr-0.5" />
            程序化
          </TabsTrigger>
          <TabsTrigger
            value="script"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Terminal className="size-3 mr-0.5" />
            脚本
          </TabsTrigger>
          <TabsTrigger
            value="plugins"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Puzzle className="size-3 mr-0.5" />
            插件
          </TabsTrigger>
          <TabsTrigger
            value="global"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Globe className="size-3 mr-0.5" />
            全局
          </TabsTrigger>
          <TabsTrigger
            value="puppet"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Shirt className="size-3 mr-0.5" />
            木偶
          </TabsTrigger>
          <TabsTrigger
            value="dcc"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Zap className="size-3 mr-0.5" />
            DCC管线
          </TabsTrigger>
        </TabsList>
        <TabsContent value="canvas" className="flex-1 min-h-0 m-0">
          <CanvasModifierPanel />
        </TabsContent>
        <TabsContent value="trajectory" className="flex-1 min-h-0 m-0">
          <TrajectoryPanel />
        </TabsContent>
        <TabsContent value="procedural" className="flex-1 min-h-0 m-0">
          <ProceduralPanel />
        </TabsContent>
        <TabsContent value="script" className="flex-1 min-h-0 m-0">
          <ScriptPanel />
        </TabsContent>
        <TabsContent value="plugins" className="flex-1 min-h-0 m-0">
          <PluginPanel />
        </TabsContent>
        <TabsContent value="global" className="flex-1 min-h-0 m-0">
          <GlobalModifierPanel />
        </TabsContent>
        <TabsContent value="puppet" className="flex-1 min-h-0 m-0">
          <PuppetPanel />
        </TabsContent>
        <TabsContent value="dcc" className="flex-1 min-h-0 m-0">
          <DccPipelinePanel />
        </TabsContent>
      </Tabs>
    );
  };

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
                  <div className="flex flex-col h-full">
                    {/* 三块面板各自的根都是 h-full：必须按份分高 + min-h-0
                        收口，否则第一块按内容撑满整列、下面两块被挤出
                        屏幕且整列无滚动、够不着（用户实测片段/笔触面板
                        消失）。各面板内部列表自带滚动，分到多高滚多高 */}
                    <div className="flex-[2] min-h-0">
                      <PuppetAssetPanel />
                    </div>
                    <div className="border-t border-zinc-800/50 flex-[1.5] min-h-0">
                      <AnimationClipPanel />
                    </div>
                    <div className="border-t border-zinc-800/50 flex-1 min-h-0">
                      <StrokePanel />
                    </div>
                  </div>
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
                <div className="flex flex-col h-full">
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
                  <PixelCanvas />
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
                  {renderRightPanel()}
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
