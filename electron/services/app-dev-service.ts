/**
 * User app creation and setup pipeline (capabilities: app-create-scaffold,
 * service-git-checkpoint). Local-first: scaffold + workspace complete in
 * seconds; environment preparation / npm install / dev server start run in a
 * background pipeline reported as one continuous progress to the workbench.
 */

import { app } from 'electron';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, statSync } from 'fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { extname, dirname, join, relative, resolve, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  creepRatio,
  isTemplateTextFile,
  pipelineProgress,
  sanitizePackageName,
  substituteTemplateVars,
  type AppDevPhase,
} from '../utils/app-dev-info';
import { getNodeRuntimeStatus, getNodeSpawnEnv, isNodeRuntimeReady, setupManagedNode, getManagedNodePaths } from '../utils/node-runtime';
import { getUvMirrorEnv } from '../utils/uv-env';
import { resolveUvBin, setupManagedPython } from '../utils/uv-setup';
import { needsWinShell, quoteForCmd } from '../utils/paths';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { extractZip } from '../utils/zip-extract';
import { createWorkspace, deleteWorkspace, listUserWorkspaces } from './session-catalog-service';
import { startDevServer, stopDevServer, getDevServer } from './app-dev-server-manager';
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';
import { createStoApp } from './sto-app-service';

