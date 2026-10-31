'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Trash2, Copy, ChevronDown, Terminal } from 'lucide-react';
import { pluginManager } from '@/lib/plugin-manager';
import { useProjectStore } from '@/lib/store';

const SCRIPT_TEMPLATES: { id: string; label: string; code: string }[] = [
  {
    id: 'batch-keyframes',
    label: '批量添加关键帧',
    code: `// 批量添加关键帧 - 为每个角色的每个片段、每个节点每 4 帧按静止姿态添加关键帧
// 片段清单经 api.exportProjectFile() 读取（api 没有单独的片段查询方法）。
// 落键值取节点静止姿态 transform 的 x/y/angle（与轨道通道同单位）；
// 已有同帧关键帧会被覆盖；无片段的角色跳过。
const data = api.exportProjectFile();
const clips = data.project.animationClips || [];
const characters = api.getCharacters();
const totalFrames = api.getTotalFrames();
const charsData = data.project.unifiedCharacters || {};
let added = 0;
for (const char of characters) {
  const charClips = clips.filter((c) => c.puppetCharacterId === char.id);
  if (charClips.length === 0) {
    console.log('跳过（无片段）: ' + char.name);
    continue;
  }
  const nodes = api.getNodes(char.id);
  const charData = charsData[char.id];
  for (const clip of charClips) {
    for (const node of nodes) {
      const t = (charData && charData.nodes[node.id] && charData.nodes[node.id].transform) || {};
      for (let frame = 0; frame < totalFrames; frame += 4) {
        api.addNodeKeyframe(clip.id, node.id, frame, { angle: t.angle ?? 0, x: t.x ?? 0, y: t.y ?? 0 });
        added++;
      }
    }
  }
}
console.log('Done! Added ' + added + ' keyframes for ' + characters.length + ' characters');`,
  },
  {
    id: 'node-report',
    label: '节点报告',
    code: `// 节点报告 - 输出所有角色的节点信息
const characters = api.getCharacters();
console.log('=== Characters Report ===');
for (const char of characters) {
  const nodes = api.getNodes(char.id);
  console.log('Character: ' + char.name + ' (' + nodes.length + ' nodes)');
  for (const node of nodes) {
    console.log('  - ' + node.name + ' (' + node.id + ')');
  }
}
console.log('========================');`,
  },
  {
    id: 'random-rotation',
    label: '随机旋转动画',
    code: `// 随机旋转动画 - 为选中节点在其角色的第一个片段上生成随机角度关键帧
// 每 8 帧落一个 -15°..15° 的随机角度键（帧间自动插值），末帧回到 0° 收尾。
// 片段清单经 api.exportProjectFile() 读取（api 没有单独的片段查询方法）。
const nodeId = api.getSelectedNodeId();
if (!nodeId) {
  console.log('请先在画布上选择一个节点');
} else {
  const data = api.exportProjectFile();
  const charsData = data.project.unifiedCharacters || {};
  const charId = Object.keys(charsData).find((id) => charsData[id].nodes && charsData[id].nodes[nodeId]);
  const clip = (data.project.animationClips || []).find((c) => c.puppetCharacterId === charId);
  if (!charId || !clip) {
    console.log('选中节点所在角色没有片段，无法添加关键帧');
  } else {
    const totalFrames = api.getTotalFrames();
    let count = 0;
    for (let frame = 0; frame < totalFrames; frame += 8) {
      const angle = Math.round(Math.random() * 30 - 15);
      api.addNodeKeyframe(clip.id, nodeId, frame, { angle: angle });
      count++;
    }
    if (totalFrames > 1) {
      api.addNodeKeyframe(clip.id, nodeId, totalFrames - 1, { angle: 0 });
      count++;
    }
    console.log('已为节点 ' + nodeId + ' 生成 ' + count + ' 个随机旋转关键帧');
  }
}`,
  },
  {
    id: 'export-report',
    label: '导出报告',
    code: `// 导出报告 - 输出项目统计信息
const projectName = api.getProjectName();
const canvasSize = api.getCanvasSize();
const totalFrames = api.getTotalFrames();
const currentFrame = api.getCurrentFrame();
const characters = api.getCharacters();
const sprites = api.getSprites();

let totalNodes = 0;
for (const char of characters) {
  totalNodes += api.getNodes(char.id).length;
}

console.log('=== Project Report ===');
console.log('Name: ' + projectName);
console.log('Canvas: ' + canvasSize.width + 'x' + canvasSize.height);
console.log('Frames: ' + totalFrames + ' (current: ' + currentFrame + ')');
console.log('Characters: ' + characters.length);
console.log('Nodes: ' + totalNodes);
console.log('Sprites: ' + sprites.length);
console.log('=====================');`,
  },
];

interface OutputEntry {
  type: 'log' | 'warn' | 'error' | 'result' | 'system';
  text: string;
  timestamp: number;
}

const HISTORY_KEY = 'pixelmorpher-script-history';
const MAX_HISTORY = 20;

