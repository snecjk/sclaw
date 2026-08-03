import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowArtifactDraft, WorkflowArtifactRef, WorkflowPacket } from './workflow-packet';
import { WORKFLOW_PACKET_ARTIFACTS_KEY, type UpstreamWorkflowArtifact } from './input-resolver';

export const INLINE_TEXT_LIMIT_BYTES = 1024;

export type ArtifactOutputValidation<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export function validateInlinePayload(payload: unknown): ArtifactOutputValidation<{ bytes: number }> {
  let totalBytes = 0;
  let oversizedPath: string | undefined;
  let oversizedBytes = 0;
  let legacyHtmlPath: string | undefined;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, currentPath: string): void => {
    if (oversizedPath || legacyHtmlPath) return;
    if (typeof value === 'string') {
      const bytes = Buffer.byteLength(value, 'utf8');
      totalBytes += bytes;
      if ((currentPath === 'payload.html' || currentPath.endsWith('.html')) && /<!doctype\s+html|<html[\s>]/i.test(value)) {
        legacyHtmlPath = currentPath;
        return;
      }
      if (bytes > INLINE_TEXT_LIMIT_BYTES) {
        oversizedPath = currentPath;
        oversizedBytes = bytes;
      }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${currentPath}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      visit(entry, `${currentPath}.${key}`);
    }
  };

  visit(payload, 'payload');
  if (legacyHtmlPath) {
    return {
      ok: false,
      code: 'RESULT_LEGACY_INLINE_ARTIFACT',
      message: `${legacyHtmlPath} 不再支持内联 HTML；请在节点工作区写入文件，并通过 artifacts[].resourceId 声明产物`,
    };
  }
  if (oversizedPath) {
    return {
      ok: false,
      code: 'RESULT_LARGE_TEXT_INLINE',
      message: `${oversizedPath} 为 ${oversizedBytes} UTF-8 字节，超过 ${INLINE_TEXT_LIMIT_BYTES} 字节；请写入节点工作区文件并通过 artifact 传递`,
    };
  }
  return { ok: true, value: { bytes: totalBytes } };
}

/** Converts the retired payload.html contract into a small artifact-first payload schema. */
export function normalizeArtifactFirstPayloadSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object' };
  const value = schema as Record<string, unknown>;
  const properties = value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)
    ? value.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(value.required) ? value.required.filter((key: unknown) => key !== 'html' && key !== 'fileName') : undefined;
  const legacyHtml = 'html' in properties || (Array.isArray(value.required) && value.required.includes('html'));
  if (!legacyHtml) return value;
  const { html: _html, fileName: _fileName, ...remainingProperties } = properties;
  const normalized: Record<string, unknown> = {
    ...value,
    properties: {
      ...remainingProperties,
      summary: remainingProperties.summary ?? { type: 'string', maxLength: INLINE_TEXT_LIMIT_BYTES, description: '产物或结果的简短摘要' },
    },
  };
  if (required?.length) normalized.required = required;
  else delete normalized.required;
  return normalized;
}

export async function canonicalizeWorkflowArtifacts(
  packet: WorkflowPacket,
  options: { runId: string; nodeId: string; workspace: string; defaultKind?: 'OUTPUT' | 'INTERMEDIATE' },
): Promise<ArtifactOutputValidation<WorkflowPacket>> {
  if (packet.status !== 'succeeded' || packet.artifacts.length === 0) return { ok: true, value: packet };

  let workspaceRealPath: string;
  try {
    workspaceRealPath = await realpath(options.workspace);
  } catch {
    return { ok: false, code: 'ARTIFACT_WORKSPACE_INVALID', message: '节点产物工作区不存在或不可访问' };
  }

  const canonical: WorkflowArtifactRef[] = [];
  const seenResourceIds = new Set<string>();
  for (let index = 0; index < packet.artifacts.length; index += 1) {
    const draft = packet.artifacts[index] as unknown as WorkflowArtifactDraft;
    const rawResourceId = typeof draft.resourceId === 'string' ? draft.resourceId.trim() : '';
    if (!rawResourceId || rawResourceId.includes('\0') || path.isAbsolute(rawResourceId)
      || /^[A-Za-z]:[\\/]/.test(rawResourceId) || /^[a-z][a-z\d+.-]*:\/\//i.test(rawResourceId)) {
      return { ok: false, code: 'ARTIFACT_RESOURCE_INVALID', message: `artifacts[${index}].resourceId 必须是节点工作区内的相对文件路径` };
    }
    const targetPath = path.resolve(workspaceRealPath, rawResourceId);
    const relative = path.relative(workspaceRealPath, targetPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return { ok: false, code: 'ARTIFACT_RESOURCE_INVALID', message: `artifacts[${index}].resourceId 不能指向节点工作区之外` };
    }

    let targetRealPath: string;
    let info;
    try {
      targetRealPath = await realpath(targetPath);
      const realRelative = path.relative(workspaceRealPath, targetRealPath);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        return { ok: false, code: 'ARTIFACT_RESOURCE_INVALID', message: `artifacts[${index}].resourceId 通过符号链接逃逸节点工作区` };
      }
      info = await stat(targetRealPath);
    } catch {
      return { ok: false, code: 'ARTIFACT_FILE_MISSING', message: `artifacts[${index}] 声明的文件不存在或不可访问: ${rawResourceId}` };
    }
    if (!info.isFile() || info.size <= 0) {
      return { ok: false, code: 'ARTIFACT_FILE_INVALID', message: `artifacts[${index}] 必须指向非空普通文件: ${rawResourceId}` };
    }

    const resourceId = relative.split(path.sep).join('/');
    if (seenResourceIds.has(resourceId)) continue;
    seenResourceIds.add(resourceId);
    const idHash = createHash('sha1').update(`${options.runId}:${options.nodeId}:${resourceId}`).digest('hex').slice(0, 16);
    const artifactId = `${options.runId}:${options.nodeId}:${idHash}`;
    const name = typeof draft.name === 'string' && draft.name.trim() ? draft.name.trim() : path.basename(resourceId);
    const contentType = typeof draft.contentType === 'string' && draft.contentType.trim()
      ? draft.contentType.trim()
      : contentTypeForPath(resourceId);
    canonical.push({
      artifactId,
      kind: draft.kind ?? options.defaultKind ?? 'INTERMEDIATE',
      name,
      contentType,
      resourceId,
      uri: `artifact://${options.runId}/${options.nodeId}/${artifactId}`,
      size: info.size,
    });
  }

  return { ok: true, value: { ...packet, artifacts: canonical } };
}

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html', '.htm': 'text/html', '.md': 'text/markdown', '.txt': 'text/plain',
    '.json': 'application/json', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
    '.pdf': 'application/pdf', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

export function promoteCarriedOutputArtifacts(packet: WorkflowPacket): WorkflowPacket {
  const payload = packet.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return packet;
  const { [WORKFLOW_PACKET_ARTIFACTS_KEY]: carried, ...cleanPayload } = payload as Record<string, unknown>;
  const upstreamArtifacts = Array.isArray(carried)
    ? (carried as UpstreamWorkflowArtifact[]).map((entry) => entry?.artifact).filter((artifact) => artifact?.kind === 'OUTPUT')
    : [];
  const artifacts = [...packet.artifacts];
  for (const artifact of upstreamArtifacts) {
    if (!artifacts.some((entry) => entry.artifactId === artifact.artifactId)) artifacts.push(artifact);
  }
  return { ...packet, payload: cleanPayload, artifacts };
}
