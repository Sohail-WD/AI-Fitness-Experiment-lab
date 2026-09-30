import { describe, expect, it } from 'vitest';
import { curlCv, lungeCv, pressCv, pushUpCvExperimental } from '../shared/exercises/cvConfigs';
import { exerciseLibrary, findExercise } from '../shared/exercises/library';
import { squatCv } from '../shared/exercises/squat';
import { cvExerciseConfigSchema, type CvExerciseConfig } from '../shared/schemas/exercise';
import { exerciseSetResultSchema } from '../shared/schemas/metrics';
import { FrameProcessor } from '../src/cv/frameProcessor';
import { type Joint, type Landmark, landmarkIndex, POSE_LANDMARK_COUNT } from '../src/cv/types';
import { FRAME } from './syntheticPose';

/* ---------- synthetic motion helpers (pixel space, 1280×720) ---------- */

type P = { x: number; y: number };
const rad = (deg: number) => (deg * Math.PI) / 180;
const add = (a: P, b: P, k = 1): P => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const rotate = (v: P, deg: number): P => ({
  x: v.x * Math.cos(rad(deg)) - v.y * Math.sin(rad(deg)),
  y: v.x * Math.sin(rad(deg)) + v.y * Math.cos(rad(deg)),
});
const unit = (from: P, to: P): P => {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
};

/**
 * Build 33 landmarks from per-joint pixel positions for the left side; the
 * right side is the same shifted by `spread` px (side view ≈ 10, front view large),
 * or given explicitly.
 */
function pose(left: Partial<Record<Joint, P>>, spread = 10, right?: Partial<Record<Joint, P>>): Landmark[] {
  const lms: Landmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const norm = (p: P): Landmark => ({ x: p.x / FRAME.width, y: p.y / FRAME.height, z: 0, visibility: 0.95 });
  for (const [joint, p] of Object.entries(left) as [Joint, P][]) {
    lms[landmarkIndex('left', joint)] = norm(p);
    lms[landmarkIndex('right', joint)] = norm(right?.[joint] ?? { x: p.x + spread, y: p.y });
  }
  return lms;
}

/** Side-view lunge: vertical shin, knee angle θ, torso leaning forward by `lean`°. */
function lungePose(knee: number, lean = 0): Landmark[] {
  const ankle = { x: 700, y: 650 };
  const kneeP = { x: 700, y: 480 };
  const hip = add(kneeP, { x: -Math.sin(rad(knee)), y: Math.cos(rad(knee)) }, 170);
  const shoulder = add(hip, { x: Math.sin(rad(lean)), y: -Math.cos(rad(lean)) }, 220);
  return pose({ ankle, knee: kneeP, hip, shoulder });
}

/** Side-view curl: elbow angle θ, upper arm swung forward by `drift`°. */
function curlPose(elbowDeg: number, drift = 0): Landmark[] {
  const shoulder = { x: 600, y: 200 };
  const elbow = add(shoulder, { x: Math.sin(rad(drift)), y: Math.cos(rad(drift)) }, 120);
  const wrist = add(elbow, rotate(unit(elbow, shoulder), elbowDeg), 110);
  return pose({ shoulder, elbow, wrist, hip: { x: 600, y: 420 }, knee: { x: 600, y: 580 }, ankle: { x: 600, y: 690 } });
}

/**
 * Front-view press: elbow angle per arm (≈90 rack, ≈175 lockout). The right
 * arm defaults to the left angle; `rightWristVisibility` hides the right arm.
 */
function pressPose(elbowDeg: number, facingCamera = true, rightElbowDeg = elbowDeg, rightWristVisibility = 0.95): Landmark[] {
  const arm = (shoulder: P, out: 1 | -1, deg: number) => {
    const elbow = { x: shoulder.x + 100 * out, y: shoulder.y };
    const u = unit(elbow, shoulder);
    const wrist = add(elbow, rotate(u, out === -1 ? -deg : deg), 100);
    return { shoulder, elbow, wrist };
  };
  const half = facingCamera ? 100 : 5;
  const l = arm({ x: 640 - half, y: 250 }, -1, elbowDeg);
  const r = arm({ x: 640 + half, y: 250 }, 1, rightElbowDeg);
  const lms = pose(
    { ...l, hip: { x: 640 - half * 0.8, y: 470 } },
    0,
    { ...r, hip: { x: 640 + half * 0.8, y: 470 } },
  );
  lms[landmarkIndex('right', 'wrist')].visibility = rightWristVisibility;
  return lms;
}

