/**
 * User app creation and setup pipeline (capabilities: app-create-scaffold,
 * service-git-checkpoint). Local-first: scaffold + workspace complete in
 * seconds; environment preparation / npm install / dev server start run in a
 * background pipeline reported as one continuous progress to the workbench.
 */

import { app } from 'electron';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import {
  creepRatio,
  isTemplateTextFile,
  pipelineProgress,
  sanitizePackageName,
  substituteTemplateVars,
  type AppDevPhase,
} from '../utils/app-dev-info';
import { getNodeRuntimeStatus, getNodeSpawnEnv, isNodeRuntimeReady, setupManagedNode, getManagedNodePaths } from '../utils/node-runtime';
import { createWorkspace, listUserWorkspaces } from './session-catalog-service';
import { startDevServer, stopDevServer, getDevServer } from './app-dev-server-manager';
import { logger } from '../utils/logger';

export interface AppDevStatus {
  workspaceId: string;
  appPath: string;
  phase: AppDevPhase;
  /** 0-100 single continuous progress across all pipeline phases. */
  progress: number;
  previewUrl?: string;
  /** Non-technical error hint; raw logs stay available for agent diagnosis. */
  error?: string;
}

const statuses = new Map<string, AppDevStatus>();

export const DEFAULT_APPS_PARENT_DIR = join(homedir(), 'SClawApps');

/** Marker under the project agent workspace — used to hide from sidebar and list in 开发应用. */
export const APP_DEV_MARKER_RELATIVE = join('.sclaw', 'app-dev.json');

export interface AppDevMarker {
  kind: 'app-dev';
  name: string;
  projectType: string;
  createdAt: string;
}

export interface DevAppSummary {
  workspaceId: string;
  name: string;
  appPath: string;
  projectType: string;
  createdAt: string;
  /** Local path exists and marker is present. */
  localReady: boolean;
}

export function appDevMarkerPath(appPath: string): string {
  return join(appPath, APP_DEV_MARKER_RELATIVE);
}

export function isAppDevWorkspaceRoot(appPath: string): boolean {
  return existsSync(appDevMarkerPath(appPath));
}

