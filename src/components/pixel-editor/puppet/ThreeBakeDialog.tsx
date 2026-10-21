'use client';
import { unzipSync } from 'fflate';

// ============================================================
// PixelMorpher - three.js 按骨骼烘焙 → 导入 Character
// 主流程 C：ID 缓冲双遍渲染 → 2D 按 bone 拆分 → 导入为角色
// 备选 A：单肢体独立重烘（拆下竖直，手指可握拳）→ 替换
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BakeResult } from '@/lib/bake/threejs-baker';
import { FULL_ANGLE_LATITUDES } from '@/lib/bake/threejs-baker';
import {
  bakeModelTwoPass,
  bakeSingleBone,
  previewHandCurl,
  inspectFingers,
  parseModelBones,
  computeBoneMerge,
  computeTopologyMerge,
  type TwoPassBakeData,
  type BakedBoneInfo,
  type FingerDetectResult,
  type ParsedBoneInfo,
  type BoneMergeInfo,
  type BoneGranularity,
} from '@/lib/bake/threejs-baker-twopass';
import {
  splitByBoneId,
  splitSixParts,
  mapBonesToNodes,
  rgbaToGrid,
  alignLimbToRest,
  scaleGridNearest,
  cropGridToContent,
  type ProcessedBone,
  type ProcessedBoneDirection,
} from '@/lib/bake/skeleton-mapper';
import {
  bakeManualParts,
  listManualMeshes,
  groupManualMeshesBySubtree,
  groupManualMeshesByNamePrefix,
  resolveManualParentIndices,
  type ManualCatalog,
  type ManualPartSpec,
  type ManualPivotSpec,
} from '@/lib/bake/threejs-baker-manual';

/** 手动拆分的部件草稿（对话框编辑态） */
interface ManualPartDraft {
  id: number;
  name: string;
  meshIndices: number[];
  pivot: ManualPivotSpec;
}
import type { PixelGrid, DirectionIndex } from '@/lib/unified-types';
import { pxToSub } from '@/lib/unified-types';
import { useProjectStore } from '@/lib/store';
import { Vec3Field } from '../shared/Vec3Field';
import BonePicker3D from './BonePicker3D';
import ManualPickPanel from './ManualPickPanel';
import {
  bakeSixParts,
  ALL_PARTS,
  PART_LABEL,
  parseModelTopology,
  type SixPartBakeData,
  type PartName,
} from '@/lib/bake/threejs-baker-sixpart';
import type { TopologyResult } from '@/lib/bake/bone-topology';

const SAMPLE_URL = 'https://threejs.org/examples/models/gltf/Xbot.glb';

