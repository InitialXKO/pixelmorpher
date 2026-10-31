'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  PencilRuler,
  Bone,
  Shirt,
  Clapperboard,
  Drama,
  Workflow,
  ListTree,
  MonitorPlay,
  Activity,
  Terminal,
  Puzzle,
} from 'lucide-react';
import SketchPoseDialog from './puppet/SketchPoseDialog';
import SidePanelTabs, { type SidePanelTabDef } from './shared/SidePanelTabs';
import { Button } from '@/components/ui/button';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import { useProjectStore, useEditorStore } from '@/lib/store';
import RigPanel from './puppet/RigPanel';
import DressPanel from './puppet/DressPanel';
import PerformPanel from './puppet/PerformPanel';
import StateMachinePanel from './puppet/StateMachinePanel';
import BehaviorTreePanel from './puppet/BehaviorTreePanel';
import BehaviorPanel from './puppet/BehaviorPanel';
import ProcPreview from './puppet/ProcPreview';
import ProceduralPanel from './ProceduralPanel';
import ScriptPanel from './ScriptPanel';
import PluginPanel from './PluginPanel';
import type { DirectionIndex } from '@/lib/unified-types';

// ---- Main Component ----

export default function PuppetPanel() {
  const unifiedCharacters = useProjectStore((s) => s.unifiedCharacters);
  const animationClips = useProjectStore((s) => s.animationClips);
  const sprites = useProjectStore((s) => s.sprites);
  const canvasSelectedNodeId = useProjectStore((s) => s.selectedNodeId);

  // ---- 骨架选择用左侧的 activePuppetSkeletonId，不再用本地 state ----
  const activePuppetSkeletonId = useEditorStore((s) => s.activePuppetSkeletonId);
  // 节点选择用 store（与左侧共享树同步），不再用本地 state
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useProjectStore((s) => s.setSelectedNodeId);
  const [direction, setDirection] = useState<DirectionIndex>(0);
  const [latitude, setLatitude] = useState(0);

  // ---- dress 阶段本地状态 ----
  const [selectedCostumeId, setSelectedCostumeId] = useState<string | null>(null);

  const [sketchPoseOpen, setSketchPoseOpen] = useState(false);
  // 右栏页签（本面板即右栏页签容器，内部状态即可：无外部组件需要
  // 切换右栏页签）。木偶七页签 + 动画工具三页签同排（工具面板为
  // 2026-10-16 退役 workspace mode 时被连带封存、2026-10-29 恢复）
  const [rightTab, setRightTab] = useState('rig');

  const selectedCharacter = activePuppetSkeletonId
    ? (unifiedCharacters[activePuppetSkeletonId] ?? null)
    : null;
  const selectedNode = selectedNodeId ? (selectedCharacter?.nodes[selectedNodeId] ?? null) : null;

  // M1: 切换骨骼时用骨骼实际的方向/纬度回填，否则方向盘显示与骨骼脱节
  useEffect(() => {
    if (selectedCharacter) {
      const rootNode = selectedCharacter.nodes[selectedCharacter.rootNodeId];
      setDirection(rootNode?.transform.variantIndex ?? 0);
      setLatitude(selectedCharacter.latitude ?? 0);
    }
  }, [activePuppetSkeletonId]);

  // 换装编辑对象跟随生效集：切角色时重置为该角色的生效集（activeCostumeSetId
  // 缺省时置 null，DressPanel 回落到第一个服装集，与渲染端的生效集解析一致）。
  // 同一角色内用户在换装面板手动点选其它集、或点「设为生效」的既有同步
  // 不受影响，直到下次切角色。
  useEffect(() => {
    setSelectedCostumeId(selectedCharacter?.activeCostumeSetId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePuppetSkeletonId]);

  // ---- 画布 → 面板：单向同步选中节点 ----
  // 画布点击节点只写 ProjectStore.selectedNodeId，
  // 这里按当前阶段分发：perform 阶段进 session，其它阶段进本地 rig 状态。
  useEffect(() => {
    if (!canvasSelectedNodeId) return;
    const st = useProjectStore.getState();
    // Find character containing the node
    let skelId: string | null = null;
    for (const [id, ch] of Object.entries(st.unifiedCharacters ?? {})) {
      if (ch.nodes[canvasSelectedNodeId]) {
        skelId = id;
        break;
      }
    }
    if (!skelId) return;
    // 合并后面板不再分 phase，统一同步选中
    const sess = usePuppetSessionStore.getState();
    if (sess.performNodeId !== canvasSelectedNodeId) {
      usePuppetSessionStore.setState({ performNodeId: canvasSelectedNodeId });
    }
    const editorStore = useEditorStore.getState();
    if (editorStore.activePuppetSkeletonId !== skelId) {
      editorStore.setActivePuppetSkeletonId(skelId);
    }
    if (selectedNodeId !== canvasSelectedNodeId) setSelectedNodeId(canvasSelectedNodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSelectedNodeId]);

  const handleSelectNodeWithSync = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedNodeId(nodeId);
    // 节点树点选同样进入锁定（与画布中键命中同一状态）
    useEditorStore.getState().setNodeLockId(nodeId);
  };

  // M1: rig 阶段纬度写入 store，渲染端读的是 character.latitude
  const handleSetLatitude = useCallback((lat: number) => {
    setLatitude(lat);
    const skelId = useEditorStore.getState().activePuppetSkeletonId;
    if (skelId) {
      useProjectStore.getState().updateUnifiedCharacter(skelId, { latitude: lat });
    }
  }, [activePuppetSkeletonId]);

  const hasSkeletons = Object.keys(unifiedCharacters).length > 0;
  const hasClips = animationClips.some((c) => true);

  // 动画工具页签（不依赖角色在场，常驻）：2026-10-16 退役 workspace
  // mode 时 renderRightPanel 被短路、这批面板连带封存，2026-10-29
  // 审计后恢复。其中工程数据类的四个（画布效果/轨迹/全局/DCC管线）
  // 已按用户裁定归左栏页签；此处只留跟选择走的程序化与应用级的
  // 脚本/插件。
  const toolTabs = [
    {
      id: 'procedural',
      label: '程序化',
      icon: <Activity className="size-4" />,
      content: <ProceduralPanel />,
    },
    {
      id: 'script',
      label: '脚本',
      icon: <Terminal className="size-4" />,
      content: <ScriptPanel />,
    },
    {
      id: 'plugins',
      label: '插件',
      icon: <Puzzle className="size-4" />,
      content: <PluginPanel />,
    },
  ];
  const rightTabIds = [
    ...(hasSkeletons ? ['rig', 'dress', 'perform', 'behavior', 'statemachine', 'behaviortree', 'preview'] : []),
    ...toolTabs.map((t) => t.id),
  ];
  const activeRightTab = rightTabIds.includes(rightTab) ? rightTab : rightTabIds[0];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d1a]">
      {/* Workflow Header */}
      <div className="px-2 py-2 border-b border-[#1e1e3a]">
        {/* Title row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <Users className="size-3.5 text-cyan-400" />
          <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider flex-1">
            木偶工作流
          </span>
          {/* 新建角色入口已收拢到顶部工具栏「＋ 新建角色」统一菜单，
              此处只留草图捕姿（给已有角色摆姿势、不是新建） */}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-amber-400 hover:text-amber-300"
            onClick={() => setSketchPoseOpen(true)}
            title="草图捕姿（选中角色，草划姿态落帧）"
          >
            <PencilRuler className="size-3.5" />
          </Button>
        </div>

      </div>

      <SketchPoseDialog open={sketchPoseOpen} onClose={() => setSketchPoseOpen(false)} />

      {/* Empty state when nothing exists yet */}
      {!hasSkeletons && (
        <div className="flex items-center justify-center px-4 py-8 shrink-0">
          <div className="text-center space-y-3">
            <Users className="size-8 text-cyan-500/30 mx-auto" />
            <div>
              <p className="text-[11px] text-gray-400 mb-1">开始创建木偶角色</p>
              <p className="text-[9px] text-gray-600 leading-relaxed">
                点顶部工具栏的「＋ 新建角色」，可选创建向导、参考图装配、
                火柴人建角、3D 烘焙、Spine 导入或示例角色
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 侧面页签切换：各段各占一页签、独占整高（取代同列折叠段
          堆叠滚动——段再多也只滚激活段自己）。木偶七页签需角色
          在场，动画工具三页签（toolTabs）常驻同排。 */}
      <div className="flex-1 min-h-0">
        <SidePanelTabs
          side="right"
          ariaLabel="右栏面板"
          activeId={activeRightTab}
          onChange={setRightTab}
          tabs={[
            ...((hasSkeletons ? [
              {
                id: 'rig',
                label: '骨架',
                icon: <Bone className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <RigPanel
                      unifiedCharacters={unifiedCharacters}
                      selectedNodeId={selectedNodeId}
                      selectedNode={selectedNode}
                    />
                  </div>
                ),
              },
              {
                id: 'dress',
                label: '换装',
                icon: <Shirt className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <DressPanel
                      unifiedCharacters={unifiedCharacters}
                      sprites={Object.values(sprites)}
                      selectedCostumeId={selectedCostumeId}
                      setSelectedCostumeId={setSelectedCostumeId}
                      selectedNodeId={selectedNodeId}
                      handleSelectNodeWithSync={handleSelectNodeWithSync}
                      hideNodeList={true}
                    />
                  </div>
                ),
              },
              {
                id: 'perform',
                label: '操控',
                icon: <Clapperboard className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <PerformPanel hideNodeList={true} />
                  </div>
                ),
              },
              {
                id: 'behavior',
                label: '行为',
                icon: <Drama className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <BehaviorPanel unifiedCharacters={unifiedCharacters} />
                  </div>
                ),
              },
              {
                id: 'statemachine',
                label: '状态机',
                icon: <Workflow className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <StateMachinePanel unifiedCharacters={unifiedCharacters} />
                  </div>
                ),
              },
              {
                id: 'behaviortree',
                label: '行为树',
                icon: <ListTree className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <BehaviorTreePanel unifiedCharacters={unifiedCharacters} />
                  </div>
                ),
              },
              {
                id: 'preview',
                label: '预览',
                icon: <MonitorPlay className="size-4" />,
                scrollMode: 'scroll',
                content: (
                  <div className="p-2">
                    <ProcPreview unifiedCharacters={unifiedCharacters} />
                  </div>
                ),
              },
            ] : []) as SidePanelTabDef[]),
            ...toolTabs,
          ]}
        />
      </div>
    </div>
  );
}
