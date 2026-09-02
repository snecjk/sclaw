import { existsSync } from 'node:fs';
import {
  copyFile as copyFileOnDisk,
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  realpath,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { ExternalServiceBindingSnapshot } from '../../shared/external-service-contract';
import type {
  TemplateImportApplyResult,
  TemplateImportPreview,
  TemplateImportStatus,
} from '../../shared/app-template-source-import';
import {
  createCheckpointWithStatus,
  isGitAvailable,
  readAppTemplateWorkspaceMarker,
  restartApp,
  type AppTemplateWorkspaceMarker,
} from './app-dev-service';
import { listExternalServiceBindings } from './app-external-service-binding';
import {
  scanTemplateSource,
  type PreparedTemplateImport,
} from './app-template-import-scanner';
import {
  defaultAppTemplateImportSessionStore,
  type AppTemplateImportSessionStore,
} from './app-template-import-session-store';
import {
  readTemplateImportState,
  type TemplateImportLocalState,
} from './app-template-import-state';
import { templateImportStatePath, writeTemplateImportState } from './app-template-import-state';
import { getWorkspaceRootPath } from './session-catalog-service';
import { createManagedSourceEntry, createManagedViteFiles } from './app-template-import-adapter';
import { classifyTemplateImportPath } from './app-template-import-rules';

const SSO_AUTH_PACKAGE = '@sto/sclaw-plugin-sso-auth';
const activeApplyTargets = new Set<string>();

export interface AppTemplateSourceImportDependencies {
  getWorkspaceRootPath(workspaceId: string): Promise<string | null>;
  readMarker(templateRoot: string): Promise<AppTemplateWorkspaceMarker>;
  readState(templateRoot: string): Promise<TemplateImportLocalState | null>;
  scan(input: Parameters<typeof scanTemplateSource>[0]): Promise<PreparedTemplateImport>;
  listBindings(templateRoot: string): Promise<ExternalServiceBindingSnapshot[]>;
  isGitAvailable(): Promise<boolean>;
  pathExists(path: string): boolean;
  canonicalizePath(path: string): Promise<string>;
  sessionStore: AppTemplateImportSessionStore;
  createCheckpoint(
    templateRoot: string,
    message: string,
  ): Promise<'created' | 'clean-head' | 'failed'>;
  restartApp(workspaceId: string, templateRoot: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  writeState(templateRoot: string, state: TemplateImportLocalState): Promise<void>;
}

const defaultDependencies: AppTemplateSourceImportDependencies = {
  getWorkspaceRootPath,
  readMarker: readAppTemplateWorkspaceMarker,
  readState: readTemplateImportState,
  scan: scanTemplateSource,
  listBindings: listExternalServiceBindings,
  isGitAvailable,
  pathExists: existsSync,
  canonicalizePath: realpath,
  sessionStore: defaultAppTemplateImportSessionStore,
  createCheckpoint: createCheckpointWithStatus,
  restartApp,
  copyFile: copyFileOnDisk,
  writeState: writeTemplateImportState,
};

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function pathsOverlap(left: string, right: string): boolean {
  const leftToRight = relative(resolve(left), resolve(right));
  const rightToLeft = relative(resolve(right), resolve(left));
  return leftToRight === ''
    || (!leftToRight.startsWith('..') && !leftToRight.startsWith('/'))
    || (!rightToLeft.startsWith('..') && !rightToLeft.startsWith('/'));
}

async function resolveTemplateWorkspace(
  workspaceId: string,
  dependencies: AppTemplateSourceImportDependencies,
): Promise<{ templateRoot: string; marker: AppTemplateWorkspaceMarker }> {
  const templateRoot = await dependencies.getWorkspaceRootPath(workspaceId);
  if (!templateRoot) throw badRequest('模板工作区不存在');
  try {
    return { templateRoot, marker: await dependencies.readMarker(templateRoot) };
  } catch {
    throw badRequest('当前工作区不是应用模板');
  }
}

export async function getAppTemplateImportStatus(
  input: { workspaceId: string },
  dependencies: AppTemplateSourceImportDependencies = defaultDependencies,
): Promise<TemplateImportStatus> {
  const { templateRoot } = await resolveTemplateWorkspace(input.workspaceId, dependencies);
  const state = await dependencies.readState(templateRoot);
  if (!state) return { hasSource: false, sourceAvailable: false };
  return {
    hasSource: true,
    sourceName: basename(state.sourcePath),
    sourceAvailable: dependencies.pathExists(state.sourcePath),
    lastImportedAt: state.importedAt,
  };
}

export async function prepareAppTemplateSourceImport(
  input: { workspaceId: string; sourcePath?: string },
  dependencies: AppTemplateSourceImportDependencies = defaultDependencies,
): Promise<TemplateImportPreview> {
  const { templateRoot, marker } = await resolveTemplateWorkspace(input.workspaceId, dependencies);
  const state = input.sourcePath ? null : await dependencies.readState(templateRoot);
  const sourcePath = input.sourcePath?.trim() || state?.sourcePath;
  if (!sourcePath) throw badRequest('请选择来源项目目录');
  if (!dependencies.pathExists(sourcePath)) throw badRequest('来源项目目录不存在');
  if (pathsOverlap(templateRoot, sourcePath)) {
    throw badRequest('来源项目不能是模板目录或其父子目录');
  }

  const bindings = await dependencies.listBindings(templateRoot);
  const managedPackages = [...new Set([
    SSO_AUTH_PACKAGE,
    ...bindings.flatMap((binding) => binding.integration?.npmPackage ?? []),
  ])].sort();
  let prepared: PreparedTemplateImport;
  try {
    prepared = await dependencies.scan({
      templateRoot,
      sourcePath,
      pageType: marker.pageType,
      managedPackages,
    });
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : '来源项目扫描失败');
  }
  if (!(await dependencies.isGitAvailable())) {
    prepared.preview.issues.push({
      code: 'GIT_UNAVAILABLE',
      level: 'blocker',
      message: '当前环境无法使用 Git，不能创建上传前恢复点',
    });
  }
  const session = dependencies.sessionStore.create(input.workspaceId, prepared, {
    templateRoot: await dependencies.canonicalizePath(templateRoot),
    templateId: marker.templateId,
  });
  return { ...prepared.preview, ...session };
}

export async function cancelAppTemplateSourceImport(
  input: { workspaceId: string; importToken: string },
  dependencies: AppTemplateSourceImportDependencies = defaultDependencies,
): Promise<{ cancelled: boolean }> {
  await resolveTemplateWorkspace(input.workspaceId, dependencies);
  return {
    cancelled: await dependencies.sessionStore.cancel(input.importToken, input.workspaceId),
  };
}

const SOURCE_VITE_CONFIGS = [
  'vite.config.source.ts',
  'vite.config.source.js',
  'vite.config.source.mjs',
  'vite.config.source.mts',
] as const;

interface RecoveryFile {
  path: string;
  existed: boolean;
}

async function backupMutationFiles(
  templateRoot: string,
  paths: string[],
  recoveryRoot: string,
  copyFile: AppTemplateSourceImportDependencies['copyFile'],
): Promise<RecoveryFile[]> {
  const files: RecoveryFile[] = [];
  for (const path of [...new Set(paths)].sort()) {
    await assertSafeMutationPath(templateRoot, path);
    const source = join(templateRoot, path);
    const existed = existsSync(source);
    files.push({ path, existed });
    if (!existed) continue;
    const destination = join(recoveryRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  return files;
}

async function assertSafeMutationPath(templateRoot: string, path: string): Promise<void> {
  const root = await realpath(templateRoot);
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw badRequest(`模板目标路径不能包含符号链接: ${path}`);
      }
      const canonical = await realpath(current);
      if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) {
        throw badRequest(`模板目标路径越界: ${path}`);
      }
    } catch (error) {
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }
}