/** Remote React engineering template (OSS). Packaged builds no longer require bundled app-templates. */
const REACT_TEMPLATE_ZIP_URL =
  'http://ali-sto-tps.oss-cn-shanghai.aliyuncs.com/6BB155FE-CAE2-4B-react-template.zip';

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
- \`openspec/\`：本应用的 OpenSpec（规格驱动开发）与已安装开发技能；**不是** SClaw 客户端仓库

## 工作方式
- 用户是业务人员，用自然语言描述需求；不要要求他们写代码或看终端日志
- 优先修改 \`frontend/src/\` 下的页面与样式，改完后右侧预览会自动刷新
- 优先使用公司接口文档与组件；不确定时先查 \`docs/api/\`
- 新功能或跨模块改动：先读 \`openspec/skills/\` 中相关技能，再按 OpenSpec（proposal → design → specs → tasks → apply）推进
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

function bundledTemplateDir(): string | null {
  // Local checkout only — packaged builds must not rely on bundled app-templates.
  if (app.isPackaged) return null;
  return join(process.cwd(), 'resources', 'app-templates', 'react-template');
}

function cachedTemplateDir(): string {
  return join(app.getPath('userData'), 'app-templates', 'react-template');
}

function isValidReactTemplate(dir: string): boolean {
  return existsSync(join(dir, 'frontend', 'package.json'));
}

function templateMetaPath(dir: string): string {
  return join(dir, '.sclaw-template-meta.json');
}

/** Sync path for OpenSpec helpers: prefer OSS cache, then local checkout (dev only). */
function templateDir(): string {
  const cached = cachedTemplateDir();
  if (isValidReactTemplate(cached)) return cached;
  const bundled = bundledTemplateDir();
  if (bundled && isValidReactTemplate(bundled)) return bundled;
  return cached;
}

let ensureTemplatePromise: Promise<string> | null = null;

async function downloadReactTemplateZip(zipPath: string): Promise<void> {
  logger.info(`[app-dev] downloading react template zip url=${REACT_TEMPLATE_ZIP_URL}`);
  const response = await proxyAwareFetch(REACT_TEMPLATE_ZIP_URL, {
    method: 'GET',
    timeoutMs: 180_000,
  });
  if (!response.ok) {
    throw new Error(`下载应用模板失败: HTTP ${response.status}`);
  }
  const body = response.body;
  if (!body) throw new Error('下载应用模板失败: 响应为空');
  await pipeline(
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(zipPath),
  );
}

/**
 * Ensure the React engineering template is available locally.
 * Primary: download + extract OSS zip into userData cache.
 * Fallback: local resources/app-templates in unpackaged/dev only (never packaged).
 */
async function ensureReactTemplateDir(): Promise<string> {
  if (ensureTemplatePromise) return ensureTemplatePromise;

  ensureTemplatePromise = (async () => {
    const cacheDir = cachedTemplateDir();
    const metaPath = templateMetaPath(cacheDir);

    if (isValidReactTemplate(cacheDir)) {
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { sourceUrl?: string };
        if (meta.sourceUrl === REACT_TEMPLATE_ZIP_URL) {
          logger.info(`[app-dev] using cached react template dir=${cacheDir}`);
          return cacheDir;
        }
        logger.info('[app-dev] cached react template URL changed, refreshing');
      } catch {
        logger.info(`[app-dev] using cached react template dir=${cacheDir}`);
        return cacheDir;
      }
    }

    const stagingRoot = await mkdtemp(join(tmpdir(), 'sclaw-react-template-'));
    const zipPath = join(stagingRoot, 'react-template.zip');
    const extractDir = join(stagingRoot, 'extract');

    try {
      await mkdir(extractDir, { recursive: true });
      await downloadReactTemplateZip(zipPath);
      await extractZip(zipPath, extractDir);

      if (!isValidReactTemplate(extractDir)) {
        throw new Error('应用模板解压后缺少 frontend/package.json');
      }

      await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(dirname(cacheDir), { recursive: true });
      await cp(extractDir, cacheDir, { recursive: true });
      await writeFile(
        metaPath,
        `${JSON.stringify({
          sourceUrl: REACT_TEMPLATE_ZIP_URL,
          fetchedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        'utf8',
      );

      logger.info(`[app-dev] react template ready from OSS cacheDir=${cacheDir}`);
      return cacheDir;
    } catch (error) {
      const bundled = bundledTemplateDir();
      if (bundled && isValidReactTemplate(bundled)) {
        logger.warn(
          `[app-dev] OSS template download failed, falling back to local checkout template: ${bundled}`,
          error,
        );
        return bundled;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`应用模板准备失败（OSS 下载）: ${message}`);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  })();

  try {
    return await ensureTemplatePromise;
  } catch (error) {
    ensureTemplatePromise = null;
    throw error;
  }
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

  const template = await ensureReactTemplateDir();
  if (!isValidReactTemplate(template)) {
    throw new Error(`应用模板缺失: ${template}`);
  }

  logger.info(
    `[app-dev] createUserApp start name=${name} appPath=${appPath} ` +
    `projectType=${input.projectType ?? 'frontend'} template=${template}`,
  );

  await copyTemplate(template, appPath, {
    appName: sanitizePackageName(name),
    appTitle: name,
  });

  await writeAppDevBootstrap(appPath, {
    name,
    projectType: input.projectType ?? 'frontend',
  });

  try {
    await createStoApp(appPath, {
      name,
      description: `${name} 应用`,
      message: `Initial commit: ${name}`,
    });
    logger.info(`[app-dev] sto-app create linked name=${name} appPath=${appPath}`);
  } catch (err) {
    logger.warn(`[app-dev] sto-app create skipped name=${name} appPath=${appPath}:`, err);
  }

  // Ensure openspec exists even if an older template missed it; bake OpenSpec skill.
  try {
    await ensureAppOpenspecScaffold(appPath);
    if (!existsSync(join(appPath, 'openspec', 'skills', 'openspec', 'SKILL.md'))) {
      await installAppDevAssistSkill(appPath, 'openspec');
    } else {
      await syncOpenspecSkillsIntoAgents(appPath);
    }
  } catch (err) {
    logger.warn('[app-dev] openspec scaffold skipped:', err);
  }

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

  logger.info(`[app-dev] createUserApp workspaceReady workspaceId=${workspaceId} appPath=${appPath}`);

  setStatus(workspaceId, { appPath, phase: 'created', progress: 0 });

  // Fire the background pipeline; errors land in status, never thrown to the wizard.
  void runSetupPipeline(workspaceId, appPath).catch((err) => {
    logger.error('[app-dev] setup pipeline failed:', err);
  });

  return { workspaceId, appPath, workspaceName: workspace.name ?? name };
}

/**
 * Import an existing local app folder (换机恢复 / 重新纳入广场).
 * Requires frontend/package.json or an existing .sclaw/app-dev.json marker.
 */
