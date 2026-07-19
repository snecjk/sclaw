import path from 'node:path';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { workspacePath } from './workspace-paths';

type FetchLike = (input: string | URL, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;

export interface HydratedNodeFile {
  kind: 'artifact';
  fileId: string;
  name: string;
  filePath: string;
  uri: string;
  ossKey?: string;
  tempUrl?: string;
  contentType?: string;
}

/** Materialize design-time localImport files and inject them into real node input. */
export async function hydrateNodeInputFiles(
  node: any,
  nodeInput: unknown,
  runId: string,
  fetchImpl: FetchLike = proxyAwareFetch,
): Promise<{ input: unknown; files: HydratedNodeFile[] }> {
  if (node?.type !== 'agent_data_fetch') return { input: nodeInput, files: [] };
  const business = node?.config?.businessConfig ?? {};
  if (business.sourceType && business.sourceType !== 'local_upload') return { input: nodeInput, files: [] };
  const declared = Array.isArray(business.localImport?.files) ? business.localImport.files : [];
  const mode = String(business.inputProvisionMode || 'node_embedded');
  // Cloud runs historically persisted files selected immediately before a
  // trial run into localImport.files even when the designer labelled the mode
  // `runtime_upload`.  They are runtime input, not node-embedded fixtures.
  // Do not discard them merely because of that label; only fail later when no
  // actual uploaded file was supplied at all.
  if (!['node_embedded', 'mixed', 'runtime_upload'].includes(mode)) return { input: nodeInput, files: [] };
  const base = nodeInput && typeof nodeInput === 'object' && !Array.isArray(nodeInput)
    ? { ...(nodeInput as Record<string, unknown>) }
    : (nodeInput == null ? {} : { payload: nodeInput });
  const existing = Array.isArray((base as any).files) ? (base as any).files : [];
  if (!declared.length && !existing.length) return { input: nodeInput, files: [] };

  const directory = path.join(workspacePath(runId, node.id), 'inputs');
  await mkdir(directory, { recursive: true });
  const files: HydratedNodeFile[] = [];
  for (let index = 0; index < existing.length; index += 1) {
    const source = existing[index] as any;
    if (!source?.filePath || typeof source.filePath !== 'string') continue;
    const name = safeFileName(String(source.name || path.basename(source.filePath)));
    const target = path.join(directory, `runtime-${String(index + 1).padStart(2, '0')}-${name}`);
    await copyFile(source.filePath, target);
    files.push({ kind: 'artifact', fileId: String(source.fileId || `runtime_${index + 1}`), name,
      filePath: target, uri: pathToFileURL(target).href, contentType: String(source.contentType || inferContentType(name)) });
  }
  // A newly selected runtime file supersedes the short-lived design-time
  // upload URL.  Re-downloading that URL can fail after its OSS signature
  // expires and must not block the file the user just confirmed.
  const declaredToMaterialize = mode === 'runtime_upload' && existing.length ? [] : declared;
  for (let index = 0; index < declaredToMaterialize.length; index += 1) {
    const source = declaredToMaterialize[index];
    if (!source || typeof source !== 'object') continue;
    const url = String(source.tempUrl || source.url || '').trim();
    if (!url) throw new Error(`节点 ${node.name ?? node.id} 的内置文件缺少可下载地址: ${source.name ?? index + 1}`);
    const name = safeFileName(String(source.name || `input-${index + 1}`));
    const target = path.join(directory, `${String(index + 1).padStart(2, '0')}-${name}`);
    const response = await fetchImpl(url, { method: 'GET', timeoutMs: 120_000 });
    if (!response.ok) {
      throw new Error(`节点 ${node.name ?? node.id} 下载内置文件失败: ${name} (${response.status})`);
    }
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    files.push({
      kind: 'artifact',
      fileId: String(source.fileId || `file_${String(index + 1).padStart(3, '0')}`),
      name,
      filePath: target,
      uri: pathToFileURL(target).href,
      ossKey: source.ossKey ? String(source.ossKey) : undefined,
      tempUrl: url,
      contentType: String(source.contentType || inferContentType(name)),
    });
  }

  const mergedFiles = files;
  return {
    input: {
      ...base,
      files: mergedFiles,
      localImport: {
        sourceType: 'local_upload',
        inputProvisionMode: mode,
        count: mergedFiles.length,
        files: mergedFiles,
      },
    },
    files,
  };
}

function safeFileName(name: string): string {
  const cleaned = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return cleaned || 'input-file';
}

function inferContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.csv') return 'text/csv';
  return 'application/octet-stream';
}
