/** The only data contract that may cross a workflow node boundary. */
export const WORKFLOW_PACKET_VERSION = 'workflow-packet/v1' as const;

export type WorkflowPacketStatus = 'succeeded' | 'waiting' | 'failed' | 'skipped' | 'cancelled';

export interface WorkflowArtifactRef {
  artifactId: string;
  kind: 'INPUT' | 'OUTPUT' | 'INTERMEDIATE';
  name: string;
  contentType: string;
  uri?: string;
  resourceId?: string | null;
  size?: number;
}

export interface WorkflowPacket {
  protocolVersion: typeof WORKFLOW_PACKET_VERSION;
  status: WorkflowPacketStatus;
  producer: { runId: string; nodeId: string; nodeType: string; attempt: number };
  payload: unknown;
  artifacts: WorkflowArtifactRef[];
  control: { selectedPort: string | null };
  diagnostics: {
    warnings: string[];
    errors: Array<{ code: string; category: string; message: string; retryable: boolean; attemptsUsed?: number }>;
  };
}

const ROOT_KEYS = new Set(['protocolVersion', 'status', 'producer', 'payload', 'artifacts', 'control', 'diagnostics']);

export function createWorkflowPacket(input: {
  runId: string; nodeId: string; nodeType: string; attempt?: number; payload?: unknown;
  status?: WorkflowPacketStatus; artifacts?: WorkflowArtifactRef[]; selectedPort?: string | null;
  diagnostics?: WorkflowPacket['diagnostics'];
}): WorkflowPacket {
  return {
    protocolVersion: WORKFLOW_PACKET_VERSION,
    status: input.status ?? 'succeeded',
    producer: { runId: input.runId, nodeId: input.nodeId, nodeType: input.nodeType, attempt: input.attempt ?? 0 },
    payload: input.payload ?? null,
    artifacts: input.artifacts ?? [],
    control: { selectedPort: input.selectedPort ?? null },
    diagnostics: input.diagnostics ?? { warnings: [], errors: [] },
  };
}

export function createFailurePacket(input: {
  runId: string; nodeId: string; nodeType: string; attempt: number; code: string; category: string;
  message: string; retryable: boolean;
}): WorkflowPacket {
  return createWorkflowPacket({
    ...input,
    status: 'failed',
    diagnostics: { warnings: [], errors: [{ code: input.code, category: input.category, message: input.message, retryable: input.retryable, attemptsUsed: input.attempt }] },
  });
}

export function isWorkflowPacket(value: unknown): value is WorkflowPacket {
  return Boolean(value && typeof value === 'object' && (value as any).protocolVersion === WORKFLOW_PACKET_VERSION);
}

export function validateWorkflowPacket(value: unknown, opts: {
  runId: string; nodeId: string; nodeType: string; allowedPorts?: string[]; requireSelectedPort?: boolean;
}): { ok: true; packet: WorkflowPacket } | { ok: false; code: string; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 必须是对象' };
  const packet = value as Record<string, any>;
  if ([...ROOT_KEYS].some((key) => !(key in packet))) return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 缺少协议字段' };
  if (Object.keys(packet).some((key) => !ROOT_KEYS.has(key))) return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 包含未声明字段' };
  if (packet.protocolVersion !== WORKFLOW_PACKET_VERSION) return { ok: false, code: 'RESULT_PACKET_VERSION_INVALID', message: 'node-result.json 协议版本无效' };
  if (packet.status !== 'succeeded') return { ok: false, code: 'RESULT_PACKET_STATUS_INVALID', message: 'AI 节点成功时必须输出 succeeded 包' };
  if (!packet.producer || packet.producer.runId !== opts.runId || packet.producer.nodeId !== opts.nodeId || packet.producer.nodeType !== opts.nodeType) {
    return { ok: false, code: 'RESULT_PACKET_PRODUCER_INVALID', message: 'node-result.json 来源与当前节点不匹配' };
  }
  if (!Array.isArray(packet.artifacts) || !packet.control || !packet.diagnostics || !Array.isArray(packet.diagnostics.warnings) || !Array.isArray(packet.diagnostics.errors)) {
    return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 缺少 artifacts、control 或 diagnostics' };
  }
  for (const artifact of packet.artifacts) {
    if (!artifact || typeof artifact !== 'object' || !artifact.artifactId || !artifact.kind || !artifact.name || !artifact.contentType) {
      return { ok: false, code: 'ARTIFACT_INVALID', message: '产物引用缺少必要元数据' };
    }
    if ('checksum' in artifact) return { ok: false, code: 'ARTIFACT_INVALID', message: 'WorkflowPacket v1 不支持 checksum' };
  }
  const port = packet.control.selectedPort;
  if (opts.requireSelectedPort && (!port || typeof port !== 'string')) return { ok: false, code: 'RESULT_ROUTE_MISSING', message: '条件节点缺少 selectedPort' };
  if (port && (!opts.allowedPorts || !opts.allowedPorts.includes(port))) return { ok: false, code: 'RESULT_ROUTE_INVALID', message: `selectedPort 未声明: ${port}` };
  return { ok: true, packet: packet as WorkflowPacket };
}

export function packetPayload(value: unknown): unknown {
  return isWorkflowPacket(value) ? value.payload : value;
}

/** SDK-native JSON schema. This is passed to Claude Agent SDK outputFormat, not parsed from prose. */
export function workflowPacketJsonSchema(payloadSchema: any, opts: { runId: string; nodeId: string; nodeType: string; allowedPorts?: string[]; requireSelectedPort?: boolean }): Record<string, unknown> {
  const selectedPort = opts.requireSelectedPort
    ? { type: 'string', enum: opts.allowedPorts ?? [] }
    : { type: ['string', 'null'] };
  return {
    type: 'object', additionalProperties: false,
    required: ['protocolVersion', 'status', 'producer', 'payload', 'artifacts', 'control', 'diagnostics'],
    properties: {
      protocolVersion: { const: WORKFLOW_PACKET_VERSION }, status: { const: 'succeeded' },
      producer: { type: 'object', additionalProperties: false, required: ['runId', 'nodeId', 'nodeType', 'attempt'], properties: {
        runId: { const: opts.runId }, nodeId: { const: opts.nodeId }, nodeType: { const: opts.nodeType }, attempt: { type: 'integer', minimum: 1 },
      } },
      payload: payloadSchema ?? { type: 'object' },
      artifacts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['artifactId', 'kind', 'name', 'contentType'], properties: {
        artifactId: { type: 'string' }, kind: { enum: ['INPUT', 'OUTPUT', 'INTERMEDIATE'] }, name: { type: 'string' }, contentType: { type: 'string' }, uri: { type: 'string' }, resourceId: { type: ['string', 'null'] }, size: { type: 'integer', minimum: 0 },
      } } },
      control: { type: 'object', additionalProperties: false, required: ['selectedPort'], properties: { selectedPort } },
      diagnostics: { type: 'object', additionalProperties: false, required: ['warnings', 'errors'], properties: { warnings: { type: 'array', items: { type: 'string' } }, errors: { type: 'array', maxItems: 0 } } },
    },
  };
}
