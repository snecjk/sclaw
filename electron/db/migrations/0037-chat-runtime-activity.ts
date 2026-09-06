import type { SqliteMigration } from '../types';

export const chatRuntimeActivityMigration: SqliteMigration = {
  version: 37,
  name: 'chat-runtime-activity',
  apply(db) {
    db.exec('ALTER TABLE chat_runtime_runs ADD COLUMN activity_json TEXT;');
  },
};

export default chatRuntimeActivityMigration;
