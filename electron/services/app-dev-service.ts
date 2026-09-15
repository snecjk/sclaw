/**
 * User app creation and setup pipeline (capabilities: app-create-scaffold,
 * service-git-checkpoint). Local-first: scaffold + workspace complete in
 * seconds; environment preparation / npm install / dev server start run in a
 * background pipeline reported as one continuous progress to the workbench.
 */

import { app, dialog } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, extname, dirname, join, relative, resolve, sep } from 'path';
import {
  buildSnpmInstallArgs,
  creepRatio,
  isTransientNpmInstallFailure,
  lastInstallLogLine,
  needsAppNpmInstall,
  parseNpmrcRegistry,
  pipelineProgress,
  pushInstallLogTail,
  sanitizePackageName,
  stripInstallLogAnsi,
  type AppDevPhase,
} from '../utils/app-dev-info';
import { getNodeRuntimeStatus, getNodeSpawnEnv, isNodeRuntimeReady, setupManagedNode } from '../utils/node-runtime';
import { ensureSnpmBin, resolveSnpmBin } from '../utils/snpm-cli';
import { getUvMirrorEnv } from '../utils/uv-env';
import { resolveUvBin, setupManagedPython } from '../utils/uv-setup';
import { needsWinShell, prepareWinSpawn, quoteForCmd } from '../utils/paths';
import { createWorkspace, deleteWorkspace, getWorkspaceRootPath, listUserWorkspaces } from './session-catalog-service';
import { startDevServer, getDevServer } from './app-dev-server-manager';
import {
  startRuntime,
  stopRuntime,
} from './app-runtime-manager';
import { KeyedGenerationTracker, OperationCanceledError } from './keyed-single-flight';
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';
import { cloneStoApp } from './sto-app-service';
import { archiveSiteApp, enrichSiteAppRecord, getSiteApp, listSiteApps } from './site-app-api';
import {
  getStoAppBindingByWorkspaceId,
  listStoAppBindings,
  removeStoAppBinding,
  removeStoAppBindingByWorkspaceId,
  upsertStoAppBinding,
} from './sto-app-binding-store';
import { readStoWorkspaceFile, writeStoWorkspaceBinding } from './sto-workspace-store';
import {
  normalizeSiteAppPageType,
  type SiteAppPageType,
  type SiteAppRecord,
} from '../../shared/site-app-catalog';
import {
  STO_WORKSPACE_RELATIVE,
  siteAppToWorkspaceFields,
} from '../../shared/sto-workspace';
import {
  appTemplatePackageManager,
  resolveLocalBuiltinTemplateDir,
} from './app-template-package-manager';
import { appTemplateApiClient, type AppTemplatePageType } from './app-template-api-client';
import { buildAppTemplateArchive } from './app-template-archive';
import { createUlid } from '../utils/ulid';
import { writeAppDevWorkspaceId } from './app-dev-marker';
import { copyTemplate } from './app-template-copy';
import {
  assertBuiltinTemplateDebugModeAllowed,
  assertTemplateWorkspaceCanPublish,
  fingerprintBuiltinTemplateTree,
  initializeBuiltinTemplateDebugWorkspace,
  inspectBuiltinTemplateDebugWorkspace,
  resolveAppTemplateWorkspacePath,
  resetBuiltinTemplateDebugWorkspace,
  syncBuiltinTemplateDebugWorkspace,
} from './app-template-builtin-debug-service';

export interface AppDevStatus {
  workspaceId: string;
  appPath: string;
  phase: AppDevPhase;
  /** 0-100 single continuous progress across all pipeline phases. */
  progress: number;
  previewUrl?: string;
  /** Fullstack backend base URL when runtime is up. */
  backendUrl?: string;
  /** SQLite / migrate readiness for fullstack apps. */
  dbStatus?: 'unknown' | 'ready' | 'error';
  /** Shown on the workbench error panel, including snpm install output. */
  error?: string;
  /** Extra line for the active setup step (e.g. snpm found vs installing). */
  detail?: string;
  /** Recent snpm / setup command output for the workbench log panel. */
  log?: string;
}

const statuses = new Map<string, AppDevStatus>();
const setupPipelineGenerations = new KeyedGenerationTracker();

export const DEFAULT_APPS_PARENT_DIR = join(homedir(), 'SClawApps');
export const DEFAULT_TEMPLATES_PARENT_DIR = join(homedir(), 'SClawTemplates');

/** Marker under the project agent workspace — used to hide from sidebar and list in 开发应用. */
export const APP_DEV_MARKER_RELATIVE = join('.sclaw', 'app-dev.json');

export type AppDevSource = 'created' | 'imported';

export interface AppDevMarker {
  workspaceId?: string;
  kind: 'app-dev' | 'app-template';
  name: string;
  projectType: string;
  /** True when projectType is fullstack (local FE+BE runtime). */
  fullstack?: boolean;
  createdAt: string;
  /** Cloud Site App id; written on first create so retries do not register a second app. */
  appCode?: string;
  /** `imported` = local folder import; `created` = 新建站 / clone from cloud. */
  source?: AppDevSource;
  pageType?: SiteAppPageType;
  templateId?: string;
  templateVersion?: string;
  packageOssKey?: string;
  packageEtag?: string | null;
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
  appCode?: string;
  /** Cloud list authority states for this device. */
  availability: 'local' | 'remote-only' | 'path-missing';
  /** Cloud preview page URL from site-apps list. */
  previewUrl?: string;
  /** Permission-management URL configured by memory-center. */
  permissionsUrl?: string;
  gitlabProjectId?: string;
  devopsApplicationId?: string;
  listError?: string;
  source?: AppDevSource;
  gitRepo?: boolean;
  pageType: SiteAppPageType;
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

async function readBoundAppCode(appPath: string): Promise<string> {
  const sto = await readStoWorkspaceFile(appPath);
  return sto?.appCode?.trim() ?? '';
}

export function hasGitRepo(appPath: string): boolean {
  return existsSync(join(appPath, '.git'));
}

/** Keep local checkpoints out of `.sto` metadata / base-snapshot noise. */
async function ensureStoIgnoredInGit(appPath: string): Promise<void> {
  const ignorePath = join(appPath, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(ignorePath, 'utf8');
  } catch {
    existing = '';
  }
  if (/(^|\n)\s*\.sto\/?\s*($|\n)/.test(existing)) return;
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  await writeFile(ignorePath, `${prefix}.sto/\n`, 'utf8');
}

/**
 * Ensure the app folder has a local git repo for checkpoint history.
 * Best-effort: creation/setup must not hard-fail if git is unavailable.
 */
export async function ensureLocalGitRepo(appPath: string): Promise<boolean> {
  if (!(await isGitAvailable())) return false;
  await ensureStoIgnoredInGit(appPath);
  if (hasGitRepo(appPath)) return true;
  const init = await runGit(appPath, ['init']);
  if (!init.ok) return false;
  await runGit(appPath, ['add', '-A']);
  await runGit(appPath, ['commit', '-m', '初始化本地版本']);
  return hasGitRepo(appPath);
}

async function readAppDevMarkerFields(appPath: string): Promise<{
  projectType: string;
  createdAt: string;
  name?: string;
  source?: AppDevSource;
  pageType: SiteAppPageType;
  kind: AppDevMarker['kind'];
}> {
  let projectType = 'frontend';
  let createdAt = '';
  let name: string | undefined;
  let source: AppDevSource | undefined;
  let pageType: SiteAppPageType = 'site';
  let kind: AppDevMarker['kind'] = 'app-dev';
  try {
    const raw = JSON.parse(await readFile(appDevMarkerPath(appPath), 'utf8')) as Partial<AppDevMarker>;
    if (typeof raw.projectType === 'string' && raw.projectType.trim()) projectType = raw.projectType.trim();
    if (typeof raw.createdAt === 'string' && raw.createdAt.trim()) createdAt = raw.createdAt;
    if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
    if (raw.source === 'created' || raw.source === 'imported') source = raw.source;
    pageType = normalizeSiteAppPageType(raw.pageType);
    if (raw.kind === 'app-template') kind = raw.kind;
  } catch {
    // ignore
  }
  return { projectType, createdAt, name, source, pageType, kind };
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
    if (fields.kind === 'app-template') continue;
    apps.push({
      workspaceId: workspace.id,
      name: fields.name || workspace.name || resolvedRoot.split(/[/\\]/).filter(Boolean).pop() || '导入应用',
      appPath: resolvedRoot,
      projectType: fields.projectType,
      createdAt: fields.createdAt || workspace.createdAt || new Date().toISOString(),
      localReady: true,
      availability: 'local',
      source: fields.source ?? 'imported',
      gitRepo: hasGitRepo(resolvedRoot),
      pageType: fields.pageType,
    });
  }
  return apps;
}

function dedupeSiteAppRecords(items: SiteAppRecord[]): SiteAppRecord[] {
  const map = new Map<string, SiteAppRecord>();
  for (const item of items) {
    const prev = map.get(item.appCode);
    if (!prev) {
      map.set(item.appCode, item);
      continue;
    }
    const prevArchived = prev.status?.trim().toLowerCase() === 'archived';
    const curArchived = item.status?.trim().toLowerCase() === 'archived';
    if (prevArchived && !curArchived) map.set(item.appCode, item);
  }
  return [...map.values()];
}

function normalizeDevAppListName(name: string): string {
  return name.trim().toLowerCase();
}

function preferDevAppSummary(left: DevAppSummary, right: DevAppSummary): DevAppSummary {
  if (left.localReady && !right.localReady) return left;
  if (right.localReady && !left.localReady) return right;
  if (left.workspaceId && !right.workspaceId) return left;
  if (right.workspaceId && !left.workspaceId) return right;
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt) >= 0 ? left : right;
  }
  return left;
}

function listIdentityKey(app: Pick<DevAppSummary, 'name' | 'pageType'>): string {
  return `${normalizeDevAppListName(app.name)}:${app.pageType ?? 'site'}`;
}

/**
 * Align cloud list + local list to one card per local project.
 * Extra Site Apps created for the same folder/name (retry / first-push leftovers)
 * must not become a second “仅云端” card.
 */
export function collapseDevAppsSharingLocalIdentity(apps: DevAppSummary[]): DevAppSummary[] {
  const picked: DevAppSummary[] = [];
  const usedWorkspaceIds = new Set<string>();
  const usedPaths = new Set<string>();

  const ordered = [...apps].sort((a, b) => {
    if (a.localReady !== b.localReady) return a.localReady ? -1 : 1;
    return preferDevAppSummary(a, b) === a ? -1 : 1;
  });

  for (const app of ordered) {
    const workspaceId = app.workspaceId?.trim() ?? '';
    const path = app.appPath?.trim() ? resolve(app.appPath.trim()) : '';
    const workspaceTaken = Boolean(workspaceId) && usedWorkspaceIds.has(workspaceId);
    const pathTaken = Boolean(path) && usedPaths.has(path);
    if (workspaceTaken || pathTaken) continue;
    picked.push(app);
    if (workspaceId) usedWorkspaceIds.add(workspaceId);
    if (path) usedPaths.add(path);
  }

  const localProjectKeys = new Set(
    picked.filter((app) => app.localReady).map((app) => listIdentityKey(app)),
  );
  return picked.filter((app) => {
    if (app.localReady) return true;
    return !localProjectKeys.has(listIdentityKey(app));
  });
}

