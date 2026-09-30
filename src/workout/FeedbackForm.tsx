import { type FormEvent, useState } from 'react';
import { type Difficulty, type FeedbackAnswers, type Level3, toPostWorkoutFeedback } from './feedback';
import { saveFeedback } from './sessionApi';

function Choice<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span id={`${name}-label`}>{label}</span>
      <div className="choices" role="radiogroup" aria-labelledby={`${name}-label`}>
        {options.map(([v, text]) => (
          <label key={v}>
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
    </div>
  );
}

const LEVELS: [Level3, string][] = [
  ['low', 'Low'],
  ['okay', 'Okay'],
  ['high', 'High'],
];

export function FeedbackForm({ sessionId, onDone }: { sessionId: string; onDone: (saved: boolean) => void }) {
  const [answers, setAnswers] = useState<FeedbackAnswers>({ difficulty: 'moderate', energy: 'okay', enjoyment: 'okay', note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FeedbackAnswers>) => setAnswers((a) => ({ ...a, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveFeedback(sessionId, toPostWorkoutFeedback(answers));
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save feedback.');
      setSaving(false);
    }
  };

  return (
    <form className="panel profile-form" onSubmit={submit}>
      <h3>How was it?</h3>
      <Choice<Difficulty>
        label="Difficulty"
        name="difficulty"
        options={[
          ['easy', 'Easy'],
          ['moderate', 'Moderate'],
          ['hard', 'Hard'],
        ]}
        value={answers.difficulty}
        onChange={(difficulty) => set({ difficulty })}
      />
      <Choice label="Energy" name="energy" options={LEVELS} value={answers.energy} onChange={(energy) => set({ energy })} />
      <Choice label="Enjoyment" name="enjoyment" options={LEVELS} value={answers.enjoyment} onChange={(enjoyment) => set({ enjoyment })} />
      <label className="field">
        <span>Note (optional)</span>
        <textarea rows={2} maxLength={1000} value={answers.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="controls">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save feedback'}
        </button>
        <button type="button" className="secondary" onClick={() => onDone(false)} disabled={saving}>
          Skip
        </button>
      </div>
    </form>
  );
}
