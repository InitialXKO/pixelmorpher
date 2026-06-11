// ============================================================
// PixelMorpher - CSV Waveform Import
// ============================================================
// Parse CSV data as a waveform for animation modifiers.
// Each line of the CSV represents a value (0-1 range) for one frame's intensity.

/**
 * Parse CSV text as a waveform for animation modifiers.
 * CSV format: each line is a value (0-1 range), representing one frame's intensity.
 * Multi-column CSV: takes the first column value.
 */
export function parseCSVWaveform(csvText: string): number[] {
  const lines = csvText.trim().split(/\r?\n/);
  const values: number[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue; // skip comments
    const val = parseFloat(trimmed.split(',')[0]); // Take first column
    if (!isNaN(val)) {
      values.push(Math.max(0, Math.min(1, Math.abs(val)))); // Clamp to 0-1
    }
  }
  return values;
}

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

/**
 * Sample a waveform at a given frame position with amplitude scaling.
 * Returns a value suitable for use as a translate/rotate/scale offset.
 *
 * @param values Array of waveform values from CSV (0-1 range)
 * @param frame Current frame number
 * @param totalFrames Total number of frames in the animation
 * @param amplitude Amplitude multiplier
 * @returns Scaled and interpolated value
 */
function sampleWaveformScaled(
  values: number[],
  frame: number,
  totalFrames: number,
  amplitude: number,
): number {
  const sample = sampleWaveformAtFrame(values, frame, totalFrames);
  // Map from 0-1 to -1..1 centered, then scale by amplitude
  return (sample * 2 - 1) * amplitude;
}