interface ThreeBakeDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 显示 BakeResult（RGBA） */
function ResultCanvas({ result, size = 128, markers }: { result: BakeResult; size?: number; markers?: { x: number; y: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const copy = new Uint8ClampedArray(result.pixels.length);
    copy.set(result.pixels);
    const img = new ImageData(copy, result.width, result.height);
    const tmp = document.createElement('canvas');
    tmp.width = result.width;
    tmp.height = result.height;
    tmp.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    // 标出关节位置：红色十字（与 PixelGridCanvas 的 plug 标记同样式）
    if (markers && markers.length > 0) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#ff0000';
      for (const m of markers) {
        ctx.beginPath();
        ctx.moveTo(m.x - 4, m.y);
        ctx.lineTo(m.x + 4, m.y);
        ctx.moveTo(m.x, m.y - 4);
        ctx.lineTo(m.x, m.y + 4);
        ctx.stroke();
        // 中心点
        ctx.fillRect(m.x - 1, m.y - 1, 2, 2);
      }
    }
  }, [result, markers]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className="border border-[#2a2a4a] bg-[repeating-conic-gradient(#1a1a2e_0%_25%,#141428_0%_50%)] bg-[size:16px_16px]"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

/** 显示 PixelGrid */
function PixelGridCanvas({ grid, scale = 3, plugX, plugY }: { grid: PixelGrid; scale?: number; plugX?: number; plugY?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const h = grid.length;
    const w = grid[0]?.length ?? 0;
    canvas.width = Math.max(1, w * scale);
    canvas.height = Math.max(1, h * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y]?.[x];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    // 标出 plug（关节）位置：红色十字
    if (plugX !== undefined && plugY !== undefined) {
      const px = plugX * scale;
      const py = plugY * scale;
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 4, py);
      ctx.lineTo(px + 4, py);
      ctx.moveTo(px, py - 4);
      ctx.lineTo(px, py + 4);
      ctx.stroke();
      // 中心点
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }, [grid, scale, plugX, plugY]);
  return (
    <canvas
      ref={ref}
      className="border border-[#2a2a4a] bg-[repeating-conic-gradient(#1a1a2e_0%_25%,#141428_0%_50%)] bg-[size:12px_12px]"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function statusLabel(s: FingerDetectResult['fingerStatus']): string {
  return s === 'auto' ? '自动' : s === 'manual' ? '手动' : '缺失';
}

// ---- 单肢体重烘面板 ----

interface RebakePanelProps {
  bone: BakedBoneInfo;
  input: string | ArrayBuffer;
  pmxTextures?: Map<string, Blob>;
  pmxFlavor?: boolean;
  size: number;
  paletteSize: number;
  onClose: () => void;
  onDone: (boneIndex: number, boneName: string, results: BakeResult[]) => void;
}

function RebakePanel({ bone, input, pmxTextures, pmxFlavor, size, paletteSize, onClose, onDone }: RebakePanelProps) {
  const [fingerCurl, setFingerCurl] = useState(70); // 0~100
  const [detect, setDetect] = useState<FingerDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [manualThumb, setManualThumb] = useState<string | null>(null);
  const [manualFingers, setManualFingers] = useState<string[] | null>(null);
  const [pickMode, setPickMode] = useState<'thumb' | 'finger' | null>(null);
  const [pickedBone, setPickedBone] = useState<string | null>(null);
  const [preview, setPreview] = useState<BakeResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rebaking, setRebaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 手指检测（自动 > 手动 > 缺失）
  useEffect(() => {
    let cancelled = false;
    setDetecting(true);
    setError(null);
    inspectFingers(input, {
      thumbBoneName: manualThumb ?? undefined,
      fingerBoneNames: manualFingers ?? undefined,
      pmxTextures,
    })
      .then((d) => {
        if (!cancelled) {
          setDetect(d);
          setDetecting(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setDetecting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [input, manualThumb, manualFingers]);

  // 手部特写预览（滑杆 debounce）
  useEffect(() => {
    if (!detect) return;
    if (detect.fingers.length === 0 && !detect.thumb) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const pv = await previewHandCurl(input, {
          pmxTextures,
          usePmxNpr: pmxFlavor,
          fingerCurl: fingerCurl / 100,
          thumbBoneName: manualThumb ?? undefined,
          fingerBoneNames: manualFingers ?? undefined,
          paletteSize,
        });
        setPreview(pv);
      } catch (e) {
        console.error('[previewHandCurl]', e);
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [detect, fingerCurl, manualThumb, manualFingers, input, paletteSize]);

  const handleConfirmPick = useCallback(() => {
    if (!pickedBone) return;
    if (pickMode === 'thumb') {
      setManualThumb(pickedBone);
    } else if (pickMode === 'finger') {
      setManualFingers((prev) => [...(prev ?? []), pickedBone]);
    }
    setPickedBone(null);
    setPickMode(null);
  }, [pickedBone, pickMode]);

  const handleRebake = useCallback(async () => {
    setRebaking(true);
    setError(null);
    try {
      const results = await bakeSingleBone(input, bone.name, {
        pmxTextures,
        usePmxNpr: pmxFlavor,
        size,
        paletteSize,
        fingerCurl: fingerCurl / 100,
        thumbBoneName: manualThumb ?? undefined,
        fingerBoneNames: manualFingers ?? undefined,
      });
      onDone(bone.index, bone.name, results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRebaking(false);
    }
  }, [input, bone, size, paletteSize, fingerCurl, manualThumb, manualFingers, onDone]);

  const hasHand = !!detect
    && (detect.fingers.length > 0 || !!detect.thumb)
    // 只对手臂 limb 显示：inspectFingers 扫的是整模，重烘腿时也会检出手指
    && /arm|hand|wrist/i.test(bone.name);

  return (
    <div className="mb-3 rounded border border-amber-900/60 bg-amber-950/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-bold text-amber-200">
          单独重烘：{bone.name}
          <span className="ml-2 font-normal text-gray-500">（拆下竖直，8 方向）</span>
        </div>
        <button onClick={onClose} className="text-[11px] text-gray-500 hover:text-gray-200">
          ← 返回
        </button>
      </div>

      {error && (
        <div className="mb-2 rounded border border-red-900 bg-red-950/50 p-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {/* 手指状态 */}
      <div className="mb-2 text-[11px] text-gray-400">
        {detecting && '检测手指 bones 中…'}
        {!detecting && detect && (
          <>
            手指：{detect.fingers.length} 根（{statusLabel(detect.fingerStatus)}）
            {' · '}拇指：
            {detect.thumb ? `${detect.thumb.label}（${statusLabel(detect.thumbStatus)}）` : '缺失'}
          </>
        )}
      </div>

      {hasHand && (
        <div className="mb-2 flex items-start gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] text-gray-400">
              手指卷曲：{fingerCurl}%
              <span className="ml-1 text-gray-600">（0=保持原样，100=完全握拳）</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={fingerCurl}
              onChange={(e) => setFingerCurl(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="mt-1 text-[10px] text-gray-600">
              角度按关节：MCP 90° / PIP 100° / DIP 70°；拇指对掌拧转 + 轻微弯曲，再 × 卷曲系数
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            {previewLoading && <div className="text-[10px] text-gray-500">预览渲染中…</div>}
            {!previewLoading && preview && (
              <>
                <ResultCanvas result={preview} size={96} />
                <div className="text-[10px] text-gray-500">手部特写（前视）</div>
              </>
            )}
            {!previewLoading && !preview && (
              <div className="text-[10px] text-gray-600">无手部预览</div>
            )}
          </div>
        </div>
      )}

      {/* 手动指定 */}
      {!detecting && detect && (detect.thumbStatus === 'missing' || detect.fingerStatus === 'missing') && (
        <div className="mb-2 flex items-center gap-2 text-[11px]">
          <span className="text-gray-500">自动匹配失败：</span>
          {detect.thumbStatus === 'missing' && !manualThumb && (
            <button
              onClick={() => { setPickMode('thumb'); setPickedBone(null); }}
              className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-gray-300 hover:bg-[#222240]"
            >
              点击模型指定拇指
            </button>
          )}
          {detect.fingerStatus === 'missing' && (
            <button
              onClick={() => { setPickMode('finger'); setPickedBone(null); }}
              className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-gray-300 hover:bg-[#222240]"
            >
              点击模型指定手指
            </button>
          )}
        </div>
      )}
      {manualThumb && (
        <div className="mb-1 text-[11px] text-gray-400">
          已手动指定拇指：<span className="text-amber-300">{manualThumb}</span>
          <button onClick={() => setManualThumb(null)} className="ml-2 text-gray-600 hover:text-gray-300">清除</button>
        </div>
      )}
      {manualFingers && manualFingers.length > 0 && (
        <div className="mb-1 text-[11px] text-gray-400">
          已手动指定手指：<span className="text-amber-300">{manualFingers.join(', ')}</span>
          <button onClick={() => setManualFingers(null)} className="ml-2 text-gray-600 hover:text-gray-300">清除</button>
        </div>
      )}

      {/* 3D 拾取 */}
      {pickMode && (
        <div className="mb-2 flex items-start gap-3 rounded border border-[#2a2a4a] p-2">
          <BonePicker3D input={input} onPick={setPickedBone} highlightBone={pickedBone} />
          <div className="flex flex-col gap-2 text-[11px]">
            <div className="text-gray-400">
              {pickMode === 'thumb' ? '点击模型上的拇指' : '点击模型上的一根手指'}
            </div>
            {pickedBone && (
              <div className="text-gray-300">
                命中：<span className="font-bold text-red-400">{pickedBone}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleConfirmPick}
                disabled={!pickedBone}
                className="h-6 rounded bg-amber-700 px-3 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                确认
              </button>
              <button
                onClick={() => { setPickMode(null); setPickedBone(null); }}
                className="h-6 rounded border border-[#3a3a5a] px-3 text-gray-400 hover:bg-[#222240]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleRebake}
        disabled={rebaking}
        className="h-7 rounded bg-amber-700 px-4 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {rebaking ? '重烘中…' : '开始重烘（8 方向）'}
      </button>
    </div>
  );
}

// ---- 骨骼合并面板 ----

interface BoneMergePanelProps {
  input: string | ArrayBuffer;
  pmxTextures?: Map<string, Blob>;
  granularity: BoneGranularity;
  smallBoneThreshold?: number;
  onMergesChange: (merges: Map<number, number>, unmerges: Set<number>) => void;
  onBake: () => void;
  baking: boolean;
}

/**
 * 烘焙前手动调整 bone 合并。
 * 流程：解析骨骼 → 显示树（自动合并预览）→ 用户手动合并/取消 → 烘焙时传入。
 */
function BoneMergePanel({ input, pmxTextures, granularity, smallBoneThreshold = 50, onMergesChange, onBake, baking }: BoneMergePanelProps) {
  const [bones, setBones] = useState<ParsedBoneInfo[] | null>(null);
  const [topology, setTopology] = useState<TopologyResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [manualMerges, setManualMerges] = useState<Map<number, number>>(new Map());
  const [manualUnmerges, setManualUnmerges] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(true);

  const handleParse = useCallback(async () => {
    setParsing(true);
    setParseError(null);
    try {
      const inp = typeof input === 'string' ? input.trim() : input;
      if (!inp || (typeof inp === 'string' && inp.length === 0)) {
        throw new Error('请先选择文件或填写 URL');
      }
      const parsed = await parseModelBones(inp, pmxTextures);
      setBones(parsed);
      // 拓扑分析（不依赖骨骼名）
      try {
        const topo = await parseModelTopology(inp, pmxTextures);
        setTopology(topo.topology);
      } catch {
        setTopology(null);
      }
      setManualMerges(new Map());
      setManualUnmerges(new Set());
      setSelected(new Set());
      onMergesChange(new Map(), new Set());
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, [input, onMergesChange]);

  // 自动合并预览（拓扑驱动，失败时回退名字匹配；随手动覆盖实时重算）
  const mergeInfo: BoneMergeInfo | null = bones
    ? topology && topology.cross !== null
      ? computeTopologyMerge(
          topology,
          bones.map((b) => b.name),
          bones.map((b) => b.parentIndex),
          manualMerges,
          manualUnmerges,
        )
      : computeBoneMerge(
          bones.map((b) => b.name),
          bones.map((b) => b.parentIndex),
          bones.map((b) => b.vertexCount),
          granularity,
          smallBoneThreshold,
          manualMerges,
          manualUnmerges,
        )
    : null;

  const updateMerges = useCallback(
    (merges: Map<number, number>, unmerges: Set<number>) => {
      setManualMerges(merges);
      setManualUnmerges(unmerges);
      onMergesChange(merges, unmerges);
    },
    [onMergesChange],
  );

  const toggleSelect = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  /** 单个 bone：从父节点拆分（强制独立，子树跟随） */
  const handleSplitOne = useCallback((idx: number) => {
    if (!bones) return;
    const merges = new Map(manualMerges);
    const unmerges = new Set(manualUnmerges);
    merges.delete(idx);
    unmerges.add(idx);
    updateMerges(merges, unmerges);
  }, [bones, manualMerges, manualUnmerges, updateMerges]);

  /** 批量拆分选中 */
  const handleSplitSelected = useCallback(() => {
    if (!bones || selected.size === 0) return;
    const merges = new Map(manualMerges);
    const unmerges = new Set(manualUnmerges);
    for (const src of selected) {
      merges.delete(src);
      unmerges.add(src);
    }
    updateMerges(merges, unmerges);
    setSelected(new Set());
  }, [bones, selected, manualMerges, manualUnmerges, updateMerges]);

  /** 清除手动取消（恢复自动规则） */
  const handleClearUnmerge = useCallback(() => {
    if (selected.size === 0) return;
    const unmerges = new Set(manualUnmerges);
    for (const src of selected) unmerges.delete(src);
    updateMerges(new Map(manualMerges), unmerges);
    setSelected(new Set());
  }, [selected, manualMerges, manualUnmerges, updateMerges]);

  if (!bones) {
    return (
      <div className="mb-3 rounded border border-[#2a2a4a] bg-[#12122a] p-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleParse}
            disabled={parsing}
            className="h-7 rounded border border-[#3a3a5a] bg-[#1a1a30] px-3 text-[11px] text-gray-300 hover:bg-[#222240] disabled:opacity-50"
          >
            {parsing ? '解析中…' : '解析骨骼（手动合并）'}
          </button>
          <span className="text-[11px] text-gray-600">
            烘焙前可手动拆分 bone（拓扑自动合并已预应用，默认只拆主关节）
          </span>
        </div>
        {parseError && <div className="mt-1 text-[11px] text-red-400">{parseError}</div>}
      </div>
    );
  }

  // 建树
  const childrenMap = new Map<number, number[]>();
  const roots: number[] = [];
  for (const b of bones) {
    if (b.parentIndex === null || b.parentIndex === undefined) roots.push(b.index);
    else {
      const arr = childrenMap.get(b.parentIndex) ?? [];
      arr.push(b.index);
      childrenMap.set(b.parentIndex, arr);
    }
  }

  const renderRow = (idx: number, depth: number): React.ReactNode => {
    const b = bones[idx];
    const eff = mergeInfo!.effectiveIndex[idx];
    const isMerged = eff !== idx;
    const isManual = manualMerges.has(idx);
    const isUnmerged = manualUnmerges.has(idx);
    const reason = mergeInfo!.reasons[idx];
    return (
      <div key={idx}>
        <div
          className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-[#1a1a30] ${
            selected.has(idx) ? 'bg-[#1e2a4a]' : ''
          }`}
          onClick={() => toggleSelect(idx)}
        >
          <input
            type="checkbox"
            checked={selected.has(idx)}
            onChange={() => toggleSelect(idx)}
            onClick={(e) => e.stopPropagation()}
            className="h-3 w-3"
          />
          <span style={{ paddingLeft: depth * 12 }} className="truncate text-gray-300">
            {b.name || `bone_${idx}`}
          </span>
          <span className="shrink-0 text-gray-600">{b.vertexCount} 顶点</span>
          {isMerged ? (
            <>
              <span
                className={`shrink-0 rounded px-1 ${isManual ? 'bg-purple-900 text-purple-200' : 'bg-[#2a2a4a] text-gray-400'}`}
                title={reason ?? ''}
              >
                → {bones[eff]?.name ?? eff}{isManual ? ' (手动)' : ''}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleSplitOne(idx); }}
                className="shrink-0 rounded border border-amber-800 bg-amber-950 px-1 text-[10px] text-amber-200 hover:bg-amber-900"
                title="从父节点拆分，使其独立（子树跟随）"
              >
                拆分
              </button>
            </>
          ) : (
            <span className={`shrink-0 rounded px-1 ${isUnmerged ? 'bg-amber-900 text-amber-200' : 'bg-green-950 text-green-400'}`}>
              {isUnmerged ? '独立 (手动拆分)' : '独立'}
            </span>
          )}
        </div>
        {(childrenMap.get(idx) ?? []).map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  const effectiveCount = mergeInfo ? new Set(mergeInfo.effectiveIndex).size : 0;

  return (
    <div className="mb-3 rounded border border-[#2a2a4a] bg-[#12122a] p-2">
      <div className="mb-1 flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] font-bold text-gray-300"
        >
          {expanded ? '▼' : '▶'} 骨骼合并/拆分
        </button>
        <span className="text-[11px] text-gray-500">
          {bones.length} bones → {effectiveCount} 有效
          {manualMerges.size > 0 && <span className="text-purple-400">（手动 {manualMerges.size}）</span>}
          {manualUnmerges.size > 0 && <span className="text-amber-400">（取消 {manualUnmerges.size}）</span>}
        </span>
        <button
          onClick={handleParse}
          className="ml-auto h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-400 hover:bg-[#222240]"
        >
          重新解析
        </button>
      </div>
      {topology && (
        <div className="mb-1 rounded bg-[#0d0d1f] px-2 py-1 text-[10px] text-gray-500">
          拓扑：十字
          <span className="text-cyan-400">{topology.cross !== null ? bones[topology.cross]?.name ?? topology.cross : '未找到'}</span>
          {' / '}髋部
          <span className="text-cyan-400">{topology.hipFork !== null ? bones[topology.hipFork]?.name ?? topology.hipFork : '未找到'}</span>
          {' / '}手掌
          <span className="text-cyan-400">
            {topology.handL !== null ? bones[topology.handL]?.name ?? topology.handL : '无'}({topology.fingersL.length}指)
            {' / '}
            {topology.handR !== null ? bones[topology.handR]?.name ?? topology.handR : '无'}({topology.fingersR.length}指)
          </span>
          {topology.props.length > 0 && (
            <span> / 道具<span className="text-amber-400">{topology.props.length}</span></span>
          )}
        </div>
      )}
      {expanded && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <button
              onClick={handleSplitSelected}
              disabled={selected.size === 0}
              className="h-6 rounded border border-amber-800 bg-amber-950 px-2 text-[10px] text-amber-200 hover:bg-amber-900 disabled:opacity-40"
              title="批量拆分选中 bone（从父节点脱离，子树跟随）"
            >
              拆分选中 ({selected.size})
            </button>
            <button
              onClick={handleClearUnmerge}
              disabled={selected.size === 0}
              className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-400 hover:bg-[#222240] disabled:opacity-40"
              title="清除手动拆分，恢复自动合并"
            >
              恢复自动
            </button>
            <span className="text-[10px] text-gray-600">
              每行"拆分"可单独拆分；点选行或复选框多选后批量操作
            </span>
            <button
              onClick={onBake}
              disabled={baking}
              className="ml-auto h-6 rounded bg-cyan-700 px-3 text-[10px] font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
              title="用当前合并设置烘焙（模型已缓存，不重复下载）"
            >
              {baking ? '烘焙中…' : '应用合并并烘焙'}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded border border-[#1a1a30] bg-[#0d0d1f] p-1">
            {roots.map((r) => renderRow(r, 0))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- 主对话框 ----

export default function ThreeBakeDialog({ open, onClose }: ThreeBakeDialogProps) {
  const [url, setUrl] = useState(SAMPLE_URL);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  // URL 下载缓存：改合并设置后重烘不重复下载
  const urlCache = useRef<{ url: string; data: ArrayBuffer } | null>(null);
  // 上次烘焙结果（用于合并变化时只重渲 ID）
  const lastBakeRef = useRef<{ key: string; data: TwoPassBakeData } | null>(null);
  const [size, setSize] = useState(64);
  const [paletteSize, setPaletteSize] = useState(16);
  const [granularity, setGranularity] = useState<'coarse' | 'fine'>('coarse');
  /** 烘焙模式：twopass=整模 ID 双遍（16 遍），sixpart=六部件（96 遍） */
  const [bakeMode, setBakeMode] = useState<'twopass' | 'sixpart' | 'manual'>('sixpart');
  // 全角度模式：额外 ±45°（各 8 方向）与 ±90°（各 1 个朝向）纬度的整套精灵
  const [fullAngle, setFullAngle] = useState(false);
  // PMX 导入：zip 解包的贴图文件表 + 原味着色开关（参考版 NPR，默认关）
  const pmxTexturesRef = useRef<Map<string, Blob> | null>(null);
  const [isMmd, setIsMmd] = useState(false);
  const [pmxFlavor, setPmxFlavor] = useState(false);
  // 手动拆分（按网格）：网格清单 + 部件草稿（多网格可合并为一个部件，枢轴可调）
  const [manualCatalog, setManualCatalog] = useState<ManualCatalog | null>(null);
  const [manualParts, setManualParts] = useState<ManualPartDraft[]>([]);
  const [selectedMeshes, setSelectedMeshes] = useState<Set<number>>(new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [manualListLoading, setManualListLoading] = useState(false);
  const manualPartSeq = useRef(1);

  const [baking, setBaking] = useState(false);
  const [progress, setProgress] = useState('');
  const [twoPass, setTwoPass] = useState<TwoPassBakeData | null>(null);
  const [sixPart, setSixPart] = useState<SixPartBakeData | null>(null);
  const [processed, setProcessed] = useState<Map<number, ProcessedBone> | null>(null);
  const [showIds, setShowIds] = useState(false);
  const [totalMs, setTotalMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [rebakeTarget, setRebakeTarget] = useState<BakedBoneInfo | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // 点击肢体预览弹出的骨骼（显示8方向）
  const [popupBone, setPopupBone] = useState<ProcessedBone | null>(null);
  // 上次导入的角色ID（用于手动替换服装）
  const [lastImportedCharId, setLastImportedCharId] = useState<string | null>(null);

  // 手动 bone 合并（烘焙前调整）
  const [manualMerges, setManualMerges] = useState<Map<number, number>>(new Map());
  const [manualUnmerges, setManualUnmerges] = useState<Set<number>>(new Set());
  const handleMergesChange = useCallback((merges: Map<number, number>, unmerges: Set<number>) => {
    setManualMerges(merges);
    setManualUnmerges(unmerges);
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  const input: string | ArrayBuffer = fileData ?? url.trim();

  const handleFile = useCallback((f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setFileData(null);
    setTwoPass(null);
    setSixPart(null);
    setProcessed(null);
    setError(null);
    setImportMsg(null);
    setManualMerges(new Map());
    setManualUnmerges(new Set());
    setManualCatalog(null);
    setManualParts([]);
    pmxTexturesRef.current = null;
    setIsMmd(false);
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      if (/\.zip$/i.test(f.name)) {
        // zip 包导入：整模型文件夹打包——找 .pmx，其余条目作贴图文件表
        try {
          const files = unzipSync(new Uint8Array(buf));
          const pmxPath = Object.keys(files).find((k) => /\.(pmx|pmd)$/i.test(k));
          if (!pmxPath) {
            setError('zip 中没有 .pmx / .pmd 文件');
            return;
          }
          const tex = new Map<string, Blob>();
          for (const [path, bytes] of Object.entries(files)) {
            if (path !== pmxPath) tex.set(path, new Blob([bytes as BlobPart]));
          }
          pmxTexturesRef.current = tex;
          setIsMmd(true);
          setFileData(files[pmxPath].slice().buffer as ArrayBuffer);
        } catch (e) {
          setError(e instanceof Error ? `zip 解压失败：${e.message}` : 'zip 解压失败');
        }
        return;
      }
      if (/\.(pmx|pmd)$/i.test(f.name)) setIsMmd(true);
      setFileData(buf);
    };
    reader.onerror = () => setError('文件读取失败');
    reader.readAsArrayBuffer(f);
  }, []);


  /** 输入解析：文件直接用；URL 走缓存，避免重复下载 */
  const resolveInput = useCallback(async (): Promise<string | ArrayBuffer> => {
    if (fileData) {
      urlCache.current = null; // 切到文件时清 URL 缓存
      return fileData;
    }
    const u = url.trim();
    if (!u) throw new Error('请先选择文件或填写 URL');
    if (urlCache.current && urlCache.current.url === u) {
      return urlCache.current.data;
    }
    const resp = await fetch(u);
    if (!resp.ok) throw new Error(`下载失败: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    urlCache.current = { url: u, data: buf };
    return buf;
  }, [fileData, url]);

  const handleBake = useCallback(async () => {
    setBaking(true);
    setError(null);
    setTwoPass(null);
    setSixPart(null);
    setProcessed(null);
    setImportMsg(null);
    setRebakeTarget(null);
    try {
      const inp = await resolveInput();
      setProgress('加载模型…');
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      // 合并变化时只重渲 ID：颜色与合并无关，复用上次的颜色省一半时间
      // 判定条件：有上次结果 && 同模型 && 同尺寸
      const bakeKey = `${fileData ? 'file:' + fileName : 'url:' + url.trim()}|${size}`;
      const canReuseColors = lastBakeRef.current
        && lastBakeRef.current.key === bakeKey
        && lastBakeRef.current.data.width === size;
      const data = await bakeModelTwoPass(inp, {
        size,
        granularity,
        manualMerges,
        manualUnmerges,
        pmxTextures: pmxTexturesRef.current ?? undefined,
        usePmxNpr: pmxFlavor,
        extraLatitudes: fullAngle ? [...FULL_ANGLE_LATITUDES] : undefined,
        onProgress: (done, total) => setProgress(`${done}/${total} 遍`),
        ...(canReuseColors ? { idOnly: true, reuseBake: lastBakeRef.current!.data } : {}),
      });
      lastBakeRef.current = { key: bakeKey, data };
      setTotalMs(performance.now() - t0);
      setProgress('按 bone 拆分…');
      await new Promise((r) => setTimeout(r, 30));
      const proc = splitByBoneId(data, { paletteSize });
      setTwoPass(data);
      setProcessed(proc);
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress('');
    } finally {
      setBaking(false);
    }
  }, [fileData, url, size, paletteSize, granularity, manualMerges, manualUnmerges, fullAngle, pmxFlavor]);

  /** 六部件烘焙：6 部件 × 8 方向 ×（颜色+ID）= 96 遍 */
  const handleBakeSixPart = useCallback(async () => {
    setBaking(true);
    setError(null);
    setSixPart(null);
    setTwoPass(null);
    setProcessed(null);
    setImportMsg(null);
    setRebakeTarget(null);
    try {
      const inp = await resolveInput();
      setProgress('加载模型…');
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      const data = await bakeSixParts(inp, {
        size,
        granularity,
        manualMerges,
        manualUnmerges,
        pmxTextures: pmxTexturesRef.current ?? undefined,
        usePmxNpr: pmxFlavor,
        extraLatitudes: fullAngle ? [...FULL_ANGLE_LATITUDES] : undefined,
        onProgress: (done, total, label) => setProgress(`${done}/${total} 遍 · ${label}`),
      });
      setTotalMs(performance.now() - t0);
      setProgress('按部件拆分…');
      await new Promise((r) => setTimeout(r, 30));
      const proc = splitSixParts(data, { paletteSize });
      setSixPart(data);
      setProcessed(proc);
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress('');
    } finally {
      setBaking(false);
    }
  }, [fileData, url, size, paletteSize, granularity, manualMerges, manualUnmerges, fullAngle, pmxFlavor]);

  /** 读取网格清单（手动模式） */
  /** 分组草案 → 部件草稿（名称消重，枢轴默认首网格原点） */
  const draftsFromGroups = useCallback((groups: { name: string; meshIndices: number[] }[]): ManualPartDraft[] => {
    const used = new Set<string>();
    return groups.map((g) => {
      let n = g.name;
      let k = 2;
      while (used.has(n)) n = `${g.name}_${k++}`;
      used.add(n);
      return {
        id: manualPartSeq.current++,
        name: n,
        meshIndices: [...g.meshIndices],
        pivot: { mode: 'mesh', meshIndex: g.meshIndices[0] } as ManualPivotSpec,
      };
    });
  }, []);

  /** 一键分组（甲）：按子树 / 按名称前缀 / 逐网格；已有手工划分时先确认 */
  const applyManualGrouping = useCallback(
    (mode: 'subtree' | 'prefix' | 'perMesh') => {
      if (!manualCatalog) return;
      const dirty = manualParts.some((d) => d.meshIndices.length !== 1 || d.pivot.mode !== 'mesh');
      if (dirty && !window.confirm('重新分组将覆盖当前的部件划分与枢轴设置，继续？')) return;
      const groups =
        mode === 'subtree'
          ? groupManualMeshesBySubtree(manualCatalog.meshes)
          : mode === 'prefix'
            ? groupManualMeshesByNamePrefix(manualCatalog.meshes)
            : manualCatalog.meshes.map((m) => ({ name: m.name, meshIndices: [m.meshIndex] }));
      setManualParts(draftsFromGroups(groups));
      setSelectedMeshes(new Set());
    },
    [manualCatalog, manualParts, draftsFromGroups],
  );

  /** 把一组网格分配给目标部件（'' = 不包含，'__new' = 新建，数字 = 部件 id）；单行与批量共用 */
  const assignMeshes = useCallback(
    (meshIndices: number[], target: string) => {
      if (meshIndices.length === 0) return;
      const moving = new Set(meshIndices);
      setManualParts((prev) => {
        let next = prev.map((p) => {
          if (!p.meshIndices.some((mi) => moving.has(mi))) return p;
          const rest = p.meshIndices.filter((x) => !moving.has(x));
          let pivot = p.pivot;
          if (pivot.mode === 'mesh' && moving.has(pivot.meshIndex) && rest.length > 0) {
            pivot = { mode: 'mesh', meshIndex: rest[0] } as ManualPivotSpec;
          }
          return { ...p, meshIndices: rest, pivot };
        });
        if (target === '__new') {
          const first = meshIndices[0];
          next = [
            ...next,
            {
              id: manualPartSeq.current++,
              name: manualCatalog?.meshes[first]?.name ?? '部件',
              meshIndices: [...meshIndices],
              pivot: { mode: 'mesh', meshIndex: first } as ManualPivotSpec,
            },
          ];
        } else if (target !== '') {
          const tid = Number(target);
          next = next.map((p) =>
            p.id === tid ? { ...p, meshIndices: [...p.meshIndices, ...meshIndices] } : p,
          );
        }
        return next;
      });
    },
    [manualCatalog],
  );

  /** 新建空部件（之后用网格行的下拉或批量分配往里放网格） */
  const addManualPart = useCallback(() => {
    const id = manualPartSeq.current++;
    setManualParts((prev) => [
      ...prev,
      { id, name: `部件 ${id}`, meshIndices: [], pivot: { mode: 'center' } as ManualPivotSpec },
    ]);
  }, []);

  const loadManualCatalog = useCallback(async () => {
    setManualListLoading(true);
    try {
      const inp = await resolveInput();
      const cat = await listManualMeshes(inp, pmxTexturesRef.current ?? undefined);
      setManualCatalog(cat);
      setManualParts(draftsFromGroups(cat.meshes.map((m) => ({ name: m.name, meshIndices: [m.meshIndex] }))));
      setSelectedMeshes(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setManualListLoading(false);
    }
  }, [resolveInput]);

  // 切到手动模式 / 换文件时自动读取网格清单（URL 改动走「重新读取」按钮）
  useEffect(() => {
    if (bakeMode === 'manual' && fileData) {
      void loadManualCatalog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakeMode, fileData]);

  /** 手动拆分烘焙：勾选网格 → 每网格一部件 8 方向 → processed（与骨骼流同构） */
  const handleBakeManual = useCallback(async () => {
    if (!manualCatalog) return;
    setBaking(true);
    setError(null);
    setTwoPass(null);
    setSixPart(null);
    setProcessed(null);
    setImportMsg(null);
    setRebakeTarget(null);
    try {
      const specs: ManualPartSpec[] = manualParts
        .filter((d) => d.meshIndices.length > 0)
        .map((d) => ({
          name: d.name.trim() || manualCatalog.meshes[d.meshIndices[0]]?.name || '部件',
          meshIndices: d.meshIndices,
          pivot: d.pivot,
        }));
      if (specs.length === 0) throw new Error('至少把一个网格分配给部件');
      setProgress('加载模型…');
      await new Promise((r) => setTimeout(r, 30));
      const inp = await resolveInput();
      const t0 = performance.now();
      const proc = await bakeManualParts(inp, specs, {
        size,
        paletteSize,
        pmxTextures: pmxTexturesRef.current ?? undefined,
        usePmxNpr: pmxFlavor,
        extraLatitudes: fullAngle ? [...FULL_ANGLE_LATITUDES] : undefined,
        onProgress: (done, total) => setProgress(`${done}/${total} 遍`),
      });
      setTotalMs(performance.now() - t0);
      setProcessed(proc);
      setProgress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress('');
    } finally {
      setBaking(false);
    }
  }, [manualCatalog, manualParts, resolveInput, size, paletteSize, fullAngle, pmxFlavor]);

  /** 按当前模式分发烘焙 */
  const handleBakeDispatch = useCallback(() => {
    if (bakeMode === 'sixpart') handleBakeSixPart();
    else if (bakeMode === 'manual') handleBakeManual();
    else handleBake();
  }, [bakeMode, handleBakeSixPart, handleBake, handleBakeManual]);

  const handleRebakeDone = useCallback(
    (boneIndex: number, boneName: string, results: BakeResult[]) => {
      setProcessed((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        const pb = next.get(boneIndex);
        if (!pb) return prev;
        const parentPb = pb.parentIndex !== null ? next.get(pb.parentIndex) : undefined;
        const dirs: ProcessedBoneDirection[] = results.map((r) => {
          const orig = pb.directions.find((d) => d.direction === r.direction);
          let grid = rgbaToGrid(r.pixels, r.width, r.height);
          // 关节在重烘帧正中（相机恒对准关节取景）
          let jx = r.width / 2;
          let jy = r.height / 2;
          // 竖直重烘图 → 对齐到原始姿态（最近 90° 无损旋转，绕图中心，关节仍在中心）
          if (orig && parentPb) {
            const pOrig = parentPb.directions.find((d) => d.direction === r.direction);
            if (pOrig) {
              grid = alignLimbToRest(grid, orig.jointX - pOrig.jointX, orig.jointY - pOrig.jointY);
            }
          }
          // 像素密度对齐：精灵尺寸全由像素数决定，重烘帧必须先重采样到原图密度。
          // 新帧密度 = r.width / (2·cameraHalfGlobal)（px/归一化单位）。
          // 六部件原图在 split 时已归一化到全局像素空间，其处理后密度
          // = worldToPixels（世界→原帧像素密度）× orig.cameraHalf（原帧→处理后缩放），
          // 旧公式 s = cameraHalfGlobal / orig.cameraHalf 把已归一化的密度又除了一遍
          // orig.cameraHalf（手臂部件 ≈0.47），结果放大 ≈2.1 倍——拳头偏大的根因。
          // 双遍原图 cameraHalf 恒为 1 且未经该归一化，沿用旧比值，行为不变。
          if (orig && r.cameraHalfGlobal) {
            let s: number;
            if (orig.globalCameraHalf !== undefined) {
              const wMain = pb.worldToPixels && orig.cameraHalf > 0
                ? pb.worldToPixels * 2 * orig.cameraHalf
                : r.width;
              s = (r.cameraHalfGlobal * wMain) / r.width;
            } else {
              s = orig.cameraHalf > 0 ? r.cameraHalfGlobal / orig.cameraHalf : 1;
            }
            if (Math.abs(s - 1) > 0.01) {
              grid = scaleGridNearest(grid, s);
              jx *= s;
              jy *= s;
            }
          }
          // 紧包围盒裁剪（与主烘焙同口径：内容 + 2px）
          const cropped = cropGridToContent(grid, 2);
          grid = cropped.grid;
          jx -= cropped.cropX;
          jy -= cropped.cropY;
          const w = grid[0]?.length ?? r.width;
          const h = grid.length;
          return {
            direction: r.direction as DirectionIndex,
            grid,
            width: w,
            height: h,
            cropX: 0,
            cropY: 0,
            // 关节几何不变：保留原始全帧坐标（socket 计算用）
            jointX: orig?.jointX ?? r.width / 2,
            jointY: orig?.jointY ?? r.height / 2,
            plugX: jx,
            plugY: jy,
            // 像素密度已对齐到原图，尺度声明随之恢复与原图一致；global 保留原图的
            cameraHalf: orig?.cameraHalf ?? r.cameraHalfGlobal ?? 1,
            globalCameraHalf: orig?.globalCameraHalf,
          };
        });
        next.set(boneIndex, { ...pb, directions: dirs });
        return next;
      });
      setRebakeTarget(null);
      setImportMsg(`已替换 ${boneName} 的 8 方向图（已对齐原始姿态）`);
    },
    [],
  );

  const handleImport = useCallback(() => {
    if (!processed || processed.size === 0) return;
    try {
      const store = useProjectStore.getState();
      const base = fileName ? fileName.replace(/\.(glb|gltf|pmx|zip)$/i, '') : 'baked';
      const name = `烘焙_${base}`;
      store.pushUndo('导入烘焙角色');
      // 分辨率超出项目画布尺寸时自动放大画布（直接 setState，合并进同一次 undo）
      let enlargeNote = '';
      const needW = Math.max(store.canvasWidth, size);
      const needH = Math.max(store.canvasHeight, size);
      if (needW > store.canvasWidth || needH > store.canvasHeight) {
        useProjectStore.setState({ canvasWidth: needW, canvasHeight: needH });
        enlargeNote = `；分辨率 ${size} 超出项目尺寸，已自动放大画布为 ${needW}×${needH}`;
      }
      const char = store.addUnifiedCharacter(name, { skipPlaceholderRoot: true });
      const mapped = mapBonesToNodes(processed, char.id, name);
      // 一次写入：节点树 + 服装集（不中途回读，见 AGENTS.md 快照坑）
      store.updateUnifiedCharacter(char.id, {
        nodes: mapped.character.nodes,
        rootNodeId: mapped.character.rootNodeId,
        costumeSets: mapped.character.costumeSets,
        activeCostumeSetId: mapped.character.activeCostumeSetId,
      });
      // 精灵批量入库（单次 setState，合并进同一次 undo）
      useProjectStore.setState((s) => ({
        sprites: { ...s.sprites, ...mapped.sprites },
      }));
      setLastImportedCharId(char.id);
      setImportMsg(
        `已创建角色 ${name}，含 ${mapped.stats.nodes} 个节点，${mapped.stats.sprites} 张精灵${enlargeNote}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [processed, fileName, size]);

  // 手动替换服装：用预览的某方向精灵替换已导入角色的对应精灵
  const handleReplaceSprite = useCallback((
    boneIndex: number,
    boneName: string,
    dir: ProcessedBoneDirection,
  ) => {
    if (!lastImportedCharId) {
      setError('请先导入角色，再手动替换服装');
      return;
    }
    const spriteId = `spr_${lastImportedCharId}_${boneIndex}_${dir.direction}`;
    const exists = useProjectStore.getState().sprites[spriteId];
    if (!exists) {
      setError(`未找到精灵 ${spriteId}，请确认已导入`);
      return;
    }
    useProjectStore.setState((s) => ({
      sprites: {
        ...s.sprites,
        [spriteId]: {
          ...s.sprites[spriteId],
          width: dir.width,
          height: dir.height,
          data: dir.grid,
          plug: { x: pxToSub(dir.plugX), y: pxToSub(dir.plugY) },
        },
      },
    }));
    setImportMsg(`已替换 ${boneName} d${dir.direction}`);
  }, [lastImportedCharId]);

  if (!open) return null;

  // 8 方向总览缩略图
  const dirThumbs: BakeResult[] | null =
    twoPass == null
      ? null
      : ([0, 1, 2, 3, 4, 5, 6, 7] as const).map((d) => {
          const g = twoPass.groups.find((x) => x.direction === d && x.pass === 0)!;
          return {
            direction: d,
            pixels: showIds ? g.idPixels : g.colorPixels,
            width: twoPass.width,
            height: twoPass.height,
            colorCount: 0,
            elapsedMs: 0,
          };
        });

  /** 六部件模式：部件 → 8 方向缩略图 */
  const sixPartThumbs: { part: PartName; thumbs: BakeResult[] }[] | null =
    sixPart == null
      ? null
      : ALL_PARTS.filter((p) => sixPart.groups.some((g) => g.part === p)).map((p) => ({
          part: p,
          thumbs: ([0, 1, 2, 3, 4, 5, 6, 7] as const).map((d) => {
            const g = sixPart.groups.find((x) => x.part === p && x.direction === d)!;
            return {
              direction: d,
              pixels: (showIds ? g.idPixels : undefined) ?? g.colorPixels,
              width: sixPart.width,
              height: sixPart.height,
              colorCount: 0,
              elapsedMs: 0,
            };
          }),
        }));

  /** 当前模式的 bones（重烘按钮用） */
  const curBones = bakeMode === 'sixpart' ? sixPart?.bones : bakeMode === 'twopass' ? twoPass?.bones : undefined;

  const boneList = processed ? [...processed.values()].sort((a, b) => a.boneIndex - b.boneIndex) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-[860px] overflow-y-auto rounded-lg border border-[#2a2a4a] bg-[#12122a] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-200">
            3D 烘焙 <span className="font-normal text-gray-500">（{bakeMode === 'sixpart' ? '六部件 → 块内 ID 拆分' : bakeMode === 'manual' ? '手动拆分（按网格）' : 'ID 双遍 → 拆分'} → 导入角色）</span>
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200">✕</button>
        </div>

        {/* 输入 */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="h-7 shrink-0 rounded border border-[#3a3a5a] bg-[#1a1a30] px-3 text-[11px] text-gray-300 hover:bg-[#222240]"
            >
              选择 .glb/.gltf
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".glb,.gltf,.vrm,.pmx,.pmd,.zip"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <span className="truncate text-[11px] text-gray-500">
              {fileName ?? '或使用下方 URL（默认 Xbot）'}
            </span>
          </div>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setFileName(null); setFileData(null); }}
            placeholder="https://…/model.glb"
            className="h-7 w-full rounded border border-[#2a2a4a] bg-[#0d0d1f] px-2 text-[11px] text-gray-300"
          />
          <div className="flex items-center gap-4 text-[11px] text-gray-400">
            <label className="flex items-center gap-1">
              分辨率
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-6 rounded border border-[#2a2a4a] bg-[#0d0d1f] px-1 text-gray-300"
              >
                <option value={32}>32</option>
                <option value={64}>64</option>
                <option value={128}>128</option>
                <option value={256}>256</option>
                <option value={512}>512</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              调色板
              <select
                value={paletteSize}
                onChange={(e) => setPaletteSize(Number(e.target.value))}
                className="h-6 rounded border border-[#2a2a4a] bg-[#0d0d1f] px-1 text-gray-300"
              >
                <option value={8}>8 色</option>
                <option value={16}>16 色</option>
                <option value={32}>32 色</option>
              </select>
            </label>
            <label className="flex items-center gap-1" title="整模 ID 双遍：16 遍，整模一次渲染；六部件：96 遍，6 块独立渲染无遮挡">
              烘焙模式
              <select
                value={bakeMode}
                onChange={(e) => setBakeMode(e.target.value as 'twopass' | 'sixpart' | 'manual')}
                className="h-6 rounded border border-[#2a2a4a] bg-[#0d0d1f] px-1 text-gray-300"
              >
                <option value="sixpart">六部件（96 遍）</option>
                <option value="twopass">整模 ID 双遍（16 遍）</option>
                <option value="manual">手动拆分（按网格）</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-1" title="额外渲染 ±45°（各 8 方向）与 ±90°（各 1 个朝向，正上方/正下方）的整套精灵，导入后按角色纬度自动选用；渲染遍数约 ×3.3">
              <input type="checkbox" checked={fullAngle} onChange={(e) => setFullAngle(e.target.checked)} />
              全角度（±45°/±90°）
            </label>
            {isMmd && (
              <label className="flex cursor-pointer items-center gap-1" title="开：颜色遍用参考版 NPR 着色——材质按名称分类（脸/发/肌/眼/衣/金属等）套 toon ramp + rim 预设；关：全走管线统一 toon 转换（共享 gradientMap，与 GLB 同一口径）">
                <input type="checkbox" checked={pmxFlavor} onChange={(e) => setPmxFlavor(e.target.checked)} />
                MMD 原味着色
              </label>
            )}
            {bakeMode !== 'manual' && (
            <label className="flex items-center gap-1" title="粗：手指/脚趾/小骨骼合并，约15个节点；细：一个骨骼一个节点（调试用）">
              拆分粒度
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as 'coarse' | 'fine')}
                className="h-6 rounded border border-[#2a2a4a] bg-[#0d0d1f] px-1 text-gray-300"
              >
                <option value="coarse">粗（合并）</option>
                <option value="fine">细（调试）</option>
              </select>
            </label>
            )}
            <button
              onClick={handleBakeDispatch}
              disabled={baking}
              className="h-7 rounded bg-cyan-700 px-4 text-[11px] font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {baking ? '烘焙中…' : bakeMode === 'sixpart' ? '六部件烘焙' : bakeMode === 'manual' ? '手动拆分烘焙' : '按骨骼烘焙'}
            </button>
            {bakeMode === 'sixpart' && sixPart && (
              <button
                onClick={() => {
                  const t0 = performance.now();
                  const proc = splitSixParts(sixPart, { paletteSize });
                  setProcessed(proc);
                  setTotalMs(performance.now() - t0);
                  setImportMsg(`2D 重拆完成（${proc.size} 骨骼），未重跑 3D`);
                }}
                className="h-7 rounded border border-cyan-700 px-3 text-[11px] text-cyan-300 hover:bg-cyan-900 disabled:opacity-50"
                title="对已有 sixPart 数据重跑 splitSixParts，不跑 96 遍 3D"
              >
                重新拆分 2D
              </button>
            )}
            {progress && <span className="text-cyan-400">{progress}</span>}
            <span className="text-gray-600">
              {bakeMode === 'sixpart'
                ? '6 部件 × 8 方向 ×（颜色+ID）= 96 遍，分块独立渲染无遮挡'
                : bakeMode === 'manual'
                  ? '每部件 8 方向独立渲染；枢轴 = 网格原点，层级按场景图网格祖先'
                  : '每方向 2 遍（前/后）× 8 方向 = 16 遍，用模型原始姿态'}
            </span>
          </div>
        </div>

        {/* 骨骼手动合并（烘焙前；手动拆分模式无骨骼合并） */}
        {bakeMode !== 'manual' && (
        <BoneMergePanel
          pmxTextures={pmxTexturesRef.current ?? undefined}
          key={fileName ?? url}
          input={input}
          granularity={granularity}
          onMergesChange={handleMergesChange}
          onBake={handleBakeDispatch}
          baking={baking}
        />
        )}

        {/* 手动拆分：部件清单（多网格合并 + 枢轴）与网格分配 */}
        {bakeMode === 'manual' && (
          <div className="mb-3 rounded border border-[#2a2a4a] bg-[#0d0d1f] p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-gray-300">
              <span className="font-bold">手动拆分（按网格）</span>
              {manualCatalog && (
                <span className="text-gray-500">
                  {manualCatalog.meshes.length} 个网格 · {manualParts.filter((d) => d.meshIndices.length > 0).length} 个部件
                  {manualCatalog.hasBones ? '；此模型有骨骼，将按绑定姿势静态拆分' : '；无骨骼绑定'}
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => void loadManualCatalog()}
                disabled={manualListLoading}
                className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50"
              >
                {manualListLoading ? '读取中…' : '重新读取'}
              </button>
              <button onClick={() => applyManualGrouping('subtree')} disabled={!manualCatalog} className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50" title="以顶层网格为根，其场景图子树内的网格并为一个部件">
                按子树分组
              </button>
              <button onClick={() => applyManualGrouping('prefix')} disabled={!manualCatalog} className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50" title="名称去掉尾部数字后词干相同的网格并为一个部件（如 Arm_L_1 / Arm_L_2）">
                按名称前缀
              </button>
              <button onClick={() => applyManualGrouping('perMesh')} disabled={!manualCatalog} className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50" title="每个网格自成一个部件">
                逐网格
              </button>
            </div>
            {!manualCatalog && !manualListLoading && (
              <div className="text-[11px] text-gray-600">选择模型文件后自动读取网格列表（URL 输入请点「重新读取」）。把网格分配给部件（多个网格可合并为一个部件），枢轴默认取网格原点，可改包围盒中心或自定义坐标；父子层级按场景图中最近的跨部件网格祖先。</div>
            )}
            {manualListLoading && <div className="text-[11px] text-gray-500">读取网格列表…</div>}
            {manualCatalog && (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <button onClick={addManualPart} className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50">＋ 新建部件</button>
                  <button
                    onClick={() => setManualParts((prev) => prev.filter((d) => d.meshIndices.length > 0))}
                    className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50"
                    title="移除没有任何网格的部件行"
                  >
                    清除空部件
                  </button>
                </div>
                <div className="mb-2 max-h-64 overflow-y-auto">
                  {manualParts.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-2 py-0.5 text-[11px]">
                      <input
                        value={d.name}
                        onChange={(e) =>
                          setManualParts((prev) => prev.map((p) => (p.id === d.id ? { ...p, name: e.target.value } : p)))
                        }
                        className="h-6 w-36 rounded border border-[#2a2a4a] bg-[#12122a] px-1 text-gray-200"
                      />
                      <span className="text-gray-500">{d.meshIndices.length} 网格</span>
                      <label className="flex items-center gap-1 text-gray-400">
                        枢轴
                        <select
                          value={d.pivot.mode === 'mesh' ? `mesh:${d.pivot.meshIndex}` : d.pivot.mode}
                          onChange={(e) => {
                            const v = e.target.value;
                            setManualParts((prev) =>
                              prev.map((p) => {
                                if (p.id !== d.id) return p;
                                if (v === 'center') return { ...p, pivot: { mode: 'center' } as ManualPivotSpec };
                                if (v === 'custom') {
                                  const first = manualCatalog.meshes[p.meshIndices[0]];
                                  return {
                                    ...p,
                                    pivot: {
                                      mode: 'custom',
                                      point: first ? { ...first.pivot } : { x: 0, y: 0, z: 0 },
                                    } as ManualPivotSpec,
                                  };
                                }
                                return { ...p, pivot: { mode: 'mesh', meshIndex: Number(v.slice(5)) } as ManualPivotSpec };
                              }),
                            );
                          }}
                          className="h-6 rounded border border-[#2a2a4a] bg-[#12122a] px-1 text-gray-300"
                        >
                          <optgroup label="本部件网格">
                            {d.meshIndices.map((mi) => (
                              <option key={mi} value={`mesh:${mi}`}>
                                网格原点：{manualCatalog.meshes[mi]?.name ?? mi}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="其他网格（连接点）">
                            {manualCatalog.meshes
                              .filter((mm) => !d.meshIndices.includes(mm.meshIndex))
                              .map((mm) => (
                                <option key={mm.meshIndex} value={`mesh:${mm.meshIndex}`}>
                                  网格原点：{mm.name}
                                </option>
                              ))}
                          </optgroup>
                          <option value="center">包围盒中心</option>
                          <option value="custom">自定义坐标</option>
                        </select>
                      </label>
                      {d.pivot.mode === 'custom' && (
                        <span title="枢轴（模型世界坐标）">
                          <Vec3Field
                            space="file"
                            unit="模型单位"
                            step={0.05}
                            value={d.pivot.point}
                            onChange={(v) =>
                              setManualParts((prev) =>
                                prev.map((p) =>
                                  p.id === d.id && p.pivot.mode === 'custom'
                                    ? { ...p, pivot: { mode: 'custom', point: v } as ManualPivotSpec }
                                    : p,
                                ),
                              )
                            }
                            labelClassName="text-[10px] text-gray-400 whitespace-nowrap"
                            inputClassName="h-6 w-16 rounded border border-[#2a2a4a] bg-[#12122a] px-1 text-gray-200"
                          />
                        </span>
                      )}
                      {d.pivot.mode === 'custom' && (
                        <select
                          value=""
                          onChange={(e) => {
                            const mp = manualCatalog.meshes[Number(e.target.value)]?.pivot;
                            if (!mp) return;
                            setManualParts((prev) =>
                              prev.map((p) =>
                                p.id === d.id && p.pivot.mode === 'custom'
                                  ? { ...p, pivot: { mode: 'custom', point: { ...mp } } as ManualPivotSpec }
                                  : p,
                              ),
                            );
                          }}
                          className="h-6 rounded border border-[#2a2a4a] bg-[#12122a] px-1 text-gray-400"
                          title="把某个网格的原点坐标填入自定义枢轴"
                        >
                          <option value="" disabled>
                            取网格原点…
                          </option>
                          {manualCatalog.meshes.map((mm) => (
                            <option key={mm.meshIndex} value={mm.meshIndex}>
                              {mm.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={() => setManualParts((prev) => prev.filter((p) => p.id !== d.id))}
                        className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-400 hover:bg-[#222240]"
                      >
                        删除部件
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[#2a2a4a] pt-2">
                  <div className="mb-1 flex items-center gap-2 text-[11px]">
                    <label className="flex items-center gap-1 text-gray-400">
                      <input
                        type="checkbox"
                        checked={selectedMeshes.size > 0 && selectedMeshes.size === manualCatalog.meshes.length}
                        onChange={(e) =>
                          setSelectedMeshes(
                            e.target.checked ? new Set(manualCatalog.meshes.map((x) => x.meshIndex)) : new Set(),
                          )
                        }
                        className="size-3 accent-cyan-500"
                      />
                      全选
                    </label>
                    <span className="text-gray-500">已选 {selectedMeshes.size} 个</span>
                    <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)} className="h-6 rounded border border-[#2a2a4a] bg-[#12122a] px-1 text-gray-300">
                      <option value="">不包含</option>
                      {manualParts.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          → {d.name || '部件'}
                        </option>
                      ))}
                      <option value="__new">＋ 新建部件</option>
                    </select>
                    <button
                      disabled={selectedMeshes.size === 0}
                      onClick={() => {
                        assignMeshes([...selectedMeshes], bulkTarget);
                        setSelectedMeshes(new Set());
                      }}
                      className="rounded border border-[#3a3a5a] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-50"
                    >
                      批量分配
                    </button>
                  </div>
                  {manualCatalog.meshes.map((m) => {
                    const owner = manualParts.find((d) => d.meshIndices.includes(m.meshIndex));
                    return (
                      <div key={m.meshIndex} className="flex items-center gap-2 py-0.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={selectedMeshes.has(m.meshIndex)}
                          onChange={(e) =>
                            setSelectedMeshes((prev) => {
                              const n = new Set(prev);
                              if (e.target.checked) n.add(m.meshIndex);
                              else n.delete(m.meshIndex);
                              return n;
                            })
                          }
                          className="size-3 shrink-0 accent-cyan-500"
                        />
                        <span className="w-44 truncate text-gray-300" title={m.path}>{m.name}</span>
                        <span className="text-gray-600">{m.triCount} 三角形</span>
                        <span className="font-mono text-[10px] text-gray-600" title="网格原点（文件世界坐标）">
                          原点 {m.pivot.x.toFixed(2)}, {m.pivot.y.toFixed(2)}, {m.pivot.z.toFixed(2)}
                        </span>
                        <select
                          value={owner ? String(owner.id) : ''}
                          onChange={(e) => assignMeshes([m.meshIndex], e.target.value)}
                          className="h-6 rounded border border-[#2a2a4a] bg-[#12122a] px-1 text-gray-300"
                        >
                          <option value="">不包含</option>
                          {manualParts.map((d) => (
                            <option key={d.id} value={String(d.id)}>
                              → {d.name || '部件'}
                            </option>
                          ))}
                          <option value="__new">＋ 新建部件</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const nonEmpty = manualParts.filter((d) => d.meshIndices.length > 0);
                  if (nonEmpty.length === 0) return null;
                  const parents = resolveManualParentIndices(
                    manualCatalog.meshes,
                    nonEmpty.map((d) => ({ meshIndices: d.meshIndices, pivot: d.pivot })),
                  );
                  const childrenOf = new Map<number, number[]>();
                  parents.forEach((pIdx, i) => {
                    if (pIdx >= 0) {
                      const arr = childrenOf.get(pIdx) ?? [];
                      arr.push(i);
                      childrenOf.set(pIdx, arr);
                    }
                  });
                  const renderNode = (i: number, depth: number): React.ReactNode => (
                    <div key={nonEmpty[i].id}>
                      <div style={{ paddingLeft: depth * 14 }} className="py-px text-[11px]">
                        {depth > 0 && <span className="text-gray-600">└ </span>}
                        <span className="text-gray-200">{nonEmpty[i].name || '部件'}</span>
                        <span className="text-gray-600"> · {nonEmpty[i].meshIndices.length} 网格</span>
                      </div>
                      {(childrenOf.get(i) ?? []).map((c) => renderNode(c, depth + 1))}
                    </div>
                  );
                  return (
                    <div className="mt-2 border-t border-[#2a2a4a] pt-2">
                      <div className="mb-1 text-[10px] text-gray-500">
                        导入后层级预览（锚网格 = 枢轴网格或首网格，沿场景图祖先取第一个跨部件网格；与烘焙同口径解析）
                      </div>
                      {nonEmpty.map((_, i) => (parents[i] === -1 ? renderNode(i, 0) : null))}
                    </div>
                  );
                })()}
                <ManualPickPanel
                  key={fileName ?? url}
                  resolveInput={resolveInput}
                  pmxTextures={pmxTexturesRef.current ?? undefined}
                  catalog={manualCatalog}
                  parts={manualParts}
                  selectedMeshes={selectedMeshes}
                  onSelectionChange={setSelectedMeshes}
                />
              </>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3 rounded border border-red-900 bg-red-950/50 p-2 text-[11px] text-red-300">
            {error}
          </div>
        )}
        {importMsg && (
          <div className="mb-3 rounded border border-green-900 bg-green-950/50 p-2 text-[11px] text-green-300">
            {importMsg}
          </div>
        )}

        {/* 导入为角色（三模式共用：processed 有结果就显示，不再绑在双遍/六部件总览里） */}
        {processed && processed.size > 0 && (
          <div className="mb-3 flex items-center gap-3">
            <button
              onClick={handleImport}
              className="h-7 rounded bg-green-700 px-4 text-[11px] font-bold text-white hover:bg-green-600"
            >
              导入为角色
            </button>
            <span className="text-[11px] text-gray-500">{processed.size} 个有效肢体待导入</span>
          </div>
        )}

        {/* 单肢体重烘面板 */}
        {rebakeTarget && (
          <RebakePanel
            pmxTextures={pmxTexturesRef.current ?? undefined}
            pmxFlavor={pmxFlavor}
            bone={rebakeTarget}
            input={input}
            size={size}
            paletteSize={paletteSize}
            onClose={() => setRebakeTarget(null)}
            onDone={handleRebakeDone}
          />
        )}

        {/* 8 方向总览 */}
        {dirThumbs && (
          <div className="mb-3">
            <div className="mb-2 flex items-center gap-3 text-[11px] text-gray-400">
              <span>
                {twoPass!.bones.length} bones · {processed?.size ?? 0} 有效肢体 · 总耗时 {totalMs.toFixed(0)}ms · {size}×{size}
              </span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={showIds}
                  onChange={(e) => setShowIds(e.target.checked)}
                />
                显示 ID 图（调试拆分）
              </label>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {dirThumbs.map((r) => (
                <div key={r.direction} className="flex flex-col items-center gap-1">
                  <ResultCanvas result={r} size={80} />
                  <div className="text-[10px] text-gray-500">{r.direction * 45}°</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 六部件总览：6 组 × 8 方向 */}
        {sixPartThumbs && (
          <div className="mb-3">
            <div className="mb-2 flex items-center gap-3 text-[11px] text-gray-400">
              <span>
                {sixPart!.bones.length} bones · {processed?.size ?? 0} 有效肢体 · 总耗时 {totalMs.toFixed(0)}ms · {size}×{size} · 六部件
              </span>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={showIds}
                  onChange={(e) => setShowIds(e.target.checked)}
                />
                显示 ID 图（调试拆分）
              </label>
            </div>
            {sixPartThumbs.map(({ part, thumbs }) => (
              <div key={part} className="mb-2">
                <div className="mb-1 text-[10px] text-gray-500">{PART_LABEL[part]}</div>
                <div className="grid grid-cols-8 gap-2">
                  {thumbs.map((r) => {
                    // 该部件各有效骨骼的关节投影位置（烘焙帧像素 → 64px 预览坐标）
                    const markers = (sixPart!.partBoneMap[part] ?? [])
                      .filter((gi) => sixPart!.merge.effectiveIndex[gi] === gi)
                      .map((gi) => sixPart!.bones[gi]?.jointPixels?.[r.direction])
                      .filter((jp): jp is { x: number; y: number } => !!jp)
                      .map((jp) => ({ x: (jp.x / sixPart!.width) * 64, y: (jp.y / sixPart!.height) * 64 }));
                    return (
                      <div key={r.direction} className="flex flex-col items-center gap-1">
                        <ResultCanvas result={r} size={64} markers={markers} />
                        <div className="text-[10px] text-gray-600">{r.direction * 45}°</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 骨骼列表 */}
        {boneList.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] text-gray-400">
              {bakeMode === 'manual' ? `部件列表（${boneList.length}）` : `肢体列表（${boneList.length}）— 不满意可单独重烘`}
            </div>
            <div className="grid grid-cols-6 gap-2">
              {boneList.map((pb) => {
                const d0 = pb.directions.find((d) => d.direction === 0) ?? pb.directions[0];
                const boneInfo = curBones?.[pb.boneIndex];
                return (
                  <div
                    key={pb.boneIndex}
                    className="flex flex-col items-center gap-1 rounded border border-[#2a2a4a] p-2"
                  >
                    {d0 && (
                      <button
                        onClick={() => setPopupBone(pb)}
                        className="cursor-pointer hover:opacity-80"
                        title="点击查看8方向"
                      >
                        <PixelGridCanvas grid={d0.grid} scale={2} plugX={d0.plugX} plugY={d0.plugY} />
                      </button>
                    )}
                    <div className="max-w-[110px] truncate text-[10px] text-gray-300" title={pb.boneName}>
                      {pb.boneName}
                    </div>
                    {bakeMode !== 'manual' && (
                    <button
                      onClick={() => boneInfo && setRebakeTarget(boneInfo)}
                      className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-300 hover:bg-[#222240]"
                    >
                      重烘
                    </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!twoPass && !sixPart && !processed && !error && !baking && (
          <div className="py-8 text-center text-[11px] text-gray-600">
            {bakeMode === 'sixpart'
              ? '选择模型后点「六部件烘焙」：6 部件 × 8 方向 ×（颜色+ID）= 96 遍 → 块内 ID 拆分 → 可导入为角色'
              : bakeMode === 'manual'
                ? '选择模型后在部件清单里勾选网格，点「手动拆分烘焙」：每部件 8 方向 → 可导入为角色（适合非人形 / 无骨骼绑定的模型）'
                : '选择模型后点「按骨骼烘焙」：16 遍渲染（ID 双遍 × 8 方向）→ 自动按 bone 拆分 → 可导入为角色'}
          </div>
        )}

        {/* 肢体8方向弹窗：点击肢体预览弹出，各方向附带手动替换服装按钮 */}
        {popupBone && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={() => setPopupBone(null)}
          >
            <div
              className="max-h-[90vh] overflow-auto rounded-lg border border-[#3a3a5a] bg-[#1a1a2e] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-gray-200">
                  {popupBone.boneName} — 8 方向精灵
                </div>
                <button
                  onClick={() => setPopupBone(null)}
                  className="rounded border border-[#3a3a5a] px-2 py-1 text-xs text-gray-300 hover:bg-[#222240]"
                >
                  关闭
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[...popupBone.directions]
                  .sort((a, b) => a.direction - b.direction)
                  .map((dir) => (
                    <div
                      key={dir.direction}
                      className="flex flex-col items-center gap-1 rounded border border-[#2a2a4a] p-2"
                    >
                      <div className="text-[10px] text-gray-400">
                        方向 {dir.direction}（{dir.width}×{dir.height}）
                      </div>
                      <PixelGridCanvas grid={dir.grid} scale={2} plugX={dir.plugX} plugY={dir.plugY} />
                      <button
                        onClick={() =>
                          handleReplaceSprite(popupBone.boneIndex, popupBone.boneName, dir)
                        }
                        disabled={!lastImportedCharId}
                        className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-40"
                        title={
                          lastImportedCharId
                            ? '用此预览替换已导入角色的对应精灵'
                            : '请先导入角色'
                        }
                      >
                        手动替换服装
                      </button>
                    </div>
                  ))}
              </div>
              {!lastImportedCharId && (
                <div className="mt-2 text-[11px] text-yellow-400">
                  提示：请先点「导入角色」，再使用手动替换。
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
