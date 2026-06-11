'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import PixelCanvas from '@/components/pixel-editor/PixelCanvas';
import PartPanel from '@/components/pixel-editor/PartPanel';
import ModifierPanel from '@/components/pixel-editor/ModifierPanel';
import TrajectoryPanel from '@/components/pixel-editor/TrajectoryPanel';
import SkeletonPanel from '@/components/pixel-editor/SkeletonPanel';
import PuppetPanel from '@/components/pixel-editor/PuppetPanel';
import PuppetAssetPanel from '@/components/pixel-editor/PuppetAssetPanel';
import DccPipelinePanel from '@/components/pixel-editor/DccPipelinePanel';
import ProceduralPanel from '@/components/pixel-editor/ProceduralPanel';
import ScriptPanel from '@/components/pixel-editor/ScriptPanel';
import PluginPanel from '@/components/pixel-editor/PluginPanel';
import CanvasModifierPanel from '@/components/pixel-editor/CanvasModifierPanel';
import AnimationClipPanel from '@/components/pixel-editor/AnimationClipPanel';
import GlobalModifierPanel from '@/components/pixel-editor/GlobalModifierPanel';
import TilePreviewPanel from '@/components/pixel-editor/TilePreviewPanel';
import TileWorkflowPanel from '@/components/pixel-editor/TileWorkflowPanel';
import TileAssetPanel from '@/components/pixel-editor/TileAssetPanel';
import AssetLibraryPanel from '@/components/pixel-editor/AssetLibraryPanel';
import ProjectHomeScreen from '@/components/pixel-editor/ProjectHomeScreen';
import Timeline from '@/components/pixel-editor/Timeline';
import Toolbar from '@/components/pixel-editor/Toolbar';
import ExportDialog from '@/components/pixel-editor/ExportDialog';
import { useProjectStore } from '@/lib/store';
import { useEditorStore } from '@/lib/store';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { useTileWorkflowStore } from '@/lib/tile-workflow-store';
import { useAssetStore } from '@/lib/asset-store';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Settings, Route, Bone, Activity, Terminal, Puzzle, Layers, Pencil, ChevronDown, ChevronUp, Grid3x3, Eye, Paintbrush, Globe, Film, Shirt, Zap, Users } from 'lucide-react';
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
  const { parts, animationClips, activeAnimationClipId, setActiveAnimationClip } = useProjectStore();
  const { selectPart, editMode, exitPartEditMode, partEditPartId } = useEditorStore();
  const { mode, layouts, updateLayout } = useWorkspaceStore();
  const { editingTarget, setEditingTarget } = useTileWorkflowStore();
  const [exportOpen, setExportOpen] = useState(false);
  const initializedRef = useRef(false);
  const { showProjectHome, setShowProjectHome, loadProjectList, loadLibrary } = useAssetStore();

  // Get current layout based on workspace mode
  const currentLayout = layouts[mode];

  // Timeline collapsed state — locally managed, initialized from workspace layout
  // When workspace mode changes, the workspace store is the source of truth
  const [timelineCollapsed, setTimelineCollapsed] = useState(() => layouts[mode].timelineCollapsed);
  const [activeMode, setActiveMode] = useState(mode);

  // Sync when mode changes (using a key-based pattern)
  if (activeMode !== mode) {
    setActiveMode(mode);
    setTimelineCollapsed(layouts[mode].timelineCollapsed);
  }

  // ---- Check for autosave on startup ----
  const [autosaveDialogOpen, setAutosaveDialogOpen] = useState(false);

  // Load asset library and project list on mount
  useEffect(() => {
    loadLibrary();
    loadProjectList();
  }, [loadLibrary, loadProjectList]);

  // Check for autosave after mount (avoids SSR localStorage issues)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pixelmorpher-autosave');
      const savedTime = localStorage.getItem('pixelmorpher-autosave-time');
      if (saved && savedTime) {
        // Use setTimeout to avoid calling setState directly in effect
        setTimeout(() => setAutosaveDialogOpen(true), 0);
      }
    } catch {}
  }, []);

  // ---- Auto-save: 5-minute interval + beforeunload ----
  useEffect(() => {
    const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes

    const autoSave = () => {
      const state = useProjectStore.getState();
      if (state.parts.length > 0) {
        const data = state.exportProjectFile();
        localStorage.setItem('pixelmorpher-autosave', JSON.stringify(data));
        localStorage.setItem('pixelmorpher-autosave-time', new Date().toISOString());
      }
    };

    const interval = setInterval(autoSave, AUTO_SAVE_INTERVAL);

    const handleUnload = () => autoSave();
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  const handleRestoreAutosave = useCallback(() => {
    try {
      const saved = localStorage.getItem('pixelmorpher-autosave');
      if (saved) {
        const projectFile = JSON.parse(saved);
        useProjectStore.getState().importProjectFile(projectFile);
      }
    } catch {}
    localStorage.removeItem('pixelmorpher-autosave');
    localStorage.removeItem('pixelmorpher-autosave-time');
    setAutosaveDialogOpen(false);
  }, []);

  const handleDiscardAutosave = useCallback(() => {
    localStorage.removeItem('pixelmorpher-autosave');
    localStorage.removeItem('pixelmorpher-autosave-time');
    setAutosaveDialogOpen(false);
  }, []);

  // Create demo parts on first load — Kirby-like walking animation
  useEffect(() => {
    if (initializedRef.current || parts.length > 0) return;
    initializedRef.current = true;

    const store = useProjectStore.getState();

    // V3.0: Ensure an animation clip exists — auto-migrate if needed
    if (store.animationClips.length === 0) {
      // Create a default animation clip for the demo
      const clip = store.addAnimationClip('行走动画');
      // Project settings: 8fps, 16 frames for a smooth walk cycle
      store.updateAnimationClip(clip.id, { frameRate: 8, totalFrames: 16 });
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
    const body = store.addPart('身体', 24, 24);
    {
      const pixels = body.pixels.map((row) => [...row] as string[]);
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

      store.setPartPixels(body.id, pixels);
      store.updatePart(body.id, { pivotX: 12, pivotY: 12 });
    }

    // ============================================================
    // Part 2: Left Arm (10×8) — Stubby round arm (far arm in side view)
    // ============================================================
    const leftArm = store.addPart('左臂', 10, 8);
    {
      const pixels = leftArm.pixels.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 4, 4, 3.5, '#ff88aa', '#cc4477');
      store.setPartPixels(leftArm.id, pixels);
      store.updatePart(leftArm.id, { pivotX: 5, pivotY: 0 });
    }

    // ============================================================
    // Part 3: Right Arm (10×8) — Stubby round arm (near arm)
    // ============================================================
    const rightArm = store.addPart('右臂', 10, 8);
    {
      const pixels = rightArm.pixels.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 4, 4, 3.5, '#ff88aa', '#cc4477');
      store.setPartPixels(rightArm.id, pixels);
      store.updatePart(rightArm.id, { pivotX: 5, pivotY: 0 });
    }

    // ============================================================
    // Part 4: Left Foot (10×6) — Stubby red foot (far foot)
    // ============================================================
    const leftFoot = store.addPart('左脚', 10, 6);
    {
      const pixels = leftFoot.pixels.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 3, 4, 2.5, '#dd3366', '#aa1144');
      store.setPartPixels(leftFoot.id, pixels);
      store.updatePart(leftFoot.id, { pivotX: 5, pivotY: 0 });
    }

    // ============================================================
    // Part 5: Right Foot (10×6) — Stubby red foot (near foot)
    // ============================================================
    const rightFoot = store.addPart('右脚', 10, 6);
    {
      const pixels = rightFoot.pixels.map((row) => [...row] as string[]);
      fillEllipse(pixels, 5, 3, 4, 2.5, '#dd3366', '#aa1144');
      store.setPartPixels(rightFoot.id, pixels);
      store.updatePart(rightFoot.id, { pivotX: 5, pivotY: 0 });
    }

    // ============================================================
    // Z-order: far arm < far foot < body < near foot < near arm
    // ============================================================
    store.updatePart(leftArm.id, { zIndex: 0 });
    store.updatePart(leftFoot.id, { zIndex: 1 });
    store.updatePart(body.id, { zIndex: 2 });
    store.updatePart(rightFoot.id, { zIndex: 3 });
    store.updatePart(rightArm.id, { zIndex: 4 });

    // ============================================================
    // Walking Animation — Using Animation Modifiers
    // ============================================================

    // Helper: create a keyframe with translate + optional rotate
    const addKf = (
      partId: string, frame: number,
      offsetX: number, offsetY: number, angle?: number,
    ) => {
      const kf = store.addKeyframe(partId, frame);
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
    addKf(body.id,     0,   0, -10);
    addKf(leftArm.id,  0, -12, -16);
    addKf(rightArm.id, 0,   6, -16);
    addKf(leftFoot.id, 0,  -4,   2);
    addKf(rightFoot.id,0,   2,   2);

    // Add pendulum to arms
    const leftArmPendulum = store.addPartAnimationModifier(leftArm.id, 'pendulum');
    store.updatePartAnimationModifier(leftArm.id, leftArmPendulum.id,
      { amplitude: 25, period: 16, phase: 180, damping: 0 }
    );

    const rightArmPendulum = store.addPartAnimationModifier(rightArm.id, 'pendulum');
    store.updatePartAnimationModifier(rightArm.id, rightArmPendulum.id,
      { amplitude: 25, period: 16, phase: 0, damping: 0 }
    );

    // Add gait to feet
    const leftFootGait = store.addPartAnimationModifier(leftFoot.id, 'gait');
    store.updatePartAnimationModifier(leftFoot.id, leftFootGait.id,
      { strideLength: 16, liftHeight: 8, period: 16, phase: 180, stanceRatio: 0.6, direction: 'forward' }
    );

    const rightFootGait = store.addPartAnimationModifier(rightFoot.id, 'gait');
    store.updatePartAnimationModifier(rightFoot.id, rightFootGait.id,
      { strideLength: 16, liftHeight: 8, period: 16, phase: 0, stanceRatio: 0.6, direction: 'forward' }
    );

    // ---- Frame 4: Passing ----
    addKf(body.id,     4,   0, -12);
    addKf(leftArm.id,  4, -12, -18);
    addKf(rightArm.id, 4,   6, -18);
    addKf(leftFoot.id, 4,  -4,  -1);
    addKf(rightFoot.id,4,   2,  -1);

    // ---- Frame 8: Contact 2 ----
    addKf(body.id,     8,   0, -10);
    addKf(leftArm.id,  8, -12, -16);
    addKf(rightArm.id, 8,   6, -16);
    addKf(leftFoot.id, 8,  -4,   2);
    addKf(rightFoot.id,8,   2,   2);

    // ---- Frame 12: Passing back ----
    addKf(body.id,     12,  0, -12);
    addKf(leftArm.id,  12,-12, -18);
    addKf(rightArm.id, 12,  6, -18);
    addKf(leftFoot.id, 12, -4,  -1);
    addKf(rightFoot.id,12,  2,  -1);

    // ============================================================
    // Skeleton
    // ============================================================
    const skeleton = store.addSkeleton('角色骨骼');
    useEditorStore.getState().setActiveSkeletonId(skeleton.id);

    // Spine — center of body
    const spine = store.addBone(skeleton.id, '脊椎', null, 128, 118, 128, 100);
    store.bindPartToBone(skeleton.id, spine.id, body.id, 1.0);

    // Left arm bone
    const leftArmBone = store.addBone(skeleton.id, '左臂骨骼', spine.id, 116, 104, 104, 110);
    store.bindPartToBone(skeleton.id, leftArmBone.id, leftArm.id, 1.0);

    // Right arm bone
    const rightArmBone = store.addBone(skeleton.id, '右臂骨骼', spine.id, 140, 104, 152, 110);
    store.bindPartToBone(skeleton.id, rightArmBone.id, rightArm.id, 1.0);

    // Left leg bone
    const leftLegBone = store.addBone(skeleton.id, '左脚骨骼', spine.id, 122, 130, 122, 140);
    store.bindPartToBone(skeleton.id, leftLegBone.id, leftFoot.id, 1.0);

    // Right leg bone
    const rightLegBone = store.addBone(skeleton.id, '右脚骨骼', spine.id, 134, 130, 134, 140);
    store.bindPartToBone(skeleton.id, rightLegBone.id, rightFoot.id, 1.0);

    // Select body part by default
    selectPart(body.id);

    // Auto-record trajectories for all parts
    for (const part of useProjectStore.getState().parts) {
      useProjectStore.getState().autoRecordTrajectory(part.id);
    }

    // Enable trajectory display by default
    useEditorStore.getState().toggleTrajectories();

    // V3.0: Migrate legacy data into the active animation clip
    // After all parts, keyframes, and modifiers are created at the Project level,
    // move them into the active AnimationClip for the new asset-based model.
    const activeClipId = useProjectStore.getState().activeAnimationClipId;
    if (activeClipId) {
      useProjectStore.getState().migrateLegacyToClip(activeClipId);
    }
  }, [parts.length]);

  // ---- Right panel content based on workspace mode ----
  const renderRightPanel = () => {
    if (mode === 'map_tile') {
      return (
        <Tabs defaultValue="tile_workflow" className="flex flex-col h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-zinc-950 h-auto min-h-8 px-0.5 py-0.5">
            <TabsTrigger
              value="tile_workflow"
              className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
            >
              <Grid3x3 className="size-3 mr-0.5" />
              瓦片工作流
            </TabsTrigger>
            <TabsTrigger
              value="tile_preview"
              className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
            >
              <Eye className="size-3 mr-0.5" />
              平铺预览
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tile_workflow" className="flex-1 min-h-0 m-0">
            <TileWorkflowPanel />
          </TabsContent>
          <TabsContent value="tile_preview" className="flex-1 min-h-0 m-0">
            <TilePreviewPanel />
          </TabsContent>
        </Tabs>
      );
    }

    // Puppet mode: dedicated right panel for puppet workflow
    if (mode === 'puppet') {
      return (
        <Tabs defaultValue="puppet_workflow" className="flex flex-col h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-zinc-950 h-auto min-h-8 px-0.5 py-0.5">
            <TabsTrigger
              value="puppet_workflow"
              className="text-[10px] data-[state=active]:bg-cyan-900/40 data-[state=active]:text-cyan-300 text-zinc-500 px-1.5 py-1 h-6"
            >
              <Shirt className="size-3 mr-0.5" />
              木偶工作流
            </TabsTrigger>
            <TabsTrigger
              value="puppet_modifiers"
              className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
            >
              <Settings className="size-3 mr-0.5" />
              修改器
            </TabsTrigger>
            <TabsTrigger
              value="puppet_canvas"
              className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
            >
              <Layers className="size-3 mr-0.5" />
              画布效果
            </TabsTrigger>
          </TabsList>
          <TabsContent value="puppet_workflow" className="flex-1 min-h-0 m-0">
            <PuppetPanel />
          </TabsContent>
          <TabsContent value="puppet_modifiers" className="flex-1 min-h-0 m-0">
            <ModifierPanel />
          </TabsContent>
          <TabsContent value="puppet_canvas" className="flex-1 min-h-0 m-0">
            <CanvasModifierPanel />
          </TabsContent>
        </Tabs>
      );
    }

    // Animation mode: tabbed panel with all the existing tabs
    return (
      <Tabs defaultValue={currentLayout.rightPanelDefaultTab} className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-zinc-950 h-auto min-h-8 px-0.5 py-0.5 flex-wrap">
          <TabsTrigger
            value="modifiers"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Settings className="size-3 mr-0.5" />
            修改器
          </TabsTrigger>
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
            value="skeleton"
            className="text-[10px] data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-500 px-1.5 py-1 h-6"
          >
            <Bone className="size-3 mr-0.5" />
            骨骼
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
        <TabsContent value="modifiers" className="flex-1 min-h-0 m-0">
          <ModifierPanel />
        </TabsContent>
        <TabsContent value="canvas" className="flex-1 min-h-0 m-0">
          <CanvasModifierPanel />
        </TabsContent>
        <TabsContent value="trajectory" className="flex-1 min-h-0 m-0">
          <TrajectoryPanel />
        </TabsContent>
        <TabsContent value="skeleton" className="flex-1 min-h-0 m-0">
          <SkeletonPanel />
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
        {/* Toolbar - top */}
        <Toolbar onExportClick={() => setExportOpen(true)} />

        {/* Project Home Screen (replaces editor when no project is open) */}
        {mode === 'project_home' || showProjectHome ? (
          <ProjectHomeScreen />
        ) : (
        /* Main content area with resizable panels */
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1 min-h-0"
        >
          {/* Left panel - Parts */}
          {currentLayout.leftPanelVisible && (
            <>
              <ResizablePanel
                defaultSize={currentLayout.leftPanelWidth / 12}
                minSize={12}
                maxSize={30}
                order={1}
                className="transition-all duration-300"
              >
                {mode === 'map_tile' ? <TileAssetPanel /> : mode === 'puppet' ? (
                  <div className="flex flex-col h-full">
                    <PuppetAssetPanel />
                    <div className="border-t border-zinc-800/50">
                      <AnimationClipPanel />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <AssetLibraryPanel />
                    <div className="border-t border-zinc-800/50">
                      <AnimationClipPanel />
                    </div>
                  </div>
                )}
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
                  {editMode === 'part_edit' && mode !== 'map_tile' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/15 border-b border-cyan-500/30 shrink-0">
                      <Pencil className="size-3.5 text-cyan-400" />
                      <span className="text-xs font-medium text-cyan-300">
                        部件编辑模式
                      </span>
                      <span className="text-[10px] text-cyan-400/60">
                        — {parts.find(p => p.id === partEditPartId)?.name ?? ''}
                      </span>
                      <div className="ml-auto flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-zinc-400 hover:text-zinc-200 px-2"
                          onClick={() => exitPartEditMode(true)}
                        >
                          取消
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 text-[10px] bg-cyan-600 hover:bg-cyan-500 px-2"
                          onClick={() => exitPartEditMode(false)}
                        >
                          确认
                        </Button>
                      </div>
                    </div>
                  )}
                  {/* Puppet Mode banner */}
                  {mode === 'puppet' && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 border-b border-cyan-500/20 shrink-0">
                      <Users className="size-3.5 text-cyan-400" />
                      <span className="text-xs font-medium text-cyan-300">
                        木偶制作模式
                      </span>
                      <span className="text-[10px] text-cyan-400/50">
                        — 在右侧面板中创建和编辑木偶角色
                      </span>
                    </div>
                  )}
                  {/* Tile Editing Mode banner */}
                  {mode === 'map_tile' && editingTarget && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/15 border-b border-emerald-500/30 shrink-0">
                      <Paintbrush className="size-3.5 text-emerald-400" />
                      <span className="text-xs font-medium text-emerald-300">
                        瓦片编辑
                      </span>
                      <span className="text-[10px] text-emerald-400/60">
                        — {editingTarget.label}
                      </span>
                      <div className="ml-auto flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-zinc-400 hover:text-zinc-200 px-2"
                          onClick={() => setEditingTarget(null)}
                        >
                          退出编辑
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

          {/* Right panel */}
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
                {renderRightPanel()}
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
