'use client';

// ============================================================
// PixelMorpher - three.js 按骨骼烘焙 → 导入 Character
// 主流程 C：ID 缓冲双遍渲染 → 2D 按 bone 拆分 → 导入为角色
// 备选 A：单肢体独立重烘（拆下竖直，手指可握拳）→ 替换
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BakeResult } from '@/lib/bake/threejs-baker';
import {
  bakeModelTwoPass,
  bakeSingleBone,
  previewHandCurl,
  inspectFingers,
  parseModelBones,
  computeBoneMerge,
  type TwoPassBakeData,
  type BakedBoneInfo,
  type FingerDetectResult,
  type ParsedBoneInfo,
  type BoneMergeInfo,
  type BoneGranularity,
} from '@/lib/bake/threejs-baker-twopass';
import {
  splitByBoneId,
  mapBonesToNodes,
  rgbaToGrid,
  alignLimbToRest,
  type ProcessedBone,
  type ProcessedBoneDirection,
} from '@/lib/bake/skeleton-mapper';
import type { PixelGrid, DirectionIndex } from '@/lib/unified-types';
import { useProjectStore } from '@/lib/store';
import BonePicker3D from './BonePicker3D';

const SAMPLE_URL = 'https://threejs.org/examples/models/gltf/Xbot.glb';

interface ThreeBakeDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 显示 BakeResult（RGBA） */
function ResultCanvas({ result, size = 128 }: { result: BakeResult; size?: number }) {
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
  }, [result]);
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
function PixelGridCanvas({ grid, scale = 3 }: { grid: PixelGrid; scale?: number }) {
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
  }, [grid, scale]);
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
  size: number;
  paletteSize: number;
  onClose: () => void;
  onDone: (boneIndex: number, boneName: string, results: BakeResult[]) => void;
}

