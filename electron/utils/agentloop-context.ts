import { getAuthState } from './auth-store';

/**
 * Build a per-invocation environment for AgentLoop's Claude Agent SDK probe.
 *
 * User identity must be resolved for every invocation because the desktop app
 * supports logout and account switching. Never mutate the shared runtime env,
 * otherwise a later anonymous request could be attributed to the previous user.
 */
export async function buildAgentLoopRequestEnv(
  baseEnv: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  const env = { ...baseEnv };

  // Remove inherited values first so auth lookup failures cannot leak a stale ID.
  delete env.GEN_AI_USER_ID;
  delete env.CMS_USER_ID;

  try {
    const authState = await getAuthState();
    const employeeCode = authState.user?.code?.trim();
    if (employeeCode) env.GEN_AI_USER_ID = `Sclaw_${employeeCode}`;
  } catch {
    // Observability enrichment is best-effort and must never block an agent run.
  }

  return env;
}
