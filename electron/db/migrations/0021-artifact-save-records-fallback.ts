import type { SqliteMigration } from '../types';

/**
 * Fallback migration for artifact_save_records.
 *
 * Some historical builds recorded other migrations at versions 12-16 and never
 * created the artifact_save_records table. This migration runs at a high version
 * (21) so it executes on those legacy databases while remaining safe to run on
 * fresh installs where the table may already exist.
 */
export const artifactSaveRecordsFallbackMigration: SqliteMigration = {
  version: 21,
  name: 'artifact-save-records-fallback',
  apply(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS artifact_save_records (
        id                     TEXT PRIMARY KEY,
        source_type            TEXT NOT NULL,
        source_id              TEXT NOT NULL,
        source_title           TEXT,
        run_id                 TEXT,
        session_id             TEXT,
        artifact_key           TEXT NOT NULL,
        artifact_name          TEXT NOT NULL,
        local_path             TEXT,
        target_uri             TEXT NOT NULL,
        target_label           TEXT,
        status                 TEXT NOT NULL CHECK (status IN ('pending','uploading','succeeded','failed')),
        data_center_entry_id   TEXT,
        data_center_path_label TEXT,
        error_code             TEXT,
        error_message          TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        deleted_at             TEXT,
        version                INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_save_unique
        ON artifact_save_records(source_type, run_id, artifact_key, target_uri)
        WHERE deleted_at IS NULL AND run_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_artifact_save_source
        ON artifact_save_records(source_type, source_id, created_at DESC)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_artifact_save_run
        ON artifact_save_records(source_type, run_id, created_at DESC)
        WHERE deleted_at IS NULL AND run_id IS NOT NULL;
    `);
  },
};

export default artifactSaveRecordsFallbackMigration;
