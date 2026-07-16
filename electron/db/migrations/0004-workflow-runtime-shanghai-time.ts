import type { SqliteMigration } from '../types';

const toShanghai = (column: string) =>
  `${column} = CASE
    WHEN ${column} IS NOT NULL AND ${column} LIKE '%Z'
    THEN strftime('%Y-%m-%dT%H:%M:%f', ${column}, '+8 hours') || '+08:00'
    ELSE ${column}
  END`;

export const workflowRuntimeShanghaiTimeMigration: SqliteMigration = {
  version: 4,
  name: 'workflow-runtime-shanghai-time',
  sql: `
    UPDATE wf_run
    SET
      ${toShanghai('started_at')},
      ${toShanghai('completed_at')},
      ${toShanghai('updated_at')},
      ${toShanghai('synced_at')};

    UPDATE wf_node_run
    SET
      ${toShanghai('started_at')},
      ${toShanghai('completed_at')};

    UPDATE wf_event
    SET
      ${toShanghai('created_at')};

    UPDATE wf_artifact
    SET
      ${toShanghai('created_at')};

    UPDATE wf_approval_task
    SET
      ${toShanghai('requested_at')},
      ${toShanghai('decided_at')};

    UPDATE wf_user_input_task
    SET
      ${toShanghai('requested_at')},
      ${toShanghai('submitted_at')};

    UPDATE wf_outbox
    SET
      ${toShanghai('next_retry_at')},
      ${toShanghai('created_at')},
      ${toShanghai('synced_at')};
  `,
};

export default workflowRuntimeShanghaiTimeMigration;
