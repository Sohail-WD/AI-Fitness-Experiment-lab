import type { FrameSize, Landmark, Point2D } from './types';

/**
 * Convert a normalized landmark to pixel coordinates.
 * Angles must be computed in pixel space: normalized x and y are scaled by
 * different amounts on non-square frames, which would distort angles.
 */
export function toPixels(landmark: Landmark, frame: FrameSize): Point2D {
  return { x: landmark.x * frame.width, y: landmark.y * frame.height };
}

/**
 * Interior angle ABC in degrees (0–180), with the vertex at B.
 * Returns null when either segment has zero length (angle undefined).
 */
export function jointAngle(a: Point2D, b: Point2D, c: Point2D): number | null {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const lenBA = Math.hypot(bax, bay);
  const lenBC = Math.hypot(bcx, bcy);
  if (lenBA === 0 || lenBC === 0) return null;

  const cos = (bax * bcx + bay * bcy) / (lenBA * lenBC);
  // Clamp to guard against floating-point drift outside [-1, 1].
  const clamped = Math.min(1, Math.max(-1, cos));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Elevation of segment from→to relative to horizontal, in degrees (-90 to 90].
 * Image y grows downward, so +90 = `to` directly below `from`, 0 = level,
 * negative = `to` above `from`. Horizontal direction is ignored, which makes
 * the "level" reading independent of which way the user faces and of
 * horizontal foreshortening when the body is rotated.
 */
export function segmentElevation(from: Point2D, to: Point2D): number | null {
  const dx = Math.abs(to.x - from.x);
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
