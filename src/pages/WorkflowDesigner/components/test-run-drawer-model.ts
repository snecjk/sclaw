import type {
  WorkflowExecutionState,
  WorkflowRunArtifact,
  WorkflowRunResponse,
} from '@/types/workflow';
import type { WorkflowExecutionEngine } from '@/lib/workflow-session';

export type TrialRunView = 'running' | 'completed' | 'failed' | 'cancelled';
export type TrialRunTimelineTone = 'default' | 'running' | 'success' | 'danger' | 'tool' | 'artifact';
export type TrialRunTimelineItem = {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
  tone: TrialRunTimelineTone;
};
export type TrialRunDisplayArtifact = WorkflowRunArtifact & { source: 'final' | 'process' };
export type TrialRunLaunchConfirmation = {
  inputs: Record<string, unknown>;
  engineType: WorkflowExecutionEngine;
};

export function resolveTrialRunView(input: {
  isStarting: boolean;
  isRunActive?: boolean;
  status: string | null | undefined;
  launchError: string | null;
}): TrialRunView {
  if (input.launchError || ['failed', 'timeout', 'interrupted'].includes(input.status ?? '')) return 'failed';
  // A resume request starts while the persisted snapshot is still cancelled.
  // Prefer the in-flight state so the footer cannot offer a second "continue".
  if (input.isStarting || input.isRunActive) return 'running';
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'completed') return 'completed';
  return 'running';
}

export function shouldShowStartupRunDialog(input: {
  isStartupDialogOpen: boolean;
  isDrawerOpen: boolean;
}) {
  return input.isStartupDialogOpen && !input.isDrawerOpen;
}

export function resolveTrialRunLaunchConfirmation(
  run: WorkflowRunResponse | null,
  cached: TrialRunLaunchConfirmation | null,
): TrialRunLaunchConfirmation {
  if (cached) return cached;
  return {
    inputs: run?.input?.inputs
      ?? run?.startup?.resolvedInputs
      ?? run?.startup?.overrides
      ?? {},
    engineType: run?.engineType ?? 'claude',
  };
}

export function formatTrialRunVersion(value?: string | number | null) {
  if (value == null || String(value).trim() === '') return '-';
  const version = String(value).trim();
  return /^v/i.test(version) ? version : `v${version}`;
}

export function formatTrialRunTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function eventDetail(event: Record<string, unknown>, type: string) {
  const payload = event.payload;
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const data = payload as Record<string, unknown>;
  if (type === 'node.started' || type === 'node.completed') {
    if (typeof data.nodeName === 'string') return data.nodeName;
  }
  if (type === 'agent.tool_start' || type === 'agent.tool_end') {
    const toolName = data.toolName ?? data.toolId;
    if (typeof toolName === 'string') return toolName;
  }
  if (typeof data.message === 'string') return data.message;
  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}

const AGENT_OUTPUT_DELTA_TYPES = new Set([
  'agent.answer_delta',
  'agent.output.delta',
]);

function isAgentOutputDelta(type: string) {
  return AGENT_OUTPUT_DELTA_TYPES.has(type);
}

function eventNodeId(event: Record<string, unknown>) {
  return typeof event.nodeId === 'string' ? event.nodeId : undefined;
}

function agentDeltaDetail(
  event: Record<string, unknown>,
  type: string,
  previousRawText: string | undefined,
) {
  const payload = event.payload;
  if (payload && typeof payload === 'object') {
    const rawText = (payload as Record<string, unknown>).rawText;
    if (typeof rawText === 'string' && rawText.length > 0) {
      return {
        text: previousRawText && rawText.startsWith(previousRawText)
          ? rawText.slice(previousRawText.length)
          : rawText,
        rawText,
        replacesSegment: Boolean(previousRawText && !rawText.startsWith(previousRawText)),
      };
    }
  }
  const text = eventDetail(event, type);
  return {
    text,
    rawText: mergeAgentDeltaText(previousRawText, text),
    replacesSegment: false,
  };
}

function mergeAgentDeltaText(previous: string | undefined, next: string | undefined) {
  if (!next) return previous;
  if (previous && next.startsWith(previous)) return next;
  return `${previous ?? ''}${next}`;
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    'agent.started': 'Agent 开始执行',
    'agent.progress': 'Agent 进度',
    'agent.completed': 'Agent 执行完成',
    'agent.failed': 'Agent 执行失败',
    'node.started': '节点启动',
    'node.completed': '节点完成',
    'node.failed': '节点失败',
    'agent.tool_start': '请求工具',
    'agent.tool_end': '工具完成',
    'agent.answer_delta': '实时输出',
    'agent.output.delta': '实时输出',
    'agent.attempt.succeeded': 'Agent 执行完成',
    'agent.attempt.failed': 'Agent 执行失败',
    'workflow.started': '流程运行已创建',
    'workflow.completed': '流程运行完成',
  };
  return labels[type] ?? type;
}

function toneForEvent(type: string): TrialRunTimelineTone {
  if (type.includes('failed')) return 'danger';
  if (type.includes('completed') || type.includes('approved') || type.includes('submitted')) return 'success';
  if (type.includes('tool')) return 'tool';
  if (type.includes('artifact')) return 'artifact';
  if (type.includes('output') || type.includes('progress') || type.includes('started')) return 'running';
  return 'default';
}

