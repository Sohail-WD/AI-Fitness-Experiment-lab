import type { CvExerciseConfig } from './exercises/types';
import { type BodySide, type Landmark, landmarkIndex } from './types';

export interface Connection {
  start: number;
  end: number;
}

const COLORS = {
  skeleton: 'rgba(255, 255, 255, 0.55)',
  tracked: '#22c55e',
  trackedUnreliable: '#f59e0b',
};

/** Draw the full skeleton faintly and highlight the tracked side's primary-angle joints. */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[] | null,
  connections: Connection[],
  side: BodySide | null,
  reliable: boolean,
  exercise: CvExerciseConfig,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  const pt = (i: number) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const scale = Math.max(1, width / 640);

  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = COLORS.skeleton;
  for (const { start, end } of connections) {
    const a = pt(start);
    const b = pt(end);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  if (!side) return;
  const color = reliable ? COLORS.tracked : COLORS.trackedUnreliable;
  const sides: BodySide[] = exercise.bilateral ? ['left', 'right'] : [side];
  for (const s of sides) {
    const chain = exercise.overlayJoints.map((j) => pt(landmarkIndex(s, j)));
    ctx.lineWidth = 5 * scale;
    ctx.strokeStyle = color;
    ctx.beginPath();
    chain.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    ctx.fillStyle = color;
    for (const p of chain) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
