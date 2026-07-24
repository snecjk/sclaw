import type { SqliteMigration } from '../types';

/** Pins the execution engine so recovery never changes an in-flight run's behavior. */
export const wfRunEngineMigration: SqliteMigration = {
  version: 10,
  name: 'wf-run-engine',
  sql: `
    ALTER TABLE wf_run ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'claude';
    ALTER TABLE wf_run ADD COLUMN engine_model TEXT;
  `,
};

export default wfRunEngineMigration;