export function buildTrialRunTimeline(
  run: WorkflowRunResponse | null,
  executionState: WorkflowExecutionState | null,
): TrialRunTimelineItem[] {
  const sourceEvents = (run?.events ?? [])
    .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object'));
  const lastRawTextByNode = new Map<string | undefined, string>();
  const events = sourceEvents.reduce<TrialRunTimelineItem[]>((items, event, index) => {
      const type = typeof event.type === 'string' ? event.type : 'event';
      const nodeId = eventNodeId(event);
      if (type === 'agent.attempt.start') lastRawTextByNode.delete(nodeId);
      const delta = isAgentOutputDelta(type)
        ? agentDeltaDetail(event, type, lastRawTextByNode.get(nodeId))
        : null;
      if (delta?.rawText) lastRawTextByNode.set(nodeId, delta.rawText);
      const detail = delta?.text ?? eventDetail(event, type);
      const previous = items.at(-1);
      const previousEvent = sourceEvents[index - 1];
      const previousType = previousEvent && typeof previousEvent.type === 'string'
        ? previousEvent.type
        : '';
      const sameNode = previousEvent !== undefined
        && eventNodeId(previousEvent) === eventNodeId(event);

      if (delta && previous && isAgentOutputDelta(previousType) && sameNode) {
        previous.detail = delta.replacesSegment
          ? delta.text
          : delta.text && previous.detail && delta.text.startsWith(previous.detail)
            ? delta.text
            : mergeAgentDeltaText(previous.detail, delta.text);
        previous.timestamp = typeof event.timestamp === 'string'
          ? event.timestamp
          : previous.timestamp;
        return items;
      }
      items.push({
        id: String(event.id ?? `event-${index}`),
        label: eventLabel(type),
        detail,
        timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
        tone: toneForEvent(type),
      });
      return items;
    }, []);
  if (!events.some((event) => event.label === '实时输出') && run?.lastAgentRawText) {
    events.push({
      id: 'agent-final-output',
      label: '实时输出',
      detail: run.lastAgentRawText,
      timestamp: run.completedAt ?? run.startedAt,
      tone: 'running',
    });
  }
  if (events.length > 0) return events;
  return (executionState?.steps ?? []).map((step, index) => ({
    id: `step-${index}`,
    label: step.name,
    detail: step.error,
    tone: step.status === 'failed'
      ? 'danger'
      : step.status === 'completed'
        ? 'success'
        : step.status === 'running'
          ? 'running'
          : 'default',
  }));
}

function normalizeResultArtifact(
  artifact: NonNullable<NonNullable<WorkflowRunResponse['result']>['artifacts']>[number],
  index: number,
  source: 'final' | 'process',
): TrialRunDisplayArtifact {
  const filePath = artifact.filePath?.trim();
  const url = artifact.previewUrl?.trim() || artifact.url?.trim() || filePath || '';
  return {
    id: artifact.id ?? (artifact as { artifactId?: string }).artifactId ?? `${source}-${index}-${artifact.name ?? filePath ?? url}`,
    name: artifact.name ?? filePath?.split(/[\\/]/).pop() ?? url.split('/').pop() ?? 'artifact',
    kind: artifact.kind,
    type: artifact.contentType ?? artifact.type ?? artifact.kind ?? 'file',
    url,
    previewUrl: artifact.previewUrl,
    tempUrl: artifact.tempUrl,
    filePath,
    contentType: artifact.contentType,
    size: artifact.size,
    source,
  };
}

export function collectTrialRunArtifacts(
  run: WorkflowRunResponse | null,
  executionState: WorkflowExecutionState | null,
): TrialRunDisplayArtifact[] {
  const items: TrialRunDisplayArtifact[] = [];
  for (const artifact of run?.artifacts ?? []) {
    const kind = artifact.kind?.toUpperCase();
    items.push({ ...artifact, source: kind && kind !== 'OUTPUT' ? 'process' : 'final' });
  }
  run?.result?.artifacts?.forEach((artifact, index) => {
    items.push(normalizeResultArtifact(artifact, index, 'final'));
  });
  run?.result?.processFiles?.forEach((artifact, index) => {
    items.push(normalizeResultArtifact(artifact, index, 'process'));
  });
  for (const artifact of executionState?.result?.artifacts ?? []) {
    items.push({ ...artifact, source: 'final' });
  }
  const byFile = new Map<string, TrialRunDisplayArtifact>();
  for (const artifact of items) {
    const key = artifact.name.trim().toLowerCase()
      || artifact.filePath?.trim().toLowerCase()
      || artifact.previewUrl?.trim().toLowerCase()
      || artifact.url.trim().toLowerCase()
      || artifact.id;
    if (!key) continue;
    const existing = byFile.get(key);
    if (!existing || (existing.source === 'process' && artifact.source === 'final')) {
      byFile.set(key, artifact);
    }
  }
  return [...byFile.values()];
}

export function getTrialRunArtifactTarget(artifact: TrialRunDisplayArtifact) {
  return artifact.previewUrl?.trim()
    || artifact.tempUrl?.trim()
    || artifact.url?.trim()
    || artifact.filePath?.trim()
    || '';
}