export async function importUserApp(input: {
  appPath: string;
  name?: string;
}): Promise<CreateUserAppResult> {
  const appPath = resolve(input.appPath.trim());
  if (!appPath || !existsSync(appPath) || !statSync(appPath).isDirectory()) {
    throw new Error('请选择有效的应用文件夹');
  }

  const hasFrontend = existsSync(join(appPath, 'frontend', 'package.json'));
  const hasMarker = isAppDevWorkspaceRoot(appPath);
  if (!hasFrontend && !hasMarker) {
    throw new Error('所选文件夹不是可导入的开发应用（需包含 frontend/package.json）');
  }

  let projectType = 'frontend';
  let name = input.name?.trim() || '';
  if (hasMarker) {
    try {
      const raw = JSON.parse(await readFile(appDevMarkerPath(appPath), 'utf8')) as Partial<AppDevMarker>;
      if (typeof raw.projectType === 'string' && raw.projectType.trim()) projectType = raw.projectType.trim();
      if (!name && typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
    } catch {
      // ignore
    }
  }
  if (!name) {
    name = appPath.split(/[/\\]/).filter(Boolean).pop() || '导入应用';
  }

  logger.info(`[app-dev] importUserApp start name=${name} appPath=${appPath}`);

  const existing = (await listUserWorkspaces()).find((w) => resolve(w.rootPath) === appPath);
  const workspaceName = (existing?.name?.trim() || name);

  await writeAppDevBootstrap(appPath, {
    name: workspaceName,
    projectType,
  });
  try {
    await ensureAppOpenspecScaffold(appPath);
    if (!existsSync(join(appPath, 'openspec', 'skills', 'openspec', 'SKILL.md'))) {
      await installAppDevAssistSkill(appPath, 'openspec');
    } else {
      await syncOpenspecSkillsIntoAgents(appPath);
    }
  } catch (err) {
    logger.warn(`[app-dev] openspec scaffold on import skipped appPath=${appPath}:`, err);
  }

  const workspace = existing ?? await createWorkspace({
    name: workspaceName,
    rootPath: appPath,
  });
  const workspaceId: string = workspace.id;

  logger.info(
    `[app-dev] importUserApp workspaceReady workspaceId=${workspaceId} appPath=${appPath} ` +
    `reused=${Boolean(existing)}`,
  );

  setStatus(workspaceId, { appPath, phase: 'created', progress: 0 });
  void runSetupPipeline(workspaceId, appPath).catch((err) => {
    logger.error('[app-dev] setup pipeline failed after import:', err);
  });

  return { workspaceId, appPath, workspaceName: workspace.name ?? workspaceName };
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

/**
 * Remove a 开发应用 from the catalog. Optionally delete the project directory on disk.
 * Files are only removed when the path still has the app-dev marker (safety).
 */
export async function deleteDevApp(
  workspaceId: string,
  options: { deleteFiles?: boolean } = {},
  gatewayManager?: GatewayManager | null,
): Promise<{ deletedFiles: boolean; appPath: string }> {
  const id = workspaceId.trim();
  if (!id) throw new Error('缺少 workspaceId');

  const { getWorkspaceRootPath } = await import('./session-catalog-service');
  const appPath = await getWorkspaceRootPath(id);
  if (!appPath) throw new Error(`Workspace not found: ${id}`);
  if (!isAppDevWorkspaceRoot(appPath)) {
    throw new Error('不是开发应用，无法从此处删除');
  }

  stopApp(id);
  statuses.delete(id);

  await deleteWorkspace(id, gatewayManager);

  let deletedFiles = false;
  if (options.deleteFiles) {
    const resolved = resolve(appPath);
    const forbidden = new Set([
      resolve('/'),
      resolve(homedir()),
      resolve(DEFAULT_APPS_PARENT_DIR),
    ]);
    if (forbidden.has(resolved) || resolved.length < 12) {
      throw new Error('拒绝删除危险路径；应用记录已移除，文件请手动处理');
    }
    // Marker must still be present — avoids wiping a path that was swapped out.
    if (!isAppDevWorkspaceRoot(resolved)) {
      throw new Error('应用目录标记已不存在，已跳过删文件以免误删');
    }
    await rm(resolved, { recursive: true, force: true });
    deletedFiles = true;
    logger.info(`[app-dev] deleted app files at ${resolved}`);
  }

  return { deletedFiles, appPath };
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

// ── Source file browsing / edit (workbench Monaco) ──────────────────────────

const SOURCE_SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

const SOURCE_MAX_BYTES = 1_000_000;
const SOURCE_MAX_FILES = 400;

const SOURCE_TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.less',
  '.html', '.htm', '.md', '.mdx',
  '.txt', '.svg', '.yml', '.yaml', '.toml',
  '.env', '.gitignore', '.npmrc',
]);

export interface AppSourceFileEntry {
  path: string;
  size: number;
}

function assertPathInsideApp(appPath: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error('非法文件路径');
  }
  const appRoot = resolve(appPath);
  const full = resolve(appRoot, normalized);
  const prefix = appRoot.endsWith(sep) ? appRoot : `${appRoot}${sep}`;
  if (full !== appRoot && !full.startsWith(prefix)) {
    throw new Error('文件路径超出应用目录');
  }
  return full;
}

