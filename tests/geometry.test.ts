import { describe, expect, it } from 'vitest';
import { jointAngle, segmentElevation, toPixels } from '../src/cv/geometry';

describe('jointAngle', () => {
  it('returns 90° for a right angle', () => {
    expect(jointAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
  });

  it('returns 180° for a straight line', () => {
    expect(jointAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180);
  });

  it('returns 45° for a half right angle', () => {
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45);
  });

  it('returns ~0° for overlapping segments without NaN', () => {
    expect(jointAngle({ x: 2, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(0);
  });

  it('returns null when a segment has zero length', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe('segmentElevation', () => {
  const hip = { x: 100, y: 100 };

  it('is 90° when the knee is directly below the hip (standing)', () => {
    expect(segmentElevation(hip, { x: 100, y: 200 })).toBeCloseTo(90);
  });

  it('is 0° when the thigh is level, whichever way the user faces', () => {
    expect(segmentElevation(hip, { x: 200, y: 100 })).toBeCloseTo(0);
    expect(segmentElevation(hip, { x: 0, y: 100 })).toBeCloseTo(0);
  });

  it('is negative when the hip drops below the knee', () => {
    expect(segmentElevation(hip, { x: 200, y: 90 })).toBeLessThan(0);
  });

  it('keeps level at 0° under horizontal foreshortening (body rotated)', () => {
    expect(segmentElevation(hip, { x: 130, y: 100 })).toBeCloseTo(0);
  });

  it('returns null for coincident points', () => {
    expect(segmentElevation(hip, hip)).toBeNull();
  });
});

describe('toPixels', () => {
  it('corrects for non-square frames before measuring angles', () => {
    const frame = { width: 1280, height: 720 };
    // In normalized space these form 90°, but on a 16:9 frame the true angle differs.
    const a = { x: 0.5, y: 0.4, z: 0 };
    const b = { x: 0.5, y: 0.5, z: 0 };
    const c = { x: 0.6, y: 0.6, z: 0 };
    const normalized = jointAngle(a, b, c)!;
    const pixel = jointAngle(toPixels(a, frame), toPixels(b, frame), toPixels(c, frame))!;
    expect(normalized).toBeCloseTo(135);
    // 128 px right, 72 px down from a vertical segment: 180° - atan(128/72) ≈ 119.4°
    expect(pixel).toBeCloseTo(180 - (Math.atan(128 / 72) * 180) / Math.PI);
  });
});
