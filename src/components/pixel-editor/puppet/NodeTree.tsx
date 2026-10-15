'use client';

import React, { useState } from 'react';
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

// Union type for migration: accepts both old PuppetNode and new Node
type AnyNode = PuppetNode | UnifiedNode;

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
}) {
  const hasChildren = childNodes.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer rounded transition-colors ${
          selectedNodeId === node.id
            ? 'bg-cyan-500/20 text-cyan-400'
            : 'text-gray-400 hover:bg-white/5 hover:text-gray-300'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={onSelect}
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
        <span className="text-[10px] truncate flex-1 min-w-0">{node.name}</span>
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
}: {
  node: AnyNode;
  depth: number;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  allNodes: AnyNode[];
  onToggleVisibility?: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const childNodes = allNodes.filter((n) => {
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
    />
  );
}

export { NodeTreeItemWrapper };