function isEditableSourceFile(fileName: string): boolean {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const lower = base.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.')) return true;
  if (lower === 'dockerfile' || lower === 'makefile') return true;
  return SOURCE_TEXT_EXTS.has(extname(lower));
}

async function walkSourceFiles(
  dir: string,
  appRoot: string,
  out: AppSourceFileEntry[],
): Promise<void> {
  if (out.length >= SOURCE_MAX_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= SOURCE_MAX_FILES) return;
    if (entry.name === '.' || entry.name === '..') continue;
    if (entry.name.startsWith('.') && entry.name !== '.npmrc' && entry.name !== '.gitignore' && !entry.name.startsWith('.env')) {
      // Keep common config; skip other dotdirs like .sclaw from the editor tree.
      if (entry.isDirectory()) continue;
      if (!isEditableSourceFile(entry.name)) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SOURCE_SKIP_DIR_NAMES.has(entry.name)) continue;
      await walkSourceFiles(full, appRoot, out);
      continue;
    }
    if (!entry.isFile() || !isEditableSourceFile(entry.name)) continue;
    try {
      const info = await stat(full);
      if (info.size > SOURCE_MAX_BYTES) continue;
      out.push({
        path: relative(appRoot, full).replace(/\\/g, '/'),
        size: info.size,
      });
    } catch {
      // skip unreadable
    }
  }
}

export async function listAppSourceFiles(appPath: string): Promise<AppSourceFileEntry[]> {
  if (!existsSync(appPath) || !statSync(appPath).isDirectory()) {
    throw new Error('应用目录不存在');
  }
  const out: AppSourceFileEntry[] = [];
  await walkSourceFiles(appPath, resolve(appPath), out);
  return out;
}

export async function readAppSourceFile(
  appPath: string,
  relativePath: string,
): Promise<{ path: string; content: string }> {
  const full = assertPathInsideApp(appPath, relativePath);
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new Error('文件不存在');
  }
  const info = await stat(full);
  if (info.size > SOURCE_MAX_BYTES) {
    throw new Error('文件过大，无法在编辑器中打开');
  }
  const content = await readFile(full, 'utf8');
  return { path: relativePath.replace(/\\/g, '/').replace(/^\/+/, ''), content };
}

export async function writeAppSourceFile(
  appPath: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  if (typeof content !== 'string') throw new Error('内容无效');
  if (Buffer.byteLength(content, 'utf8') > SOURCE_MAX_BYTES) {
    throw new Error('内容过大，无法保存');
  }
  const full = assertPathInsideApp(appPath, relativePath);
  if (!isEditableSourceFile(full)) {
    throw new Error('不支持编辑该类型文件');
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  return {
    path: relativePath.replace(/\\/g, '/').replace(/^\/+/, ''),
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

export interface AppSourceSearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

const SOURCE_SEARCH_MAX_HITS = 200;

export async function searchAppSourceFiles(
  appPath: string,
  query: string,
): Promise<AppSourceSearchHit[]> {
  const needle = query.trim();
  if (!needle) return [];
  if (needle.length > 200) throw new Error('搜索词过长');

  const files = await listAppSourceFiles(appPath);
  const hits: AppSourceSearchHit[] = [];
  const lowerNeedle = needle.toLowerCase();

  for (const file of files) {
    if (hits.length >= SOURCE_SEARCH_MAX_HITS) break;
    let content = '';
    try {
      const full = assertPathInsideApp(appPath, file.path);
      content = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= SOURCE_SEARCH_MAX_HITS) break;
      const lineText = lines[i] ?? '';
      const idx = lineText.toLowerCase().indexOf(lowerNeedle);
      if (idx < 0) continue;
      hits.push({
        path: file.path,
        line: i + 1,
        column: idx + 1,
        preview: lineText.trim().slice(0, 200),
      });
    }
  }
  return hits;
}

// ── Community skill package install ─────────────────────────────────────────

const NPM_PACKAGE_RE =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[\w.^~*|<>=-]+)?$/i;
const PIP_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:[<>=!~]=?[A-Za-z0-9._*-]+)?$/;

