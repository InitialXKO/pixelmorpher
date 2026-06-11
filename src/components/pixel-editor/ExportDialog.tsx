'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/lib/store';
import { renderFrameToCanvas } from '@/lib/engine';
import { renderUnifiedToCanvas } from '@/lib/unified-pipeline-bridge';
import type { AnimationClip, PuppetCharacter, PuppetNodeKeyframe } from '@/lib/types';
import GIF from 'gif.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Download,
  Image as ImageIcon,
  Film,
  LayoutGrid,
  Video,
  FileJson,
  FolderOpen,
  Package,
  Upload,
  FileUp,
} from 'lucide-react';
import { parseAsepriteFile, type AsepriteFrame } from '@/lib/aseprite-parser';

// ============================================================
// ExportDialog - Export dialog for PixelMorpher animations (V2.0)
// ============================================================

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ExportFormat = 'spritesheet' | 'png' | 'gif' | 'video' | 'lottie' | 'project';
type BackgroundMode = 'transparent' | 'custom';
type SpritesheetDirection = 'horizontal' | 'vertical';
type VideoFormat = 'webm' | 'mp4';

interface ExportSettings {
  // Common
  scale: number;
  backgroundMode: BackgroundMode;
  customBgColor: string;

  // GIF
  gifQuality: number; // 1-20, lower = better quality (maps to gif.js quality param)
  gifLoopCount: number;
  gifFrameDelay: number;

  // Spritesheet
  sheetColumns: number;
  sheetPadding: number;
  sheetDirection: SpritesheetDirection;

  // Video (V2.0)
  videoFormat: VideoFormat;
  videoQuality: number; // 1-100 for WebM, mapped to CRF for MP4

  // Lottie (V2.0)
  lottieScale: number;
}

const defaultSettings: ExportSettings = {
  scale: 2,
  backgroundMode: 'transparent',
  customBgColor: '#1a1a2e',

  gifQuality: 10,
  gifLoopCount: 0,
  gifFrameDelay: 83,

  sheetColumns: 8,
  sheetPadding: 0,
  sheetDirection: 'horizontal',

  videoFormat: 'webm',
  videoQuality: 50,

  lottieScale: 1,
};

// ============================================================
// Lottie JSON Generator
// ============================================================

// Lottie animated property: can be animated (a=1, k=keyframes) or static (a=0, k=value)
type LottieAnimProp<T> = { a: 0; k: T } | { a: 1; k: LottieKeyframe[] };

interface LottieKeyframe {
  t: number;      // time (frame number)
  s: number[];    // start value
  e?: number[];   // end value (not used with hold interpolation)
  i?: { x: number; y: number } | { x: number; y: number }[];  // in tangent
  o?: { x: number; y: number } | { x: number; y: number }[];  // out tangent
}

interface LottieTransform {
  a?: LottieAnimProp<number[]>;  // anchor
  p?: LottieAnimProp<number[]>;  // position
  s?: LottieAnimProp<number[]>;  // scale
  r?: LottieAnimProp<number[] | number>;  // rotation (can be single number when static)
  o?: LottieAnimProp<number[] | number>;  // opacity (can be single number when static)
}

interface LottieLayer {
  ddd: number;     // 3d
  ind: number;     // index
  ty: number;      // type (4 = shape)
  nm: string;      // name
  sr: number;      // stretch
  ks: LottieTransform;
  ao: number;      // auto-orient
  ip: number;      // in point
  op: number;      // out point
  st: number;      // start time
  bm: number;      // blend mode
  shapes: LottieShape[];
}

interface LottieShape {
  ty: string;
  nm?: string;
  d?: number;
  p?: LottieAnimProp<number[]>;
  s?: LottieAnimProp<number[]>;
  it?: LottieShapeItem[];
  c?: LottieAnimProp<number[]>;
  o?: LottieAnimProp<number[] | number>;
  r?: LottieAnimProp<number>;
  [key: string]: unknown;  // allow additional Lottie properties
}

interface LottieShapeItem {
  ty: string;
  nm?: string;
  c?: LottieAnimProp<number[]>;
  o?: LottieAnimProp<number[] | number>;
  p?: LottieAnimProp<number[]>;
  s?: LottieAnimProp<number[]>;
  r?: number | LottieAnimProp<number>;
  a?: LottieAnimProp<number[]>;
  pt?: LottieAnimProp<number>;
  v?: LottieAnimProp<number[]>;
  [key: string]: unknown;  // allow additional Lottie properties
}

