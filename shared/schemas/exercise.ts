import { z } from 'zod';
import {
  equipmentSchema,
  fitnessLevelSchema,
  goalSchema,
  issueCodeSchema,
  restrictionTagSchema,
  spaceSchema,
} from './common.ts';

/**
 * Computer-vision configuration for one exercise. This is the configuration
 * the M0 pipeline in src/cv consumes (exported there as CvExerciseConfig).
 */

export const jointSchema = z.enum(['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']);
export type Joint = z.infer<typeof jointSchema>;

export const cameraViewSchema = z.enum(['side', 'front']);
export type CameraView = z.infer<typeof cameraViewSchema>;

/** How the angle driving the rep state machine is measured. */
export const angleMeasurementSchema = z.discriminatedUnion('kind', [
  /** Interior angle at the middle joint, 0–180°. */
  z.object({
    kind: z.literal('joint'),
    label: z.string(),
    joints: z.tuple([jointSchema, jointSchema, jointSchema]),
  }),
  /**
   * Elevation of the segment from→to above horizontal, where "above" means
   * `to` is lower in the image than `from`: +90° = `to` directly below
   * `from`, 0° = level, negative = `to` higher than `from`.
   */
  z.object({
    kind: z.literal('segmentFromHorizontal'),
    label: z.string(),
    from: jointSchema,
    to: jointSchema,
  }),
]);
export type AngleMeasurement = z.infer<typeof angleMeasurementSchema>;

/**
 * Thresholds on the primary angle (degrees). "Top" is the start position and
 * "bottom" the target position of a rep. Written for a primary angle that
 * DECREASES from top to bottom; for repDirection "increasing" (e.g. shoulder
 * press) the same fields hold natural angles and every comparison is mirrored.
 */
export const repThresholdsSchema = z.object({
  /** At or beyond this angle the user is at the start position. */
  topEnterDeg: z.number(),
  /** Past this angle the user has left the start position (hysteresis). */
  topExitDeg: z.number(),
  /** At or beyond this angle the target range has been reached. */
  bottomEnterDeg: z.number(),
  /** Past this angle the user has left the target position (hysteresis). */
  bottomExitDeg: z.number(),
  /** Moving back this far from the furthest point, before the target, counts as turning back. */
  reversalDeg: z.number().positive(),
  /** Full reps faster than this are rejected as detection glitches. */
  minRepDurationMs: z.number().nonnegative(),
});
export type RepThresholds = z.infer<typeof repThresholdsSchema>;

export const setupThresholdsSchema = z.object({
  /** Minimum MediaPipe visibility for every required landmark. */
  minVisibility: z.number().min(0).max(1),
  /** Required landmarks must lie at least this far (normalized) from the frame edge. */
  edgeMargin: z.number().min(0).max(0.5),
  /**
   * For side view: max ratio of left/right shoulder (and hip) horizontal
   * spread to torso length. Larger values mean the user faces the camera.
   */
  maxSideViewSpreadRatio: z.number().positive(),
  /** After this long without a usable pose, an in-progress rep is discarded. */
  trackingLossResetMs: z.number().positive(),
  /**
   * For front view: min shoulder/hip spread ratio (see above). Smaller values
   * mean the user is turned sideways.
   */
  minFrontViewSpreadRatio: z.number().positive().optional(),
});
export type SetupThresholds = z.infer<typeof setupThresholdsSchema>;

/**
 * A measurable form rule. Rules without `check` are enforced by the rep state
 * machine itself (e.g. depth). Rules with `check` are evaluated per rep on the
 * furthest value the measurement reached during the rep.
 * A rule must list the camera views from which it can be measured reliably.
 */
export const formRuleSchema = z.object({
  code: issueCodeSchema,
  description: z.string(),
  measurableFrom: z.array(cameraViewSchema).min(1),
  feedback: z.string(),
  check: z
    .object({
      measurement: angleMeasurementSchema,
      /** "min": value must stay at or above limitDeg; "max": at or below. */
      bound: z.enum(['min', 'max']),
      limitDeg: z.number(),
      /** true: a violating rep counts as invalid; false: counted, with a warning. */
      invalidatesRep: z.boolean(),
    })
    .optional(),
});
export type FormRule = z.infer<typeof formRuleSchema>;

