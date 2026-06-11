'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/lib/store';
import type { EffectTrack, ModifierParamValue } from '@/lib/types';
import { EFFECT_CONFIG } from '../constants';

// ---- Effect Keyframe Edit Dialog ----
export default function EffectKeyframeEditDialog({
  open,
  onOpenChange,
  effectTrack,
  keyframeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effectTrack: EffectTrack | null;
  keyframeId: string | null;
}) {
  const { updateEffectKeyframe } = useProjectStore();
  const keyframe = effectTrack?.keyframes.find((k) => k.id === keyframeId);

  const initialParams = useMemo(() => {
    return keyframe ? { ...keyframe.params } : {};
  }, [keyframe]);

  const [params, setParams] = useState<Record<string, ModifierParamValue>>(initialParams);

  useEffect(() => {
    setParams(initialParams);
  }, [initialParams]);

  if (!effectTrack || !keyframe) return null;

  const handleSave = () => {
    updateEffectKeyframe(effectTrack.id, keyframe.id, params);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1a1a2e] border-white/10 text-gray-200 max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm text-gray-100 flex items-center gap-2">
            {EFFECT_CONFIG[effectTrack.type]?.icon}
            Edit Effect Keyframe
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-400">
            Frame {keyframe?.frame ?? 0} - {effectTrack.name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {Object.entries(params).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 w-16 shrink-0 truncate">{key}</span>
              <Input
                type={typeof value === 'boolean' ? 'text' : typeof value === 'number' ? 'number' : 'text'}
                value={typeof value === 'boolean' ? String(value) : String(value)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (typeof value === 'number') {
                    setParams((p) => ({ ...p, [key]: parseFloat(v) || 0 }));
                  } else if (typeof value === 'boolean') {
                    setParams((p) => ({ ...p, [key]: v === 'true' }));
                  } else {
                    setParams((p) => ({ ...p, [key]: v }));
                  }
                }}
                className="h-7 text-xs bg-white/5 border-white/10 text-gray-300 px-2 flex-1"
              />
            </div>
          ))}
          {Object.keys(params).length === 0 && (
            <p className="text-xs text-gray-500 text-center py-2">No parameters to edit</p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white" onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
