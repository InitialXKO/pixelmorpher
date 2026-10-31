// ============================================================
// PixelMorpher V2.0 - Plugin Manager
// Manages plugin lifecycle (load, enable, disable) and script execution
// ============================================================

import { createAPI, PixelMorpherAPI } from './plugin-api';
import {
  registerEvaluator,
  registerNodeLabel,
  removeEvaluator,
  removeNodeLabel,
} from './blueprint/eval';
import { registerNodeSpec, removeNodeSpec } from './blueprint/specs';
import { pixels as pixelsVal } from './blueprint/ir';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** 旧字段，从未被任何代码使用（插件入口就是代码函数本体）；保留仅为兼容存量清单 */
  main?: string;
}

/** 已安装插件（清单 + 代码字符串 + 启停状态）在 localStorage 的落盘键 */
export const PLUGIN_STORAGE_KEY = 'pixelmorpher.installedPlugins.v1';

interface PersistedPluginEntry {
  manifest: PluginManifest;
  code: string;
  enabled: boolean;
}

export interface CustomModifierDef {
  name: string;
  params: { name: string; label: string; type: string; default: any }[];
  execute: (pixels: (string | null)[][], params: Record<string, any>) => (string | null)[][];
}

export interface CustomExporterDef {
  name: string;
  extension: string;
  export: (projectData: any) => Blob;
}

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  api: PixelMorpherAPI;
  cleanup?: () => void;
}

export interface PluginCodeResult {
  cleanup?: () => void;
  customModifiers?: CustomModifierDef[];
  customExporters?: CustomExporterDef[];
}

export class PluginManagerClass {
  private plugins: Map<string, PluginInstance> = new Map();
  private customModifiers: Map<string, CustomModifierDef> = new Map();
  private customExporters: Map<string, CustomExporterDef> = new Map();
  /** 经代码字符串安装的插件留存来源，供落盘与刷新后重注册（走 registerPlugin 同一路） */
  private installedSources: Map<string, { manifest: PluginManifest; code: string }> =
    new Map();
  private restored = false;

  registerPlugin(
    manifest: PluginManifest,
    pluginCode: (api: PixelMorpherAPI) => PluginCodeResult,
  ): boolean {
    if (this.plugins.has(manifest.id)) {
      console.warn(`Plugin ${manifest.id} already registered`);
      return false;
    }

    const api = createAPI();
    const result = pluginCode(api);

    this.plugins.set(manifest.id, {
      manifest,
      enabled: true,
      api,
      cleanup: result.cleanup,
    });

    // Register custom modifiers
    // 同时注册为蓝图节点（打通插件→蓝图）：
    // - 求值器：包 CustomModifierDef.execute 为 NodeEvaluator
    // - 规格：inputs=['pixels'], outputs=['pixels'], params 取自 mod.params
    // - 标签：用 mod.name
    if (result.customModifiers) {
      for (const mod of result.customModifiers) {
        const key = `${manifest.id}:${mod.name}`;
        this.customModifiers.set(key, mod);

        // 注册为蓝图节点
        const nodeType = `plugin_${manifest.id}_${mod.name}`;
        registerEvaluator(nodeType, (_node, inputs, _ctx) => {
          // 图求值的 pixels 值是 ir 形态 { type:'pixels', grid }；旧桥
          // 只认 { value } 形态，真实图里 execute 收到值对象、抛
          // 「.map 非函数」被求值器吞成空输出——插件节点在真链里恒
          // 失效（旧探针喂的是手拼 { value } 输入，未能证伪）。入口按
          // grid → value → 裸数组归一，出口一律回 ir 形态，下游内置
          // 节点的 asPixels 才读得到。
          const rawPixels = (inputs as any).pixels;
          const inputPixels: (string | null)[][] =
            rawPixels?.grid ?? rawPixels?.value ?? (Array.isArray(rawPixels) ? rawPixels : []);
          // 启停在求值层生效：所属插件被禁用（或已卸载但求值器尚在）
          // 时直通输入像素。这里查的是 manager 自身的状态（闭包捕获
          // 本实例），不让 blueprint/eval 反向依赖 manager。
          if (!this.plugins.get(manifest.id)?.enabled) {
            return { pixels: pixelsVal(inputPixels) };
          }
          const params: Record<string, any> = {};
          for (const p of mod.params) {
            params[p.name] = (_node as any).params?.[p.name] ?? p.default;
          }
          const output = mod.execute(inputPixels, params);
          return { pixels: pixelsVal(output as (string | null)[][]) };
        });
        registerNodeSpec(nodeType, {
          inputs: ['pixels'],
          outputs: ['pixels'],
          params: mod.params.map((p) => p.name),
        });
        registerNodeLabel(nodeType, `插件:${mod.name}`);
      }
    }

    // Register custom exporters
    if (result.customExporters) {
      for (const exp of result.customExporters) {
        this.customExporters.set(`${manifest.id}:${exp.name}`, exp);
      }
    }

    return true;
  }