async function restoreMutationFiles(
  templateRoot: string,
  recoveryRoot: string,
  files: RecoveryFile[],
  copyFile: AppTemplateSourceImportDependencies['copyFile'],
): Promise<void> {
  for (const file of [...files].reverse()) {
    const target = join(templateRoot, file.path);
    await rm(target, { recursive: true, force: true });
    if (!file.existed) continue;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(recoveryRoot, file.path), target);
  }
}

async function removeEmptyParents(templateRoot: string, path: string): Promise<void> {
  let current = dirname(join(templateRoot, path));
  const root = resolve(templateRoot);
  while (resolve(current) !== root && resolve(current).startsWith(`${root}/`)) {
    try {
      await rmdir(current);
      current = dirname(current);
    } catch {
      return;
    }
  }
}

function readManifestIdentity(raw: string): {
  schemaVersion: unknown;
  templateId: unknown;
  pageType: unknown;
} {
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  return {
    schemaVersion: manifest.schemaVersion,
    templateId: manifest.templateId,
    pageType: manifest.pageType,
  };
}

async function applyAppTemplateSourceImportExclusive(
  input: { workspaceId: string; importToken: string },
  dependencies: AppTemplateSourceImportDependencies = defaultDependencies,
): Promise<TemplateImportApplyResult> {
  const session = dependencies.sessionStore.take(input.importToken, input.workspaceId);
  const { prepared } = session;
  let recoveryRoot: string | null = null;
  let recoveryFiles: RecoveryFile[] = [];
  let mutationsStarted = false;
  let templateRoot: string | null = null;

  try {
    const resolvedWorkspace = await resolveTemplateWorkspace(input.workspaceId, dependencies);
    templateRoot = resolvedWorkspace.templateRoot;
    const { marker } = resolvedWorkspace;
    const canonicalTemplateRoot = await dependencies.canonicalizePath(templateRoot);
    if (
      !session.identity
      || session.identity.templateRoot !== canonicalTemplateRoot
      || session.identity.templateId !== marker.templateId
    ) {
      throw badRequest('导入会话与当前模板身份不一致，请重新扫描');
    }
    if (prepared.preview.pageType !== marker.pageType) {
      throw badRequest('导入会话与当前模板类型不一致，请重新扫描');
    }
    if (prepared.preview.issues.some((issue) => issue.level === 'blocker')) {
      throw badRequest('来源项目存在阻断问题，请修复后重新扫描');
    }
    const checkpointStatus = await dependencies.createCheckpoint(
      templateRoot,
      '上传项目前自动保存',
    );
    if (checkpointStatus === 'failed') throw new Error('无法创建上传前 Git 恢复点');
    const checkpointCreated = checkpointStatus === 'created';

    const manifestPath = join(templateRoot, 'manifest.json');
    const originalIdentity = readManifestIdentity(await readFile(manifestPath, 'utf8'));
    if (
      originalIdentity.templateId !== marker.templateId
      || originalIdentity.pageType !== marker.pageType
      || originalIdentity.schemaVersion !== 1
    ) {
      throw badRequest('模板 Manifest 身份与工作区不一致');
    }

    recoveryRoot = await mkdtemp(join(tmpdir(), 'sclaw-template-import-recovery-'));
    const mutationPaths = [
      ...prepared.preview.changes.map((change) => change.path),
      ...Object.keys(prepared.importFiles),
      'package.json',
      'src/main.tsx',
      'vite.config.ts',
      'vite.config.sclaw.ts',
      ...SOURCE_VITE_CONFIGS,
      relative(templateRoot, templateImportStatePath(templateRoot)),
    ];
    recoveryFiles = await backupMutationFiles(
      templateRoot,
      mutationPaths,
      recoveryRoot,
      dependencies.copyFile,
    );
    mutationsStarted = true;

    for (const change of prepared.preview.changes) {
      if (change.kind !== 'delete') continue;
      if (classifyTemplateImportPath(change.path) !== 'business') {
        throw badRequest(`不能删除平台保护文件: ${change.path}`);
      }
      await assertSafeMutationPath(templateRoot, change.path);
      await rm(join(templateRoot, change.path), { force: true });
      await removeEmptyParents(templateRoot, change.path);
    }

    for (const path of SOURCE_VITE_CONFIGS) {
      if (path !== prepared.sourceViteConfig?.stagedPath) {
        await rm(join(templateRoot, path), { force: true });
      }
    }
    for (const path of Object.keys(prepared.importFiles).sort()) {
      if (path === 'package.json') continue;
      if (classifyTemplateImportPath(path) !== 'business') {
        throw badRequest(`不能覆盖平台保护文件: ${path}`);
      }
      await assertSafeMutationPath(templateRoot, path);
      const destination = join(templateRoot, path);
      await mkdir(dirname(destination), { recursive: true });
      await dependencies.copyFile(join(prepared.snapshotRoot, path), destination);
    }

    if (!prepared.sourceEntry) throw badRequest('来源项目缺少可包装的入口文件');
    await writeFile(
      join(templateRoot, 'src/main.tsx'),
      createManagedSourceEntry({
        pageType: marker.pageType,
        sourceEntry: prepared.sourceEntry.stagedPath,
      }),
      'utf8',
    );

    const platformVitePath = join(templateRoot, 'vite.config.sclaw.ts');
    if (!existsSync(platformVitePath)) {
      await dependencies.copyFile(join(templateRoot, 'vite.config.ts'), platformVitePath);
    }
    const viteFiles = createManagedViteFiles({
      sourceExtension: prepared.sourceViteConfig?.extension,
    });
    await writeFile(join(templateRoot, 'vite.config.ts'), viteFiles['vite.config.ts']!, 'utf8');
    await writeFile(
      join(templateRoot, 'package.json'),
      `${JSON.stringify(prepared.mergedPackageJson, null, 2)}\n`,
      'utf8',
    );

    const currentIdentity = readManifestIdentity(await readFile(manifestPath, 'utf8'));
    if (JSON.stringify(currentIdentity) !== JSON.stringify(originalIdentity)) {
      throw new Error('上传过程中模板 Manifest 身份发生变化');
    }
    const importedAt = new Date().toISOString();
    await dependencies.writeState(templateRoot, {
      schemaVersion: 1,
      sourcePath: prepared.sourcePath,
      sourceFingerprint: prepared.sourceFingerprint,
      importedAt,
      files: prepared.importFiles,
    });

    await dependencies.restartApp(input.workspaceId, templateRoot).catch(() => undefined);
    return {
      changedFiles: [...new Set([
        ...prepared.preview.changes.map((change) => change.path),
        'src/main.tsx',
        'vite.config.ts',
        'package.json',
      ])].sort(),
      checkpointCreated,
      importedAt,
      restartRequested: true,
    };
  } catch (error) {
    if (mutationsStarted && recoveryRoot && templateRoot) {
      await restoreMutationFiles(
        templateRoot,
        recoveryRoot,
        recoveryFiles,
        dependencies.copyFile,
      );
    }
    throw error;
  } finally {
    await Promise.all([
      rm(prepared.snapshotRoot, { recursive: true, force: true }),
      recoveryRoot ? rm(recoveryRoot, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  }
}

export async function applyAppTemplateSourceImport(
  input: { workspaceId: string; importToken: string },
  dependencies: AppTemplateSourceImportDependencies = defaultDependencies,
): Promise<TemplateImportApplyResult> {
  const lockKey = dependencies.sessionStore.getLockKey(input.importToken, input.workspaceId);
  if (activeApplyTargets.has(lockKey)) {
    throw Object.assign(new Error('当前模板正在应用另一个项目导入，请稍后重试'), { statusCode: 409 });
  }
  activeApplyTargets.add(lockKey);
  try {
    return await applyAppTemplateSourceImportExclusive(input, dependencies);
  } finally {
    activeApplyTargets.delete(lockKey);
  }
}
