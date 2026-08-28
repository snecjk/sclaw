import { existsSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

import type { ExternalServiceBindingSnapshot } from '../../shared/external-service-contract';
import type {
  TemplateImportPreview,
  TemplateImportStatus,
} from '../../shared/app-template-source-import';
import {
  isGitAvailable,
  readAppTemplateWorkspaceMarker,
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
import { getWorkspaceRootPath } from './session-catalog-service';

const SSO_AUTH_PACKAGE = '@sto/sclaw-plugin-sso-auth';

export interface AppTemplateSourceImportDependencies {
  getWorkspaceRootPath(workspaceId: string): Promise<string | null>;
  readMarker(templateRoot: string): Promise<AppTemplateWorkspaceMarker>;
  readState(templateRoot: string): Promise<TemplateImportLocalState | null>;
  scan(input: Parameters<typeof scanTemplateSource>[0]): Promise<PreparedTemplateImport>;
  listBindings(templateRoot: string): Promise<ExternalServiceBindingSnapshot[]>;
  isGitAvailable(): Promise<boolean>;
  pathExists(path: string): boolean;
  sessionStore: AppTemplateImportSessionStore;
}

const defaultDependencies: AppTemplateSourceImportDependencies = {
  getWorkspaceRootPath,
  readMarker: readAppTemplateWorkspaceMarker,
  readState: readTemplateImportState,
  scan: scanTemplateSource,
  listBindings: listExternalServiceBindings,
  isGitAvailable,
  pathExists: existsSync,
  sessionStore: defaultAppTemplateImportSessionStore,
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
  const prepared = await dependencies.scan({
    templateRoot,
    sourcePath,
    pageType: marker.pageType,
    managedPackages,
  });
  if (!(await dependencies.isGitAvailable())) {
    prepared.preview.issues.push({
      code: 'GIT_UNAVAILABLE',
      level: 'blocker',
      message: '当前环境无法使用 Git，不能创建上传前恢复点',
    });
  }
  const session = dependencies.sessionStore.create(input.workspaceId, prepared);
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
