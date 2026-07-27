import type { SqliteMigration } from '../types';
import { WORKFLOW_RUNTIME_TABLES_SQL } from './workflow-runtime-schema';

export const workflowRuntimeSchemaMigration: SqliteMigration = {
  version: 2,
  name: 'workflow-runtime-7-tables',
  sql: WORKFLOW_RUNTIME_TABLES_SQL,
};

export default workflowRuntimeSchemaMigration;
