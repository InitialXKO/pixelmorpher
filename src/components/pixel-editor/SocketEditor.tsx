'use client';

import { useState, useCallback } from 'react';
import { DirectionIndex, DIRECTION_NAMES } from '@/lib/unified-types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Link2, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Exported Types
// ---------------------------------------------------------------------------

/** Socket info that works with both old and new data models */
export interface SocketInfo {
  id: string;
  name: string;
  x: number; // Base X position (pixels)
  y: number; // Base Y position (pixels)
  directionOffsets?: Partial<Record<number, { x: number; y: number }>>; // Per-direction overrides
}

export interface SocketEditorProps {
  sockets: SocketInfo[];
  onSocketChange: (socketId: string, updates: Partial<SocketInfo>) => void;
  onSocketAdd: () => void;
  onSocketRemove: (socketId: string) => void;
  selectedDirection?: DirectionIndex;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_DIRECTIONS: DirectionIndex[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** Short display labels for the direction mini-grid */
const DIR_SHORT: Record<DirectionIndex, string> = {
  0: 'E',
  1: 'NE',
  2: 'N',
  3: 'NW',
  4: 'W',
  5: 'SW',
  6: 'S',
  7: 'SE',
};

// ---------------------------------------------------------------------------
// SocketCard – a single collapsible socket editor
// ---------------------------------------------------------------------------

interface SocketCardProps {
  socket: SocketInfo;
  onChange: (updates: Partial<SocketInfo>) => void;
  onRemove: () => void;
  selectedDirection?: DirectionIndex;
  disabled?: boolean;
}

function SocketCard({ socket, onChange, onRemove, selectedDirection, disabled }: SocketCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingDir, setEditingDir] = useState<DirectionIndex | null>(selectedDirection ?? null);

  const offsets = socket.directionOffsets ?? {};

  const handleBaseXChange = useCallback(
    (value: string) => {
      onChange({ x: Number(value) || 0 });
    },
    [onChange],
  );

  const handleBaseYChange = useCallback(
    (value: string) => {
      onChange({ y: Number(value) || 0 });
    },
    [onChange],
  );

  const handleDirOffsetChange = useCallback(
    (dir: DirectionIndex, axis: 'x' | 'y', value: string) => {
      const existing = offsets[dir] ?? { x: 0, y: 0 };
      const newOffset = { ...existing, [axis]: Number(value) || 0 };
      onChange({
        directionOffsets: {
          ...offsets,
          [dir]: newOffset,
        },
      });
    },
    [offsets, onChange],
  );

  const handleResetDirOffset = useCallback(
    (dir: DirectionIndex) => {
      const next = { ...offsets };
      delete next[dir];
      onChange({ directionOffsets: next });
      if (editingDir === dir) {
        setEditingDir(null);
      }
    },
    [offsets, onChange, editingDir],
  );

  const handleDirClick = useCallback(
    (dir: DirectionIndex) => {
      if (editingDir === dir) {
        setEditingDir(null);
        return;
      }
      // If no override exists yet, create one seeded from base position
      if (!offsets[dir]) {
        onChange({
          directionOffsets: {
            ...offsets,
            [dir]: { x: 0, y: 0 },
          },
        });
      }
      setEditingDir(dir);
    },
    [editingDir, offsets, onChange],
  );

  const activeOffsetCount = Object.keys(offsets).length;

  return (
    <div className="bg-[#0d0d1a] rounded p-1 border border-[#1e1e3a]/50 space-y-1">
      {/* ---- Header row ---- */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex items-center justify-center size-4 text-gray-600 hover:text-gray-400 transition-colors"
          onClick={() => setExpanded((v) => !v)}
          tabIndex={-1}
        >
          {expanded ? (
            <ChevronDown className="size-2.5" />
          ) : (
            <ChevronRight className="size-2.5" />
          )}
        </button>
        <Link2 className="size-2.5 text-yellow-500/70 flex-shrink-0" />
        <Input
          value={socket.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-5 text-[9px] bg-[#080818] border-[#1e1e3a] flex-1"
          disabled={disabled}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-4 text-red-400 hover:text-red-300 flex-shrink-0"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="size-2" />
        </Button>
      </div>

      {/* ---- Base position (always visible) ---- */}
      <div className="flex items-center gap-1 pl-5">
        <Label className="text-[8px] text-gray-600 w-4">X</Label>
        <Input
          type="number"
          value={socket.x}
          onChange={(e) => handleBaseXChange(e.target.value)}
          className="h-4 text-[8px] bg-[#080818] border-[#1e1e3a] w-12"
          disabled={disabled}
        />
        <Label className="text-[8px] text-gray-600 w-4">Y</Label>
        <Input
          type="number"
          value={socket.y}
          onChange={(e) => handleBaseYChange(e.target.value)}
          className="h-4 text-[8px] bg-[#080818] border-[#1e1e3a] w-12"
          disabled={disabled}
        />
      </div>

      {/* ---- Direction offsets (collapsible) ---- */}
      {expanded && (
        <div className="pl-3 space-y-1.5">
          {/* Section header */}
          <div className="flex items-center justify-between pr-1">
            <span className="text-[9px] text-gray-600 uppercase tracking-wider">
              方向偏移
            </span>
            {activeOffsetCount > 0 && (
              <span className="text-[7px] text-cyan-500/60">
                {activeOffsetCount} 已覆盖
              </span>
            )}
          </div>

          {/* Direction grid: 4 columns × 2 rows */}
          <div className="grid grid-cols-4 gap-0.5">
            {ALL_DIRECTIONS.map((dir) => {
              const hasOverride = offsets[dir] !== undefined;
              const isEditing = editingDir === dir;
              return (
                <button
                  key={dir}
                  type="button"
                  className={`
                    relative size-5 rounded text-[7px] flex items-center justify-center transition-colors
                    ${isEditing ? 'bg-cyan-900/40 text-cyan-300 ring-1 ring-cyan-500/50' : 'bg-[#080818] text-gray-500 hover:bg-[#10102a] hover:text-gray-300'}
                  `}
                  onClick={() => handleDirClick(dir)}
                  disabled={disabled}
                  title={DIRECTION_NAMES[dir]}
                >
                  {DIR_SHORT[dir]}
                  {hasOverride && (
                    <span
                      className={`absolute -top-px -right-px size-1 rounded-full ${isEditing ? 'bg-cyan-400' : 'bg-cyan-500/70'}`}
                    />
                  )}
                  {!hasOverride && (
                    <span className="absolute -top-px -right-px size-1 rounded-full bg-gray-700" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Editing panel for selected direction */}
          {editingDir !== null && (
            <div className="bg-[#080818] rounded p-1.5 border border-[#1e1e3a]/30 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-gray-400">
                  {DIRECTION_NAMES[editingDir]} 偏移
                </span>
                {offsets[editingDir] !== undefined && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-3.5 text-gray-500 hover:text-cyan-400"
                    onClick={() => handleResetDirOffset(editingDir)}
                    disabled={disabled}
                    title="重置"
                  >
                    <RotateCcw className="size-2" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-[8px] text-gray-600 w-4">X</Label>
                <Input
                  type="number"
                  value={offsets[editingDir]?.x ?? 0}
                  onChange={(e) => handleDirOffsetChange(editingDir, 'x', e.target.value)}
                  className="h-4 text-[8px] bg-[#0d0d1a] border-[#1e1e3a] w-12"
                  disabled={disabled}
                />
                <Label className="text-[8px] text-gray-600 w-4">Y</Label>
                <Input
                  type="number"
                  value={offsets[editingDir]?.y ?? 0}
                  onChange={(e) => handleDirOffsetChange(editingDir, 'y', e.target.value)}
                  className="h-4 text-[8px] bg-[#0d0d1a] border-[#1e1e3a] w-12"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SocketEditor – the main exported component
// ---------------------------------------------------------------------------

export function SocketEditor({
  sockets,
  onSocketChange,
  onSocketAdd,
  onSocketRemove,
  selectedDirection,
  disabled,
}: SocketEditorProps) {
  return (
    <div className="space-y-1.5">
      {/* Title bar */}
      <div className="flex items-center justify-between">
        <Label className="text-[9px] text-gray-600 uppercase tracking-wider">插口</Label>
        <Button
          variant="ghost"
          size="icon"
          className="size-4 text-cyan-400 hover:text-cyan-300"
          onClick={onSocketAdd}
          disabled={disabled}
        >
          <Plus className="size-2.5" />
        </Button>
      </div>

      {/* Empty state */}
      {sockets.length === 0 ? (
        <p className="text-[9px] text-gray-700 text-center py-1">无插口</p>
      ) : (
        sockets.map((socket) => (
          <SocketCard
            key={socket.id}
            socket={socket}
            onChange={(updates) => onSocketChange(socket.id, updates)}
            onRemove={() => onSocketRemove(socket.id)}
            selectedDirection={selectedDirection}
            disabled={disabled}
          />
        ))
      )}
    </div>
  );
}
