import type { CvExerciseConfig, Joint } from '../../shared/schemas/exercise';
import type { CvRepEvent } from './formCheck';
import type { ProcessedFrame } from './frameProcessor';
import type { SetupStatus } from './setupCheck';

/**
 * Real-time coaching on top of the deterministic CV pipeline (no AI). Turns
 * setup status, rep events, and live form-rule/bilateral measurements into
 * short messages, with priority, persistence (debounce) and cooldowns, and
 * decides when a message should be spoken. Pure: the caller owns time and voice.
 */

export type CoachPriority = 'setup' | 'correction' | 'info';
export interface CoachMessage {
  /** Stable id used for cooldowns, e.g. "rule:torso_lean". */
  id: string;
  text: string;
  priority: CoachPriority;
  atMs: number;
}

export interface CoachState {
  setupOkSinceMs: number | null;
  /** Latched once setup checks have passed continuously for SETUP_STABLE_MS. */
  setupReady: boolean;
  /** When each live condition started being true (for persistence/debounce). */
  cueSinceMs: Record<string, number>;
  lastShownMs: Record<string, number>;
  lastSpokenMs: Record<string, number>;
  lastSpeechMs: number;
  current: CoachMessage | null;
}

export const COACH_TIMING = {
  /** Setup must pass continuously this long before tracking is "ready". */
  SETUP_STABLE_MS: 1000,
  /** A setup problem must persist this long before it is shown (avoids flicker). */
  SETUP_PERSIST_MS: 500,
  /** A live form/bilateral condition must persist this long before it is shown. */
  CUE_PERSIST_MS: 300,
  /** The same live cue is not shown again within this window. */
  SAME_CUE_COOLDOWN_MS: 4000,
  /** Non-setup messages disappear after this long. */
  DISPLAY_MS: 3000,
  /** Speech: same message, any message, and informational message cooldowns. */
  SAME_SPEECH_COOLDOWN_MS: 5000,
  MIN_SPEECH_GAP_MS: 1500,
  INFO_SPEECH_COOLDOWN_MS: 10000,
  /** Arms differing by at least this much (degrees) count as out of sync. */
  BILATERAL_DIFF_DEG: 40,
} as const;

export function initialCoachState(): CoachState {
  return { setupOkSinceMs: null, setupReady: false, cueSinceMs: {}, lastShownMs: {}, lastSpokenMs: {}, lastSpeechMs: -Infinity, current: null };
}

/* ---------- camera setup checklist ---------- */

export type CheckState = 'ok' | 'fail' | 'unknown';
export interface SetupCheckItem {
  label: string;
  state: CheckState;
}

const JOINT_NAMES: Record<Joint, string> = {
  shoulder: 'shoulders',
  elbow: 'elbows',
  wrist: 'wrists',
  hip: 'hips',
  knee: 'knees',
  ankle: 'ankles',
};

/** Order in which checkSetup evaluates problems; later checks are unknown until earlier ones pass. */
const CHECK_RANK: Record<SetupStatus, number> = { no_person: 0, out_of_frame: 1, low_visibility: 2, wrong_view: 3, ok: 4 };

/** Checklist derived only from what the setup check actually verifies for this exercise. */
export function setupChecklist(config: CvExerciseConfig, status: SetupStatus | null): SetupCheckItem[] {
  const parts = config.requiredJoints.map((j) => JOINT_NAMES[j]);
  const partList = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const labels = [
    'Person detected',
    config.bilateral ? `Both sides in frame: ${partList}` : `In frame: ${partList}`,
    config.bilateral ? 'Both arms clearly visible' : 'Clearly visible (lighting, nothing blocking)',
    config.cameraView === 'side' ? 'Standing side-on to the camera' : 'Facing the camera',
  ];
  const rank = status === null ? 0 : CHECK_RANK[status];
  return labels.map((label, i) => ({ label, state: i < rank ? 'ok' : i === rank ? 'fail' : 'unknown' }));
}

/* ---------- issue → feedback mapping ---------- */

/** Coaching message for a rep event, using the exercise's own rule feedback. */
export function feedbackForEvent(config: CvExerciseConfig, event: CvRepEvent, nowMs: number): CoachMessage {
  const correction = (id: string, text: string): CoachMessage => ({ id, text, priority: 'correction', atMs: nowMs });
  switch (event.type) {
    case 'tracking_reset':
      return { id: 'tracking_reset', text: 'Tracking lost. Stay in the frame.', priority: 'setup', atMs: nowMs };
    case 'rejected_too_fast':
      return correction(`rule:${config.issueCodes.tooFast}`, event.feedback);
    case 'partial':
      return correction(
        `rule:${config.issueCodes.partial}`,
        config.bilateral ? 'Press both arms all the way up.' : event.feedback,
      );
    case 'rep':
      if (!event.valid || event.formIssues.length > 0) return correction(`rule:${event.formIssues[0] ?? 'form'}`, event.feedback);
      return { id: 'good_rep', text: 'Good rep.', priority: 'info', atMs: nowMs };
  }
}

