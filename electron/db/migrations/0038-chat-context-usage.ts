import type { SqliteMigration } from '../types';

export const chatContextUsageMigration: SqliteMigration = {
  version: 38,
  name: 'chat-context-usage',
  apply(db) {
    db.exec('ALTER TABLE chat_runtime_runs ADD COLUMN context_usage_json TEXT;');
  },
};

export default chatContextUsageMigration;
