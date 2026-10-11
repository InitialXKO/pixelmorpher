'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ArrowLeft, ArrowRight, X, Upload } from 'lucide-react';
import { useEditorStore, useProjectStore } from '@/lib/store';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';

// ============================================================
// RefAssemblyWizard - 参考图装配向导
// 四步：底图 → 对位 → 抠图 → 确认
// ============================================================

type Step = 'upload' | 'align' | 'mask' | 'confirm';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: '底图' },
  { id: 'align', label: '对位' },
  { id: 'mask', label: '抠图' },
  { id: 'confirm', label: '确认' },
];

const BUILT_IN_REFS = [
  { id: 'knight-front', label: '骑士·正面', url: '/reference-demos/knight-front.webp' },
  { id: 'runner-side', label: '跑者·侧面', url: '/reference-demos/runner-side.webp' },
  { id: 'dog-side', label: '小狗·侧面', url: '/reference-demos/dog-side.webp' },
  { id: 'robot-front', label: '机器人·正面', url: '/reference-demos/robot-front.webp' },
  { id: 'mecha-side', label: '机甲·侧面', url: '/reference-demos/mecha-side.webp' },
  { id: 'werewolf-front', label: '狼人·正面', url: '/reference-demos/werewolf-front.webp' },
  { id: 'swordsman-side', label: '剑士·侧面', url: '/reference-demos/swordsman-side.webp' },
  { id: 'angel-front', label: '天使·正面', url: '/reference-demos/angel-front.webp' },
];