function mergeCloudWithLocalDevApp(cloud: DevAppSummary, local: DevAppSummary): DevAppSummary {
  return {
    ...cloud,
    workspaceId: local.workspaceId,
    appPath: local.appPath,
    localReady: true,
    availability: 'local',
    projectType: local.projectType ?? cloud.projectType,
    source: local.source ?? cloud.source,
    gitRepo: local.gitRepo ?? cloud.gitRepo,
    createdAt: local.createdAt || cloud.createdAt,
  };
}

/** Merge cloud + local-only rows and drop duplicates (same appCode / workspace / path). */
export function mergeAndDedupeDevApps(
  cloudApps: DevAppSummary[],
  localApps: DevAppSummary[],
): DevAppSummary[] {
  const byAppCode = new Map<string, DevAppSummary>();
  for (const app of cloudApps) {
    if (!app.appCode) continue;
    const prev = byAppCode.get(app.appCode);
    byAppCode.set(app.appCode, prev ? preferDevAppSummary(prev, app) : app);
  }

  const consumedWorkspaceIds = new Set<string>();
  const result: DevAppSummary[] = [];

  for (const cloud of byAppCode.values()) {
    if (cloud.localReady) {
      if (cloud.workspaceId) consumedWorkspaceIds.add(cloud.workspaceId);
      result.push(cloud);
      continue;
    }
    const match = localApps.find((local) => {
      if (local.appCode) return false;
      if (!local.localReady || !local.workspaceId) return false;
      if (consumedWorkspaceIds.has(local.workspaceId)) return false;
      return normalizeDevAppListName(local.name) === normalizeDevAppListName(cloud.name)
        && (local.pageType ?? 'site') === (cloud.pageType ?? 'site');
    });
    if (match) {
      consumedWorkspaceIds.add(match.workspaceId);
      result.push(mergeCloudWithLocalDevApp(cloud, match));
    } else {
      result.push(cloud);
    }
  }

  const seenWorkspaceIds = new Set(
    result.map((app) => app.workspaceId).filter((id): id is string => Boolean(id)),
  );
  const seenPaths = new Set(
    result
      .map((app) => app.appPath?.trim())
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path)),
  );

  for (const local of localApps) {
    if (local.workspaceId && consumedWorkspaceIds.has(local.workspaceId)) continue;
    if (local.workspaceId && seenWorkspaceIds.has(local.workspaceId)) continue;
    const path = local.appPath?.trim();
    if (path && seenPaths.has(resolve(path))) continue;
    result.push(local);
    if (local.workspaceId) seenWorkspaceIds.add(local.workspaceId);
    if (path) seenPaths.add(resolve(path));
  }

  return collapseDevAppsSharingLocalIdentity(result).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}



/**
 * Hide from 侧栏「项目」: real 开发应用 marker, or anything under ~/SClawApps.
 *
 * Do not treat “root only has `.sclaw`” as 开发应用. `createWorkspace` writes
 * `<root>/.sclaw/.claw-output` for empty chat projects; that shell is identical
 * to a leftover app folder and must stay in 项目.
 */
export function isAppDevSidebarHiddenRoot(appPath: string): boolean {
  if (!appPath.trim()) return false;
  const resolvedRoot = resolve(appPath);
  const defaultAppsRoot = resolve(DEFAULT_APPS_PARENT_DIR);
  const underDefaultApps =
    resolvedRoot === defaultAppsRoot
    || resolvedRoot.startsWith(`${defaultAppsRoot}${sep}`);
  return isAppDevWorkspaceRoot(resolvedRoot) || underDefaultApps;
}

function buildAppDevAgentsContextBlock(vars: {
  name: string;
  pageType?: SiteAppPageType;
  fullstack?: boolean;
}): string {
  const pageType = normalizeSiteAppPageType(vars.pageType);
  const menuShape = pageType === 'assets'
    ? '本应用 pageType 为 assets：云端菜单只同步 **一个一级菜单**'
    : '本应用 pageType 为 site：云端菜单遵循用户导航，只同步 **一级目录 + 二级页面**';
  const fullstackBlock = vars.fullstack
    ? `
## 本地全栈后端（强制）
- 本应用为 fullstack：前端 Vite + 后端 Hono（\`server/\`）+ Drizzle/SQLite（\`.data/app.db\`）
- **可改**：\`server/routes/\`、\`server/services/\`（若有）、\`drizzle/schema.ts\`
- **禁止改**：\`server/runtime/\` 平台壳（logger / auth-middleware / error / db 打开方式），除非修明确 bug
- 改 schema 后必须执行 \`npm run db:migrate\`，并用 \`GET /api/health\`（或 \`/proxy/appBackend/api/health\`）自检
- 密钥只通过工作台 Secrets 注入环境变量，禁止写入源码 / \`.env\` 提交；\`.data/\` 永不进源码同步
- 后端开发细则见 \`openspec/skill-catalog/backend-dev/SKILL.md\`

## 全栈页面双轨（强制，覆盖下方「优先 page.json」默认）
- **需要调后端 / 持登录态 / 表单列表刷新的业务页** → 写 \`src/pages/*.tsx\`，并在 \`src/App.tsx\` 用 React Router 注册；参考 \`HomePage.tsx\`（登录 + Todos 走 \`/proxy/appBackend\`）
- **纯展示 / 营销 / 无后端交互页** → 仍可用 \`src/pages/*.page.json\` + \`src/runtime/page-loader.ts\`（A2UI）
- **禁止混用**：同一业务能力不要既写 JSX 又写 page.json；全栈 CRUD 不要硬套 A2UI catalog
- 前端访问本应用后端一律 \`/proxy/appBackend/...\`，禁止写死 \`http://127.0.0.1:<port>\`
`
    : '';
  const pagePriorityBlock = vars.fullstack
    ? `- **全栈业务页优先改 JSX**（见上方双轨）；展示型页面仍可改 \`src/pages/*.page.json\` 与 \`contracts/\`
- 查询/列表若做成 A2UI 展示页：仍须用 antd Catalog；若做成 JSX 业务页：可用 antd 组件，样式只走 \`src/theme/theme.css\` token`
    : `- **优先修改 \`src/pages/*.page.json\` 与 \`contracts/\`**；预览由 A2UI 渲染器驱动
- 禁止把业务页面写成自由 React JSX
- 组件：查询/列表/表格/分页页 **必须** 使用 antd Catalog（\`catalogId: "antd"\`）组件：\`AntdFilterBar\`、\`AntdTable\`、\`AntdPagination\`、\`AntdButton\`、\`AntdStack\`、\`AntdText\`
- 用户即使不提 antd，只要需求是「查询条件 + 表格 + 分页」，也要优先用上述组件；参考 \`src/pages/customer-list.page.json\`
- 同一 surface 不要混用 basic 的 Column/Text 与 Antd*（一个 surface 一个 catalogId）
- page JSON 必须是 A2UI v0.9 消息数组（createSurface / updateComponents / updateDataModel），不要编造 \`{ type, props }\` 伪格式
- 交互通过 actionId：先改 \`contracts/action-registry.v1.json\`，再在页面 Button/Filter 上引用
- 多页面：新增 \`src/pages/<id>.page.json\` 后还要在 \`src/runtime/page-loader.ts\` 注册`;
  return `<!-- sclaw-app-dev-context -->
你正在帮助用户开发一个名为「${vars.name}」的业务应用（SClaw 开发应用）。

## 项目结构
- \`src/pages/\`：页面资产（${vars.fullstack ? '全栈以 JSX 业务页为主，A2UI page.json 为展示辅轨' : 'A2UI 页面资产（**主战场**，优先修改)'}）
- \`contracts/\`：action / intent 契约（Button 的 action 名必须已注册）
- \`docs/api/\`：公司接口文档（Markdown），调用接口前先阅读这里
- \`src/runtime/\`：页面加载与 Action Runtime（平台壳，默认不要改）
- \`src/App.tsx\`：${vars.fullstack ? '路由与布局宿主；注册新 JSX 业务页时需要改 Route' : 'A2UI 宿主壳，**默认不要改**'}；**禁止**在业务预览里展示 Action Runtime / 开发者调试日志（调试日志应由 SClaw 工作台单独一列展示，不在应用页面内）
- 工程构建对齐公司发布平台：\`npm run build\` 产物在 \`build/\`；不要改 \`outDir\` 或随意升级 rollup（模板已锁定）
- \`openspec/\`：本应用的 OpenSpec；**不是** SClaw 客户端仓库
${fullstackBlock}
## 工作方式
- 用户是业务人员，用自然语言描述需求；不要要求他们写代码或看终端日志
- 预览面向业务用户：只展示业务页面；不要加「Action Runtime」「当前页 #id」「改 page.json」等开发说明
${pagePriorityBlock}
- 优先使用公司接口文档；不确定时先查 \`docs/api/\`；页面里用 actionId 或 \`/proxy/...\`，不写死后端绝对 URL
- 新功能或跨模块改动：先读 \`openspec/skills/\`，再按 OpenSpec（proposal → design → specs → tasks → apply）推进
- 保持页面简洁可用；改动后用简短中文说明「改了什么、用户会看到什么」
- 不要提交密钥到代码里；鉴权方式以接口文档为准

## 自然语言建页与接口（强制）
- 用户用自然语言生成页面时：若页面**需要调业务接口**（查询/列表/看板取数等），且用户**尚未指定**要用的 sai-cli 指令或接口：
  - 先执行 \`sai-cli siteapp external-service list --keyword "<业务词>" -f json\`，只读取平台已发布服务的摘要；用户明确要浏览全部服务时执行不带 keyword 的 \`list\`
  - 唯一候选确定后，使用摘要中的 \`serviceUid\` 和 \`latestVersion\` 执行 \`sai-cli siteapp external-service describe --params '{"serviceUid":"<serviceUid>","version":"<latestVersion>"}' -f json\`
  - 一次只 describe 一个服务；多个合理候选时先让用户选择，\`hasUsageGuide=false\` 或说明不足时向用户确认，禁止根据名称或描述猜测接口
  - 平台服务没有匹配结果时，回退原始 sai-cli 接口发现流程：
    - **先引导用户指定 CLI 接口**，再生成并绑定真实取数；未指定前不要臆造 URL / 命令路径去接真接口
    - 引导话术示例：「这个页面需要接业务数据。请告诉我要用哪条 sai-cli 指令（例如：一口价运费查询），指定后我再按该指令的参数和字段生成搜索/列表。」
    - 若用户说不清命令名，可协助执行 \`sai-cli discover "<业务词>"\`，把结果列出来**请用户指定一条**；仍以用户指定为准
- 用户已指定 CLI 后：\`sai-cli help\` → 若有绝对 HTTP 地址，先执行 \`node scripts/ensure-dev-proxy.mjs "<绝对URL>"\`，把输出的 \`relativeUrl\`（\`/proxy/<key>/...\`）写入 action-registry 或页面；**禁止**页面直连 \`https://*.sto.cn\`（本地 CORS）
- 已安装外部服务且 usageGuide 已明确接口后：先确认 \`contracts/external-services.v1.json\` 中的 alias；在 action-registry 写 \`service: "<alias>"\` 与 \`path: "/..."\`，不要写 \`url: "/proxy/..."\`。A2UI Runtime 会在开发环境经 Vite 代理、在发布环境按部署环境直连该服务地址。
- \`/proxy/<key>/...\` 仅用于未注册服务的临时开发回退；已注册服务禁止以它作为生产调用契约。
- 预览出现 CORS/直连失败：对报错 URL 再跑 ensure-dev-proxy，改 url 为 relativeUrl，并重启预览
- 生产 Network 若仍请求 \`https://page-*.sto.cn/proxy/...\`：检查是否未走 request 封装或缺 proxy 合约 key
- 用户明确只要布局、先不接真接口：可用 mock 出页，并说明稍后指定 CLI 再接入
- 详细步骤见 \`openspec/skills/nl-page-from-sai/SKILL.md\`（若已启用）

## 发布后同步云端菜单
- ${menuShape}
- 发布成功或用户要求同步菜单时：扫描本应用源码中的导航、路由和权限配置（含当前不展示的权限页），整理菜单树后**展示并询问是否同步**；未同意禁止 apply
- 查询：\`sai-cli siteapp menu list --params '{"app_code":"<app_code>"}' -f json\`
- 同意后：\`sai-cli siteapp menu sync --params '{"app_code":"<app_code>","mode":"apply","confirm":true,"skip_preview":true,"menus":[...]}' -f json\`
- 菜单项字段：\`menu_code\` / \`parent_code\`（一级为 null） / \`menu_name\` / \`menu_type\`（directory 或 page，不要用 menu）
- 不要同步 404、redirect、\`developerOnly\`；\`app_code\` 以 \`.sto/workspace.json\` 为准

## 设计规范（强制）
- 业务页视觉以 \`openspec/skills/sto-pc-visual/\` 为准：壳层读 SKILL.md / shell.md；卡内列表、表格、指标、状态读 content.md。营销落地页才仿 \`HomePage\` 的 1120 居中与大间距
- 颜色/圆角/阴影/间距**只允许**使用 \`src/theme/theme.css\` 中声明的 token（含 \`--sto-*\` 与 shadcn 别名 \`--background/--foreground/--primary/--muted/--border/--radius\`）；**禁止**在页面或组件中硬编码 hex/rgb（违禁示例：\`#1677ff\` antd 默认蓝、\`#FF6700\` 散落写死）。content.md 里的 hex 只是对照值，落盘写成 \`var(--sto-*)\`
- 字阶优先 12 / 14 / 16 / 28；行高 1.5；标题字重 600、正文字重 400；指标主值 28
- 间距只用 \`--sto-space-1\` ~ \`--sto-space-8\`（4px 网格）。工作台主区/白卡 pad 16、卡缝 16，不要套营销页的 section ≥ 48px / 1120 居中
- 圆角语义：控件 6px（\`--sto-radius-md\`）/ 卡片 8px（\`--sto-radius-lg\`）/ 面板 12px（\`--sto-radius-panel\`）；阴影只用 \`--sto-shadow-1\` / \`--sto-shadow-3\`
- 每个页面须在 ≥390px 与 ≥1280px 双宽度可用，禁止横向溢出（自查 \`overflow-x\`）
- 图片/图标未生成时必须用语义化占位（渐变块 + 居中文案），并在总结中披露「当前为模拟内容」
- ⛔ 不要把业务页做成独立 HTML 报告：禁止 \`build.py\`、\`<!-- STO:DAILY -->\`、日报类名 \`.mc/.masthead\`、页尾设计师水印

## 输出协议（可选增强，失败时宿主会降级）
- 复杂多步改动（首轮建站、整站/官网、新增 ≥2 页面、后台系统等）：**必须先**输出 fenced JSON \`\`\`sclaw_plan\\n{"summary":"一两句话","steps":[{"id":"1","title":"短步骤"}]}\\n\`\`\`（summary ≤80 字，steps 3～6 条且 title ≤24 字）；**禁止**在用户确认前改业务代码；小改动（改文案/颜色/错别字/单文件微调）直接改代码，不要输出 plan
- 每步完成可输出 \`\`\`sclaw_step\\n{"id":"1","status":"done"}\\n\`\`\`
- 轮结束可输出 ≤3 条建议：\`\`\`sclaw_suggestions\\n[{"label":"检查移动端","prompt":"请检查一下移动端效果并修复溢出"}]\\n\`\`\`
<!-- /sclaw-app-dev-context -->`;
}

