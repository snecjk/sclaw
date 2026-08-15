import type {
  WorkflowExecutionState,
  WorkflowRunArtifact,
  WorkflowRunResponse,
} from '@/types/workflow';

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

export function resolveTrialRunView(input: {
  isStarting: boolean;
  isRunActive?: boolean;
  status: string | null | undefined;
  launchError: string | null;
}): TrialRunView {
  if (input.launchError || ['failed', 'timeout', 'interrupted'].includes(input.status ?? '')) return 'failed';
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'completed') return 'completed';
  return 'running';
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
  const events = (run?.events ?? [])
    .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object'))
    .reduce<TrialRunTimelineItem[]>((items, event, index) => {
      const type = typeof event.type === 'string' ? event.type : 'event';
      const detail = eventDetail(event, type);
      const previous = items.at(-1);
      if (type === 'agent.output.delta' && previous?.label === '实时输出') {
        previous.detail = `${previous.detail ?? ''}${detail ?? ''}`;
        previous.timestamp = typeof event.timestamp === 'string' ? event.timestamp : previous.timestamp;
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
  const seen = new Set<string>();
  return items.filter((artifact) => {
    const key = artifact.id || artifact.filePath || artifact.previewUrl || artifact.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getTrialRunArtifactTarget(artifact: TrialRunDisplayArtifact) {
  return artifact.previewUrl?.trim()
    || artifact.tempUrl?.trim()
    || artifact.url?.trim()
    || artifact.filePath?.trim()
    || '';
}
