import { describe, expect, it } from 'vitest';
import { squat } from '../src/cv/exercises/squat';
import {
  initialRepState,
  type RepCounterState,
  type RepEvent,
  type RepPhase,
  stepRepCounter,
} from '../src/cv/repCounter';

// Angles here are squat thigh angles: ~85° standing, 0° = thigh parallel to floor.
const FRAME_MS = 33; // ~30 fps

/** Feed a sequence of angles (null = unreliable frame) through the state machine. */
function run(angles: (number | null)[], frameMs = FRAME_MS, start: RepCounterState = initialRepState()) {
  let state = start;
  const phases: RepPhase[] = [];
  const events: RepEvent[] = [];
  angles.forEach((angleDeg, i) => {
    state = stepRepCounter(state, { timestampMs: i * frameMs, angleDeg }, squat.rep, squat.setup.trackingLossResetMs);
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    if (state.lastEvent) events.push(state.lastEvent);
  });
  return { state, phases, events };
}

/** Linear ramp from a to b (inclusive) in `steps` frames. */
function ramp(a: number, b: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => a + ((b - a) * i) / (steps - 1));
}

/** A ~1.3 s squat to just below parallel: 85° → -5° → 85°. */
const fullSquat = [...ramp(85, -5, 20), ...ramp(-5, 85, 20)];

describe('squat rep state machine', () => {
  it('passes through STANDING → DESCENDING → BOTTOM → ASCENDING → STANDING and counts one rep', () => {
    const { state, phases, events } = run([85, 85, ...fullSquat, 85]);
    expect(phases).toEqual(['STANDING', 'DESCENDING', 'BOTTOM', 'ASCENDING', 'STANDING']);
    expect(state.validReps).toBe(1);
    expect(state.partialReps).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'rep', minAngleDeg: -5 });
  });

  it('counts consecutive squats', () => {
    const { state } = run([85, ...fullSquat, ...fullSquat, ...fullSquat]);
    expect(state.validReps).toBe(3);
  });

  it('does not count until the user has been seen standing', () => {
    // Camera starts while the user is already at the bottom.
    const { state, phases } = run([...ramp(0, 85, 20), 85]);
    expect(phases[0]).toBe('UNKNOWN');
    expect(state.validReps).toBe(0);
    expect(state.phase).toBe('STANDING');
  });

  it('counts a ~40%-depth squat as partial, not a rep', () => {
    // 40% depth ≈ thigh 37° above horizontal.
    const { state, phases, events } = run([85, ...ramp(85, 37, 15), ...ramp(37, 85, 15)]);
    expect(state.validReps).toBe(0);
    expect(state.partialReps).toBe(1);
    expect(phases).toContain('ASCENDING');
    expect(phases).not.toContain('BOTTOM');
    expect(events[0]).toMatchObject({ type: 'partial', minAngleDeg: 37 });
  });

  it('counts a squat that stops just short of the depth threshold as partial', () => {
    const { state } = run([85, ...ramp(85, 18, 20), ...ramp(18, 85, 20)]);
    expect(state.validReps).toBe(0);
    expect(state.partialReps).toBe(1);
  });

  it('ignores jitter around the standing threshold', () => {
    const jitter = [85, 68, 73, 62, 76, 65, 71, 63, 80];
    const { state, phases } = run(jitter);
    expect(phases).toEqual(['STANDING']);
    expect(state.partialReps).toBe(0);
  });

  it('does not double count jitter at the bottom', () => {
    const bottomJitter = [5, 14, 7, 18, 4, 16, 6];
    const { state } = run([85, ...ramp(85, 5, 15), ...bottomJitter, ...ramp(5, 85, 15)]);
    expect(state.validReps).toBe(1);
  });

  it('counts a bounce at the bottom as a single rep', () => {
    const bounce = [...ramp(5, 30, 5), ...ramp(30, 0, 5)];
    const { state } = run([85, ...ramp(85, 5, 15), ...bounce, ...ramp(0, 85, 15)]);
    expect(state.validReps).toBe(1);
  });

  it('rejects an implausibly fast full rep', () => {
    // Whole movement in ~10 frames × 33 ms ≈ 300 ms < 400 ms minimum.
    const { state, events } = run([85, ...ramp(85, -5, 5), ...ramp(-5, 85, 5)]);
    expect(state.validReps).toBe(0);
    expect(state.rejectedReps).toBe(1);
    expect(events[0].type).toBe('rejected_too_fast');
  });

  it('freezes during a brief loss of tracking and still counts the rep', () => {
    const gap = Array<null>(15).fill(null); // ~0.5 s < 1 s reset window
    const { state, events } = run([85, ...ramp(85, -5, 20), ...gap, ...ramp(-5, 85, 20)]);
    expect(state.validReps).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['rep']);
  });

  it('discards the rep in progress after a long loss of tracking', () => {
    const gap = Array<null>(40).fill(null); // ~1.3 s > 1 s reset window
    const { state, events } = run([85, ...ramp(85, -5, 20), ...gap, ...ramp(-5, 85, 20)]);
    expect(events[0].type).toBe('tracking_reset');
    expect(state.validReps).toBe(0);
    // Returning to standing re-arms the counter without producing a rep.
    expect(state.phase).toBe('STANDING');
  });

  it('stays UNKNOWN and silent when nobody is ever tracked', () => {
    const { state, events } = run(Array<null>(100).fill(null));
    expect(state.phase).toBe('UNKNOWN');
    expect(events).toHaveLength(0);
  });

  it('handles a large single-frame drop (low frame rate) from standing to bottom', () => {
    const { state } = run([85, 85, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 85], 50);
    expect(state.validReps).toBe(1);
  });
});