function buildAppTemplateAgentsContextBlock(vars: { name: string; pageType: SiteAppPageType }): string {
  return `<!-- sclaw-app-dev-context -->
你正在维护一个名为「${vars.name}」的 SClaw ${vars.pageType === 'site' ? '独立站点' : '托管应用'}模板。

## 模板维护边界
- 这是模板工程，不是普通业务应用；修改会影响模板后续发布后创建的新应用，不影响既有应用。
- 可以同时维护 A2UI JSON 和 React/antd JSX，不强制只使用其中一种方式。
- 保留根目录 \`manifest.json\`、\`package.json\` 和可运行的工程入口。
- 不得修改 \`manifest.json\` 中的 \`templateId\`、\`pageType\` 或 \`schemaVersion\`。
- 不要写入密钥、\`.env\`、构建产物、\`node_modules\` 或符号链接。
- 发布前应运行 typecheck/build 并说明验证结果；真正发布必须由模板作者在页面中确认。
<!-- /sclaw-app-dev-context -->`;
}

async function writeAppDevBootstrap(
  appPath: string,
  vars: {
    name: string;
    projectType: string;
    source?: AppDevSource;
    pageType?: SiteAppPageType;
    templateId?: string;
    templateVersion?: string;
    packageOssKey?: string;
    packageEtag?: string | null;
    kind?: AppDevMarker['kind'];
  },
): Promise<void> {
  const sclawDir = join(appPath, '.sclaw');
  await mkdir(sclawDir, { recursive: true });

  const marker: AppDevMarker = {
    kind: vars.kind ?? 'app-dev',
    name: vars.name,
    projectType: vars.projectType,
    fullstack: vars.projectType === 'fullstack' ? true : undefined,
    createdAt: new Date().toISOString(),
    source: vars.source,
    pageType: vars.pageType,
    templateId: vars.templateId,
    templateVersion: vars.templateVersion,
    packageOssKey: vars.packageOssKey,
    packageEtag: vars.packageEtag,
  };
  // Preserve original createdAt / source when re-ensuring.
  if (existsSync(appDevMarkerPath(appPath))) {
    try {
      const existing = JSON.parse(await readFile(appDevMarkerPath(appPath), 'utf8')) as Partial<AppDevMarker>;
      if (typeof existing.createdAt === 'string') marker.createdAt = existing.createdAt;
      if (vars.kind === undefined && existing.kind === 'app-template') marker.kind = existing.kind;
      if (!marker.source && (existing.source === 'created' || existing.source === 'imported')) {
        marker.source = existing.source;
      }
      if (!marker.pageType && existing.pageType) {
        marker.pageType = normalizeSiteAppPageType(existing.pageType);
      }
      if (!marker.templateId && typeof existing.templateId === 'string') {
        marker.templateId = existing.templateId;
      }
      if (!marker.templateVersion && typeof existing.templateVersion === 'string') {
        marker.templateVersion = existing.templateVersion;
      }
      if (!marker.packageOssKey && typeof existing.packageOssKey === 'string') {
        marker.packageOssKey = existing.packageOssKey;
      }
      if (marker.packageEtag === undefined && existing.packageEtag !== undefined) {
        marker.packageEtag = existing.packageEtag;
      }
      if (typeof existing.workspaceId === 'string' && existing.workspaceId.trim()) {
        marker.workspaceId = existing.workspaceId.trim();
      }
      if (typeof existing.appCode === 'string' && existing.appCode.trim()) {
        marker.appCode = existing.appCode.trim();
      }
    } catch {
      // ignore
    }
  }
  await writeFile(appDevMarkerPath(appPath), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');

  const agentsPath = join(sclawDir, 'AGENTS.md');
  const contextBlock = marker.kind === 'app-template'
    ? buildAppTemplateAgentsContextBlock({ name: vars.name, pageType: normalizeSiteAppPageType(vars.pageType) })
    : buildAppDevAgentsContextBlock({
      name: vars.name,
      pageType: normalizeSiteAppPageType(vars.pageType),
      fullstack: vars.projectType === 'fullstack' || marker.fullstack === true,
    });
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
  let source: AppDevSource | undefined;
  let pageType: SiteAppPageType | undefined;
  const markerFile = appDevMarkerPath(appPath);
  if (existsSync(markerFile)) {
    try {
      const raw = JSON.parse(await readFile(markerFile, 'utf8')) as Partial<AppDevMarker>;
      if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
      if (typeof raw.projectType === 'string') projectType = raw.projectType;
      if (raw.source === 'created' || raw.source === 'imported') source = raw.source;
      if (raw.pageType) pageType = normalizeSiteAppPageType(raw.pageType);
    } catch {
      // ignore
    }
  } else {
    // Fallback: use workspace name from catalog.
    const workspaces = await listUserWorkspaces();
    const match = workspaces.find((w) => w.id === workspaceId);
    if (match?.name) name = match.name;
  }

  await writeAppDevBootstrap(appPath, { name, projectType, source, pageType });
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
        if (
          !entry.name.startsWith('pkg-')
          && entry.name !== 'nl-page-from-sai'
          && entry.name !== 'sto-pc-visual'
        ) continue;
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
    join(process.cwd(), 'resources', 'app-templates', 'site-minimal'),
    join(app.getAppPath(), 'resources', 'app-templates', 'site-minimal'),
    join(process.resourcesPath, 'resources', 'app-templates', 'site-minimal'),
    join(process.resourcesPath, 'app-templates', 'site-minimal'),
  ];
  for (const dir of candidates) {
    if (isValidReactTemplate(dir)) return dir;
  }
  return null;
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
  const local = resolveLocalReactTemplateDir();
  if (!local) throw new Error('应用模板资源缺失');
  return local;
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

/**
 * 只取 stdout 且不 trim：用于 `git show <rev>:<path>` 读文件原文，
 * 避免 stderr 警告或首尾空白裁剪污染 diff 内容。
 */
function runGitStdout(cwd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      ['-c', 'user.name=SClaw', '-c', 'user.email=sclaw@local', ...args],
      { cwd, windowsHide: true },
    );
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d) => chunks.push(d as Buffer));
    child.on('close', (code) => {
      resolve({ ok: code === 0, output: Buffer.concat(chunks).toString('utf8') });
    });
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
  /** 'frontend' | 'fullstack' — fullstack uses site-fullstack + dual-process runtime. */
  projectType?: string;
  /** Cloud application publishing mode. Defaults to site for older clients. */
  pageType?: SiteAppPageType;
  /** Selected ACTIVE template and its immutable version. */
  templateId: string;
  templateVersion: string;
  templateSource?: 'local-resource' | 'memory-center';
}

export interface CreateUserAppResult {
  workspaceId: string;
  appPath: string;
  workspaceName: string;
}

export function isFullstackAppMarker(marker: Pick<AppDevMarker, 'projectType' | 'fullstack'> | null | undefined): boolean {
  if (!marker) return false;
  return marker.projectType === 'fullstack' || marker.fullstack === true;
}

export async function readAppDevMarker(appPath: string): Promise<AppDevMarker | null> {
  const markerFile = appDevMarkerPath(appPath);
  if (!existsSync(markerFile)) return null;
  try {
    return JSON.parse(await readFile(markerFile, 'utf8')) as AppDevMarker;
  } catch {
    return null;
  }
}