/** Side-view push-up: hands on the floor under the shoulder, elbow angle θ, hips sagging by `sag` px. */
function pushUpPose(elbowDeg: number, sag = 0): Landmark[] {
  const wrist = { x: 400, y: 600 };
  const h = 2 * 100 * Math.sin(rad(elbowDeg / 2));
  const shoulder = { x: 400, y: 600 - h };
  const elbow = { x: 400 + 100 * Math.cos(rad(elbowDeg / 2)), y: 600 - h / 2 };
  const ankle = { x: 900, y: 600 };
  const hip = { x: (shoulder.x + ankle.x) / 2, y: (shoulder.y + ankle.y) / 2 + sag };
  return pose({ shoulder, elbow, wrist, hip, knee: { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 }, ankle });
}

const ramp = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const hold = (v: number, n: number) => Array<number>(n).fill(v);
/** One rep: start → target → start, with short holds so smoothing settles. */
const rep = (start: number, target: number) => [...ramp(start, target, 20), ...hold(target, 5), ...ramp(target, start, 20), ...hold(start, 5)];

function run(config: CvExerciseConfig, frames: Landmark[][]) {
  const p = new FrameProcessor(config);
  const last = frames.map((lm, i) => p.process(lm, FRAME, i * 33)).at(-1)!;
  const result = p.setResult();
  expect(exerciseSetResultSchema.safeParse(result).success).toBe(true);
  return { result, last };
}
const issues = (r: ReturnType<typeof run>['result']) => Object.fromEntries(r.formIssues.map((i) => [i.code, i.count]));

/* ---------- configuration ---------- */

describe('CV configurations', () => {
  it('all validate against the schema', () => {
    for (const c of [squatCv, lungeCv, curlCv, pressCv, pushUpCvExperimental]) {
      expect(cvExerciseConfigSchema.safeParse(c).success, c.id).toBe(true);
    }
  });

  it('rejects increasing-direction thresholds written in the wrong order', () => {
    expect(cvExerciseConfigSchema.safeParse({ ...pressCv, repDirection: 'decreasing' }).success).toBe(false);
  });

  it('attaches CV to lunge, curl and press variants; push-up stays manual', () => {
    const withCv = exerciseLibrary.filter((e) => e.cv).map((e) => e.id).sort();
    expect(withCv).toEqual(
      ['band_bicep_curl', 'band_overhead_press', 'dumbbell_bicep_curl', 'dumbbell_reverse_lunge', 'dumbbell_shoulder_press', 'reverse_lunge', 'squat'].sort(),
    );
    expect(findExercise('push_up')!.cv).toBeNull();
    expect(findExercise('band_bicep_curl')!.cv!.id).toBe('band_bicep_curl');
  });
});

/* ---------- lunge ---------- */

describe('lunge CV', () => {
  const frames = (knees: number[], lean = 0) => knees.map((k) => lungePose(k, lean));

  it('counts complete lunges as valid', () => {
    const { result } = run(lungeCv, frames([...hold(175, 5), ...rep(175, 95), ...rep(175, 95), ...rep(175, 95)]));
    expect(result).toMatchObject({ detectedReps: 3, validReps: 3, invalidReps: 0, formIssues: [] });
  });

  it('marks a shallow lunge invalid (insufficient depth)', () => {
    const { result } = run(lungeCv, frames([...hold(175, 5), ...rep(175, 130)]));
    expect(result).toMatchObject({ validReps: 0, invalidReps: 1 });
    expect(issues(result)).toEqual({ insufficient_depth: 1 });
  });

  it('counts a leaning lunge but flags torso lean', () => {
    const { result, last } = run(lungeCv, frames([...hold(175, 5), ...rep(175, 95)], 45));
    expect(result.validReps).toBe(1);
    expect(issues(result)).toEqual({ torso_lean: 1 });
    expect(last.eventLog.at(-1)!.feedback).toBe('Keep your torso upright.');
  });

  it('does not count standing still with jitter', () => {
    const jitter = Array.from({ length: 120 }, (_, i) => 168 + 7 * Math.sin(i));
    expect(run(lungeCv, frames(jitter)).result.detectedReps).toBe(0);
  });
});