/** Live conditions measured this frame (mid-rep form rules and bilateral sync), keyed by cue id. */
export function liveConditions(config: CvExerciseConfig, frame: ProcessedFrame): Map<string, string> {
  const out = new Map<string, string>();
  const inRep = frame.reps.phase === 'DESCENDING' || frame.reps.phase === 'BOTTOM' || frame.reps.phase === 'ASCENDING';

  if (inRep) {
    for (const rule of config.formRules) {
      const v = frame.analysis.ruleValues[rule.code];
      if (!rule.check || v === null || v === undefined) continue;
      const violated = rule.check.bound === 'min' ? v < rule.check.limitDeg : v > rule.check.limitDeg;
      if (violated) out.set(`rule:${rule.code}`, rule.feedback);
    }
  }

  const both = frame.analysis.bilateralAnglesDeg;
  if (config.bilateral && both && both.left !== null && both.right !== null) {
    if (Math.abs(both.left - both.right) >= COACH_TIMING.BILATERAL_DIFF_DEG) {
      // The lagging arm is the one nearer the start position.
      const lagging = config.repDirection === 'increasing' ? Math.min(both.left, both.right) : Math.max(both.left, both.right);
      const atStart = config.repDirection === 'increasing' ? lagging <= config.rep.topEnterDeg : lagging >= config.rep.topEnterDeg;
      if (atStart) out.set('bilateral:raise_both', 'Raise both arms.');
      else out.set('bilateral:together', 'Keep both arms moving together.');
    }
  }
  return out;
}

/* ---------- step ---------- */

export interface CoachInput {
  nowMs: number;
  /** A set is in progress and not paused (no coaching during rest/pause). */
  working: boolean;
  frame: ProcessedFrame | null;
  /** Rep event that arrived since the previous step, if any. */
  newEvent: CvRepEvent | null;
}

const RANK: Record<CoachPriority, number> = { setup: 3, correction: 2, info: 1 };

export function shouldSpeak(s: CoachState, m: CoachMessage): boolean {
  const t = COACH_TIMING;
  const sinceAny = m.atMs - s.lastSpeechMs;
  const sinceSame = m.atMs - (s.lastSpokenMs[m.id] ?? -Infinity);
  if (m.priority === 'info') return sinceSame >= t.INFO_SPEECH_COOLDOWN_MS && sinceAny >= 2 * t.MIN_SPEECH_GAP_MS;
  return sinceSame >= t.SAME_SPEECH_COOLDOWN_MS && sinceAny >= t.MIN_SPEECH_GAP_MS;
}

/** Advance the coach by one UI tick. Returns the new state and text to speak (if any). */
export function coachStep(
  s: CoachState,
  input: CoachInput,
  config: CvExerciseConfig,
): { state: CoachState; speak: string | null } {
  const t = COACH_TIMING;
  const now = input.nowMs;
  const status: SetupStatus = input.frame?.analysis.setup.status ?? 'no_person';
  let next: CoachState = { ...s, cueSinceMs: { ...s.cueSinceMs } };

  // Setup readiness (latched).
  if (status === 'ok') {
    next.setupOkSinceMs = s.setupOkSinceMs ?? now;
    if (now - next.setupOkSinceMs >= t.SETUP_STABLE_MS) next.setupReady = true;
  } else {
    next.setupOkSinceMs = null;
  }

  // Track persistence of current conditions; forget the ones that stopped.
  const conditions = new Map<string, CoachMessage>();
  if (status !== 'ok' && input.frame) {
    conditions.set(`setup:${status}`, { id: `setup:${status}`, text: input.frame.analysis.setup.message, priority: 'setup', atMs: now });
  }
  if (input.working && input.frame && status === 'ok') {
    for (const [id, text] of liveConditions(config, input.frame)) conditions.set(id, { id, text, priority: 'correction', atMs: now });
  }
  for (const id of Object.keys(next.cueSinceMs)) if (!conditions.has(id)) delete next.cueSinceMs[id];
  for (const id of conditions.keys()) next.cueSinceMs[id] ??= now;

  const candidates: CoachMessage[] = [];
  for (const [id, m] of conditions) {
    const persist = m.priority === 'setup' ? t.SETUP_PERSIST_MS : t.CUE_PERSIST_MS;
    if (now - next.cueSinceMs[id] < persist) continue;
    // Live cues respect a display cooldown; setup messages stay up while the problem lasts.
    if (m.priority !== 'setup' && s.current?.id !== id && now - (s.lastShownMs[id] ?? -Infinity) < t.SAME_CUE_COOLDOWN_MS) continue;
    candidates.push(m);
  }
  // Rep events are shown whenever they happen (each rep deserves feedback).
  const eventMessage = input.working && input.newEvent ? feedbackForEvent(config, input.newEvent, now) : null;
  if (eventMessage) candidates.push(eventMessage);

  // Clear stale messages: resolved setup problems and expired corrections/info.
  const cur = s.current;
  if (cur && ((cur.priority === 'setup' && !conditions.has(cur.id)) || (cur.priority !== 'setup' && now - cur.atMs >= t.DISPLAY_MS))) {
    next.current = null;
  }

  const best = candidates.sort((a, b) => RANK[b.priority] - RANK[a.priority])[0];
  let speak: string | null = null;
  const replaces = best && (!next.current || RANK[best.priority] >= RANK[next.current.priority] || best.id === next.current.id);
  if (best && replaces) {
    // New = a different message, or a fresh rep event repeating the same one (e.g. consecutive "Good rep.").
    const isNew = next.current?.id !== best.id || best === eventMessage;
    next.current = isNew ? best : { ...best, atMs: next.current!.atMs };
    next.lastShownMs = { ...next.lastShownMs, [best.id]: now };
    if (isNew && shouldSpeak(next, best)) {
      speak = best.text;
      next = { ...next, lastSpeechMs: now, lastSpokenMs: { ...next.lastSpokenMs, [best.id]: now } };
    }
  }
  return { state: next, speak };
}

/** Short form status for the UI. */
export function formStatus(s: CoachState, nowMs: number): string {
  if (!s.setupReady) return 'Setting up camera';
  if (s.current?.priority === 'setup') return 'Check camera position';
  if (s.current?.priority === 'correction' && nowMs - s.current.atMs < COACH_TIMING.DISPLAY_MS) return 'Needs correction';
  return 'Good form';
}
