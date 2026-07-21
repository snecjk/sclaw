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

export type WorkflowPacketValidation =
  | { ok: true; packet: WorkflowPacket; outcome: 'succeeded' | 'failed' }
  | { ok: false; code: string; message: string };

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

/** The first diagnostic is the user-facing failure reason for a failed node. */
export function getWorkflowPacketFailureMessage(packet: WorkflowPacket): string | undefined {
  if (packet.status !== 'failed') return undefined;
  return packet.diagnostics.errors[0]?.message;
}

export function isRetryableWorkflowPacketFailure(packet: WorkflowPacket): boolean {
  return packet.status === 'failed' && packet.diagnostics.errors[0]?.retryable === true;
}

export function isWorkflowPacket(value: unknown): value is WorkflowPacket {
  return Boolean(value && typeof value === 'object' && (value as any).protocolVersion === WORKFLOW_PACKET_VERSION);
}

export function validateWorkflowPacket(value: unknown, opts: {
  runId: string; nodeId: string; nodeType: string; allowedPorts?: string[]; requireSelectedPort?: boolean;
}): WorkflowPacketValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 必须是对象' };
  const packet = value as Record<string, any>;
  if ([...ROOT_KEYS].some((key) => !(key in packet))) return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 缺少协议字段' };
  if (Object.keys(packet).some((key) => !ROOT_KEYS.has(key))) return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 包含未声明字段' };
  if (packet.protocolVersion !== WORKFLOW_PACKET_VERSION) return { ok: false, code: 'RESULT_PACKET_VERSION_INVALID', message: 'node-result.json 协议版本无效' };
  if (packet.status !== 'succeeded' && packet.status !== 'failed') return { ok: false, code: 'RESULT_PACKET_STATUS_INVALID', message: 'AI 节点 status 必须为 succeeded 或 failed' };
  if (!packet.producer || packet.producer.runId !== opts.runId || packet.producer.nodeId !== opts.nodeId || packet.producer.nodeType !== opts.nodeType) {
    return { ok: false, code: 'RESULT_PACKET_PRODUCER_INVALID', message: 'node-result.json 来源与当前节点不匹配' };
  }
  if (!Array.isArray(packet.artifacts) || !packet.control || !packet.diagnostics || !Array.isArray(packet.diagnostics.warnings) || !Array.isArray(packet.diagnostics.errors)) {
    return { ok: false, code: 'RESULT_PACKET_INVALID', message: 'node-result.json 缺少 artifacts、control 或 diagnostics' };
  }
  for (const [index, diagnostic] of packet.diagnostics.errors.entries()) {
    if (!diagnostic || typeof diagnostic !== 'object'
      || typeof diagnostic.code !== 'string' || !diagnostic.code
      || typeof diagnostic.category !== 'string' || !diagnostic.category
      || typeof diagnostic.message !== 'string' || !diagnostic.message
      || typeof diagnostic.retryable !== 'boolean'
      || ('attemptsUsed' in diagnostic && (!Number.isInteger(diagnostic.attemptsUsed) || diagnostic.attemptsUsed < 1))) {
      return { ok: false, code: 'RESULT_DIAGNOSTIC_INVALID', message: `diagnostics.errors[${index}] 缺少合法的 code、category、message 或 retryable` };
    }
  }
  for (const artifact of packet.artifacts) {
    if (!artifact || typeof artifact !== 'object' || !artifact.artifactId || !artifact.kind || !artifact.name || !artifact.contentType) {
      return { ok: false, code: 'ARTIFACT_INVALID', message: '产物引用缺少必要元数据' };
    }
    if ('checksum' in artifact) return { ok: false, code: 'ARTIFACT_INVALID', message: 'WorkflowPacket v1 不支持 checksum' };
  }
  const typedPacket = packet as WorkflowPacket;
  if (typedPacket.status === 'failed') {
    if (typedPacket.diagnostics.errors.length === 0) return { ok: false, code: 'RESULT_FAILURE_DIAGNOSTIC_MISSING', message: '失败包必须包含至少一条 diagnostics.errors' };
    if (typedPacket.control.selectedPort !== null) return { ok: false, code: 'RESULT_FAILURE_ROUTE_INVALID', message: '失败包的 selectedPort 必须为 null' };
    return { ok: true, packet: typedPacket, outcome: 'failed' };
  }
  if (typedPacket.diagnostics.errors.length > 0) return { ok: false, code: 'RESULT_SUCCESS_DIAGNOSTIC_INVALID', message: '成功包的 diagnostics.errors 必须为空' };
  const port = typedPacket.control.selectedPort;
  if (opts.requireSelectedPort && (!port || typeof port !== 'string')) return { ok: false, code: 'RESULT_ROUTE_MISSING', message: '条件节点缺少 selectedPort' };
  if (port && (!opts.allowedPorts || !opts.allowedPorts.includes(port))) return { ok: false, code: 'RESULT_ROUTE_INVALID', message: `selectedPort 未声明: ${port}` };
  return { ok: true, packet: typedPacket, outcome: 'succeeded' };
}