export interface AppTemplateWorkspaceMarker {
  kind: 'app-template';
  templateId: string;
  pageType: AppTemplatePageType;
  name: string;
  description: string;
  latestVersion?: string;
  source?: 'local-resource' | 'memory-center';
  sourceFingerprint?: string;
  packageOssKey?: string;
  packageEtag?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function appTemplateWorkspaceMarkerPath(templateRoot: string): string {
  return join(templateRoot, '.sclaw', 'app-template.json');
}

export async function readAppTemplateWorkspaceMarker(
  templateRoot: string,
): Promise<AppTemplateWorkspaceMarker> {
  const marker = JSON.parse(
    await readFile(appTemplateWorkspaceMarkerPath(templateRoot), 'utf8'),
  ) as Partial<AppTemplateWorkspaceMarker>;
  if (
    marker.kind !== 'app-template'
    || typeof marker.templateId !== 'string'
    || !marker.templateId.trim()
    || (marker.pageType !== 'site' && marker.pageType !== 'assets')
  ) {
    throw new Error('当前工作区不是有效的应用模板');
  }
  return marker as AppTemplateWorkspaceMarker;
}

export async function openAppTemplateWorkspace(input: {
  templateId?: string;
  pageType: AppTemplatePageType;
  name: string;
  description?: string;
  latestVersion?: string;
  source?: 'local-resource' | 'memory-center';
}): Promise<CreateUserAppResult & { templateId: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('模板名称不能为空');
  if (input.source === 'local-resource') {
    assertBuiltinTemplateDebugModeAllowed(app.isPackaged);
  }
  const templateId = input.templateId?.trim() || createUlid();
  const appPath = resolveAppTemplateWorkspacePath(
    DEFAULT_TEMPLATES_PARENT_DIR,
    templateId,
    input.source,
  );
  const markerPath = appTemplateWorkspaceMarkerPath(appPath);

  // An interrupted initialization can leave the isolated debug directory
  // behind before its marker is written. Rebuild that incomplete directory
  // from resources on the next open.
  if (
    input.source === 'local-resource'
    && existsSync(appPath)
    && !existsSync(markerPath)
  ) {
    await rm(appPath, { recursive: true, force: true });
  }

  if (!existsSync(markerPath)) {
    let sourceDir: string;
    if (input.templateId) {
      if (input.source === 'local-resource') {
        sourceDir = resolveLocalBuiltinTemplateDir(templateId);
        const manifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8')) as {
          pageType?: string;
        };
        if (manifest.pageType !== input.pageType) {
          throw new Error('本地内置模板与应用类型不一致');
        }
      } else {
        if (!input.latestVersion?.trim()) throw new Error('模板最新版本不能为空');
        sourceDir = await appTemplatePackageManager.ensureTemplate(
          templateId,
          input.latestVersion,
          input.pageType,
        );
      }
    } else {
      sourceDir = resolveLocalBuiltinTemplateDir(`${input.pageType}-minimal`);
    }
    await mkdir(dirname(appPath), { recursive: true });
    if (input.source === 'local-resource' || !input.templateId) {
      await initializeBuiltinTemplateDebugWorkspace(sourceDir, appPath);
    } else {
      await cp(sourceDir, appPath, { recursive: true });
    }

    const manifestPath = join(appPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.schemaVersion = 1;
    manifest.templateId = templateId;
    manifest.pageType = input.pageType;
    manifest.name = name;
    manifest.description = input.description?.trim() || '';
    delete manifest.version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const now = new Date().toISOString();
    const marker: AppTemplateWorkspaceMarker = {
      kind: 'app-template',
      templateId,
      pageType: input.pageType,
      name,
      description: input.description?.trim() || '',
      latestVersion: input.latestVersion,
      source: input.source ?? (input.templateId ? 'memory-center' : undefined),
      sourceFingerprint: input.source === 'local-resource'
        ? await fingerprintBuiltinTemplateTree(sourceDir)
        : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    await writeAppDevBootstrap(appPath, {
      kind: 'app-template',
      name,
      projectType: 'frontend',
      source: 'created',
      pageType: input.pageType,
      templateId,
      templateVersion: input.latestVersion,
    });

    if (await isGitAvailable()) {
      const init = await runGit(appPath, ['init']);
      if (init.ok) {
        await runGit(appPath, ['add', '-A']);
        await runGit(appPath, ['commit', '-m', '创建模板工作区']);
      }
    }
  }

  const workspaces = await listUserWorkspaces();
  const existing = workspaces.find((workspace) => resolve(workspace.rootPath) === resolve(appPath));
  const workspace = existing ?? await createWorkspace({ name: `模板：${name}`, rootPath: appPath });
  const workspaceId = workspace.id;
  await writeAppDevWorkspaceId(appPath, workspaceId);
  setStatus(workspaceId, { appPath, phase: 'created', progress: 0 });
  void runSetupPipeline(workspaceId, appPath).catch((error) => {
    logger.error('[app-template] setup pipeline failed:', error);
  });
  return { workspaceId, appPath, workspaceName: workspace.name ?? name, templateId };
}

async function resolveBuiltinTemplateDebugContext(workspaceId: string): Promise<{
  workspaceRoot: string;
  resourcesRoot: string;
}> {
  assertBuiltinTemplateDebugModeAllowed(app.isPackaged);
  const workspaceRoot = await getWorkspaceRootPath(workspaceId);
  if (!workspaceRoot) throw new Error('模板调试工作区不存在');
  const marker = await readAppTemplateWorkspaceMarker(workspaceRoot);
  if (marker.source !== 'local-resource') {
    throw new Error('当前工作区不是本地内置模板调试工作区');
  }
  const expectedTemplateId = `${marker.pageType}-minimal` as 'site-minimal' | 'assets-minimal';
  if (marker.templateId !== expectedTemplateId) {
    throw new Error('本地内置模板与应用类型不一致');
  }
  return {
    workspaceRoot,
    resourcesRoot: dirname(resolveLocalBuiltinTemplateDir(expectedTemplateId)),
  };
}

export async function getBuiltinAppTemplateDebugStatus(workspaceId: string) {
  const workspaceRoot = await getWorkspaceRootPath(workspaceId);
  if (!workspaceRoot) throw new Error('模板调试工作区不存在');
  const marker = await readAppTemplateWorkspaceMarker(workspaceRoot);
  const expectedTemplateId = `${marker.pageType}-minimal` as 'site-minimal' | 'assets-minimal';
  if (marker.source !== 'local-resource' || marker.templateId !== expectedTemplateId) {
    return { isBuiltinDebug: false, sourceChanged: false, changes: [] };
  }
  assertBuiltinTemplateDebugModeAllowed(app.isPackaged);
  return inspectBuiltinTemplateDebugWorkspace({
    workspaceRoot,
    resourcesRoot: dirname(resolveLocalBuiltinTemplateDir(expectedTemplateId)),
  });
}

export async function syncBuiltinAppTemplateDebugWorkspace(workspaceId: string) {
  const context = await resolveBuiltinTemplateDebugContext(workspaceId);
  return syncBuiltinTemplateDebugWorkspace(context);
}

export async function resetBuiltinAppTemplateDebugWorkspace(workspaceId: string) {
  const context = await resolveBuiltinTemplateDebugContext(workspaceId);
  const result = await resetBuiltinTemplateDebugWorkspace(context);
  await restartApp(workspaceId, context.workspaceRoot);
  return result;
}

export async function publishAppTemplateWorkspace(input: {
  workspaceId: string;
}): Promise<Awaited<ReturnType<typeof appTemplateApiClient.publish>>> {
  const appPath = await getWorkspaceRootPath(input.workspaceId);
  if (!appPath) throw new Error('模板工作区不存在');
  const markerPath = appTemplateWorkspaceMarkerPath(appPath);
  if (!existsSync(markerPath)) throw new Error('当前工作区不是应用模板');
  const marker = await readAppTemplateWorkspaceMarker(appPath);
  assertTemplateWorkspaceCanPublish(marker.source);
  const manifest = JSON.parse(
    await readFile(join(appPath, 'manifest.json'), 'utf8'),
  ) as Record<string, unknown>;
  const manifestName = String(manifest.name ?? '').trim();
  const manifestDescription = String(manifest.description ?? '').trim();
  if (manifest.templateId !== marker.templateId || manifest.pageType !== marker.pageType) {
    throw new Error('manifest.json 的 templateId 或 pageType 与模板工作区不一致');
  }
  if (!manifestName) throw new Error('manifest.json 的 name 不能为空');
  const packageBytes = await buildAppTemplateArchive(appPath);
  const result = await appTemplateApiClient.publish({
    metadata: {
      templateId: marker.templateId,
      pageType: marker.pageType,
      name: manifestName,
      description: manifestDescription,
    },
    packageBytes,
  });
  marker.latestVersion = result.version;
  marker.packageOssKey = result.packageOssKey;
  marker.packageEtag = result.packageEtag;
  marker.name = manifestName;
  marker.description = manifestDescription;
  marker.updatedAt = new Date().toISOString();
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return result;
}

export async function createUserApp(input: CreateUserAppInput): Promise<CreateUserAppResult> {
  const name = input.name.trim();
  if (!name) throw new Error('应用名称不能为空');
  const pageType = normalizeSiteAppPageType(input.pageType);
  const templateId = input.templateId?.trim();
  const templateVersion = input.templateVersion?.trim();
  if (!templateId || !templateVersion) throw new Error('请选择应用模板');
  const templateSource = input.templateSource ?? 'memory-center';

  const parentDir = (input.parentDir?.trim() || DEFAULT_APPS_PARENT_DIR);
  const appPath = join(parentDir, name);
  if (existsSync(appPath)) {
    const contents = await readdir(appPath).catch(() => []);
    if (contents.length > 0) {
      throw new Error('目标文件夹已存在且不为空，请换一个名称或位置');
    }
  }

  if (templateSource === 'local-resource' && app.isPackaged) {
    throw new Error('本地资源模板仅用于开发调试');
  }
  const template = templateSource === 'local-resource'
    ? resolveLocalBuiltinTemplateDir(templateId)
    : await appTemplatePackageManager.ensureTemplate(templateId, templateVersion, pageType);
  if (templateSource === 'local-resource') {
    const manifest = JSON.parse(await readFile(join(template, 'manifest.json'), 'utf8')) as {
      templateId?: string;
      pageType?: string;
    };
    if (manifest.templateId !== templateId || manifest.pageType !== pageType) {
      throw new Error(`本地资源模板与应用类型不一致: ${templateId}`);
    }
  }
  if (!isValidReactTemplate(template)) {
    throw new Error(`应用模板缺失: ${template}`);
  }
  const templateMeta = templateSource === 'local-resource' ? {} : JSON.parse(
    await readFile(templateMetaPath(template), 'utf8'),
  ) as {
    packageOssKey?: string;
    packageEtag?: string | null;
  };

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
    source: 'created',
    pageType,
    templateId,
    templateVersion,
    packageOssKey: templateMeta.packageOssKey,
    packageEtag: templateMeta.packageEtag,
  });

