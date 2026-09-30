import type { PostWorkoutFeedback } from '../../shared/schemas/workout';

/**
 * Three-level answers mapped onto the 1–10 scales in spec §11
 * (low/easy = 3, middle = 6, high/hard = 9). Energy is stored as given.
 */
export type Difficulty = 'easy' | 'moderate' | 'hard';
export type Level3 = 'low' | 'okay' | 'high';

const DIFFICULTY_SCORE: Record<Difficulty, number> = { easy: 3, moderate: 6, hard: 9 };
const LEVEL_SCORE: Record<Level3, number> = { low: 3, okay: 6, high: 9 };

export interface FeedbackAnswers {
  difficulty: Difficulty;
  energy: Level3;
  enjoyment: Level3;
  note: string;
}

export function toPostWorkoutFeedback(a: FeedbackAnswers): PostWorkoutFeedback {
  const note = a.note.trim();
  return {
    effort: DIFFICULTY_SCORE[a.difficulty],
    enjoyment: LEVEL_SCORE[a.enjoyment],
    energy: a.energy,
    ...(note ? { note } : {}),
  };
}
