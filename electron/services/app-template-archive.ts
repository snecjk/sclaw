import { readFile, readdir } from 'fs/promises';
import { join, posix, relative, sep } from 'path';
import JSZip from 'jszip';

const BLOCKED_DIRECTORIES = new Set(['.git', '.sclaw', 'node_modules', 'dist', 'build']);
const BLOCKED_INTERNAL_FILES = new Set(['.sclaw-template-meta.json']);

function archivePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join(posix.sep);
}

async function collectFiles(root: string, current: string, files: string[]): Promise<void> {
  const entries = (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`模板不能包含符号链接: ${archivePath(root, join(current, entry.name))}`);
    }
    if (entry.isDirectory() && BLOCKED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
    const lowerName = entry.name.toLowerCase();
    if (lowerName.startsWith('.env') && lowerName !== '.env.example') continue;
    if (BLOCKED_INTERNAL_FILES.has(entry.name)) continue;
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, files);
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
}

export async function buildAppTemplateArchive(templateRoot: string): Promise<Uint8Array> {
  const files: string[] = [];
  await collectFiles(templateRoot, templateRoot, files);
  const names = files.map((filePath) => archivePath(templateRoot, filePath));
  if (!names.includes('manifest.json') || !names.includes('package.json')) {
    throw new Error('模板根目录必须包含 manifest.json 和 package.json');
  }

  const zip = new JSZip();
  for (let index = 0; index < files.length; index += 1) {
    zip.file(names[index]!, await readFile(files[index]!));
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}
