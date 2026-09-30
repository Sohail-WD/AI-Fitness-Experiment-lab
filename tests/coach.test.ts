import { describe, expect, it } from 'vitest';
import { curlCv, lungeCv, pressCv } from '../shared/exercises/cvConfigs';
import { squatCv } from '../shared/exercises/squat';
import type { CvExerciseConfig } from '../shared/schemas/exercise';
import {
  COACH_TIMING as T,
  type CoachState,
  coachStep,
  feedbackForEvent,
  formStatus,
  initialCoachState,
  liveConditions,
  setupChecklist,
  shouldSpeak,
} from '../src/cv/coach';
import type { CvRepEvent } from '../src/cv/formCheck';
import type { ProcessedFrame } from '../src/cv/frameProcessor';
import type { RepPhase } from '../src/cv/repCounter';
import type { SetupStatus } from '../src/cv/setupCheck';

/** Minimal fake frame: only the fields the coach reads. */
function frame(
  opts: {
    status?: SetupStatus;
    phase?: RepPhase;
    ruleValues?: Record<string, number | null>;
    arms?: { left: number; right: number };
  } = {},
): ProcessedFrame {
  const status = opts.status ?? 'ok';
  return {
    analysis: {
      setup: { status, message: status === 'ok' ? 'Tracking' : `problem: ${status}`, confidence: 0.9 },
      ruleValues: opts.ruleValues ?? {},
      bilateralAnglesDeg: opts.arms ?? null,
    },
    reps: { phase: opts.phase ?? 'STANDING' },
  } as unknown as ProcessedFrame;
}

const repEvent = (e: Partial<CvRepEvent> & Pick<CvRepEvent, 'type'>): CvRepEvent =>
  ({ durationMs: 1500, minAngleDeg: 10, valid: true, formIssues: [], feedback: 'Good rep.', ...e }) as CvRepEvent;

/** Run steps at 100 ms intervals (like the UI) and collect everything spoken. */
function simulate(config: CvExerciseConfig, steps: { f: ProcessedFrame | null; event?: CvRepEvent; working?: boolean }[], start: CoachState = initialCoachState(), t0 = 0) {
  let s = start;
  const spoken: string[] = [];
  const shown: (string | null)[] = [];
  steps.forEach((step, i) => {
    const r = coachStep(s, { nowMs: t0 + i * 100, working: step.working ?? true, frame: step.f, newEvent: step.event ?? null }, config);
    s = r.state;
    if (r.speak) spoken.push(r.speak);
    shown.push(s.current?.text ?? null);
  });
  return { s, spoken, shown };
}
const repeat = <T,>(x: T, n: number) => Array<T>(n).fill(x);
/** Enough stable "ok" frames to pass setup. */
const ready = () => simulate(squatCv, repeat({ f: frame() }, 12)).s;

/* ---------- setup ---------- */

