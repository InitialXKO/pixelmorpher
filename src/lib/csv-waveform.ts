// ============================================================
// PixelMorpher - CSV Waveform Sampling
// ============================================================
// Waveform data (number arrays, historically sourced from CSV) is
// carried in modifier params (csvWaveform) and sampled per frame by
// the wave modifier's bake handler. The CSV text import entry point
// (parseCSVWaveform) never had a caller or UI and was removed in the
// 2026-11 audit cleanup; only the sampler — the live half — remains.

/**
 * Sample a waveform at a given frame position.
 * Uses linear interpolation between CSV data points.
 *
 * @param values Array of waveform values from CSV (0-1 range)
 * @param frame Current frame number
 * @param totalFrames Total number of frames in the animation
 * @returns Interpolated value at the given frame
 */
export function sampleWaveformAtFrame(values: number[], frame: number, totalFrames: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  if (totalFrames <= 0) return values[0];

  const t = (frame / totalFrames) * (values.length - 1);
  const index = Math.floor(t);
  const frac = t - index;

  if (index >= values.length - 1) return values[values.length - 1];
  return values[index] * (1 - frac) + values[index + 1] * frac;
}
