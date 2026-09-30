import { z } from 'zod';
import type { PerformanceMetrics } from '../../shared/schemas/metrics';
import { type PostWorkoutFeedback, type SessionEventInput, workoutSessionSchema } from '../../shared/schemas/workout';
import { apiSend } from '../lib/api';

const recordedSchema = z.object({ recorded: z.int() });

export const createSession = (workoutId: string) => apiSend('POST', '/sessions', { workoutId }, workoutSessionSchema);

export const sendEvents = (sessionId: string, events: SessionEventInput[]) =>
  apiSend('POST', `/sessions/${sessionId}/events`, { events }, recordedSchema);

export const completeSession = (sessionId: string, status: 'completed' | 'abandoned', metrics: PerformanceMetrics) =>
  apiSend('POST', `/sessions/${sessionId}/complete`, { status, metrics }, workoutSessionSchema);

export const saveFeedback = (sessionId: string, feedback: PostWorkoutFeedback) =>
  apiSend('PUT', `/sessions/${sessionId}/feedback`, { feedback }, workoutSessionSchema);
