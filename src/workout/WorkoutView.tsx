import { findExercise } from '../../shared/exercises/library';
import type { Workout, WorkoutItem } from '../../shared/schemas/workout';
import { EQUIPMENT_LABEL, GOAL_LABEL, LEVEL_LABEL } from '../../shared/workout/labels';

const SECTION_LABEL: Record<WorkoutItem['section'], string> = { warmup: 'Warm-up', main: 'Main', cooldown: 'Cool-down' };

function prescription(item: WorkoutItem, perSide: boolean): string {
  const target = item.target.type === 'reps' ? `${item.target.reps} reps` : `${item.target.seconds} s`;
  return `${item.sets} × ${target}${perSide ? ' per side' : ''}`;
}

export function WorkoutView({ workout }: { workout: Workout }) {
  const req = workout.requirements;
  const usedEquipment = [
    ...new Set(workout.items.flatMap((i) => findExercise(i.exerciseId)?.requiredEquipment ?? [])),
  ];

  return (
    <article className="workout" aria-labelledby="workout-title">
      <h3 id="workout-title">{workout.title}</h3>
      <dl className="workout-meta">
        <div>
          <dt>Goal</dt>
          <dd>{GOAL_LABEL[req.goals[0]]}</dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>{LEVEL_LABEL[req.fitnessLevel]}</dd>
        </div>
        <div>
          <dt>Estimated</dt>
          <dd>
            {workout.estimatedMinutes} of {req.targetDurationMinutes} min
          </dd>
        </div>
        <div>
          <dt>Equipment</dt>
          <dd>{usedEquipment.length ? usedEquipment.map((e) => EQUIPMENT_LABEL[e]).join(', ') : 'None'}</dd>
        </div>
      </dl>

      <div className="table-scroll">
        <table className="workout-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Exercise</th>
              <th scope="col">Sets × target</th>
              <th scope="col">Rest</th>
              <th scope="col">Equipment</th>
            </tr>
          </thead>
          <tbody>
            {workout.items.map((item) => {
              const exercise = findExercise(item.exerciseId);
              return (
                <tr key={item.order} className={`section-${item.section}`}>
                  <td>{item.order + 1}</td>
                  <td>
                    <span className="section-tag">{SECTION_LABEL[item.section]}</span> {exercise?.name ?? item.exerciseId}
                    {exercise?.cv && <span className="cv-tag">Camera tracking</span>}
                  </td>
                  <td>{prescription(item, exercise?.perSide ?? false)}</td>
                  <td>{item.sets > 1 ? `${item.restSeconds} s` : '—'}</td>
                  <td>
                    {exercise?.requiredEquipment.length
                      ? exercise.requiredEquipment.map((e) => EQUIPMENT_LABEL[e]).join(', ')
                      : 'None'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="why" aria-labelledby="why-title">
        <h4 id="why-title">Why this workout?</h4>
        <ul>
          {workout.rationale.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
