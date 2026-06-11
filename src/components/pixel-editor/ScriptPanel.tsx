'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Square, Trash2, Copy, ChevronDown, Terminal } from 'lucide-react';
import { pluginManager } from '@/lib/plugin-manager';

const SCRIPT_TEMPLATES: { id: string; label: string; code: string }[] = [
  {
    id: 'batch-keyframes',
    label: '批量添加关键帧',
    code: `// 批量添加关键帧 - 为所有部件每4帧添加关键帧和旋转修改器
const parts = api.getParts();
for (const part of parts) {
  for (let frame = 0; frame < api.getTotalFrames(); frame += 4) {
    const kfId = api.addKeyframe(part.id, frame);
    api.addModifier(kfId, 'rotate');
  }
}
console.log('Done! Added keyframes for ' + parts.length + ' parts');`,
  },
  {
    id: 'center-parts',
    label: '部件居中',
    code: `// 部件居中 - 将所有部件的偏移量居中
const parts = api.getParts();
const canvas = api.getCanvasSize();
for (const part of parts) {
  const kfs = api.getKeyframesForPart(part.id);
  for (const kf of kfs) {
    for (const mod of kf.modifiers) {
      if (mod.type === 'translate') {
        const centerX = Math.round((canvas.width - part.width) / 2);
        const centerY = Math.round((canvas.height - part.height) / 2);
        api.updateModifier(kf.id, mod.id, { offsetX: centerX, offsetY: centerY });
      }
    }
  }
}
console.log('Centered ' + parts.length + ' parts');`,
  },
  {
    id: 'random-rotation',
    label: '随机旋转动画',
    code: `// 随机旋转动画 - 为所有旋转修改器添加随机角度
const parts = api.getParts();
for (const part of parts) {
  const kfs = api.getKeyframesForPart(part.id);
  for (const kf of kfs) {
    for (const mod of kf.modifiers) {
      if (mod.type === 'rotate') {
        api.updateModifier(kf.id, mod.id, { angle: Math.round(Math.random() * 30 - 15) });
      }
    }
  }
}
console.log('Applied random rotations to all rotate modifiers');`,
  },
  {
    id: 'export-report',
    label: '导出报告',
    code: `// 导出报告 - 输出项目统计信息
const projectName = api.getProjectName();
const canvasSize = api.getCanvasSize();
const totalFrames = api.getTotalFrames();
const currentFrame = api.getCurrentFrame();
const parts = api.getParts();

let totalKeyframes = 0;
let totalModifiers = 0;
for (const part of parts) {
  const kfs = api.getKeyframesForPart(part.id);
  totalKeyframes += kfs.length;
  for (const kf of kfs) {
    totalModifiers += kf.modifiers.length;
  }
}

console.log('=== Project Report ===');
console.log('Name: ' + projectName);
console.log('Canvas: ' + canvasSize.width + 'x' + canvasSize.height);
console.log('Frames: ' + totalFrames + ' (current: ' + currentFrame + ')');
console.log('Parts: ' + parts.length);
console.log('Keyframes: ' + totalKeyframes);
console.log('Modifiers: ' + totalModifiers);
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

  const stopScript = useCallback(() => {
    setIsRunning(false);
    addOutput('system', '> 脚本已停止');
  }, [addOutput]);

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
          onClick={stopScript}
          disabled={!isRunning}
          className="h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          <Square className="size-3 mr-1" />
          停止
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