export const cvExerciseConfigSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    cameraView: cameraViewSchema,
    /** Angle driving the state machine. */
    primaryAngle: angleMeasurementSchema,
    /** How the primary angle changes from start to target position. Default "decreasing". */
    repDirection: z.enum(['decreasing', 'increasing']).optional(),
    /** Track both sides; a rep counts only when both sides complete it. Default false (one tracked side). */
    bilateral: z.boolean().optional(),
    /** Joints highlighted in the overlay on the tracked side, drawn as a chain. */
    overlayJoints: z.array(jointSchema).min(2),
    /** Landmarks that must be reliably visible on the tracked side. */
    requiredJoints: z.array(jointSchema).min(1),
    rep: repThresholdsSchema,
    setup: setupThresholdsSchema,
    /** Issue codes reported for reps that turned back early / were too fast. */
    issueCodes: z.object({ partial: issueCodeSchema, tooFast: issueCodeSchema }),
    formRules: z.array(formRuleSchema),
    /** Optional display names for the four movement phases (default: squat wording). */
    phaseLabels: z.object({ top: z.string(), toTarget: z.string(), target: z.string(), toTop: z.string() }).optional(),
    setupInstructions: z.string(),
  })
  .refine(
    ({ rep: t, repDirection }) => {
      const s = repDirection === 'increasing' ? -1 : 1;
      return s * t.topEnterDeg > s * t.topExitDeg && s * t.topExitDeg > s * t.bottomExitDeg && s * t.bottomExitDeg > s * t.bottomEnterDeg;
    },
    { message: 'thresholds must run topEnter → topExit → bottomExit → bottomEnter in the rep direction', path: ['rep'] },
  );
export type CvExerciseConfig = z.infer<typeof cvExerciseConfigSchema>;

export const movementPatternSchema = z.enum([
  'squat',
  'lunge',
  'hinge',
  'push',
  'pull',
  'press',
  'curl',
  'core',
  'cardio',
  'mobility',
]);
export type MovementPattern = z.infer<typeof movementPatternSchema>;

/** Catalog entry in the exercise library (spec §6.1). */
export const exerciseDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string().min(1),
    movementPattern: movementPatternSchema,
    targetMuscles: z.array(z.string()).min(1),
    difficulty: fitnessLevelSchema,
    /** Equipment required; empty = bodyweight. */
    requiredEquipment: z.array(equipmentSchema),
    /** Parts of a workout this exercise can fill. */
    roles: z.array(z.enum(['warmup', 'main', 'cooldown'])).min(1),
    /** Prescribed by repetitions or by a timed hold/interval. */
    targetType: z.enum(['reps', 'duration']),
    /** Typical seconds per repetition, used for duration estimates. */
    secondsPerRep: z.number().positive(),
    /** Performed once per side (reps/time are per side). */
    perSide: z.boolean(),
    /** Minimum training space needed. */
    minSpace: spaceSchema,
    instructions: z.array(z.string()).min(1),
    demoUrl: z.url().nullable(),
    applicableGoals: z.array(goalSchema).min(1),
    applicableLevels: z.array(fitnessLevelSchema).min(1),
    /** Users with any of these restrictions must not be given this exercise. */
    restrictionTags: z.array(restrictionTagSchema),
    cvSupport: z.enum(['none', 'rep_counting', 'rep_counting_and_form']),
    cv: cvExerciseConfigSchema.nullable(),
  })
  .refine((e) => (e.cvSupport === 'none') === (e.cv === null), {
    message: 'cv config must be present exactly when cvSupport is not "none"',
    path: ['cv'],
  })
  .refine((e) => e.cv === null || e.cv.id === e.id, { message: 'cv.id must match exercise id', path: ['cv', 'id'] });
export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;
