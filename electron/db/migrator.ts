import { logger } from '../utils/logger';
import { SQLITE_MIGRATIONS } from './migrations';
import type { SqliteDatabase } from './types';

function ensureMigrationTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * Side-branch migrations (e.g. sto-mobile channel CHECK) may already occupy
 * remapped target slots. Park them at a free high version so UNIQUE(version)
 * does not fail during legacy remaps.
 */
function nextFreeMigrationVersion(db: SqliteDatabase, preferredMin = 100): number {
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const used = new Set(rows.map((row) => Number(row.version)).filter(Number.isFinite));
  let candidate = preferredMin;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function relocateConflictingRemapTargets(
  db: SqliteDatabase,
  byVersion: Map<number, string>,
  expectedTargets: Map<number, string>,
): void {
  for (const [target, expected] of expectedTargets) {
    const existing = byVersion.get(target);
    if (!existing || existing === expected) continue;

    const freeVersion = nextFreeMigrationVersion(db);
    db.prepare('UPDATE schema_migrations SET version = ? WHERE version = ?').run(freeVersion, target);
    byVersion.delete(target);
    byVersion.set(freeVersion, existing);
    logger.info(
      `[sqlite] relocated conflicting migration "${existing}" from v${target} → v${freeVersion}`,
    );
  }
}

/**
 * The merged workflow branch owns v2-v5. Older memory/session builds used
 * those numbers independently, so remap their recorded versions before running
 * the append-only merged sequence (v6-v8). Channel-plane previously occupied
 * v5 on the test branch and moves to v10 so workflow cloud-id migration can run.
 * This retains all existing tables while allowing the missing workflow
 * migrations to execute exactly once. The 0710 branch also used v11 for
 * channel-plane and v12 for the consolidated workflow schema; after merging,
 * the channel record moves to v10 while the workflow record is removed so the
 * final v13 schema migration can replace any same-named local development
 * tables. This retains the main-branch v11/v12 slots for scheduled tasks and
 * artifact saves.
 */
export function normalizeLegacySessionCatalogMigrationVersions(db: SqliteDatabase): void {
  const rows = db.prepare(
    'SELECT version, name FROM schema_migrations ORDER BY version ASC',
  ).all() as Array<{ version: number; name: string }>;
  const byVersion = new Map(rows.map((row) => [Number(row.version), String(row.name)]));
  const highestAppliedVersion = rows.reduce(
    (highest, row) => Math.max(highest, Number(row.version)),
    0,
  );
  const version2Name = byVersion.get(2);
  const version5Name = byVersion.get(5);
  const version11Name = byVersion.get(11);
  const version12Name = byVersion.get(12);
  const hasLegacyMemoryOrSession =
    version2Name === 'session-catalog-schema' || version2Name === 'memory-capture-jobs';
  const hasLegacyChannelPlane = version5Name === 'channel-plane-channel-connections';
  const hasBranchChannelPlane = version11Name === 'channel-plane-channel-connections';
  const hasBranchWorkflowSchema = version12Name === 'workflow-runtime-schema';

  if (
    !hasLegacyMemoryOrSession
    && !hasLegacyChannelPlane
    && !hasBranchChannelPlane
    && !hasBranchWorkflowSchema
  ) return;

  if (hasLegacyMemoryOrSession) {
    const expected = version2Name === 'session-catalog-schema'
      ? new Map([[3, 'session-types-and-channels']])
      : new Map([[3, 'session-catalog-schema'], [4, 'session-types-and-channels']]);
    for (const [version, name] of expected) {
      const actual = byVersion.get(version);
      if (actual && actual !== name) {
        throw new Error(`[sqlite] cannot remap legacy memory/session migrations: v${version} is ${actual}`);
      }
    }
  }

  const version10Name = byVersion.get(10);
  if ((hasLegacyChannelPlane || hasBranchChannelPlane) && version10Name && version10Name !== 'channel-plane-channel-connections') {
    throw new Error(`[sqlite] cannot remap legacy channel-plane: v10 is ${version10Name}`);
  }
  const version13Name = byVersion.get(13);
  if (hasBranchWorkflowSchema && version13Name && version13Name !== 'workflow-runtime-schema') {
    throw new Error(`[sqlite] cannot remap workflow schema: v13 is ${version13Name}`);
  }

  const expectedTargets = new Map<number, string>();
  if (hasLegacyMemoryOrSession) {
    if (version2Name === 'memory-capture-jobs') {
      expectedTargets.set(6, 'memory-capture-jobs');
      expectedTargets.set(7, 'session-catalog-schema');
      expectedTargets.set(8, 'session-types-and-channels');
    } else {
      expectedTargets.set(7, 'session-catalog-schema');
      expectedTargets.set(8, 'session-types-and-channels');
    }
  }
  if (hasLegacyChannelPlane) {
    expectedTargets.set(10, 'channel-plane-channel-connections');
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    relocateConflictingRemapTargets(db, byVersion, expectedTargets);

    if (hasLegacyMemoryOrSession) {
      if (version2Name === 'memory-capture-jobs') {
        if (byVersion.get(4) === 'session-types-and-channels' && byVersion.get(8) !== 'session-types-and-channels') {
          db.prepare('UPDATE schema_migrations SET version = 8 WHERE version = 4').run();
        }
        if (byVersion.get(3) === 'session-catalog-schema' && byVersion.get(7) !== 'session-catalog-schema') {
          db.prepare('UPDATE schema_migrations SET version = 7 WHERE version = 3').run();
        }
        if (byVersion.get(2) === 'memory-capture-jobs' && byVersion.get(6) !== 'memory-capture-jobs') {
          db.prepare('UPDATE schema_migrations SET version = 6 WHERE version = 2').run();
        }
      } else {
        if (byVersion.get(3) === 'session-types-and-channels' && byVersion.get(8) !== 'session-types-and-channels') {
          db.prepare('UPDATE schema_migrations SET version = 8 WHERE version = 3').run();
        }
        if (byVersion.get(2) === 'session-catalog-schema' && byVersion.get(7) !== 'session-catalog-schema') {
          db.prepare('UPDATE schema_migrations SET version = 7 WHERE version = 2').run();
        }
      }
    }
    if (hasLegacyChannelPlane && byVersion.get(10) !== 'channel-plane-channel-connections') {
      db.prepare('UPDATE schema_migrations SET version = 10 WHERE version = 5').run();
    }
    if (hasBranchChannelPlane) {
      if (version10Name === 'channel-plane-channel-connections') {
        db.prepare('DELETE FROM schema_migrations WHERE version = 11').run();
      } else {
        db.prepare('UPDATE schema_migrations SET version = 10 WHERE version = 11').run();
      }
    }
    if (hasBranchWorkflowSchema) {
      if (version13Name === 'workflow-runtime-schema') {
        db.prepare('DELETE FROM schema_migrations WHERE version = 12').run();
      } else if (highestAppliedVersion <= 12) {
        // Do not mark the branch-local workflow schema as final. v13 must run
        // once to drop and recreate its potentially incompatible local tables.
        db.prepare('DELETE FROM schema_migrations WHERE version = 12').run();
      } else {
        // A later migration without v13 indicates a divergent migration
        // history. Never insert v13 behind v14+ or clear workflow tables in
        // that state; require an explicit compatibility migration instead.
        throw new Error(
          `[sqlite] cannot normalize branch workflow schema: found v12 workflow-runtime-schema but v13 is missing before v${highestAppliedVersion}`,
        );
      }
    }
    db.exec('COMMIT;');
    logger.info('[sqlite] normalized legacy memory/session migration versions');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function getAppliedMigrationRows(db: SqliteDatabase): Array<{ version: number; name: string }> {
  const rows = db.prepare(
    'SELECT version, name FROM schema_migrations ORDER BY version ASC',
  ).all() as Array<{ version: number; name: string }>;

  return rows.map((row) => ({
    version: Number(row.version),
    name: String(row.name),
  })).filter((row) => Number.isFinite(row.version) && row.name.length > 0);
}

/**
 * Side-branch databases recorded browser-automation-artifacts as v34 and
 * chat-runtime-interrupt-cause as v35. After merging main, those numbers belong
 * to chat-runtime-pi-engine and session-skill-states. Move the older records to
 * v39/v40 so the missing main migrations can run once.
 */
function rebaseOccupiedMigrationSlots(db: SqliteDatabase): void {
  const rows = getAppliedMigrationRows(db);
  const byVersion = new Map(rows.map((row) => [row.version, row.name]));

  const slots = [
    {
      occupiedVersion: 34,
      occupiedName: 'browser-automation-artifacts',
      canonicalVersion: 39,
      canonicalName: 'browser-automation-artifacts',
    },
    {
      occupiedVersion: 35,
      occupiedName: 'chat-runtime-interrupt-cause',
      canonicalVersion: 40,
      canonicalName: 'chat-runtime-interrupt-cause',
    },
  ] as const;

  const pending = slots.filter((slot) => byVersion.get(slot.occupiedVersion) === slot.occupiedName);
  if (pending.length === 0) return;

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const slot of pending) {
      const atCanonical = byVersion.get(slot.canonicalVersion);
      if (atCanonical === slot.canonicalName) {
        db.prepare('DELETE FROM schema_migrations WHERE version = ? AND name = ?').run(
          slot.occupiedVersion,
          slot.occupiedName,
        );
        byVersion.delete(slot.occupiedVersion);
        logger.info(
          `[sqlite] freed v${slot.occupiedVersion} previously occupied by ${slot.occupiedName} (kept v${slot.canonicalVersion})`,
        );
        continue;
      }
      if (atCanonical && atCanonical !== slot.canonicalName) {
        const freeVersion = nextFreeMigrationVersion(db);
        db.prepare('UPDATE schema_migrations SET version = ? WHERE version = ?').run(
          freeVersion,
          slot.canonicalVersion,
        );
        byVersion.delete(slot.canonicalVersion);
        byVersion.set(freeVersion, atCanonical);
        logger.info(
          `[sqlite] relocated conflicting migration "${atCanonical}" from v${slot.canonicalVersion} → v${freeVersion}`,
        );
      }
      db.prepare('UPDATE schema_migrations SET version = ? WHERE version = ? AND name = ?').run(
        slot.canonicalVersion,
        slot.occupiedVersion,
        slot.occupiedName,
      );
      byVersion.delete(slot.occupiedVersion);
      byVersion.set(slot.canonicalVersion, slot.occupiedName);
      logger.info(
        `[sqlite] remapped ${slot.occupiedName} v${slot.occupiedVersion} → v${slot.canonicalVersion}`,
      );
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Older local databases recorded the same migration SQL under different version
 * numbers (e.g. memory/catalog/types/channel as v6/v7/v8/v10). Treat those names
 * as already applied and backfill the current canonical version without re-running SQL.
 */
function backfillCanonicalMigrationVersions(db: SqliteDatabase): void {
  const rows = getAppliedMigrationRows(db);
  const appliedVersions = new Set(rows.map((row) => row.version));
  const appliedNames = new Set(rows.map((row) => row.name));
  const missing = SQLITE_MIGRATIONS.filter(
    (migration) => appliedNames.has(migration.name) && !appliedVersions.has(migration.version),
  );
  if (missing.length === 0) return;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const insert = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    const appliedAt = new Date().toISOString();
    for (const migration of missing) {
      insert.run(migration.version, migration.name, appliedAt);
      logger.info(
        `[sqlite] backfilled migration v${migration.version} ${migration.name} (already applied under another version)`,
      );
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function runDatabaseMigrations(db: SqliteDatabase): void {
  ensureMigrationTable(db);
  normalizeLegacySessionCatalogMigrationVersions(db);
  rebaseOccupiedMigrationSlots(db);
  backfillCanonicalMigrationVersions(db);
  const appliedVersions = new Set(getAppliedMigrationRows(db).map((row) => row.version));

  for (const migration of SQLITE_MIGRATIONS) {
    // Migrations are append-only: once a version is recorded, it is never rerun.
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    logger.info(`[sqlite] applying migration v${migration.version} ${migration.name}`);
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (migration.apply) {
        migration.apply(db);
      } else if (migration.sql) {
        db.exec(migration.sql);
      } else {
        throw new Error(`[sqlite] migration v${migration.version} has no operation`);
      }
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT;');
      appliedVersions.add(migration.version);
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}
