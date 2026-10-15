'use client';

import React, { useState, useRef } from 'react';
import { useProjectStore } from '@/lib/store';
import { parseAtlas, importSpineToCharacter, extractSpritesFromAtlas, loadImageFromFile } from '@/lib/spine-importer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface SpineImportDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Spine import dialog: one-time conversion of Spine JSON + Atlas + PNG
 * into a Character in unifiedCharacters.
 */
export default function SpineImportDialog({ open, onClose }: SpineImportDialogProps) {
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [atlasFile, setAtlasFile] = useState<File | null>(null);
  const [pngFile, setPngFile] = useState<File | null>(null);
  const [characterName, setCharacterName] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const jsonRef = useRef<HTMLInputElement>(null);
  const atlasRef = useRef<HTMLInputElement>(null);
  const pngRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const canImport = jsonFile && atlasFile && pngFile && characterName.trim() && status !== 'working';

  const handleImport = async () => {
    if (!jsonFile || !atlasFile || !pngFile || !characterName.trim()) return;
    setStatus('working');
    setMessage('解析中...');
    try {
      // 1. Parse JSON
      const jsonText = await jsonFile.text();
      const spineJson = JSON.parse(jsonText);
      setMessage('解析 Atlas...');

      // 2. Parse atlas
      const atlasText = await atlasFile.text();
      const regions = parseAtlas(atlasText);
      setMessage(`提取精灵 (${regions.length} 个区域)...`);

      // 3. Extract sprites from PNG (one-time)
      const image = await loadImageFromFile(pngFile);
      const sprites = await extractSpritesFromAtlas(image, regions);
      setMessage('构建角色...');

      // 4. Build Character (sprites go to global table)
      const { character, sprites: charSprites } = importSpineToCharacter(spineJson, regions, sprites, characterName.trim());

      // 5. Save to store
      const store = useProjectStore.getState();
      store.pushUndo(`导入 Spine: ${characterName.trim()}`);
      useProjectStore.setState((s: any) => ({
        unifiedCharacters: { ...s.unifiedCharacters, [character.id]: character },
        selectedCharacterId: character.id,
        sprites: { ...s.sprites, ...charSprites },
      }));

      setStatus('done');
      setMessage(`导入成功: ${Object.keys(character.nodes).length} 节点, ${Object.keys(charSprites).length} 精灵, ${character.costumeSets.length} 服装集`);
    } catch (e: any) {
      setStatus('error');
      setMessage(`导入失败: ${e.message}`);
    }
  };

  const handleClose = () => {
    setJsonFile(null); setAtlasFile(null); setPngFile(null);
    setCharacterName(''); setStatus('idle'); setMessage('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div className="bg-[#0a0a1a] border border-[#1e1e3a] rounded-lg p-6 w-[480px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-4">导入 Spine 项目</h2>
        <p className="text-xs text-gray-400 mb-4">
          一次性转换：Spine JSON + Atlas + PNG → Character（存入项目，之后不再需要源文件）
        </p>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-400">角色名称</Label>
            <Input
              value={characterName}
              onChange={e => setCharacterName(e.target.value)}
              placeholder="例如：spineboy"
              className="mt-1 h-8 text-sm bg-[#111128] border-[#1e1e3a]"
            />
          </div>

          <div>
            <Label className="text-xs text-gray-400">Spine JSON (.json)</Label>
            <div className="flex gap-2 mt-1">
              <Button variant="outline" size="sm" onClick={() => jsonRef.current?.click()} className="text-xs">
                <Upload className="size-3 mr-1" /> 选择
              </Button>
              <span className="text-xs text-gray-500 self-center">{jsonFile?.name ?? '未选择'}</span>
            </div>
            <input ref={jsonRef} type="file" accept=".json" className="hidden"
              onChange={e => setJsonFile(e.target.files?.[0] ?? null)} />
          </div>

          <div>
            <Label className="text-xs text-gray-400">Atlas (.atlas)</Label>
            <div className="flex gap-2 mt-1">
              <Button variant="outline" size="sm" onClick={() => atlasRef.current?.click()} className="text-xs">
                <Upload className="size-3 mr-1" /> 选择
              </Button>
              <span className="text-xs text-gray-500 self-center">{atlasFile?.name ?? '未选择'}</span>
            </div>
            <input ref={atlasRef} type="file" accept=".atlas,.txt" className="hidden"
              onChange={e => setAtlasFile(e.target.files?.[0] ?? null)} />
          </div>

          <div>
            <Label className="text-xs text-gray-400">贴图 (.png)</Label>
            <div className="flex gap-2 mt-1">
              <Button variant="outline" size="sm" onClick={() => pngRef.current?.click()} className="text-xs">
                <Upload className="size-3 mr-1" /> 选择
              </Button>
              <span className="text-xs text-gray-500 self-center">{pngFile?.name ?? '未选择'}</span>
            </div>
            <input ref={pngRef} type="file" accept=".png" className="hidden"
              onChange={e => setPngFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        {message && (
          <div className={`mt-4 p-2 rounded text-xs flex items-center gap-2 ${
            status === 'error' ? 'bg-red-900/30 text-red-300' :
            status === 'done' ? 'bg-green-900/30 text-green-300' :
            'bg-blue-900/30 text-blue-300'
          }`}>
            {status === 'working' && <Loader2 className="size-3 animate-spin" />}
            {status === 'done' && <CheckCircle2 className="size-3" />}
            {status === 'error' && <AlertCircle className="size-3" />}
            {message}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" size="sm" onClick={handleClose}>取消</Button>
          <Button size="sm" disabled={!canImport} onClick={handleImport}
            className="bg-cyan-600 hover:bg-cyan-500">
            {status === 'working' ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
            导入
          </Button>
        </div>
      </div>
    </div>
  );
}
