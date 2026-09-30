/**
 * CV exercise configuration types. The single source of truth is the Zod
 * schema in shared/schemas/exercise.ts; these re-exports keep the CV module's
 * imports local.
 */
export type {
  AngleMeasurement,
  CameraView,
  CvExerciseConfig,
  FormRule,
  RepThresholds,
  SetupThresholds,
} from '../../../shared/schemas/exercise';