  logger.info(
    `[app-dev] createUserApp local scaffold ready name=${name} appPath=${appPath} ` +
    `pageType=${pageType} (cloud app deferred until first push)`,
  );

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
  await writeAppDevWorkspaceId(appPath, workspaceId);

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
 * Local-only: does not create a cloud site app, upload source, or publish.
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
    source: 'imported',
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
  await writeAppDevWorkspaceId(appPath, workspaceId);

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
  let listed: SiteAppRecord[] = [];
  try {
    listed = dedupeSiteAppRecords(await listSiteApps());
  } catch (error) {
    logger.warn('[app-dev] listDevApps cloud list failed, showing local apps only:', error);
  }

  const bindings = await listStoAppBindings();
  const bindingByCode = new Map(bindings.map((b) => [b.appCode, b]));
  const workspaces = await listUserWorkspaces();
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]));
  const claimedWorkspaceIds = new Set<string>();
  const claimedPaths = new Set<string>();

  const cloudApps: DevAppSummary[] = [];
  for (const cloud of listed) {
    const binding = bindingByCode.get(cloud.appCode);
    let localPath = binding?.localPath?.trim() ?? '';
    let workspaceId = binding?.workspaceId?.trim() ?? '';

    // Heal binding from workspace path if missing but workspace still points here.
    if ((!localPath || !existsSync(localPath)) && workspaceId) {
      const ws = workspaceById.get(workspaceId);
      if (ws?.rootPath && existsSync(ws.rootPath)) {
        localPath = ws.rootPath;
      }
    }

    if (localPath && existsSync(localPath)) {
      const ownerCode = await readBoundAppCode(localPath);
      if (ownerCode && ownerCode !== cloud.appCode) {
        await removeStoAppBinding(cloud.appCode).catch(() => undefined);
        localPath = '';
        workspaceId = '';
      }
    }

    if (localPath && claimedPaths.has(resolve(localPath))) {
      localPath = '';
      workspaceId = '';
    }
    if (workspaceId && claimedWorkspaceIds.has(workspaceId)) {
      localPath = '';
      workspaceId = '';
    }

    // Only auto-match local folders that already have a STO workspace file.
    // Imported apps must stay local-only and must not bind by name.
    if (!localPath) {
      const match = workspaces.find((w) => {
        if (!w.rootPath || !isAppDevWorkspaceRoot(w.rootPath) || !hasStoWorkspaceFile(w.rootPath)) {
          return false;
        }
        if (claimedWorkspaceIds.has(w.id) || claimedPaths.has(resolve(w.rootPath))) return false;
        return w.name === cloud.applicationName || w.rootPath.endsWith(`${sep}${cloud.applicationName}`);
      });
      if (match) {
        const ownerCode = await readBoundAppCode(match.rootPath);
        if (!ownerCode || ownerCode === cloud.appCode) {
          localPath = match.rootPath;
          workspaceId = match.id;
        }
      }
    }

    const pathOk = Boolean(localPath) && existsSync(localPath);
    const markerOk = pathOk && isAppDevWorkspaceRoot(localPath);
    const isArchived = cloud.status?.trim().toLowerCase() === 'archived';
    if (isArchived && !pathOk) continue;

    if (workspaceId) claimedWorkspaceIds.add(workspaceId);
    if (pathOk) claimedPaths.add(resolve(localPath));
    if (pathOk && workspaceId) {
      await upsertStoAppBinding({
        appCode: cloud.appCode,
        applicationName: cloud.applicationName,
        localPath,
        workspaceId,
      }).catch(() => undefined);
    }
    if (pathOk && markerOk && workspaceId) {
      const fields = await readAppDevMarkerFields(localPath);
      if (fields.pageType !== cloud.pageType) {
        try {
          const raw = JSON.parse(await readFile(appDevMarkerPath(localPath), 'utf8')) as Partial<AppDevMarker>;
          raw.pageType = cloud.pageType;
          await writeFile(appDevMarkerPath(localPath), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
        } catch {
          // ignore
        }
      }
      const ws = workspaceById.get(workspaceId);
      cloudApps.push({
        workspaceId,
        name: cloud.applicationName || ws?.name || cloud.appCode,
        appPath: localPath,
        projectType: fields.projectType,
        createdAt: fields.createdAt || cloud.createdAt || ws?.createdAt || new Date().toISOString(),
        localReady: true,
        appCode: cloud.appCode,
        availability: 'local',
        previewUrl: cloud.previewUrl,
        permissionsUrl: cloud.permissionsUrl,
        gitlabProjectId: cloud.gitlabProjectId,
        devopsApplicationId: cloud.devopsApplicationId,
        source: fields.source ?? 'created',
        gitRepo: hasGitRepo(localPath),
        pageType: cloud.pageType ?? fields.pageType,
      });
      continue;
    }

      cloudApps.push({
        workspaceId: workspaceId || '',
        name: cloud.applicationName,
        appPath: localPath || '',
        projectType: 'frontend',
        createdAt: cloud.createdAt || binding?.updatedAt || new Date().toISOString(),
        localReady: false,
        appCode: cloud.appCode,
        availability: pathOk ? 'path-missing' : 'remote-only',
        previewUrl: cloud.previewUrl,
        permissionsUrl: cloud.permissionsUrl,
        gitlabProjectId: cloud.gitlabProjectId,
        devopsApplicationId: cloud.devopsApplicationId,
        pageType: cloud.pageType,
      });
    }

  const localApps = await listLocalOnlyDevApps({
    workspaces,
    claimedWorkspaceIds,
    claimedPaths,
  });

  const sorted = mergeAndDedupeDevApps(cloudApps, localApps);
  logger.info(
    `[app-dev] listDevApps count=${sorted.length} apps=${JSON.stringify(
      sorted.map((app) => ({
        name: app.name,
        appCode: app.appCode,
        availability: app.availability,
        localReady: app.localReady,
        workspaceId: app.workspaceId,
        previewUrl: app.previewUrl,
      })),
    )}`,
  );
  return sorted;
}

/** Resolve cloud site-app for a local workspace via binding, then list name/path. */
export async function resolveCloudAppForWorkspace(
  workspaceId: string,
  appPath?: string,
): Promise<SiteAppRecord | null> {
  const id = workspaceId.trim();
  if (!id) return null;

  const binding = await getStoAppBindingByWorkspaceId(id);
  if (binding?.appCode) {
    try {
      return await enrichSiteAppRecord(await getSiteApp(binding.appCode));
    } catch {
      const listed = await listSiteApps().catch(() => [] as SiteAppRecord[]);
      const matched = listed.find((item) => item.appCode === binding.appCode);
      if (matched) return await enrichSiteAppRecord(matched);
    }
  }

  const listed = await listSiteApps().catch(() => [] as SiteAppRecord[]);
  if (listed.length === 0) return null;

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
      appCode: matched.appCode,
      applicationName: matched.applicationName,
      localPath: path,
      workspaceId: id,
    }).catch(() => undefined);
  }

  return matched ? await enrichSiteAppRecord(matched) : null;
}

/**
 * Workspace ids that belong to 开发应用 — used to hide them from the sidebar.
 *
 * Sources (union):
 * 1. Local marker `.sclaw/app-dev.json` on the workspace root
 * 2. Workspaces under the default apps parent (`~/SClawApps`)
 * 3. sto-app bindings (workspaceId / localPath)
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

  for (const workspace of workspaces) {
    const root = workspace.rootPath?.trim();
    if (!root) continue;
    const resolvedRoot = resolve(root);
    workspaceIdByRoot.set(resolvedRoot, workspace.id);

    if (isAppDevSidebarHiddenRoot(resolvedRoot)) {
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
  appCode: string;
  applicationName?: string;
  parentDir: string;
}): Promise<CreateUserAppResult & { appCode: string }> {
  const appCode = input.appCode.trim();
  if (!appCode) throw new Error('缺少 appCode');
  const parentDir = resolve(input.parentDir.trim());
  if (!parentDir || !existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
    throw new Error('请选择有效的父目录');
  }

  const name = (input.applicationName?.trim() || appCode).trim();
  const folderName = sanitizePackageName(name) || appCode;
  const appPath = join(parentDir, folderName);
  if (existsSync(appPath)) {
    const contents = await readdir(appPath).catch(() => []);
    if (contents.length > 0) {
      throw new Error(`目标文件夹已存在且不为空：${appPath}`);
    }
  }

  const cloned = await cloneStoApp(appCode, appPath);

  let cloud: SiteAppRecord | undefined;
  try {
    cloud = await getSiteApp(appCode);
  } catch (err) {
    logger.warn('[app-dev] detail after clone skipped:', err);
    cloud = (await listSiteApps()).find((item) => item.appCode === appCode);
  }
  const workspaceFile = await writeStoWorkspaceBinding({
    appPath,
    payload: cloned.json,
    cloud: siteAppToWorkspaceFields(cloud),
    fallback: { appCode, status: cloud?.status ?? 'ready' },
  });
  if (!workspaceFile) {
    throw new Error('拉取成功但未能写入 .sto/workspace.json');
  }

  await writeAppDevBootstrap(appPath, {
    name,
    projectType: 'frontend',
    source: 'created',
    pageType: cloud?.pageType,
  });

  try {
    await ensureAppOpenspecScaffold(appPath);
    await ensureDefaultAppDevAssistSkills(appPath);
  } catch (err) {
    logger.warn('[app-dev] openspec scaffold after clone skipped:', err);
  }

  const workspace = await createWorkspace({ name, rootPath: appPath });
  const workspaceId = workspace.id;
  await writeAppDevWorkspaceId(appPath, workspaceId);

  await upsertStoAppBinding({
    appCode,
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
    appCode,
  };
}

/**
 * Remove a local 开发应用 from the catalog, optionally deleting files.
 * Files are only removed when the path still has the app-dev marker (safety).
 */
async function removeLocalDevAppCheckout(
  workspaceId: string,
  deleteFiles: boolean,
  appCode: string,
  gatewayManager?: GatewayManager | null,
): Promise<{ deletedLocal: boolean; deletedFiles: boolean; appPath: string }> {
  const { getWorkspaceRootPath } = await import('./session-catalog-service');
  const appPath = await getWorkspaceRootPath(workspaceId);
  if (appCode) {
    await removeStoAppBinding(appCode).catch(() => undefined);
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
    appCode?: string;
    workspaceId?: string;
    deleteLocal?: boolean;
  },
  gatewayManager?: GatewayManager | null,
): Promise<{ offline: boolean; deletedLocal: boolean; deletedFiles: boolean; appPath: string }> {
  const appCode = input.appCode?.trim() ?? '';
  let workspaceId = input.workspaceId?.trim() ?? '';
  if (!appCode && !workspaceId) {
    throw new Error('缺少应用标识');
  }

  let offline = false;
  if (appCode) {
    await archiveSiteApp(appCode);
    offline = true;
  }

  if (!workspaceId && appCode) {
    const binding = (await listStoAppBindings()).find((item) => item.appCode === appCode);
    workspaceId = binding?.workspaceId?.trim() ?? '';
  }

  // Cloud-only archive: keep local files unless user opted in; drop stale binding.
  if (appCode && !input.deleteLocal) {
    await removeStoAppBinding(appCode).catch(() => undefined);
    return { offline: true, deletedLocal: false, deletedFiles: false, appPath: '' };
  }

  if (!workspaceId) {
    if (appCode) {
      await removeStoAppBinding(appCode).catch(() => undefined);
    }
    return { offline, deletedLocal: false, deletedFiles: false, appPath: '' };
  }

  const removed = await removeLocalDevAppCheckout(
    workspaceId,
    input.deleteLocal === true,
    appCode,
    gatewayManager,
  );
  return { offline, ...removed };
}

