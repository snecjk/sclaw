# 模板编辑页上传项目 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在模板编辑工作台中支持选择本地 React/Vite 项目、预览差异、受控覆盖模板工作区、反复重新上传并立即刷新预览，同时保留模板身份和 SClaw 基建。

**Architecture:** Renderer 只负责选择来源目录、展示扫描结果和确认操作；Electron Host 通过 `workspaceId` 解析模板目标，在临时目录建立来源快照，并用短期单次 `importToken` 串联 prepare/apply。覆盖过程先创建 Git checkpoint 和临时恢复快照，再镜像业务文件、合并工程配置、恢复平台入口，失败时回滚；上传只更新本地模板工作区，现有模板发布流程保持不变。

**Tech Stack:** Electron、Node.js `fs/promises`、React 19、TypeScript、Vite 5.4 模板运行时、Vitest、Testing Library、现有 Host API 与 Session Catalog。

**Spec:** `docs/superpowers/specs/2026-08-28-app-template-project-upload-design.md`

## Global Constraints

- 直接在当前 `ontology/website-dev` 工作区执行，不创建隔离 worktree。
- 上传入口只出现在 `tab.kind === 'template'` 的模板编辑工作台，不放入模板管理列表和普通应用工作台。
- 第一阶段只接受根目录包含 `package.json`、`src/` 且能识别 React/Vite 入口的项目。
- 目标目录只能通过 `workspaceId` 从 Session Catalog 解析；Renderer 不能指定目标绝对路径。
- 永久保护 `.git/`、`.sclaw/`、模板 Marker、Manifest 身份字段及 SClaw Runtime、Skill、外部服务契约。
- `.env*`（仅 `.env.example` 可导入）、凭据、证书、私钥、`node_modules/`、构建产物和缓存不得复制。
- Site/Assets 以目标模板 `pageType` 为权威；来源明确声明相反类型时阻断。
- 重新上传采用镜像语义；删除项必须在确认弹窗展示，用户确认后才执行。
- 每次 apply 前创建 Git checkpoint 和临时文件恢复快照；apply 失败必须恢复目标目录。
- 上传不调用 memory-center、不上传 OSS、不递增模板版本、不自动发布。
- 来源绝对路径只保存在被 Git 忽略且不进入归档的 `.sclaw/local/`。
- Vite 5.4.21 支持 `loadConfigFromFile(configEnv, configFile, configRoot)` 和 `mergeConfig(defaults, overrides)`；来源配置作为 defaults，SClaw 配置作为 overrides，插件数组按来源在前、平台在后合并。
- 每项功能先写失败测试，再写最小实现；每个 Task 单独提交。

---

## File Structure

### Shared contract

- `shared/app-template-source-import.ts`：Renderer 与 Electron 共用的状态、差异、问题、prepare/apply 请求响应类型。

### Electron services

- `electron/services/app-template-import-rules.ts`：路径归一化、保护/忽略分类、敏感文件识别，不执行文件复制。
- `electron/services/app-template-import-adapter.ts`：`package.json` 合并、来源入口改名、Vite 双配置合并包装器生成。
- `electron/services/app-template-import-scanner.ts`：建立只读来源快照、计算哈希与新增/修改/删除、识别阻断项和警告项。
- `electron/services/app-template-import-state.ts`：读写 `.sclaw/local/template-source-import.json`，不管理临时会话。
- `electron/services/app-template-import-session-store.ts`：保存、消费、取消和过期清理一次性 `importToken`。
- `electron/services/app-template-source-import-service.ts`：按 `workspaceId` 编排 status/prepare/apply/cancel、checkpoint、事务覆盖、回滚与预览重启。

### Host API and renderer API

- `electron/api/routes/app-templates.ts`：增加 status/prepare/apply/cancel 四个路由。
- `src/lib/app-dev-api.ts`：增加模板来源上传 API 函数。

### UI

- `src/components/more-apps/TemplateProjectUploadDialog.tsx`：展示扫描摘要、变更文件、警告、阻断和确认状态。
- `src/components/more-apps/TemplateProjectUploadControl.tsx`：目录选择、首次上传/重新上传、换目录、取消会话和 apply 编排。
- `src/components/more-apps/AppPlazaDevAppPane.tsx`：仅在模板工具栏挂载上传控件，成功后刷新源文件和预览状态。

### Tests and docs

- `tests/unit/helpers/app-template-import-fixtures.ts`：临时目录、模板/来源树和共享 preview fixture；测试不得复制不同版本的 fixture 结构。
- `tests/unit/app-template-import-rules.test.ts`
- `tests/unit/app-template-import-adapter.test.ts`
- `tests/unit/app-template-import-scanner.test.ts`
- `tests/unit/app-template-import-session-store.test.ts`
- `tests/unit/app-template-source-import-service.test.ts`
- `tests/unit/app-template-source-import-route.test.ts`
- `tests/unit/app-template-project-upload-dialog.test.tsx`
- `tests/unit/app-template-project-upload-control.test.tsx`
- `tests/unit/app-template-archive.test.ts`
- `docs/contracts/sclaw-app-template-source-import-v1.md`

---

### Task 1: 共享契约与文件安全规则

**Files:**
- Create: `shared/app-template-source-import.ts`
- Create: `electron/services/app-template-import-rules.ts`
- Create: `tests/unit/helpers/app-template-import-fixtures.ts`
- Test: `tests/unit/app-template-import-rules.test.ts`

**Interfaces:**
- Consumes: `CodeApplicationPageType` from `shared/code-application-catalog.ts`。
- Produces: `TemplateImportPreview`、`TemplateImportStatus`、`TemplateImportApplyResult`、`normalizeImportRelativePath()`、`classifyTemplateImportPath()`，供 Tasks 2-7 使用。

- [ ] **Step 1: 写路径规则失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyTemplateImportPath,
  normalizeImportRelativePath,
} from '../../electron/services/app-template-import-rules';

