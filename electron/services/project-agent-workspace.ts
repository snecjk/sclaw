/**
 * Prepare `<projectRoot>/.sclaw` as the OpenClaw workspace for a project agent.
 * Migrates legacy bootstrap files / `.claw-output` / `memory` from the project root
 * into `.sclaw` when present, so the project root stays clean.
 */
import { access, mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import {
  PROJECT_AGENT_RUNTIME_DIRNAME,
  WORKSPACE_ARTIFACT_OUTPUT_DIRNAME,
  resolveProjectAgentWorkspacePath,
} from '../../shared/workspace-paths';
import { logger } from '../utils/logger';

/** OpenClaw bootstrap / memory files previously seeded at the project root. */
const PROJECT_ROOT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'CLAUDE.md',
  'MEMORY.md',
  'SYSTEM.md',
  'RULES.md',
] as const;

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function movePathIfMissing(source: string, dest: string): Promise<boolean> {
  if (!(await pathExists(source))) return false;
  if (await pathExists(dest)) return false;
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(source, dest);
  return true;
}

async function mergeDirectoryInto(sourceDir: string, destDir: string): Promise<void> {
  if (!(await pathExists(sourceDir))) return;
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await mergeDirectoryInto(from, to);
      continue;
    }
    if (await pathExists(to)) continue;
    await rename(from, to);
  }
  // Best-effort: remove empty leftover source tree.
  try {
    const leftover = await readdir(sourceDir);
    if (leftover.length === 0) {
      await rm(sourceDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

/**
 * Ensure `<projectRoot>/.sclaw` exists and migrate legacy root clutter into it.
 * Returns the absolute OpenClaw workspace path for the project agent.
 */
export async function prepareProjectAgentWorkspace(projectRootPath: string): Promise<string> {
  const projectRoot = path.resolve(projectRootPath.trim());
  const agentWorkspace = path.resolve(resolveProjectAgentWorkspacePath(projectRoot));
  await mkdir(agentWorkspace, { recursive: true });

  // Already pointing at `.sclaw` — nothing to migrate from a parent we don't know.
  if (path.basename(projectRoot) === PROJECT_AGENT_RUNTIME_DIRNAME) {
    return agentWorkspace;
  }

  const migrated: string[] = [];
  for (const fileName of PROJECT_ROOT_BOOTSTRAP_FILES) {
    const moved = await movePathIfMissing(
      path.join(projectRoot, fileName),
      path.join(agentWorkspace, fileName),
    );
    if (moved) migrated.push(fileName);
  }

  const legacyOutput = path.join(projectRoot, WORKSPACE_ARTIFACT_OUTPUT_DIRNAME);
  const targetOutput = path.join(agentWorkspace, WORKSPACE_ARTIFACT_OUTPUT_DIRNAME);
  if (await pathExists(legacyOutput)) {
    if (!(await pathExists(targetOutput))) {
      await rename(legacyOutput, targetOutput);
      migrated.push(WORKSPACE_ARTIFACT_OUTPUT_DIRNAME);
    } else {
      await mergeDirectoryInto(legacyOutput, targetOutput);
      migrated.push(`${WORKSPACE_ARTIFACT_OUTPUT_DIRNAME}(merge)`);
    }
  }

  const legacyMemory = path.join(projectRoot, 'memory');
  const targetMemory = path.join(agentWorkspace, 'memory');
  if (await pathExists(legacyMemory)) {
    try {
      const info = await stat(legacyMemory);
      if (info.isDirectory()) {
        if (!(await pathExists(targetMemory))) {
          await rename(legacyMemory, targetMemory);
          migrated.push('memory');
        } else {
          await mergeDirectoryInto(legacyMemory, targetMemory);
          migrated.push('memory(merge)');
        }
      }
    } catch {
      // ignore
    }
  }

  if (migrated.length > 0) {
    logger.info('[project-agent] migrated project root runtime files into .sclaw', {
      projectRoot,
      agentWorkspace,
      migrated,
    });
  }

  return agentWorkspace;
}