describe('camera setup', () => {
  it('builds a checklist from what the setup check verifies, in check order', () => {
    expect(setupChecklist(squatCv, 'low_visibility').map((i) => i.state)).toEqual(['ok', 'ok', 'fail', 'unknown']);
    expect(setupChecklist(squatCv, 'ok').every((i) => i.state === 'ok')).toBe(true);
    expect(setupChecklist(squatCv, null).map((i) => i.state)).toEqual(['fail', 'unknown', 'unknown', 'unknown']);
    expect(setupChecklist(squatCv, 'ok').at(-1)!.label).toBe('Standing side-on to the camera');
  });

  it('asks for both arms and a front view for the shoulder press', () => {
    const labels = setupChecklist(pressCv, 'wrong_view').map((i) => i.label);
    expect(labels).toContain('Both arms clearly visible');
    expect(labels.at(-1)).toBe('Facing the camera');
    expect(labels[1]).toMatch(/^Both sides in frame: shoulders, elbows, wrists and hips$/);
  });

  it('becomes ready only after checks pass continuously, and stays ready (latched)', () => {
    let r = simulate(squatCv, [...repeat({ f: frame() }, 5), { f: frame({ status: 'wrong_view' }) }, ...repeat({ f: frame() }, 5)]);
    expect(r.s.setupReady).toBe(false); // interrupted before 1 s of stable "ok"
    r = simulate(squatCv, repeat({ f: frame() }, 12));
    expect(r.s.setupReady).toBe(true);
    expect(formStatus(r.s, 1200)).toBe('Good form');
    r = simulate(squatCv, repeat({ f: frame({ status: 'out_of_frame' }) }, 3), r.s, 1200);
    expect(r.s.setupReady).toBe(true);
  });

  it('shows (and speaks) a setup problem only after it persists, and clears it when fixed', () => {
    const r = simulate(squatCv, [...repeat({ f: frame({ status: 'wrong_view' }) }, 8), { f: frame() }], ready(), 2000);
    expect(r.shown.slice(0, 4)).toEqual([null, null, null, null]);
    expect(r.shown[5]).toBe('problem: wrong_view');
    expect(r.spoken).toEqual(['problem: wrong_view']);
    expect(r.shown.at(-1)).toBeNull();
  });
});

/* ---------- issue → feedback ---------- */

describe('issue → feedback mapping', () => {
  it('uses each exercise rule feedback, priorities, and a "good rep" for clean reps', () => {
    expect(feedbackForEvent(squatCv, repEvent({ type: 'partial', feedback: 'Go slightly deeper.' }), 0)).toMatchObject({
      id: 'rule:insufficient_depth',
      text: 'Go slightly deeper.',
      priority: 'correction',
    });
    expect(feedbackForEvent(squatCv, repEvent({ type: 'rejected_too_fast', feedback: 'Slow down the movement.' }), 0)).toMatchObject({
      id: 'rule:excessive_speed',
      priority: 'correction',
    });
    expect(
      feedbackForEvent(curlCv, repEvent({ type: 'rep', valid: false, formIssues: ['elbow_drift'], feedback: 'Keep your elbow at your side.' }), 0),
    ).toMatchObject({ id: 'rule:elbow_drift', text: 'Keep your elbow at your side.', priority: 'correction' });
    expect(feedbackForEvent(squatCv, repEvent({ type: 'rep' }), 0)).toMatchObject({ id: 'good_rep', priority: 'info' });
    expect(feedbackForEvent(squatCv, repEvent({ type: 'tracking_reset' }), 0).priority).toBe('setup');
  });

  it('flags a live form-rule violation mid-rep (not while standing)', () => {
    expect(liveConditions(lungeCv, frame({ phase: 'BOTTOM', ruleValues: { torso_lean: 40 } })).get('rule:torso_lean')).toBe(
      'Keep your torso upright.',
    );
    expect(liveConditions(lungeCv, frame({ phase: 'STANDING', ruleValues: { torso_lean: 40 } })).size).toBe(0);
    expect(liveConditions(lungeCv, frame({ phase: 'BOTTOM', ruleValues: { torso_lean: 80 } })).size).toBe(0);
  });

  it('prefers corrections over info when both are available', () => {
    const r = simulate(lungeCv, [...repeat({ f: frame({ phase: 'BOTTOM', ruleValues: { torso_lean: 40 } }) }, 4)], ready(), 2000);
    const withEvent = coachStep(r.s, { nowMs: 2400, working: true, frame: frame({ phase: 'BOTTOM', ruleValues: { torso_lean: 40 } }), newEvent: repEvent({ type: 'rep' }) }, lungeCv);
    expect(withEvent.state.current?.priority).toBe('correction');
  });
});

/* ---------- bilateral shoulder press ---------- */

