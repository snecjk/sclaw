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
import { cloneStoApp } from './sto-app-service';
import {
  createCodeApplication,
  waitForActiveCodeApplication,
} from './code-collab-service';
import {
  listCodeApplications,
  offlineCodeApplication,
  resolveCodeApplicationPolicyOrigin,
} from './code-application-api';
import {
  getStoAppBindingByWorkspaceId,
  listStoAppBindings,
  removeStoAppBinding,
  removeStoAppBindingByWorkspaceId,
  upsertStoAppBinding,
} from './sto-app-binding-store';
import { writeStoWorkspaceBinding } from './sto-workspace-store';
import type { CodeApplicationRecord } from '../../shared/code-application-catalog';
import {
  STO_WORKSPACE_RELATIVE,
  codeApplicationToWorkspaceFields,
} from '../../shared/sto-workspace';

/** Remote React A2UI template (OSS). Dev prefers repo checkout; packaged uses OSS cache. */
const REACT_TEMPLATE_ZIP_URL =
  'http://ali-sto-tps.oss-cn-shanghai.aliyuncs.com/3EC02BDE-19C8-46-react-a2ui-template.zip';

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
  /** Empty when remote-only / path-missing (cannot open workbench yet). */
  workspaceId: string;
  name: string;
  appPath: string;
  projectType: string;
  createdAt: string;
  /** Local path exists and marker is present. */
  localReady: boolean;
  applicationId?: string;
  /** Cloud list authority states for this device. */
  availability: 'local' | 'remote-only' | 'path-missing';
  /** Cloud preview page URL from code-applications list. */
  previewUrl?: string;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  listError?: string;
}

export function appDevMarkerPath(appPath: string): string {
  return join(appPath, APP_DEV_MARKER_RELATIVE);
}

export function isAppDevWorkspaceRoot(appPath: string): boolean {
  return existsSync(appDevMarkerPath(appPath));
}

function hasStoWorkspaceFile(appPath: string): boolean {
  return existsSync(join(appPath, STO_WORKSPACE_RELATIVE));
}

async function readAppDevMarkerFields(appPath: string): Promise<{
  projectType: string;
  createdAt: string;
  name?: string;
}> {
  let projectType = 'frontend';
  let createdAt = '';
  let name: string | undefined;
  try {
    const raw = JSON.parse(await readFile(appDevMarkerPath(appPath), 'utf8')) as Partial<AppDevMarker>;
    if (typeof raw.projectType === 'string' && raw.projectType.trim()) projectType = raw.projectType.trim();
    if (typeof raw.createdAt === 'string' && raw.createdAt.trim()) createdAt = raw.createdAt;
    if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
  } catch {
    // ignore
  }
  return { projectType, createdAt, name };
}

/** Local marker workspaces that are not already represented by a cloud list row. */
export async function listLocalOnlyDevApps(input: {
  workspaces: Array<{ id: string; name?: string; rootPath: string; createdAt?: string }>;
  claimedWorkspaceIds: Iterable<string>;
  claimedPaths: Iterable<string>;
}): Promise<DevAppSummary[]> {
  const claimedIds = new Set(input.claimedWorkspaceIds);
  const claimedRoots = new Set(
    [...input.claimedPaths].map((path) => resolve(path)),
  );
  const apps: DevAppSummary[] = [];
  for (const workspace of input.workspaces) {
    const root = workspace.rootPath?.trim();
    if (!root) continue;
    const resolvedRoot = resolve(root);
    if (claimedIds.has(workspace.id) || claimedRoots.has(resolvedRoot)) continue;
    if (!existsSync(resolvedRoot) || !isAppDevWorkspaceRoot(resolvedRoot)) continue;
    const fields = await readAppDevMarkerFields(resolvedRoot);
    apps.push({
      workspaceId: workspace.id,
      name: fields.name || workspace.name || resolvedRoot.split(/[/\\]/).filter(Boolean).pop() || '导入应用',
      appPath: resolvedRoot,
      projectType: fields.projectType,
      createdAt: fields.createdAt || workspace.createdAt || new Date().toISOString(),
      localReady: true,
      availability: 'local',
    });
  }
  return apps;
}

async function stoWorkspaceRegistryUrl(): Promise<string> {
  return resolveCodeApplicationPolicyOrigin();
}


/**
 * App files deleted but workspace row left behind: root only has `.sclaw`
 * (artifact/agent shell). Still treat as 开发应用 for sidebar filtering.
 */
async function isAbandonedAppDevShell(appPath: string): Promise<boolean> {
  if (!appPath || !existsSync(appPath) || !statSync(appPath).isDirectory()) return false;
  if (!existsSync(join(appPath, '.sclaw'))) return false;
  try {
    const entries = (await readdir(appPath)).filter((name) => name !== '.DS_Store');
    return entries.length === 1 && entries[0] === '.sclaw';
  } catch {
    return false;
  }
}

