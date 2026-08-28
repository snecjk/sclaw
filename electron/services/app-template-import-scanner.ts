import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import type { CodeApplicationPageType } from '../../shared/code-application-catalog';
import type {
  TemplateImportFileChange,
  TemplateImportIssue,
  TemplateImportPreview,
} from '../../shared/app-template-source-import';
import {
  mergeTemplatePackageJson,
  type SourceViteConfigExtension,
} from './app-template-import-adapter';
import { classifyTemplateImportPath } from './app-template-import-rules';
import { readTemplateImportState } from './app-template-import-state';

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const SOURCE_ENTRIES = new Set([
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
]);
const VITE_CONFIG_RE = /^vite\.config\.(ts|js|mjs|mts)$/;

function slashPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

function hashBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashFileIfPresent(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return hashBytes(await readFile(path));
  } catch {
    return null;
  }
}

function jsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('package.json 必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function detectsReactVite(sourcePackage: Record<string, unknown>): boolean {
  const dependencies = {
    ...stringMap(sourcePackage.dependencies),
    ...stringMap(sourcePackage.devDependencies),
  };
  const scripts = stringMap(sourcePackage.scripts);
  return Boolean(
    dependencies.react
    && (dependencies.vite || Object.values(scripts).some((value) => /(^|\s)vite(\s|$)/.test(value))),
  );
}

export interface PreparedTemplateImport {
  preview: Omit<TemplateImportPreview, 'importToken' | 'expiresAt'>;
  snapshotRoot: string;
  sourcePath: string;
  sourceFingerprint: string;
  importFiles: Record<string, string>;
  mergedPackageJson: Record<string, unknown>;
  sourceEntry?: { originalPath: string; stagedPath: string };
  sourceViteConfig?: {
    originalPath: string;
    stagedPath: string;
    extension: SourceViteConfigExtension;
  };
}

