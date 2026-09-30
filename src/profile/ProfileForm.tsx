import { type FormEvent, useState } from 'react';
import type { Equipment, FitnessLevel, Goal, RestrictionTag, TrainingContext } from '../../shared/schemas/common';
import { type ProfileInput, profileInputSchema } from '../../shared/schemas/profile';
import {
  CONTEXT_LABEL,
  EQUIPMENT_LABEL,
  GOAL_LABEL,
  LEVEL_LABEL,
  RESTRICTION_LABEL,
} from '../../shared/workout/labels';

const LEVELS: FitnessLevel[] = ['beginner', 'intermediate', 'advanced'];
const GOALS: Goal[] = ['general_fitness', 'strength', 'muscle_building', 'endurance', 'weight_management'];
const EQUIPMENT: Equipment[] = ['dumbbells', 'resistance_bands', 'barbell', 'full_gym'];
const CONTEXTS: TrainingContext[] = ['sedentary', 'recreationally_active', 'regularly_training', 'athletic'];
const DURATIONS = [15, 30, 45, 60];
const FREQUENCIES = [2, 3, 4, 5, 6];
const RESTRICTIONS = Object.keys(RESTRICTION_LABEL) as RestrictionTag[];

export const EMPTY_PROFILE: ProfileInput = {
  profile: {
    name: '',
    fitnessLevel: 'beginner',
    goals: ['general_fitness'],
    trainingContext: 'recreationally_active',
    equipment: [],
    environment: { location: 'home' },
    availableMinutes: 30,
    schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
  },
  constraints: { restrictionTags: [], notes: '', source: 'self_reported' },
};

interface ProfileFormProps {
  initial: ProfileInput;
  saving: boolean;
  onSave: (input: ProfileInput) => void;
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function ProfileForm({ initial, saving, onSave }: ProfileFormProps) {
  const [form, setForm] = useState<ProfileInput>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const p = form.profile;
  const c = form.constraints;
  const setProfile = (patch: Partial<ProfileInput['profile']>) => setForm((f) => ({ ...f, profile: { ...f.profile, ...patch } }));
  const setConstraints = (patch: Partial<ProfileInput['constraints']>) =>
    setForm((f) => ({ ...f, constraints: { ...f.constraints, ...patch } }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = profileInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.at(-1) === 'name' ? 'Name' : i.path.join('.')}: ${i.message}`));
      return;
    }
    setErrors([]);
    onSave(parsed.data);
  };

  return (
    <form className="profile-form" onSubmit={submit} noValidate>
      <fieldset className="panel">
        <legend>About you</legend>
        <label className="field">
          <span>Name</span>
          <input value={p.name} maxLength={60} required onChange={(e) => setProfile({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Fitness level</span>
          <select value={p.fitnessLevel} onChange={(e) => setProfile({ fitnessLevel: e.target.value as FitnessLevel })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Current activity</span>
          <select
            value={p.trainingContext}
            onChange={(e) => setProfile({ trainingContext: e.target.value as TrainingContext })}
          >
            {CONTEXTS.map((ctx) => (
              <option key={ctx} value={ctx}>
                {CONTEXT_LABEL[ctx]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Goal</span>
          <select value={p.goals[0]} onChange={(e) => setProfile({ goals: [e.target.value as Goal] })}>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {GOAL_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="panel">
        <legend>Training setup</legend>
        <div className="field">
          <span id="equipment-label">Equipment</span>
          <div className="choices" role="group" aria-labelledby="equipment-label">
            <label>
              <input type="checkbox" checked={p.equipment.length === 0} onChange={() => setProfile({ equipment: [] })} />
              None
            </label>
            {EQUIPMENT.map((eq) => (
              <label key={eq}>
                <input
                  type="checkbox"
                  checked={p.equipment.includes(eq)}
                  onChange={() => setProfile({ equipment: toggle(p.equipment, eq) })}
                />
                {EQUIPMENT_LABEL[eq]}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <span id="location-label">Environment</span>
          <div className="choices" role="radiogroup" aria-labelledby="location-label">
            {(['home', 'gym'] as const).map((loc) => (
              <label key={loc}>
                <input
                  type="radio"
                  name="location"
                  checked={p.environment.location === loc}
                  onChange={() => setProfile({ environment: { ...p.environment, location: loc } })}
                />
                {loc === 'home' ? 'Home' : 'Gym'}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Workout duration</span>
          <select value={p.availableMinutes} onChange={(e) => setProfile({ availableMinutes: Number(e.target.value) })}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Training frequency</span>
          <select
            value={p.schedule.workoutsPerWeek}
            onChange={(e) => setProfile({ schedule: { ...p.schedule, workoutsPerWeek: Number(e.target.value) } })}
          >
            {FREQUENCIES.map((n) => (
              <option key={n} value={n}>
                {n} days / week
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span id="times-label">Preferred workout time</span>
          <div className="choices" role="group" aria-labelledby="times-label">
            {(['morning', 'afternoon', 'evening'] as const).map((t) => (
              <label key={t}>
                <input
                  type="checkbox"
                  checked={p.schedule.preferredTimes.includes(t)}
                  onChange={() => setProfile({ schedule: { ...p.schedule, preferredTimes: toggle(p.schedule.preferredTimes, t) } })}
                />
                {t[0].toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="panel">
        <legend>Movement restrictions</legend>
        <p className="notice">
          Only add restrictions you have already identified or been advised by a qualified healthcare professional. They
          are used solely to leave out exercises. This app does not diagnose conditions, decide whether exercise is safe
          for you, or replace professional advice.
        </p>
        <div className="choices" role="group" aria-label="Restrictions">
          {RESTRICTIONS.map((tag) => (
            <label key={tag}>
              <input
                type="checkbox"
                checked={c.restrictionTags.includes(tag)}
                onChange={() => setConstraints({ restrictionTags: toggle(c.restrictionTags, tag) })}
              />
              {RESTRICTION_LABEL[tag]}
            </label>
          ))}
        </div>
        <div className="field">
          <span id="source-label">Source</span>
          <div className="choices" role="radiogroup" aria-labelledby="source-label">
            {(['self_reported', 'professional_advised'] as const).map((src) => (
              <label key={src}>
                <input
                  type="radio"
                  name="source"
                  checked={c.source === src}
                  onChange={() => setConstraints({ source: src })}
                />
                {src === 'self_reported' ? 'My own' : 'Advised by a professional'}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Note (optional)</span>
          <textarea
            value={c.notes}
            maxLength={1000}
            rows={3}
            onChange={(e) => setConstraints({ notes: e.target.value })}
          />
          <small>Saved for your reference only. The app never interprets this note.</small>
        </label>
      </fieldset>

      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