export function packetPayload(value: unknown): unknown {
  return isWorkflowPacket(value) ? value.payload : value;
}

/** SDK-native JSON schema. This is passed to Claude Agent SDK outputFormat, not parsed from prose. */
export function workflowPacketJsonSchema(payloadSchema: any, opts: { runId: string; nodeId: string; nodeType: string; allowedPorts?: string[]; requireSelectedPort?: boolean }): Record<string, unknown> {
  // Both terminal outcomes share the same root shape. A failed condition node
  // must be allowed to return null here; route requirements are enforced by
  // the successful-packet validator below.
  const selectedPort = { type: ['string', 'null'] };
  return {
    type: 'object', additionalProperties: false,
    required: ['protocolVersion', 'status', 'producer', 'payload', 'artifacts', 'control', 'diagnostics'],
    properties: {
      protocolVersion: { const: WORKFLOW_PACKET_VERSION }, status: { enum: ['succeeded', 'failed'] },
      producer: { type: 'object', additionalProperties: false, required: ['runId', 'nodeId', 'nodeType', 'attempt'], properties: {
        runId: { const: opts.runId }, nodeId: { const: opts.nodeId }, nodeType: { const: opts.nodeType }, attempt: { type: 'integer', minimum: 1 },
      } },
      // A failed packet may retain a small diagnostic context that does not
      // satisfy the successful business payload schema. The success branch
      // below applies that schema only to successful results.
      payload: {},
      artifacts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['artifactId', 'kind', 'name', 'contentType'], properties: {
        artifactId: { type: 'string' }, kind: { enum: ['INPUT', 'OUTPUT', 'INTERMEDIATE'] }, name: { type: 'string' }, contentType: { type: 'string' }, uri: { type: 'string' }, resourceId: { type: ['string', 'null'] }, size: { type: 'integer', minimum: 0 },
      } } },
      control: { type: 'object', additionalProperties: false, required: ['selectedPort'], properties: { selectedPort } },
      diagnostics: { type: 'object', additionalProperties: false, required: ['warnings', 'errors'], properties: { warnings: { type: 'array', items: { type: 'string' } }, errors: { type: 'array', items: diagnosticJsonSchema() } } },
    },
    anyOf: [
      { properties: { status: { const: 'succeeded' }, payload: payloadSchema ?? { type: 'object' }, diagnostics: { properties: { errors: { maxItems: 0 } } } } },
      { properties: { status: { const: 'failed' }, control: { properties: { selectedPort: { const: null } } }, diagnostics: { properties: { errors: { minItems: 1 } } } } },
    ],
  };
}

function diagnosticJsonSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false,
    required: ['code', 'category', 'message', 'retryable'],
    properties: {
      code: { type: 'string', minLength: 1 }, category: { type: 'string', minLength: 1 },
      message: { type: 'string', minLength: 1 }, retryable: { type: 'boolean' }, attemptsUsed: { type: 'integer', minimum: 1 },
    },
  };
}
