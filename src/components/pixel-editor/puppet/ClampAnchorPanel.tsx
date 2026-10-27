'use client';

// ============================================================
// ClampAnchorPanel — 钳制锚定管理 UI
// 指定点（节点/节点对/像素/像素对/精灵边缘）× 触发（高度/目标点/
// 范围/场景）。锚定 = 点全位置冻结不滑动、整角色反向横移；多锚硬
// 优先级（数值大者先）；resettle = 反移后重解开关（逐锚可设）。
// scene 触发不在编辑器采样（运行时按 anchor 点标记对全部固体自动
// 锚定，效果在程序化预览面板看）。
// ============================================================

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Power, Anchor as AnchorIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/lib/store';
import { peekClampFrozen } from '@/lib/clamp-session';
import type { Character, ClampAnchor, ClampPointRef, ClampTrigger } from '@/lib/unified-types';

interface Props {
  character: Character | null;
}

const numCls = 'w-14 bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[11px] text-gray-200';
const selCls = 'bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[11px] text-gray-200';
const txtCls = 'bg-[#12122a] border border-[#2a2a4a] rounded px-1 py-0.5 text-[11px] text-gray-200';

function Num({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      className={numCls}
      value={Number.isFinite(value) ? value : 0}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  );
}

export default function ClampAnchorPanel({ character }: Props) {
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  // 订阅当前帧让生效状态随播放刷新
  useProjectStore((s) => s.currentFrame);
  const [newNodeId, setNewNodeId] = useState<string>('');

  const nodes = useMemo(() => (character ? Object.values(character.nodes) : []), [character]);
  const anchors = character?.clampAnchors ?? [];
  const frozen = character ? peekClampFrozen(character.id) : null;

  if (!character) return <div className="text-[11px] text-gray-500">未选中角色</div>;

  const save = (next: ClampAnchor[]) => updateUnifiedCharacter(character.id, { clampAnchors: next });
  const patch = (id: string, p: Partial<ClampAnchor>) =>
    save(anchors.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const patchPoint = (id: string, point: ClampPointRef) => patch(id, { point });
  const patchTrigger = (id: string, trigger: ClampTrigger) => patch(id, { trigger });

  const nodeOptions = nodes.map((n) => (
    <option key={n.id} value={n.id}>{n.name}</option>
  ));
  const nodeSelect = (value: string, onChange: (v: string) => void) => (
    <select className={selCls} value={value} onChange={(e) => onChange(e.target.value)}>{nodeOptions}</select>
  );

  const pointEditor = (a: ClampAnchor) => {
    const p = a.point;
    const kindSel = (
      <select
        className={selCls}
        value={p.kind}
        onChange={(e) => {
          const k = e.target.value as ClampPointRef['kind'];
          const firstNode = p.kind === 'pixelPair' ? p.a.nodeId : ('nodeId' in p ? p.nodeId : nodes[0]?.id ?? '');
          if (k === 'node') patchPoint(a.id, { kind: 'node', nodeId: firstNode });
          else if (k === 'nodePair') patchPoint(a.id, { kind: 'nodePair', nodeId: firstNode, nodeId2: nodes[1]?.id ?? firstNode });
          else if (k === 'pixel') patchPoint(a.id, { kind: 'pixel', nodeId: firstNode, mark: 'sole' });
          else if (k === 'pixelPair') patchPoint(a.id, { kind: 'pixelPair', a: { nodeId: firstNode, mark: 'sole' }, b: { nodeId: firstNode, mark: 'heel' } });
          else patchPoint(a.id, { kind: 'spriteEdge', nodeId: firstNode, edge: 'bottom' });
        }}
      >
        <option value="node">节点</option>
        <option value="nodePair">节点对</option>
        <option value="pixel">像素点</option>
        <option value="pixelPair">像素对</option>
        <option value="spriteEdge">精灵边缘</option>
      </select>
    );
    const pixelFields = (
      sel: { mark?: string; x?: number; y?: number },
      onChange: (s: { mark?: string; x?: number; y?: number }) => void,
    ) => (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span className="text-gray-500">标记</span>
        <input className={txtCls + ' w-16'} value={sel.mark ?? ''} placeholder="如 sole"
          onChange={(e) => onChange({ ...sel, mark: e.target.value || undefined })} />
        <span className="text-gray-500">或坐标</span>
        <Num value={sel.x ?? 0} onChange={(v) => onChange({ ...sel, x: v })} />
        <Num value={sel.y ?? 0} onChange={(v) => onChange({ ...sel, y: v })} />
      </span>
    );
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-gray-500">点</span>
        {kindSel}
        {(p.kind === 'node') && nodeSelect(p.nodeId, (v) => patchPoint(a.id, { kind: 'node', nodeId: v }))}
        {(p.kind === 'nodePair') && (<>
          {nodeSelect(p.nodeId, (v) => patchPoint(a.id, { ...p, nodeId: v }))}
          {nodeSelect(p.nodeId2, (v) => patchPoint(a.id, { ...p, nodeId2: v }))}
        </>)}
        {(p.kind === 'pixel') && (<>
          {nodeSelect(p.nodeId, (v) => patchPoint(a.id, { ...p, nodeId: v }))}
          {pixelFields(p, (s) => patchPoint(a.id, { kind: 'pixel', nodeId: p.nodeId, ...s }))}
        </>)}
        {(p.kind === 'pixelPair') && (<>
          {nodeSelect(p.a.nodeId, (v) => patchPoint(a.id, { ...p, a: { ...p.a, nodeId: v } }))}
          {pixelFields(p.a, (s) => patchPoint(a.id, { ...p, a: { ...p.a, ...s } }))}
          {nodeSelect(p.b.nodeId, (v) => patchPoint(a.id, { ...p, b: { ...p.b, nodeId: v } }))}
          {pixelFields(p.b, (s) => patchPoint(a.id, { ...p, b: { ...p.b, ...s } }))}
        </>)}
        {(p.kind === 'spriteEdge') && (<>
          {nodeSelect(p.nodeId, (v) => patchPoint(a.id, { ...p, nodeId: v }))}
          <select className={selCls} value={p.edge} onChange={(e) => patchPoint(a.id, { ...p, edge: e.target.value as 'top' | 'bottom' | 'left' | 'right' })}>
            <option value="bottom">下边</option>
            <option value="top">上边</option>
            <option value="left">左边</option>
            <option value="right">右边</option>
          </select>
        </>)}
      </div>
    );
  };

  const triggerEditor = (a: ClampAnchor) => {
    const t = a.trigger;
    const kindSel = (
      <select
        className={selCls}
        value={t.kind}
        onChange={(e) => {
          const k = e.target.value as ClampTrigger['kind'];
          if (k === 'height') patchTrigger(a.id, { kind: 'height', y: 0, side: 'below' });
          else if (k === 'point') patchTrigger(a.id, { kind: 'point', target: { x: 0, y: 0, z: 0 }, radius: 6 });
          else if (k === 'range') patchTrigger(a.id, { kind: 'range', shape: 'rect', rect: { x: -40, y: 0, w: 80, h: 60 } });
          else patchTrigger(a.id, { kind: 'scene' });
        }}
      >
        <option value="height">钳制高度</option>
        <option value="point">目标点</option>
        <option value="range">目标范围</option>
        <option value="scene">场景固体（运行时）</option>
      </select>
    );
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-gray-500">触发</span>
        {kindSel}
        {t.kind === 'height' && (<>
          <span className="text-gray-500">y</span>
          <Num value={t.y} onChange={(v) => patchTrigger(a.id, { ...t, y: v })} />
          <select className={selCls} value={t.side} onChange={(e) => patchTrigger(a.id, { ...t, side: e.target.value as 'below' | 'above' })}>
            <option value="below">到达/越过（向下）</option>
            <option value="above">到达/越过（向上）</option>
          </select>
        </>)}
        {t.kind === 'point' && (<>
          <span className="text-gray-500">目标</span>
          <Num value={t.target.x} onChange={(v) => patchTrigger(a.id, { ...t, target: { ...t.target, x: v } })} />
          <Num value={t.target.y} onChange={(v) => patchTrigger(a.id, { ...t, target: { ...t.target, y: v } })} />
          <Num value={t.target.z} onChange={(v) => patchTrigger(a.id, { ...t, target: { ...t.target, z: v } })} />
          <span className="text-gray-500">半径</span>
          <Num value={t.radius} onChange={(v) => patchTrigger(a.id, { ...t, radius: Math.max(0, v) })} />
        </>)}
        {t.kind === 'range' && (<>
          <select className={selCls} value={t.shape} onChange={(e) => {
            const sh = e.target.value as 'rect' | 'circle';
            patchTrigger(a.id, sh === 'rect'
              ? { kind: 'range', shape: 'rect', rect: t.rect ?? { x: -40, y: 0, w: 80, h: 60 } }
              : { kind: 'range', shape: 'circle', circle: t.circle ?? { x: 0, y: 0, r: 40 } });
          }}>
            <option value="rect">矩形</option>
            <option value="circle">圆形</option>
          </select>
          {t.shape === 'rect' && t.rect && (<>
            <span className="text-gray-500">x/y/w/h</span>
            <Num value={t.rect.x} onChange={(v) => patchTrigger(a.id, { ...t, rect: { ...t.rect!, x: v } })} />
            <Num value={t.rect.y} onChange={(v) => patchTrigger(a.id, { ...t, rect: { ...t.rect!, y: v } })} />
            <Num value={t.rect.w} onChange={(v) => patchTrigger(a.id, { ...t, rect: { ...t.rect!, w: v } })} />
            <Num value={t.rect.h} onChange={(v) => patchTrigger(a.id, { ...t, rect: { ...t.rect!, h: v } })} />
          </>)}
          {t.shape === 'circle' && t.circle && (<>
            <span className="text-gray-500">心x/心y/r</span>
            <Num value={t.circle.x} onChange={(v) => patchTrigger(a.id, { ...t, circle: { ...t.circle!, x: v } })} />
            <Num value={t.circle.y} onChange={(v) => patchTrigger(a.id, { ...t, circle: { ...t.circle!, y: v } })} />
            <Num value={t.circle.r} onChange={(v) => patchTrigger(a.id, { ...t, circle: { ...t.circle!, r: Math.max(0, v) } })} />
          </>)}
        </>)}
        {t.kind === 'scene' && (
          <span className="text-gray-400">运行时按 anchor 点标记对全部固体自动锚定；不进编辑器采样，去程序化预览面板看效果</span>
        )}
      </div>
    );
  };

  const addAnchor = () => {
    const nodeId = newNodeId || nodes[0]?.id;
    if (!nodeId) return;
    const a: ClampAnchor = {
      id: `clamp_${Date.now().toString(36)}`,
      name: `锚定 ${anchors.length + 1}`,
      enabled: true,
      point: { kind: 'node', nodeId },
      trigger: { kind: 'height', y: 0, side: 'below' },
    };
    save([...anchors, a]);
  };

  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-center gap-1 flex-wrap">
        {nodeSelect(newNodeId || nodes[0]?.id || '', setNewNodeId)}
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={addAnchor}>
          <Plus className="w-3 h-3 mr-1" /> 加锚定
        </Button>
      </div>
      {anchors.length === 0 && (
        <div className="text-gray-500">暂无锚定。锚定 = 指定点到达触发时全位置冻结，整角色反向横移把它送回冻结位。</div>
      )}
      {anchors.map((a) => {
        const froz = frozen?.get(a.id);
        return (
          <div key={a.id} className="border border-[#23233f] rounded p-2 space-y-1.5 bg-[#0d0d1f]">
            <div className="flex items-center gap-1">
              <AnchorIcon className="w-3.5 h-3.5 text-sky-300" />
              <input className={txtCls + ' flex-1 min-w-0'} value={a.name}
                onChange={(e) => patch(a.id, { name: e.target.value })} />
              <button
                className={`p-1 rounded ${a.enabled ? 'text-emerald-300' : 'text-gray-500'}`}
                title={a.enabled ? '已启用' : '已停用'}
                onClick={() => patch(a.id, { enabled: !a.enabled })}
              >
                <Power className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1 rounded text-gray-500 hover:text-red-300"
                title="删除"
                onClick={() => save(anchors.filter((x) => x.id !== a.id))}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {pointEditor(a)}
            {triggerEditor(a)}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-500">优先级（大者先）</span>
              <Num value={a.priority ?? 0} onChange={(v) => patch(a.id, { priority: v })} />
              <label className="inline-flex items-center gap-1 text-gray-300">
                <input type="checkbox" checked={!!a.resettle}
                  onChange={(e) => patch(a.id, { resettle: e.target.checked })} />
                反移后重解
              </label>
              <span className={froz ? 'text-amber-300' : 'text-gray-500'}>
                {froz
                  ? `⚓ 生效中，冻结于 (${froz.points.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' / ')})`
                  : '未生效'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
