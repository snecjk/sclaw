import { sql } from 'kysely';
import { getKyselyDatabase } from '../connection';
import type { SessionSkillState } from '../../services/skills/session-skill-state';

function nowIso(): string {
  return new Date().toISOString();
}

function parseState(sessionKey: string, raw: string): SessionSkillState {
  const parsed = JSON.parse(raw) as Partial<SessionSkillState>;
  return {
    sessionKey,
    turnNo: Number(parsed.turnNo ?? 0),
    manifestRevision: String(parsed.manifestRevision ?? ''),
    lastRemoteRouteTurn: parsed.lastRemoteRouteTurn,
    lastTaskFingerprint: parsed.lastTaskFingerprint,
    lastQuery: parsed.lastQuery,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    pendingTurns: parsed.pendingTurns && typeof parsed.pendingTurns === 'object' ? parsed.pendingTurns : {},
  };
}

export class SessionSkillStateRepository {
  async get(sessionKey: string): Promise<SessionSkillState | null> {
    const row = await getKyselyDatabase()
      .selectFrom('session_skill_states')
      .selectAll()
      .where('session_key', '=', sessionKey)
      .executeTakeFirst();
    return row ? parseState(sessionKey, row.state_json) : null;
  }

  async upsert(state: SessionSkillState): Promise<void> {
    const timestamp = nowIso();
    const stateJson = JSON.stringify(state);
    await getKyselyDatabase()
      .insertInto('session_skill_states')
      .values({
        session_key: state.sessionKey,
        turn_no: state.turnNo,
        manifest_revision: state.manifestRevision,
        last_remote_route_turn: state.lastRemoteRouteTurn ?? null,
        last_task_fingerprint: state.lastTaskFingerprint ?? null,
        last_query: state.lastQuery ?? null,
        state_json: stateJson,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict((conflict) => conflict.column('session_key').doUpdateSet({
        turn_no: state.turnNo,
        manifest_revision: state.manifestRevision,
        last_remote_route_turn: state.lastRemoteRouteTurn ?? null,
        last_task_fingerprint: state.lastTaskFingerprint ?? null,
        last_query: state.lastQuery ?? null,
        state_json: stateJson,
        updated_at: timestamp,
      }))
      .execute();
  }

  async delete(sessionKey: string): Promise<void> {
    await getKyselyDatabase().deleteFrom('session_skill_states').where('session_key', '=', sessionKey).execute();
  }

  async deleteOlderThan(updatedBeforeIso: string): Promise<number> {
    const result = await getKyselyDatabase()
      .deleteFrom('session_skill_states')
      .where('updated_at', '<', updatedBeforeIso)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  async count(): Promise<number> {
    const row = await getKyselyDatabase()
      .selectFrom('session_skill_states')
      .select(sql<number>`count(*)`.as('count'))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}

const repository = new SessionSkillStateRepository();

export function getSessionSkillStateRepository(): SessionSkillStateRepository {
  return repository;
}