function assertNpmPackageName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 180 || !NPM_PACKAGE_RE.test(name)) {
    throw new Error(`非法的 npm 包名: ${raw}`);
  }
  return name;
}

function assertPipPackageName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 120 || !PIP_PACKAGE_RE.test(name)) {
    throw new Error(`非法的 Python 包名: ${raw}`);
  }
  return name;
}

function collectSpawnOutput(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; shell?: boolean },
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      windowsHide: true,
    });
    const chunks: string[] = [];
    const onData = (chunk: unknown) => {
      chunks.push(String(chunk));
      if (chunks.length > 80) chunks.shift();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ ok: code === 0, output: chunks.join('').trim() });
    });
  });
}

async function ensureRequirementsLine(requirementsPath: string, packageName: string): Promise<void> {
  const baseName = packageName.split(/[<>=!~]/)[0]?.trim() || packageName;
  let existing = '';
  if (existsSync(requirementsPath)) {
    existing = await readFile(requirementsPath, 'utf8');
  }
  const lines = existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const already = lines.some((line) => {
    const name = line.split(/[<>=!~]/)[0]?.trim().toLowerCase();
    return name === baseName.toLowerCase();
  });
  if (already) return;
  const next = `${lines.concat(packageName).join('\n')}\n`;
  await mkdir(dirname(requirementsPath), { recursive: true });
  await writeFile(requirementsPath, next, 'utf8');
}

/** Install a frontend npm package into `frontend/` with `--save`. */
export async function installNpmPackage(
  appPath: string,
  packageNameRaw: string,
): Promise<{ packageName: string; output: string }> {
  const packageName = assertNpmPackageName(packageNameRaw);
  const frontendDir = join(appPath, 'frontend');
  if (!existsSync(join(frontendDir, 'package.json'))) {
    throw new Error('未找到 frontend/package.json，无法安装前端组件包');
  }

  if (!isNodeRuntimeReady()) {
    await setupManagedNode();
  }

  const { npmBin } = getManagedNodePaths();
  const result = await collectSpawnOutput(
    npmBin,
    ['install', packageName, '--save', '--no-audit', '--no-fund'],
    { cwd: frontendDir, env: getNodeSpawnEnv() as NodeJS.ProcessEnv },
  );
  if (!result.ok) {
    throw new Error(`npm install ${packageName} 失败\n${result.output}`);
  }
  return { packageName, output: result.output };
}

/**
 * Install a Python package into `backend/` via bundled uv:
 * create `.venv` if needed, `uv pip install`, and append to requirements.txt.
 */
export async function installPipPackage(
  appPath: string,
  packageNameRaw: string,
): Promise<{ packageName: string; output: string }> {
  const packageName = assertPipPackageName(packageNameRaw);
  const backendDir = join(appPath, 'backend');
  await mkdir(backendDir, { recursive: true });

  await setupManagedPython();
  const { bin: uvBin } = resolveUvBin();
  const useShell = needsWinShell(uvBin);
  const uvCmd = useShell ? quoteForCmd(uvBin) : uvBin;
  const mirrorEnv = await getUvMirrorEnv();
  const env = { ...process.env, ...mirrorEnv } as NodeJS.ProcessEnv;

  const venvDir = join(backendDir, '.venv');
  if (!existsSync(venvDir)) {
    const venv = await collectSpawnOutput(uvCmd, ['venv', '.venv', '--python', '3.12'], {
      cwd: backendDir,
      env,
      shell: useShell,
    });
    if (!venv.ok) {
      throw new Error(`创建 Python 虚拟环境失败\n${venv.output}`);
    }
  }

  const install = await collectSpawnOutput(
    uvCmd,
    ['pip', 'install', packageName, '--python', '.venv'],
    { cwd: backendDir, env, shell: useShell },
  );
  if (!install.ok) {
    throw new Error(`pip install ${packageName} 失败\n${install.output}`);
  }

  await ensureRequirementsLine(join(backendDir, 'requirements.txt'), packageName);
  return { packageName, output: install.output };
}

// ── OpenSpec / 开发辅助 skills（来自工程模板，不单独挂在 SClaw 仓库）──

const OPENSPEC_SKILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface AppDevAssistSkill {
  id: string;
  name: string;
  description: string;
  installed: boolean;
}

/** Skill catalog lives in the user-app engineering template (and is copied into each app). */
function appOpenspecCatalogRoot(appPath: string): string {
  const inApp = join(appPath, 'openspec', 'skill-catalog');
  if (existsSync(join(inApp, 'manifest.json'))) return inApp;
  return join(templateDir(), 'openspec', 'skill-catalog');
}

