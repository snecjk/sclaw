import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { syncClaudeSkillsForAgent } from './claude-skill-bridge';
import { listClaudeBridgePluginPaths } from './claude-plugin-bridge';
import { getAgentWorkspacePath } from '../utils/agent-config';
import { logger } from '../utils/logger';
import { expandPath } from '../utils/paths';
import { buildClaudeRuntimeOptions } from '../engines/claude-runtime-extensions';
import { prepareClaudeRuntime, withClaudeConfigDirEnv } from '../engines/claude-sdk-runtime';
import type {
  ClaudeScheduledTaskDefinition,
  ClaudeTaskPermissionProfile,
} from './claude-scheduled-task-store';

export interface ClaudeTaskRuntimeContext {
  accountId?: string;
  additionalDirectories?: string[];
  agentId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  model?: string;
  pathToClaudeCodeExecutable?: string;
  permissionMode?: 'bypassPermissions';
  plugins: Array<{ type: 'local'; path: string }>;
  runtimeOptions: Awaited<ReturnType<typeof buildClaudeRuntimeOptions>>;
  sessionKey: string;
  sessionId: string;
}

async function resolveTaskWorkspacePath(definition: ClaudeScheduledTaskDefinition): Promise<string> {
  const configured = definition.workspacePath?.trim();
  if (configured) {
    const expanded = expandPath(configured);
    if (existsSync(expanded)) {
      return expanded;
    }
    logger.warn('[claude-task] configured workspace path does not exist, falling back to agent workspace', {
      taskId: definition.id,
      agentId: definition.agentId,
      workspacePath: configured,
      expandedWorkspacePath: expanded,
    });
  }

  const agentWorkspace = await getAgentWorkspacePath(definition.agentId);
  if (agentWorkspace) {
    return agentWorkspace;
  }

  if (configured) {
    return expandPath(configured);
  }

  throw new Error(`Claude task ${definition.id} is missing workspace path`);
}

function buildAdditionalDirectories(cwd: string): string[] {
  const directories = new Set<string>();
  const userHome = expandPath('~') || homedir();
  const normalizedCwd = cwd.trim();
  const normalizedHome = userHome.trim();

  if (normalizedHome && normalizedHome !== normalizedCwd) {
    directories.add(normalizedHome);
  }

  return [...directories];
}

function mapPermissionProfile(
  permissionProfile: ClaudeTaskPermissionProfile,
): 'bypassPermissions' | undefined {
  return permissionProfile === 'dangerous-bypass' ? 'bypassPermissions' : undefined;
}

export async function buildClaudeTaskRuntimeContext(
  definition: ClaudeScheduledTaskDefinition,
  run: {
    runId: string;
    sessionKey: string;
    sessionId: string;
  },
): Promise<ClaudeTaskRuntimeContext> {
  const cwd = await resolveTaskWorkspacePath(definition);
  const sharedRuntime = await prepareClaudeRuntime({
    agentId: definition.agentId,
    requestedAccountId: definition.providerAccountId,
    requestedModel: definition.model,
  });
  const launch = sharedRuntime.selection;
  await syncClaudeSkillsForAgent(definition.agentId, cwd).catch((error) => {
    logger.warn('[claude-task] failed to sync Claude skills before run', error);
  });

  const pluginPaths = await listClaudeBridgePluginPaths();
  const runtimeOptions = await withClaudeConfigDirEnv(async () => (
    buildClaudeRuntimeOptions(run.sessionKey)
  ));

  return {
    accountId: launch.accountId,
    additionalDirectories: buildAdditionalDirectories(cwd),
    agentId: definition.agentId,
    cwd,
    env: sharedRuntime.env,
    model: launch.model,
    pathToClaudeCodeExecutable: sharedRuntime.pathToClaudeCodeExecutable,
    permissionMode: mapPermissionProfile(definition.permissionProfile),
    plugins: pluginPaths.map((pluginPath) => ({
      type: 'local' as const,
      path: pluginPath,
    })),
    runtimeOptions,
    sessionKey: run.sessionKey,
    sessionId: run.sessionId,
  };
}
