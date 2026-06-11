// ============================================================
// PixelMorpher V2.0 - Plugin Manager
// Manages plugin lifecycle (load, enable, disable) and script execution
// ============================================================

import { createAPI, PixelMorpherAPI } from './plugin-api';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  main: string; // function name to call
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

class PluginManagerClass {
  private plugins: Map<string, PluginInstance> = new Map();
  private customModifiers: Map<string, CustomModifierDef> = new Map();
  private customExporters: Map<string, CustomExporterDef> = new Map();

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
    if (result.customModifiers) {
      for (const mod of result.customModifiers) {
        this.customModifiers.set(`${manifest.id}:${mod.name}`, mod);
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
      // Remove associated custom modifiers and exporters
      for (const key of [...this.customModifiers.keys()]) {
        if (key.startsWith(id + ':')) this.customModifiers.delete(key);
      }
      for (const key of [...this.customExporters.keys()]) {
        if (key.startsWith(id + ':')) this.customExporters.delete(key);
      }
      this.plugins.delete(id);
    }
  }

  togglePlugin(id: string) {
    const plugin = this.plugins.get(id);
    if (plugin) plugin.enabled = !plugin.enabled;
  }

  getPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  getCustomModifiers() {
    return Array.from(this.customModifiers.entries()).map(([key, value]) => ({
      id: key,
      ...value,
    }));
  }

  getCustomExporters() {
    return Array.from(this.customExporters.entries()).map(([key, value]) => ({
      id: key,
      ...value,
    }));
  }

  // Execute a script in sandboxed context
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