async function writeAppDevBootstrap(
  appPath: string,
  vars: { name: string; projectType: string },
): Promise<void> {
  const sclawDir = join(appPath, '.sclaw');
  await mkdir(sclawDir, { recursive: true });

  const marker: AppDevMarker = {
    kind: 'app-dev',
    name: vars.name,
    projectType: vars.projectType,
    createdAt: new Date().toISOString(),
  };
  // Preserve original createdAt when re-ensuring.
  if (existsSync(appDevMarkerPath(appPath))) {
    try {
      const existing = JSON.parse(await readFile(appDevMarkerPath(appPath), 'utf8')) as Partial<AppDevMarker>;
      if (typeof existing.createdAt === 'string') marker.createdAt = existing.createdAt;
    } catch {
      // ignore
    }
  }
  await writeFile(appDevMarkerPath(appPath), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');

  // Injected as the project agent's default context. Written with a stable
  // marker so we can re-apply after OpenClaw seeds overwrite AGENTS.md.
  const agentsMd = `# ${vars.name}

<!-- sclaw-app-dev-context -->
你正在帮助用户开发一个名为「${vars.name}」的业务应用（SClaw 开发应用）。

## 项目结构
- \`frontend/\`：React + Vite 前端（用户主要看到和修改的页面）
- \`backend/\`：后端预留目录
- \`docs/api/\`：公司接口文档（Markdown），调用接口前先阅读这里

## 工作方式
- 用户是业务人员，用自然语言描述需求；不要要求他们写代码或看终端日志
- 优先修改 \`frontend/src/\` 下的页面与样式，改完后右侧预览会自动刷新
- 优先使用公司接口文档与组件；不确定时先查 \`docs/api/\`
- 保持页面简洁可用；改动后用简短中文说明「改了什么、用户会看到什么」
- 不要提交密钥到代码里；鉴权方式以接口文档为准
<!-- /sclaw-app-dev-context -->
`;
  await writeFile(join(sclawDir, 'AGENTS.md'), agentsMd, 'utf8');
}

/**
 * Ensure marker + AGENTS.md context exist (self-heal after OpenClaw seed overwrite).
 * Call after ensureProjectAgent so our context wins.
 */
export async function ensureAppDevContext(workspaceId: string): Promise<void> {
  const { getWorkspaceRootPath } = await import('./session-catalog-service');
  const appPath = await getWorkspaceRootPath(workspaceId);
  if (!appPath) throw new Error(`Workspace not found: ${workspaceId}`);

  let name = workspaceId;
  let projectType = 'frontend';
  const markerFile = appDevMarkerPath(appPath);
  if (existsSync(markerFile)) {
    try {
      const raw = JSON.parse(await readFile(markerFile, 'utf8')) as Partial<AppDevMarker>;
      if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
      if (typeof raw.projectType === 'string') projectType = raw.projectType;
    } catch {
      // ignore
    }
  } else {
    // Fallback: use workspace name from catalog.
    const workspaces = await listUserWorkspaces();
    const match = workspaces.find((w) => w.id === workspaceId);
    if (match?.name) name = match.name;
  }

  const agentsPath = join(appPath, '.sclaw', 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const current = await readFile(agentsPath, 'utf8');
    if (current.includes('<!-- sclaw-app-dev-context -->')) {
      // Marker present and context already ours — still refresh marker file.
      if (!existsSync(markerFile)) {
        await writeAppDevBootstrap(appPath, { name, projectType });
      }
      return;
    }
  }
  await writeAppDevBootstrap(appPath, { name, projectType });
}

function templateDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app-templates', 'react-vite')
    : join(process.cwd(), 'resources', 'app-templates', 'react-vite');
}

function setStatus(workspaceId: string, patch: Partial<AppDevStatus>): AppDevStatus {
  const current = statuses.get(workspaceId);
  const next: AppDevStatus = {
    workspaceId,
    appPath: current?.appPath ?? '',
    phase: 'created',
    progress: 0,
    ...current,
    ...patch,
  };
  statuses.set(workspaceId, next);
  return next;
}

export function getAppDevStatus(workspaceId: string): AppDevStatus | null {
  const status = statuses.get(workspaceId);
  if (!status) return null;
  if (status.phase === 'ready' && !getDevServer(workspaceId)) {
    // Dev server died since last check.
    return setStatus(workspaceId, { phase: 'stopped', progress: 0, previewUrl: undefined });
  }
  return { ...status };
}

/** Recursively copy the template applying variable substitution to text files. */
async function copyTemplate(
  srcDir: string,
  destDir: string,
  vars: { appName: string; appTitle: string },
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(src, dest, vars);
    } else if (isTemplateTextFile(entry.name)) {
      const content = await readFile(src, 'utf8');
      await writeFile(dest, substituteTemplateVars(content, vars), 'utf8');
    } else {
      await cp(src, dest);
    }
  }
}

/** Run a git command in the app repo with a fallback identity so commits never fail on missing user config. */
function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      ['-c', 'user.name=SClaw', '-c', 'user.email=sclaw@local', ...args],
      { cwd, windowsHide: true },
    );
    const chunks: string[] = [];
    child.stdout?.on('data', (d) => chunks.push(String(d)));
    child.stderr?.on('data', (d) => chunks.push(String(d)));
    child.on('close', (code) => resolve({ ok: code === 0, output: chunks.join('').trim() }));
    child.on('error', (err) => resolve({ ok: false, output: String(err) }));
  });
}

let gitAvailable: boolean | null = null;
export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  const result = await runGit(homedir(), ['--version']);
  gitAvailable = result.ok;
  return gitAvailable;
}