function buildAppDevAgentsContextBlock(vars: { name: string }): string {
  return `<!-- sclaw-app-dev-context -->
你正在帮助用户开发一个名为「${vars.name}」的业务应用（SClaw 开发应用）。

## 项目结构
- \`src/pages/\`：A2UI 页面资产（**主战场**，优先修改）
- \`contracts/\`：action / intent 契约（Button 的 action 名必须已注册）
- \`docs/api/\`：公司接口文档（Markdown），调用接口前先阅读这里
- \`src/runtime/\`：页面加载与 Action Runtime（平台壳，默认不要改）
- \`src/App.tsx\`：A2UI 宿主壳，**默认不要改**；**禁止**在业务预览里展示 Action Runtime / 开发者调试日志（调试日志应由 SClaw 工作台单独一列展示，不在应用页面内）
- 工程构建对齐公司发布平台：\`npm run build\` 产物在 \`build/\`；不要改 \`outDir\` 或随意升级 rollup（模板已锁定）
- \`openspec/\`：本应用的 OpenSpec；**不是** SClaw 客户端仓库

## 工作方式
- 用户是业务人员，用自然语言描述需求；不要要求他们写代码或看终端日志
- 预览面向业务用户：只展示业务页面；不要加「Action Runtime」「当前页 #id」「改 page.json」等开发说明
- **优先修改 \`src/pages/*.page.json\` 与 \`contracts/\`**；预览由 A2UI 渲染器驱动
- 禁止把业务页面写成自由 React JSX
- 组件：查询/列表/表格/分页页 **必须** 使用 antd Catalog（\`catalogId: "antd"\`）组件：\`AntdFilterBar\`、\`AntdTable\`、\`AntdPagination\`、\`AntdButton\`、\`AntdStack\`、\`AntdText\`
- 用户即使不提 antd，只要需求是「查询条件 + 表格 + 分页」，也要优先用上述组件；参考 \`src/pages/customer-list.page.json\`
- 同一 surface 不要混用 basic 的 Column/Text 与 Antd*（一个 surface 一个 catalogId）
- page JSON 必须是 A2UI v0.9 消息数组（createSurface / updateComponents / updateDataModel），不要编造 \`{ type, props }\` 伪格式
- 交互通过 actionId：先改 \`contracts/action-registry.v1.json\`，再在页面 Button/Filter 上引用
- 多页面：新增 \`src/pages/<id>.page.json\` 后还要在 \`src/runtime/page-loader.ts\` 注册
- 优先使用公司接口文档；不确定时先查 \`docs/api/\`；页面里用 actionId，不写死后端 URL
- 新功能或跨模块改动：先读 \`openspec/skills/\`，再按 OpenSpec（proposal → design → specs → tasks → apply）推进
- 保持页面简洁可用；改动后用简短中文说明「改了什么、用户会看到什么」
- 不要提交密钥到代码里；鉴权方式以接口文档为准

## 自然语言建页与接口（强制）
- 用户用自然语言生成页面时：若页面**需要调业务接口**（查询/列表/看板取数等），且用户**尚未指定**要用的 sai-cli 指令或接口：
  - **先引导用户指定 CLI 接口**，再生成并绑定真实取数；未指定前不要臆造 URL / 命令路径去接真接口
  - 引导话术示例：「这个页面需要接业务数据。请告诉我要用哪条 sai-cli 指令（例如：一口价运费查询），指定后我再按该指令的参数和字段生成搜索/列表。」
  - 若用户说不清命令名，可协助执行 \`sai-cli discover "<业务词>"\`，把结果列出来**请用户指定一条**；仍以用户指定为准
- 用户已指定 CLI 后：\`sai-cli help\` → 若有绝对 HTTP 地址，先执行 \`node scripts/ensure-dev-proxy.mjs "<绝对URL>"\`，把输出的 \`relativeUrl\`（\`/proxy/<key>/...\`）写入 action-registry 或页面；**禁止**页面直连 \`https://*.sto.cn\`（本地 CORS）
- 取数约定：代码里统一写 \`/proxy/<key>/...\`；**开发**由 Vite proxy 转发，**生产**由 \`src/lib/request.ts\` 按 \`contracts/dev-proxy.v1.json\` 还原为真实域名（禁止把 \`/proxy\` 当生产静态路径）
- 预览出现 CORS/直连失败：对报错 URL 再跑 ensure-dev-proxy，改 url 为 relativeUrl，并重启预览
- 生产 Network 若仍请求 \`https://page-*.sto.cn/proxy/...\`：检查是否未走 request 封装或缺 proxy 合约 key
- 用户明确只要布局、先不接真接口：可用 mock 出页，并说明稍后指定 CLI 再接入
- 详细步骤见 \`openspec/skills/nl-page-from-sai/SKILL.md\`（若已启用）
<!-- /sclaw-app-dev-context -->`;
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

  const agentsPath = join(sclawDir, 'AGENTS.md');
  const contextBlock = buildAppDevAgentsContextBlock({ name: vars.name });
  if (existsSync(agentsPath)) {
    let content = await readFile(agentsPath, 'utf8');
    const start = content.indexOf('<!-- sclaw-app-dev-context -->');
    const end = content.indexOf('<!-- /sclaw-app-dev-context -->');
    if (start >= 0 && end > start) {
      content = `${content.slice(0, start)}${contextBlock}${content.slice(end + '<!-- /sclaw-app-dev-context -->'.length)}`;
    } else {
      content = `${content.trimEnd()}\n\n${contextBlock}\n`;
    }
    await writeFile(agentsPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  } else {
    await writeFile(agentsPath, `# ${vars.name}\n\n${contextBlock}\n`, 'utf8');
  }
}

/**
 * Ensure marker + AGENTS.md context exist (self-heal after OpenClaw seed overwrite).
 * Always refreshes the sclaw-app-dev-context block so anti-hallucination rules stay current.
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

  await writeAppDevBootstrap(appPath, { name, projectType });
  await ensureAppOpenspecScaffold(appPath);
  await ensureDefaultAppDevAssistSkills(appPath);
  // Refresh already-enabled package skills from updated catalog copy.
  try {
    const skillsDir = join(appPath, 'openspec', 'skills');
    const catalogRoot = appOpenspecCatalogRoot(appPath);
    if (existsSync(skillsDir)) {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('pkg-') && entry.name !== 'nl-page-from-sai') continue;
        const src = join(catalogRoot, entry.name);
        if (existsSync(join(src, 'SKILL.md'))) {
          await cp(src, join(skillsDir, entry.name), { recursive: true });
        }
      }
      await syncOpenspecSkillsIntoAgents(appPath);
    }
  } catch {
    // best-effort
  }
}

/** Single-package (root package.json + src) or legacy monorepo (frontend/package.json). */
function isValidReactTemplate(dir: string): boolean {
  if (existsSync(join(dir, 'frontend', 'package.json'))) return true;
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'));
}

function resolveLocalReactTemplateDir(): string | null {
  const candidates = [
    join(process.cwd(), 'resources', 'app-templates', 'react-a2ui-template'),
    join(app.getAppPath(), 'resources', 'app-templates', 'react-a2ui-template'),
    join(process.resourcesPath, 'app-templates', 'react-a2ui-template'),
  ];
  for (const dir of candidates) {
    if (isValidReactTemplate(dir)) return dir;
  }
  return null;
}

function cachedTemplateDir(): string {
  return join(app.getPath('userData'), 'app-templates', 'react-a2ui-template');
}

/** npm / vite cwd for a user app (root package or legacy frontend/). */
export function resolveAppNpmCwd(appPath: string): string {
  if (existsSync(join(appPath, 'package.json'))) return appPath;
  const frontendDir = join(appPath, 'frontend');
  if (existsSync(join(frontendDir, 'package.json'))) return frontendDir;
  throw new Error('未找到 package.json（应用根或 frontend/）');
}

function templateMetaPath(dir: string): string {
  return join(dir, '.sclaw-template-meta.json');
}

/** Sync path for OpenSpec helpers: dev prefers local checkout, else OSS cache. */
function templateDir(): string {
  if (!app.isPackaged) {
    const local = resolveLocalReactTemplateDir();
    if (local) return local;
  }
  return cachedTemplateDir();
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
 * Dev (unpackaged): prefer repo `resources/app-templates/react-a2ui-template`, else OSS.
 * Packaged: download/cache OSS zip (refreshed when URL changes).
 */
async function ensureReactTemplateDir(): Promise<string> {
  if (ensureTemplatePromise) return ensureTemplatePromise;

  ensureTemplatePromise = (async () => {
    if (!app.isPackaged) {
      const local = resolveLocalReactTemplateDir();
      if (local) {
        logger.info(`[app-dev] using local A2UI template dir=${local}`);
        return local;
      }
      logger.info('[app-dev] local A2UI template missing, falling back to OSS');
    }

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

    const stagingRoot = await mkdtemp(join(tmpdir(), 'sclaw-react-a2ui-template-'));
    const zipPath = join(stagingRoot, 'react-a2ui-template.zip');
    const extractDir = join(stagingRoot, 'extract');

    try {
      await mkdir(extractDir, { recursive: true });
      await downloadReactTemplateZip(zipPath);
      await extractZip(zipPath, extractDir);

      const top = await readdir(extractDir, { withFileTypes: true });
      const resolvedExtract =
        top.length === 1 && top[0].isDirectory() ? join(extractDir, top[0].name) : extractDir;

      if (!isValidReactTemplate(resolvedExtract)) {
        throw new Error('应用模板解压后缺少 package.json+src 或 frontend/package.json');
      }

      await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(dirname(cacheDir), { recursive: true });
      await cp(resolvedExtract, cacheDir, { recursive: true });
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
      if (!app.isPackaged) {
        const local = resolveLocalReactTemplateDir();
        if (local) {
          logger.warn(
            `[app-dev] OSS template download failed, falling back to local checkout: ${local}`,
            error,
          );
          return local;
        }
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

/** New apps get `.env` from `.env.example` so Vite SSO proxy/env vars load on first preview. */
async function ensureAppEnvFromExample(appPath: string): Promise<void> {
  const envPath = join(appPath, '.env');
  if (existsSync(envPath)) return;
  const examplePath = join(appPath, '.env.example');
  if (!existsSync(examplePath)) return;
  await cp(examplePath, envPath);
  logger.info(`[app-dev] seeded .env from .env.example appPath=${appPath}`);
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

  const parentDir = (input.parentDir?.trim() || DEFAULT_APPS_PARENT_DIR);
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

  await ensureAppEnvFromExample(appPath);

  await writeAppDevBootstrap(appPath, {
    name,
    projectType: input.projectType ?? 'frontend',
  });

  let createdApplicationId: string | undefined;
  const created = await createCodeApplication({
    applicationName: name,
    description: `${name} 应用`,
  });
  const active = created.status?.trim().toUpperCase() === 'ACTIVE'
    ? created
    : await waitForActiveCodeApplication(created.applicationId);
  createdApplicationId = active.applicationId;
  logger.info(
    `[app-dev] code-application create linked name=${name} appPath=${appPath} ` +
    `applicationId=${createdApplicationId} status=${active.status ?? '-'}`,
  );
  const workspaceFile = await writeStoWorkspaceBinding({
    appPath,
    registryUrl: await stoWorkspaceRegistryUrl(),
    cloud: codeApplicationToWorkspaceFields(active),
    fallback: { applicationId: createdApplicationId, status: 'ACTIVE' },
  });
  if (!workspaceFile) {
    throw new Error('云端应用已创建，但未能写入 .sto/workspace.json');
  }

  // Ensure openspec exists even if an older template missed it; bake default assist skills.
  try {
    await ensureAppOpenspecScaffold(appPath);
    await ensureDefaultAppDevAssistSkills(appPath);
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

  await upsertStoAppBinding({
    applicationId: createdApplicationId,
    applicationName: name,
    localPath: appPath,
    workspaceId,
  }).catch((err) => logger.warn('[app-dev] binding upsert after create failed:', err));

  logger.info(`[app-dev] createUserApp workspaceReady workspaceId=${workspaceId} appPath=${appPath}`);

  setStatus(workspaceId, { appPath, phase: 'created', progress: 0 });

  // Fire the background pipeline; errors land in status, never thrown to the wizard.
  void runSetupPipeline(workspaceId, appPath).catch((err) => {
    logger.error('[app-dev] setup pipeline failed:', err);
  });

  return { workspaceId, appPath, workspaceName: workspace.name ?? name };
}

/**
 * Import an existing local app folder into 开发应用.
 * Local-only: does not create a cloud code-application, upload source, or publish.
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
  const hasRootPackage = existsSync(join(appPath, 'package.json')) && existsSync(join(appPath, 'src'));
  const hasMarker = isAppDevWorkspaceRoot(appPath);
  if (!hasFrontend && !hasRootPackage && !hasMarker) {
    throw new Error('所选文件夹不是可导入的开发应用（需包含 package.json+src 或 frontend/package.json）');
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
    await ensureDefaultAppDevAssistSkills(appPath);
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

/** List development apps: cloud apps plus local-only imports (no submit/publish). */
export async function listDevApps(): Promise<DevAppSummary[]> {
  let listed: CodeApplicationRecord[] = [];
  try {
    listed = await listCodeApplications();
  } catch (error) {
    logger.warn('[app-dev] listDevApps cloud list failed, showing local apps only:', error);
  }

  const bindings = await listStoAppBindings();
  const bindingById = new Map(bindings.map((b) => [b.applicationId, b]));
  const workspaces = await listUserWorkspaces();
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]));
  const claimedWorkspaceIds = new Set<string>();
  const claimedPaths = new Set<string>();

  const apps: DevAppSummary[] = [];
  for (const cloud of listed) {
    const binding = bindingById.get(cloud.applicationId);
    let localPath = binding?.localPath?.trim() ?? '';
    let workspaceId = binding?.workspaceId?.trim() ?? '';

    // Heal binding from workspace path if missing but workspace still points here.
    if ((!localPath || !existsSync(localPath)) && workspaceId) {
      const ws = workspaceById.get(workspaceId);
      if (ws?.rootPath && existsSync(ws.rootPath)) {
        localPath = ws.rootPath;
      }
    }

    // Only auto-match local folders that already have a STO workspace file.
    // Imported apps must stay local-only and must not bind by name.
    if (!localPath) {
      const match = workspaces.find((w) => {
        if (!isAppDevWorkspaceRoot(w.rootPath) || !hasStoWorkspaceFile(w.rootPath)) return false;
        return w.name === cloud.applicationName || w.rootPath.endsWith(`${sep}${cloud.applicationName}`);
      });
      if (match) {
        localPath = match.rootPath;
        workspaceId = match.id;
      }
    }

    const pathOk = Boolean(localPath) && existsSync(localPath);
    const markerOk = pathOk && isAppDevWorkspaceRoot(localPath);
    if (workspaceId) claimedWorkspaceIds.add(workspaceId);
    if (pathOk) claimedPaths.add(resolve(localPath));
    if (pathOk && workspaceId) {
      await upsertStoAppBinding({
        applicationId: cloud.applicationId,
        applicationName: cloud.applicationName,
        localPath,
        workspaceId,
      }).catch(() => undefined);
    }
    if (pathOk && markerOk && workspaceId) {
      const fields = await readAppDevMarkerFields(localPath);
      const ws = workspaceById.get(workspaceId);
      apps.push({
        workspaceId,
        name: cloud.applicationName || ws?.name || cloud.applicationId,
        appPath: localPath,
        projectType: fields.projectType,
        createdAt: fields.createdAt || cloud.createdAt || ws?.createdAt || new Date().toISOString(),
        localReady: true,
        applicationId: cloud.applicationId,
        availability: 'local',
        previewUrl: cloud.previewUrl,
        gitlabProjectId: cloud.gitlabProjectId,
        devopsApplicationId: cloud.devopsApplicationId,
      });
      continue;
    }

      apps.push({
        workspaceId: workspaceId || '',
        name: cloud.applicationName,
        appPath: localPath || '',
        projectType: 'frontend',
        createdAt: cloud.createdAt || binding?.updatedAt || new Date().toISOString(),
        localReady: false,
        applicationId: cloud.applicationId,
        availability: pathOk ? 'path-missing' : 'remote-only',
        previewUrl: cloud.previewUrl,
        gitlabProjectId: cloud.gitlabProjectId,
        devopsApplicationId: cloud.devopsApplicationId,
      });
    }

  apps.push(...await listLocalOnlyDevApps({
    workspaces,
    claimedWorkspaceIds,
    claimedPaths,
  }));

  const sorted = apps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  logger.info(
    `[app-dev] listDevApps count=${sorted.length} apps=${JSON.stringify(
      sorted.map((app) => ({
        name: app.name,
        applicationId: app.applicationId,
        availability: app.availability,
        localReady: app.localReady,
        workspaceId: app.workspaceId,
      })),
    )}`,
  );
  return sorted;
}

/** Resolve cloud code-application for a local workspace via binding, then list name/path. */
export async function resolveCloudAppForWorkspace(
  workspaceId: string,
  appPath?: string,
): Promise<CodeApplicationRecord | null> {
  const id = workspaceId.trim();
  if (!id) return null;

  const listed = await listCodeApplications().catch(() => [] as CodeApplicationRecord[]);
  if (listed.length === 0) return null;

  const binding = await getStoAppBindingByWorkspaceId(id);
  if (binding?.applicationId) {
    const matched = listed.find((item) => item.applicationId === binding.applicationId);
    if (matched) return matched;
  }

  const workspaces = await listUserWorkspaces();
  const workspace = workspaces.find((item) => item.id === id);
  const path = (appPath || workspace?.rootPath || '').trim();
  const matched = listed.find((item) => {
    if (!path || !hasStoWorkspaceFile(path)) return false;
    if (workspace?.name && item.applicationName === workspace.name) return true;
    return Boolean(item.applicationName && path.endsWith(`${sep}${item.applicationName}`));
  }) ?? null;

  if (matched && path && existsSync(path)) {
    await upsertStoAppBinding({
      applicationId: matched.applicationId,
      applicationName: matched.applicationName,
      localPath: path,
      workspaceId: id,
    }).catch(() => undefined);
  }

  return matched;
}

/**
 * Workspace ids that belong to 开发应用 — used to hide them from the sidebar.
 *
 * Sources (union):
 * 1. Local marker `.sclaw/app-dev.json` on the workspace root
 * 2. Abandoned shells that only keep `.sclaw` after app files were removed
 * 3. Workspaces under the default apps parent (`~/SClawApps`)
 * 4. sto-app bindings (workspaceId / localPath)
 *
 * Do not rely on cloud `listDevApps`: CLI/login failures must not leak apps
 * into 侧栏「项目」(入口只在应用广场).
 */
export async function listDevAppWorkspaceIds(): Promise<string[]> {
  const [workspaces, bindings] = await Promise.all([
    listUserWorkspaces(),
    listStoAppBindings(),
  ]);

  const ids = new Set<string>();
  const workspaceIdByRoot = new Map<string, string>();
  const defaultAppsRoot = resolve(DEFAULT_APPS_PARENT_DIR);

  for (const workspace of workspaces) {
    const root = workspace.rootPath?.trim();
    if (!root) continue;
    const resolvedRoot = resolve(root);
    workspaceIdByRoot.set(resolvedRoot, workspace.id);

    const underDefaultApps =
      resolvedRoot === defaultAppsRoot
      || resolvedRoot.startsWith(`${defaultAppsRoot}${sep}`);

    if (
      isAppDevWorkspaceRoot(resolvedRoot)
      || underDefaultApps
      || await isAbandonedAppDevShell(resolvedRoot)
    ) {
      ids.add(workspace.id);
    }
  }

  for (const binding of bindings) {
    const boundWorkspaceId = binding.workspaceId?.trim();
    if (boundWorkspaceId) {
      ids.add(boundWorkspaceId);
    }
    const localPath = binding.localPath?.trim();
    if (!localPath) continue;
    const matchedId = workspaceIdByRoot.get(resolve(localPath));
    if (matchedId) {
      ids.add(matchedId);
    }
  }

  return [...ids];
}

/**
 * Clone a cloud STO app into a user-selected parent directory, then bind workspace.
 * Target path = parentDir / sanitize(name). Must be empty or non-existent.
 */
export async function cloneDevApp(input: {
  applicationId: string;
  applicationName?: string;
  parentDir: string;
}): Promise<CreateUserAppResult & { applicationId: string }> {
  const applicationId = input.applicationId.trim();
  if (!applicationId) throw new Error('缺少 applicationId');
  const parentDir = resolve(input.parentDir.trim());
  if (!parentDir || !existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
    throw new Error('请选择有效的父目录');
  }

  const name = (input.applicationName?.trim() || applicationId).trim();
  const folderName = sanitizePackageName(name) || applicationId;
  const appPath = join(parentDir, folderName);
  if (existsSync(appPath)) {
    const contents = await readdir(appPath).catch(() => []);
    if (contents.length > 0) {
      throw new Error(`目标文件夹已存在且不为空：${appPath}`);
    }
  }

  const cloned = await cloneStoApp(applicationId, appPath);

  let cloud: CodeApplicationRecord | undefined;
  try {
    cloud = (await listCodeApplications()).find((item) => item.applicationId === applicationId);
  } catch (err) {
    logger.warn('[app-dev] list after clone skipped:', err);
  }
  const workspaceFile = await writeStoWorkspaceBinding({
    appPath,
    registryUrl: await stoWorkspaceRegistryUrl(),
    payload: cloned.json,
    cloud: codeApplicationToWorkspaceFields(cloud),
    fallback: { applicationId, status: 'ACTIVE' },
  });
  if (!workspaceFile) {
    throw new Error('拉取成功但未能写入 .sto/workspace.json');
  }

  await writeAppDevBootstrap(appPath, {
    name,
    projectType: 'frontend',
  });

  try {
    await ensureAppOpenspecScaffold(appPath);
    await ensureDefaultAppDevAssistSkills(appPath);
  } catch (err) {
    logger.warn('[app-dev] openspec scaffold after clone skipped:', err);
  }

  const workspace = await createWorkspace({ name, rootPath: appPath });
  const workspaceId = workspace.id;

  await upsertStoAppBinding({
    applicationId,
    applicationName: name,
    localPath: appPath,
    workspaceId,
  });

  setStatus(workspaceId, { appPath, phase: 'created', progress: 0 });
  void runSetupPipeline(workspaceId, appPath).catch((err) => {
    logger.error('[app-dev] setup pipeline after clone failed:', err);
  });

  return {
    workspaceId,
    appPath,
    workspaceName: workspace.name ?? name,
    applicationId,
  };
}

/**
 * Remove a local 开发应用 from the catalog, optionally deleting files.
 * Files are only removed when the path still has the app-dev marker (safety).
 */
async function removeLocalDevAppCheckout(
  workspaceId: string,
  deleteFiles: boolean,
  applicationId: string,
  gatewayManager?: GatewayManager | null,
): Promise<{ deletedLocal: boolean; deletedFiles: boolean; appPath: string }> {
  const { getWorkspaceRootPath } = await import('./session-catalog-service');
  const appPath = await getWorkspaceRootPath(workspaceId);
  if (applicationId) {
    await removeStoAppBinding(applicationId).catch(() => undefined);
  }
  await removeStoAppBindingByWorkspaceId(workspaceId).catch(() => undefined);

  if (!appPath) {
    await deleteWorkspace(workspaceId, gatewayManager).catch(() => undefined);
    return { deletedLocal: true, deletedFiles: false, appPath: '' };
  }

  stopApp(workspaceId);
  statuses.delete(workspaceId);
  await deleteWorkspace(workspaceId, gatewayManager);

  if (!deleteFiles) {
    return { deletedLocal: true, deletedFiles: false, appPath };
  }
  if (!isAppDevWorkspaceRoot(appPath)) {
    throw new Error('不是开发应用，无法删除本地目录');
  }

  const resolved = resolve(appPath);
  const forbidden = new Set([
    resolve('/'),
    resolve(homedir()),
    resolve(DEFAULT_APPS_PARENT_DIR),
  ]);
  if (forbidden.has(resolved) || resolved.length < 12) {
    throw new Error('已从列表移除；拒绝删除危险本地路径，文件请手动处理');
  }
  if (!isAppDevWorkspaceRoot(resolved)) {
    throw new Error('已从列表移除；应用目录标记已不存在，已跳过删文件以免误删');
  }
  await rm(resolved, { recursive: true, force: true });
  logger.info(`[app-dev] deleted app files at ${resolved}`);
  return { deletedLocal: true, deletedFiles: true, appPath };
}

/**
 * Soft-delete a cloud code application and/or remove a local-only import from the list.
 * Files are only removed when the path still has the app-dev marker (safety).
 */
export async function deleteDevApp(
  input: {
    applicationId?: string;
    workspaceId?: string;
    deleteLocal?: boolean;
  },
  gatewayManager?: GatewayManager | null,
): Promise<{ offline: boolean; deletedLocal: boolean; deletedFiles: boolean; appPath: string }> {
  const applicationId = input.applicationId?.trim() ?? '';
  let workspaceId = input.workspaceId?.trim() ?? '';
  if (!applicationId && !workspaceId) {
    throw new Error('缺少应用标识');
  }

  let offline = false;
  if (applicationId) {
    await offlineCodeApplication(applicationId);
    offline = true;
  }

  if (!workspaceId && applicationId) {
    const binding = (await listStoAppBindings()).find((item) => item.applicationId === applicationId);
    workspaceId = binding?.workspaceId?.trim() ?? '';
  }

  // Cloud-only offline: keep the local workspace unless the user asked to delete it.
  if (applicationId && !input.deleteLocal) {
    return { offline: true, deletedLocal: false, deletedFiles: false, appPath: '' };
  }

  if (!workspaceId) {
    if (applicationId) {
      await removeStoAppBinding(applicationId).catch(() => undefined);
    }
    return { offline, deletedLocal: false, deletedFiles: false, appPath: '' };
  }

  const removed = await removeLocalDevAppCheckout(
    workspaceId,
    input.deleteLocal === true,
    applicationId,
    gatewayManager,
  );
  return { offline, ...removed };
}

async function runNpmInstall(workspaceId: string, appPath: string): Promise<void> {
  const { npmBin } = getManagedNodePaths();
  const npmCwd = resolveAppNpmCwd(appPath);
  let ratio = 0;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmBin, ['install', '--no-audit', '--no-fund'], {
      cwd: npmCwd,
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

    const nodeModules = join(resolveAppNpmCwd(appPath), 'node_modules');
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

/**
 * Recreate the dev server instead of reusing the currently registered process.
 * The next start allocates a fresh port, so callers must consume the new
 * previewUrl from status rather than reloading a cached URL.
 */
export async function restartApp(workspaceId: string, appPath: string): Promise<void> {
  stopApp(workspaceId);
  await runSetupPipeline(workspaceId, appPath);
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

/** Install a frontend npm package into app package root (or legacy frontend/) with `--save`.
 * When `packageId` matches `openspec/skill-catalog/packages.manifest.json`, also installs AI skill assets.
 */
export async function installNpmPackage(
  appPath: string,
  packageNameRaw: string,
  options?: { packageId?: string },
): Promise<{
  packageName: string;
  output: string;
  packageId?: string;
  ai?: { skillId?: string; skillPath?: string; mode: 'full' | 'deps-only' };
}> {
  const catalogEntry = options?.packageId
    ? await findPackageCatalogEntry(appPath, options.packageId)
    : await findPackageCatalogEntryByNpmName(appPath, packageNameRaw);

  const packageNames = catalogEntry?.npmPackages?.length
    ? catalogEntry.npmPackages
    : [assertNpmPackageName(packageNameRaw)];

  let npmCwd: string;
  try {
    npmCwd = resolveAppNpmCwd(appPath);
  } catch {
    throw new Error('未找到 package.json（应用根或 frontend/），无法安装前端组件包');
  }

  if (!isNodeRuntimeReady()) {
    await setupManagedNode();
  }

  const { npmBin } = getManagedNodePaths();
  const outputs: string[] = [];
  for (const name of packageNames) {
    const packageName = assertNpmPackageName(name);
    const result = await collectSpawnOutput(
      npmBin,
      ['install', packageName, '--save', '--no-audit', '--no-fund'],
      { cwd: npmCwd, env: getNodeSpawnEnv() as NodeJS.ProcessEnv },
    );
    if (!result.ok) {
      throw new Error(`npm install ${packageName} 失败\n${result.output}`);
    }
    outputs.push(result.output);
  }

  const primaryName = assertNpmPackageName(packageNames[0] ?? packageNameRaw);
  if (!catalogEntry?.ai?.skillId) {
    return {
      packageName: primaryName,
      output: outputs.join('\n'),
      packageId: catalogEntry?.id,
      ai: { mode: 'deps-only' },
    };
  }

  const skill = await installAppDevAssistSkill(appPath, catalogEntry.ai.skillId);
  await appendPackageAiNote(appPath, catalogEntry);
  return {
    packageName: primaryName,
    output: outputs.join('\n'),
    packageId: catalogEntry.id,
    ai: { skillId: skill.skillId, skillPath: skill.targetPath, mode: 'full' },
  };
}

/**
 * Install a Python package into `backend/` via bundled uv:
 * create `.venv` if needed, `uv pip install`, and append to requirements.txt.
 * When packageId matches packages.manifest.json, also installs AI skill assets.
 */
export async function installPipPackage(
  appPath: string,
  packageNameRaw: string,
  options?: { packageId?: string },
): Promise<{
  packageName: string;
  output: string;
  packageId?: string;
  ai?: { skillId?: string; skillPath?: string; mode: 'full' | 'deps-only' };
}> {
  const catalogEntry = options?.packageId
    ? await findPackageCatalogEntry(appPath, options.packageId)
    : (await readPackageCatalog(appPath)).find(
        (item) =>
          item.kind === 'backend' &&
          item.packageName.toLowerCase() === packageNameRaw.trim().toLowerCase(),
      );

  const packageName = assertPipPackageName(catalogEntry?.packageName ?? packageNameRaw);
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

  if (!catalogEntry?.ai?.skillId) {
    return {
      packageName,
      output: install.output,
      packageId: catalogEntry?.id,
      ai: { mode: 'deps-only' },
    };
  }

  const skill = await installAppDevAssistSkill(appPath, catalogEntry.ai.skillId);
  await appendPackageAiNote(appPath, catalogEntry);
  return {
    packageName,
    output: install.output,
    packageId: catalogEntry.id,
    ai: { skillId: skill.skillId, skillPath: skill.targetPath, mode: 'full' },
  };
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

export type AppDevPackageCatalogItem = {
  id: string;
  kind: 'frontend' | 'backend';
  name: string;
  packageName: string;
  description: string;
  npmPackages?: string[];
  ai?: { skillId?: string; summary?: string };
};

async function readPackageCatalog(appPath: string): Promise<AppDevPackageCatalogItem[]> {
  await ensureAppOpenspecScaffold(appPath);
  const catalogRoot = appOpenspecCatalogRoot(appPath);
  const manifestPath = join(catalogRoot, 'packages.manifest.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      packages?: AppDevPackageCatalogItem[];
    };
    return Array.isArray(raw.packages) ? raw.packages.filter((p) => p?.id && p?.packageName) : [];
  } catch {
    return [];
  }
}

async function findPackageCatalogEntry(
  appPath: string,
  packageId: string,
): Promise<AppDevPackageCatalogItem | undefined> {
  const id = packageId.trim();
  if (!id) return undefined;
  const list = await readPackageCatalog(appPath);
  return list.find((item) => item.id === id);
}

async function findPackageCatalogEntryByNpmName(
  appPath: string,
  packageNameRaw: string,
): Promise<AppDevPackageCatalogItem | undefined> {
  const name = packageNameRaw.trim().toLowerCase();
  if (!name) return undefined;
  const list = await readPackageCatalog(appPath);
  return list.find((item) => {
    if (item.kind !== 'frontend') return false;
    if (item.packageName.toLowerCase() === name) return true;
    return (item.npmPackages ?? []).some((pkg) => pkg.toLowerCase() === name);
  });
}

async function appendPackageAiNote(
  appPath: string,
  entry: AppDevPackageCatalogItem,
): Promise<void> {
  const agentsPath = join(appPath, '.sclaw', 'AGENTS.md');
  if (!existsSync(agentsPath)) return;
  const markerStart = `<!-- sclaw-pkg:${entry.id} -->`;
  const markerEnd = `<!-- /sclaw-pkg:${entry.id} -->`;
  let content = await readFile(agentsPath, 'utf8');
  if (content.includes(markerStart)) return;
  const summary = entry.ai?.summary?.trim() || entry.description;
  const skillLine = entry.ai?.skillId
    ? `- 技能：\`openspec/skills/${entry.ai.skillId}/SKILL.md\``
    : '- 技能：无';
  const block = [
    markerStart,
    `## 已选装包：${entry.name} (\`${entry.packageName}\`)`,
    summary,
    skillLine,
    markerEnd,
  ].join('\n');
  content = `${content.trimEnd()}\n\n${block}\n`;
  await writeFile(agentsPath, content, 'utf8');
}

export async function listAppDevPackageCatalog(
  appPath: string,
): Promise<AppDevPackageCatalogItem[]> {
  return readPackageCatalog(appPath);
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

  // Keep package AI catalog in sync with engineering template (overwrite guidance assets).
  if (existsSync(catalogSrc)) {
    await mkdir(catalogDest, { recursive: true });
    const packagesManifest = 'packages.manifest.json';
    const srcManifest = join(catalogSrc, packagesManifest);
    const destManifest = join(catalogDest, packagesManifest);
    if (existsSync(srcManifest)) {
      await cp(srcManifest, destManifest);
    }
    try {
      const entries = await readdir(catalogSrc, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('pkg-')) continue;
        await cp(join(catalogSrc, entry.name), join(catalogDest, entry.name), { recursive: true });
      }
    } catch {
      // ignore catalog sync errors
    }
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

/** Bake default assist skills into a user app (idempotent). */
async function ensureDefaultAppDevAssistSkills(appPath: string): Promise<void> {
  const defaults = ['openspec', 'nl-page-from-sai'] as const;
  for (const skillId of defaults) {
    const installed = join(appPath, 'openspec', 'skills', skillId, 'SKILL.md');
    if (existsSync(installed)) continue;
    const catalogSkill = join(appOpenspecCatalogRoot(appPath), skillId, 'SKILL.md');
    if (!existsSync(catalogSkill)) continue;
    await installAppDevAssistSkill(appPath, skillId);
  }
  if (existsSync(join(appPath, 'openspec', 'skills', 'openspec', 'SKILL.md'))) {
    await syncOpenspecSkillsIntoAgents(appPath);
  }
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