  unregisterPlugin(id: string) {
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.cleanup?.();
      // Remove associated custom modifiers and exporters；修改器同时
      // 真注销蓝图注册（求值器/规格/标签三处），否则节点类型会残留
      // 在蓝图节点面板里、已有蓝图里的该节点还会继续求值
      for (const [key, mod] of [...this.customModifiers.entries()]) {
        if (key.startsWith(id + ':')) {
          const nodeType = `plugin_${id}_${mod.name}`;
          removeEvaluator(nodeType);
          removeNodeSpec(nodeType);
          removeNodeLabel(nodeType);
          this.customModifiers.delete(key);
        }
      }
      for (const key of [...this.customExporters.keys()]) {
        if (key.startsWith(id + ':')) this.customExporters.delete(key);
      }
      this.plugins.delete(id);
    }
    // 落盘记录一并清掉，刷新后不复活
    if (this.installedSources.delete(id)) this.savePersisted();
  }

  togglePlugin(id: string) {
    const plugin = this.plugins.get(id);
    if (plugin) {
      plugin.enabled = !plugin.enabled;
      // 启停状态同步落盘，刷新后保持
      if (this.installedSources.has(id)) this.savePersisted();
    }
  }

  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  /**
   * 经代码字符串安装的插件返回其代码原文（导出「实时执行」档随包
   * 携带用）；编程式以函数对象直接 registerPlugin 的插件没有源码
   * 可携带，返回 undefined。
   */
  getPluginSource(id: string): string | undefined {
    return this.installedSources.get(id)?.code;
  }

  /** 能力条目所属插件当前是否启用（条目 id 形如 `${插件id}:${名}`） */
  private ownerEnabled(key: string): boolean {
    const pid = key.slice(0, key.indexOf(':'));
    return this.plugins.get(pid)?.enabled ?? false;
  }

  /**
   * 已注册的像素修改器。缺省只返回所属插件启用中的；面板要展示
   * 已停用的能力时传 includeDisabled，并按返回条目的 enabled 标注。
   */
  getCustomModifiers(options?: { includeDisabled?: boolean }) {
    return Array.from(this.customModifiers.entries())
      .filter(([key]) => options?.includeDisabled || this.ownerEnabled(key))
      .map(([key, value]) => ({
        id: key,
        enabled: this.ownerEnabled(key),
        ...value,
      }));
  }

  /** 已注册的导出器。过滤口径与 getCustomModifiers 同。 */
  getCustomExporters(options?: { includeDisabled?: boolean }) {
    return Array.from(this.customExporters.entries())
      .filter(([key]) => options?.includeDisabled || this.ownerEnabled(key))
      .map(([key, value]) => ({
        id: key,
        enabled: this.ownerEnabled(key),
        ...value,
      }));
  }

  // ---- 持久化：已安装插件落 localStorage，刷新后按同一路重注册 ----

  private storage(): Storage | null {
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      return ls && typeof ls.getItem === 'function' ? ls : null;
    } catch {
      return null;
    }
  }

  private savePersisted() {
    const ls = this.storage();
    if (!ls) return;
    const entries: PersistedPluginEntry[] = [];
    for (const [id, src] of this.installedSources) {
      entries.push({
        manifest: src.manifest,
        code: src.code,
        enabled: this.plugins.get(id)?.enabled ?? true,
      });
    }
    try {
      ls.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // 存储不可用/超额时静默放弃落盘，不影响本次会话内的注册
    }
  }

  /**
   * 经代码字符串安装插件（文件安装的唯一入口）：编译 → 走
   * registerPlugin 与初装完全相同的注册路 → 留存来源并落盘。
   * 编译失败或 id 已注册时返回 false，不留半成品。
   */
  installPluginFromSource(manifest: PluginManifest, code: string): boolean {
    let fn: (api: PixelMorpherAPI) => PluginCodeResult;
    try {
      fn = new Function('api', code) as typeof fn;
    } catch {
      return false;
    }
    if (!this.registerPlugin(manifest, fn)) return false;
    this.installedSources.set(manifest.id, { manifest, code });
    this.savePersisted();
    return true;
  }

  /**
   * 从 localStorage 恢复已安装插件（面板挂载时调用）。幂等：同一
   * 实例只恢复一次，已注册的 id 跳过；恢复走与初装相同的
   * registerPlugin 路，并按落盘的启停状态还原。
   */
  restorePersistedPlugins(): void {
    if (this.restored) return;
    this.restored = true;
    const ls = this.storage();
    if (!ls) return;
    let entries: PersistedPluginEntry[] = [];
    try {
      const parsed = JSON.parse(ls.getItem(PLUGIN_STORAGE_KEY) || '[]');
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry?.manifest?.id || typeof entry.code !== 'string' || !entry.code) {
        continue;
      }
      if (this.plugins.has(entry.manifest.id)) continue;
      let fn: (api: PixelMorpherAPI) => PluginCodeResult;
      try {
        fn = new Function('api', entry.code) as typeof fn;
      } catch {
        continue;
      }
      if (!this.registerPlugin(entry.manifest, fn)) continue;
      this.installedSources.set(entry.manifest.id, {
        manifest: entry.manifest,
        code: entry.code,
      });
      if (entry.enabled === false) {
        const plugin = this.plugins.get(entry.manifest.id);
        if (plugin) plugin.enabled = false;
      }
    }
  }

  // 在页面上下文中执行脚本：仅把 api/console/Math 等少数名字以参数
  // 形式遮蔽传入，未遮蔽的全局（如 document）仍然直达，脚本与页面
  // 代码同权——这是便利封装，不是安全沙箱。
  executeScript(code: string): any {
    const api = createAPI();
    const sandbox: Record<string, any> = {
      api,
      console: {
        log: (...args: any[]) => console.log('[Script]', ...args),
        warn: (...args: any[]) => console.warn('[Script]', ...args),
        error: (...args: any[]) => console.error('[Script]', ...args),
      },
      Math,
      parseInt,
      parseFloat,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
    };

    try {
      const fn = new Function(...Object.keys(sandbox), code);
      return fn(...Object.values(sandbox));
    } catch (err) {
      console.error('Script execution error:', err);
      throw err;
    }
  }
}

export const pluginManager = new PluginManagerClass();
