import { posix } from 'node:path';

import type { CodeApplicationPageType } from '../../shared/code-application-catalog';
import type {
  TemplateImportIssue,
  TemplateImportPackageChange,
} from '../../shared/app-template-source-import';

type JsonObject = Record<string, unknown>;
type StringMap = Record<string, string>;

const PLATFORM_SCRIPT_NAMES = ['dev', 'build', 'preview'] as const;

function stringMap(value: unknown): StringMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function mergeDependencies(input: {
  section: 'dependencies' | 'devDependencies';
  platform: StringMap;
  source: StringMap;
  managedPackages: Set<string>;
  changes: TemplateImportPackageChange[];
  warnings: TemplateImportIssue[];
}): StringMap {
  const merged = { ...input.platform, ...input.source };
  const names = new Set([...Object.keys(input.platform), ...Object.keys(input.source)]);
  for (const name of [...names].sort()) {
    const platformValue = input.platform[name];
    const sourceValue = input.source[name];
    if (platformValue !== undefined && sourceValue !== undefined && platformValue !== sourceValue) {
      const platformWins = input.managedPackages.has(name);
      const appliedValue = platformWins ? platformValue : sourceValue;
      if (platformWins) merged[name] = platformValue;
      input.changes.push({
        name,
        section: input.section,
        sourceValue,
        appliedValue,
        resolution: platformWins ? 'platform' : 'source',
      });
      input.warnings.push({
        code: 'DEPENDENCY_CONFLICT',
        level: 'warning',
        path: `${input.section}.${name}`,
        message: `${name} 版本冲突，已使用${platformWins ? '平台' : '来源项目'}版本 ${appliedValue}`,
      });
    } else if (sourceValue !== undefined && platformValue === undefined) {
      input.changes.push({
        name,
        section: input.section,
        sourceValue,
        appliedValue: sourceValue,
        resolution: 'added',
      });
    }
  }
  return merged;
}

export interface MergeTemplatePackageInput {
  platform: JsonObject;
  source: JsonObject;
  managedPackages: string[];
}

export function mergeTemplatePackageJson(input: MergeTemplatePackageInput): {
  packageJson: JsonObject;
  changes: TemplateImportPackageChange[];
  warnings: TemplateImportIssue[];
} {
  const changes: TemplateImportPackageChange[] = [];
  const warnings: TemplateImportIssue[] = [];
  const managedPackages = new Set(input.managedPackages);
  const platformScripts = stringMap(input.platform.scripts);
  const sourceScripts = stringMap(input.source.scripts);
  const scripts = { ...platformScripts, ...sourceScripts };

  for (const name of PLATFORM_SCRIPT_NAMES) {
    const platformValue = platformScripts[name];
    if (platformValue === undefined) continue;
    const sourceValue = sourceScripts[name];
    scripts[name] = platformValue;
    if (sourceValue !== undefined && sourceValue !== platformValue) {
      changes.push({
        name,
        section: 'scripts',
        sourceValue,
        appliedValue: platformValue,
        resolution: 'platform',
      });
    }
  }

  const dependencies = mergeDependencies({
    section: 'dependencies',
    platform: stringMap(input.platform.dependencies),
    source: stringMap(input.source.dependencies),
    managedPackages,
    changes,
    warnings,
  });
  const devDependencies = mergeDependencies({
    section: 'devDependencies',
    platform: stringMap(input.platform.devDependencies),
    source: stringMap(input.source.devDependencies),
    managedPackages,
    changes,
    warnings,
  });

  const sourceResolutions = stringMap(input.source.resolutions);
  const platformResolutions = stringMap(input.platform.resolutions);
  const resolutions = { ...platformResolutions, ...sourceResolutions };
  if (platformResolutions.rollup) resolutions.rollup = platformResolutions.rollup;

  const sourceOverrides = stringMap(input.source.overrides);
  const platformOverrides = stringMap(input.platform.overrides);
  const overrides = { ...platformOverrides, ...sourceOverrides };
  if (platformOverrides.rollup) overrides.rollup = platformOverrides.rollup;

  return {
    packageJson: {
      ...input.platform,
      ...input.source,
      private: true,
      scripts,
      dependencies,
      devDependencies,
      ...(Object.keys(resolutions).length > 0 ? { resolutions } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    },
    changes,
    warnings,
  };
}

export type SourceViteConfigExtension = 'ts' | 'js' | 'mjs' | 'mts';

export function createManagedViteFiles(input: {
  sourceExtension?: SourceViteConfigExtension;
}): Record<string, string> {
  const sourceName = input.sourceExtension
    ? `vite.config.source.${input.sourceExtension}`
    : undefined;
  const sourceLoad = sourceName
    ? `await loadConfigFromFile(env, resolve(root, '${sourceName}'), root)`
    : 'null';
  return {
    'vite.config.ts': `import { resolve } from 'node:path';
import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite';

export default defineConfig(async (env) => {
  const root = process.cwd();
  const source = ${sourceLoad};
  const platform = await loadConfigFromFile(env, resolve(root, 'vite.config.sclaw.ts'), root);
  return mergeConfig(source?.config ?? {}, platform?.config ?? {});
});
`,
  };
}

function sourceImportSpecifier(sourceEntry: string): string {
  const normalized = sourceEntry.replaceAll('\\', '/');
  if (!/^src\/main\.source\.(tsx|ts|jsx|js)$/.test(normalized)) {
    throw new Error(`非法来源入口: ${sourceEntry}`);
  }
  return `./${posix.basename(normalized).replace(/\.(tsx|ts|jsx|js)$/, '')}`;
}

function entryFailureHandler(): string {
  return `function showBootstrapError(error: unknown) {
  const message = error instanceof Error ? error.message : '应用基础能力启动失败';
  const container = document.getElementById('root');
  if (container) {
    container.setAttribute('role', 'alert');
    container.textContent = message;
  }
}
`;
}

export function createManagedSourceEntry(input: {
  pageType: CodeApplicationPageType;
  sourceEntry: string;
}): string {
  const importSpecifier = sourceImportSpecifier(input.sourceEntry);
  if (input.pageType === 'site') {
    return `import { bootstrapInstalledPlugins } from './sclaw/bootstrap';

${entryFailureHandler()}
async function start() {
  await bootstrapInstalledPlugins();
  await import('${importSpecifier}');
}

void start().catch((error) => {
  showBootstrapError(error);
  throw error;
});
`;
  }
  return `import { bootstrapSsoAuth } from '@sto/sclaw-plugin-sso-auth';

${entryFailureHandler()}
async function start() {
  const config = window.__STO_SSO_AUTH_CONFIG__;
  if (config?.runtimeMode === 'local') {
    await bootstrapSsoAuth({ config });
  }
  await import('${importSpecifier}');
}

void start().catch((error) => {
  showBootstrapError(error);
  throw error;
});
`;
}
