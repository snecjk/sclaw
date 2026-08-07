import { createHash } from 'node:crypto';

/** Fixed UUID namespace for workflow node Agent sessions (RFC 4122 UUID v5). */
const WORKFLOW_NODE_SESSION_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/**
 * A deterministic, valid UUID shared by both execution engines.  The same
 * workflow run/node pair therefore resumes the same agent context after an
 * automatic retry or an interrupted-run recovery, while every other node is
 * isolated by construction.
 */
export function deriveWorkflowNodeSessionId(runId: string, nodeId: string): string {
  const name = `workflow-node-session:${runId}:${nodeId}`;
  const bytes = createHash('sha1')
    .update(uuidToBytes(WORKFLOW_NODE_SESSION_NAMESPACE))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function workflowGatewaySessionKey(nodeSessionId: string): string {
  return `agent:workflow-runtime:workflow:${nodeSessionId}`;
}
