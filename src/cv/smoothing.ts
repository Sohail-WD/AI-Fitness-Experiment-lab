import type { Landmark } from './types';

/**
 * Exponential moving average over landmark positions.
 * alpha = weight of the newest frame (1 = no smoothing). At ~30 fps an alpha
 * of 0.5 removes most single-frame jitter while adding roughly one frame of lag.
 */
export class LandmarkSmoother {
  private previous: Landmark[] | null = null;

  constructor(private readonly alpha = 0.5) {
    if (alpha <= 0 || alpha > 1) throw new Error('alpha must be in (0, 1]');
  }

  smooth(landmarks: Landmark[]): Landmark[] {
    const prev = this.previous;
    const a = this.alpha;
    const next =
      prev && prev.length === landmarks.length
        ? landmarks.map((lm, i) => ({
            x: a * lm.x + (1 - a) * prev[i].x,
            y: a * lm.y + (1 - a) * prev[i].y,
            z: a * lm.z + (1 - a) * prev[i].z,
            // Visibility is not smoothed: confidence checks should react immediately.
            visibility: lm.visibility,
          }))
        : landmarks.map((lm) => ({ ...lm }));
    this.previous = next;
    return next;
  }

  reset(): void {
    this.previous = null;
  }
}