export interface CreateUserAppInput {
  name: string;
  /** Parent directory; the app folder `<parent>/<name>` is created inside. Defaults to ~/SClawApps. */
  parentDir?: string;
  /** 'frontend' | 'fullstack' — same template in MVP (backend placeholder). */
  projectType?: string;
}

export interface CreateUserAppResult {
  workspaceId: string;
  appPath: string;
  workspaceName: string;
}

export async function createUserApp(input: CreateUserAppInput): Promise<CreateUserAppResult> {
  const name = input.name.trim();
  if (!name) throw new Error('应用名称不能为空');

  const parentDir = (input.parentDir ?? DEFAULT_APPS_PARENT_DIR).trim();
  const appPath = join(parentDir, name);
  if (existsSync(appPath)) {
    const contents = await readdir(appPath).catch(() => []);
    if (contents.length > 0) {
      throw new Error('目标文件夹已存在且不为空，请换一个名称或位置');
    }
  }

  const template = templateDir();
  if (!existsSync(template)) {
    throw new Error(`应用模板缺失: ${template}`);
  }

  await copyTemplate(template, appPath, {
    appName: sanitizePackageName(name),
    appTitle: name,
  });

  await writeAppDevBootstrap(appPath, {
    name,
    projectType: input.projectType ?? 'frontend',
  });

  // Local checkpoint baseline (best-effort; app creation must not depend on git).
  if (await isGitAvailable()) {
    const init = await runGit(appPath, ['init']);
    if (init.ok) {
      await runGit(appPath, ['add', '-A']);
      await runGit(appPath, ['commit', '-m', '创建应用']);
    }
  }

  const workspace = await createWorkspace({ name, rootPath: appPath });
  const workspaceId: string = workspace.id;

  setStatus(workspaceId, { appPath, phase: 'created', progress: 0 });

  // Fire the background pipeline; errors land in status, never thrown to the wizard.
  void runSetupPipeline(workspaceId, appPath).catch((err) => {
    logger.error('[app-dev] setup pipeline failed:', err);
  });

  return { workspaceId, appPath, workspaceName: workspace.name ?? name };
}

