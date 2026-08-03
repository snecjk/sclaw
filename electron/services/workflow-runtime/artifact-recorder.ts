/**
 * Persist workflow artifact metadata locally and enqueue it for run-state sync.
 *
 * Workflow artifacts remain in the client workspace.  This module deliberately
 * does not upload files or create OSS resource IDs; downstream nodes consume
 * the local file paths directly.
 */
import type { WorkflowRuntimeRepository } from '../../db/repositories/workflow-runtime-repository';

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

export async function recordArtifact(
  repo: WorkflowRuntimeRepository,
  art: ArtifactRow,
): Promise<void> {
  const row = { ...art, resource_id: undefined, uri: art.file_path };
  await repo.upsertArtifact(row);
  await repo.enqueueOutbox(art.run_id, 'artifact', art.artifact_id, row, 'progress');
}