export async function scanTemplateSource(input: {
  templateRoot: string;
  sourcePath: string;
  pageType: CodeApplicationPageType;
  managedPackages?: string[];
}): Promise<PreparedTemplateImport> {
  const snapshotRoot = await mkdtemp(join(tmpdir(), 'sclaw-template-import-'));
  const ignoredPaths = new Set<string>();
  const issues: TemplateImportIssue[] = [];
  const importFiles: Record<string, string> = {};
  const sourceEntries: Array<{ path: string; absolute: string }> = [];
  const viteConfigs: Array<{
    path: string;
    absolute: string;
    extension: SourceViteConfigExtension;
  }> = [];
  let fileCount = 0;
  let totalBytes = 0;

  const stageFile = async (sourceAbsolute: string, stagedPath: string): Promise<void> => {
    const info = await stat(sourceAbsolute);
    fileCount += 1;
    totalBytes += info.size;
    if (fileCount > MAX_FILES || info.size > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('来源项目超出导入规模限制');
    }
    const bytes = await readFile(sourceAbsolute);
    const destination = join(snapshotRoot, stagedPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    importFiles[stagedPath] = hashBytes(bytes);
  };

  const walk = async (current: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const path = slashPath(input.sourcePath, absolute);
      if (entry.isSymbolicLink()) {
        throw new Error(`来源项目不能包含符号链接: ${path}`);
      }
      if (entry.isDirectory()) {
        const classification = classifyTemplateImportPath(path);
        if (classification !== 'business') {
          ignoredPaths.add(path);
          continue;
        }
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SOURCE_ENTRIES.has(path)) {
        sourceEntries.push({ path, absolute });
        continue;
      }
      const viteMatch = path.match(VITE_CONFIG_RE);
      if (viteMatch) {
        viteConfigs.push({
          path,
          absolute,
          extension: viteMatch[1] as SourceViteConfigExtension,
        });
        continue;
      }
      if (path === 'package.json' || path === 'manifest.json') continue;
      const classification = classifyTemplateImportPath(path);
      if (classification !== 'business') {
        ignoredPaths.add(path);
        if (basename(path).toLowerCase().startsWith('.env')) {
          issues.push({
            code: 'SENSITIVE_FILE_IGNORED',
            level: 'warning',
            path,
            message: `${path} 属于敏感环境文件，已忽略`,
          });
        }
        continue;
      }
      await stageFile(absolute, path);
    }
  };

  try {
    const sourcePackageRaw = await readFile(join(input.sourcePath, 'package.json'), 'utf8');
    const platformPackageRaw = await readFile(join(input.templateRoot, 'package.json'), 'utf8');
    const sourcePackage = jsonObject(sourcePackageRaw);
    const platformPackage = jsonObject(platformPackageRaw);
    if (!detectsReactVite(sourcePackage)) {
      issues.push({
        code: 'INVALID_PROJECT',
        level: 'blocker',
        message: '来源项目必须是包含 React 和 Vite 的前端项目',
      });
    }

    try {
      const sourceManifest = jsonObject(
        await readFile(join(input.sourcePath, 'manifest.json'), 'utf8'),
      );
      if (sourceManifest.pageType === 'site' || sourceManifest.pageType === 'assets') {
        if (sourceManifest.pageType !== input.pageType) {
          issues.push({
            code: 'PAGE_TYPE_MISMATCH',
            level: 'blocker',
            path: 'manifest.json',
            message: `来源项目类型 ${sourceManifest.pageType} 与当前模板 ${input.pageType} 不一致`,
          });
        }
      } else {
        issues.push({
          code: 'PAGE_TYPE_UNDECLARED',
          level: 'warning',
          path: 'manifest.json',
          message: `来源项目未声明 pageType，将按 ${input.pageType} 模板处理`,
        });
      }
      ignoredPaths.add('manifest.json');
    } catch {
      issues.push({
        code: 'PAGE_TYPE_UNDECLARED',
        level: 'warning',
        message: `来源项目未声明 pageType，将按 ${input.pageType} 模板处理`,
      });
    }

    await walk(input.sourcePath);

    let sourceEntry: PreparedTemplateImport['sourceEntry'];
    if (sourceEntries.length !== 1) {
      issues.push({
        code: 'INVALID_PROJECT',
        level: 'blocker',
        message: sourceEntries.length === 0
          ? '来源项目缺少 src/main 入口'
          : '来源项目包含多个 src/main 入口',
      });
    } else {
      const entry = sourceEntries[0]!;
      const extension = extname(entry.path);
      const stagedPath = `src/main.source${extension}`;
      await stageFile(entry.absolute, stagedPath);
      sourceEntry = { originalPath: entry.path, stagedPath };
      issues.push({
        code: 'SOURCE_ENTRY_WRAPPED',
        level: 'warning',
        path: entry.path,
        message: '来源入口将由 SClaw 平台入口包装',
      });
    }

    let sourceViteConfig: PreparedTemplateImport['sourceViteConfig'];
    if (viteConfigs.length > 1) {
      issues.push({
        code: 'VITE_CONFIG_UNRECOGNIZED',
        level: 'blocker',
        message: '来源项目包含多个 Vite 配置文件，请只保留一个',
      });
    } else if (viteConfigs.length === 1) {
      const config = viteConfigs[0]!;
      const stagedPath = `vite.config.source.${config.extension}`;
      await stageFile(config.absolute, stagedPath);
      sourceViteConfig = {
        originalPath: config.path,
        stagedPath,
        extension: config.extension,
      };
    }

    const merged = mergeTemplatePackageJson({
      platform: platformPackage,
      source: sourcePackage,
      managedPackages: input.managedPackages ?? [],
    });
    issues.push(...merged.warnings);
    const mergedPackageText = `${JSON.stringify(merged.packageJson, null, 2)}\n`;
    await mkdir(snapshotRoot, { recursive: true });
    await writeFile(join(snapshotRoot, 'package.json'), mergedPackageText, 'utf8');
    importFiles['package.json'] = hashBytes(mergedPackageText);

    const previousState = await readTemplateImportState(input.templateRoot);
    const changes: TemplateImportFileChange[] = [];
    for (const path of Object.keys(importFiles).sort()) {
      const targetHash = await hashFileIfPresent(join(input.templateRoot, path));
      if (targetHash === null) changes.push({ path, kind: 'add' });
      else if (targetHash !== importFiles[path]) changes.push({ path, kind: 'modify' });
    }
    for (const path of Object.keys(previousState?.files ?? {}).sort()) {
      if (path in importFiles || classifyTemplateImportPath(path) !== 'business') continue;
      if (await hashFileIfPresent(join(input.templateRoot, path))) {
        changes.push({ path, kind: 'delete' });
      }
    }
    changes.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
    issues.sort((left, right) => (left.path ?? '').localeCompare(right.path ?? '') || left.code.localeCompare(right.code));

    const fingerprintInput = Object.entries(importFiles)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => `${path}:${hash}`)
      .join('\n');

    return {
      preview: {
        sourceName: basename(input.sourcePath),
        detectedStack: 'react-vite',
        pageType: input.pageType,
        changes,
        ignoredPaths: [...ignoredPaths].sort(),
        packageChanges: merged.changes,
        issues,
      },
      snapshotRoot,
      sourcePath: input.sourcePath,
      sourceFingerprint: hashBytes(fingerprintInput),
      importFiles,
      mergedPackageJson: merged.packageJson,
      sourceEntry,
      sourceViteConfig,
    };
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}
