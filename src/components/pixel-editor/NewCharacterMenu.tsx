'use client';

import { useState } from 'react';
import {
  Plus,
  ChevronDown,
  Wand2,
  Image,
  PenLine,
  Box,
  FileUp,
  Package,
  Dog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjectStore, useEditorStore } from '@/lib/store';
import { useAssetStore } from '@/lib/asset-store';
import { usePuppetSessionStore } from '@/lib/puppet-session-store';
import PuppetCreationWizard from './PuppetCreationWizard';
import SpineImportDialog from './SpineImportDialog';
import StrokeBuildWizard from './puppet/StrokeBuildWizard';
import ThreeBakeDialog from './puppet/ThreeBakeDialog';

/**
 * 统一新建角色入口（工具栏常驻）：全部新建方式收在一处——创建
 * 向导 / 参考图装配 / 火柴人建角 / 3D 烘焙 / Spine 导入 / 新建
 * 道具 / 示例小狗。各创建对话框只在此挂一份宿主（参考图装配不
 * 是对话框、是资产面板的整版替换视图，宿主唯一地留在资产面板，
 * 由 editor store 的 refWizardOpen 驱动；从这里触发时同时把左栏
 * 切到资产页签露出它）。
 *
 * 放在工具栏而非任何侧栏面板里：页签化后各面板头部都在页签之
 * 后，唯一入口不能藏回某个面板。
 */
export default function NewCharacterMenu() {
  // 工程主页（无工程打开）时不出现：与原来入口只在编辑器面板里
  // 可达的口径一致，避免在未打开工程时往后台工程里建角色
  const showProjectHome = useAssetStore((s) => s.showProjectHome);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [strokeWizardOpen, setStrokeWizardOpen] = useState(false);
  const [spineImportOpen, setSpineImportOpen] = useState(false);
  const [threeBakeOpen, setThreeBakeOpen] = useState(false);

  const openRefAssembly = () => {
    const editor = useEditorStore.getState();
    editor.setLeftPanelTab('assets');
    editor.setRefWizardOpen(true);
  };

  const createProp = () => {
    const store = useProjectStore.getState();
    const count = Object.keys(store.unifiedCharacters ?? {}).length;
    store.addUnifiedCharacter(`道具${count + 1}`);
  };

  const createPuppyExample = () => {
    import('@/lib/blueprint/examples/quadruped-run').then((m) => {
      const sessionStore = usePuppetSessionStore.getState();
      const id = m.createPuppyRunExampleCharacter(useProjectStore, sessionStore);
      if (!id) {
        alert('小狗创建失败，请看控制台');
      }
    });
  };

  const itemCls = 'text-xs text-gray-300 focus:text-gray-100 cursor-pointer';
  const iconCls = 'size-3.5 mr-2 text-gray-500';

  if (showProjectHome) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className="h-7 text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-2 shrink-0"
            title="新建角色（全部方式都在这里）"
          >
            <Plus className="size-3.5 mr-1" />
            新建角色
            <ChevronDown className="size-3 ml-1 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-zinc-900 border-zinc-700 min-w-[180px]">
          <DropdownMenuLabel className="text-[10px] text-zinc-500">新建角色</DropdownMenuLabel>
          <DropdownMenuItem className={itemCls} onClick={() => setWizardOpen(true)}>
            <Wand2 className={iconCls} /> 创建向导
          </DropdownMenuItem>
          <DropdownMenuItem className={itemCls} onClick={openRefAssembly}>
            <Image className={iconCls} /> 从参考图装配
          </DropdownMenuItem>
          <DropdownMenuItem className={itemCls} onClick={() => setStrokeWizardOpen(true)}>
            <PenLine className={iconCls} /> 画火柴人建角
          </DropdownMenuItem>
          <DropdownMenuItem className={itemCls} onClick={() => setThreeBakeOpen(true)}>
            <Box className={iconCls} /> 3D 烘焙导入（GLB）
          </DropdownMenuItem>
          <DropdownMenuItem className={itemCls} onClick={() => setSpineImportOpen(true)}>
            <FileUp className={iconCls} /> 导入 Spine 项目
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-zinc-800" />
          <DropdownMenuItem className={itemCls} onClick={createProp}>
            <Package className={iconCls} /> 新建道具（单节点）
          </DropdownMenuItem>
          <DropdownMenuItem className={itemCls} onClick={createPuppyExample}>
            <Dog className={iconCls} /> 示例：小狗奔跑
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 各创建对话框的唯一宿主 */}
      <PuppetCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <StrokeBuildWizard open={strokeWizardOpen} onClose={() => setStrokeWizardOpen(false)} />
      <SpineImportDialog open={spineImportOpen} onClose={() => setSpineImportOpen(false)} />
      <ThreeBakeDialog open={threeBakeOpen} onClose={() => setThreeBakeOpen(false)} />
    </>
  );
}
