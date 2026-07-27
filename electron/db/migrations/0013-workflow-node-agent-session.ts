import type { SqliteMigration } from '../types';
import { ensureWorkflowNodeRunSchema } from './workflow-runtime-schema';

const workflowNodeAgentSessionMigration: SqliteMigration = {
  version: 13,
  name: 'workflow-node-agent-session',
  apply: (db) => {
    ensureWorkflowNodeRunSchema(db);
  },
};

export default workflowNodeAgentSessionMigration;