function RebakePanel({ bone, input, size, paletteSize, onClose, onDone }: RebakePanelProps) {
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
              角度按关节：MCP 90° / PIP 100° / DIP 70° / 拇指屈曲 60°+内收 35°，再 × 卷曲系数
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
function BoneMergePanel({ input, granularity, smallBoneThreshold = 50, onMergesChange, onBake, baking }: BoneMergePanelProps) {
  const [bones, setBones] = useState<ParsedBoneInfo[] | null>(null);
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
      const parsed = await parseModelBones(inp);
      setBones(parsed);
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

  // 自动合并预览（随手动覆盖实时重算）
  const mergeInfo: BoneMergeInfo | null = bones
    ? computeBoneMerge(
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

  /** 选中多个 → 合并到第一个（按层级最浅的优先） */
  const handleMergeSelected = useCallback(() => {
    if (!bones || selected.size < 2) return;
    const arr = [...selected].sort((a, b) => {
      // 深度浅的优先当目标
      const depth = (i: number): number => {
        let d = 0;
        let p = bones[i].parentIndex;
        while (p !== null && p !== undefined) { d++; p = bones[p].parentIndex; }
        return d;
      };
      return depth(a) - depth(b);
    });
    const target = arr[0];
    const merges = new Map(manualMerges);
    const unmerges = new Set(manualUnmerges);
    for (let k = 1; k < arr.length; k++) {
      const src = arr[k];
      if (src === target) continue;
      merges.set(src, target);
      unmerges.delete(src); // 手动合并覆盖取消
    }
    updateMerges(merges, unmerges);
    setSelected(new Set());
  }, [bones, selected, manualMerges, manualUnmerges, updateMerges]);

  /** 单个 → 并入父级 */
  const handleMergeToParent = useCallback(() => {
    if (!bones || selected.size !== 1) return;
    const src = [...selected][0];
    const p = bones[src].parentIndex;
    if (p === null || p === undefined) return;
    const merges = new Map(manualMerges);
    const unmerges = new Set(manualUnmerges);
    merges.set(src, p);
    unmerges.delete(src);
    updateMerges(merges, unmerges);
    setSelected(new Set());
  }, [bones, selected, manualMerges, manualUnmerges, updateMerges]);

  /** 取消合并（恢复独立） */
  const handleUnmerge = useCallback(() => {
    if (!bones || selected.size === 0) return;
    const merges = new Map(manualMerges);
    const unmerges = new Set(manualUnmerges);
    for (const src of selected) {
      merges.delete(src);
      // 如果自动规则会合并它，则加入 unmerges 强制独立
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
            烘焙前可手动调整 bone 合并（自动规则已预应用）
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
            <span
              className={`shrink-0 rounded px-1 ${isManual ? 'bg-purple-900 text-purple-200' : 'bg-[#2a2a4a] text-gray-400'}`}
              title={reason ?? ''}
            >
              → {bones[eff]?.name ?? eff}{isManual ? ' (手动)' : ''}
            </span>
          ) : (
            <span className={`shrink-0 rounded px-1 ${isUnmerged ? 'bg-amber-900 text-amber-200' : 'bg-green-950 text-green-400'}`}>
              {isUnmerged ? '独立 (手动)' : '独立'}
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
          {expanded ? '▼' : '▶'} 骨骼合并
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
      {expanded && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <button
              onClick={handleMergeSelected}
              disabled={selected.size < 2}
              className="h-6 rounded bg-purple-800 px-2 text-[10px] text-white hover:bg-purple-700 disabled:opacity-40"
              title="选中 2+ 个 bone，合并到层级最浅的那个"
            >
              合并选中 ({selected.size})
            </button>
            <button
              onClick={handleMergeToParent}
              disabled={selected.size !== 1}
              className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-300 hover:bg-[#222240] disabled:opacity-40"
              title="选中 1 个 bone，并入其父级"
            >
              并入父级
            </button>
            <button
              onClick={handleUnmerge}
              disabled={selected.size === 0}
              className="h-6 rounded border border-amber-800 bg-amber-950 px-2 text-[10px] text-amber-200 hover:bg-amber-900 disabled:opacity-40"
              title="取消选中 bone 的合并（含自动），强制独立"
            >
              取消合并
            </button>
            <button
              onClick={handleClearUnmerge}
              disabled={selected.size === 0}
              className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-400 hover:bg-[#222240] disabled:opacity-40"
              title="清除手动取消，恢复自动规则"
            >
              恢复自动
            </button>
            <span className="text-[10px] text-gray-600">
              点选行或复选框多选
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

  const [baking, setBaking] = useState(false);
  const [progress, setProgress] = useState('');
  const [twoPass, setTwoPass] = useState<TwoPassBakeData | null>(null);
  const [processed, setProcessed] = useState<Map<number, ProcessedBone> | null>(null);
  const [showIds, setShowIds] = useState(false);
  const [totalMs, setTotalMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [rebakeTarget, setRebakeTarget] = useState<BakedBoneInfo | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

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
    setProcessed(null);
    setError(null);
    setImportMsg(null);
    setManualMerges(new Map());
    setManualUnmerges(new Set());
    const reader = new FileReader();
    reader.onload = () => setFileData(reader.result as ArrayBuffer);
    reader.onerror = () => setError('文件读取失败');
    reader.readAsArrayBuffer(f);
  }, []);

  const handleBake = useCallback(async () => {
    setBaking(true);
    setError(null);
    setTwoPass(null);
    setProcessed(null);
    setImportMsg(null);
    setRebakeTarget(null);
    try {
      // 输入解析：文件直接用；URL 走缓存，避免改合并设置后重烘时重复下载
      let inp: string | ArrayBuffer;
      if (fileData) {
        inp = fileData;
        urlCache.current = null; // 切到文件时清 URL 缓存
      } else {
        const u = url.trim();
        if (!u) throw new Error('请先选择文件或填写 URL');
        if (urlCache.current && urlCache.current.url === u) {
          inp = urlCache.current.data;
        } else {
          setProgress('下载模型…');
          await new Promise((r) => setTimeout(r, 30));
          const resp = await fetch(u);
          if (!resp.ok) throw new Error(`下载失败: ${resp.status}`);
          const buf = await resp.arrayBuffer();
          urlCache.current = { url: u, data: buf };
          inp = buf;
        }
      }
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
  }, [fileData, url, size, paletteSize, granularity, manualMerges, manualUnmerges]);

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
          // 竖直重烘图 → 对齐到原始姿态（最近 90° 无损旋转）
          if (orig && parentPb) {
            const pOrig = parentPb.directions.find((d) => d.direction === r.direction);
            if (pOrig) {
              grid = alignLimbToRest(grid, orig.jointX - pOrig.jointX, orig.jointY - pOrig.jointY);
            }
          }
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
            // 新图以关节为中心
            plugX: w / 2,
            plugY: h / 2,
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
      const base = fileName ? fileName.replace(/\.(glb|gltf)$/i, '') : 'baked';
      const name = `烘焙_${base}`;
      store.pushUndo('导入烘焙角色');
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
      setImportMsg(
        `已创建角色 ${name}，含 ${mapped.stats.nodes} 个节点，${mapped.stats.sprites} 张精灵`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [processed, fileName]);

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
            3D 按骨骼烘焙 <span className="font-normal text-gray-500">（ID 双遍 → 拆分 → 导入角色）</span>
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
              accept=".glb,.gltf"
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
            <button
              onClick={handleBake}
              disabled={baking}
              className="h-7 rounded bg-cyan-700 px-4 text-[11px] font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {baking ? '烘焙中…' : '按骨骼烘焙'}
            </button>
            {progress && <span className="text-cyan-400">{progress}</span>}
            <span className="text-gray-600">每方向 2 遍（前/后）× 8 方向 = 16 遍，用模型原始姿态</span>
          </div>
        </div>

        {/* 骨骼手动合并（烘焙前） */}
        <BoneMergePanel
          key={fileName ?? url}
          input={input}
          granularity={granularity}
          onMergesChange={handleMergesChange}
          onBake={handleBake}
          baking={baking}
        />

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

        {/* 单肢体重烘面板 */}
        {rebakeTarget && (
          <RebakePanel
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
              <button
                onClick={handleImport}
                disabled={!processed || processed.size === 0}
                className="h-7 rounded bg-green-700 px-4 text-[11px] font-bold text-white hover:bg-green-600 disabled:opacity-50"
              >
                导入为角色
              </button>
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

        {/* 骨骼列表 */}
        {boneList.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] text-gray-400">
              肢体列表（{boneList.length}）— 不满意可单独重烘
            </div>
            <div className="grid grid-cols-6 gap-2">
              {boneList.map((pb) => {
                const d0 = pb.directions.find((d) => d.direction === 0) ?? pb.directions[0];
                const boneInfo = twoPass?.bones[pb.boneIndex];
                return (
                  <div
                    key={pb.boneIndex}
                    className="flex flex-col items-center gap-1 rounded border border-[#2a2a4a] p-2"
                  >
                    {d0 && <PixelGridCanvas grid={d0.grid} scale={2} />}
                    <div className="max-w-[110px] truncate text-[10px] text-gray-300" title={pb.boneName}>
                      {pb.boneName}
                    </div>
                    <button
                      onClick={() => boneInfo && setRebakeTarget(boneInfo)}
                      className="h-6 rounded border border-[#3a3a5a] bg-[#1a1a30] px-2 text-[10px] text-gray-300 hover:bg-[#222240]"
                    >
                      重烘
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!twoPass && !error && !baking && (
          <div className="py-8 text-center text-[11px] text-gray-600">
            选择模型后点「按骨骼烘焙」：16 遍渲染（ID 双遍 × 8 方向）→ 自动按 bone 拆分 → 可导入为角色
          </div>
        )}
      </div>
    </div>
  );
}