/** List session-catalog workspaces that are marked as SClaw 开发应用. */
export async function listDevApps(): Promise<DevAppSummary[]> {
  const workspaces = await listUserWorkspaces();
  const apps: DevAppSummary[] = [];
  for (const workspace of workspaces) {
    const markerFile = appDevMarkerPath(workspace.rootPath);
    if (!existsSync(markerFile)) continue;
    let projectType = 'frontend';
    let createdAt = workspace.createdAt;
    try {
      const raw = JSON.parse(await readFile(markerFile, 'utf8')) as Partial<AppDevMarker>;
      if (typeof raw.projectType === 'string') projectType = raw.projectType;
      if (typeof raw.createdAt === 'string') createdAt = raw.createdAt;
    } catch {
      // ignore malformed marker; still treat as app-dev
    }
    apps.push({
      workspaceId: workspace.id,
      name: workspace.name,
      appPath: workspace.rootPath,
      projectType,
      createdAt,
      localReady: true,
    });
  }
  return apps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Workspace ids that belong to 开发应用 — used to hide them from the sidebar. */
export async function listDevAppWorkspaceIds(): Promise<string[]> {
  const apps = await listDevApps();
  return apps.map((app) => app.workspaceId);
}

async function runNpmInstall(workspaceId: string, appPath: string): Promise<void> {
  const { npmBin } = getManagedNodePaths();
  const frontendDir = join(appPath, 'frontend');
  let ratio = 0;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmBin, ['install', '--no-audit', '--no-fund'], {
      cwd: frontendDir,
      env: getNodeSpawnEnv() as NodeJS.ProcessEnv,
      windowsHide: true,
    });
    const tail: string[] = [];
    const onActivity = (chunk: unknown) => {
      tail.push(String(chunk));
      if (tail.length > 40) tail.shift();
      ratio = creepRatio(ratio);
      setStatus(workspaceId, { phase: 'installing', progress: pipelineProgress('installing', ratio) });
    };
    child.stdout?.on('data', onActivity);
    child.stderr?.on('data', onActivity);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed (code ${code})\n${tail.join('').trim()}`));
    });
    child.on('error', reject);
  });
}

/**
 * Background pipeline: managed Node -> npm install -> dev server, reported as
 * one continuous 0-100 progress. Also used to resume/start an existing app.
 */
export async function runSetupPipeline(workspaceId: string, appPath: string): Promise<void> {
  try {
    if (!isNodeRuntimeReady()) {
      setStatus(workspaceId, { appPath, phase: 'preparing-env', progress: pipelineProgress('preparing-env', 0) });
      const poll = setInterval(() => {
        const runtime = getNodeRuntimeStatus();
        const ratio = runtime.totalBytes > 0 ? runtime.receivedBytes / runtime.totalBytes : 0;
        setStatus(workspaceId, { phase: 'preparing-env', progress: pipelineProgress('preparing-env', ratio) });
      }, 500);
      try {
        await setupManagedNode();
      } finally {
        clearInterval(poll);
      }
    }

    const nodeModules = join(appPath, 'frontend', 'node_modules');
    if (!existsSync(nodeModules)) {
      setStatus(workspaceId, { phase: 'installing', progress: pipelineProgress('installing', 0) });
      await runNpmInstall(workspaceId, appPath);
    }

    setStatus(workspaceId, { phase: 'starting', progress: pipelineProgress('starting', 0.3) });
    const entry = await startDevServer(workspaceId, appPath);
    setStatus(workspaceId, { phase: 'ready', progress: 100, previewUrl: entry.previewUrl, error: undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(workspaceId, { phase: 'error', progress: 0, error: message, previewUrl: undefined });
    throw err;
  }
}

export function stopApp(workspaceId: string): void {
  stopDevServer(workspaceId);
  setStatus(workspaceId, { phase: 'stopped', progress: 0, previewUrl: undefined });
}

// ---------------------------------------------------------------------------
// Local checkpoints (capability: service-git-checkpoint)
// ---------------------------------------------------------------------------

export interface AppCheckpoint {
  hash: string;
  subject: string;
  timestamp: number;
}

export async function createCheckpoint(appPath: string, message: string): Promise<boolean> {
  if (!(await isGitAvailable())) return false;
  const status = await runGit(appPath, ['status', '--porcelain']);
  if (!status.ok || !status.output) return false; // no changes => no checkpoint
  await runGit(appPath, ['add', '-A']);
  const commit = await runGit(appPath, ['commit', '-m', message || '应用更新']);
  return commit.ok;
}

export async function listCheckpoints(appPath: string, limit = 20): Promise<AppCheckpoint[]> {
  if (!(await isGitAvailable())) return [];
  const log = await runGit(appPath, ['log', `-${limit}`, '--pretty=format:%H%x09%ct%x09%s']);
  if (!log.ok || !log.output) return [];
  return log.output.split('\n').map((line) => {
    const [hash, ts, ...subject] = line.split('\t');
    return { hash, timestamp: Number(ts) * 1000, subject: subject.join('\t') };
  });
}

/**
 * Restore the working tree to a checkpoint (default: previous one), creating
 * a safety backup branch first so the discarded state stays recoverable.
 */
export async function restoreCheckpoint(appPath: string, hash?: string): Promise<{ restored: boolean; backupRef?: string }> {
  if (!(await isGitAvailable())) return { restored: false };

  // Preserve any uncommitted work in the backup too.
  await createCheckpoint(appPath, '恢复前自动保存');

  const backupRef = `sclaw-backup-${Date.now()}`;
  const branch = await runGit(appPath, ['branch', backupRef]);
  if (!branch.ok) return { restored: false };

  const target = hash?.trim() || 'HEAD~1';
  const reset = await runGit(appPath, ['reset', '--hard', target]);
  if (!reset.ok) {
    return { restored: false, backupRef };
  }
  return { restored: true, backupRef };
}