export default function ScriptPanel() {
  const [code, setCode] = useState(SCRIPT_TEMPLATES[0].code);
  const [output, setOutput] = useState<OutputEntry[]>([
    { type: 'system', text: '// PixelMorpher 脚本控制台\n// 使用 api 对象访问编辑器功能\n// 按 Ctrl+Enter 执行脚本', timestamp: Date.now() },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(SCRIPT_TEMPLATES[0].id);
  const outputRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load script history from localStorage
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const addOutput = useCallback((type: OutputEntry['type'], text: string) => {
    setOutput((prev) => [...prev, { type, text, timestamp: Date.now() }]);
  }, []);

  const runScript = useCallback(() => {
    if (isRunning || !code.trim()) return;
    setIsRunning(true);
    addOutput('system', '> 执行脚本...');
    // 整段脚本的写入压成一笔撤销：pushUndo 的快照是全工程级（含
    // unifiedCharacters），api 的主要写路径都落在这份快照里；脚本
    // 中途抛错时已写的部分也能一步退回。
    useProjectStore.getState().pushUndo('执行脚本');

    // Capture console output
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    const captured: { type: OutputEntry['type']; text: string }[] = [];

    console.log = (...args: any[]) => {
      captured.push({ type: 'log', text: args.map(String).join(' ') });
      origLog(...args);
    };
    console.warn = (...args: any[]) => {
      captured.push({ type: 'warn', text: args.map(String).join(' ') });
      origWarn(...args);
    };
    console.error = (...args: any[]) => {
      captured.push({ type: 'error', text: args.map(String).join(' ') });
      origError(...args);
    };

    try {
      const result = pluginManager.executeScript(code);
      // Flush captured output
      for (const entry of captured) {
        addOutput(entry.type, entry.text);
      }
      if (result !== undefined) {
        addOutput('result', String(result));
      }
      addOutput('system', '> 脚本执行完成');

      // Save to history
      const newHistory = [code, ...history.filter((h) => h !== code)].slice(0, MAX_HISTORY);
      setHistory(newHistory);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
      } catch { /* ignore */ }
    } catch (err: any) {
      // Flush captured output
      for (const entry of captured) {
        addOutput(entry.type, entry.text);
      }
      addOutput('error', `Error: ${err.message || String(err)}`);
      addOutput('system', '> 脚本执行失败');
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      setIsRunning(false);
    }
  }, [code, isRunning, history, addOutput]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch { /* ignore */ }
  }, []);

  const clearOutput = useCallback(() => {
    setOutput([]);
  }, []);

  // Keyboard shortcut: Ctrl+Enter to run
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runScript();
      }
      // Tab for indentation
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newCode = code.substring(0, start) + '  ' + code.substring(end);
        setCode(newCode);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    },
    [runScript, code],
  );

  const handleTemplateChange = useCallback((templateId: string) => {
    setSelectedTemplate(templateId);
    const template = SCRIPT_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setCode(template.code);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Template selector */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
          <SelectTrigger className="h-7 text-xs bg-zinc-900 border-zinc-800 text-zinc-300">
            <SelectValue placeholder="选择模板..." />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            {SCRIPT_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 历史脚本（localStorage，上限 20 条）：点选把脚本回填到编辑器 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800">
        <Select
          value=""
          onValueChange={(v) => {
            const item = history[Number(v)];
            if (item) setCode(item);
          }}
        >
          <SelectTrigger
            className="h-6 flex-1 text-[10px] bg-zinc-900 border-zinc-800 text-zinc-400"
            disabled={history.length === 0}
          >
            <SelectValue placeholder={history.length === 0 ? '暂无历史脚本' : '历史脚本（点选回填）'} />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            {history.map((h, i) => (
              <SelectItem key={i} value={String(i)} className="text-[10px] text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100">
                {(h.split('\n').find((l) => l.trim()) ?? '').slice(0, 48) || '（空脚本）'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          onClick={clearHistory}
          disabled={history.length === 0}
          className="h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          清空历史
        </Button>
      </div>

      {/* Code editor */}
      <div className="flex-1 min-h-0 px-1 py-1">
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full h-full bg-zinc-900 text-green-400 font-mono text-xs leading-relaxed p-3 rounded border border-zinc-800 resize-none focus:outline-none focus:border-zinc-600 selection:bg-green-900/40 placeholder:text-zinc-600"
          placeholder="// 在此输入脚本代码..."
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-zinc-800">
        <Button
          size="sm"
          variant="default"
          onClick={runScript}
          disabled={isRunning}
          className="h-6 px-2 text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white"
        >
          <Play className="size-3 mr-1" />
          运行
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={clearOutput}
          className="h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          <Trash2 className="size-3 mr-1" />
          清空
        </Button>
        <div className="flex-1" />
        <span className="text-[9px] text-zinc-600">Ctrl+Enter 运行</span>
      </div>
      <div className="px-3 pb-1.5">
        <p className="text-[9px] text-zinc-600 leading-snug">
          脚本在界面线程同步执行，运行期间界面无响应、无法中途停止；死循环只能刷新页面恢复。
          执行前已自动压一笔撤销，跑完或跑错都能 Ctrl+Z 整段退回。
        </p>
      </div>

      {/* Output console */}
      <div className="border-t border-zinc-800" style={{ height: 160 }}>
        <div className="flex items-center px-3 py-1 bg-zinc-900/50 border-b border-zinc-800">
          <Terminal className="size-3 text-zinc-500 mr-1.5" />
          <span className="text-[10px] text-zinc-500 font-medium">输出</span>
        </div>
        <div
          ref={outputRef}
          className="h-[calc(100%-24px)] overflow-y-auto p-2 font-mono text-xs"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#3f3f46 transparent',
          }}
        >
          {output.map((entry, i) => (
            <div
              key={i}
              className={`leading-relaxed whitespace-pre-wrap break-all ${
                entry.type === 'error'
                  ? 'text-red-400'
                  : entry.type === 'warn'
                    ? 'text-yellow-400'
                    : entry.type === 'result'
                      ? 'text-cyan-400'
                      : entry.type === 'system'
                        ? 'text-zinc-500 italic'
                        : 'text-zinc-400'
              }`}
            >
              {entry.text}
            </div>
          ))}
          {output.length === 0 && (
            <div className="text-zinc-600 italic text-[10px]">暂无输出</div>
          )}
        </div>
      </div>
    </div>
  );
}
