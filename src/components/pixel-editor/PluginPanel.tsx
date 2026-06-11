'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Puzzle, Plus, Trash2, Info, Package } from 'lucide-react';
import {
  pluginManager,
  PluginInstance,
  PluginManifest,
} from '@/lib/plugin-manager';

export default function PluginPanel() {
  const [plugins, setPlugins] = useState<PluginInstance[]>(() =>
    pluginManager.getPlugins(),
  );
  const [detailPlugin, setDetailPlugin] = useState<PluginInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshPlugins = useCallback(() => {
    setPlugins([...pluginManager.getPlugins()]);
  }, []);

  const handleTogglePlugin = useCallback(
    (id: string) => {
      pluginManager.togglePlugin(id);
      refreshPlugins();
    },
    [refreshPlugins],
  );

  const handleRemovePlugin = useCallback(
    (id: string) => {
      pluginManager.unregisterPlugin(id);
      refreshPlugins();
    },
    [refreshPlugins],
  );

  const handleInstallPlugin = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);

          // Validate manifest
          if (!data.id || !data.name || !data.version || !data.main) {
            alert('无效的插件文件：缺少必要的清单字段 (id, name, version, main)');
            return;
          }

          const manifest: PluginManifest = {
            id: data.id,
            name: data.name,
            version: data.version,
            description: data.description || '',
            author: data.author || 'Unknown',
            main: data.main,
          };

          // Create plugin code from the loaded data
          const pluginCode = data.code || data.pluginCode;
          if (typeof pluginCode === 'function') {
            pluginManager.registerPlugin(manifest, pluginCode);
          } else if (typeof pluginCode === 'string') {
            // Compile string code to function
            try {
              const fn = new Function('api', pluginCode);
              pluginManager.registerPlugin(manifest, fn as any);
            } catch (compileErr) {
              alert(`插件代码编译失败: ${(compileErr as Error).message}`);
              return;
            }
          } else {
            // Register with empty implementation
            pluginManager.registerPlugin(manifest, () => ({}));
          }

          refreshPlugins();
        } catch (err) {
          alert(`无法解析插件文件: ${(err as Error).message}`);
        }
      };
      reader.readAsText(file);

      // Reset file input
      e.target.value = '';
    },
    [refreshPlugins],
  );

  const customModifiers = pluginManager.getCustomModifiers();
  const customExporters = pluginManager.getCustomExporters();

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header with install button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-[10px] text-zinc-500 font-medium">
          已安装插件 ({plugins.length})
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleInstallPlugin}
          className="h-5 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          <Plus className="size-3 mr-0.5" />
          安装
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelected}
          className="hidden"
        />
      </div>

      {/* Plugin list */}
      <ScrollArea className="flex-1">
        {plugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <Package className="size-10 text-zinc-700 mb-3" />
            <p className="text-xs text-zinc-500 text-center mb-1">暂无已安装的插件</p>
            <p className="text-[10px] text-zinc-600 text-center leading-relaxed">
              点击上方"安装"按钮从 .json 文件<br />
              安装插件，或使用脚本面板创建<br />
              自定义脚本
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {plugins.map((plugin) => (
              <div
                key={plugin.manifest.id}
                className={`rounded border p-2 transition-colors ${
                  plugin.enabled
                    ? 'bg-zinc-900/80 border-zinc-800'
                    : 'bg-zinc-900/40 border-zinc-800/50 opacity-60'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Puzzle className="size-3 text-zinc-500 shrink-0" />
                      <span className="text-xs text-zinc-200 truncate font-medium">
                        {plugin.manifest.name}
                      </span>
                      <span className="text-[9px] text-zinc-600 shrink-0">
                        v{plugin.manifest.version}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 ml-5 truncate">
                      {plugin.manifest.author}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDetailPlugin(plugin)}
                      className="h-5 w-5 p-0 text-zinc-500 hover:text-zinc-300"
                    >
                      <Info className="size-3" />
                    </Button>
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={() => handleTogglePlugin(plugin.manifest.id)}
                      className="scale-75"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemovePlugin(plugin.manifest.id)}
                      className="h-5 w-5 p-0 text-red-500/60 hover:text-red-400"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Registered capabilities summary */}
      {(customModifiers.length > 0 || customExporters.length > 0) && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <div className="text-[9px] text-zinc-600 mb-1">已注册能力</div>
          {customModifiers.length > 0 && (
            <div className="text-[10px] text-zinc-500">
              修改器: {customModifiers.map((m) => m.name).join(', ')}
            </div>
          )}
          {customExporters.length > 0 && (
            <div className="text-[10px] text-zinc-500">
              导出器: {customExporters.map((e) => e.name).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Plugin Detail Dialog */}
      <Dialog open={!!detailPlugin} onOpenChange={(open) => !open && setDetailPlugin(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Puzzle className="size-4 text-zinc-400" />
              {detailPlugin?.manifest.name}
            </DialogTitle>
          </DialogHeader>
          {detailPlugin && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-zinc-500">版本</span>
                  <div className="text-zinc-300">{detailPlugin.manifest.version}</div>
                </div>
                <div>
                  <span className="text-zinc-500">作者</span>
                  <div className="text-zinc-300">{detailPlugin.manifest.author}</div>
                </div>
              </div>
              <div>
                <span className="text-zinc-500">描述</span>
                <div className="text-zinc-300 mt-0.5">
                  {detailPlugin.manifest.description || '无描述'}
                </div>
              </div>
              <div>
                <span className="text-zinc-500">插件ID</span>
                <div className="text-zinc-400 font-mono text-[10px] mt-0.5 break-all">
                  {detailPlugin.manifest.id}
                </div>
              </div>
              <div>
                <span className="text-zinc-500">状态</span>
                <div className="mt-0.5">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                      detailPlugin.enabled
                        ? 'bg-emerald-900/30 text-emerald-400'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        detailPlugin.enabled ? 'bg-emerald-400' : 'bg-zinc-600'
                      }`}
                    />
                    {detailPlugin.enabled ? '已启用' : '已禁用'}
                  </span>
                </div>
              </div>

              {/* Show registered capabilities for this plugin */}
              {(() => {
                const modifiers = pluginManager
                  .getCustomModifiers()
                  .filter((m) => m.id.startsWith(detailPlugin.manifest.id + ':'));
                const exporters = pluginManager
                  .getCustomExporters()
                  .filter((e) => e.id.startsWith(detailPlugin.manifest.id + ':'));

                if (modifiers.length === 0 && exporters.length === 0) return null;

                return (
                  <div>
                    <span className="text-zinc-500">注册的能力</span>
                    <div className="mt-1 space-y-1">
                      {modifiers.map((m) => (
                        <div
                          key={m.id}
                          className="text-[10px] text-zinc-400 bg-zinc-800/50 rounded px-2 py-1"
                        >
                          修改器: {m.name} ({m.params.length} 参数)
                        </div>
                      ))}
                      {exporters.map((e) => (
                        <div
                          key={e.id}
                          className="text-[10px] text-zinc-400 bg-zinc-800/50 rounded px-2 py-1"
                        >
                          导出器: {e.name} (.{e.extension})
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
