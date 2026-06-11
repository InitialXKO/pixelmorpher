// ============================================================
// PixelMorpher - Modifier Preset Save/Load System
// ============================================================
// Saves and loads modifier presets to/from localStorage.
// Users can save their favorite modifier configurations and reuse them.

import type { ModifierType, ModifierParamValue } from './types';

export interface ModifierPreset {
  id: string;
  name: string;
  type: ModifierType;
  params: Record<string, ModifierParamValue>;
  category: string; // user-defined category
  createdAt: number;
}

const PRESET_STORAGE_KEY = 'pixelmorpher-modifier-presets';

/**
 * Load all saved modifier presets from localStorage.
 */
export function loadPresets(): ModifierPreset[] {
  try {
    const data = localStorage.getItem(PRESET_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save all modifier presets to localStorage.
 */
function savePresets(presets: ModifierPreset[]): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('Failed to save presets to localStorage:', e);
  }
}

/**
 * Add a new modifier preset.
 */
export function addPreset(preset: ModifierPreset): void {
  const presets = loadPresets();
  presets.push(preset);
  savePresets(presets);
}

/**
 * Remove a modifier preset by ID.
 */
export function removePreset(id: string): void {
  const presets = loadPresets().filter((p) => p.id !== id);
  savePresets(presets);
}

/**
 * Update an existing modifier preset by ID.
 */
function updatePreset(id: string, updates: Partial<ModifierPreset>): void {
  const presets = loadPresets().map((p) =>
    p.id === id ? { ...p, ...updates } : p
  );
  savePresets(presets);
}

/**
 * Get all presets of a specific modifier type.
 */
function getPresetsByType(type: ModifierType): ModifierPreset[] {
  return loadPresets().filter((p) => p.type === type);
}