function resolveAppNpmRegistry(npmCwd: string): string | undefined {
  const npmrcPath = join(npmCwd, '.npmrc');
  if (!existsSync(npmrcPath)) return undefined;
  try {
    return parseNpmrcRegistry(readFileSync(npmrcPath, 'utf8'));
  } catch {
    return undefined;
  }
}

const SNPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const SNPM_INSTALL_HEARTBEAT_MS = 5_000;
const SNPM_INSTALL_STALL_MS = 15_000;

function getSnpmInstallEnv(): NodeJS.ProcessEnv {
  return {
    ...getNodeSpawnEnv(),
    CI: '1',
    FORCE_COLOR: '0',
    npm_config_progress: 'false',
    npm_config_fund: 'false',
    npm_config_loglevel: 'http',
  } as NodeJS.ProcessEnv;
}

function killSnpmInstallChild(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      return;
    }
    child.kill('SIGTERM');
  } catch {
    // already exited
  }
}

function spawnSnpmInstallOnce(
  snpmBin: string,
  npmCwd: string,
  args: string[],
  options: {
    onActivity: (chunk: string) => void;
    shouldAbort?: () => boolean;
  },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const prepared = prepareWinSpawn(snpmBin, args);
    const child = spawn(prepared.command, prepared.args, {
      cwd: npmCwd,
      env: getSnpmInstallEnv(),
      windowsHide: true,
      shell: prepared.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tail: string[] = [];
    let settled = false;
    let abortTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const handleChunk = (chunk: unknown) => {
      const text = String(chunk);
      tail.push(text);
      if (tail.length > 40) tail.shift();
      options.onActivity(text);
    };
    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (abortTimer) clearInterval(abortTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      fn();
    };

    abortTimer = setInterval(() => {
      if (!options.shouldAbort?.()) return;
      killSnpmInstallChild(child);
      finish(() => reject(new OperationCanceledError()));
    }, 400);

    timeoutTimer = setTimeout(() => {
      killSnpmInstallChild(child);
      const output = stripInstallLogAnsi(tail.join('')).trim();
      finish(() => reject(new Error(
        `snpm install 超时（已等待 ${Math.round(SNPM_INSTALL_TIMEOUT_MS / 60000)} 分钟仍未结束）\n${output}`.trim(),
      )));
    }, SNPM_INSTALL_TIMEOUT_MS);

    child.on('close', (code) => {
      const output = stripInstallLogAnsi(tail.join('')).trim();
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`snpm install failed (code ${code})\n${output}`.trim()));
      });
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
  });
}