/* ---------- bicep curl ---------- */

describe('bicep curl CV', () => {
  const frames = (elbows: number[], drift = 0) => elbows.map((e) => curlPose(e, drift));

  it('counts complete curls as valid', () => {
    const { result } = run(curlCv, frames([...hold(170, 5), ...rep(170, 40), ...rep(170, 40)]));
    expect(result).toMatchObject({ detectedReps: 2, validReps: 2, invalidReps: 0 });
  });

  it('marks a half curl as incomplete', () => {
    const { result } = run(curlCv, frames([...hold(170, 5), ...rep(170, 95)]));
    expect(result).toMatchObject({ validReps: 0, invalidReps: 1 });
    expect(issues(result)).toEqual({ incomplete_curl: 1 });
  });

  it('invalidates a full curl done by swinging the elbow forward', () => {
    const elbows = [...hold(170, 5), ...rep(170, 40)];
    const drift = elbows.map((_, i) => (i > 10 && i < 40 ? 45 : 0));
    const { result, last } = run(curlCv, elbows.map((e, i) => curlPose(e, drift[i])));
    expect(result).toMatchObject({ validReps: 0, invalidReps: 1 });
    expect(issues(result)).toEqual({ elbow_drift: 1 });
    expect(last.eventLog.at(-1)!.feedback).toBe('Keep your elbow at your side.');
  });

  it('does not count a hanging arm with jitter', () => {
    const jitter = Array.from({ length: 120 }, (_, i) => 165 + 8 * Math.sin(i * 1.3));
    expect(run(curlCv, frames(jitter)).result.detectedReps).toBe(0);
  });
});

/* ---------- shoulder press (increasing angle) ---------- */

describe('shoulder press CV', () => {
  const frames = (elbows: number[], facing = true) => elbows.map((e) => pressPose(e, facing));

  it('counts rack → lockout → rack as valid and reports the highest angle', () => {
    const { result } = run(pressCv, frames([...hold(90, 5), ...rep(90, 172), ...rep(90, 172)]));
    expect(result).toMatchObject({ detectedReps: 2, validReps: 2, invalidReps: 0 });
    expect(result.metrics.lowestPrimaryAngleDeg).toBeGreaterThan(160);
  });

  it('marks a press that stops short of lockout as incomplete', () => {
    const { result } = run(pressCv, frames([...hold(90, 5), ...rep(90, 135)]));
    expect(result).toMatchObject({ validReps: 0, invalidReps: 1 });
    expect(issues(result)).toEqual({ incomplete_lockout: 1 });
  });

  it('does not count until the rack position is seen, so lowering from lockout is not a rep', () => {
    const { result } = run(pressCv, frames([...hold(172, 10), ...ramp(172, 90, 20), ...hold(90, 5)]));
    expect(result.detectedReps).toBe(0);
  });

  it('requires facing the camera', () => {
    const { result, last } = run(pressCv, frames([...hold(90, 5), ...rep(90, 172)], false));
    expect(result.detectedReps).toBe(0);
    expect(last.analysis.setup).toMatchObject({ status: 'wrong_view', message: 'Face the camera for this exercise.' });
  });

  it('does not count holding the rack position with jitter', () => {
    const jitter = Array.from({ length: 120 }, (_, i) => 92 + 6 * Math.sin(i));
    expect(run(pressCv, frames(jitter)).result.detectedReps).toBe(0);
  });
});