describe('app template import rules', () => {
  it.each([
    '.git/config',
    '.sclaw/app-template.json',
    'manifest.json',
    'src/sclaw/bootstrap.ts',
    'scripts/external-services.mjs',
    'contracts/external-services.v1.json',
    'vite.config.ts',
    'vite.config.sclaw.ts',
  ])('永久保护 %s', (path) => {
    expect(classifyTemplateImportPath(path)).toBe('protected');
  });

  it.each(['.env', '.env.daily', 'node_modules/a.js', 'dist/a.js', 'coverage/a.json'])
    ('忽略 %s', (path) => {
      expect(classifyTemplateImportPath(path)).toBe('ignored');
    });

  it('允许 env 示例和普通业务文件', () => {
    expect(classifyTemplateImportPath('.env.example')).toBe('business');
    expect(classifyTemplateImportPath('src/App.tsx')).toBe('business');
  });

  it.each(['../secret', '/tmp/a', 'src/../../secret', 'C:\\secret'])
    ('拒绝越界路径 %s', (path) => {
      expect(() => normalizeImportRelativePath(path)).toThrow('非法导入路径');
    });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-import-rules.test.ts`

Expected: FAIL，提示模块 `app-template-import-rules` 不存在。

- [ ] **Step 3: 定义共享契约**

在 `shared/app-template-source-import.ts` 写入以下公开类型，字段名在后续 Tasks 中不得更改：

```ts
import type { CodeApplicationPageType } from './code-application-catalog';

export type TemplateImportChangeKind = 'add' | 'modify' | 'delete';
export type TemplateImportIssueLevel = 'warning' | 'blocker';

export interface TemplateImportFileChange {
  path: string;
  kind: TemplateImportChangeKind;
}

export interface TemplateImportIssue {
  code:
    | 'INVALID_PROJECT'
    | 'PAGE_TYPE_MISMATCH'
    | 'PAGE_TYPE_UNDECLARED'
    | 'PACKAGE_JSON_INVALID'
    | 'VITE_CONFIG_UNRECOGNIZED'
    | 'DEPENDENCY_CONFLICT'
    | 'SENSITIVE_FILE_IGNORED'
    | 'SOURCE_ENTRY_WRAPPED'
    | 'SOURCE_LIMIT_EXCEEDED'
    | 'GIT_UNAVAILABLE';
  level: TemplateImportIssueLevel;
  message: string;
  path?: string;
}

export interface TemplateImportPackageChange {
  name: string;
  section: 'scripts' | 'dependencies' | 'devDependencies' | 'resolutions' | 'overrides';
  sourceValue?: string;
  appliedValue?: string;
  resolution: 'source' | 'platform' | 'added';
}

export interface TemplateImportPreview {
  importToken: string;
  sourceName: string;
  detectedStack: 'react-vite';
  pageType: CodeApplicationPageType;
  changes: TemplateImportFileChange[];
  ignoredPaths: string[];
  packageChanges: TemplateImportPackageChange[];
  issues: TemplateImportIssue[];
  expiresAt: string;
}

export interface TemplateImportStatus {
  hasSource: boolean;
  sourceName?: string;
  sourceAvailable: boolean;
  lastImportedAt?: string;
}

export interface TemplateImportApplyResult {
  changedFiles: string[];
  checkpointCreated: boolean;
  importedAt: string;
  restartRequested: boolean;
}
```

同时创建共享测试 fixture：

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TemplateImportPreview } from '../../../shared/app-template-source-import';

const roots: string[] = [];

export async function createImportFixtureTree(prefix: string, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  return root;
}

export async function cleanupImportFixtureTrees(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export function createTemplateImportPreview(
  overrides: Partial<TemplateImportPreview> = {},
): TemplateImportPreview {
  return {
    importToken: 'token-1',
    sourceName: 'demo',
    detectedStack: 'react-vite',
    pageType: 'site',
    changes: [],
    ignoredPaths: [],
    packageChanges: [],
    issues: [],
    expiresAt: '2026-08-28T00:10:00.000Z',
    ...overrides,
  };
}
```

- [ ] **Step 4: 实现路径分类与越界校验**

在 `app-template-import-rules.ts` 中实现：

```ts
import { posix } from 'node:path';

export type TemplateImportPathClass = 'protected' | 'ignored' | 'business';

const PROTECTED_EXACT = new Set([
  'manifest.json',
  'vite.config.ts',
  'vite.config.sclaw.ts',
  'scripts/dev-proxy.mjs',
  'scripts/ensure-dev-proxy.mjs',
  'scripts/external-services.mjs',
  'scripts/sso-env.mjs',
  'contracts/external-services.v1.json',
  'contracts/dev-proxy.v1.json',
  'src/components/RuntimeBootstrapShell.tsx',
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
]);

const PROTECTED_PREFIXES = ['.git/', '.sclaw/', 'src/sclaw/', 'openspec/skills/'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.turbo', '.next']);

export function normalizeImportRelativePath(input: string): string {
  const slash = input.replaceAll('\\\\', '/');
  if (!slash || slash.startsWith('/') || /^[A-Za-z]:\//.test(slash)) {
    throw new Error(`非法导入路径: ${input}`);
  }
  const normalized = posix.normalize(slash);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`非法导入路径: ${input}`);
  }
  return normalized;
}

export function classifyTemplateImportPath(input: string): TemplateImportPathClass {
  const path = normalizeImportRelativePath(input);
  if (PROTECTED_EXACT.has(path) || PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return 'protected';
  }
  const parts = path.split('/');
  const base = parts.at(-1)?.toLowerCase() ?? '';
  if ((base.startsWith('.env') && base !== '.env.example') || parts.some((part) => IGNORED_DIRS.has(part))) {
    return 'ignored';
  }
  return 'business';
}
```

扫描器遇到符号链接时不得跟随；符号链接校验在 Task 3 实现。

- [ ] **Step 5: 运行测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-import-rules.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 Task 1**

```bash
git add shared/app-template-source-import.ts electron/services/app-template-import-rules.ts tests/unit/helpers/app-template-import-fixtures.ts tests/unit/app-template-import-rules.test.ts
git commit -m "feat(app-template): define source import contract"
```

---

### Task 2: 工程配置与平台入口适配

**Files:**
- Create: `electron/services/app-template-import-adapter.ts`
- Test: `tests/unit/app-template-import-adapter.test.ts`

**Interfaces:**
- Consumes: `TemplateImportPackageChange`、目标模板 `pageType`、目标和来源 `package.json`。
- Produces: `mergeTemplatePackageJson()`、`createManagedViteFiles()`、`createManagedSourceEntry()`，供 scanner 预览和 applier 写文件。

- [ ] **Step 1: 写 package 合并失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { mergeTemplatePackageJson } from '../../electron/services/app-template-import-adapter';

it('来源依赖优先但保留平台脚本、受管包和 rollup 约束', () => {
  const result = mergeTemplatePackageJson({
    platform: {
      scripts: { dev: 'vite', build: 'vite build', 'sclaw:services': 'node scripts/external-services.mjs' },
      dependencies: { '@sto/sclaw-plugin-sso-auth': '0.1.0', react: '^19.0.0' },
      devDependencies: { vite: '^5.4.0' },
      resolutions: { rollup: '4.62.2' },
      overrides: { rollup: '4.62.2' },
    },
    source: {
      scripts: { dev: 'vite --host 0.0.0.0', build: 'custom-build' },
      dependencies: { '@sto/sclaw-plugin-sso-auth': '9.0.0', react: '^18.0.0', dayjs: '^1.11.0' },
      devDependencies: { vite: '^5.4.10' },
    },
    managedPackages: ['@sto/sclaw-plugin-sso-auth'],
  });

  expect(result.packageJson.scripts).toMatchObject({
    dev: 'vite',
    build: 'vite build',
    'sclaw:services': 'node scripts/external-services.mjs',
  });
  expect(result.packageJson.dependencies).toMatchObject({
    '@sto/sclaw-plugin-sso-auth': '0.1.0',
    react: '^18.0.0',
    dayjs: '^1.11.0',
  });
  expect(result.packageJson.resolutions).toEqual({ rollup: '4.62.2' });
  expect(result.changes).toContainEqual(expect.objectContaining({
    name: '@sto/sclaw-plugin-sso-auth',
    resolution: 'platform',
  }));
});
```

- [ ] **Step 2: 写 Vite 与入口包装失败测试**

```ts
import {
  createManagedSourceEntry,
  createManagedViteFiles,
} from '../../electron/services/app-template-import-adapter';

it('来源 Vite 配置是 defaults，平台配置是 overrides', () => {
  const files = createManagedViteFiles({ sourceExtension: 'ts' });
  expect(files['vite.config.ts']).toContain('mergeConfig(source?.config ?? {}, platform?.config ?? {})');
  expect(files['vite.config.ts']).toContain("'vite.config.source.ts'");
  expect(files['vite.config.ts']).toContain("'vite.config.sclaw.ts'");
});

it('Site 先启动插件再加载来源入口', () => {
  const source = createManagedSourceEntry({ pageType: 'site', sourceEntry: 'src/main.source.tsx' });
  expect(source).toContain("bootstrapInstalledPlugins");
  expect(source).toContain("import('./main.source')");
});

it('Assets 只在本地模式启动身份插件再加载来源入口', () => {
  const source = createManagedSourceEntry({ pageType: 'assets', sourceEntry: 'src/main.source.tsx' });
  expect(source).toContain("runtimeMode === 'local'");
  expect(source).toContain('bootstrapSsoAuth');
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-import-adapter.test.ts`

Expected: FAIL，提示 adapter 模块不存在。

- [ ] **Step 4: 实现 package.json 确定性合并**

实现以下签名：

```ts
export interface MergeTemplatePackageInput {
  platform: Record<string, unknown>;
  source: Record<string, unknown>;
  managedPackages: string[];
}

export function mergeTemplatePackageJson(input: MergeTemplatePackageInput): {
  packageJson: Record<string, unknown>;
  changes: TemplateImportPackageChange[];
  warnings: TemplateImportIssue[];
};
```

合并顺序固定为：

1. 普通字段使用 `{ ...platform, ...source }`，但强制 `private: true`。
2. `dependencies`、`devDependencies` 先 platform 后 source；`managedPackages` 再用 platform 版本覆盖。
3. `dev`、`build`、`preview`、`sclaw:services` 使用 platform 脚本；来源其他脚本保留。
4. `resolutions.rollup` 与 `overrides.rollup` 使用 platform 值。
5. 同名不同版本写入 `DEPENDENCY_CONFLICT` warning 和 `TemplateImportPackageChange`。
6. 返回对象键按原有 JSON 结构输出，不在此函数写文件。

- [ ] **Step 5: 实现 Vite 双配置包装器**

`createManagedViteFiles()` 返回固定生成内容：

```ts
export function createManagedViteFiles(input: { sourceExtension?: 'ts' | 'js' | 'mjs' | 'mts' }): Record<string, string> {
  const sourceName = input.sourceExtension ? `vite.config.source.${input.sourceExtension}` : undefined;
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
```

applier 首次导入时把模板原 `vite.config.ts` 保存为 `vite.config.sclaw.ts`；后续导入永不覆盖 `vite.config.sclaw.ts`。来源配置保存为唯一的 `vite.config.source.<ext>`，重新上传时删除旧扩展版本。

- [ ] **Step 6: 实现 pageType 对应的受管入口**

`createManagedSourceEntry()` 生成 `src/main.tsx`，来源入口复制为同目录 `main.source.<ext>`。Site 包装器先调用 `bootstrapInstalledPlugins()`；Assets 包装器只在 `window.__STO_SSO_AUTH_CONFIG__?.runtimeMode === 'local'` 时调用 `bootstrapSsoAuth()`；失败时向 `#root` 写入 `role="alert"` 的纯文本错误，再抛出异常，禁止插入未转义 HTML。

- [ ] **Step 7: 运行测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-import-adapter.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交 Task 2**

```bash
git add electron/services/app-template-import-adapter.ts tests/unit/app-template-import-adapter.test.ts
git commit -m "feat(app-template): add imported project adapters"
```

---

### Task 3: 来源快照、状态和差异扫描

**Files:**
- Create: `electron/services/app-template-import-state.ts`
- Create: `electron/services/app-template-import-scanner.ts`
- Test: `tests/unit/app-template-import-scanner.test.ts`
- Modify: `tests/unit/app-template-archive.test.ts`

**Interfaces:**
- Consumes: Task 1 路径规则和契约、Task 2 合并/包装函数。
- Produces: `readTemplateImportState()`、`writeTemplateImportState()`、`scanTemplateSource()` 和 `PreparedTemplateImport`，供 session store 和 apply 使用。

- [ ] **Step 1: 写扫描不修改目标的失败测试**

```ts
it('建立来源快照并报告新增修改删除，但 prepare 不修改模板', async () => {
  const target = await createImportFixtureTree('template-target-', {
    'manifest.json': JSON.stringify({ schemaVersion: 1, templateId: 'site-a', pageType: 'site', name: '模板 A' }),
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^5.4.0' } }),
    'src/App.tsx': 'old',
    'src/obsolete.ts': 'remove me',
  });
  await writeTemplateImportState(target, {
    schemaVersion: 1,
    sourcePath: '/previous/source',
    sourceFingerprint: 'old-hash',
    importedAt: '2026-08-28T00:00:00.000Z',
    files: { 'src/App.tsx': 'old', 'src/obsolete.ts': 'old' },
  });
  const source = await createImportFixtureTree('template-source-', {
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', vite: '^5.4.0' } }),
    'src/App.tsx': 'new',
    'src/New.tsx': 'new file',
    'src/main.tsx': 'source entry',
  });

  const prepared = await scanTemplateSource({ templateRoot: target, sourcePath: source, pageType: 'site' });

  expect(prepared.preview.changes).toEqual(expect.arrayContaining([
    { path: 'src/App.tsx', kind: 'modify' },
    { path: 'src/New.tsx', kind: 'add' },
    { path: 'src/obsolete.ts', kind: 'delete' },
  ]));
  expect(await readFile(join(target, 'src/App.tsx'), 'utf8')).toBe('old');
});
```

- [ ] **Step 2: 写敏感文件、软链接和类型冲突失败测试**

使用 `createImportFixtureTree()` 创建 `.env.daily` 和显式 `manifest.json` 类型冲突。符号链接用 `symlink('/outside', join(source, 'outside-link'))` 创建；每个测试 `afterEach(cleanupImportFixtureTrees)`。测试必须断言：

```ts
expect(prepared.preview.ignoredPaths).toContain('.env.daily');
expect(prepared.preview.issues).toContainEqual(expect.objectContaining({
  code: 'SENSITIVE_FILE_IGNORED',
  level: 'warning',
  path: '.env.daily',
}));
await expect(scanTemplateSource({ templateRoot, sourcePath: sourceWithSymlink, pageType: 'site' }))
  .rejects.toThrow('来源项目不能包含符号链接');
expect(mismatch.preview.issues).toContainEqual(expect.objectContaining({
  code: 'PAGE_TYPE_MISMATCH',
  level: 'blocker',
}));
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-import-scanner.test.ts`

Expected: FAIL，提示 scanner/state 模块不存在。

- [ ] **Step 4: 实现本地状态读写**

固定状态路径：`.sclaw/local/template-source-import.json`。

```ts
export interface TemplateImportLocalState {
  schemaVersion: 1;
  sourcePath: string;
  sourceFingerprint: string;
  importedAt: string;
  files: Record<string, string>;
}

export async function readTemplateImportState(templateRoot: string): Promise<TemplateImportLocalState | null>;
export async function writeTemplateImportState(templateRoot: string, state: TemplateImportLocalState): Promise<void>;
```

写入使用相邻临时文件后 `rename()`，保证原子更新。解析失败返回 `null` 并记录 warning，不把本地绝对路径写入日志。

- [ ] **Step 5: 实现只读快照和哈希扫描**

定义：

```ts
export interface PreparedTemplateImport {
  preview: Omit<TemplateImportPreview, 'importToken' | 'expiresAt'>;
  snapshotRoot: string;
  sourcePath: string;
  sourceFingerprint: string;
  importFiles: Record<string, string>;
  mergedPackageJson: Record<string, unknown>;
  sourceEntry?: { originalPath: string; stagedPath: string };
  sourceViteConfig?: { originalPath: string; stagedPath: string; extension: 'ts' | 'js' | 'mjs' | 'mts' };
}

export async function scanTemplateSource(input: {
  templateRoot: string;
  sourcePath: string;
  pageType: CodeApplicationPageType;
  managedPackages?: string[];
}): Promise<PreparedTemplateImport>;
```

实现要求：

1. 使用 `mkdtemp(join(tmpdir(), 'sclaw-template-import-'))` 创建快照。
2. 使用 `readdir(..., { withFileTypes: true })` 递归；任何 `isSymbolicLink()` 立即失败并清理快照。
3. 通过 Task 1 规则分类，敏感/忽略路径只记录相对路径。
4. 来源必须包含可解析 `package.json`、`src/`、React 依赖和 Vite 依赖或 Vite script。
5. 来源 `manifest.json` 明确声明相反 pageType 时产生 `PAGE_TYPE_MISMATCH` blocker；未声明时产生 `PAGE_TYPE_UNDECLARED` warning。
6. 识别 `src/main.{tsx,ts,jsx,js}`；保存到快照的 `src/main.source.<ext>`，目标 `src/main.*` 不进入普通覆盖清单，并产生 `SOURCE_ENTRY_WRAPPED` warning。
7. 在普通路径分类前识别单个 `vite.config.{ts,js,mjs,mts}` 并映射为 source config；多个配置作为 `VITE_CONFIG_UNRECOGNIZED` blocker。
8. SHA-256 哈希文件内容；快照 fingerprint 对排序后的 `path:hash` 再做 SHA-256。
9. add/modify 对比目标当前业务文件；delete 只来源于上一次 state.files，不扫描删除目标中从未由上传管理的文件。
10. `changes`、`ignoredPaths`、issues 按 path 排序，保证 UI 和测试稳定。
11. 任意失败清理临时快照。

- [ ] **Step 6: 补充模板归档回归测试**

在 `app-template-archive.test.ts` 写入 `.sclaw/local/template-source-import.json`，断言 ZIP 不包含它，也不包含来源绝对路径字符串。

- [ ] **Step 7: 运行测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-import-scanner.test.ts tests/unit/app-template-archive.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交 Task 3**

```bash
git add electron/services/app-template-import-state.ts electron/services/app-template-import-scanner.ts tests/unit/app-template-import-scanner.test.ts tests/unit/app-template-archive.test.ts
git commit -m "feat(app-template): scan project import snapshots"
```

---

### Task 4: 一次性导入会话与 prepare/status/cancel 服务

**Files:**
- Create: `electron/services/app-template-import-session-store.ts`
- Create: `electron/services/app-template-source-import-service.ts`
- Modify: `electron/services/app-dev-service.ts`
- Test: `tests/unit/app-template-import-session-store.test.ts`
- Test: `tests/unit/app-template-source-import-service.test.ts`

**Interfaces:**
- Consumes: Task 3 `PreparedTemplateImport` 和 local state。
- Produces: `getAppTemplateImportStatus()`、`prepareAppTemplateSourceImport()`、`cancelAppTemplateSourceImport()`、`defaultAppTemplateImportSessionStore`；Task 5 在同一 service 中增加 apply。

- [ ] **Step 1: 写 Session Store 失败测试**

```ts
function prepared(snapshotRoot: string): PreparedTemplateImport {
  return {
    snapshotRoot,
    sourcePath: '/source/demo',
    sourceFingerprint: 'fingerprint',
    importFiles: {},
    mergedPackageJson: {},
    preview: {
      sourceName: 'demo',
      detectedStack: 'react-vite',
      pageType: 'site',
      changes: [],
      ignoredPaths: [],
      packageChanges: [],
      issues: [],
    },
  };
}

it('Token 绑定 workspace、十分钟过期且只能消费一次', async () => {
  let now = 1_000;
  const removed: string[] = [];
  const store = new AppTemplateImportSessionStore({
    now: () => now,
    removeSnapshot: async (path) => { removed.push(path); },
  });
  const created = store.create('ws-1', prepared('/tmp/snapshot'));

  expect(() => store.take(created.importToken, 'ws-2')).toThrow('导入会话不属于当前模板');
  expect(store.take(created.importToken, 'ws-1').prepared.snapshotRoot).toBe('/tmp/snapshot');
  expect(() => store.take(created.importToken, 'ws-1')).toThrow('导入会话不存在或已使用');

  const expired = store.create('ws-1', prepared('/tmp/expired'));
  now += 10 * 60 * 1000 + 1;
  await expect(store.cancel(expired.importToken, 'ws-1')).resolves.toBe(false);
  expect(removed).toContain('/tmp/expired');
});
```

- [ ] **Step 2: 运行 Session Store 测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-import-session-store.test.ts`

Expected: FAIL，提示 Session Store 不存在。

- [ ] **Step 3: 实现 Session Store**

实现固定 TTL `10 * 60 * 1000` 毫秒。`create()` 使用 `createUlid()` 生成 token，返回 `expiresAt` ISO 字符串；`take()` 在返回前从 Map 删除记录但不清理快照，快照所有权交给 apply；`cancel()` 与过期清理调用注入的 `removeSnapshot(path)`。暴露 `dispose()` 清理全部会话，便于测试和应用退出清理。

- [ ] **Step 4: 导出模板 Marker 读取函数**

在 `app-dev-service.ts` 将现有私有 helper 收敛为：

```ts
export function appTemplateWorkspaceMarkerPath(templateRoot: string): string;
export async function readAppTemplateWorkspaceMarker(templateRoot: string): Promise<AppTemplateWorkspaceMarker>;
```

读取函数必须验证 `kind === 'app-template'`、`templateId` 非空、`pageType` 为 `site|assets`；现有 open/publish 流程改为复用它，不改变行为。

- [ ] **Step 5: 写 status/prepare/cancel 服务失败测试**

```ts
const deps: AppTemplateSourceImportDependencies = {
  getWorkspaceRootPath: getWorkspaceRootPathMock,
  readMarker: readMarkerMock,
  readState: readStateMock,
  scan: scanMock,
  listBindings: listBindingsMock,
  isGitAvailable: isGitAvailableMock,
  pathExists: pathExistsMock,
  sessionStore,
};

it('prepare 只接受模板 workspace，并支持省略路径重新上传', async () => {
  getWorkspaceRootPathMock.mockResolvedValue('/templates/site-a');
  readMarkerMock.mockResolvedValue({ kind: 'app-template', templateId: 'site-a', pageType: 'site' });
  readStateMock.mockResolvedValue({ sourcePath: '/source/demo', importedAt: '2026-08-28T00:00:00Z' });

  const preview = await prepareAppTemplateSourceImport({ workspaceId: 'ws-1' }, deps);

  expect(scanMock).toHaveBeenCalledWith(expect.objectContaining({
    templateRoot: '/templates/site-a',
    sourcePath: '/source/demo',
    pageType: 'site',
  }));
  expect(preview.importToken).toBeTruthy();
});

it('status 不向 Renderer 返回来源绝对路径', async () => {
  const status = await getAppTemplateImportStatus({ workspaceId: 'ws-1' }, deps);
  expect(status).toEqual(expect.objectContaining({ hasSource: true, sourceName: 'demo' }));
  expect(status).not.toHaveProperty('sourcePath');
});
```

- [ ] **Step 6: 实现服务编排**

导出测试可注入依赖，并提供使用真实模块的默认值：

```ts
export interface AppTemplateSourceImportDependencies {
  getWorkspaceRootPath(workspaceId: string): Promise<string | null>;
  readMarker(templateRoot: string): Promise<AppTemplateWorkspaceMarker>;
  readState(templateRoot: string): Promise<TemplateImportLocalState | null>;
  scan(input: Parameters<typeof scanTemplateSource>[0]): ReturnType<typeof scanTemplateSource>;
  listBindings(templateRoot: string): Promise<ExternalServiceBindingSnapshot[]>;
  isGitAvailable(): Promise<boolean>;
  pathExists(path: string): boolean;
  sessionStore: AppTemplateImportSessionStore;
}
```

服务内部统一使用：

```ts
async function resolveTemplateWorkspace(workspaceId: string): Promise<{
  templateRoot: string;
  marker: AppTemplateWorkspaceMarker;
}>;
```

`prepareAppTemplateSourceImport({ workspaceId, sourcePath? })`：

1. 解析目标模板工作区。
2. sourcePath 未提供时读取 local state；不存在时抛 400 错误“请选择来源项目目录”。
3. 校验来源目录存在且不是目标模板目录及其父/子目录。
4. 调用 `listExternalServiceBindings(templateRoot)`，把绑定快照中的 `integration.npmPackage` 与固定包 `@sto/sclaw-plugin-sso-auth` 合并为 `managedPackages`，确保当前模板的外部服务 SDK 不被来源 package 覆盖。
5. 检查 Git 可用；不可用时向 preview 增加 `GIT_UNAVAILABLE` blocker，保证成功上传后一定可通过现有 checkpoint 恢复。
6. 调用 scanner，并传入 `managedPackages`。
7. 将 prepared 放入 session store。
8. 返回带 token/expiry 的 preview。

`status` 只返回 basename、可访问性和时间；`cancel` 校验 workspace 归属并清理会话。

- [ ] **Step 7: 运行测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-import-session-store.test.ts tests/unit/app-template-source-import-service.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交 Task 4**

```bash
git add electron/services/app-template-import-session-store.ts electron/services/app-template-source-import-service.ts electron/services/app-dev-service.ts tests/unit/app-template-import-session-store.test.ts tests/unit/app-template-source-import-service.test.ts
git commit -m "feat(app-template): prepare project import sessions"
```

---

### Task 5: 事务覆盖、回滚和预览重启

**Files:**
- Modify: `electron/services/app-template-source-import-service.ts`
- Test: `tests/unit/app-template-source-import-service.test.ts`

**Interfaces:**
- Consumes: `defaultAppTemplateImportSessionStore.take()`、Task 2 adapter、Task 3 state、`createCheckpoint()`、`restartApp()`。
- Produces: `applyAppTemplateSourceImport({ workspaceId, importToken }) => Promise<TemplateImportApplyResult>`。

- [ ] **Step 1: 写成功覆盖失败测试**

```ts
it('确认后创建 checkpoint、镜像业务文件并保留模板身份', async () => {
  const target = await createImportFixtureTree('template-target-', {
    'manifest.json': JSON.stringify({ schemaVersion: 1, templateId: 'site-a', pageType: 'site', name: '模板 A' }),
    'package.json': JSON.stringify({ dependencies: { '@sto/sclaw-plugin-sso-auth': '0.1.0', react: '^19.0.0' }, devDependencies: { vite: '^5.4.0' } }),
    'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({ build: { outDir: 'build' } });",
    'src/main.tsx': 'platform main',
    'src/sclaw/bootstrap.ts': 'export async function bootstrapInstalledPlugins() {}',
    'src/App.tsx': 'old',
    'src/obsolete.ts': 'old',
  });
  const source = await createImportFixtureTree('template-source-', {
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^5.4.0' } }),
    'src/App.tsx': 'new',
    'src/main.tsx': 'source main',
  });
  await writeTemplateImportState(target, {
    schemaVersion: 1,
    sourcePath: source,
    sourceFingerprint: 'previous',
    importedAt: '2026-08-27T00:00:00.000Z',
    files: { 'src/App.tsx': 'old-hash', 'src/obsolete.ts': 'old-hash' },
  });
  const prepared = await scanTemplateSource({ templateRoot: target, sourcePath: source, pageType: 'site' });
  const created = sessionStore.create('ws-1', prepared);

  const result = await applyAppTemplateSourceImport({ workspaceId: 'ws-1', importToken: created.importToken }, deps);

  expect(createCheckpointMock).toHaveBeenCalledWith(target, '上传项目前自动保存');
  expect(await readFile(join(target, 'src/App.tsx'), 'utf8')).toBe('new');
  await expect(stat(join(target, 'src/obsolete.ts'))).rejects.toThrow();
  expect(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'))).toMatchObject({
    templateId: 'site-a', pageType: 'site', schemaVersion: 1,
  });
  expect(restartAppMock).toHaveBeenCalledWith('ws-1', target);
  expect(result.restartRequested).toBe(true);
});
```

- [ ] **Step 2: 写中途失败自动恢复测试**

注入 `copyFile` 在第二个业务文件抛错，断言：旧 `src/App.tsx` 和 `src/obsolete.ts` 完全恢复、未留下新文件、local state 未更新、token 无法再次使用、临时快照已删除。

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-source-import-service.test.ts`

Expected: FAIL，提示 `applyAppTemplateSourceImport` 不存在。

- [ ] **Step 4: 实现事务应用算法**

实现固定顺序：

1. `take(importToken, workspaceId)` 单次消费 session。
2. 重新解析 workspace 和 Marker，核对 prepared 中记录的 templateId/pageType。
3. 若 preview 存在 blocker，抛 400，禁止写入。
4. 调用 `createCheckpoint(templateRoot, '上传项目前自动保存')`。
5. 为所有 add/modify/delete、`package.json`、Vite 文件、入口文件和 local state 建立临时恢复快照；记录原本不存在的路径。
6. 删除 preview 中 kind=delete 的业务文件。
7. 从 snapshot 复制 add/modify 文件，复制前再次通过 Task 1 path rule。
8. 将来源入口写为 `src/main.source.<ext>`，写入 Task 2 生成的受管 `src/main.tsx`。
9. 首次导入将原 `vite.config.ts` 复制为 `vite.config.sclaw.ts`；写入 wrapper；来源配置写为 `vite.config.source.<ext>`；删除旧 source config 扩展版本。
10. 写入合并后的 `package.json`。
11. 重新读取 Manifest 并核对 `schemaVersion/templateId/pageType` 未变化。
12. 原子写 local state。
13. 调用 `restartApp(workspaceId, templateRoot)`；设置 `restartRequested: true`。
14. 清理导入快照和恢复快照。

步骤 6-12 任意失败时按恢复快照逆序恢复；`restartApp` 失败不回滚源码，而是返回 `restartRequested: true` 并让现有 status/error 流程展示启动失败。

- [ ] **Step 5: 清理空目录与限制规模**

删除业务文件后只向上清理到模板根目录，遇到非空目录停止。prepare 阶段限制最多 5,000 个业务文件、单文件 5 MiB、总快照 200 MiB；超限返回 `INVALID_PROJECT` blocker，不进入 session store。

- [ ] **Step 6: 运行测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-source-import-service.test.ts tests/unit/app-template-import-scanner.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交 Task 5**

```bash
git add electron/services/app-template-source-import-service.ts tests/unit/app-template-source-import-service.test.ts tests/unit/app-template-import-scanner.test.ts
git commit -m "feat(app-template): apply project imports transactionally"
```

---

### Task 6: Host API 与 Renderer API

**Files:**
- Modify: `electron/api/routes/app-templates.ts`
- Modify: `src/lib/app-dev-api.ts`
- Test: `tests/unit/app-template-source-import-route.test.ts`
- Test: `tests/unit/app-template-source-import-renderer-api.test.ts`

**Interfaces:**
- Consumes: Tasks 4-5 service functions。
- Produces: `getAppTemplateImportStatus()`、`prepareAppTemplateImport()`、`applyAppTemplateImport()`、`cancelAppTemplateImport()` Renderer functions，供 Task 7 使用。

- [ ] **Step 1: 写路由失败测试**

```ts
it('prepare 只转发 workspaceId 和来源路径，apply 不接收文件清单', async () => {
  parseJsonBodyMock.mockResolvedValueOnce({ workspaceId: 'ws-1', sourcePath: '/source/demo' });
  prepareMock.mockResolvedValueOnce(preview);
  const handled = await handleAppTemplateRoutes(
    { method: 'POST' } as IncomingMessage,
    {} as ServerResponse,
    new URL('http://127.0.0.1/api/app-templates/workspaces/import-source/prepare'),
    {} as never,
  );
  expect(handled).toBe(true);
  expect(prepareMock).toHaveBeenCalledWith({ workspaceId: 'ws-1', sourcePath: '/source/demo' });

  parseJsonBodyMock.mockResolvedValueOnce({
    workspaceId: 'ws-1', importToken: 'token-1', changes: [{ path: '../evil', kind: 'add' }],
  });
  await callApplyRoute();
  expect(applyMock).toHaveBeenCalledWith({ workspaceId: 'ws-1', importToken: 'token-1' });
});
```

- [ ] **Step 2: 写 Renderer API 失败测试**

Mock `hostApiFetch`，断言四个函数分别访问：

```text
GET  /api/app-templates/workspaces/import-source/status?workspaceId=ws-1
POST /api/app-templates/workspaces/import-source/prepare
POST /api/app-templates/workspaces/import-source/apply
POST /api/app-templates/workspaces/import-source/cancel
```

并断言 apply body 只有 `workspaceId/importToken`。

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-source-import-route.test.ts tests/unit/app-template-source-import-renderer-api.test.ts`

Expected: FAIL，提示路由/API 不存在。

- [ ] **Step 4: 实现四个 Host 路由**

在 publish 路由之前加入 status/prepare/apply/cancel 精确路径判断。缺少 `workspaceId`、`importToken` 时抛带 `statusCode: 400` 的错误；service 的 4xx 继续由现有 catch 保留，未知错误返回 500。日志只记录 workspaceId、计数和 issue code，不记录 sourcePath、Token、敏感文件内容。

- [ ] **Step 5: 实现 Renderer API**

```ts
export async function getAppTemplateImportStatus(workspaceId: string): Promise<TemplateImportStatus>;
export async function prepareAppTemplateImport(input: { workspaceId: string; sourcePath?: string }): Promise<TemplateImportPreview>;
export async function applyAppTemplateImport(input: { workspaceId: string; importToken: string }): Promise<TemplateImportApplyResult>;
export async function cancelAppTemplateImport(input: { workspaceId: string; importToken: string }): Promise<void>;
```

prepare/apply 使用 `APP_DEV_LONG_RUNNING`；status/cancel 使用普通超时。

- [ ] **Step 6: 运行测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-source-import-route.test.ts tests/unit/app-template-source-import-renderer-api.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交 Task 6**

```bash
git add electron/api/routes/app-templates.ts src/lib/app-dev-api.ts tests/unit/app-template-source-import-route.test.ts tests/unit/app-template-source-import-renderer-api.test.ts
git commit -m "feat(app-template): expose project upload host api"
```

---

### Task 7: 模板编辑页上传交互

**Files:**
- Create: `src/components/more-apps/TemplateProjectUploadDialog.tsx`
- Create: `src/components/more-apps/TemplateProjectUploadControl.tsx`
- Modify: `src/components/more-apps/AppPlazaDevAppPane.tsx`
- Test: `tests/unit/app-template-project-upload-dialog.test.tsx`
- Test: `tests/unit/app-template-project-upload-control.test.tsx`

**Interfaces:**
- Consumes: Task 6 Renderer API、`pickProjectFolder()`、`TemplateImportPreview`。
- Produces: `<TemplateProjectUploadControl workspaceId onApplied />`，成功后通知 workbench 刷新文件和预览。

- [ ] **Step 1: 写确认弹窗失败测试**

```tsx
it('展示新增修改删除、忽略项和阻断项', () => {
  const basePreview = createTemplateImportPreview();
  render(<TemplateProjectUploadDialog
    open
    preview={{
      ...basePreview,
      changes: [
        { path: 'src/New.tsx', kind: 'add' },
        { path: 'src/App.tsx', kind: 'modify' },
        { path: 'src/Old.tsx', kind: 'delete' },
      ],
      ignoredPaths: ['.env.daily'],
      issues: [{ code: 'PAGE_TYPE_MISMATCH', level: 'blocker', message: '类型不一致' }],
    }}
    applying={false}
    onApply={vi.fn()}
    onCancel={vi.fn()}
    onPickAnother={vi.fn()}
  />);

  expect(screen.getByText('新增 1')).toBeInTheDocument();
  expect(screen.getByText('修改 1')).toBeInTheDocument();
  expect(screen.getByText('删除 1')).toBeInTheDocument();
  expect(screen.getByText('.env.daily')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认覆盖' })).toBeDisabled();
});
```

- [ ] **Step 2: 写控件流程失败测试**

```tsx
it('首次选择目录，成功后改为重新上传并通知工作台刷新', async () => {
  const basePreview = createTemplateImportPreview();
  statusMock.mockResolvedValueOnce({ hasSource: false, sourceAvailable: false });
  pickFolderMock.mockResolvedValueOnce('/source/demo');
  prepareMock.mockResolvedValueOnce(basePreview);
  applyMock.mockResolvedValueOnce({
    changedFiles: ['src/App.tsx'], checkpointCreated: true,
    importedAt: '2026-08-28T00:00:00Z', restartRequested: true,
  });
  const onApplied = vi.fn();
  render(<TemplateProjectUploadControl workspaceId="ws-1" onApplied={onApplied} />);

  fireEvent.click(await screen.findByRole('button', { name: '上传项目' }));
  expect(prepareMock).toHaveBeenCalledWith({ workspaceId: 'ws-1', sourcePath: '/source/demo' });
  fireEvent.click(await screen.findByRole('button', { name: '确认覆盖' }));
  await waitFor(() => expect(onApplied).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: '重新上传' })).toBeInTheDocument();
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-project-upload-dialog.test.tsx tests/unit/app-template-project-upload-control.test.tsx`

Expected: FAIL，提示组件不存在。

- [ ] **Step 4: 实现独立确认弹窗**

弹窗必须包含：来源项目名、技术栈、Site/Assets 类型、add/modify/delete 计数、可展开文件列表、package 变更表、忽略路径、warning/blocker。删除项使用危险色但整个操作不使用“删除模板”措辞；存在 blocker 或 applying 时禁用确认。关闭、取消和“选择其他目录”都调用 `onCancel`，确保 Host 清理旧 token。

- [ ] **Step 5: 实现上传控件状态机**

控件状态固定为：

```ts
type UploadState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'review'; preview: TemplateImportPreview }
  | { kind: 'applying'; preview: TemplateImportPreview };
```

行为：

1. mount 调 status。
2. 无来源时点击按钮先调用 `pickProjectFolder()`，取消选择不报错。
3. 有可用来源时点击“重新上传”直接 prepare，省略 sourcePath。
4. 有来源但目录不可访问时自动要求重新选择。
5. “选择其他目录”先 cancel 当前 token，再选择并 prepare 新目录。
6. apply 成功 toast 显示变更文件数，刷新 status，调用 `onApplied(result)`。
7. 组件卸载且仍有未使用 token 时调用 cancel；cancel 失败不遮盖用户原始操作错误。

- [ ] **Step 6: 挂载到模板工作台工具栏**

在 `AppPlazaDevAppPane` 的模板按钮区域，把控件放在“提交”和“发布模板”之间：

```tsx
{isTemplateWorkspace ? (
  <TemplateProjectUploadControl
    workspaceId={workspaceId}
    onApplied={() => {
      setSourceRevision((value) => value + 1);
      toast.success('项目已上传，预览正在刷新');
    }}
  />
) : null}
```

Host apply 已调用 `restartApp()`；Renderer 不再次 restart，依赖现有 status poll 获取新 previewUrl，避免双重启。普通应用 tab 不渲染该控件。

- [ ] **Step 7: 运行 UI 测试并确认通过**

Run: `pnpm vitest run tests/unit/app-template-project-upload-dialog.test.tsx tests/unit/app-template-project-upload-control.test.tsx tests/unit/app-template-manager-dialog.test.tsx`

Expected: PASS。

- [ ] **Step 8: 提交 Task 7**

```bash
git add src/components/more-apps/TemplateProjectUploadDialog.tsx src/components/more-apps/TemplateProjectUploadControl.tsx src/components/more-apps/AppPlazaDevAppPane.tsx tests/unit/app-template-project-upload-dialog.test.tsx tests/unit/app-template-project-upload-control.test.tsx
git commit -m "feat(app-template): upload projects from editor"
```

---

### Task 8: 契约文档与端到端回归

**Files:**
- Create: `docs/contracts/sclaw-app-template-source-import-v1.md`
- Create: `tests/unit/app-template-source-import-integration.test.ts`
- Modify: `docs/superpowers/specs/2026-08-28-app-template-project-upload-design.md`

**Interfaces:**
- Consumes: Tasks 1-7 完整链路。
- Produces: 稳定 Host API 契约与最终回归证据。

- [ ] **Step 1: 写端到端失败测试**

用临时 Site 模板和来源 React/Vite 项目走真实 scanner/session/apply，只有 Session Catalog、checkpoint 和 restart 使用 mock。断言：

```ts
expect(firstPreview.changes).toEqual(expect.arrayContaining([
  { path: 'src/App.tsx', kind: 'modify' },
]));
expect(firstApply.changedFiles).toContain('src/App.tsx');
expect(await readFile(join(templateRoot, 'src/main.tsx'), 'utf8')).toContain('bootstrapInstalledPlugins');
expect(await readFile(join(templateRoot, 'src/main.source.tsx'), 'utf8')).toContain('createRoot');
expect(await readFile(join(templateRoot, 'vite.config.ts'), 'utf8')).toContain('mergeConfig');
expect(await readFile(join(templateRoot, 'vite.config.sclaw.ts'), 'utf8')).toContain('ssoAuthVite');
expect(await readFile(join(templateRoot, 'vite.config.source.ts'), 'utf8')).toContain('defineConfig');
```

修改来源并删除一个已导入文件，再 prepare/apply 第二次；断言 preview 出现 delete、确认后目标删除，受保护文件仍存在。再构建模板 ZIP，断言 `.sclaw/local` 和来源绝对路径不在产物内。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run tests/unit/app-template-source-import-integration.test.ts`

Expected: 首次运行至少有一个真实集成断言失败；修正 Tasks 1-7 实现，禁止通过降低断言规避。

- [ ] **Step 3: 编写 Host API 契约文档**

`docs/contracts/sclaw-app-template-source-import-v1.md` 必须记录：四个接口、请求/响应 JSON 示例、10 分钟 token TTL、单次消费、status 不返回绝对路径、blocker/warning code、规模上限、受保护/忽略规则、错误状态码和上传不等于发布。

- [ ] **Step 4: 更新设计状态**

将设计文档首部状态改为：

```markdown
**状态：已实施**
```

不得改写已确认的功能边界；若实现发现新限制，只在文档增加“实施说明”并给出精确原因。

- [ ] **Step 5: 运行定向完整测试**

Run:

```bash
pnpm vitest run \
  tests/unit/app-template-import-rules.test.ts \
  tests/unit/app-template-import-adapter.test.ts \
  tests/unit/app-template-import-scanner.test.ts \
  tests/unit/app-template-import-session-store.test.ts \
  tests/unit/app-template-source-import-service.test.ts \
  tests/unit/app-template-source-import-route.test.ts \
  tests/unit/app-template-source-import-renderer-api.test.ts \
  tests/unit/app-template-project-upload-dialog.test.tsx \
  tests/unit/app-template-project-upload-control.test.tsx \
  tests/unit/app-template-source-import-integration.test.ts \
  tests/unit/app-template-archive.test.ts \
  tests/unit/app-template-manager-dialog.test.tsx
```

Expected: 全部 PASS，无 unhandled rejection。

- [ ] **Step 6: 运行静态检查和构建**

Run:

```bash
pnpm exec eslint \
  shared/app-template-source-import.ts \
  electron/services/app-template-import-rules.ts \
  electron/services/app-template-import-adapter.ts \
  electron/services/app-template-import-scanner.ts \
  electron/services/app-template-import-state.ts \
  electron/services/app-template-import-session-store.ts \
  electron/services/app-template-source-import-service.ts \
  electron/api/routes/app-templates.ts \
  src/lib/app-dev-api.ts \
  src/components/more-apps/TemplateProjectUploadDialog.tsx \
  src/components/more-apps/TemplateProjectUploadControl.tsx \
  src/components/more-apps/AppPlazaDevAppPane.tsx
pnpm run build:vite
git diff --check
```

Expected: ESLint 无 error；build:vite exit 0；diff check 无输出。既有 warning 必须在交付说明中列出，不能宣称全仓无警告。

- [ ] **Step 7: 手工验证模板编辑闭环**

在本地开发版执行：

1. 打开一个 Site 模板，确认工具栏顺序为“提交 / 上传项目 / 发布模板”。
2. 上传一个 React/Vite 项目，核对扫描弹窗和文件删除清单。
3. 确认后检查代码视图和预览自动刷新。
4. 修改来源项目并点击“重新上传”，确认镜像删除生效。
5. 使用“恢复上一版”回到上传前 checkpoint。
6. 打开普通应用，确认没有“上传项目”。
7. 打开 Assets 模板，确认本地身份桥接仍可用。
8. 发布模板新版本，再从该版本创建应用并确认预览成功。

- [ ] **Step 8: 提交 Task 8**

```bash
git add docs/contracts/sclaw-app-template-source-import-v1.md docs/superpowers/specs/2026-08-28-app-template-project-upload-design.md tests/unit/app-template-source-import-integration.test.ts
git commit -m "test(app-template): verify project upload workflow"
```
