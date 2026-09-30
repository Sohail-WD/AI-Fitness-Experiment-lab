import { useEffect, useRef, useState } from 'react';
import { type CoachState, coachStep, initialCoachState } from '../cv/coach';
import type { CvExerciseConfig } from '../cv/exercises/types';
import type { SessionSnapshot } from '../hooks/usePoseSession';

/** Runs the pure coach on every CV snapshot (≈10 Hz) and hands spoken messages to `speak`. */
export function useCoach(exercise: CvExerciseConfig, snapshot: SessionSnapshot, working: boolean, speak: (text: string) => void) {
  const [coach, setCoach] = useState<CoachState>(initialCoachState);
  const stateRef = useRef(coach);
  const lastEventRef = useRef(snapshot.lastEvent);

  useEffect(() => {
    const newEvent = snapshot.lastEvent !== lastEventRef.current ? snapshot.lastEvent : null;
    lastEventRef.current = snapshot.lastEvent;
    const { state, speak: text } = coachStep(
      stateRef.current,
      { nowMs: performance.now(), working, frame: snapshot.frame, newEvent },
      exercise,
    );
    stateRef.current = state;
    setCoach(state);
    if (text) speak(text);
  }, [snapshot, working, exercise, speak]);

  return coach;
}
