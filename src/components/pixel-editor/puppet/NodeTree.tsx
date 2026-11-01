'use client';

import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Plug,
  Link2,
} from 'lucide-react';
import type { PuppetNode } from '@/lib/types';
import type { Node as UnifiedNode } from '@/lib/unified-types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

// Union type for migration: accepts both old PuppetNode and new Node
type AnyNode = PuppetNode | UnifiedNode;

/** 右键菜单操作集（由所在面板提供；不传则无菜单） */
export interface NodeMenuHandlers {
  onRename: (node: AnyNode, name: string) => void;
  onAddChild: (node: AnyNode) => void;
  onAddSocket: (node: AnyNode) => void;
  onClone: (node: AnyNode) => void;
  onTranspose: (node: AnyNode, deg: number) => void;
  onCustomTranspose: (node: AnyNode) => void;
  onToggleVisibility: (node: AnyNode) => void;
  onExpandSubtree: (node: AnyNode, expanded: boolean) => void;
  onDelete: (node: AnyNode) => void;
  isRoot: (node: AnyNode) => boolean;
}

/** 展开/收起子树命令（面板计算子树 id 集后下发， nonce 递增触发） */
export interface ExpandCmd {
  ids: ReadonlySet<string>;
  value: boolean;
  nonce: number;
}

/** Get the plug socket ID for a node (old: node.plug.socketId, new: node.attachment.parentSocketId) */
function getPlugSocketId(node: AnyNode): string | undefined {
  if ('plug' in node && node.plug) return node.plug.socketId;
  if ('attachment' in node && node.attachment?.type === 'socket') return node.attachment.parentSocketId;
  return undefined;
}

/** Get node color (old: node.color, new: fallback) */
function getNodeColor(node: AnyNode): string {
  if ('color' in node && node.color) return node.color as string;
  return '#888';
}

/** Check if node has a plug (is a child node) */
function hasPlug(node: AnyNode): boolean {
  return getPlugSocketId(node) !== undefined;
}

// ---- Node Tree Item ----

function NodeTreeItem({
  node,
  depth,
  selectedNodeId,
  onSelect,
  onSelectNode,
  onToggleExpand,
  expanded,
  childNodes,
  allNodes,
  onToggleVisibility,
  menuHandlers,
  expandCmd,
}: {
  node: AnyNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: () => void;
  /** H14: 未绑定的原始 dispatcher，透传给子节点（不能把已绑定的 onSelect 复用给子节点） */
  onSelectNode: (id: string) => void;
  onToggleExpand: () => void;
  expanded: boolean;
  childNodes: AnyNode[];
  allNodes: AnyNode[];
  onToggleVisibility?: (nodeId: string) => void;
  menuHandlers?: NodeMenuHandlers;
  expandCmd?: ExpandCmd | null;
}) {
  const hasChildren = childNodes.length > 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commitRename = () => {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== node.name) menuHandlers?.onRename(node, name);
  };

  const row = (
    <div
      className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded transition-colors ${
        selectedNodeId === node.id
          ? 'bg-cyan-500/20 text-cyan-400'
          : 'text-gray-400 hover:bg-white/5 hover:text-gray-300'
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={onSelect}
      onContextMenu={menuHandlers ? onSelect : undefined}
    >
      {hasChildren ? (
        <button
          className="p-0 hover:text-gray-200"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
      ) : (
        <span className="w-3" />
      )}
      <div
        className="size-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: getNodeColor(node) }}
      />
      {hasPlug(node) && <Plug className="size-2.5 text-yellow-500/70" />}
      {editing ? (
        <input
          className="h-4 flex-1 min-w-0 bg-[#111128] border border-cyan-700 rounded px-1 text-[10px] text-gray-200 outline-none"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="text-[10px] truncate flex-1 min-w-0">{node.name}</span>
      )}
      {node.sockets.length > 0 && (
        <span className="text-[8px] text-gray-600 flex items-center gap-0.5">
          <Link2 className="size-2" /> {node.sockets.length}
        </span>
      )}
      <button
        className={`p-0 ${node.visible ? 'text-gray-500' : 'text-gray-700'}`}
        onClick={(e) => { e.stopPropagation(); onToggleVisibility?.(node.id); }}
      >
        {node.visible ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
      </button>
    </div>
  );

  const isRootNode = menuHandlers?.isRoot(node) ?? false;

  return (
    <div>
      {menuHandlers ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent className="min-w-36">
            <ContextMenuItem
              onSelect={() => {
                setDraft(node.name);
                setEditing(true);
              }}
            >
              重命名
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => menuHandlers.onAddChild(node)}>
              新建子节点
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => menuHandlers.onAddSocket(node)}>
              添加槽位
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isRootNode}
              onSelect={() => menuHandlers.onClone(node)}
            >
              复制子树
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={isRootNode}>转位克隆</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {[45, 90, 180].map((deg) => (
                  <ContextMenuItem
                    key={deg}
                    onSelect={() => menuHandlers.onTranspose(node, deg)}
                  >
                    {deg}°
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => menuHandlers.onCustomTranspose(node)}>
                  自定义角度…
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => menuHandlers.onToggleVisibility(node)}>
              {node.visible ? '隐藏节点' : '显示节点'}
            </ContextMenuItem>
            {hasChildren && (
              <>
                <ContextMenuItem onSelect={() => menuHandlers.onExpandSubtree(node, true)}>
                  展开全部子级
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => menuHandlers.onExpandSubtree(node, false)}>
                  收起全部子级
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isRootNode}
              className="text-red-400 focus:text-red-300"
              onSelect={() => menuHandlers.onDelete(node)}
            >
              删除节点
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {hasChildren && expanded && (
        <div>
          {childNodes.map((child) => (
            <NodeTreeItemWrapper
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelectNode}
              allNodes={allNodes}
              onToggleVisibility={onToggleVisibility}
              menuHandlers={menuHandlers}
              expandCmd={expandCmd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Wrapper that manages expand state per node
function NodeTreeItemWrapper({
  node,
  depth,
  selectedNodeId,
  onSelect,
  allNodes,
  onToggleVisibility,
  menuHandlers,
  expandCmd,
}: {
  node: AnyNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  allNodes: AnyNode[];
  onToggleVisibility?: (nodeId: string) => void;
  menuHandlers?: NodeMenuHandlers;
  expandCmd?: ExpandCmd | null;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (expandCmd && expandCmd.ids.has(node.id)) setExpanded(expandCmd.value);
  }, [expandCmd, node.id]);

  const childNodes = allNodes.filter((n) => {
    // 新模型：父子以 parentId 为准（与渲染器同一口径）；旧模型无 parentId，靠 plug.socketId 匹配
    // （此前一律用 socket 匹配：fixed 附件的子节点 parentId 非空却匹配不上 socket，会从树上整个消失）
    if ('parentId' in n) return n.parentId === node.id;
    const plugSocketId = getPlugSocketId(n);
    return plugSocketId && node.sockets.some((s) => s.id === plugSocketId);
  });

  return (
    <NodeTreeItem
      node={node}
      depth={depth}
      selectedNodeId={selectedNodeId}
      onSelect={() => onSelect(node.id)}
      onSelectNode={onSelect}
      onToggleExpand={() => setExpanded(!expanded)}
      expanded={expanded}
      childNodes={childNodes}
      allNodes={allNodes}
      onToggleVisibility={onToggleVisibility}
      menuHandlers={menuHandlers}
      expandCmd={expandCmd}
    />
  );
}

export { NodeTreeItemWrapper };