export default function RefAssemblyWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('upload');
  const [focusedNodeIndex, setFocusedNodeIndex] = useState(0);
  const [showAddLimb, setShowAddLimb] = useState(false);
  const [newLimbName, setNewLimbName] = useState('');
  const [newLimbParentId, setNewLimbParentId] = useState('');
  const [newLimbSocketId, setNewLimbSocketId] = useState('');
  const [newLimbPlugX, setNewLimbPlugX] = useState(0);
  const [newLimbPlugY, setNewLimbPlugY] = useState(0);
  // 已处理的节点 ID → 方式 ('mask' | 'template' | 'mirror')
  const [processedNodes, setProcessedNodes] = useState<Map<string, string>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  const setReferenceImageUrl = useEditorStore((s) => s.setReferenceImageUrl);
  const referenceImageOpacity = useEditorStore((s) => s.referenceImageOpacity);
  const setReferenceImageOpacity = useEditorStore((s) => s.setReferenceImageOpacity);
  const setZoom = useEditorStore((s) => s.setZoom);
  const isAligning = useEditorStore((s) => s.isAligning);

  // 获取当前角色及其骨架节点（按 zIndex 排序，从后往前）
  const puppetCharacters = useProjectStore((s) => s.puppetCharacters);
  const puppetSkeletons = useProjectStore((s) => s.puppetSkeletons);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const selectedCharacter = puppetCharacters.find((c) => c.id === selectedCharacterId);
  const activeSkeleton = selectedCharacter
    ? puppetSkeletons.find((sk) => sk.id === selectedCharacter.puppetSkeletonId)
    : null;
  // 同步到 editor store 供其他组件使用
  const setActivePuppetSkeletonId = useEditorStore((s) => s.setActivePuppetSkeletonId);
  useEffect(() => {
    setActivePuppetSkeletonId(activeSkeleton?.id ?? null);
  }, [activeSkeleton?.id, setActivePuppetSkeletonId]);
  const sortedNodes = activeSkeleton
    ? [...activeSkeleton.nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    : [];
  const focusedNode = sortedNodes[focusedNodeIndex];
  const addPuppetNode = useProjectStore((s) => s.addPuppetNode);

  // 节点列表变化时，确保 focusedNodeIndex 不越界
  useEffect(() => {
    if (focusedNodeIndex >= sortedNodes.length && sortedNodes.length > 0) {
      setFocusedNodeIndex(sortedNodes.length - 1);
    }
  }, [sortedNodes.length, focusedNodeIndex]);

  // 监听对位完成事件，跳到 mask 步骤
  useEffect(() => {
    const handler = () => setStep('mask');
    window.addEventListener('ref-assembly:align-done', handler);
    return () => window.removeEventListener('ref-assembly:align-done', handler);
  }, []);

  // 聚焦到指定索引的节点：发事件给 PixelCanvas（它有容器尺寸和世界坐标计算）
  const focusNode = (index: number) => {
    const node = sortedNodes[index];
    if (!node || !activeSkeleton) return;
    window.dispatchEvent(
      new CustomEvent('ref-assembly:focus-node', {
        detail: { nodeId: node.id, skeletonId: activeSkeleton.id },
      })
    );
  };

  const handleAddLimb = () => {
    if (!activeSkeleton || !newLimbName.trim()) return;
    const plug = newLimbSocketId
      ? { socketId: newLimbSocketId, localX: newLimbPlugX, localY: newLimbPlugY }
      : null;
    addPuppetNode(activeSkeleton.id, newLimbName.trim(), {
      plug,
      zIndex: (focusedNode?.zIndex ?? 0) + 1,
    });
    setNewLimbName('');
    setNewLimbParentId('');
    setNewLimbSocketId('');
    setNewLimbPlugX(0);
    setNewLimbPlugY(0);
    setShowAddLimb(false);
    // 新节点会出现在列表末尾（zIndex 最大），聚焦到它
    // 注意：sortedNodes 是当前渲染的值，加 1 后对应新节点位置
    setFocusedNodeIndex(sortedNodes.length);
  };

  // 找镜像源：按名称匹配 left/right/L/R
  const findMirrorSource = (node: { id: string; name: string }): string | null => {
    const name = node.name.toLowerCase();
    let mirrorName: string | null = null;
    if (name.includes('left')) mirrorName = node.name.replace(/left/i, 'right');
    else if (name.includes('right')) mirrorName = node.name.replace(/right/i, 'left');
    else if (name.includes('_l')) mirrorName = node.name.replace(/_l/i, '_r');
    else if (name.includes('_r')) mirrorName = node.name.replace(/_r/i, '_l');
    if (!mirrorName) return null;
    const src = sortedNodes.find((n) => n.name === mirrorName);
    // 源节点必须已有精灵（已遮罩或模板自带）
    if (src && (src.spritePartId || processedNodes.has(src.id))) return src.id;
    return null;
  };

  // 父节点变化时，重置 socket 选择
  const handleParentChange = (parentId: string) => {
    setNewLimbParentId(parentId);
    setNewLimbSocketId('');
  };
  const parentNodeForSocket = sortedNodes.find((n) => n.id === newLimbParentId);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setReferenceImageUrl(url);
    setStep('align');
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] border-b border-white/10">
      <div className="p-3 border-b border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-200">参考图装配</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="size-4" />
          </button>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              <div
                className={`flex-1 text-center text-xs py-1.5 rounded ${
                  i === stepIndex
                    ? 'bg-purple-600/40 text-purple-200'
                    : i < stepIndex
                    ? 'bg-white/5 text-gray-400'
                    : 'text-gray-600'
                }`}
              >
                {s.label}
              </div>
              {i < STEPS.length - 1 && <div className="text-gray-600 text-xs">›</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step content - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">选一张内置参考图，或导入自己的立绘作为抠图底图。</p>
            {/* 内置图库 */}
            <div className="grid grid-cols-4 gap-2">
              {BUILT_IN_REFS.map((ref) => (
                <button
                  key={ref.id}
                  onClick={() => {
                    setReferenceImageUrl(ref.url);
                    setStep('align');
                  }}
                  className="group relative aspect-square rounded overflow-hidden border border-white/10 hover:border-purple-500/50 transition-colors"
                  title={ref.label}
                >
                  <img src={ref.url} alt={ref.label} className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                  <div className="absolute bottom-0 inset-x-0 text-[9px] text-center py-0.5 bg-black/60 text-gray-300">
                    {ref.label}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] text-gray-500">或</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <Button onClick={() => fileRef.current?.click()} variant="outline" className="w-full">
              <Upload className="size-3.5 mr-2" /> 导入自己的图片
            </Button>
          </div>
        )}

        {step === 'align' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">选择模板角色</label>
              <select
                value={selectedCharacterId ?? ''}
                onChange={(e) => {
                  setSelectedCharacterId(e.target.value || null);
                  setFocusedNodeIndex(0);
                  setProcessedNodes(new Map());
                }}
                className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
              >
                <option value="">— 选择角色 —</option>
                {puppetCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {activeSkeleton && selectedCharacter ? (
              <>
                <p className="text-xs text-gray-400">
                  模板角色「{selectedCharacter.name}」已覆盖在底图上。点"开始对位"，
                  直接在画布上拖动角色肢体（拖动旋转，Shift+拖动平移）对准底图。
                  完成后点画布顶部的"完成对位"继续。
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={isAligning}
                  onClick={() => {
                    const store = useEditorStore.getState();
                    // 确保骨架可见
                    if (!store.showPuppetSkeleton) store.togglePuppetSkeleton();
                    // 切到木偶工具以便拖动节点
                    store.setTool('puppet');
                    // 切到操控（Perform）模式：对位本质是摆姿势
                    usePuppetSessionStore.getState().setPhase('perform');
                    // 标记对位中（锁定工具栏/侧边栏）
                    store.setIsAligning(true);
                    // 不关闭向导：侧边栏模式下可同时看到向导和画布
                  }}
                >
                  {isAligning ? '对位中…（点画布顶部"完成对位"）' : '开始对位'}
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">底图不透明度</span>
                  <Slider
                    className="flex-1"
                    value={[referenceImageOpacity]}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setReferenceImageOpacity(v)}
                  />
                  <span className="text-xs text-gray-400 w-10 text-right">
                    {Math.round(referenceImageOpacity * 100)}%
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-amber-500">
                请先选择一个模板角色。如果没有，去木偶资产面板点 + 创建。
              </div>
            )}
          </div>
        )}

        {step === 'mask' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              逐肢体处理（{focusedNodeIndex + 1}/{sortedNodes.length}）：{focusedNode?.name ?? '无骨架'}
            </p>
            {/* 肢体导航 */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={focusedNodeIndex === 0}
                onClick={() => {
                  const newIndex = Math.max(0, focusedNodeIndex - 1);
                  setFocusedNodeIndex(newIndex);
                  focusNode(newIndex);
                }}
              >
                ← 上一肢体
              </Button>
              <div className="flex-1 text-center text-xs text-gray-300">
                {focusedNode?.name ?? '—'}
                {focusedNode && (
                  <span className="ml-2 text-[10px] text-gray-500">
                    z:{focusedNode.zIndex ?? 0}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={focusedNodeIndex >= sortedNodes.length - 1}
                onClick={() => {
                  const newIndex = Math.min(sortedNodes.length - 1, focusedNodeIndex + 1);
                  setFocusedNodeIndex(newIndex);
                  focusNode(newIndex);
                }}
              >
                下一肢体 →
              </Button>
            </div>
            {/* 节点管理：删除 / 层级 */}
            {focusedNode && activeSkeleton && (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-[10px] h-6 text-red-400 hover:text-red-300"
                  onClick={() => {
                    if (!confirm(`删除节点「${focusedNode.name}」？其子节点将一并删除。`)) return;
                    useProjectStore.getState().removePuppetNode(activeSkeleton.id, focusedNode.id);
                    setFocusedNodeIndex((i) => Math.max(0, i - 1));
                  }}
                >
                  删除节点
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-[10px] h-6"
                  onClick={() => {
                    const s = useProjectStore.getState();
                    s.updatePuppetNode(activeSkeleton.id, focusedNode.id, {
                      zIndex: (focusedNode.zIndex ?? 0) + 1,
                    });
                  }}
                >
                  上移一层
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-[10px] h-6"
                  onClick={() => {
                    const s = useProjectStore.getState();
                    s.updatePuppetNode(activeSkeleton.id, focusedNode.id, {
                      zIndex: (focusedNode.zIndex ?? 0) - 1,
                    });
                  }}
                >
                  下移一层
                </Button>
              </div>
            )}
            {/* 添加临时肢体 */}
            {!showAddLimb ? (
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-[11px] text-cyan-400"
                onClick={() => setShowAddLimb(true)}
              >
                + 添加肢体/道具（如耳朵、尾巴、武器）
              </Button>
            ) : (
              <div className="p-2 rounded bg-white/5 border border-white/10 space-y-2">
                <input
                  value={newLimbName}
                  onChange={(e) => setNewLimbName(e.target.value)}
                  placeholder="名称，如：左耳、尾巴、剑"
                  className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                />
                <select
                  value={newLimbParentId}
                  onChange={(e) => handleParentChange(e.target.value)}
                  className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                >
                  <option value="">选择父节点（挂在哪）</option>
                  {sortedNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                {parentNodeForSocket && parentNodeForSocket.sockets.length > 0 && (
                  <>
                    <select
                      value={newLimbSocketId}
                      onChange={(e) => setNewLimbSocketId(e.target.value)}
                      className="w-full h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                    >
                      <option value="">选择插槽</option>
                      {parentNodeForSocket.sockets.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.localX}, {s.localY})</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <label className="flex-1 text-[10px] text-gray-500">
                        Plug X
                        <input
                          type="number"
                          value={newLimbPlugX}
                          onChange={(e) => setNewLimbPlugX(Number(e.target.value))}
                          className="w-full h-6 px-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200 mt-0.5"
                        />
                      </label>
                      <label className="flex-1 text-[10px] text-gray-500">
                        Plug Y
                        <input
                          type="number"
                          value={newLimbPlugY}
                          onChange={(e) => setNewLimbPlugY(Number(e.target.value))}
                          className="w-full h-6 px-1 text-xs bg-white/5 border border-white/10 rounded text-gray-200 mt-0.5"
                        />
                      </label>
                    </div>
                  </>
                )}
                {parentNodeForSocket && parentNodeForSocket.sockets.length === 0 && (
                  <div className="text-[10px] text-amber-500">父节点无插槽，将作为根节点添加（无父连接）</div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleAddLimb} disabled={!newLimbName.trim()}>
                    添加
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddLimb(false)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
            {/* 操作选项 */}
            {focusedNode && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[11px]"
                    onClick={() => {
                      const store = useEditorStore.getState();
                      store.setMaskNodeId(focusedNode.id);
                      store.setEditMode('mask');
                      // 临时隐藏向导（不清理，mask 完成后会重新打开）
                      // 参考图保持可见，mask 需要对照着画
                      store.setRefWizardOpen(false);
                    }}
                  >
                    绘制遮罩
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-[11px]"
                    onClick={() => {
                      // 用模板：标记为已处理，不替换精灵
                      setProcessedNodes((m) => new Map(m).set(focusedNode.id, 'template'));
                    }}
                  >
                    用模板
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-[11px]"
                    disabled={!findMirrorSource(focusedNode)}
                    onClick={() => {
                      const src = findMirrorSource(focusedNode);
                      if (!src || !activeSkeleton) return;
                      // 镜像：复制对侧节点的 spritePartId
                      const srcNode = sortedNodes.find((n) => n.id === src);
                      if (srcNode?.spritePartId) {
                        useProjectStore.getState().updatePuppetNode(activeSkeleton.id, focusedNode.id, {
                          spritePartId: srcNode.spritePartId,
                        });
                        setProcessedNodes((m) => new Map(m).set(focusedNode.id, 'mirror'));
                      }
                    }}
                  >
                    镜像对侧
                  </Button>
                </div>
                {processedNodes.get(focusedNode.id) && (
                  <div className="text-[10px] text-emerald-400">
                    ✓ 已处理（{processedNodes.get(focusedNode.id) === 'mask' ? '遮罩' : processedNodes.get(focusedNode.id) === 'template' ? '模板' : '镜像'}）
                  </div>
                )}
              </div>
            )}
            {!activeSkeleton && (
              <div className="text-xs text-amber-400">请先在木偶资产面板选择一个骨架</div>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              已处理 {processedNodes.size}/{sortedNodes.length} 个肢体
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {sortedNodes.map((n) => {
                const status = processedNodes.get(n.id);
                return (
                  <div key={n.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-white/5">
                    <span className="flex-1 text-gray-300">{n.name}</span>
                    <span className={status ? 'text-emerald-400' : 'text-gray-600'}>
                      {status === 'mask' ? '✓ 遮罩' : status === 'template' ? '✓ 模板' : status === 'mirror' ? '✓ 镜像' : '○ 未处理'}
                    </span>
                  </div>
                );
              })}
            </div>
            {processedNodes.size < sortedNodes.length && (
              <div className="text-[11px] text-amber-500">
                还有 {sortedNodes.length - processedNodes.size} 个肢体未处理，返回抠图步骤继续。
              </div>
            )}
          </div>
        )}
      </div>

        {/* Footer */}
        <div className="flex justify-between p-3 border-t border-white/10 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={stepIndex === 0}
            onClick={() => setStep(STEPS[stepIndex - 1].id)}
          >
            <ArrowLeft className="size-3.5 mr-1" /> 上一步
          </Button>
          <Button
            size="sm"
            disabled={
              (stepIndex === 0 && !referenceImageUrl) ||
              (step === 'align' && !activeSkeleton) ||
              // 对位中必须点画布上的"完成对位"，不能直接下一步
              (step === 'align' && isAligning)
            }
            onClick={() => {
              if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1].id);
              else onClose();
            }}
          >
            {stepIndex === STEPS.length - 1 ? '完成' : '下一步'} <ArrowRight className="size-3.5 ml-1" />
          </Button>
        </div>
    </div>
  );
}
