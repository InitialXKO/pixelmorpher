'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEditorStore, useProjectStore } from '@/lib/store';
import PivotEditor from './puppet/PivotEditor';
import type { Sprite } from '@/lib/unified-types';
import {
  createDefaultCostumePiece,
  projectToView,
  subToPx,
} from '@/lib/unified-types';
import { computeWorldTransforms, geometryDirectionFromToggle } from '@/lib/unified-render';
import { alphaPlaneFromImageData, computeDiskPaintSet, segmentCrossesWall } from '@/lib/mask-region';
import { initSAM, isSAMReady, setSAMImage, segmentWithPoints } from '@/lib/sam';
import {
  containFit,
  canvasToImage,
  canvasToImageClamped,
  shadowQuadsForPolyline,
  type ContainFit,
  type Pt,
} from '@/lib/sam-input';

// ============================================================
// MaskBrushOverlay - 遮罩模式专用笔刷
// 在参考图上绘制遮罩，不经过现有笔刷管线
// ============================================================

interface Props {
  canvasWidth: number;
  canvasHeight: number;
}

export default function MaskBrushOverlay({ canvasWidth, canvasHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barrierCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastBarrierPos = useRef<{ x: number; y: number } | null>(null);
  // 防溢出（笔画栅栏模型，见 lib/mask-region 头注）：画布上是否已有线；
  // 本笔画锚点 = 上一盖章中心（涂料只许与锚点同侧连通，中心轨迹压墙即
  // 截断）；线画布的 alpha 平面缓存（按线版本号失效，避免每章全图读取）；
  // 上个盖章点（笔画插值用）
  const hasBarrierRef = useRef(false);
  const strokeAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const barrierVersionRef = useRef(0);
  const alphaCacheRef = useRef<{ version: number; alpha: Uint8Array } | null>(null);
  const lastStampPos = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(8);
  const [extractedSprite, setExtractedSprite] = useState<Sprite | null>(null);
  const [lastUpdateInfo, setLastUpdateInfo] = useState<string | null>(null);
  // 绘制模式：draw=绘制，erase=擦除，barrier=防溢出线，sam=SAM 提取
  const [paintMode, setPaintMode] = useState<'draw' | 'erase' | 'barrier' | 'sam'>('draw');
  // ---- SAM 提取（甲案：线外不输入 SAM，见 lib/sam-input 头注）----
  // 线的画布折线记录（画线时同步记点，供构建 SAM 输入时映射到原图空间）；
  // 提取会话：正/负点（画布坐标）、视点（本轮首个正点，定版后不再变）、
  // 上一轮掩膜（previousMask 增量）、当前结果；输入缓存键 = 参考图|线
  // 版本|视点——键不变则输入图与 SAM 编码绝不重建（「不重算输入」）。
  const samPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const barrierStrokesRef = useRef<Pt[][]>([]);
  const samPointsRef = useRef<{ x: number; y: number; label: 1 | 0 }[]>([]);
  const samViewpointRef = useRef<Pt | null>(null);
  const samPrevMaskRef = useRef<{ data: Float32Array; shape: [number, number] } | null>(null);
  const samResultRef = useRef<{ data: Float32Array; shape: [number, number]; score: number } | null>(null);
  const samEncodedKeyRef = useRef<string | null>(null);
  const samInputRef = useRef<{ key: string; shadow: HTMLCanvasElement; iw: number; ih: number; fit: ContainFit } | null>(null);
  const samBusyRef = useRef(false);
  const samEncodedByOverlayRef = useRef(false);
  const refImgCacheRef = useRef<{ url: string; img: HTMLImageElement } | null>(null);
  const refFitRef = useRef<{ fit: ContainFit; iw: number; ih: number } | null>(null);
  const [samUi, setSamUi] = useState({ text: '左键点正点开始提取，右键点负点排除', points: 0, hasResult: false });
  // 光标位置（用于显示笔刷大小）
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  // 色键取色（跨肢体共享，存 editor store）
  const [isPicking, setIsPicking] = useState(false);
  const keyColor = useEditorStore((s) => s.chromaKeyColor);
  const setKeyColor = useEditorStore((s) => s.setChromaKeyColor);

  const maskNodeId = useEditorStore((s) => s.maskNodeId);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const setMaskNodeId = useEditorStore((s) => s.setMaskNodeId);
  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  // 直接订阅，zoom/pan 变化时重渲染
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);

  // 初始化：透明底（遮罩和防溢出线都清空）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const bCanvas = barrierCanvasRef.current;
    if (bCanvas) {
      bCanvas.width = canvasWidth;
      bCanvas.height = canvasHeight;
      bCanvas.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
    }
    hasBarrierRef.current = false;
    strokeAnchorRef.current = null;
    barrierVersionRef.current++;
    alphaCacheRef.current = null;
    // SAM 提取会话一并清零（线记录、点、结果、阴影缓存）
    const pCanvas = samPreviewCanvasRef.current;
    if (pCanvas) {
      pCanvas.width = canvasWidth;
      pCanvas.height = canvasHeight;
      pCanvas.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
    }
    barrierStrokesRef.current = [];
    samPointsRef.current = [];
    samViewpointRef.current = null;
    samPrevMaskRef.current = null;
    samResultRef.current = null;
    samInputRef.current = null;
    setSamUi({ text: '左键点正点开始提取，右键点负点排除', points: 0, hasResult: false });
  }, [canvasWidth, canvasHeight, maskNodeId]);

  // 参考图自然尺寸与 contain 映射（SAM 点选坐标换算用），随图/画布变化更新
  useEffect(() => {
    let dead = false;
    refFitRef.current = null;
    if (!referenceImageUrl) return;
    loadReferenceImage().then((img) => {
      if (dead || !img) return;
      refFitRef.current = {
        fit: containFit(img.naturalWidth, img.naturalHeight, canvasWidth, canvasHeight),
        iw: img.naturalWidth,
        ih: img.naturalHeight,
      };
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceImageUrl, canvasWidth, canvasHeight]);

  // 卸载时若本 overlay 换过 SAM 的编码图（喂的是线外掏空的输入），恢复成
  // 原始参考图——向导 SAM 步以 URL 判断是否已编码，编码图不恢复会让它
  // 误以为已编码而对着掏空图分割。
  useEffect(() => {
    return () => {
      if (!samEncodedByOverlayRef.current) return;
      samEncodedByOverlayRef.current = false;
      void (async () => {
        const img = await loadReferenceImage();
        if (img && isSAMReady()) {
          try {
            await setSAMImage(img);
          } catch {
            /* 恢复失败不阻塞关闭 */
          }
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // overlay canvas 已按 pan/zoom 定位，rect 即图像区域
    // 直接换算到内部像素坐标
    const x = (e.clientX - rect.left) / (rect.width / canvasWidth);
    const y = (e.clientY - rect.top) / (rect.height / canvasHeight);
    return { x: Math.floor(x), y: Math.floor(y) };
  };

  // 加载参考图并返回与画布同尺寸的 ImageData（contain 居中）
  const getReferenceImageData = async (): Promise<ImageData | null> => {
    if (!referenceImageUrl) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = referenceImageUrl;
    });
    const refCanvas = document.createElement('canvas');
    refCanvas.width = canvasWidth;
    refCanvas.height = canvasHeight;
    const refCtx = refCanvas.getContext('2d', { willReadFrequently: true })!;
    const scale = Math.min(canvasWidth / img.naturalWidth, canvasHeight / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (canvasWidth - dw) / 2;
    const dy = (canvasHeight - dh) / 2;
    refCtx.imageSmoothingEnabled = false;
    refCtx.drawImage(img, dx, dy, dw, dh);
    return refCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  };

  // 取色：在参考图上点选像素颜色
  const handlePick = async (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return;
    const refData = await getReferenceImageData();
    if (!refData) return;
    const idx = (y * canvasWidth + x) * 4;
    const r = refData.data[idx];
    const g = refData.data[idx + 1];
    const b = refData.data[idx + 2];
    const a = refData.data[idx + 3];
    if (a < 10) {
      setLastUpdateInfo('取色失败：该处透明');
      return;
    }
    setKeyColor({ r, g, b });
    setIsPicking(false);
    setLastUpdateInfo(`已取色键 rgb(${r},${g},${b})`);
  };


  // ---- SAM 提取辅助 ----
  // 参考图元素缓存（按 URL）：点选换算与 SAM 编码共用同一元素
  const loadReferenceImage = async (): Promise<HTMLImageElement | null> => {
    if (!referenceImageUrl) return null;
    const cache = refImgCacheRef.current;
    if (cache && cache.url === referenceImageUrl) return cache.img;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = referenceImageUrl;
    }).catch(() => null);
    if (!img.naturalWidth) return null;
    refImgCacheRef.current = { url: referenceImageUrl, img };
    return img;
  };

  // 输入缓存键：参考图 | 线版本 | 视点（画布坐标）。键不变 = 输入不重建。
  const samInputKey = (view: Pt) =>
    `${referenceImageUrl}|v${barrierVersionRef.current}|${view.x},${view.y}`;

  // 构建 SAM 输入图（原图自然尺寸）：以视点为原点，防溢出线投下的阴影
  // 区域（线外）与线本身填底色——这些像素根本不进 SAM 的编码。无线时
  // 输入就是原图本身。底色取原图四角均值（背景色的廉价估计）。
  const buildSamInput = async (
    viewCanvas: Pt,
  ): Promise<{ input: HTMLCanvasElement; fit: ContainFit; iw: number; ih: number; shadow: HTMLCanvasElement } | null> => {
    const img = await loadReferenceImage();
    if (!img) return null;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const fit = containFit(iw, ih, canvasWidth, canvasHeight);
    const input = document.createElement('canvas');
    input.width = iw;
    input.height = ih;
    const ictx = input.getContext('2d', { willReadFrequently: true })!;
    ictx.drawImage(img, 0, 0);
    const shadow = document.createElement('canvas');
    shadow.width = iw;
    shadow.height = ih;
    if (barrierStrokesRef.current.length > 0) {
      const view = canvasToImageClamped(fit, iw, ih, viewCanvas.x, viewCanvas.y);
      const reach = Math.hypot(iw, ih) * 2;
      const sctx = shadow.getContext('2d')!;
      sctx.fillStyle = '#000';
      for (const stroke of barrierStrokesRef.current) {
        const line = stroke.map((p) => canvasToImageClamped(fit, iw, ih, p.x, p.y));
        for (const q of shadowQuadsForPolyline(view, line, reach)) {
          sctx.beginPath();
          sctx.moveTo(q[0].x, q[0].y);
          sctx.lineTo(q[1].x, q[1].y);
          sctx.lineTo(q[2].x, q[2].y);
          sctx.lineTo(q[3].x, q[3].y);
          sctx.closePath();
          sctx.fill();
        }
        // 线本身也不属于输入（映射到原图空间描边，线宽按比例换算）
        if (line.length >= 2) {
          sctx.strokeStyle = '#000';
          sctx.lineWidth = Math.max(1, 1 / fit.scale);
          sctx.lineJoin = 'round';
          sctx.lineCap = 'round';
          sctx.beginPath();
          sctx.moveTo(line[0]!.x, line[0]!.y);
          for (let i = 1; i < line.length; i++) sctx.lineTo(line[i]!.x, line[i]!.y);
          sctx.stroke();
        } else if (line.length === 1) {
          sctx.beginPath();
          sctx.arc(line[0]!.x, line[0]!.y, Math.max(0.5, 0.5 / fit.scale), 0, Math.PI * 2);
          sctx.fill();
        }
      }
      // 底色估计：沿原图边框环采样取中位数，并按 alpha 先合成到黑底上——
      // sam-web 编码前把输入合成到 #000 黑底（createSquareCanvas），透明
      // 像素在 SAM 眼中就是黑色；向导 SAM 步已抠掉底色的参考图边框全是
      // 透明像素，合成后自然得黑，与照片底色走同一条口径。用阴影作裁剪
      // 把底色只涂进线外。
      const ring: [number, number, number][] = [];
      const pushSample = (sx: number, sy: number) => {
        const d = ictx.getImageData(sx, sy, 1, 1).data;
        const af = d[3]! / 255;
        ring.push([d[0]! * af, d[1]! * af, d[2]! * af]);
      };
      const stepPx = Math.max(1, Math.floor(Math.min(iw, ih) / 64));
      for (let x = 0; x < iw; x += stepPx) {
        pushSample(x, 0);
        pushSample(x, ih - 1);
      }
      for (let y = 0; y < ih; y += stepPx) {
        pushSample(0, y);
        pushSample(iw - 1, y);
      }
      const median = (arr: number[]) => {
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)] ?? 0;
      };
      const bcol = [0, 1, 2].map((c) => Math.round(median(ring.map((p) => p[c]!))));
      const fillC = document.createElement('canvas');
      fillC.width = iw;
      fillC.height = ih;
      const fctx = fillC.getContext('2d')!;
      fctx.fillStyle = `rgb(${bcol[0]},${bcol[1]},${bcol[2]})`;
      fctx.fillRect(0, 0, iw, ih);
      fctx.globalCompositeOperation = 'destination-in';
      fctx.drawImage(shadow, 0, 0);
      ictx.drawImage(fillC, 0, 0);
    }
    return { input, fit, iw, ih, shadow };
  };

  // 确保 SAM 已初始化且编码的正是当前键的输入；键命中直接返回（不重算）
  const ensureSamEncoded = async (view: Pt): Promise<boolean> => {
    const key = samInputKey(view);
    if (samEncodedKeyRef.current === key) return true;
    if (!isSAMReady()) {
      setSamUi((u) => ({ ...u, text: '正在初始化 SAM…' }));
      await initSAM('mobilesam', (_s, p) => {
        setSamUi((u) => ({ ...u, text: `正在初始化 SAM… ${p}%` }));
      });
    }
    const built = await buildSamInput(view);
    if (!built) return false;
    setSamUi((u) => ({ ...u, text: '正在编码输入图…' }));
    await setSAMImage(built.input);
    samEncodedKeyRef.current = key;
    samInputRef.current = { key, shadow: built.shadow, iw: built.iw, ih: built.ih, fit: built.fit };
    samEncodedByOverlayRef.current = true;
    return true;
  };

  // SAM 结果掩膜是否覆盖某画布像素：画布 → 原图 → 编码正方形 → 掩膜网格，
  // 阈值取库的口径 logits > 0（与 sam-web 的 findMaskBounds 一致）
  const samMaskAt = (
    res: { data: Float32Array; shape: [number, number] },
    info: { iw: number; ih: number; fit: ContainFit },
    cx: number,
    cy: number,
  ): boolean => {
    const ix = (cx - info.fit.dx) / info.fit.scale;
    const iy = (cy - info.fit.dy) / info.fit.scale;
    if (ix < 0 || iy < 0 || ix >= info.iw || iy >= info.ih) return false;
    const escale = 1024 / Math.max(info.iw, info.ih);
    const padX = (1024 - info.iw * escale) / 2;
    const padY = (1024 - info.ih * escale) / 2;
    const gw = res.shape[1];
    const gh = res.shape[0];
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(((ix * escale + padX) / 1024) * gw)));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(((iy * escale + padY) / 1024) * gh)));
    return res.data[gy * gw + gx]! > 0;
  };

  // 预览层：线外区域压暗（让用户看见 SAM 的实际输入范围）+ 结果绿罩 + 点位标记
  const drawSamPreview = () => {
    const pCanvas = samPreviewCanvasRef.current;
    if (!pCanvas) return;
    const pctx = pCanvas.getContext('2d')!;
    pctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const info = samInputRef.current;
    const view = samViewpointRef.current;
    if (info && view && info.key === samInputKey(view) && barrierStrokesRef.current.length > 0) {
      pctx.save();
      pctx.globalAlpha = 0.35;
      pctx.drawImage(info.shadow, info.fit.dx, info.fit.dy, info.fit.dw, info.fit.dh);
      pctx.restore();
    }
    const res = samResultRef.current;
    if (res && info) {
      const imgData = pctx.createImageData(canvasWidth, canvasHeight);
      for (let cy = 0; cy < canvasHeight; cy++) {
        for (let cx = 0; cx < canvasWidth; cx++) {
          if (samMaskAt(res, info, cx, cy)) {
            const idx = (cy * canvasWidth + cx) * 4;
            imgData.data[idx] = 0;
            imgData.data[idx + 1] = 255;
            imgData.data[idx + 2] = 120;
            imgData.data[idx + 3] = 115;
          }
        }
      }
      pctx.putImageData(imgData, 0, 0);
    }
    for (const p of samPointsRef.current) {
      pctx.beginPath();
      pctx.arc(p.x + 0.5, p.y + 0.5, 4, 0, Math.PI * 2);
      pctx.fillStyle = p.label === 1 ? '#22ff88' : '#ff4444';
      pctx.fill();
      pctx.lineWidth = 1.5;
      pctx.strokeStyle = '#fff';
      pctx.stroke();
    }
  };

  // 一轮分割：点集（画布坐标）→ 原图归一化 → segmentWithPoints（带上一轮
  // 掩膜作增量提示）。视点在首个正点落下时已定版，输入按键复用。
  const runSamSegment = async () => {
    if (samBusyRef.current) return;
    const view = samViewpointRef.current;
    const rf = refFitRef.current;
    if (!view || !rf) return;
    samBusyRef.current = true;
    const pointsAtStart = samPointsRef.current.length;
    try {
      const ok = await ensureSamEncoded(view);
      if (!ok) {
        setSamUi((u) => ({ ...u, text: 'SAM 输入准备失败（参考图未加载）' }));
        return;
      }
      const norm = samPointsRef.current
        .map((p) => {
          const ip = canvasToImage(rf.fit, p.x, p.y);
          return ip ? { x: ip.x / rf.iw, y: ip.y / rf.ih, label: p.label } : null;
        })
        .filter((p): p is { x: number; y: number; label: 1 | 0 } => p !== null);
      if (norm.length === 0) return;
      const res = await segmentWithPoints(norm, samPrevMaskRef.current ?? undefined);
      samPrevMaskRef.current = { data: res.data, shape: res.shape };
      samResultRef.current = { data: res.data, shape: res.shape, score: res.score };
      drawSamPreview();
      setSamUi({
        text: `得分 ${res.score.toFixed(2)} · 继续加点修正，或「应用到遮罩」落袋`,
        points: samPointsRef.current.length,
        hasResult: true,
      });
    } catch (err) {
      setSamUi((u) => ({ ...u, text: `SAM 失败：${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      samBusyRef.current = false;
      // 运行期间又落了新点：补跑一轮，让结果追上点集（否则最后的点永不生效）
      if (samViewpointRef.current && samPointsRef.current.length !== pointsAtStart) {
        void runSamSegment();
      }
    }
  };

  // 清空本轮点/结果（输入缓存保留：同键下次取点不重建）
  const resetSamSession = () => {
    samPointsRef.current = [];
    samViewpointRef.current = null;
    samPrevMaskRef.current = null;
    samResultRef.current = null;
    drawSamPreview();
    setSamUi({ text: '左键点正点开始提取，右键点负点排除', points: 0, hasResult: false });
  };

  // 应用：当前结果并入遮罩画布（与手绘同层同口径），之后可继续点取下一段
  const applySamToMask = () => {
    const res = samResultRef.current;
    const info = samInputRef.current;
    const canvas = canvasRef.current;
    if (!res || !info || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,0,0,0.5)';
    for (let cy = 0; cy < canvasHeight; cy++) {
      for (let cx = 0; cx < canvasWidth; cx++) {
        if (samMaskAt(res, info, cx, cy)) ctx.fillRect(cx, cy, 1, 1);
      }
    }
    resetSamSession();
    setSamUi({ text: '已应用到遮罩，可继续点取下一段', points: 0, hasResult: false });
  };

  // 预览层只在 SAM 模式显示（切走清掉，避免绿罩/点位干扰手绘）
  useEffect(() => {
    if (paintMode === 'sam') {
      drawSamPreview();
    } else {
      const p = samPreviewCanvasRef.current;
      if (p) p.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintMode]);

  // 防溢出线的 alpha 平面（栅栏判定用）：按线版本号缓存——线不变时
  // 每个盖章点直接复用，不再每章全图 getImageData（旧射线实现的浪费）。
  // 无线时返回 null（不约束、零成本）。
  const getBarrierAlpha = (): Uint8Array | null => {
    if (!hasBarrierRef.current) return null;
    const cache = alphaCacheRef.current;
    if (cache && cache.version === barrierVersionRef.current) return cache.alpha;
    const bCanvas = barrierCanvasRef.current;
    if (!bCanvas) return null;
    const bCtx = bCanvas.getContext('2d', { willReadFrequently: true })!;
    const img = bCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    const alpha = alphaPlaneFromImageData(img.data, canvasWidth, canvasHeight);
    alphaCacheRef.current = { version: barrierVersionRef.current, alpha };
    return alpha;
  };

  const drawAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    if (paintMode === 'barrier') {
      // 防溢出线：1px 蓝色线条（画在独立 canvas）
      const bCanvas = barrierCanvasRef.current;
      if (!bCanvas) return;
      const bCtx = bCanvas.getContext('2d')!;
      bCtx.strokeStyle = 'rgba(0,150,255,1)';
      bCtx.lineWidth = 1;
      bCtx.lineCap = 'round';
      const last = lastBarrierPos.current;
      bCtx.beginPath();
      if (last) {
        bCtx.moveTo(last.x + 0.5, last.y + 0.5);
        bCtx.lineTo(x + 0.5, y + 0.5);
      } else {
        bCtx.moveTo(x + 0.5, y + 0.5);
        bCtx.lineTo(x + 0.5, y + 0.5);
      }
      bCtx.stroke();
      // 同步记录折线（SAM 输入构建要把线映射到原图空间投阴影）
      const strokes = barrierStrokesRef.current;
      if (!last) {
        strokes.push([{ x, y }]);
      } else {
        const cur = strokes[strokes.length - 1];
        const tail = cur?.[cur.length - 1];
        if (cur && tail && (tail.x !== x || tail.y !== y)) cur.push({ x, y });
      }
      lastBarrierPos.current = { x, y };
      hasBarrierRef.current = true;
      barrierVersionRef.current++;
      // 线变了：正在进行的 SAM 提取（基于旧线构建的输入）作废
      if (samPointsRef.current.length > 0 || samResultRef.current) resetSamSession();
      return;
    }

    const erase = paintMode === 'erase';
    const radius = brushSize / 2;

    if (erase) {
      // 擦除：不受防溢出线约束
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // 绘制：笔画栅栏判定（lib/mask-region）。无线时整圆涂；有线时本章
    // 只涂圆盘内与锚点（上一盖章中心）同侧 4 连通的像素——笔尖压线时
    // 只涂线内侧、贴墙无死区；中心轨迹压墙则本章整体截断、锚点不越墙，
    // 手速多快都跳不过去；斜线角缝对 4 连通洪泛数学密封。
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,0,0,0.5)';
    const alpha = getBarrierAlpha();
    if (!alpha) {
      const x0 = Math.max(0, Math.floor(x - radius));
      const x1 = Math.min(canvasWidth - 1, Math.ceil(x + radius));
      const y0 = Math.max(0, Math.floor(y - radius));
      const y1 = Math.min(canvasHeight - 1, Math.ceil(y + radius));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - x;
          const dy = py - y;
          if (dx * dx + dy * dy > radius * radius) continue;
          ctx.fillRect(px, py, 1, 1);
        }
      }
      return;
    }
    const anchor = strokeAnchorRef.current;
    if (anchor && segmentCrossesWall(alpha, canvasWidth, canvasHeight, anchor.x, anchor.y, x, y)) {
      return; // 中心轨迹压墙：本章不涂，锚点留在墙内侧
    }
    const paint = computeDiskPaintSet(
      alpha, canvasWidth, canvasHeight, x, y, radius,
      anchor?.x ?? x, anchor?.y ?? y,
    );
    for (const idx of paint) {
      ctx.fillRect(idx % canvasWidth, Math.floor(idx / canvasWidth), 1, 1);
    }
    // 锚点推进到本章中心（中心压在墙上时不推进，锚点保持在内侧）
    if (alpha[y * canvasWidth + x]! <= 10) {
      strokeAnchorRef.current = { x, y };
    }
  };

  const handleDown = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    if (isPicking) {
      handlePick(x, y);
      return;
    }
    if (paintMode === 'sam') {
      // SAM 取点：左键正点、右键/Alt 负点；点必须落在参考图绘制矩形内。
      // 首个正点定版视点（决定线外阴影与输入），之后加点只重跑解码。
      const rf = refFitRef.current;
      if (!rf) {
        setSamUi((u) => ({ ...u, text: '参考图加载中…' }));
        return;
      }
      if (!canvasToImage(rf.fit, x, y)) {
        setSamUi((u) => ({ ...u, text: '点落在参考图之外' }));
        return;
      }
      const label: 1 | 0 = e.button === 2 || e.altKey ? 0 : 1;
      if (label === 1 && !samViewpointRef.current) samViewpointRef.current = { x, y };
      if (label === 0 && !samViewpointRef.current) {
        setSamUi((u) => ({ ...u, text: '先左键点一个正点（确定提取侧与线外阴影）' }));
        return;
      }
      samPointsRef.current = [...samPointsRef.current, { x, y, label }];
      setSamUi((u) => ({ ...u, points: samPointsRef.current.length }));
      drawSamPreview();
      void runSamSegment();
      return;
    }
    isDrawing.current = true;
    if (paintMode === 'barrier') {
      lastBarrierPos.current = null; // 新笔画
    } else {
      // 落笔设锚点（绘制模式）：落在墙上则锚点为空，待笔尖移出墙面再立
      if (paintMode === 'draw') {
        const alpha = getBarrierAlpha();
        strokeAnchorRef.current = alpha && alpha[y * canvasWidth + x]! > 10 ? null : { x, y };
      }
      lastStampPos.current = { x, y };
    }
    drawAt(x, y);
  };

  const handleMove = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    // 更新光标位置（显示笔刷大小）
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
    if (!isDrawing.current) return;
    if (paintMode === 'barrier') {
      drawAt(x, y); // 线条靠 lineTo 自带连续性
      return;
    }
    // 绘制/擦除：相邻采样点间插值盖章，快拖不留点状断口
    const last = lastStampPos.current;
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, brushSize / 4);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) {
        drawAt(Math.round(last.x + (dx * i) / n), Math.round(last.y + (dy * i) / n));
      }
    } else {
      drawAt(x, y);
    }
    lastStampPos.current = { x, y };
  };

  const handleUp = () => {
    isDrawing.current = false;
    lastBarrierPos.current = null;
    lastStampPos.current = null;
    strokeAnchorRef.current = null;
  };

  const handleLeave = () => {
    isDrawing.current = false;
    lastBarrierPos.current = null;
    lastStampPos.current = null;
    strokeAnchorRef.current = null;
    setCursorPos(null);
  };

  const handleConfirm = async () => {
    const maskCanvas = canvasRef.current;
    if (!maskCanvas || !maskNodeId || !referenceImageUrl) {
      setEditMode('normal');
      setMaskNodeId(null);
      return;
    }

    try {
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
      const maskData = maskCtx.getImageData(0, 0, canvasWidth, canvasHeight);

      const refData = await getReferenceImageData();
      if (!refData) {
        setEditMode('normal');
        setMaskNodeId(null);
        return;
      }

      let minX = canvasWidth, minY = canvasHeight, maxX = -1, maxY = -1;
      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          const idx = (y * canvasWidth + x) * 4;
          if (maskData.data[idx + 3] > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < 0) {
        setEditMode('normal');
        setMaskNodeId(null);
        return;
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const projectStore = useProjectStore.getState();
      // 找到拥有该节点的角色（新模型：unifiedCharacters）
      const unifiedCharacters = projectStore.unifiedCharacters ?? {};
      let ownerId: string | null = null;
      let ownerChar: (typeof unifiedCharacters)[string] | null = null;
      for (const [id, ch] of Object.entries(unifiedCharacters)) {
        if (ch.nodes[maskNodeId]) {
          ownerId = id;
          ownerChar = ch;
          break;
        }
      }
      const nodeName = ownerChar?.nodes[maskNodeId]?.name ?? '未知';

      // 抠图转正口径：取节点在当前对位姿态下的世界变换（与画布渲染同一条
      // computeWorldTransforms + projectToView 口径）。plug 直接落在关节的画布
      // 位置上，采样后按 −世界角把精灵转回节点局部规范朝向——装配渲染时节点
      // 转回对位姿态即与参考图重合，任何其他姿态下精灵与骨骼的相对朝向恒定，
      // 不再需要 nodeOffsets 之类的事后角度补偿。
      let nodeCanvas: { x: number; y: number; angle: number } | null = null;
      if (ownerChar) {
        const wts = computeWorldTransforms(
          ownerChar,
          projectStore.currentFrame,
          canvasWidth,
          canvasHeight,
          undefined,
          undefined,
          undefined,
          undefined,
          geometryDirectionFromToggle(useEditorStore.getState().nodeTurn3D),
        );
        const wt = wts.get(maskNodeId);
        if (wt) {
          const rootNodeForDir = ownerChar.nodes[ownerChar.rootNodeId];
          const currentDirection = (rootNodeForDir?.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
          const proj = projectToView(wt.worldX, wt.worldY, wt.worldZ, currentDirection);
          nodeCanvas = {
            x: subToPx(proj.canvasX) + canvasWidth / 2,
            y: subToPx(proj.canvasY) + canvasHeight / 2,
            angle: wt.worldAngle,
          };
        }
      }

      const sprite = projectStore.addSprite(`遮罩_${nodeName}`, w, h, {
        plugX: nodeCanvas ? nodeCanvas.x - minX : Math.floor(w / 2),
        plugY: nodeCanvas ? nodeCanvas.y - minY : Math.floor(h / 2),
      });

      const pixels: string[][] = [];
      for (let y = 0; y < h; y++) {
        const row: string[] = [];
        for (let x = 0; x < w; x++) {
          const sx = minX + x;
          const sy = minY + y;
          const maskIdx = (sy * canvasWidth + sx) * 4;
          const refIdx = (sy * canvasWidth + sx) * 4;
          if (maskData.data[maskIdx + 3] > 10) {
            const r = refData.data[refIdx];
            const g = refData.data[refIdx + 1];
            const b = refData.data[refIdx + 2];
            const a = refData.data[refIdx + 3];
            // 色键过滤：精确匹配色键颜色的像素视为透明
            const isKey = keyColor && a >= 10 &&
              r === keyColor.r && g === keyColor.g && b === keyColor.b;
            row.push(a < 10 || isKey ? '' : `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`);
          } else {
            row.push('');
          }
        }
        pixels.push(row);
      }
      projectStore.setSpritePixels(sprite.id!, pixels);
      console.log('[MaskBrush] 已生成 Sprite:', sprite.id);

      // 转正：绕 plug（关节）按 −世界角旋转精灵内容（transformSprite 绕锚点烘焙，
      // plug 随旋转更新）。角度归一到 (−180, 180]，近零跳过（轴对齐采样即规范朝向）。
      if (nodeCanvas) {
        let theta = nodeCanvas.angle % 360;
        if (theta > 180) theta -= 360;
        if (theta <= -180) theta += 360;
        if (Math.abs(theta) >= 0.5) {
          projectStore.transformSprite(sprite.id!, { kind: 'rotate', angleDeg: -theta });
        }
      }

      // 关联到节点：只写当前激活服装的 pieces（新模型），不改模板节点的 sprite
      // （模板是共享的，服装才是向导产物）
      if (maskNodeId) {
        if (ownerChar && ownerId) {
          // 只写当前激活服装，只写当前方向（对位时选择的方向），不写四个方向
          // 方向：从角色根节点的 transform.variantIndex 读取（新模型）
          const rootNode = ownerChar.nodes[ownerChar.rootNodeId];
          const dirIndex = (rootNode?.transform.variantIndex ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
          const activeCsId = ownerChar.activeCostumeSetId;
          const activeCs = (ownerChar.costumeSets ?? []).find((cs) => cs.id === activeCsId);
          if (activeCs) {
            // Sprite 已在全局表，直接引用 ID（无需转换）
            const spriteId = sprite.id!;
            // 用 slotKey（不是 nodeId）——渲染器按 costumeSet.pieces[node.slot.slotKey] 查找
            const node = ownerChar.nodes[maskNodeId];
            const slotKey = node?.slot?.slotKey ?? maskNodeId;
            const pieces = { ...activeCs.pieces };
            const piece = pieces[slotKey] ?? createDefaultCostumePiece(slotKey);
            pieces[slotKey] = {
              ...piece,
              sprites: { ...piece.sprites, [dirIndex]: { spriteId } },
            };
            const newCostumeSets = ownerChar.costumeSets.map((cs) =>
              cs.id === activeCs.id ? { ...cs, pieces } : cs
            );
            projectStore.updateUnifiedCharacter(ownerId, {
              costumeSets: newCostumeSets,
            });
            setLastUpdateInfo(
              `节点 ${maskNodeId.slice(0, 8)} → 角色 ${ownerId.slice(0, 8)} → Sprite ${spriteId.slice(0, 12)} ✓成功`
            );
          } else {
            setLastUpdateInfo(`✗角色没有激活服装集`);
          }
        } else {
          setLastUpdateInfo(`✗找不到节点所在角色: ${maskNodeId.slice(0, 8)}`);
        }
        console.log('[MaskBrush] 已关联到节点:', maskNodeId);
        // 通知向导更新进度
        window.dispatchEvent(
          new CustomEvent('ref-assembly:mask-done', { detail: { nodeId: maskNodeId } })
        );
      }

      // 显示轴心编辑器（直接编辑全局表中的 Sprite，无需回写）
      const fullSprite = useProjectStore.getState().sprites[sprite.id!];
      if (fullSprite) {
        setExtractedSprite(fullSprite);
        return; // 不立即退出，等轴心确认后再退出
      }
    } catch (err) {
      console.error('[MaskBrush] 提取失败:', err);
    }

    setEditMode('normal');
    setMaskNodeId(null);
  };

  const handlePivotClose = () => {
    // PivotEditor 直接编辑全局表中的 Sprite，无需回写
    setExtractedSprite(null);
    setEditMode('normal');
    setMaskNodeId(null);
    // 返回向导继续下一个肢体
    useEditorStore.getState().setRefWizardOpen(true);
  };

  const handleCancel = () => {
    setEditMode('normal');
    setMaskNodeId(null);
    // 向导一直挂载，无需重新打开
  };

  return (
    <>
      {/* 防溢出线 canvas（蓝色 1px，z-39 在遮罩之下） */}
      <canvas
        ref={barrierCanvasRef}
        className="absolute z-[39] pointer-events-none"
        style={{
          imageRendering: 'pixelated',
          left: panX,
          top: panY,
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute z-40"
        style={{
          cursor: isPicking ? 'copy' : paintMode === 'sam' ? 'crosshair' : 'none',
          imageRendering: 'pixelated',
          left: panX,
          top: panY,
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
        }}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={handleLeave}
        onContextMenu={(e) => {
          if (paintMode === 'sam') e.preventDefault();
        }}
      />
      {/* SAM 预览层（线外压暗 + 结果绿罩 + 点位标记），不拦截指针 */}
      <canvas
        ref={samPreviewCanvasRef}
        className="absolute z-40 pointer-events-none"
        style={{
          imageRendering: 'pixelated',
          left: panX,
          top: panY,
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
        }}
      />
      {/* 笔刷大小光标 */}
      {cursorPos && !isPicking && (paintMode === 'draw' || paintMode === 'erase') && (
        <div
          className="absolute z-[41] pointer-events-none rounded-full border-2"
          style={{
            left: panX + cursorPos.x - (brushSize * zoom) / 2,
            top: panY + cursorPos.y - (brushSize * zoom) / 2,
            width: brushSize * zoom,
            height: brushSize * zoom,
            borderColor: paintMode === 'erase' ? 'rgba(255,255,255,0.8)' : 'rgba(255,0,0,0.8)',
          }}
        />
      )}
      {cursorPos && !isPicking && paintMode === 'barrier' && (
        <div
          className="absolute z-[41] pointer-events-none rounded-full border-2 border-blue-400"
          style={{
            left: panX + cursorPos.x - 3,
            top: panY + cursorPos.y - 3,
            width: 6,
            height: 6,
          }}
        />
      )}
      {/* 遮罩模式工具条 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs pointer-events-auto z-50"
        style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', backdropFilter: 'blur(4px)' }}>
        <span className="text-purple-300 font-medium">遮罩绘制</span>
        <span className="text-gray-400">|</span>
        {/* 模式切换：绘制 / 擦除 / 防溢出线 */}
        <div className="flex rounded overflow-hidden border border-white/20">
          {([
            { mode: 'draw' as const, label: '绘制' },
            { mode: 'erase' as const, label: '擦除' },
            { mode: 'barrier' as const, label: '防溢出线' },
            { mode: 'sam' as const, label: 'SAM提取' },
          ]).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setPaintMode(mode)}
              className={`px-2 h-6 text-[11px] transition-colors ${
                paintMode === mode
                  ? mode === 'barrier'
                    ? 'bg-blue-600 text-white'
                    : mode === 'sam'
                      ? 'bg-green-600 text-white'
                      : 'bg-red-600 text-white'
                  : 'bg-transparent text-gray-300 hover:bg-white/10'
              }`}
              title={
                mode === 'barrier'
                  ? '画1px蓝色线条，绘制时笔刷不会跨过线条'
                  : mode === 'sam'
                    ? '点选提取肢体；已画的防溢出线之外不输入 SAM'
                    : undefined
              }
            >
              {label}
            </button>
          ))}
        </div>
        {(paintMode === 'draw' || paintMode === 'erase') && (
          <label className="text-gray-300 flex items-center gap-1">
            笔刷
            <input
              type="range"
              min={2}
              max={32}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-16"
            />
            {brushSize}px
          </label>
        )}
        {paintMode === 'barrier' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-gray-400"
            onClick={() => {
              const bCanvas = barrierCanvasRef.current;
              if (bCanvas) bCanvas.getContext('2d')!.clearRect(0, 0, canvasWidth, canvasHeight);
              hasBarrierRef.current = false;
              strokeAnchorRef.current = null;
              barrierVersionRef.current++;
              alphaCacheRef.current = null;
              barrierStrokesRef.current = [];
              resetSamSession();
            }}
          >
            清除线条
          </Button>
        )}
        {paintMode === 'sam' && (
          <>
            <Button
              size="sm"
              className="h-6 text-[11px]"
              onClick={applySamToMask}
              disabled={!samUi.hasResult}
            >
              应用到遮罩
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] text-gray-400"
              onClick={resetSamSession}
              disabled={samUi.points === 0 && !samUi.hasResult}
            >
              清除点
            </Button>
          </>
        )}
        <span className="text-gray-400">|</span>
        {/* 色键取色 */}
        <Button
          size="sm"
          variant={isPicking ? "default" : "outline"}
          className="h-6 text-[11px]"
          onClick={() => setIsPicking(!isPicking)}
          title="点击参考图取色键颜色"
        >
          {isPicking ? "取色中…" : "取色"}
        </Button>
        {keyColor && (
          <>
            <span
              className="w-5 h-5 rounded border border-white/30 inline-block"
              style={{ backgroundColor: `rgb(${keyColor.r},${keyColor.g},${keyColor.b})` }}
              title={`rgb(${keyColor.r},${keyColor.g},${keyColor.b})`}
            />
            <Button size="sm" variant="ghost" className="h-6 text-[11px] text-gray-500" onClick={() => setKeyColor(null)}>
              清除
            </Button>
          </>
        )}
        <Button size="sm" className="h-6 text-[11px]" onClick={handleConfirm}>确认</Button>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={handleCancel}>取消</Button>
      </div>
      {/* 更新状态显示 */}
      {lastUpdateInfo && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-[11px] pointer-events-none z-50"
          style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <span className={lastUpdateInfo.includes('✓') ? 'text-green-400' : 'text-red-400'}>
            {lastUpdateInfo}
          </span>
        </div>
      )}
      {/* SAM 提取状态 */}
      {paintMode === 'sam' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-[11px] pointer-events-none z-50 whitespace-nowrap"
          style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(34,255,136,0.35)' }}>
          <span className="text-green-300">{samUi.text}</span>
        </div>
      )}
      {/* 轴心编辑器 */}
      {extractedSprite && (
        <PivotEditor sprite={extractedSprite} onClose={handlePivotClose} />
      )}
    </>
  );
}