async function runNpmInstall(
  workspaceId: string,
  appPath: string,
  shouldReportProgress: () => boolean,
): Promise<void> {
  const npmCwd = resolveAppNpmCwd(appPath);
  const registry = resolveAppNpmRegistry(npmCwd);
  const snpmBin = await ensureSnpmBin();
  const args = buildSnpmInstallArgs(registry);
  logger.info(
    `[app-dev] snpm install start bin=${snpmBin} cwd=${npmCwd}${registry ? ` registry=${registry}` : ''}`,
  );
  let ratio = 0;
  let log = '';
  let lastActivityAt = Date.now();
  const startedAt = Date.now();
  const maxAttempts = 3;

  const publish = (detail: string) => {
    if (!shouldReportProgress()) return;
    setStatus(workspaceId, {
      phase: 'installing',
      progress: pipelineProgress('installing', ratio),
      detail,
      log: log || undefined,
    });
  };

  const heartbeat = setInterval(() => {
    if (!shouldReportProgress()) return;
    const silentMs = Date.now() - lastActivityAt;
    if (silentMs < SNPM_INSTALL_STALL_MS) return;
    const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    publish(`正在执行 snpm install（已等待 ${elapsedSec}s，暂无新输出）`);
  }, SNPM_INSTALL_HEARTBEAT_MS);

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await spawnSnpmInstallOnce(snpmBin, npmCwd, args, {
          onActivity: (chunk) => {
            ratio = creepRatio(ratio);
            lastActivityAt = Date.now();
            if (!chunk) {
              publish('正在执行 snpm install');
              return;
            }
            log = pushInstallLogTail(log, chunk);
            const last = lastInstallLogLine(log);
            publish(last || '正在执行 snpm install');
          },
          shouldAbort: () => !shouldReportProgress(),
        });
        return;
      } catch (error) {
        if (error instanceof OperationCanceledError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        log = pushInstallLogTail(log, `\n${message}`);
        const retry = attempt < maxAttempts && isTransientNpmInstallFailure(message);
        if (!retry) {
          logger.error(`[app-dev] snpm install failed cwd=${npmCwd}: ${message}`);
          throw error;
        }
        logger.warn(`[app-dev] snpm install retry ${attempt}/${maxAttempts - 1}: ${message.split('\n')[0]}`);
        publish(`安装失败，正在重试（${attempt}/${maxAttempts - 1}）`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Background pipeline: managed Node -> npm install -> dev server, reported as
 * one continuous 0-100 progress. Also used to resume/start an existing app.
 */
export async function runSetupPipeline(workspaceId: string, appPath: string): Promise<void> {
  const pipeline = setupPipelineGenerations.begin(workspaceId);
  const isCurrent = pipeline.isCurrent;
  try {
    pipeline.throwIfCanceled();
    if (!isNodeRuntimeReady()) {
      setStatus(workspaceId, { appPath, phase: 'preparing-env', progress: pipelineProgress('preparing-env', 0) });
      const poll = setInterval(() => {
        const runtime = getNodeRuntimeStatus();
        const ratio = runtime.totalBytes > 0 ? runtime.receivedBytes / runtime.totalBytes : 0;
        if (isCurrent()) {
          setStatus(workspaceId, {
            phase: 'preparing-env',
            progress: pipelineProgress('preparing-env', ratio),
          });
        }
      }, 500);
      try {
        await setupManagedNode();
      } finally {
        clearInterval(poll);
      }
      pipeline.throwIfCanceled();
    }

    const needsDeps = needsAppNpmInstall(resolveAppNpmCwd(appPath));
    const foundSnpm = resolveSnpmBin();
    setStatus(workspaceId, {
      phase: 'checking-snpm',
      progress: pipelineProgress('checking-snpm', foundSnpm ? 0.85 : 0.2),
      error: undefined,
      log: undefined,
      detail: foundSnpm
        ? '本机已安装 snpm'
        : needsDeps
          ? '未检测到 snpm，正在安装…'
          : '未检测到 snpm（当前依赖已就绪，跳过安装）',
    });
    if (needsDeps) {
      await ensureSnpmBin();
      pipeline.throwIfCanceled();
      setStatus(workspaceId, {
        phase: 'checking-snpm',
        progress: pipelineProgress('checking-snpm', 1),
        detail: 'snpm 已就绪',
      });
      setStatus(workspaceId, {
        phase: 'installing',
        progress: pipelineProgress('installing', 0),
        detail: '正在执行 snpm install',
        error: undefined,
        log: undefined,
      });
      await runNpmInstall(workspaceId, appPath, isCurrent);
      pipeline.throwIfCanceled();
    }

    setStatus(workspaceId, {
      phase: 'starting',
      progress: pipelineProgress('starting', 0.3),
      detail: '正在启动预览服务',
      log: undefined,
    });
    const marker = await readAppDevMarker(appPath);
    if (isFullstackAppMarker(marker)) {
      setStatus(workspaceId, {
        detail: '正在启动全栈运行时（migrate → 后端 → 前端）',
      });
      const runtime = await startRuntime(workspaceId, appPath);
      pipeline.throwIfCanceled();
      setStatus(workspaceId, {
        phase: 'ready',
        progress: 100,
        previewUrl: runtime.previewUrl,
        backendUrl: runtime.backendUrl,
        dbStatus: runtime.dbStatus,
        error: undefined,
        detail: undefined,
        log: undefined,
      });
    } else {
      const entry = await startDevServer(workspaceId, appPath);
      pipeline.throwIfCanceled();
      setStatus(workspaceId, {
        phase: 'ready',
        progress: 100,
        previewUrl: entry.previewUrl,
        backendUrl: undefined,
        dbStatus: undefined,
        error: undefined,
        detail: undefined,
        log: undefined,
      });
    }
  } catch (err) {
    if (err instanceof OperationCanceledError || !isCurrent()) return;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[app-dev] setup pipeline failed workspaceId=${workspaceId}: ${message}`);
    setStatus(workspaceId, { phase: 'error', progress: 0, error: message, previewUrl: undefined });
    throw err;
  }
}

export function stopApp(workspaceId: string): void {
  setupPipelineGenerations.cancel(workspaceId);
  stopRuntime(workspaceId);
  setStatus(workspaceId, {
    phase: 'stopped',
    progress: 0,
    previewUrl: undefined,
    backendUrl: undefined,
    dbStatus: undefined,
  });
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

export type AppCheckpointCreationStatus = 'created' | 'clean-head' | 'failed';

export interface AppCheckpointCreateResult {
  status: AppCheckpointCreationStatus;
  /** 新 commit 的 hash（clean-head 时为当前 HEAD）。 */
  hash?: string;
}

/**
 * 创建 checkpoint 并返回 commit hash（P1 交互改造 T04）：
 * hash 随轮次结束回传给渲染侧，建立 turn ↔ commit 映射。
 */
export async function createCheckpointDetailed(
  appPath: string,
  message: string,
): Promise<AppCheckpointCreateResult> {
  if (!(await ensureLocalGitRepo(appPath))) return { status: 'failed' };
  const status = await runGit(appPath, ['status', '--porcelain']);
  if (!status.ok) return { status: 'failed' };
  if (!status.output) {
    const head = await runGit(appPath, ['rev-parse', '--verify', 'HEAD']);
    return head.ok ? { status: 'clean-head', hash: head.output } : { status: 'failed' };
  }
  const add = await runGit(appPath, ['add', '-A']);
  if (!add.ok) return { status: 'failed' };
  const commit = await runGit(appPath, ['commit', '-m', message || '应用更新']);
  if (!commit.ok) return { status: 'failed' };
  const head = await runGit(appPath, ['rev-parse', 'HEAD']);
  return { status: 'created', hash: head.ok ? head.output : undefined };
}

export async function createCheckpointWithStatus(
  appPath: string,
  message: string,
): Promise<AppCheckpointCreationStatus> {
  return (await createCheckpointDetailed(appPath, message)).status;
}

export async function createCheckpoint(appPath: string, message: string): Promise<boolean> {
  return (await createCheckpointWithStatus(appPath, message)) === 'created';
}

export async function listCheckpoints(appPath: string, limit = 20): Promise<AppCheckpoint[]> {
  if (!(await ensureLocalGitRepo(appPath))) return [];
  const log = await runGit(appPath, ['log', `-${limit}`, '--pretty=format:%H%x09%ct%x09%s']);
  if (!log.ok || !log.output) return [];
  return log.output.split('\n').map((line) => {
    const [hash, ts, ...subject] = line.split('\t');
    return { hash, timestamp: Number(ts) * 1000, subject: subject.join('\t') };
  });
}

export interface RestoreCheckpointResult {
  restored: boolean;
  backupRef?: string;
  /** Human-readable failure reason for UI toast. */
  error?: string;
}

/**
 * Restore the working tree to a local checkpoint (default: previous one).
 * Local-only: does not push / roll back cloud source or deployments.
 */
export async function restoreCheckpoint(
  appPath: string,
  hash?: string,
): Promise<RestoreCheckpointResult> {
  if (!(await isGitAvailable())) {
    return { restored: false, error: '本机未安装 Git，无法恢复本地版本' };
  }
  if (!(await ensureLocalGitRepo(appPath))) {
    return { restored: false, error: '无法初始化本地版本仓库' };
  }

  // Preserve any uncommitted work in the backup too (best-effort).
  await createCheckpoint(appPath, '恢复前自动保存').catch(() => false);

  const backupRef = `sclaw-backup-${Date.now()}`;
  const branch = await runGit(appPath, ['branch', backupRef]);
  if (!branch.ok) {
    return {
      restored: false,
      error: branch.output.trim() || '创建本地备份分支失败',
    };
  }

  const target = hash?.trim() || 'HEAD~1';
  const verify = await runGit(appPath, ['rev-parse', '--verify', `${target}^{commit}`]);
  if (!verify.ok) {
    return {
      restored: false,
      backupRef,
      error: '找不到该本地版本（可能已被清理或不在本机）',
    };
  }

  const reset = await runGit(appPath, ['reset', '--hard', verify.output]);
  if (!reset.ok) {
    return {
      restored: false,
      backupRef,
      error: reset.output.trim() || '恢复本地文件失败',
    };
  }
  return { restored: true, backupRef };
}

// ── Checkpoint diff（P1 交互改造 T04：消息级「查看修改」行级 diff） ──────────

/** git 空树对象 hash：首个 commit（无父）时作为 diff 基底，父内容即空。 */
const GIT_EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** 单文件内容超过该阈值只回统计（Monaco DiffEditor 需要全量文本，防爆内存）。 */
const DIFF_MAX_FILE_BYTES = 1_000_000;
/** 单次最多回传全量内容的文件数，超出部分只回统计。 */
const DIFF_MAX_CONTENT_FILES = 50;

export type AppCheckpointDiffFileStatus = 'M' | 'A' | 'D';

export interface AppCheckpointDiffFile {
  path: string;
  status: AppCheckpointDiffFileStatus;
  /** numstat 增/删行数；二进制文件为 null。 */
  added: number | null;
  removed: number | null;
  binary?: boolean;
  /** 内容超阈值或超出带内容文件数上限：只回统计，不回 original/modified。 */
  truncated?: boolean;
  /** 父版本全文（新增文件/首个 commit 为空串）。 */
  original?: string;
  /** 本版本全文（删除文件为空串）。 */
  modified?: string;
}

export interface AppCheckpointDiff {
  hash: string;
  /** 父 commit hash；首个 commit 为 null。 */
  parentHash: string | null;
  subject: string;
  files: AppCheckpointDiffFile[];
}

/**
 * 取两个 checkpoint 之间的逐文件差异：
 * - 仅 `hash`：相对其父版本（T04 默认）
 * - `baseHash` + `hash`：任意两版对比（T10）
 */
export async function diffCheckpoint(
  appPath: string,
  hash: string,
  baseHash?: string,
): Promise<AppCheckpointDiff | null> {
  if (!(await isGitAvailable())) return null;
  const target = hash.trim();
  // hash 会拼进 git 参数（`<hash>^`），先白名单校验。
  if (!/^[0-9a-f]{4,40}$/i.test(target)) return null;
  const verify = await runGit(appPath, ['rev-parse', '--verify', `${target}^{commit}`]);
  if (!verify.ok) return null;
  const fullHash = verify.output;

  let parentHash: string | null = null;
  let base: string;
  const explicitBase = typeof baseHash === 'string' ? baseHash.trim() : '';
  if (explicitBase) {
    if (!/^[0-9a-f]{4,40}$/i.test(explicitBase)) return null;
    const baseVerify = await runGit(appPath, ['rev-parse', '--verify', `${explicitBase}^{commit}`]);
    if (!baseVerify.ok) return null;
    parentHash = baseVerify.output;
    base = parentHash;
  } else {
    const parent = await runGit(appPath, ['rev-parse', '--verify', `${fullHash}^`]);
    parentHash = parent.ok ? parent.output : null;
    base = parentHash ?? GIT_EMPTY_TREE_HASH;
  }

  const [nameStatus, numstat, subjectResult] = await Promise.all([
    runGit(appPath, ['diff', '--no-renames', '--name-status', base, fullHash]),
    runGit(appPath, ['diff', '--no-renames', '--numstat', base, fullHash]),
    runGit(appPath, ['show', '-s', '--format=%s', fullHash]),
  ]);
  if (!nameStatus.ok) return null;

  // numstat 行：`added\tremoved\tpath`（二进制为 `-\t-\tpath`）
  const stats = new Map<string, { added: number | null; removed: number | null }>();
  if (numstat.ok && numstat.output) {
    for (const line of numstat.output.split('\n')) {
      const [a, r, ...rest] = line.split('\t');
      const path = rest.join('\t');
      if (!path) continue;
      stats.set(path, {
        added: a === '-' ? null : Number(a) || 0,
        removed: r === '-' ? null : Number(r) || 0,
      });
    }
  }

  const files: AppCheckpointDiffFile[] = [];
  for (const line of nameStatus.output ? nameStatus.output.split('\n') : []) {
    const [statusRaw, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path) continue;
    const status = statusRaw?.[0] as AppCheckpointDiffFileStatus | undefined;
    if (status !== 'M' && status !== 'A' && status !== 'D') continue;
    const stat = stats.get(path);
    files.push({
      path,
      status,
      // stat 缺失（理论上不该发生）退化 0；二进制保留 null 语义。
      added: stat ? stat.added : 0,
      removed: stat ? stat.removed : 0,
      binary: stat?.added === null ? true : undefined,
    });
  }

  let contentFiles = 0;
  for (const file of files) {
    if (file.binary) continue;
    if (contentFiles >= DIFF_MAX_CONTENT_FILES) {
      file.truncated = true;
      continue;
    }
    contentFiles += 1;
    const [original, modified] = await Promise.all([
      file.status === 'A' || !parentHash
        ? Promise.resolve({ ok: true, output: '' })
        : runGitStdout(appPath, ['show', `${parentHash}:${file.path}`]),
      file.status === 'D'
        ? Promise.resolve({ ok: true, output: '' })
        : runGitStdout(appPath, ['show', `${fullHash}:${file.path}`]),
    ]);
    const originalText = original.ok ? original.output : '';
    const modifiedText = modified.ok ? modified.output : '';
    if (
      Buffer.byteLength(originalText, 'utf8') > DIFF_MAX_FILE_BYTES
      || Buffer.byteLength(modifiedText, 'utf8') > DIFF_MAX_FILE_BYTES
    ) {
      file.truncated = true;
      continue;
    }
    file.original = originalText;
    file.modified = modifiedText;
  }

  return {
    hash: fullHash,
    parentHash,
    subject: subjectResult.ok ? subjectResult.output : '',
    files,
  };
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

// ── Preview route discovery (T03 路由下拉) ──────────────────────────────────

export interface AppRouteEntry {
  /** 拼接预览地址的路径片段（`#/home`、`/home` 或 `#home`）。 */
  path: string;
  /** 展示名（路由路径或页面 id 原文）。 */
  label: string;
  /** 发现来源：router = `<Route path>` 扫描；a2ui = page.json 页面资产。 */
  source: 'router' | 'a2ui';
}

const APP_ROUTE_MAX = 30;
const APP_ROUTE_SCAN_MAX_FILES = 60;
const ROUTE_PATH_RE = /<Route\s[^>]*?\bpath\s*=\s*["']([^"'>]+)["']/g;

function normalizeRoutePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return null;
  // 带参数（/detail/:id）或通配的路由无法直接跳转，跳过。
  if (trimmed.includes(':') || trimmed.includes('*')) return null;
  const withoutLead = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
  return `/${withoutLead}`;
}

function sortAppRoutes<T extends { label: string }>(routes: T[]): T[] {
  return [...routes].sort((a, b) => {
    const score = (label: string) => {
      const clean = label.replace(/^\/+/, '').toLowerCase();
      if (clean === '' || clean === 'home' || clean === 'index') return 0;
      return 1;
    };
    const diff = score(a.label) - score(b.label);
    return diff !== 0 ? diff : a.label.localeCompare(b.label);
  });
}

/** 通用 React 应用：扫描 src 下 tsx/jsx 中的 `<Route path="...">`，并按入口判定 Hash/Browser Router。 */
async function scanRouterRoutes(appPath: string): Promise<AppRouteEntry[]> {
  const files = await listAppSourceFiles(appPath);
  // 兼容模板应用（src/ 根部）与导入工程（frontend/src/ 等嵌套布局）。
  const candidates = files
    .filter((f) => /(?:^|\/)src\/[^/].*\.(tsx|jsx)$/.test(f.path))
    .slice(0, APP_ROUTE_SCAN_MAX_FILES);
  const found = new Map<string, AppRouteEntry>();
  let hashRouter = false;
  for (const file of candidates) {
    let content = '';
    try {
      content = (await readAppSourceFile(appPath, file.path)).content;
    } catch {
      continue;
    }
    if (content.includes('HashRouter')) hashRouter = true;
    ROUTE_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROUTE_PATH_RE.exec(content)) !== null) {
      const normalized = normalizeRoutePath(match[1] ?? '');
      if (!normalized || found.has(normalized)) continue;
      found.set(normalized, {
        path: normalized,
        label: normalized,
        source: 'router',
      });
      if (found.size >= APP_ROUTE_MAX) break;
    }
    if (found.size >= APP_ROUTE_MAX) break;
  }
  // 扫描后期才确认 HashRouter：统一重写 path 片段。
  const routes = [...found.values()].map((route) => ({
    ...route,
    path: hashRouter ? `#${route.label}` : route.label,
  }));
  return sortAppRoutes(routes);
}

/** A2UI 应用：`src/pages/*.page.json` 文件名即页面 id，经 `#<id>` hash 切换。 */
async function scanA2uiRoutes(appPath: string): Promise<AppRouteEntry[]> {
  const pagesDir = ['src', 'frontend/src']
    .map((dir) => join(appPath, dir, 'pages'))
    .find((dir) => existsSync(dir) && statSync(dir).isDirectory());
  if (!pagesDir) return [];
  const entries = await readdir(pagesDir);
  const routes: AppRouteEntry[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith('.page.json')) continue;
    const id = name.slice(0, -'.page.json'.length).trim();
    if (!id) continue;
    routes.push({ path: `#${id}`, label: id, source: 'a2ui' });
    if (routes.length >= APP_ROUTE_MAX) break;
  }
  return sortAppRoutes(routes);
}

/**
 * 预览路由发现：优先通用 React 路由声明，其次 A2UI 页面资产；
 * 都未发现时返回空数组，由渲染侧兜底为「当前地址」单条。
 */
export async function listAppRoutes(appPath: string): Promise<AppRouteEntry[]> {
  if (!existsSync(appPath) || !statSync(appPath).isDirectory()) return [];
  const routerRoutes = await scanRouterRoutes(appPath).catch(() => [] as AppRouteEntry[]);
  if (routerRoutes.length > 0) return routerRoutes;
  return scanA2uiRoutes(appPath).catch(() => [] as AppRouteEntry[]);
}

// ── Theme tune / artifacts / preview capture (P1 T06 / T09) ─────────────────

