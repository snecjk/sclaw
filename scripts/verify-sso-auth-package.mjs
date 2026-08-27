import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(repositoryRoot, 'packages', 'sclaw-plugin-sso-auth');
const templateRoot = join(repositoryRoot, 'resources', 'app-templates', 'site-minimal');

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
}

function requiredFiles(files) {
  const paths = new Set(files.map((file) => file.path));
  for (const path of [
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/runtime.js',
    'dist/runtime.cjs',
    'dist/runtime.d.ts',
    'dist/runtime.d.cts',
    'dist/vite.js',
    'dist/vite.cjs',
    'dist/vite.d.ts',
    'dist/vite.d.cts',
    'sclaw/plugin.json',
    'sclaw/schemas/config.schema.json',
    'sclaw/skills/sso-auth/SKILL.md',
  ]) {
    if (!paths.has(path)) throw new Error(`npm tarball 缺少 ${path}`);
  }
  for (const path of paths) {
    if (path.startsWith('src/') || path.startsWith('tests/') || path.includes('.env')) {
      throw new Error(`npm tarball 包含开发文件 ${path}`);
    }
  }
}

async function scanPackageTarball(tarballPath, extractionRoot) {
  await mkdir(extractionRoot, { recursive: true });
  run('tar', ['-xzf', tarballPath, '-C', extractionRoot], repositoryRoot);
  const forbidden = [
    '/Users/',
    '_authToken=',
    'npmAuthToken',
    'secret-code',
    'token-existing',
    'token-a',
  ];
  for (const path of await walkFiles(join(extractionRoot, 'package'))) {
    const content = await readFile(path, 'utf8').catch(() => '');
    for (const marker of forbidden) {
      if (content.includes(marker)) {
        throw new Error(`npm tarball 文件 ${path} 包含禁止标记 ${marker}`);
      }
    }
  }
}

async function walkFiles(root) {
  const result = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else result.push(child);
    }
  }
  await walk(root);
  return result;
}

async function scanSiteBuild(buildRoot) {
  const forbidden = [
    'SKILL.md',
    'x-sto-sso-auth-session',
    'STO_SSO_AUTH_SESSION',
    '?stoToken=',
    '/Users/',
  ];
  for (const path of await walkFiles(buildRoot)) {
    const content = await readFile(path, 'utf8').catch(() => '');
    for (const marker of forbidden) {
      if (content.includes(marker)) {
        throw new Error(`Site 构建产物 ${path} 包含禁止标记 ${marker}`);
      }
    }
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'sclaw-sso-auth-verify-'));
try {
  run('npm', ['test'], packageRoot);
  run('npm', ['run', 'typecheck'], packageRoot);
  run('npm', ['run', 'build'], packageRoot);

  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryRoot],
    { cwd: packageRoot, encoding: 'utf8' },
  );
  const packResult = JSON.parse(packOutput)[0];
  if (!packResult?.filename || !Array.isArray(packResult.files)) {
    throw new Error('npm pack 未返回有效文件列表');
  }
  requiredFiles(packResult.files);

  const tarballPath = join(temporaryRoot, packResult.filename);
  await scanPackageTarball(tarballPath, join(temporaryRoot, 'unpacked'));
  const siteRoot = join(temporaryRoot, 'site-minimal');
  await cp(templateRoot, siteRoot, { recursive: true });
  const sitePackagePath = join(siteRoot, 'package.json');
  const sitePackage = JSON.parse(await readFile(sitePackagePath, 'utf8'));
  sitePackage.dependencies['@sto/sclaw-plugin-sso-auth'] = `file:${tarballPath}`;
  await writeFile(sitePackagePath, `${JSON.stringify(sitePackage, null, 2)}\n`, 'utf8');

  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], siteRoot);
  run('npm', ['run', 'typecheck'], siteRoot);
  run('npm', ['run', 'build'], siteRoot);
  await scanSiteBuild(join(siteRoot, 'build'));

  process.stdout.write('SSO Auth package and Site template verification passed.\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