function assertOpenspecSkillId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!OPENSPEC_SKILL_ID_RE.test(id) || id.startsWith('_')) {
    throw new Error(`非法的开发技能标识: ${raw}`);
  }
  return id;
}

async function ensureAppOpenspecScaffold(appPath: string): Promise<void> {
  const openspecDir = join(appPath, 'openspec');
  const templateOpenspec = join(templateDir(), 'openspec');
  await mkdir(join(openspecDir, 'skills'), { recursive: true });
  await mkdir(join(openspecDir, 'changes'), { recursive: true });
  await mkdir(join(openspecDir, 'specs'), { recursive: true });

  for (const name of ['README.md', 'config.yaml'] as const) {
    const dest = join(openspecDir, name);
    const src = join(templateOpenspec, name);
    if (!existsSync(dest) && existsSync(src)) {
      await cp(src, dest);
    }
  }

  // Older apps may lack skill-catalog; copy from engineering template once.
  const catalogDest = join(openspecDir, 'skill-catalog');
  const catalogSrc = join(templateOpenspec, 'skill-catalog');
  if (!existsSync(join(catalogDest, 'manifest.json')) && existsSync(join(catalogSrc, 'manifest.json'))) {
    await cp(catalogSrc, catalogDest, { recursive: true });
  }
}

async function syncOpenspecSkillsIntoAgents(appPath: string): Promise<void> {
  const skillsDir = join(appPath, 'openspec', 'skills');
  const agentsPath = join(appPath, '.sclaw', 'AGENTS.md');
  if (!existsSync(agentsPath) || !existsSync(skillsDir)) return;

  let installed: string[] = [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    installed = entries
      .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return;
  }

  const blockStart = '<!-- sclaw-openspec-skills -->';
  const blockEnd = '<!-- /sclaw-openspec-skills -->';
  const block = installed.length === 0
    ? `${blockStart}\n<!-- 暂无已安装的 openspec 开发技能 -->\n${blockEnd}`
    : [
      blockStart,
      '## 已安装的 OpenSpec 开发技能',
      ...installed.map((id) => `- \`openspec/skills/${id}/SKILL.md\``),
      '开发新功能或跨模块改动时，请先阅读上述技能，并按 OpenSpec 流程推进。',
      blockEnd,
    ].join('\n');

  let content = await readFile(agentsPath, 'utf8');
  const start = content.indexOf(blockStart);
  const end = content.indexOf(blockEnd);
  if (start >= 0 && end > start) {
    content = `${content.slice(0, start)}${block}${content.slice(end + blockEnd.length)}`;
  } else {
    content = `${content.trimEnd()}\n\n${block}\n`;
  }
  await writeFile(agentsPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

export async function listAppDevAssistSkills(appPath: string): Promise<AppDevAssistSkill[]> {
  const catalogRoot = appOpenspecCatalogRoot(appPath);
  const manifestPath = join(catalogRoot, 'manifest.json');
  if (!existsSync(manifestPath)) return [];

  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    skills?: Array<{ id?: string; name?: string; description?: string }>;
  };
  const catalog = Array.isArray(raw.skills) ? raw.skills : [];
  const installedDir = join(appPath, 'openspec', 'skills');

  return catalog
    .filter((item) => typeof item.id === 'string' && item.id.trim())
    .map((item) => {
      const id = String(item.id).trim();
      return {
        id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
        description: typeof item.description === 'string' ? item.description : '',
        installed: existsSync(join(installedDir, id, 'SKILL.md')),
      };
    });
}

/** Enable a catalog skill into the app's openspec/skills/<id> (same app tree). */
export async function installAppDevAssistSkill(
  appPath: string,
  skillIdRaw: string,
): Promise<{ skillId: string; targetPath: string }> {
  const skillId = assertOpenspecSkillId(skillIdRaw);
  await ensureAppOpenspecScaffold(appPath);

  const sourceDir = join(appOpenspecCatalogRoot(appPath), skillId);
  const skillMd = join(sourceDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error(`工程模板中未找到开发技能: ${skillId}`);
  }

  const targetDir = join(appPath, 'openspec', 'skills', skillId);
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  await syncOpenspecSkillsIntoAgents(appPath);

  return { skillId, targetPath: join('openspec', 'skills', skillId) };
}


