import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';

const rootDir = process.cwd();
const baseUrl = String(process.env.STO_MEMORY_CENTER_BASE_URL || '').trim().replace(/\/+$/, '');
const stoToken = String(process.env.STO_TOKEN || '').trim();
const clientId = String(process.env.SAI_CLIENT_ID || 'StoClaw').trim();

if (!baseUrl || !stoToken) {
  throw new Error('需要设置 STO_MEMORY_CENTER_BASE_URL 和 STO_TOKEN');
}

const blockedDirectories = new Set(['.git', '.sclaw', 'node_modules', 'dist', 'build']);

async function collectFiles(templateRoot, current, output) {
  const entries = (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`模板包含符号链接: ${entry.name}`);
    const absolutePath = join(current, entry.name);
    const archiveName = relative(templateRoot, absolutePath).split(sep).join('/');
    if (entry.isDirectory() && blockedDirectories.has(entry.name.toLowerCase())) continue;
    const lowerName = entry.name.toLowerCase();
    if (lowerName.startsWith('.env') && lowerName !== '.env.example') continue;
    if (entry.isDirectory()) await collectFiles(templateRoot, absolutePath, output);
    else if (entry.isFile()) output.push({ absolutePath, archiveName });
  }
}

async function buildArchive(templateId) {
  const templateRoot = join(rootDir, 'resources', 'app-templates', templateId);
  const files = [];
  await collectFiles(templateRoot, templateRoot, files);
  const zip = new JSZip();
  for (const file of files) zip.file(file.archiveName, await readFile(file.absolutePath));
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}

async function publishBuiltin({ templateId, pageType, name }) {
  const bytes = await buildArchive(templateId);
  const form = new FormData();
  form.append('metadata', JSON.stringify({
    templateId,
    pageType,
    name,
    description: 'SClaw 平台内置最简模板',
    isBuiltin: true,
    initializeIfAbsent: true,
  }));
  form.append('file', new Blob([bytes], { type: 'application/zip' }), 'template.zip');
  const response = await fetch(`${baseUrl}/agent/v1/app-templates/publish`, {
    method: 'POST',
    headers: {
      stotoken: stoToken,
      Authorization: `Bearer ${stoToken}`,
      'X-SAI-Client-Id': clientId,
    },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.errMessage || `初始化 ${templateId} 失败: HTTP ${response.status}`);
  }
  const result = payload?.data;
  process.stdout.write(
    `${templateId}: ${result?.created === false ? '已存在，跳过' : `已发布 ${result?.version}`}\n`,
  );
}

await publishBuiltin({ templateId: 'site-minimal', pageType: 'site', name: '标准 Site 模版' });
await publishBuiltin({ templateId: 'assets-minimal', pageType: 'assets', name: '标准 Assets 模版' });
