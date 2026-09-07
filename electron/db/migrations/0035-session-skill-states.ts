import type { SqliteMigration } from '../types';

export const sessionSkillStatesMigration: SqliteMigration = {
  version: 35,
  name: 'session-skill-states',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_skill_states (
        session_key            TEXT PRIMARY KEY,
        turn_no                INTEGER NOT NULL DEFAULT 0 CHECK (turn_no >= 0),
        manifest_revision      TEXT NOT NULL DEFAULT '',
        last_remote_route_turn INTEGER,
        last_task_fingerprint  TEXT,
        last_query             TEXT,
        state_json             TEXT NOT NULL DEFAULT '{"skills":[],"pendingTurns":{}}',
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_skill_states_updated
        ON session_skill_states(updated_at DESC);
    `);
  },
};

export default sessionSkillStatesMigration;
