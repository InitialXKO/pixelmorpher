// ============================================================
// PixelMorpher - Performance Monitor
// Development-only performance tracking for the render pipeline
// ============================================================

const DEV = process.env.NODE_ENV === 'development';

/** Start a performance mark */
function perfMark(name: string): void {
  if (!DEV) return;
  performance.mark(name);
}

/** End a performance mark and create a measure */
function perfMeasure(name: string, startMark: string, endMark: string): void {
  if (!DEV) return;
  performance.mark(endMark);
  performance.measure(name, startMark, endMark);
}

/** Convenience: measure an async/sync operation with auto-generated marks */
export function perfTrack<T>(label: string, fn: () => T): T {
  if (!DEV) return fn();
  const start = `perf:${label}:start`;
  const end = `perf:${label}:end`;
  performance.mark(start);
  try {
    return fn();
  } finally {
    performance.mark(end);
    performance.measure(`PixelMorpher:${label}`, start, end);
    // Clean up marks to avoid memory leak
    performance.clearMarks(start);
    performance.clearMarks(end);
  }
}

/** Get all PixelMorpher performance entries and return a summary */
function perfSummary(): { name: string; avgMs: number; count: number; maxMs: number }[] {
  if (!DEV) return [];
  const entries = performance.getEntriesByType('measure')
    .filter((e) => e.name.startsWith('PixelMorpher:'));

  const byName = new Map<string, { total: number; count: number; max: number }>();
  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (existing) {
      existing.total += entry.duration;
      existing.count++;
      existing.max = Math.max(existing.max, entry.duration);
    } else {
      byName.set(entry.name, { total: entry.duration, count: 1, max: entry.duration });
    }
  }

  const result: { name: string; avgMs: number; count: number; maxMs: number }[] = [];
  for (const [name, stats] of byName) {
    result.push({
      name: name.replace('PixelMorpher:', ''),
      avgMs: Math.round(stats.total / stats.count * 100) / 100,
      count: stats.count,
      maxMs: Math.round(stats.max * 100) / 100,
    });
  }

  // Clear entries after summary to prevent unbounded growth
  performance.clearMeasures();

  return result.sort((a, b) => b.avgMs - a.avgMs);
}
