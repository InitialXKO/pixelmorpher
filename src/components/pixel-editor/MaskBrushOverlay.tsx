'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEditorStore, useProjectStore } from '@/lib/store';
import PivotEditor from './puppet/PivotEditor';
import type { Sprite } from '@/lib/unified-types';
import {
  createDefaultCostumePiece,
  puppetDirectionToIndex,
} from '@/lib/unified-types';

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
  const [brushSize, setBrushSize] = useState(8);
  const [extractedSprite, setExtractedSprite] = useState<Sprite | null>(null);
  const [lastUpdateInfo, setLastUpdateInfo] = useState<string | null>(null);
  // 绘制模式：draw=绘制，erase=擦除，barrier=防溢出线
  const [paintMode, setPaintMode] = useState<'draw' | 'erase' | 'barrier'>('draw');
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
  }, [canvasWidth, canvasHeight, maskNodeId]);

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
    const refCtx = refCanvas.getContext('2d')!;
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


  // 检查从 (cx,cy) 到 (x,y) 的射线是否穿过防溢出线
  const rayCrossesBarrier = (
    barrierData: ImageData,
    cx: number, cy: number,
    x: number, y: number
  ): boolean => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) return false;
    const steps = Math.ceil(dist);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = Math.round(cx + dx * t);
      const py = Math.round(cy + dy * t);
      if (px < 0 || py < 0 || px >= canvasWidth || py >= canvasHeight) continue;
      const idx = (py * canvasWidth + px) * 4;
      if (barrierData.data[idx + 3] > 10) return true;
    }
    return false;
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
      lastBarrierPos.current = { x, y };
      return;
    }

    const erase = paintMode === 'erase';
    const radius = brushSize / 2;

    // 获取防溢出线数据（用于约束）
    let barrierData: ImageData | null = null;
    const bCanvas = barrierCanvasRef.current;
    if (bCanvas) {
      barrierData = bCanvas.getContext('2d')!.getImageData(0, 0, canvasWidth, canvasHeight);
    }

    if (erase) {
      // 擦除：不受防溢出线约束
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // 绘制：逐像素检查防溢出线
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,0,0,0.5)';
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(canvasWidth - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(canvasHeight - 1, Math.ceil(y + radius));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - x;
        const dy = py - y;
        if (dx * dx + dy * dy > radius * radius) continue;
        // 防溢出：射线穿过线条则跳过（只保留笔刷中心一侧）
        if (barrierData && rayCrossesBarrier(barrierData, x, y, px, py)) continue;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  };

  const handleDown = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    if (isPicking) {
      handlePick(x, y);
      return;
    }
    isDrawing.current = true;
    if (paintMode === 'barrier') {
      lastBarrierPos.current = null; // 新笔画
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
    drawAt(x, y);
  };

  const handleUp = () => {
    isDrawing.current = false;
    lastBarrierPos.current = null;
  };

  const handleLeave = () => {
    isDrawing.current = false;
    lastBarrierPos.current = null;
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
      const maskCtx = maskCanvas.getContext('2d')!;
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
      // 找节点名用于 Part 命名（新模型：从 unifiedCharacters 查）
      const unifiedCharacters = projectStore.unifiedCharacters ?? {};
      let nodeName = '未知';
      for (const ch of Object.values(unifiedCharacters)) {
        const node = ch.nodes[maskNodeId];
        if (node) { nodeName = node.name; break; }
      }
      const sprite = projectStore.addSprite(`遮罩_${nodeName}`, w, h, {
        plugX: Math.floor(w / 2),
        plugY: Math.floor(h / 2),
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

      // 关联到节点：只写当前激活服装的 pieces（新模型），不改模板节点的 sprite
      // （模板是共享的，服装才是向导产物）
      if (maskNodeId) {
        const unifiedChars = projectStore.unifiedCharacters ?? {};
        // 找到拥有该节点的角色（新模型：unifiedCharacters）
        let ownerId: string | null = null;
        let ownerChar: (typeof unifiedChars)[string] | null = null;
        for (const [id, ch] of Object.entries(unifiedChars)) {
          if (ch.nodes[maskNodeId]) {
            ownerId = id;
            ownerChar = ch;
            break;
          }
        }
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
          cursor: isPicking ? 'copy' : 'none',
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
      />
      {/* 笔刷大小光标 */}
      {cursorPos && !isPicking && paintMode !== 'barrier' && (
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
          ]).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setPaintMode(mode)}
              className={`px-2 h-6 text-[11px] transition-colors ${
                paintMode === mode
                  ? mode === 'barrier'
                    ? 'bg-blue-600 text-white'
                    : 'bg-red-600 text-white'
                  : 'bg-transparent text-gray-300 hover:bg-white/10'
              }`}
              title={mode === 'barrier' ? '画1px蓝色线条，绘制时笔刷不会跨过线条' : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        {paintMode !== 'barrier' && (
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
            }}
          >
            清除线条
          </Button>
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
      {/* 轴心编辑器 */}
      {extractedSprite && (
        <PivotEditor sprite={extractedSprite} onClose={handlePivotClose} />
      )}
    </>
  );
}