/* ---------- shoulder press: both arms ---------- */

describe('shoulder press CV tracks both arms', () => {
  /** Frames from per-arm angle sequences of equal length. */
  const arms = (left: number[], right: number[], rightWristVisibility = 0.95) =>
    left.map((l, i) => pressPose(l, true, right[i], rightWristVisibility));
  const start = hold(90, 5);

  it('1. both arms press → 1 rep', () => {
    const seq = [...start, ...rep(90, 172)];
    expect(run(pressCv, arms(seq, seq)).result).toMatchObject({ detectedReps: 1, validReps: 1 });
  });

  it('2. both arms press twice → 2 reps', () => {
    const seq = [...start, ...rep(90, 172), ...rep(90, 172)];
    expect(run(pressCv, arms(seq, seq)).result).toMatchObject({ detectedReps: 2, validReps: 2 });
  });

  it('3. only one arm presses → 0 reps', () => {
    const left = [...start, ...rep(90, 172), ...rep(90, 172)];
    expect(run(pressCv, arms(left, hold(90, left.length))).result).toMatchObject({ detectedReps: 0, validReps: 0 });
  });

  it('3b. one arm held at lockout while the other presses → 0 reps', () => {
    const right = [...start, ...rep(90, 172), ...rep(90, 172)];
    const left = [...start, ...ramp(90, 172, 20), ...hold(172, right.length - 25)];
    expect(run(pressCv, arms(left, right)).result.validReps).toBe(0);
  });

  it('4. one arm reaches lockout, the other stops short → 0 valid reps', () => {
    const { result } = run(pressCv, arms([...start, ...rep(90, 172)], [...start, ...rep(90, 135)]));
    expect(result.validReps).toBe(0);
    expect(issues(result)).toEqual({ incomplete_lockout: 1 });
  });

  it('5. slightly unsynchronized arms → 1 rep', () => {
    const lag = 4; // ~130 ms at 30 fps
    const seq = [...start, ...rep(90, 172), ...hold(90, lag)];
    const lagged = [...hold(90, lag), ...seq.slice(0, seq.length - lag)];
    expect(run(pressCv, arms(seq, lagged)).result).toMatchObject({ detectedReps: 1, validReps: 1 });
  });

  it('6. one arm not visible → 0 reps', () => {
    const seq = [...start, ...rep(90, 172)];
    const { result, last } = run(pressCv, arms(seq, seq, 0.2));
    expect(result.detectedReps).toBe(0);
    expect(last.analysis.setup.status).toBe('low_visibility');
  });
});

/* ---------- push-up (experimental, CV Lab only) ---------- */

describe('push-up CV (experimental)', () => {
  const frames = (elbows: number[], sag = 0) => elbows.map((e) => pushUpPose(e, sag));

  it('counts full push-ups on clean synthetic data', () => {
    const { result } = run(pushUpCvExperimental, frames([...hold(170, 5), ...rep(170, 80), ...rep(170, 80)]));
    expect(result).toMatchObject({ validReps: 2, invalidReps: 0 });
  });

  it('marks a shallow push-up invalid', () => {
    const { result } = run(pushUpCvExperimental, frames([...hold(170, 5), ...rep(170, 125)]));
    expect(issues(result)).toEqual({ insufficient_depth: 1 });
  });

  it('flags sagging hips', () => {
    const { result } = run(pushUpCvExperimental, frames([...hold(170, 5), ...rep(170, 80)], 90));
    expect(result.validReps).toBe(1);
    expect(issues(result)).toEqual({ body_line: 1 });
  });
});

/* ---------- squat is unchanged ---------- */

describe('squat regression', () => {
  it('keeps its thresholds, direction and codes', () => {
    expect(squatCv.repDirection).toBeUndefined();
    expect(squatCv.issueCodes).toEqual({ partial: 'insufficient_depth', tooFast: 'excessive_speed' });
    expect(squatCv.formRules.every((r) => r.check === undefined)).toBe(true);
  });
});