function generateLottieJSON(
  canvasWidth: number,
  canvasHeight: number,
  frameRate: number,
  totalFrames: number,
  parts: ReturnType<typeof useProjectStore.getState>['parts'],
  keyframes: ReturnType<typeof useProjectStore.getState>['keyframes'],
  scale: number,
): Record<string, unknown> {
  const w = canvasWidth * scale;
  const h = canvasHeight * scale;
  const layers: LottieLayer[] = [];

  // Sort parts by zIndex for layer ordering
  const sortedParts = [...parts].sort((a, b) => b.zIndex - a.zIndex);

  for (let i = 0; i < sortedParts.length; i++) {
    const part = sortedParts[i];
    const partKeyframes = keyframes.filter((k) => k.partId === part.id).sort((a, b) => a.frame - b.frame);

    // Build keyframe arrays for each transform property
    const positionKeys: LottieKeyframe[] = [];
    const rotationKeys: LottieKeyframe[] = [];
    const scaleKeys: LottieKeyframe[] = [];
    const opacityKeys: LottieKeyframe[] = [];

    // Default position: centered in canvas
    const defaultX = (canvasWidth / 2) * scale;
    const defaultY = (canvasHeight / 2) * scale;

    if (partKeyframes.length > 0) {
      for (const kf of partKeyframes) {
        let offsetX = 0;
        let offsetY = 0;
        let rotation = 0;
        let scaleX = 100;
        let scaleY = 100;
        let opacity = 100;

        for (const mod of kf.modifiers) {
          if (!mod.enabled) continue;
          switch (mod.type) {
            case 'translate':
              offsetX += (Number(mod.params.offsetX) || 0) * scale;
              offsetY += (Number(mod.params.offsetY) || 0) * scale;
              break;
            case 'rotate':
              rotation += Number(mod.params.angle) || 0;
              break;
            case 'uniform_scale':
              scaleX = (Number(mod.params.scale) || 1) * 100;
              scaleY = scaleX;
              break;
            case 'non_uniform_stretch':
              scaleX = (Number(mod.params.scaleX) || 1) * 100;
              scaleY = (Number(mod.params.scaleY) || 1) * 100;
              break;
          }
        }

        positionKeys.push({
          t: kf.frame,
          s: [defaultX + offsetX, defaultY + offsetY],
          i: { x: 0.4, y: 1 },
          o: { x: 0.2, y: 0 },
        });
        rotationKeys.push({
          t: kf.frame,
          s: [rotation],
          i: { x: 0.4, y: 1 },
          o: { x: 0.2, y: 0 },
        });
        scaleKeys.push({
          t: kf.frame,
          s: [scaleX, scaleY],
          i: { x: 0.4, y: 1 },
          o: { x: 0.2, y: 0 },
        });
        opacityKeys.push({
          t: kf.frame,
          s: [opacity],
          i: { x: 0.4, y: 1 },
          o: { x: 0.2, y: 0 },
        });
      }
    } else {
      // Static position if no keyframes
      positionKeys.push({ t: 0, s: [defaultX, defaultY] });
      rotationKeys.push({ t: 0, s: [0] });
      scaleKeys.push({ t: 0, s: [100, 100] });
      opacityKeys.push({ t: 0, s: [100] });
    }

    // Build the shape group representing the part's pixel art
    // Generate per-pixel rectangles grouped by color for efficiency
    const partW = part.width * scale;
    const partH = part.height * scale;

    const shapes: LottieShape[] = [];

    // Group pixels by color for efficient Lottie representation
    // Each unique color gets one path shape containing all pixel positions
    const colorPixelMap = new Map<string, Array<{ x: number; y: number }>>();
    for (let py = 0; py < part.height; py++) {
      for (let px = 0; px < part.width; px++) {
        const color = part.pixels[py]?.[px];
        if (!color) continue;
        if (!colorPixelMap.has(color)) {
          colorPixelMap.set(color, []);
        }
        colorPixelMap.get(color)!.push({ x: px, y: py });
      }
    }

    // For each color group, create a path shape with all pixel rectangles
    let colorIndex = 0;
    for (const [color, pixels] of colorPixelMap) {
      const r = parseInt(color.slice(1, 3), 16) / 255;
      const g = parseInt(color.slice(3, 5), 16) / 255;
      const b = parseInt(color.slice(5, 7), 16) / 255;

      // Build path vertices for all pixels of this color
      // Each pixel is a 1x1 rect → 4 vertices (closed path)
      // Using Lottie path format: v=vertices, i=in-tangents, o=out-tangents
      const allVertices: number[][] = [];
      const allInTangent: number[][] = [];
      const allOutTangent: number[][] = [];

      for (const { x, y } of pixels) {
        const sx = x * scale;
        const sy = y * scale;
        const s2 = scale;
        // Rectangle as closed path: top-left → top-right → bottom-right → bottom-left
        allVertices.push([sx, sy], [sx + s2, sy], [sx + s2, sy + s2], [sx, sy + s2]);
        allInTangent.push([0, 0], [0, 0], [0, 0], [0, 0]);
        allOutTangent.push([0, 0], [0, 0], [0, 0], [0, 0]);
      }

      // Create path groups — Lottie paths have a practical limit, so we batch
      // every 400 pixels (1600 vertices) per path shape
      const BATCH_SIZE = 400;
      for (let batchStart = 0; batchStart < pixels.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, pixels.length);
        const batchPixels = pixels.slice(batchStart, batchEnd);

        const batchVerts: number[][] = [];
        const batchIn: number[][] = [];
        const batchOut: number[][] = [];

        for (const { x, y } of batchPixels) {
          const sx = x * scale;
          const sy = y * scale;
          const s2 = scale;
          batchVerts.push([sx, sy], [sx + s2, sy], [sx + s2, sy + s2], [sx, sy + s2]);
          batchIn.push([0, 0], [0, 0], [0, 0], [0, 0]);
          batchOut.push([0, 0], [0, 0], [0, 0], [0, 0]);
        }

        // Path shape
        shapes.push({
          ty: 'sh',
          nm: `Pixels_${colorIndex}_b${batchStart}`,
          d: 1,
          ks: {
            a: 0,
            k: {
              i: batchIn,
              o: batchOut,
              v: batchVerts,
              c: true,
            },
          },
        });

        // Fill for this color batch
        shapes.push({
          ty: 'fl',
          nm: `Fill_${colorIndex}_b${batchStart}`,
          c: { a: 0, k: [r, g, b, 1] },
          o: { a: 0, k: 100 },
          r: { a: 0, k: 1 },
        });
      }

      colorIndex++;
    }

    // If no pixels found, fall back to a simple rectangle
    if (shapes.length === 0) {
      shapes.push({
        ty: 'rc',
        nm: part.name,
        d: 1,
        p: { a: 0, k: [0, 0] },
        s: { a: 0, k: [partW, partH] },
        r: { a: 0, k: 0 },
      });
      shapes.push({
        ty: 'fl',
        nm: 'Fill',
        c: { a: 0, k: [1, 1, 1, 1] },
        o: { a: 0, k: 100 },
        r: { a: 0, k: 1 },
      });
    }

    const shapeGroup: LottieShape = {
      ty: 'gr',
      nm: `${part.name} Group`,
      it: [
        ...shapes,
        {
          ty: 'tr',
          p: { a: 0, k: [(-part.pivotX + (part.offsetX || 0)) * scale, (-part.pivotY + (part.offsetY || 0)) * scale] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      ],
    };

    const transform: LottieTransform = {
      a: { a: 0, k: [0, 0] },
      p: positionKeys.length > 1
        ? { a: 1, k: positionKeys }
        : { a: 0, k: positionKeys[0]?.s || [defaultX, defaultY] },
      s: scaleKeys.length > 1
        ? { a: 1, k: scaleKeys }
        : { a: 0, k: scaleKeys[0]?.s || [100, 100] },
      r: rotationKeys.length > 1
        ? { a: 1, k: rotationKeys }
        : { a: 0, k: rotationKeys[0]?.s || [0] },
      o: opacityKeys.length > 1
        ? { a: 1, k: opacityKeys }
        : { a: 0, k: opacityKeys[0]?.s?.[0] ?? 100 },
    };

    layers.push({
      ddd: 0,
      ind: i + 1,
      ty: 4,
      nm: part.name,
      sr: 1,
      ks: transform,
      ao: 0,
      ip: 0,
      op: totalFrames,
      st: 0,
      bm: 0,
      shapes: [shapeGroup],
    });
  }

  return {
    v: '5.7.1',
    fr: frameRate,
    ip: 0,
    op: totalFrames,
    w,
    h,
    nm: 'PixelMorpher Export',
    ddd: 0,
    assets: [],
    layers,
  };
}

// ============================================================
// Helper: Collect puppet node keyframes from animation clips
// ============================================================

/** Collect all puppet node keyframes from puppet animation clips,
 *  matching each character to its clip. */
function collectPuppetNodeKeyframes(
  animationClips: AnimationClip[],
  puppetCharacters: PuppetCharacter[],
): PuppetNodeKeyframe[] {
  const allKeyframes: PuppetNodeKeyframe[] = [];
  for (const character of puppetCharacters) {
    const puppetClip = animationClips.find(
      c => c.isPuppetClip && c.puppetCharacterId === character.id
    );
    if (puppetClip?.puppetNodeKeyframes) {
      allKeyframes.push(...puppetClip.puppetNodeKeyframes);
    }
  }
  return allKeyframes;
}

// ============================================================
// ExportDialog Component
// ============================================================

export default function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  // ---- Store ----
  const {
    parts,
    keyframes,
    canvasWidth,
    canvasHeight,
    totalFrames,
    frameRate,
    backgroundColor,
    motionBlurStrokes,
    effectStrokes,
    effectTracks,
    skeletons,
    proceduralAnimations,
    canvasModifierTracks,
    name: projectName,
    puppetSkeletons,
    puppetCharacters,
    animationClips,
  } = useProjectStore();

  // Filter out puppet sprite parts from the standard render pipeline.
  // Puppet sprites are rendered by the puppet rendering pipeline, not renderFrame.
  // Including them in both would cause double-rendering.
  const puppetSpritePartIds = useMemo(() => {
    const ids = new Set<string>();
    for (const skeleton of puppetSkeletons ?? []) {
      for (const node of skeleton.nodes) {
        if (node.spritePartId) ids.add(node.spritePartId);
        for (const partId of Object.values(node.directionSprites)) {
          if (partId) ids.add(partId);
        }
      }
    }
    for (const character of puppetCharacters ?? []) {
      for (const costumeSet of character.costumeSets) {
        for (const partId of Object.values(costumeSet.spriteMap)) {
          if (partId) ids.add(partId);
        }
      }
    }
    return ids;
  }, [puppetSkeletons, puppetCharacters]);

  const nonPuppetParts = useMemo(() => {
    if (puppetSpritePartIds.size === 0) return parts;
    return parts.filter(p => !puppetSpritePartIds.has(p.id));
  }, [parts, puppetSpritePartIds]);

  // Collect puppet node keyframes from puppet animation clips
  const puppetNodeKeyframes = useMemo(() => {
    return collectPuppetNodeKeyframes(animationClips, puppetCharacters ?? []);
  }, [animationClips, puppetCharacters]);

  // ---- State ----
  const [settings, setSettings] = useState<ExportSettings>(defaultSettings);
  const [activeTab, setActiveTab] = useState<ExportFormat>('spritesheet');
  const [isExporting, setIsExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const aseImportRef = useRef<HTMLInputElement | null>(null);

  // ---- Update settings helper ----
  const updateSetting = useCallback(<K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ---- Generate preview of first frame ----
  useEffect(() => {
    if (!open) return;

    try {
      const bg = settings.backgroundMode === 'transparent' ? 'rgba(0,0,0,0)' : settings.customBgColor;
      const frameCanvas = renderUnifiedToCanvas(
        canvasWidth,
        canvasHeight,
        parts,
        keyframes,
        0,
        bg,
        effectTracks,
        motionBlurStrokes,
        effectStrokes,
        false,
        0.5,
        skeletons,
        proceduralAnimations,
        canvasModifierTracks,
        undefined,
        undefined,
        undefined,
        puppetSkeletons,
        puppetCharacters,
        puppetNodeKeyframes,
        frameRate,
      );

      // Scale for preview
      const previewScale = Math.min(settings.scale, 4);
      const previewW = canvasWidth * previewScale;
      const previewH = canvasHeight * previewScale;

      const preview = document.createElement('canvas');
      preview.width = previewW;
      preview.height = previewH;
      const ctx = preview.getContext('2d')!;

      // Draw checkerboard for transparent bg
      if (settings.backgroundMode === 'transparent') {
        const checkSize = 4;
        for (let y = 0; y < previewH; y += checkSize) {
          for (let x = 0; x < previewW; x += checkSize) {
            ctx.fillStyle = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0
              ? '#2a2a3a'
              : '#1e1e2e';
            ctx.fillRect(x, y, checkSize, checkSize);
          }
        }
      }

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frameCanvas, 0, 0, previewW, previewH);

      setPreviewUrl(preview.toDataURL());
      previewCanvasRef.current = preview;
    } catch {
      setPreviewUrl(null);
    }
  }, [open, settings.scale, settings.backgroundMode, settings.customBgColor, canvasWidth, canvasHeight, parts, keyframes, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations]);

  // ---- Background color for rendering ----
  const getBgColor = useCallback(() => {
    return settings.backgroundMode === 'transparent' ? 'rgba(0,0,0,0)' : settings.customBgColor;
  }, [settings.backgroundMode, settings.customBgColor]);

  // ---- Export: PNG Sequence ----
  const exportPngSequence = useCallback(async () => {
    setIsExporting(true);
    setExportProgress(0);
    try {
      const bgColor = getBgColor();

      for (let frame = 0; frame < totalFrames; frame++) {
        const frameCanvas = renderUnifiedToCanvas(
          canvasWidth,
          canvasHeight,
          parts,
          keyframes,
          frame,
          bgColor,
          effectTracks,
          motionBlurStrokes,
          effectStrokes,
          false,
          0.5,
          skeletons,
          proceduralAnimations,
          canvasModifierTracks,
          undefined,
          undefined,
          undefined,
          puppetSkeletons,
          puppetCharacters,
          puppetNodeKeyframes,
          frameRate,
        );

        // Scale
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = canvasWidth * settings.scale;
        scaledCanvas.height = canvasHeight * settings.scale;
        const ctx = scaledCanvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        if (settings.backgroundMode === 'custom') {
          ctx.fillStyle = settings.customBgColor;
          ctx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
        }

        ctx.drawImage(frameCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

        // Convert to blob and download
        const blob = await new Promise<Blob>((resolve) => {
          scaledCanvas.toBlob((b) => resolve(b!), 'image/png');
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `frame_${String(frame).padStart(4, '0')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportProgress(Math.round(((frame + 1) / totalFrames) * 100));

        // Small delay between downloads
        if (frame < totalFrames - 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    } catch (err) {
      console.error('PNG export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      onOpenChange(false);
    }
  }, [canvasWidth, canvasHeight, parts, keyframes, totalFrames, settings, getBgColor, onOpenChange, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations]);

  // ---- Export: Spritesheet ----
  const exportSpritesheet = useCallback(async () => {
    setIsExporting(true);
    setExportProgress(0);
    try {
      const bgColor = getBgColor();
      const scaledW = canvasWidth * settings.scale;
      const scaledH = canvasHeight * settings.scale;
      const padding = settings.sheetPadding * settings.scale;

      const isHorizontal = settings.sheetDirection === 'horizontal';
      const cols = settings.sheetColumns;
      const rows = Math.ceil(totalFrames / cols);

      const sheetW = isHorizontal
        ? cols * scaledW + (cols + 1) * padding
        : rows * scaledW + (rows + 1) * padding;
      const sheetH = isHorizontal
        ? rows * scaledH + (rows + 1) * padding
        : cols * scaledH + (cols + 1) * padding;

      const sheetCanvas = document.createElement('canvas');
      sheetCanvas.width = sheetW;
      sheetCanvas.height = sheetH;
      const ctx = sheetCanvas.getContext('2d')!;

      // Fill background
      if (settings.backgroundMode === 'custom') {
        ctx.fillStyle = settings.customBgColor;
        ctx.fillRect(0, 0, sheetW, sheetH);
      }

      ctx.imageSmoothingEnabled = false;

      for (let frame = 0; frame < totalFrames; frame++) {
        const frameCanvas = renderUnifiedToCanvas(
          canvasWidth,
          canvasHeight,
          parts,
          keyframes,
          frame,
          bgColor,
          effectTracks,
          motionBlurStrokes,
          effectStrokes,
          false,
          0.5,
          skeletons,
          proceduralAnimations,
          canvasModifierTracks,
          undefined,
          undefined,
          undefined,
          puppetSkeletons,
          puppetCharacters,
          puppetNodeKeyframes,
          frameRate,
        );

        let col: number;
        let row: number;

        if (isHorizontal) {
          col = frame % cols;
          row = Math.floor(frame / cols);
        } else {
          col = Math.floor(frame / cols);
          row = frame % cols;
        }

        const destX = padding + col * (scaledW + padding);
        const destY = padding + row * (scaledH + padding);

        ctx.drawImage(frameCanvas, destX, destY, scaledW, scaledH);
        setExportProgress(Math.round(((frame + 1) / totalFrames) * 100));
      }

      // Download
      const blob = await new Promise<Blob>((resolve) => {
        sheetCanvas.toBlob((b) => resolve(b!), 'image/png');
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spritesheet.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Spritesheet export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      onOpenChange(false);
    }
  }, [canvasWidth, canvasHeight, parts, keyframes, totalFrames, settings, getBgColor, onOpenChange, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations]);

  // ---- Export: GIF (using gif.js encoder) ----
  const exportGif = useCallback(async () => {
    setIsExporting(true);
    setExportProgress(0);
    try {
      const bgColor = getBgColor();
      const scaledW = canvasWidth * settings.scale;
      const scaledH = canvasHeight * settings.scale;
      const delay = settings.gifFrameDelay || Math.round(1000 / frameRate);
      const loopCount = settings.gifLoopCount;

      const gif = new GIF({
        workers: 2,
        quality: settings.gifQuality,
        width: scaledW,
        height: scaledH,
        workerScript: '/gif.worker.js',
        repeat: loopCount === 0 ? 0 : loopCount,
      });

      // Render and add each frame
      for (let frame = 0; frame < totalFrames; frame++) {
        const frameCanvas = renderUnifiedToCanvas(
          canvasWidth,
          canvasHeight,
          parts,
          keyframes,
          frame,
          bgColor,
          effectTracks,
          motionBlurStrokes,
          effectStrokes,
          false,
          0.5,
          skeletons,
          proceduralAnimations,
          canvasModifierTracks,
          undefined,
          undefined,
          undefined,
          puppetSkeletons,
          puppetCharacters,
          puppetNodeKeyframes,
          frameRate,
        );

        const offscreen = document.createElement('canvas');
        offscreen.width = scaledW;
        offscreen.height = scaledH;
        const offCtx = offscreen.getContext('2d')!;
        offCtx.imageSmoothingEnabled = false;

        if (settings.backgroundMode === 'custom') {
          offCtx.fillStyle = settings.customBgColor;
          offCtx.fillRect(0, 0, scaledW, scaledH);
        }

        offCtx.drawImage(frameCanvas, 0, 0, scaledW, scaledH);

        gif.addFrame(offCtx, { copy: true, delay });
      }

      // Render GIF and download
      gif.on('progress', (p: number) => {
        setExportProgress(Math.round(p * 100));
      });

      gif.on('finished', (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName}.gif`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsExporting(false);
        setExportProgress(0);
        onOpenChange(false);
      });

      gif.render();
    } catch (err) {
      console.error('GIF export failed:', err);
      setIsExporting(false);
      setExportProgress(0);
      onOpenChange(false);
    }
  }, [canvasWidth, canvasHeight, parts, keyframes, totalFrames, settings, getBgColor, onOpenChange, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations, frameRate, projectName]);

  // ---- Export: Video (V2.0) ----
  const exportVideo = useCallback(async () => {
    setIsExporting(true);
    setExportProgress(0);
    try {
      const bgColor = getBgColor();
      const scale = settings.scale;
      const frameRateVal = frameRate;
      const quality = settings.videoQuality;

      const offscreen = document.createElement('canvas');
      offscreen.width = canvasWidth * scale;
      offscreen.height = canvasHeight * scale;
      const offCtx = offscreen.getContext('2d')!;

      // Determine supported MIME type
      const desiredMimeType = settings.videoFormat === 'mp4'
        ? 'video/mp4'
        : 'video/webm;codecs=vp9';
      const fallbackMimeType = 'video/webm;codecs=vp8';
      const basicWebm = 'video/webm';

      let mimeType = desiredMimeType;
      if (typeof MediaRecorder === 'undefined') {
        alert('MediaRecorder API is not supported in this browser. Cannot export video.');
        setIsExporting(false);
        setExportProgress(0);
        return;
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = fallbackMimeType;
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = basicWebm;
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            alert('No supported video format found in this browser. Please try a different browser.');
            setIsExporting(false);
            setExportProgress(0);
            return;
          }
        }
      }

      const stream = offscreen.captureStream(frameRateVal);
      const videoBitsPerSecond = quality * 100000;
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recorderStopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      recorder.start();

      // Render each frame
      for (let frame = 0; frame < totalFrames; frame++) {
        offCtx.clearRect(0, 0, offscreen.width, offscreen.height);

        // Fill background if custom
        if (settings.backgroundMode === 'custom') {
          offCtx.fillStyle = settings.customBgColor;
          offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
        }

        const frameCanvas = renderUnifiedToCanvas(
          canvasWidth,
          canvasHeight,
          parts,
          keyframes,
          frame,
          bgColor,
          effectTracks,
          motionBlurStrokes,
          effectStrokes,
          false,
          0.5,
          skeletons,
          proceduralAnimations,
          canvasModifierTracks,
          undefined,
          undefined,
          undefined,
          puppetSkeletons,
          puppetCharacters,
          puppetNodeKeyframes,
          frameRate,
        );

        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(frameCanvas, 0, 0, offscreen.width, offscreen.height);

        setExportProgress(Math.round(((frame + 1) / totalFrames) * 100));

        // Wait for next frame timing
        await new Promise((r) => setTimeout(r, 1000 / frameRateVal));
      }

      recorder.stop();
      await recorderStopped;

      // Create downloadable blob
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${projectName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Video export failed:', err);
      alert('Video export failed. Your browser may not support the MediaRecorder API.');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      onOpenChange(false);
    }
  }, [canvasWidth, canvasHeight, parts, keyframes, totalFrames, frameRate, settings, getBgColor, onOpenChange, motionBlurStrokes, effectStrokes, effectTracks, skeletons, proceduralAnimations, projectName]);

  // ---- Export: Lottie (V2.0) ----
  const exportLottie = useCallback(async () => {
    setIsExporting(true);
    setExportProgress(0);
    try {
      const scale = settings.lottieScale;
      const lottieJSON = generateLottieJSON(
        canvasWidth,
        canvasHeight,
        frameRate,
        totalFrames,
        nonPuppetParts,
        keyframes,
        scale,
      );

      setExportProgress(50);

      const jsonString = JSON.stringify(lottieJSON, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportProgress(100);
    } catch (err) {
      console.error('Lottie export failed:', err);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      onOpenChange(false);
    }
  }, [canvasWidth, canvasHeight, frameRate, totalFrames, parts, keyframes, settings.lottieScale, onOpenChange, projectName]);

  // ---- Export: Project File (V2.0) ----
  const exportProjectFile = useCallback(() => {
    try {
      const projectFile = useProjectStore.getState().exportProjectFile();
      const jsonString = JSON.stringify(projectFile, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}.pxm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Project export failed:', err);
    }
    onOpenChange(false);
  }, [onOpenChange, projectName]);

  // ---- Import: Project File (V2.0) ----
  const handleImportProjectFile = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        useProjectStore.getState().importProjectFile(data);
      } catch (err) {
        console.error('Project import failed:', err);
        alert('Failed to import project file. Please ensure it is a valid .pxm file.');
      }
    };
    reader.readAsText(file);

    // Reset the input so the same file can be re-imported
    e.target.value = '';
    onOpenChange(false);
  }, [onOpenChange]);

  // ---- Handle export button click ----
  const handleExport = useCallback(() => {
    switch (activeTab) {
      case 'png':
        exportPngSequence();
        break;
      case 'spritesheet':
        exportSpritesheet();
        break;
      case 'gif':
        exportGif();
        break;
      case 'video':
        exportVideo();
        break;
      case 'lottie':
        exportLottie();
        break;
      case 'project':
        exportProjectFile();
        break;
    }
  }, [activeTab, exportPngSequence, exportSpritesheet, exportGif, exportVideo, exportLottie, exportProjectFile]);

  // ---- Get export button label ----
  const getExportLabel = useCallback(() => {
    if (isExporting) return 'Exporting...';
    switch (activeTab) {
      case 'spritesheet': return 'Export Spritesheet';
      case 'png': return 'Export PNGs';
      case 'gif': return 'Export GIF';
      case 'video': return 'Export Video';
      case 'lottie': return 'Export Lottie';
      case 'project': return 'Export Project';
    }
  }, [activeTab, isExporting]);

  // ---- Reset settings when dialog closes ----
  useEffect(() => {
    if (!open) {
      setSettings(defaultSettings);
      setPreviewUrl(null);
      setExportProgress(0);
    }
  }, [open]);

  // ---- Scale select component ----
  const ScaleSelect = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-gray-400">Scale</Label>
      <Select
        value={String(value)}
        onValueChange={(v) => onChange(parseInt(v, 10))}
      >
        <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-gray-300">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a2e] border-white/10">
          <SelectItem value="1">1x ({canvasWidth}×{canvasHeight})</SelectItem>
          <SelectItem value="2">2x ({canvasWidth * 2}×{canvasHeight * 2})</SelectItem>
          <SelectItem value="4">4x ({canvasWidth * 4}×{canvasHeight * 4})</SelectItem>
          <SelectItem value="8">8x ({canvasWidth * 8}×{canvasHeight * 8})</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-100 flex items-center gap-2">
            <Download className="size-4 text-emerald-400" />
            Export Animation
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-sm">
            Export your animation in various formats.
            {totalFrames} frames at {frameRate} FPS ({canvasWidth}×{canvasHeight})
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ExportFormat)} className="w-full">
          <TabsList className="w-full bg-white/5 flex flex-wrap h-auto gap-0.5 p-1">
            <TabsTrigger value="spritesheet" className="flex-1 min-w-[70px] gap-1 text-[10px] sm:text-xs data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300 px-1.5 py-1.5">
              <LayoutGrid className="size-3" />
              <span className="hidden sm:inline">Spritesheet</span>
              <span className="sm:hidden">Sheet</span>
            </TabsTrigger>
            <TabsTrigger value="png" className="flex-1 min-w-[70px] gap-1 text-[10px] sm:text-xs data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300 px-1.5 py-1.5">
              <ImageIcon className="size-3" />
              PNG
            </TabsTrigger>
            <TabsTrigger value="gif" className="flex-1 min-w-[70px] gap-1 text-[10px] sm:text-xs data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300 px-1.5 py-1.5">
              <Film className="size-3" />
              GIF
            </TabsTrigger>
            <TabsTrigger value="video" className="flex-1 min-w-[70px] gap-1 text-[10px] sm:text-xs data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300 px-1.5 py-1.5">
              <Video className="size-3" />
              视频
            </TabsTrigger>
            <TabsTrigger value="lottie" className="flex-1 min-w-[70px] gap-1 text-[10px] sm:text-xs data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300 px-1.5 py-1.5">
              <FileJson className="size-3" />
              Lottie
            </TabsTrigger>
            <TabsTrigger value="project" className="flex-1 min-w-[70px] gap-1 text-[10px] sm:text-xs data-[state=active]:bg-purple-600/30 data-[state=active]:text-purple-300 px-1.5 py-1.5">
              <Package className="size-3" />
              工程
            </TabsTrigger>
          </TabsList>

          {/* ---- Spritesheet Tab ---- */}
          <TabsContent value="spritesheet" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <ScaleSelect value={settings.scale} onChange={(v) => updateSetting('scale', v)} />

              {/* Columns */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Columns</Label>
                <Input
                  type="number"
                  min={1}
                  max={64}
                  value={settings.sheetColumns}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) updateSetting('sheetColumns', Math.max(1, Math.min(64, val)));
                  }}
                  className="h-8 text-xs bg-white/5 border-white/10 text-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>

              {/* Direction */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Direction</Label>
                <Select
                  value={settings.sheetDirection}
                  onValueChange={(v) => updateSetting('sheetDirection', v as SpritesheetDirection)}
                >
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    <SelectItem value="horizontal">Horizontal</SelectItem>
                    <SelectItem value="vertical">Vertical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Padding */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Padding (px)</Label>
                <Input
                  type="number"
                  min={0}
                  max={32}
                  value={settings.sheetPadding}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) updateSetting('sheetPadding', Math.max(0, Math.min(32, val)));
                  }}
                  className="h-8 text-xs bg-white/5 border-white/10 text-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            {/* Spritesheet info */}
            <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-2.5">
              <span className="font-medium text-gray-400">Output:</span>{' '}
              {canvasWidth * settings.scale}×{canvasHeight * settings.scale} per frame,{' '}
              {settings.sheetColumns} columns × {Math.ceil(totalFrames / settings.sheetColumns)} rows ={' '}
              {totalFrames} frames
            </div>
          </TabsContent>

          {/* ---- PNG Sequence Tab ---- */}
          <TabsContent value="png" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <ScaleSelect value={settings.scale} onChange={(v) => updateSetting('scale', v)} />
            </div>

            {/* PNG info */}
            <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-2.5">
              <span className="font-medium text-gray-400">Output:</span>{' '}
              {totalFrames} PNG files at {canvasWidth * settings.scale}×{canvasHeight * settings.scale}px each
            </div>
          </TabsContent>

          {/* ---- GIF Tab ---- */}
          <TabsContent value="gif" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <ScaleSelect value={settings.scale} onChange={(v) => updateSetting('scale', v)} />

              {/* Quality */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">
                  Quality <span className="text-gray-600 ml-1">{settings.gifQuality} ({settings.gifQuality <= 5 ? 'best' : settings.gifQuality <= 10 ? 'good' : settings.gifQuality <= 15 ? 'decent' : 'fast'})</span>
                </Label>
                <Slider
                  value={[settings.gifQuality]}
                  onValueChange={([v]) => updateSetting('gifQuality', v)}
                  min={1}
                  max={20}
                  step={1}
                  className="py-1"
                />
                <span className="text-[10px] text-gray-600">1 = best (slowest), 20 = fastest (lowest)</span>
              </div>

              {/* Loop count */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Loop Count</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.gifLoopCount}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) updateSetting('gifLoopCount', Math.max(0, Math.min(100, val)));
                  }}
                  className="h-8 text-xs bg-white/5 border-white/10 text-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[10px] text-gray-600">0 = infinite loop</span>
              </div>

              {/* Frame delay */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Frame Delay (ms)</Label>
                <Input
                  type="number"
                  min={16}
                  max={1000}
                  value={settings.gifFrameDelay}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) updateSetting('gifFrameDelay', Math.max(16, Math.min(1000, val)));
                  }}
                  className="h-8 text-xs bg-white/5 border-white/10 text-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[10px] text-gray-600">
                  ~{Math.round(1000 / frameRate)}ms at {frameRate} FPS
                </span>
              </div>
            </div>

            {/* GIF info */}
            <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-2.5">
              <span className="font-medium text-gray-400">Output:</span>{' '}
              {canvasWidth * settings.scale}×{canvasHeight * settings.scale}px,{' '}
              {totalFrames} frames, {settings.gifFrameDelay || Math.round(1000 / frameRate)}ms delay
            </div>
          </TabsContent>

          {/* ---- Video Tab (V2.0) ---- */}
          <TabsContent value="video" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              {/* Video Format */}
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Format</Label>
                <Select
                  value={settings.videoFormat}
                  onValueChange={(v) => updateSetting('videoFormat', v as VideoFormat)}
                >
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    <SelectItem value="webm">WebM (VP9)</SelectItem>
                    <SelectItem value="mp4">MP4</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Scale */}
              <ScaleSelect value={settings.scale} onChange={(v) => updateSetting('scale', v)} />
            </div>

            {/* Frame Rate display */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Frame Rate</Label>
              <div className="text-xs text-gray-300 bg-white/5 border border-white/10 rounded-md h-8 flex items-center px-3">
                {frameRate} FPS (from project settings)
              </div>
            </div>

            {/* Quality slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-400">
                  Quality {settings.videoFormat === 'mp4' ? '(CRF)' : '(Bitrate)'}
                </Label>
                <span className="text-xs text-gray-500 font-mono">
                  {settings.videoFormat === 'mp4'
                    ? `CRF ${Math.round(51 - (settings.videoQuality / 100) * 51)}`
                    : `${settings.videoQuality}%`
                  }
                </span>
              </div>
              <Slider
                value={[settings.videoQuality]}
                min={1}
                max={100}
                step={1}
                onValueChange={(v) => updateSetting('videoQuality', v[0])}
                className="py-1"
              />
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            {/* Video info */}
            <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-2.5">
              <span className="font-medium text-gray-400">Output:</span>{' '}
              {canvasWidth * settings.scale}×{canvasHeight * settings.scale}px,{' '}
              {totalFrames} frames at {frameRate} FPS ={' '}
              {totalFrames > 0 ? (totalFrames / frameRate).toFixed(1) : 0}s,{' '}
              {settings.videoFormat === 'mp4' ? 'MP4 (H.264)' : 'WebM (VP9)'}
            </div>

            {/* Browser compatibility note */}
            <div className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5">
              Video export uses the MediaRecorder API. WebM is widely supported; MP4 may not work in all browsers.
              If MP4 fails, the exporter will fall back to WebM automatically.
            </div>
          </TabsContent>

          {/* ---- Lottie Tab (V2.0) ---- */}
          <TabsContent value="lottie" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <ScaleSelect value={settings.lottieScale} onChange={(v) => updateSetting('lottieScale', v)} />
            </div>

            {/* Lottie info */}
            <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-2.5">
              <span className="font-medium text-gray-400">Output:</span>{' '}
              Lottie JSON ({canvasWidth * settings.lottieScale}×{canvasHeight * settings.lottieScale}px),{' '}
              {parts.length} layers, {totalFrames} frames at {frameRate} FPS
            </div>

            {/* Lottie note */}
            <div className="text-xs text-blue-400/80 bg-blue-500/10 border border-blue-500/20 rounded-md p-2.5">
              Lottie export creates shape layers for each part with keyframe animations.
              Pixel-level detail is represented as rectangles. For pixel-perfect rendering,
              use PNG/Spritesheet export instead. The .json file can be used with
              <a href="https://lottiefiles.com/" target="_blank" rel="noopener noreferrer" className="underline ml-1">LottieFiles</a> players.
            </div>
          </TabsContent>

          {/* ---- Project Tab (V2.0) ---- */}
          <TabsContent value="project" className="space-y-4 mt-4">
            {/* Export project */}
            <div className="space-y-3">
              <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-3 space-y-1">
                <div className="font-medium text-gray-400">Export Project File (.pxm)</div>
                <div>Save the complete project including all parts, keyframes, skeletons, and procedural animations.</div>
                <div className="text-[10px] text-gray-600 mt-1">
                  {parts.length} parts · {keyframes.length} keyframes · {skeletons.length} skeletons · {proceduralAnimations.length} procedural anims
                </div>
              </div>
              <Button
                onClick={exportProjectFile}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                disabled={isExporting}
              >
                <Download className="size-3.5" />
                Export .pxm File
              </Button>
            </div>

            <Separator className="bg-white/10" />

            {/* Import project */}
            <div className="space-y-3">
              <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-3 space-y-1">
                <div className="font-medium text-gray-400">Import Project File (.pxm)</div>
                <div>Load a previously saved project. This will replace the current project.</div>
              </div>
              <Button
                onClick={handleImportProjectFile}
                variant="outline"
                className="w-full border-white/20 text-gray-300 hover:bg-white/10 hover:text-white gap-2"
                disabled={isExporting}
              >
                <Upload className="size-3.5" />
                Import .pxm File
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".pxm,.json"
                className="hidden"
                onChange={handleImportFileChange}
              />
            </div>

            <Separator className="bg-white/10" />

            {/* Import Aseprite (.ase) file */}
            <div className="space-y-3">
              <div className="text-xs text-gray-500 bg-white/[0.03] rounded-md p-3 space-y-1">
                <div className="font-medium text-gray-400">Import Aseprite (.ase)</div>
                <div>Import an Aseprite file. Each frame will be added as a separate part, or as keyframes for the selected part.</div>
              </div>
              <input
                ref={aseImportRef}
                type="file"
                accept=".ase"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const buffer = await file.arrayBuffer();
                    const frames = await parseAsepriteFile(buffer);
                    if (frames.length === 0) {
                      alert('No frames found in Aseprite file.');
                      return;
                    }
                    const store = useProjectStore.getState();
                    // Import each frame as a separate part
                    for (let i = 0; i < frames.length; i++) {
                      const frame = frames[i];
                      const part = store.addPart(
                        `${file.name}_frame${i + 1}`,
                        frame.pixels[0]?.length || 1,
                        frame.pixels.length || 1,
                      );
                      store.setPartPixels(part.id, frame.pixels);
                    }
                    onOpenChange(false);
                  } catch (err) {
                    console.error('Aseprite import failed:', err);
                    alert('Failed to import Aseprite file. Ensure it is a valid .ase file.');
                  }
                  e.target.value = '';
                }}
              />
              <Button
                onClick={() => aseImportRef.current?.click()}
                variant="outline"
                className="w-full border-white/20 text-gray-300 hover:bg-white/10 hover:text-white gap-2"
                disabled={isExporting}
              >
                <FileUp className="size-3.5" />
                Import .ase File
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="bg-white/10" />

        {/* ---- Common: Background ---- */}
        {activeTab !== 'project' && (
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Background</Label>
            <div className="flex items-center gap-3">
              <Select
                value={settings.backgroundMode}
                onValueChange={(v) => updateSetting('backgroundMode', v as BackgroundMode)}
              >
                <SelectTrigger className="h-8 w-32 text-xs bg-white/5 border-white/10 text-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/10">
                  <SelectItem value="transparent">Transparent</SelectItem>
                  <SelectItem value="custom">Custom Color</SelectItem>
                </SelectContent>
              </Select>

              {settings.backgroundMode === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={settings.customBgColor}
                    onChange={(e) => updateSetting('customBgColor', e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border border-white/15 bg-transparent p-0"
                  />
                  <span className="text-xs text-gray-500 font-mono">{settings.customBgColor}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- Preview ---- */}
        {activeTab !== 'project' && (
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Preview (Frame 1)</Label>
            <div className="flex items-center justify-center bg-black/20 rounded-md p-3 border border-white/5 min-h-[80px]">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Frame 1 preview"
                  className="max-w-full max-h-[120px] object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <span className="text-xs text-gray-600">No preview available</span>
              )}
            </div>
          </div>
        )}

        {/* ---- Progress Bar (visible during video export) ---- */}
        {isExporting && (activeTab === 'video' || activeTab === 'png' || activeTab === 'gif' || activeTab === 'spritesheet') && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Exporting...</span>
              <span>{exportProgress}%</span>
            </div>
            <Progress value={exportProgress} className="h-1.5 bg-white/10" />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-gray-200 hover:bg-white/5"
            disabled={isExporting}
          >
            Cancel
          </Button>
          {activeTab !== 'project' && (
            <Button
              onClick={handleExport}
              disabled={isExporting || totalFrames === 0}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
            >
              <Download className="size-3.5" />
              {getExportLabel()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
