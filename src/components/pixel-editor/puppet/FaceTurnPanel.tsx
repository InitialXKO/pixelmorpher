'use client';

import React, { useMemo, useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Crosshair, KeyRound } from 'lucide-react';
import { useProjectStore, useEditorStore } from '@/lib/store';
import type { Node, Character } from '@/lib/unified-types';
import {
  DEFAULT_FACE_FEATURES, clampFaceFeatures, faceFeaturePoints, faceHalfWidths,
  type FaceFeatureParams,
} from '@/lib/face-features';
import {
  allLibraryEntries, faceDefOf, faceEntriesOf, libraryIndexOf, loadUserEntries, saveUserEntries,
  type LibraryEntry,
} from '@/lib/library-entries';

// ---- Node FaceTurn Panel（蒙皮转面：方向内微动） ----
// yaw/pitch 滑杆 → node.faceTurn（updateUnifiedNode，带撤销）
// "打关键帧" → 写转面轨在当前帧的点（setNodeFaceTurnKey）
// "标注特征点" → 进 sprite_edit + landmark 工具（标注该节点当前方向的精灵）

export function FaceTurnPanel({
  character,
  node,
}: {
  character: Character;
  node: Node;
}) {
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const setNodeFaceTurnKey = useProjectStore((s) => s.setNodeFaceTurnKey);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const setTool = useEditorStore((s) => s.setTool);
  const enterSpriteEditMode = useEditorStore((s) => s.enterSpriteEditMode);

  const faceTurn = node.faceTurn ?? { yaw: 0, pitch: 0 };

  const handleYaw = useCallback(
    (v: number) => {
      updateUnifiedNode(character.id, node.id, {
        faceTurn: { yaw: v, pitch: faceTurn.pitch },
      });
    },
    [character.id, node.id, faceTurn.pitch, updateUnifiedNode]
  );

  const handlePitch = useCallback(
    (v: number) => {
      updateUnifiedNode(character.id, node.id, {
        faceTurn: { yaw: faceTurn.yaw, pitch: v },
      });
    },
    [character.id, node.id, faceTurn.yaw, updateUnifiedNode]
  );

  const handleKeyframe = useCallback(() => {
    setNodeFaceTurnKey(character.id, node.id, currentFrame, {
      yaw: faceTurn.yaw, pitch: faceTurn.pitch,
    });
  }, [character.id, node.id, currentFrame, faceTurn, setNodeFaceTurnKey]);

  // 找到该节点当前方向的精灵，进 sprite_edit 标注
  const handleAnnotate = useCallback(() => {
    // 用 unified-render 的 resolveNodeSpriteId（懒加载避免循环依赖）
    const { resolveNodeSpriteId } = require('@/lib/unified-render') as typeof import('@/lib/unified-render');
    const direction = (node.transform.variantIndex ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const sprites = useProjectStore.getState().sprites ?? {};
    const spriteId = resolveNodeSpriteId(character, node.id, direction, sprites);
    if (spriteId) {
      useEditorStore.getState().selectPart(spriteId);
      enterSpriteEditMode(spriteId);
      setTool('landmark');
    }
  }, [character, node, enterSpriteEditMode, setTool]);

  return (
    <div className="space-y-3 p-1">
      <div className="text-[10px] text-gray-500">
        转面微动 · {node.name}（单张图模拟转头，不用多角度差分）
      </div>

      {/* yaw */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-400">左右转 yaw</Label>
          <span className="text-[10px] text-cyan-300 font-mono">
            {faceTurn.yaw.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[faceTurn.yaw]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={([v]) => handleYaw(v)}
          className="w-full"
        />
        <div className="flex justify-between text-[8px] text-gray-600">
          <span>← 左</span>
          <span>右 →</span>
        </div>
      </div>

      {/* pitch */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-400">上下转 pitch</Label>
          <span className="text-[10px] text-cyan-300 font-mono">
            {faceTurn.pitch.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[faceTurn.pitch]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={([v]) => handlePitch(v)}
          className="w-full"
        />
        <div className="flex justify-between text-[8px] text-gray-600">
          <span>← 上</span>
          <span>下 →</span>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[10px] border-[#1e1e3a] text-gray-300 hover:text-white gap-1"
          onClick={handleKeyframe}
          title={`在第 ${currentFrame} 帧记录转面`}
        >
          <KeyRound className="size-3" />
          打关键帧
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[10px] border-[#1e1e3a] text-gray-300 hover:text-white gap-1"
          onClick={handleAnnotate}
        >
          <Crosshair className="size-3" />
          标注特征点
        </Button>
      </div>

      <div className="text-[9px] text-gray-600 leading-relaxed">
        有手动标注（眼/鼻/嘴）时转面用标注位置算深度，无标注时回退亮度启发式。
      </div>

      <FaceFeaturesSection character={character} node={node} />
    </div>
  );
}

// ---- 五官点位（角色级可调参数：相对头部框的比例，存 node.faceFeatures） ----
// 预览按当前 yaw/pitch 现算转面压缩；在预览上拖点改比例（拖动经逆变换
// 写回未压缩参数），滑杆微调；参数组可套用/另存模式库脸型条目。
function FaceFeaturesSection({ character, node }: { character: Character; node: Node }) {
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const params: FaceFeatureParams = node.faceFeatures ?? DEFAULT_FACE_FEATURES;
  const faceTurn = node.faceTurn ?? { yaw: 0, pitch: 0 };
  const pts = faceFeaturePoints(params, faceTurn.yaw, faceTurn.pitch);
  const hw = faceHalfWidths(params, faceTurn.yaw);
  const [presetId, setPresetId] = useState('');
  const [entriesVersion, setEntriesVersion] = useState(0);
  const faceEntries = useMemo(() => faceEntriesOf(allLibraryEntries()), [entriesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const dragRef = useRef<null | 'brow' | 'eye' | 'nose' | 'mouth'>(null);

  const setParams = useCallback(
    (patch: Partial<FaceFeatureParams>) => {
      updateUnifiedNode(character.id, node.id, {
        faceFeatures: clampFaceFeatures({ ...(node.faceFeatures ?? DEFAULT_FACE_FEATURES), ...patch }),
      });
    },
    [character.id, node.id, node.faceFeatures, updateUnifiedNode],
  );

  // 预览坐标（SVG 120×144 即头部框）↔ 参数：拖点时逆转面压缩
  const onDragMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const kind = dragRef.current;
    if (!kind) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const invY = 0.5 + (ry - 0.5 - 0.06 * faceTurn.pitch) / (1 - 0.25 * Math.abs(faceTurn.pitch));
    if (kind === 'brow') setParams({ browY: invY });
    else if (kind === 'nose') setParams({ noseBaseY: invY });
    else if (kind === 'mouth') setParams({ mouthY: invY });
    else if (kind === 'eye') {
      const xScale = 1 - 0.55 * Math.abs(faceTurn.yaw);
      const offset = (rx - 0.5 - 0.18 * faceTurn.yaw) / (xScale || 1);
      setParams({ eyeY: invY, eyeSpacing: Math.abs(offset) * 2 });
    }
  };

  const applyPreset = () => {
    if (!presetId) return;
    const got = faceDefOf(libraryIndexOf(allLibraryEntries()), presetId);
    if (got) updateUnifiedNode(character.id, node.id, { faceFeatures: { ...got.def.params } });
  };
  const savePreset = () => {
    const name = window.prompt('存入模式库（脸型预设），名称', '我的脸型')?.trim();
    if (!name) return;
    const entry: LibraryEntry = {
      id: `user-face-${Date.now().toString(36)}`, kind: 'face', name,
      cluster: '我的', latest: 1, versions: { 1: { kind: 'face', params: { ...params } } },
    };
    saveUserEntries([...loadUserEntries(), entry]);
    setEntriesVersion((v) => v + 1);
    window.alert(`已存入模式库：${name}`);
  };

  const W = 120, H = 144;
  const seg = (cx: number, cy: number, halfW: number, key: string, kind: typeof dragRef.current) => (
    <g key={key}>
      <line x1={(cx - halfW) * W} y1={cy * H} x2={(cx + halfW) * W} y2={cy * H} stroke="#67e8f9" strokeWidth={2} />
      <circle
        cx={cx * W} cy={cy * H} r={5} fill="#164e63" stroke="#67e8f9" strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onPointerDown={(e) => { dragRef.current = kind; (e.target as Element).setPointerCapture?.(e.pointerId); }}
      />
    </g>
  );

  return (
    <div className="space-y-2 border-t border-[#1e1e3a] pt-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-300">五官点位（相对头部框比例）</Label>
        <button className="text-[9px] text-gray-500 hover:text-gray-300" onClick={() => updateUnifiedNode(character.id, node.id, { faceFeatures: { ...DEFAULT_FACE_FEATURES } })}>
          恢复标准三庭
        </button>
      </div>
      <div className="flex justify-center">
        <svg
          width={W} height={H} className="rounded bg-[#101020]"
          onPointerMove={onDragMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerLeave={() => { dragRef.current = null; }}
        >
          <ellipse cx={W / 2} cy={H / 2} rx={W * 0.36} ry={H * 0.48} fill="#23233c" stroke="#3d3d5c" />
          {seg(pts.browL.x, pts.browL.y, hw.eye * 0.8, 'browL', 'brow')}
          {seg(pts.browR.x, pts.browR.y, hw.eye * 0.8, 'browR', 'brow')}
          {seg(pts.eyeL.x, pts.eyeL.y, hw.eye, 'eyeL', 'eye')}
          {seg(pts.eyeR.x, pts.eyeR.y, hw.eye, 'eyeR', 'eye')}
          {seg(pts.noseBase.x, pts.noseBase.y, hw.nose, 'nose', 'nose')}
          {seg(pts.mouth.x, pts.mouth.y, hw.mouth, 'mouth', 'mouth')}
        </svg>
      </div>
      <p className="text-[9px] text-gray-600 leading-relaxed">
        拖点改比例（纵向改线高、拖眼点横向改眼距）；预览随上方 yaw/pitch 做转面压缩。主画布右键开「五官参照」可在画布上叠点位照着画。
      </p>
      {([
        ['眉线高', 'browY', params.browY, 0, 1],
        ['眼线高', 'eyeY', params.eyeY, 0, 1],
        ['眼距', 'eyeSpacing', params.eyeSpacing, 0.1, 0.9],
        ['鼻底高', 'noseBaseY', params.noseBaseY, 0, 1],
        ['嘴线高', 'mouthY', params.mouthY, 0, 1],
      ] as const).map(([label, key, v, min, max]) => (
        <div key={key} className="flex items-center gap-2">
          <Label className="text-[10px] text-gray-400 w-10">{label}</Label>
          <Slider value={[v]} min={min} max={max} step={0.01} onValueChange={([nv]) => setParams({ [key]: nv })} className="flex-1" />
          <span className="text-[10px] text-cyan-300 font-mono w-8 text-right">{v.toFixed(2)}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="h-6 flex-1 text-[10px] bg-[#111128] border border-[#1e1e3a] rounded text-gray-300">
          <option value="">脸型预设…</option>
          {faceEntries.map((e) => (
            <option key={e.id} value={e.id}>{e.name}{e.builtin ? '' : '（我的）'}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-[#1e1e3a] text-gray-300" disabled={!presetId} onClick={applyPreset}>套用</Button>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-[#1e1e3a] text-gray-300" onClick={savePreset}>存为预设</Button>
      </div>
    </div>
  );
}
