import type { SqliteMigration } from '../types';
import { ensureWorkflowNodeRunSchema } from './workflow-runtime-schema';

/**
 * Applies the consolidated node-run DDL to installations that already marked
 * v13 complete before later runtime columns were introduced.
 */
const workflowNodeRunSchemaConsolidationMigration: SqliteMigration = {
  version: 14,
  name: 'workflow-node-run-schema-consolidation',
  apply: ensureWorkflowNodeRunSchema,
};

export default workflowNodeRunSchemaConsolidationMigration;
