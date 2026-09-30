/**
 * Numbered, append-only migrations. Never edit an applied migration; add a new one.
 *
 * Design: columns for anything that is filtered, joined, or constrained;
 * nested structures as JSON text (json_valid-checked here, Zod-validated at the
 * application boundary). Timestamps are ISO-8601 strings.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE user_profiles (
        id                TEXT PRIMARY KEY,
        fitness_level     TEXT NOT NULL CHECK (fitness_level IN ('beginner', 'intermediate', 'advanced')),
        training_context  TEXT NOT NULL,
        goals             TEXT NOT NULL CHECK (json_valid(goals)),
        equipment         TEXT NOT NULL CHECK (json_valid(equipment)),
        environment       TEXT NOT NULL CHECK (json_valid(environment)),
        available_minutes INTEGER NOT NULL CHECK (available_minutes > 0),
        schedule          TEXT NOT NULL CHECK (json_valid(schedule)),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      -- Restrictions are constraints, not diagnoses. notes are stored, never interpreted.
      CREATE TABLE user_constraints (
        user_id          TEXT PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
        restriction_tags TEXT NOT NULL CHECK (json_valid(restriction_tags)),
        notes            TEXT NOT NULL DEFAULT '',
        source           TEXT NOT NULL CHECK (source IN ('self_reported', 'professional_advised')),
        updated_at       TEXT NOT NULL
      );

      -- Mirror of the shared exercise library (seeded on startup).
      CREATE TABLE exercises (
        id         TEXT PRIMARY KEY,
        definition TEXT NOT NULL CHECK (json_valid(definition)),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE workouts (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
        requirements      TEXT NOT NULL CHECK (json_valid(requirements)),
        items             TEXT NOT NULL CHECK (json_valid(items)),
        scheduled_for     TEXT,
        estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
        created_at        TEXT NOT NULL
      );
      CREATE INDEX idx_workouts_user ON workouts (user_id, scheduled_for);

      CREATE TABLE workout_sessions (
        id           TEXT PRIMARY KEY,
        workout_id   TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
        status       TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')),
        started_at   TEXT NOT NULL,
        ended_at     TEXT,
        is_simulated INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0, 1)),
        feedback     TEXT CHECK (feedback IS NULL OR json_valid(feedback)),
        metrics      TEXT CHECK (metrics IS NULL OR json_valid(metrics))
      );
      CREATE INDEX idx_sessions_user ON workout_sessions (user_id, started_at);

      CREATE TABLE session_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        exercise_id TEXT,
        set_index   INTEGER,
        data        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data))
      );
      CREATE INDEX idx_events_session ON session_events (session_id, occurred_at);

      CREATE TABLE experiments (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
        status       TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'completed', 'ended_early', 'skipped')),
        variable     TEXT NOT NULL,
        hypothesis   TEXT NOT NULL,
        -- conditions, primary metric, minimum observations, planned duration
        design       TEXT NOT NULL CHECK (json_valid(design)),
        is_simulated INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0, 1)),
        created_at   TEXT NOT NULL,
        started_at   TEXT,
        ended_at     TEXT
      );
      CREATE INDEX idx_experiments_user ON experiments (user_id, status);

      CREATE TABLE experiment_results (
        experiment_id   TEXT PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
        sufficient_data INTEGER NOT NULL CHECK (sufficient_data IN (0, 1)),
        result          TEXT NOT NULL CHECK (json_valid(result)),
        computed_at     TEXT NOT NULL
      );

      CREATE TABLE analysis_reports (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
        experiment_id TEXT REFERENCES experiments(id) ON DELETE SET NULL,
        source        TEXT NOT NULL CHECK (source IN ('claude', 'fallback')),
        report        TEXT NOT NULL CHECK (json_valid(report)),
        created_at    TEXT NOT NULL
      );

      CREATE TABLE adaptation_proposals (
        id                 TEXT PRIMARY KEY,
        user_id            TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
        experiment_id      TEXT REFERENCES experiments(id) ON DELETE SET NULL,
        analysis_report_id TEXT REFERENCES analysis_reports(id) ON DELETE SET NULL,
        significance       TEXT NOT NULL CHECK (significance IN ('minor', 'significant')),
        status             TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'auto_applied')),
        changes            TEXT NOT NULL CHECK (json_valid(changes)),
        rationale          TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        decided_at         TEXT,
        -- spec §16.2: significant changes always need user approval.
        CHECK (NOT (status = 'auto_applied' AND significance = 'significant'))
      );
    `,
  },
  {
    version: 2,
    name: 'profile_name_and_workout_metadata',
    sql: `
      ALTER TABLE user_profiles ADD COLUMN name TEXT NOT NULL DEFAULT '';
      ALTER TABLE workouts ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE workouts ADD COLUMN rationale TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rationale));
      ALTER TABLE workouts ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_workouts_created ON workouts (user_id, created_at);
    `,
  },
  {
    version: 3,
    name: 'adaptation_proposal_lifecycle',
    // SQLite cannot alter a CHECK constraint, so the (unused until M9) table is rebuilt with the
    // pending/accepted/declined/applied lifecycle, provenance columns, and one proposal per experiment.
    sql: `
      CREATE TABLE adaptation_proposals_new (
        id                 TEXT PRIMARY KEY,
        user_id            TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
        experiment_id      TEXT REFERENCES experiments(id) ON DELETE SET NULL,
        analysis_report_id TEXT REFERENCES analysis_reports(id) ON DELETE SET NULL,
        title              TEXT NOT NULL DEFAULT '',
        significance       TEXT NOT NULL CHECK (significance IN ('minor', 'significant')),
        status             TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'applied', 'auto_applied')),
        changes            TEXT NOT NULL CHECK (json_valid(changes)),
        rationale          TEXT NOT NULL,
        is_simulated       INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0, 1)),
        result_computed_at TEXT,
        created_at         TEXT NOT NULL,
        decided_at         TEXT,
        applied_at         TEXT,
        applied_workout_id TEXT REFERENCES workouts(id) ON DELETE SET NULL,
        -- spec §16.2: significant changes always need user approval.
        CHECK (NOT (status = 'auto_applied' AND significance = 'significant')),
        CHECK (status NOT IN ('applied', 'auto_applied') OR applied_at IS NOT NULL)
      );
      INSERT INTO adaptation_proposals_new
        (id, user_id, experiment_id, analysis_report_id, significance, status, changes, rationale, created_at, decided_at, applied_at)
      SELECT id, user_id, experiment_id, analysis_report_id, significance,
             CASE status WHEN 'rejected' THEN 'declined' ELSE status END,
             changes, rationale, created_at, decided_at,
             CASE WHEN status = 'auto_applied' THEN COALESCE(decided_at, created_at) END
      FROM adaptation_proposals;
      DROP TABLE adaptation_proposals;
      ALTER TABLE adaptation_proposals_new RENAME TO adaptation_proposals;
      CREATE UNIQUE INDEX idx_adaptation_experiment ON adaptation_proposals (experiment_id) WHERE experiment_id IS NOT NULL;
      CREATE INDEX idx_adaptation_user ON adaptation_proposals (user_id, created_at);
    `,
  },
];
