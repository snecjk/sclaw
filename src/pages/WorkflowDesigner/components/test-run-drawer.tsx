/**
 * Client-native trial-run drawer.
 *
 * The information architecture mirrors the web canvas drawer. Its data comes
 * exclusively from the local workflow runtime through useDesignerTryRun.
 */
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  FileDown,
  Loader2,
  Play,
  RefreshCw,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { WorkflowExecutionState, WorkflowRunArtifact, WorkflowRunResponse } from '@/types/workflow';
import { invokeIpc } from '@/lib/api-client';
import { isHttpUrl, openExternalUrl } from '@/lib/preview-url';

interface TestRunDrawerProps {
  open: boolean;
  runId: string | null;
  run: WorkflowRunResponse | null;
  executionState: WorkflowExecutionState | null;
  workflowVersionId?: string | number;
  isStarting: boolean;
  isCancelling: boolean;
  isRunActive: boolean;
  isDraftSnapshot: boolean;
  launchError: string | null;
  onClose: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onRerun: () => void;
  onDecideApproval: (approved: boolean, note?: string) => void;
  onSubmitInput: (values: Record<string, unknown>) => void;
}

type View = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type TimelineTone = 'default' | 'running' | 'success' | 'danger' | 'tool' | 'artifact';
type TimelineItem = { id: string; label: string; detail?: string; timestamp?: string; tone: TimelineTone };
type DisplayArtifact = WorkflowRunArtifact & { source: 'final' | 'process' };

const STATUS_LABEL: Record<string, string> = {
  pending: '准备中', running: '运行中', waiting_approval: '待审批', waiting_input: '待填写',
  completed: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时',
};

function formatTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function eventDetail(event: Record<string, unknown>, type: string) {
  const payload = event.payload;
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>;
    if (type === 'node.started' || type === 'node.completed') {
      const nodeName = data.nodeName;
      if (typeof nodeName === 'string') return nodeName;
    }
    if (type === 'agent.tool_start' || type === 'agent.tool_end') {
      const toolName = data.toolName ?? data.toolId;
      if (typeof toolName === 'string') return toolName;
    }
    const message = data.message;
    if (typeof message === 'string') return message;
    try { return JSON.stringify(payload); } catch { return undefined; }
  }
  return typeof event.nodeId === 'string' ? event.nodeId : undefined;
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    'agent.started': 'Agent 开始执行', 'agent.progress': 'Agent 进度', 'agent.completed': 'Agent 执行完成',
    'agent.failed': 'Agent 执行失败', 'node.started': '节点启动', 'node.completed': '节点完成',
    'node.failed': '节点失败', 'agent.tool_start': '请求工具', 'agent.tool_end': '工具完成',
    'agent.answer_delta': '实时输出', 'agent.attempt.start': 'Agent 开始执行',
    'agent.attempt.succeeded': 'Agent 执行完成', 'agent.attempt.failed': 'Agent 执行失败',
    'workflow.started': '流程运行已创建', 'workflow.completed': '流程运行完成',
  };
  return labels[type] ?? type.replace(/[._]/g, ' ');
}

function toneForEvent(type: string): TimelineTone {
  if (type.includes('tool')) return 'tool';
  if (type.includes('failed')) return 'danger';
  if (type.includes('completed') || type.includes('approved') || type.includes('submitted')) return 'success';
  if (type.includes('output') || type.includes('artifact')) return 'artifact';
  if (type.includes('started') || type.includes('progress')) return 'running';
  return 'default';
}

