'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ArrowLeft, ArrowRight, X, Upload } from 'lucide-react';
import { useEditorStore, useProjectStore } from '@/lib/store';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import type { PixelGrid, PixelColor } from '@/lib/types';
import { initSAM, isSAMReady, setSAMImage } from '@/lib/sam';
import { inpaintPixels } from '@/lib/inpainting';

// ============================================================
// RefAssemblyWizard - 参考图装配向导
// 四步：底图 → 对位 → 抠图 → 确认
// ============================================================

type Step = 'upload' | 'sam' | 'align' | 'mask' | 'cleanup' | 'confirm';

// 模块级持久化：防组件卸载导致状态丢失
let persistedStep: Step = 'upload';
let persistedSelectedCharacterId: string | null = null;
export function resetRefWizardStep() {
  persistedStep = 'upload';
  persistedSelectedCharacterId = null;
}

const STEPS: { id: Step; label: string; optional?: boolean }[] = [
  { id: 'upload', label: '底图' },
  { id: 'sam', label: 'AI分割', optional: true },
  { id: 'align', label: '对位' },
  { id: 'mask', label: '抠图' },
  { id: 'cleanup', label: 'AI清理', optional: true },
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
  // 恢复模板节点到原始 transform
  const restoreTemplateNodes = () => {
    const ps = useProjectStore.getState();
    const char = Object.values(ps.unifiedCharacters ?? {}).find((c: any) => c.id === selectedCharacterId);
    if (!char) return;
    const skeletonId = Object.keys(ps.unifiedCharacters ?? {}).find((k) => ps.unifiedCharacters[k]?.id === selectedCharacterId);
    if (!skeletonId) return;
    originalTransformsRef.current.forEach((orig, nodeId) => {
      const nd = ps.unifiedCharacters[skeletonId]?.nodes[nodeId];
      ps.updateUnifiedNode(skeletonId, nodeId, {
        transform: {
          ...(nd?.transform ?? { x: 0, y: 0, angle: 0, stretch: 1, variantIndex: 0 }),
          x: orig.offsetX,
          y: orig.offsetY,
          angle: orig.angle,
        },
      });
    });
    originalTransformsRef.current.clear();
  };

  // 计算对位偏移差值，存进服装，恢复模板节点
  // 在离开 align 步骤时调用
  const saveAlignmentToCostume = () => {
    if (!workingCostumeId || !selectedCharacterId) return;
    const ps = useProjectStore.getState();
    const char = Object.values(ps.unifiedCharacters ?? {}).find((c: any) => c.id === selectedCharacterId);
    if (!char) return;
    const skeleton = char;
    if (!skeleton) return;

    const nodeOffsets: Record<string, { x: number; y: number; angle: number }> = {};
    const originals = originalTransformsRef.current;
    for (const n of Object.values(skeleton.nodes)) {
      const orig = originals.get(n.id);
      if (!orig) continue;
      const dx = (n.transform?.x ?? 0) - orig.offsetX;
      const dy = (n.transform?.y ?? 0) - orig.offsetY;
      const da = (n.transform?.angle ?? 0) - orig.angle;
      // 只存非零偏移
      if (dx !== 0 || dy !== 0 || da !== 0) {
        nodeOffsets[n.id] = { x: dx, y: dy, angle: da };
      }
    }
    ps.updateUnifiedCostumeSet(selectedCharacterId, workingCostumeId, { nodeOffsets });
    // 恢复模板节点
    restoreTemplateNodes();
  };

  // 内部关闭：恢复模板，删工作服装（取消时），清参考图
  const handleClose = (keepCostume: boolean = false) => {
    const ps = useProjectStore.getState();
    if (!keepCostume && workingCostumeId && selectedCharacterId) {
      ps.removeUnifiedCostumeSet(selectedCharacterId, workingCostumeId);
    }
    setWorkingCostumeIdState(null);
    restoreTemplateNodes();
    // 清参考图（否则第二次进入时残留旧 URL）
    const oldUrl = useEditorStore.getState().referenceImageUrl;
    if (oldUrl && oldUrl.startsWith('blob:')) {
      URL.revokeObjectURL(oldUrl);
    }
    useEditorStore.getState().setReferenceImageUrl(null);
    // 清色键（跨肢体共享，但不出向导）
    useEditorStore.getState().setChromaKeyColor(null);
    resetRefWizardStep();
    onClose();
  };
  const [step, setStepState] = useState<Step>(persistedStep);
  const setStep = (s: Step) => {
    persistedStep = s;
    setStepState(s);
  };
  const [showAddLimb, setShowAddLimb] = useState(false);
  const [newLimbName, setNewLimbName] = useState('');
  const [newLimbParentId, setNewLimbParentId] = useState('');
  const [newLimbSocketId, setNewLimbSocketId] = useState('');
  const [newLimbPlugX, setNewLimbPlugX] = useState(0);
  const [newLimbPlugY, setNewLimbPlugY] = useState(0);
  // 已处理的节点 ID → 方式 ('mask' | 'mirror')
  const [processedNodes, setProcessedNodes] = useState<Map<string, string>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);
  // SAM 状态
  const [samStatus, setSamStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [samProgress, setSamProgress] = useState(0);
  const [samMasks, setSamMasks] = useState<{ label: string; bounds: { x: number; y: number; width: number; height: number } }[]>([]);

  const referenceImageUrl = useEditorStore((s) => s.referenceImageUrl);
  const setReferenceImageUrl = useEditorStore((s) => s.setReferenceImageUrl);
  const referenceImageOpacity = useEditorStore((s) => s.referenceImageOpacity);
  const setReferenceImageOpacity = useEditorStore((s) => s.setReferenceImageOpacity);
  // 抠图目标：直接用画布全局当前选中的肢体
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId);
  const setZoom = useEditorStore((s) => s.setZoom);

  // 获取当前角色及其骨架节点（按 zIndex 排序，从后往前）
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters) ?? {};
  const syncPuppetToUnified = useProjectStore((s) => s.syncPuppetToUnified);
  const updateUnifiedNode = useProjectStore((s) => s.updateUnifiedNode);
  const updateUnifiedCharacter = useProjectStore((s) => s.updateUnifiedCharacter);
  const addUnifiedNode = useProjectStore((s) => s.addUnifiedNode);
  const removeUnifiedNode = useProjectStore((s) => s.removeUnifiedNode);
  const [selectedCharacterId, setSelectedCharacterIdState] = useState<string | null>(persistedSelectedCharacterId);
  const setSelectedCharacterId = (id: string | null) => {
    persistedSelectedCharacterId = id;
    setSelectedCharacterIdState(id);
  };
  // 工作服装 ID（选模板时创建）
  const [workingCostumeId, setWorkingCostumeIdState] = useState<string | null>(null);
  // 原始节点 transform（选模板时保存，用于计算偏移差值和恢复模板）
  const originalTransformsRef = useRef<Map<string, { offsetX: number; offsetY: number; angle: number }>>(new Map());

  // 向导直接使用选中的模板（不克隆）
  const effectiveCharacterId = selectedCharacterId;
  const selectedCharacter = Object.values(unifiedCharacters).find((c) => c.id === effectiveCharacterId) ?? null;
  // In new model, Character IS the skeleton (has nodes)
  const activeSkeleton = selectedCharacter;
  // Find dict key for setActivePuppetSkeletonId (keyed by skeletonId)
  const activeSkeletonKey = selectedCharacter
    ? Object.keys(unifiedCharacters).find((k) => unifiedCharacters[k]?.id === selectedCharacter.id) ?? null
    : null;
  // 同步到 editor store 供其他组件使用
  const setActivePuppetSkeletonId = useEditorStore((s) => s.setActivePuppetSkeletonId);
  useEffect(() => {
    setActivePuppetSkeletonId(activeSkeletonKey);
  }, [activeSkeletonKey, setActivePuppetSkeletonId]);
  const sortedNodes = activeSkeleton
    ? Object.values(activeSkeleton.nodes).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    : [];
  // 抠图目标节点：直接用画布全局选中的，不再用向导内部的 targetNodeIndex
  const targetNode = (activeSkeleton && selectedNodeId ? activeSkeleton.nodes[selectedNodeId] : null) ?? null;

  // 选中模板：保存原始 transform，创建工作服装，直接进入对位
  // 不需要"开始对位"按钮：选即开始，直接拖
  // 不克隆：对位偏移最终存进服装的 nodeOffsets，模板节点在关闭时恢复
  useEffect(() => {
    if (!selectedCharacterId) return;
    const ps = useProjectStore.getState();
    const sc = Object.values(ps.unifiedCharacters ?? {}).find((c: any) => c.id === selectedCharacterId);
    if (!sc) return;
    const skeleton = sc;
    if (!skeleton) return;

    // 如果已有工作服装且对应当前模板，跳过（避免重复）
    if (workingCostumeId) {
      const existing = sc.costumeSets.find((cs) => cs.id === workingCostumeId);
      if (existing) return;
      // 否则是重选模板：恢复旧模板节点，删旧服装
      restoreTemplateNodes();
      ps.removeUnifiedCostumeSet(selectedCharacterId, workingCostumeId);
    }

    // 保存原始 transform
    originalTransformsRef.current.clear();
    for (const n of Object.values(skeleton.nodes)) {
      originalTransformsRef.current.set(n.id, {
        offsetX: n.transform?.x ?? 0,
        offsetY: n.transform?.y ?? 0,
        angle: n.transform?.angle ?? 0,
      });
    }

    // 创建工作服装
    const costume = ps.addUnifiedCostumeSet(selectedCharacterId, `${sc.name}（装配）`);
    setWorkingCostumeIdState(costume.id);
    // 设为当前服装（渲染时应用）
    const charKey203 = Object.keys(ps.unifiedCharacters ?? {}).find((k) => ps.unifiedCharacters[k]?.id === selectedCharacterId);
    if (charKey203) ps.updateUnifiedCharacter(charKey203, { activeCostumeSetId: costume.id });
    // 进入操控（画布只显示该角色）
    usePuppetSessionStore.getState().enterPerform(selectedCharacterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharacterId]);

  // 监听对位完成事件，跳到 mask 步骤
  useEffect(() => {
    const handler = () => setStep('mask');
    window.addEventListener('ref-assembly:align-done', handler);
    return () => window.removeEventListener('ref-assembly:align-done', handler);
  }, []);

  // 监听遮罩完成事件，更新进度并自动推进到下一肢体
  useEffect(() => {
    const handler = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId;
      if (nodeId) {
        setProcessedNodes((m) => new Map(m).set(nodeId, 'mask'));
        // 自动推进到下一个未处理的肢体（更新画布全局选中）
        const idx = sortedNodes.findIndex((n) => n.id === nodeId);
        const next = sortedNodes[Math.min(idx + 1, sortedNodes.length - 1)];
        if (next && next.id !== nodeId) {
          setSelectedNodeId(next.id);
        }
      }
    };
    window.addEventListener('ref-assembly:mask-done', handler);
    return () => window.removeEventListener('ref-assembly:mask-done', handler);
  }, [sortedNodes]);


  const handleAddLimb = () => {
    if (!activeSkeleton || !newLimbName.trim()) return;
    const attachment = newLimbSocketId
      ? { type: 'socket' as const, parentSocketId: newLimbSocketId, plug: { x: newLimbPlugX, y: newLimbPlugY } }
      : { type: 'fixed' as const, fixedOffset: { x: 0, y: 0 }, inheritRotation: true };
    addUnifiedNode(activeSkeletonKey!, newLimbName.trim(), {
      attachment,
      zIndex: (targetNode?.zIndex ?? 0) + 1,
    });
    setNewLimbName('');
    setNewLimbParentId('');
    setNewLimbSocketId('');
    setNewLimbPlugX(0);
    setNewLimbPlugY(0);
    setShowAddLimb(false);
    // 新节点会出现在列表末尾，选中它（画布全局）
    // 注意：这里需要新节点的 ID，暂时用 setTimeout 等待 store 更新后查找
    setTimeout(() => {
      const ps = useProjectStore.getState();
      const sk = activeSkeleton;
      const skNodes = sk ? Object.values(sk.nodes) : [];
      const newNode = skNodes[skNodes.length - 1];
      if (newNode) setSelectedNodeId(newNode.id);
    }, 100);
  };

  // 找镜像源：按名称匹配 left/right/L/R
  const findMirrorSource = (node: { id: string; name: string }): string | null => {
    const name = node.name.toLowerCase();
    let mirrorName: string | null = null;
    if (name.includes('left')) mirrorName = node.name.replace(/left/i, 'right');
    else if (name.includes('right')) mirrorName = node.name.replace(/right/i, 'left');
    else if (name.includes('_l')) mirrorName = node.name.replace(/_l/i, '_r');
    else if (name.includes('_r')) mirrorName = node.name.replace(/_r/i, '_l');
    // 中文：左/右
    else if (node.name.includes('左')) mirrorName = node.name.replace('左', '右');
    else if (node.name.includes('右')) mirrorName = node.name.replace('右', '左');
    if (!mirrorName) return null;
    const src = sortedNodes.find((n) => n.name.toLowerCase() === mirrorName!.toLowerCase());
    // 源节点必须已有精灵（已遮罩或模板自带）
    if (src && ((src as any).sprite || src.costumePiece || processedNodes.has(src.id))) return src.id;
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
    // 清空 input，下次选同一文件也能触发 onChange
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    setReferenceImageUrl(url);
    // 确保可见（上次关闭时被隐藏了）
    useEditorStore.getState().setReferenceImageVisible(true);
    setStep('sam');
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] border-b border-white/10">
      <div className="p-3 border-b border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-200">参考图装配</h2>
          <button onClick={() => handleClose(false)} className="text-gray-500 hover:text-gray-300">
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
                    useEditorStore.getState().setReferenceImageVisible(true);
                    setStep('sam');
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

        {step === 'sam' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              可选：用 SAM 智能分割。先点角色整体抠出背景，再点各肢体分别分割。
            </p>
            {samStatus === 'idle' && (
              <Button
                size="sm" variant="outline" className="w-full"
                onClick={async () => {
                  setSamStatus('loading');
                  try {
                    await initSAM('mobilesam', (_s, p) => setSamProgress(p));
                    // 设置参考图
                    if (referenceImageUrl) {
                      const img = new Image();
                      img.crossOrigin = 'anonymous';
                      await new Promise((res, rej) => {
                        img.onload = res; img.onerror = rej;
                        img.src = referenceImageUrl;
                      });
                      await setSAMImage(img);
                    }
                    setSamStatus('ready');
                  } catch {
                    setSamStatus('error');
                  }
                }}
              >
                初始化 SAM（首次下载模型 ~45MB）
              </Button>
            )}
            {samStatus === 'loading' && (
              <div className="text-xs text-gray-400">加载模型中… {Math.round(samProgress)}%</div>
            )}
            {samStatus === 'error' && (
              <div className="text-xs text-red-400">SAM 初始化失败，可跳过此步骤</div>
            )}
            {samStatus === 'ready' && (
              <div className="space-y-2">
                <div className="text-xs text-green-400">SAM 就绪。点击图中角色进行分割，再点"应用分割抠除背景"。</div>
                {referenceImageUrl && (
                  <img
                    src={referenceImageUrl}
                    alt="参考图"
                    className="w-full rounded border border-white/10 cursor-crosshair"
                    onClick={async (e) => {
                      const rect = (e.target as HTMLImageElement).getBoundingClientRect();
                      const x = (e.clientX - rect.left) / rect.width;
                      const y = (e.clientY - rect.top) / rect.height;
                      try {
                        // 每次点击替换当前 mask，不累积
                        await useEditorStore.getState().samSegmentAtPoint(x, y);
                        setSamMasks([{ label: '当前分割', bounds: useEditorStore.getState().samState.maskBounds! }]);
                      } catch (err) {
                        console.error('[SAM] 分割失败:', err);
                      }
                    }}
                  />
                )}
                {samMasks.length > 0 && (
                  <div className="text-xs text-gray-400">已分割，可应用抠除背景</div>
                )}
                {samMasks.length > 0 && (
                  <Button
                    size="sm" variant="outline" className="w-full"
                    onClick={async () => {
                      const store = useEditorStore.getState();
                      const { currentMask, maskShape } = store.samState;
                      if (!currentMask || !maskShape || !referenceImageUrl) return;
                      try {
                        // 加载参考图（data:/blob: 不需要 crossOrigin）
                        const img = new Image();
                        if (!referenceImageUrl.startsWith('data:') && !referenceImageUrl.startsWith('blob:')) {
                          img.crossOrigin = 'anonymous';
                        }
                        await new Promise((res, rej) => {
                          img.onload = res; img.onerror = rej;
                          img.src = referenceImageUrl;
                        });
                        if (!img.naturalWidth || !img.naturalHeight) {
                          throw new Error('参考图加载失败（0 尺寸）');
                        }
                        // 用 mask 抠图：mask>0.5 保留，否则透明
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d')!;
                        ctx.drawImage(img, 0, 0);
                        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const [mh, mw] = maskShape;
                        for (let y = 0; y < canvas.height; y++) {
                          for (let x = 0; x < canvas.width; x++) {
                            const mx = Math.floor((x / canvas.width) * mw);
                            const my = Math.floor((y / canvas.height) * mh);
                            const maskVal = currentMask[my * mw + mx];
                            if (!(maskVal >= 0.5)) {
                              imgData.data[(y * canvas.width + x) * 4 + 3] = 0;
                            }
                          }
                        }
                        ctx.putImageData(imgData, 0, 0);
                        const newUrl = canvas.toDataURL('image/png');
                        store.setReferenceImageUrl(newUrl);
                        // 清掉旧 mask，避免 overlay 残留
                        store.clearSAMMask();
                        setSamMasks([]);
                      } catch (err) {
                        console.error('[SAM] 抠图失败:', err);
                      }
                    }}
                  >
                    应用分割抠除背景
                  </Button>
                )}
              </div>
            )}
            <Button
              size="sm" variant="ghost" className="w-full text-[11px]"
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.id === 'sam');
                if (idx >= 0) setStep(STEPS[idx + 1].id);
              }}
            >
              跳过 <ArrowRight className="size-3.5 ml-1" />
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
                  setProcessedNodes(new Map());
                }}
                className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
              >
                <option value="">— 选择角色 —</option>
                {Object.values(unifiedCharacters).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {activeSkeleton && selectedCharacter ? (
              <>
                <p className="text-xs text-gray-400">
                  模板角色「{selectedCharacter.name}」已覆盖在底图上，
                  直接在画布上拖动角色肢体（拖动旋转，Shift+拖动平移）对准底图。
                </p>
                {/* 方向选择：遮罩只应用于此方向 */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">对位方向（遮罩将应用于此方向）</label>
                  <select
                    value={'S'}
                    onChange={() => {}}
                    className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded text-gray-200"
                  >
                    <option value="S">南 (S) - 正面</option>
                    <option value="N">北 (N) - 背面</option>
                    <option value="E">东 (E) - 右侧</option>
                    <option value="W">西 (W) - 左侧</option>
                    <option value="NE">东北 (NE)</option>
                    <option value="SE">东南 (SE)</option>
                    <option value="SW">西南 (SW)</option>
                    <option value="NW">西北 (NW)</option>
                  </select>
                </div>
                <p className="text-[11px] text-gray-400">
                  已为「{selectedCharacter?.name}」创建新服装，直接在画布上拖动肢体对位（拖动旋转，Shift+拖动平移）。对位偏移将存入服装。
                </p>
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
              目标肢体（画布上点选）：{targetNode?.name ?? '未选中'}
            </p>
            <p className="text-xs text-gray-400">
              目标肢体（画布上点选）：{targetNode?.name ?? '未选中'}
              {targetNode && (
                <span className="ml-2 text-[10px] text-gray-500">
                  z:{targetNode.zIndex ?? 0}
                </span>
              )}
            </p>
            {/* 节点管理：删除 */}
            {targetNode && activeSkeleton && (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-[10px] h-6 text-red-400 hover:text-red-300"
                  onClick={() => {
                    if (!confirm(`删除节点「${targetNode.name}」？其子节点将一并删除。`)) return;
                    useProjectStore.getState().removeUnifiedNode(activeSkeletonKey!, targetNode.id);
                    setSelectedNodeId(null);
                  }}
                >
                  删除节点
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
                        <option key={s.id} value={s.id}>{s.name} ({s.basePosition?.x ?? 0}, {s.basePosition?.y ?? 0})</option>
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
            {targetNode && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[11px]"
                    onClick={() => {
                      const store = useEditorStore.getState();
                      store.setMaskNodeId(targetNode.id);
                      store.setEditMode('mask');
                      // 向导保持挂载（不卸载），mask 画布在主区域，侧边栏不冲突
                    }}
                  >
                    绘制遮罩
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-[11px]"
                    disabled={!findMirrorSource(targetNode)}
                    onClick={() => {
                      const src = findMirrorSource(targetNode);
                      if (!src || !activeSkeleton) return;
                      const projectStore = useProjectStore.getState();
                      const srcNode = sortedNodes.find((n) => n.id === src);
                      // New model: get sprite from node.sprite or costumePiece
                      const srcSprite = (srcNode as any)?.sprite ?? null;
                      if (!srcSprite?.data) return;
                      const srcPart = { width: srcSprite.width, height: srcSprite.height, pixels: srcSprite.data, pivotX: srcSprite.plug?.x ?? 0, pivotY: srcSprite.plug?.y ?? 0 };
                      // 真镜像：水平翻转像素，建新 Part
                      const w = srcPart.width;
                      const h = srcPart.height;
                      const flipped: PixelGrid = [];
                      for (let y = 0; y < h; y++) {
                        const row: PixelColor[] = [];
                        for (let x = 0; x < w; x++) {
                          row.push(srcPart.pixels[y][w - 1 - x]);
                        }
                        flipped.push(row);
                      }
                      // 新模型：精灵直写全局 sprites 表（s.sprites）
                      const spriteId = `sprite_mirror_${targetNode.id}_${Date.now().toString(36)}`;
                      useProjectStore.setState((s: any) => ({
                        sprites: {
                          ...s.sprites,
                          [spriteId]: {
                            id: spriteId,
                            name: `镜像_${targetNode.name ?? targetNode.id}`,
                            width: w,
                            height: h,
                            data: flipped,
                          },
                        },
                      }));
                      // 写进工作服装的 pieces，不改模板节点
                      if (workingCostumeId && selectedCharacterId) {
                        // 'S' → DirectionIndex 0
                        projectStore.setUnifiedCostumeSprite(
                          selectedCharacterId,
                          workingCostumeId,
                          targetNode.id,
                          0,
                          spriteId
                        );
                        projectStore.updateUnifiedNode(activeSkeletonKey!, targetNode.id, {
                        });
                      }
                      setProcessedNodes((m) => new Map(m).set(targetNode.id, 'mirror'));
                    }}
                  >
                    镜像对侧
                  </Button>
                </div>
                {processedNodes.get(targetNode.id) && (
                  <div className="text-[10px] text-emerald-400">
                    ✓ 已处理（{processedNodes.get(targetNode.id) === 'mask' ? '遮罩' : '镜像'}）
                  </div>
                )}
              </div>
            )}
            {!activeSkeleton && (
              <div className="text-xs text-amber-400">请先在木偶资产面板选择一个骨架</div>
            )}
          </div>
        )}

        {step === 'cleanup' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              可选：用 Inpainting 清理抠图结果。自动检测并填补精灵中的小洞、修复边缘。
            </p>
            <Button
              size="sm" variant="outline" className="w-full"
              onClick={() => {
                const projectStore = useProjectStore.getState();
                let cleaned = 0;
                for (const nodeId of processedNodes.keys()) {
                  const node = sortedNodes.find((n) => n.id === nodeId);
                  if (!node) continue;
                  // 取节点精灵
                  const spriteId = (node as any).costumePiece?.sprites?.[0]?.spriteId
                    ?? (node as any).spriteId;
                  const sprite = spriteId ? projectStore.sprites[spriteId] : null;
                  if (!sprite?.data) continue;
                  const pixels = sprite.data as PixelGrid;
                  const h = pixels.length;
                  const w = h > 0 ? pixels[0].length : 0;
                  // 检测洞：透明像素且四邻域全不透明
                  const holes = new Set<string>();
                  for (let y = 1; y < h - 1; y++) {
                    for (let x = 1; x < w - 1; x++) {
                      if (pixels[y][x] !== null) continue;
                      const neighbors = [
                        pixels[y-1][x], pixels[y+1][x],
                        pixels[y][x-1], pixels[y][x+1],
                      ];
                      if (neighbors.every((n) => n !== null)) {
                        holes.add(`${x},${y}`);
                      }
                    }
                  }
                  if (holes.size > 0) {
                    const cleanedPixels = inpaintPixels(pixels, holes, 3);
                    projectStore.setSpritePixels(spriteId, cleanedPixels);
                    cleaned++;
                  }
                }
                console.info(`[cleanup] Inpainting 清理完成，处理 ${cleaned} 个精灵`);
              }}
            >
              对已抠肢体跑 Inpainting 清理
            </Button>
            <Button
              size="sm" variant="ghost" className="w-full text-[11px]"
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.id === 'cleanup');
                if (idx >= 0) setStep(STEPS[idx + 1].id);
              }}
            >
              跳过 <ArrowRight className="size-3.5 ml-1" />
            </Button>
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
                      {status === 'mask' ? '✓ 遮罩' : status === 'mirror' ? '✓ 镜像' : '○ 未处理'}
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
            disabled={stepIndex <= 0}
            onClick={() => stepIndex > 0 && setStep(STEPS[stepIndex - 1].id)}
          >
            <ArrowLeft className="size-3.5 mr-1" /> 上一步
          </Button>
          <Button
            size="sm"
            disabled={
              (stepIndex === 0 && !referenceImageUrl) ||
              (step === 'align' && !activeSkeleton)
            }
            onClick={() => {
              if (stepIndex >= 0 && stepIndex < STEPS.length - 1) {
                // 离开 align 步骤：保存对位偏移到服装，恢复模板
                if (step === 'align') {
                  saveAlignmentToCostume();
                }
                setStep(STEPS[stepIndex + 1].id);
              } else if (stepIndex === STEPS.length - 1) {
                // 完成：保留工作服装，只关向导
                setWorkingCostumeIdState(null);
                resetRefWizardStep();
                onClose();
              }
            }}
          >
            {stepIndex === STEPS.length - 1 ? '完成' : '下一步'} <ArrowRight className="size-3.5 ml-1" />
          </Button>
        </div>
    </div>
  );
}