const DESIGN_TOKENS_CONTRACT_REL = join('contracts', 'design-tokens.v1.json');
const THEME_CSS_REL = join('src', 'theme', 'theme.css');
const ARTIFACTS_REL = join('.sclaw', 'app-dev-artifacts.json');
const TUNE_OVERRIDES_REL = join('.sclaw', 'tune-overrides.json');

export interface AppDevDesignTokenDef {
  name: string;
  label: string;
  type: 'color' | 'font' | 'radius';
  format?: 'oklch' | 'rem';
  group: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface AppDevDesignTokensContract {
  schemaVersion: number;
  source: string;
  tokens: AppDevDesignTokenDef[];
  /** true = 模板无契约，宿主使用内置默认项。 */
  degraded: boolean;
}

const DEFAULT_DESIGN_TOKENS: AppDevDesignTokenDef[] = [
  { name: '--sto-color-bg-layout', label: '页面背景', type: 'color', format: 'oklch', group: '颜色' },
  { name: '--sto-color-primary', label: '主题色', type: 'color', format: 'oklch', group: '颜色' },
  { name: '--sto-color-text', label: '正文色', type: 'color', format: 'oklch', group: '颜色' },
  {
    name: '--sto-font-family',
    label: '正文字体',
    type: 'font',
    group: '字体',
    options: [
      '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      'Georgia, "Times New Roman", serif',
      'Menlo, Consolas, monospace',
    ],
  },
  { name: '--sto-radius-lg', label: '卡片圆角', type: 'radius', format: 'rem', group: '圆角', min: 0, max: 1 },
  { name: '--sto-color-border', label: '边框色', type: 'color', format: 'oklch', group: '颜色' },
];

function normalizeDesignTokenDefs(raw: unknown): AppDevDesignTokenDef[] {
  if (!Array.isArray(raw)) return [];
  const out: AppDevDesignTokenDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== 'string' || !rec.name.startsWith('--')) continue;
    if (typeof rec.label !== 'string') continue;
    if (rec.type !== 'color' && rec.type !== 'font' && rec.type !== 'radius') continue;
    out.push({
      name: rec.name,
      label: rec.label,
      type: rec.type,
      format: rec.format === 'oklch' || rec.format === 'rem' ? rec.format : undefined,
      group: typeof rec.group === 'string' ? rec.group : '其他',
      options: Array.isArray(rec.options)
        ? rec.options.filter((x): x is string => typeof x === 'string')
        : undefined,
      min: typeof rec.min === 'number' ? rec.min : undefined,
      max: typeof rec.max === 'number' ? rec.max : undefined,
    });
  }
  return out;
}

export async function readAppDesignTokens(appPath: string): Promise<AppDevDesignTokensContract> {
  const contractPath = join(appPath, DESIGN_TOKENS_CONTRACT_REL);
  if (!existsSync(contractPath)) {
    return {
      schemaVersion: 1,
      source: THEME_CSS_REL,
      tokens: DEFAULT_DESIGN_TOKENS,
      degraded: true,
    };
  }
  try {
    const raw = JSON.parse(await readFile(contractPath, 'utf8')) as Record<string, unknown>;
    const tokens = normalizeDesignTokenDefs(raw.tokens);
    if (tokens.length === 0) {
      return {
        schemaVersion: 1,
        source: THEME_CSS_REL,
        tokens: DEFAULT_DESIGN_TOKENS,
        degraded: true,
      };
    }
    return {
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
      source: typeof raw.source === 'string' ? raw.source : THEME_CSS_REL,
      tokens,
      degraded: false,
    };
  } catch {
    return {
      schemaVersion: 1,
      source: THEME_CSS_REL,
      tokens: DEFAULT_DESIGN_TOKENS,
      degraded: true,
    };
  }
}

/** 行级替换 theme.css 中 `--name: value;` 的值部；不存在的变量追加到 `:root` 块末尾。 */
export async function applyAppThemeOverrides(
  appPath: string,
  overrides: Record<string, string>,
): Promise<{ updated: string[]; themePath: string }> {
  const themePath = join(appPath, THEME_CSS_REL);
  if (!existsSync(themePath)) {
    throw Object.assign(new Error('未找到 src/theme/theme.css，无法落盘主题'), { statusCode: 404 });
  }
  let css = await readFile(themePath, 'utf8');
  const updated: string[] = [];
  const missing: Array<{ name: string; value: string }> = [];

  for (const [rawName, rawValue] of Object.entries(overrides)) {
    const name = rawName.trim();
    const value = String(rawValue ?? '').trim();
    if (!name.startsWith('--') || !value) continue;
    const re = new RegExp(`(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*)([^;]+)(;)`);
    if (re.test(css)) {
      css = css.replace(re, `$1${value}$3`);
      updated.push(name);
    } else {
      missing.push({ name, value });
    }
  }

  if (missing.length > 0) {
    const insert = missing.map(({ name, value }) => `  ${name}: ${value};`).join('\n');
    const rootClose = css.indexOf('}', css.indexOf(':root'));
    if (rootClose > 0) {
      css = `${css.slice(0, rootClose)}${insert}\n${css.slice(rootClose)}`;
      updated.push(...missing.map((m) => m.name));
    }
  }

  await writeFile(themePath, css.endsWith('\n') ? css : `${css}\n`, 'utf8');
  const sclawDir = join(appPath, '.sclaw');
  await mkdir(sclawDir, { recursive: true });
  await writeFile(
    join(appPath, TUNE_OVERRIDES_REL),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), overrides }, null, 2)}\n`,
    'utf8',
  );
  return { updated, themePath: THEME_CSS_REL };
}

export interface AppDevArtifactRecord {
  id: string;
  turnKey: string;
  commitHash?: string;
  title: string;
  thumbnailDataUrl?: string;
  previewUrl?: string;
  createdAt: string;
  favorite: boolean;
  suggestions: Array<{ label: string; prompt: string }>;
}

export async function listAppArtifacts(appPath: string): Promise<AppDevArtifactRecord[]> {
  const path = join(appPath, ARTIFACTS_REL);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { items?: unknown };
    if (!Array.isArray(raw.items)) return [];
    return raw.items.filter((item): item is AppDevArtifactRecord => {
      return Boolean(item && typeof item === 'object' && typeof (item as AppDevArtifactRecord).id === 'string');
    });
  } catch {
    return [];
  }
}

export async function putAppArtifacts(
  appPath: string,
  items: AppDevArtifactRecord[],
): Promise<AppDevArtifactRecord[]> {
  const sclawDir = join(appPath, '.sclaw');
  await mkdir(sclawDir, { recursive: true });
  const normalized = items.slice(0, 50);
  await writeFile(
    join(appPath, ARTIFACTS_REL),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), items: normalized }, null, 2)}\n`,
    'utf8',
  );
  return normalized;
}

/**
 * 预览截图：按 webContentsId capturePage → 缩放到宽 480 JPEG q=70。
 * 失败抛错，由路由返回占位由渲染侧处理。
 */
export async function captureAppPreviewByWebContentsId(
  webContentsId: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { webContents } = await import('electron');
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) {
    throw Object.assign(new Error('预览 webContents 不可用'), { statusCode: 409 });
  }
  const image = await wc.capturePage();
  const size = image.getSize();
  const targetW = 480;
  const scale = targetW / Math.max(1, size.width);
  const targetH = Math.max(1, Math.round(size.height * scale));
  const resized = typeof image.resize === 'function'
    ? image.resize({ width: targetW, height: targetH })
    : image;
  const jpeg = resized.toJPEG(70);
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width: targetW,
    height: targetH,
  };
}

/** 生成资产扫描（T14）：图片 / 文档 / 导出文件，跳过源码与依赖目录。 */
const GENERATED_ASSET_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.csv', '.zip', '.tar', '.gz', '.mp4', '.webm', '.mp3',
]);

const GENERATED_ASSET_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'coverage',
  '.next', '.turbo', '.cache', 'src', 'contracts', 'openspec',
]);

export interface AppGeneratedAsset {
  path: string;
  name: string;
  size: number;
  ext: string;
  mtimeMs: number;
  kind: 'image' | 'document' | 'archive' | 'media' | 'other';
}

function classifyGeneratedAsset(ext: string): AppGeneratedAsset['kind'] {
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext)) return 'image';
  if (['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv'].includes(ext)) return 'document';
  if (['.zip', '.tar', '.gz'].includes(ext)) return 'archive';
  if (['.mp4', '.webm', '.mp3'].includes(ext)) return 'media';
  return 'other';
}

async function walkGeneratedAssets(
  root: string,
  dir: string,
  out: AppGeneratedAsset[],
  maxFiles: number,
): Promise<void> {
  if (out.length >= maxFiles) return;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (GENERATED_ASSET_SKIP_DIRS.has(entry.name)) continue;
      await walkGeneratedAssets(root, full, out, maxFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!GENERATED_ASSET_EXTS.has(ext)) continue;
    try {
      const st = await stat(full);
      const rel = relative(root, full).split(sep).join('/');
      out.push({
        path: rel,
        name: entry.name,
        size: st.size,
        ext,
        mtimeMs: st.mtimeMs,
        kind: classifyGeneratedAsset(ext),
      });
    } catch {
      // skip unreadable
    }
  }
}

export async function listAppGeneratedAssets(appPath: string): Promise<AppGeneratedAsset[]> {
  if (!existsSync(appPath) || !statSync(appPath).isDirectory()) return [];
  const out: AppGeneratedAsset[] = [];
  await walkGeneratedAssets(appPath, appPath, out, 200);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** T14：另存为下载生成资产（save dialog → copy）。 */
export async function exportAppGeneratedAsset(
  appPath: string,
  relativePath: string,
): Promise<{ saved: boolean; savedPath?: string }> {
  const full = assertPathInsideApp(appPath, relativePath);
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new Error('文件不存在');
  }
  const name = basename(full);
  const result = await dialog.showSaveDialog({
    title: '下载文件',
    defaultPath: join(homedir(), 'Downloads', name),
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await copyFile(full, result.filePath);
  return { saved: true, savedPath: result.filePath };
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
    const prepared = prepareWinSpawn(command, args, options.shell || undefined);
    const child = spawn(prepared.command, prepared.args, {
      cwd: options.cwd,
      env: options.env,
      shell: prepared.shell,
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

  const snpmBin = await ensureSnpmBin();
  const registry = resolveAppNpmRegistry(npmCwd);
  const outputs: string[] = [];
  for (const name of packageNames) {
    const packageName = assertNpmPackageName(name);
    const result = await collectSpawnOutput(
      snpmBin,
      buildSnpmInstallArgs(registry, [packageName]),
      { cwd: npmCwd, env: getNodeSpawnEnv() as NodeJS.ProcessEnv },
    );
    if (!result.ok) {
      throw new Error(`snpm install ${packageName} 失败\n${result.output}`);
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

  // Existing catalogs belong to their selected template. Plugin upgrades are explicit and must not
  // be overwritten by the client's fallback engineering template.
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
  const defaults = ['openspec', 'nl-page-from-sai', 'sto-pc-visual'] as const;
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

  let sourceDir = join(appOpenspecCatalogRoot(appPath), skillId);
  if (!existsSync(join(sourceDir, 'SKILL.md'))) {
    sourceDir = join(templateDir(), 'openspec', 'skill-catalog', skillId);
  }
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
