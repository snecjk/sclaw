import type { SqliteMigration } from '../types';

/** Stores the user-visible workflow version separately from the version row primary key. */
export const wfRunWorkflowVersionMigration: SqliteMigration = {
  version: 9,
  name: 'wf-run-workflow-version',
  sql: `
    ALTER TABLE wf_run ADD COLUMN workflow_version TEXT;
  `,
};

export default wfRunWorkflowVersionMigration;