function buildTimeline(run: WorkflowRunResponse | null, executionState: WorkflowExecutionState | null): TimelineItem[] {
  const events = (run?.events ?? [])
    .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object'))
    .reduce<TimelineItem[]>((items, event, index) => {
      const type = String(event.type ?? '运行事件');
      const detail = eventDetail(event, type);
      // SDK text deltas are emitted frequently. Keep the full output while
      // presenting consecutive chunks as a single management-console-like row.
      const previous = items.at(-1);
      if (type === 'agent.answer_delta' && previous?.label === '实时输出') {
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
    events.push({ id: 'agent-final-output', label: '实时输出', detail: run.lastAgentRawText, timestamp: run.completedAt ?? run.startedAt, tone: 'running' });
  }
  if (events.length > 0) return events;
  return (executionState?.steps ?? []).map((step, index) => ({
    id: `step-${index}`, label: step.name, detail: step.error,
    tone: step.status === 'failed' ? 'danger' : step.status === 'completed' ? 'success' : step.status === 'running' ? 'running' : 'default',
  }));
}

function TimelineIcon({ tone }: { tone: TimelineTone }) {
  const className = 'h-3.5 w-3.5';
  if (tone === 'success') return <CheckCircle2 className={className} />;
  if (tone === 'danger') return <XCircle className={className} />;
  if (tone === 'tool') return <Wrench className={className} />;
  if (tone === 'artifact') return <FileDown className={className} />;
  if (tone === 'running') return <Play className={className} />;
  return <Circle className={className} />;
}

function ExecutionTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <section className="overflow-hidden rounded-lg bg-[#111a2a] text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-700/70 px-5 py-4">
        <strong className="text-base">执行过程</strong>
        <span className="text-sm text-slate-400">{items.length} 步</span>
      </div>
      <div className="max-h-[44vh] overflow-y-auto px-5 py-4">
        {items.length === 0 ? <p className="text-sm text-slate-400">暂无执行事件</p> : (
          <ol className="space-y-4">
            {items.map((item, index) => (
              <li className="flex gap-3" key={item.id}>
                <div className="relative flex w-6 shrink-0 justify-center">
                  <span className={`z-10 flex h-6 w-6 items-center justify-center rounded-full border ${
                    item.tone === 'danger' ? 'border-red-400 text-red-300' : item.tone === 'success' ? 'border-emerald-400 text-emerald-300' : 'border-orange-400 text-orange-300'
                  }`}><TimelineIcon tone={item.tone} /></span>
                  {index < items.length - 1 ? <span className="absolute top-6 h-[calc(100%+10px)] w-px bg-slate-700" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm">{item.label}</strong>
                    {item.timestamp ? <time className="shrink-0 text-xs text-slate-400">{formatTime(item.timestamp)}</time> : null}
                  </div>
                  {item.detail ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-400">{item.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function normalizeResultArtifact(
  artifact: NonNullable<NonNullable<WorkflowRunResponse['result']>['artifacts']>[number],
  index: number,
  source: 'final' | 'process',
): DisplayArtifact {
  const filePath = artifact.filePath?.trim();
  const url = artifact.previewUrl?.trim() || artifact.url?.trim() || filePath || '';
  return {
    // WorkflowPacket v1 uses artifactId while historical API payloads use id.
    // Preserve that identity so the same file from run.artifacts and result
    // does not appear twice in the drawer.
    id: artifact.id ?? (artifact as any).artifactId ?? `${source}-${index}-${artifact.name ?? filePath ?? url}`,
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

function collectDisplayArtifacts(
  run: WorkflowRunResponse | null,
  executionState: WorkflowExecutionState | null,
): DisplayArtifact[] {
  const items: DisplayArtifact[] = [];
  for (const artifact of run?.artifacts ?? []) {
    const kind = artifact.kind?.toUpperCase();
    items.push({
      ...artifact,
      source: kind && kind !== 'OUTPUT' ? 'process' : 'final',
    });
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

function getArtifactTarget(artifact: DisplayArtifact): string {
  return artifact.previewUrl?.trim()
    || artifact.tempUrl?.trim()
    || artifact.url?.trim()
    || artifact.filePath?.trim()
    || '';
}

function openArtifact(artifact: DisplayArtifact): void {
  const target = getArtifactTarget(artifact);
  if (!target) return;
  if (isHttpUrl(target)) {
    openExternalUrl(target);
    return;
  }
  const localPath = artifact.filePath?.trim()
    || (target.startsWith('file://') ? decodeURIComponent(target.replace(/^file:\/\/\/?/, '')) : target);
  if (localPath) void invokeIpc('shell:openPath', localPath);
}

function ArtifactSection({ title, description, artifacts }: { title: string; description: string; artifacts: DisplayArtifact[] }) {
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-xs text-muted-foreground">{artifacts.length} 个</span>
      </div>
      {artifacts.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-background px-4 py-6 text-sm text-muted-foreground">暂无{title}</div>
      ) : (
        <ul className="space-y-2">
          {artifacts.map((artifact) => {
            const target = getArtifactTarget(artifact);
            return (
              <li key={`${artifact.source}:${artifact.id}`} className="flex items-center gap-3 rounded-md border border-border bg-background px-4 py-3">
                <FileDown className="h-4 w-4 shrink-0 text-orange-500" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-orange-600 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                  disabled={!target}
                  title={target || artifact.name}
                  onClick={() => openArtifact(artifact)}
                >
                  {artifact.name}
                </button>
                <span className={`rounded-full px-2 py-0.5 text-xs ${artifact.source === 'final' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {artifact.source === 'final' ? '最终产物' : '过程产物'}
                </span>
                <span className="max-w-[140px] truncate text-xs text-muted-foreground">{artifact.contentType ?? artifact.type}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ArtifactList({ artifacts }: { artifacts: DisplayArtifact[] }) {
  if (artifacts.length === 0) {
    return <div className="py-12 text-center"><p className="font-medium text-foreground">未找到可预览产物</p><p className="mt-2 text-sm text-muted-foreground">运行已完成，但没有可用于查看的输出产物。</p></div>;
  }
  const finalArtifacts = artifacts.filter((artifact) => artifact.source === 'final');
  const processArtifacts = artifacts.filter((artifact) => artifact.source === 'process');
  return (
    <div className="space-y-5">
      <ArtifactSection title="最终产物" description="面向用户交付或下游消费的结果文件。" artifacts={finalArtifacts} />
      <ArtifactSection title="过程产物" description="节点执行过程中产生的中间文件、调试文件或过程数据。" artifacts={processArtifacts} />
    </div>
  );
}

export function TestRunDrawer(props: TestRunDrawerProps) {
  const [inputJson, setInputJson] = useState('{}');
  const [decisionNote, setDecisionNote] = useState('');
  const [tab, setTab] = useState<'artifact' | 'process'>('artifact');
  const status = props.executionState?.status ?? (props.isStarting ? 'pending' : 'pending');
  const view: View = props.launchError || status === 'failed' || status === 'timeout' ? 'failed' : status === 'cancelled' ? 'cancelled' : status === 'completed' ? 'completed' : props.isStarting || props.isRunActive || status === 'waiting_approval' || status === 'waiting_input' ? 'running' : 'pending';
  const timeline = useMemo(() => buildTimeline(props.run, props.executionState), [props.run, props.executionState]);
  const artifacts = useMemo(() => collectDisplayArtifacts(props.run, props.executionState), [props.run, props.executionState]);
  const activeRunId = props.run?.id ?? props.runId;
  const startedAt = props.run?.startedAt ?? props.executionState?.startedAt;
  const eventCount = props.run?.events.length ?? timeline.length;
  const activeVersionId = props.run?.versionId ?? props.workflowVersionId;

  return (
    <Sheet open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-l border-border p-0 sm:max-w-[min(800px,100vw)]">
        <header className="flex min-h-[88px] items-center justify-between border-b border-border bg-background px-6">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-orange-400 shadow-[0_0_0_6px_rgba(251,146,60,0.14)]" />
            <h2 className="text-xl font-semibold">{view === 'completed' ? '试运行结果' : '试运行'}</h2>
            {props.workflowVersionId != null ? <span className="text-sm text-muted-foreground">版本ID: {props.workflowVersionId}</span> : null}
            {props.isDraftSnapshot ? <span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">当前 V2 草稿试运行</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {view === 'running' ? <Button variant="outline" className="border-orange-200 text-orange-700 hover:bg-orange-50" onClick={props.onCancel} disabled={props.isCancelling}>{props.isCancelling ? '取消中' : '取消运行'}</Button> : null}
            {view === 'cancelled' ? <Button variant="outline" onClick={props.onContinue}><Play className="mr-2 h-4 w-4" />继续运行</Button> : null}
            {view === 'completed' || view === 'failed' ? <Button variant="outline" onClick={props.onRerun}><RefreshCw className="mr-2 h-4 w-4" />重新运行</Button> : null}
            <button type="button" aria-label="关闭" onClick={props.onClose} className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {view === 'running' || view === 'pending' ? (
            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-background p-5 shadow-sm">
                <div className="flex items-center gap-4">
                  <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                  <div><p className="text-sm font-semibold text-orange-600">当前运行</p><h3 className="text-xl font-semibold">{status === 'waiting_approval' ? '等待人工审批' : status === 'waiting_input' ? '等待补充输入' : props.isStarting && !activeRunId ? '正在创建运行' : '正在运行中'}</h3><p className="mt-1 text-sm text-muted-foreground">{activeRunId ?? '等待运行创建'}</p></div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-sm text-slate-500">状态</dt><dd className="mt-1 font-semibold">{STATUS_LABEL[status] ?? '准备中'}</dd></div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-sm text-slate-500">当前版本号</dt><dd className="mt-1 font-semibold">{activeVersionId == null ? '-' : `v${activeVersionId}`}</dd></div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-sm text-slate-500">开始时间</dt><dd className="mt-1 font-semibold">{formatTime(startedAt)}</dd></div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-sm text-slate-500">事件</dt><dd className="mt-1 font-semibold">{eventCount}</dd></div>
                </dl>
              </section>

              {status === 'waiting_approval' ? <section className="rounded-lg border border-orange-200 bg-orange-50 p-4"><p className="font-semibold">人工审批</p><Textarea className="mt-3 bg-background" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="审批备注（可选）" rows={2} /><div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => props.onDecideApproval(false, decisionNote)}>拒绝</Button><Button onClick={() => props.onDecideApproval(true, decisionNote)}>通过</Button></div></section> : null}
              {status === 'waiting_input' ? <section className="rounded-lg border border-orange-200 bg-orange-50 p-4"><p className="font-semibold">补充输入</p><Textarea className="mt-3 bg-background font-mono text-xs" value={inputJson} onChange={(event) => setInputJson(event.target.value)} rows={5} /><div className="mt-3 flex justify-end"><Button onClick={() => { try { props.onSubmitInput(JSON.parse(inputJson)); } catch { /* Retain the entered JSON for correction. */ } }}>提交</Button></div></section> : null}
              <ExecutionTimeline items={timeline} />
            </div>
          ) : null}

          {view === 'completed' ? <div className="space-y-5"><section className="rounded-xl border border-slate-200 bg-background p-5"><p className="text-sm font-semibold text-orange-600">当前运行</p><strong className="mt-1 block text-lg">{activeRunId ?? '本次试运行'}</strong><dl className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-sm text-slate-500">状态</dt><dd className="mt-1 font-semibold text-emerald-700">已完成</dd></div><div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-sm text-slate-500">开始时间</dt><dd className="mt-1 font-semibold">{formatTime(startedAt)}</dd></div></dl></section><div className="flex gap-6 border-b border-slate-200"><button type="button" onClick={() => setTab('artifact')} className={`border-b-2 px-1 py-3 text-sm font-medium ${tab === 'artifact' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500'}`}>产物</button><button type="button" onClick={() => setTab('process')} className={`border-b-2 px-1 py-3 text-sm font-medium ${tab === 'process' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500'}`}>执行过程</button></div>{tab === 'artifact' ? <ArtifactList artifacts={artifacts} /> : <ExecutionTimeline items={timeline} />}</div> : null}

          {view === 'failed' ? <section className="rounded-xl border border-red-200 bg-background p-6"><div className="flex items-center gap-3 text-red-600"><AlertCircle className="h-6 w-6" /><h3 className="text-lg font-semibold">运行失败</h3></div><p className="mt-4 break-words text-sm text-muted-foreground">{props.launchError ?? props.executionState?.error ?? props.run?.error ?? '试运行失败，请稍后重试。'}</p>{timeline.length > 0 ? <div className="mt-5"><ExecutionTimeline items={timeline} /></div> : null}</section> : null}
          {view === 'cancelled' ? <section className="rounded-xl border border-slate-200 bg-background p-6"><div className="flex items-center gap-3"><XCircle className="h-6 w-6 text-slate-500" /><h3 className="text-lg font-semibold">已取消</h3></div><p className="mt-3 text-sm text-muted-foreground">本次试运行已取消。</p></section> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