describe('bilateral shoulder-press feedback', () => {
  it('asks to raise both arms when one arm stays at the rack', () => {
    expect([...liveConditions(pressCv, frame({ arms: { left: 165, right: 90 } })).values()]).toEqual(['Raise both arms.']);
  });

  it('asks to keep arms together when both are up but out of sync', () => {
    expect([...liveConditions(pressCv, frame({ phase: 'DESCENDING', arms: { left: 170, right: 120 } })).values()]).toEqual([
      'Keep both arms moving together.',
    ]);
  });

  it('says nothing when the arms are within tolerance', () => {
    expect(liveConditions(pressCv, frame({ phase: 'DESCENDING', arms: { left: 150, right: 125 } })).size).toBe(0);
  });

  it('asks for both arms on a partial press', () => {
    expect(feedbackForEvent(pressCv, repEvent({ type: 'partial', feedback: 'Press all the way up.' }), 0).text).toBe(
      'Press both arms all the way up.',
    );
  });
});

/* ---------- cooldown / debounce / voice ---------- */

describe('cooldown, debouncing and voice triggers', () => {
  const lean = { f: frame({ phase: 'BOTTOM', ruleValues: { torso_lean: 40 } }) };
  const upright = { f: frame({ phase: 'BOTTOM', ruleValues: { torso_lean: 85 } }) };

  it('ignores a live condition shorter than the persistence window', () => {
    const r = simulate(lungeCv, [lean, lean, upright, lean, lean, upright], ready(), 2000);
    expect(r.shown.every((m) => m === null)).toBe(true);
    expect(r.spoken).toEqual([]);
  });

  it('speaks a persistent correction once, not every frame', () => {
    const r = simulate(lungeCv, repeat(lean, 30), ready(), 2000); // 3 s of the same problem
    expect(r.spoken).toEqual(['Keep your torso upright.']);
  });

  it('does not re-show the same live cue within the cooldown after it clears', () => {
    const r = simulate(lungeCv, [...repeat(lean, 5), ...repeat(upright, 5), ...repeat(lean, 10)], ready(), 2000);
    expect(r.spoken).toHaveLength(1);
    expect(r.shown.slice(10).every((m) => m !== 'Keep your torso upright.' || r.shown[9] === 'Keep your torso upright.')).toBe(true);
  });

  it('shows every rep event but rate-limits speech', () => {
    const shallow = repEvent({ type: 'partial', feedback: 'Go slightly deeper.' });
    const steps = [0, 1, 2].map(() => [{ f: frame(), event: shallow }, ...repeat({ f: frame() }, 9)]).flat(); // one per second
    const r = simulate(squatCv, steps, ready(), 2000);
    expect(r.shown.filter((m, i) => i % 10 === 0 && m === 'Go slightly deeper.')).toHaveLength(3);
    expect(r.spoken).toEqual(['Go slightly deeper.']); // same message within 5 s
  });

  it('speaks info (good rep) rarely and never right after a correction', () => {
    const base: CoachState = { ...ready(), lastSpeechMs: 1000 };
    expect(shouldSpeak(base, { id: 'good_rep', text: 'Good rep.', priority: 'info', atMs: 2000 })).toBe(false);
    expect(shouldSpeak(base, { id: 'good_rep', text: 'Good rep.', priority: 'info', atMs: 5000 })).toBe(true);
    expect(shouldSpeak({ ...base, lastSpokenMs: { good_rep: 4000 } }, { id: 'good_rep', text: 'Good rep.', priority: 'info', atMs: 9000 })).toBe(false);
    expect(shouldSpeak(base, { id: 'rule:x', text: 'x', priority: 'correction', atMs: 1000 + T.MIN_SPEECH_GAP_MS })).toBe(true);
    expect(shouldSpeak(base, { id: 'rule:x', text: 'x', priority: 'correction', atMs: 1000 + T.MIN_SPEECH_GAP_MS - 1 })).toBe(false);
  });

  it('gives no form coaching while resting or paused', () => {
    const r = simulate(lungeCv, repeat({ ...lean, working: false, event: repEvent({ type: 'rep' }) }, 10), ready(), 2000);
    expect(r.spoken).toEqual([]);
    expect(r.shown.every((m) => m === null)).toBe(true);
  });
});
