/**
 * artifact-uploader — 全部产物 async 上 OSS（spec §整体数据流 step 7 + G8/Q8）。
 *
 * - 复用 uploadOssFile（electron/utils/oss-temp-upload.ts:120, bizTypeEnum='workflow'）。
 * - 节点产出 → 编排器写本地文件 + wf_artifact（先记本地 file_path）+ 立即推进下一节点
 *   （下游 agent 经 additionalDirectories 读本地文件，与 OSS 无关）。
 * - 上传在后台：成功 → 回填 resource_id + outbox 同步（payload 无字节，含 resource_id）；
 *   失败 → 退避重试若干次，仍失败则 resource_id 留空、file_path 保持本地路径（不影响执行正确性，
 *   只影响 admin 能否查看该产物）。
 *
 * 注意：下游 agent 读的是本地文件（非 OSS URL），OSS 上传纯为服务端镜像/admin 查看。
 */
import path from 'node:path';
import type { WorkflowRuntimeRepository } from '../../db/repositories/workflow-runtime-repository';
import { uploadOssFile as defaultUpload } from '../../utils/oss-temp-upload';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface UploadDeps {
  repo: WorkflowRuntimeRepository;
  uploadOssFile?: typeof defaultUpload;
  maxAttempts?: number;
  backoffBaseMs?: number;  // 退避基数，测试可注入小值
}

export interface ArtifactRow {
  artifact_id: string;
  run_id: string;
  node_id?: string;
  kind: string; // INPUT/OUTPUT/INTERMEDIATE
  file_path: string;
  content_type?: string;
  summary?: string;
  created_at: string;
}

export async function uploadArtifact(
  deps: UploadDeps,
  art: ArtifactRow,
): Promise<void> {
  const upload = deps.uploadOssFile ?? defaultUpload;
  const max = deps.maxAttempts ?? 5;
  const baseMs = deps.backoffBaseMs ?? 2000;
  await deps.repo.upsertArtifact({ ...art, resource_id: undefined, uri: art.file_path });
  await deps.repo.enqueueOutbox(art.run_id, 'artifact', art.artifact_id, { ...art, uri: art.file_path }, 'progress');
  let resourceId: string | undefined;
  let tempUrl: string | undefined;
  for (let a = 1; a <= max; a++) {
    try {
      const r = await upload(art.file_path, path.basename(art.file_path), { bizTypeEnum: 'workflow' as any });
      resourceId = r.resourceId;
      tempUrl = r.tempUrl;
      break;
    } catch {
      if (a === max) break; // 耗尽：resource_id 留空，file_path 保持本地
      await sleep(Math.min(60_000, baseMs * 2 ** (a - 1)));
    }
  }
  // 失败时 resource_id 留空、file_path 保持本地路径
  const row = { ...art, resource_id: resourceId, uri: resourceId ?? tempUrl ?? art.file_path };
  await deps.repo.upsertArtifact(row);
  // outbox 同步（payload 无字节，含 resource_id 或 file_path）
  await deps.repo.enqueueOutbox(art.run_id, 'artifact', art.artifact_id, row, 'progress');
}
