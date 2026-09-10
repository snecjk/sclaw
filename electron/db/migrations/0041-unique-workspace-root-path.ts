import type { SqliteMigration } from '../types';
import { normalizeWorkspaceRootPath } from '../workspace-root-path';

function tableExists(db: Parameters<NonNullable<SqliteMigration['apply']>>[0], table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

/**
 * One local folder can belong to only one active workspace.
 * Collapse existing duplicates (keep earliest created_at), then unique-index root_path.
 */
export const uniqueWorkspaceRootPathMigration: SqliteMigration = {
  version: 41,
  name: 'unique-workspace-root-path',
  apply(db) {
    if (!tableExists(db, 'workspaces')) return;

    const rows = db.prepare(`
      SELECT id, root_path, created_at
      FROM workspaces
      WHERE deleted_at IS NULL AND is_default = 0 AND TRIM(root_path) != ''
    `).all() as Array<{ id: string; root_path: string; created_at: string }>;

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = normalizeWorkspaceRootPath(row.root_path);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    const now = new Date().toISOString();
    const hasCatalog = tableExists(db, 'catalog_sessions');
    const hasGroups = tableExists(db, 'session_groups');

    for (const [normalized, members] of groups) {
      members.sort((left, right) => (
        left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
      ));
      const keep = members[0];
      db.prepare('UPDATE workspaces SET root_path = ? WHERE id = ?').run(normalized, keep.id);

      for (const extra of members.slice(1)) {
        if (hasCatalog) {
          const keepKeys = new Set(
            (db.prepare(
              'SELECT session_key FROM catalog_sessions WHERE workspace_id = ?',
            ).all(keep.id) as Array<{ session_key: string }>).map((row) => row.session_key),
          );
          const extraSessions = db.prepare(
            'SELECT session_key FROM catalog_sessions WHERE workspace_id = ? AND deleted_at IS NULL',
          ).all(extra.id) as Array<{ session_key: string }>;
          for (const session of extraSessions) {
            if (keepKeys.has(session.session_key)) continue;
            db.prepare(`
              UPDATE catalog_sessions
              SET workspace_id = ?, updated_at = ?
              WHERE workspace_id = ? AND session_key = ?
            `).run(keep.id, now, extra.id, session.session_key);
          }
          db.prepare(`
            UPDATE catalog_sessions
            SET deleted_at = ?, updated_at = ?
            WHERE workspace_id = ? AND deleted_at IS NULL
          `).run(now, now, extra.id);
        }
        if (hasGroups) {
          db.prepare(`
            UPDATE session_groups
            SET deleted_at = ?, updated_at = ?
            WHERE workspace_id = ? AND deleted_at IS NULL
          `).run(now, now, extra.id);
        }
        db.prepare(`
          UPDATE workspaces
          SET deleted_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND deleted_at IS NULL
        `).run(now, now, extra.id);
      }
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_active_root_path
      ON workspaces(root_path)
      WHERE deleted_at IS NULL AND is_default = 0 AND root_path != '';
    `);
  },
};

export default uniqueWorkspaceRootPathMigration;
