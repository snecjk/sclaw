import { useState } from 'react';
import { Loader2, Pencil, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FREQ_OPTIONS, NODE_KIND_ICON_CLASS, NOTIFY_CHANNEL_OPTIONS, TIME_OPTIONS } from '@/pages/Workflow/constants';
import type { NodeRunState, WorkflowField, WorkflowNodeData } from '@/pages/Workflow/types';

interface WorkflowNodeCardProps {
  node: WorkflowNodeData;
  runState: NodeRunState;
  flash?: boolean;
  onDelete: () => void;
  onRename: (title: string) => void;
  onFieldChange: (key: string, patch: Partial<WorkflowField>) => void;
  onMultiToggle: (key: string, option: string) => void;
  onOpenNodeLib: (e: React.MouseEvent) => void;
  onOpenSkillPicker: (e: React.MouseEvent) => void;
  onDataSourceAction: (mode: 'local' | 'sys' | 'online', e: React.MouseEvent) => void;
  onTryRun?: () => void;
  tryRunBusy?: boolean;
  tryRunMessage?: { type: 'ok' | 'fail'; text: string; onView?: () => void } | null;
}

export function WorkflowNodeCard({
  node,
  runState,
  flash,
  onDelete,
  onRename,
  onFieldChange,
  onMultiToggle,
  onOpenNodeLib,
  onOpenSkillPicker,
  onDataSourceAction,
  onTryRun,
  tryRunBusy,
  tryRunMessage,
}: WorkflowNodeCardProps) {
  const { t } = useTranslation('workflow');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node.title);

  const saveRename = () => {
    const v = renameDraft.trim() || node.title;
    onRename(v);
    setRenaming(false);
  };

  return (
    <div
      className={cn(
        'group absolute w-[380px] rounded-[18px] border border-border bg-card shadow-elevated transition-all duration-base',
        flash && 'animate-pulse ring-4 ring-primary/20',
        runState === 'running' && 'border-primary shadow-soft ring-[3px] ring-primary/15',
      )}
      style={{ left: node.x, top: node.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {runState ? <RunBadge state={runState} /> : null}

      <button
        type="button"
        aria-label={t('node.delete')}
        onClick={onDelete}
        className="absolute right-2 top-2 z-[3] flex h-[23px] w-[23px] items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground opacity-0 transition-opacity duration-fast hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>

      <div className="flex items-center gap-3.5 px-[18px] pb-2 pt-[18px]">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] text-[17px] font-semibold',
            NODE_KIND_ICON_CLASS[node.kind],
            node.kind === 'end' && 'text-[11px]',
          )}
        >
          {node.icon}
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename();
              }}
              className="h-8 text-[15px] font-semibold"
              autoFocus
            />
          ) : (
            <h4 className="flex items-center gap-1.5 text-[16.5px] font-semibold text-foreground">
              <span className="truncate">{node.title}</span>
              <button
                type="button"
                aria-label={t('node.rename')}
                onClick={() => {
                  setRenameDraft(node.title);
                  setRenaming(true);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </button>
            </h4>
          )}
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-foreground/80">
            {node.ai ? (
              <span className="rounded-sm bg-primary/10 px-1.5 py-px text-[10px] text-primary">AI</span>
            ) : null}
            {node.label}
          </span>
        </div>
      </div>

      <p className="px-[18px] pb-4 text-[12.5px] leading-relaxed text-muted-foreground">{node.description}</p>

      {node.fields.map((field) => (
        <FieldBlock
          key={field.key}
          field={field}
          onChange={(patch) => onFieldChange(field.key, patch)}
          onMultiToggle={(opt) => onMultiToggle(field.key, opt)}
          onDataSourceAction={onDataSourceAction}
        />
      ))}

      {node.summary && node.summary.length > 0 ? (
        <div className="mx-[18px] mb-[18px] flex flex-col gap-2.5 border-t border-border pt-3.5">
          {node.summary.map((row) => (
            <div key={row.key} className="flex gap-2.5 text-[12.5px]">
              <span className="shrink-0 font-semibold text-muted-foreground">{row.key}</span>
              {row.pick ? (
                <button
                  type="button"
                  onClick={onOpenSkillPicker}
                  className={cn(
                    'inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary',
                    !row.value && 'font-medium text-muted-foreground',
                  )}
                >
                  {row.value || t('node.noSkill')}
                  <span aria-hidden>›</span>
                </button>
              ) : (
                <span className="font-semibold leading-relaxed text-foreground">
                  {row.value}
                  {row.ai ? (
                    <span className="ml-1.5 rounded-sm bg-primary/10 px-1.5 py-px text-[10.5px] font-semibold text-primary">
                      {t('node.aiTag')}
                    </span>
                  ) : null}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {node.tryRun ? (
        <div className="flex flex-col gap-2.5 px-[18px] pb-4">
          <Button
            type="button"
            variant="outline"
            disabled={tryRunBusy}
            onClick={onTryRun}
            className={cn(
              'w-full border-primary/30 text-primary hover:bg-primary/[0.06]',
              tryRunBusy && 'cursor-not-allowed border-border text-muted-foreground',
            )}
          >
            {tryRunBusy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                {t('node.running')}
              </>
            ) : (
              t('node.tryRun')
            )}
          </Button>
          {tryRunMessage?.type === 'ok' ? (
            <div className="flex items-center gap-2 rounded-[9px] bg-success/10 px-[11px] py-2 text-xs font-semibold text-success">
              <span className="flex-1">{tryRunMessage.text}</span>
              {tryRunMessage.onView ? (
                <button type="button" onClick={tryRunMessage.onView} className="shrink-0 underline underline-offset-2">
                  {t('node.viewResult')}
                </button>
              ) : null}
            </div>
          ) : null}
          {tryRunMessage?.type === 'fail' ? (
            <div className="rounded-[9px] bg-destructive/10 px-[11px] py-2 text-xs font-semibold text-destructive">
              {tryRunMessage.text}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="absolute -left-2 top-1/2 h-[15px] w-[15px] -translate-y-1/2 rounded-full border-[1.5px] border-[#DDE0E5] bg-card" />
      <button
        type="button"
        aria-label={t('node.addPort')}
        onClick={onOpenNodeLib}
        className="absolute -right-[11px] top-1/2 flex h-[22px] w-[22px] -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-[#DDE0E5] bg-card text-[11px] text-muted-foreground transition-colors duration-fast hover:border-primary hover:bg-primary/[0.06] hover:text-primary"
      >
        <Plus className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

function RunBadge({ state }: { state: NodeRunState }) {
  const { t } = useTranslation('workflow');
  const label =
    state === 'running'
      ? t('node.runBadgeRunning')
      : state === 'done'
        ? t('node.runBadgeDone')
        : state === 'fail'
          ? t('node.runBadgeFail')
          : t('node.runBadgeSkip');

  return (
    <div
      className={cn(
        'absolute -top-[11px] left-1/2 z-[3] flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[10.5px] font-semibold',
        state === 'running' && 'border-border bg-card text-foreground/80',
        state === 'done' && 'border-success/30 bg-success/10 text-success',
        state === 'fail' && 'border-destructive/30 bg-destructive/10 text-destructive',
        state === 'skip' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {state === 'running' ? <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" aria-hidden /> : null}
      {label}
    </div>
  );
}

function FieldBlock({
  field,
  onChange,
  onMultiToggle,
  onDataSourceAction,
}: {
  field: WorkflowField;
  onChange: (patch: Partial<WorkflowField>) => void;
  onMultiToggle: (opt: string) => void;
  onDataSourceAction: (mode: 'local' | 'sys' | 'online', e: React.MouseEvent) => void;
}) {
  const { t } = useTranslation('workflow');

  if (field.type === 'dsgroup') {
    const ds = field.dataSource ?? {};
    const rows = [
      { mode: 'local' as const, title: t('node.localImport'), desc: t('node.localDesc'), action: t('node.upload'), tags: ds.localFiles ?? [] },
      { mode: 'sys' as const, title: t('node.sysSource'), desc: t('node.sysDesc'), action: t('node.add'), tags: ds.sys ?? [] },
      { mode: 'online' as const, title: t('node.onlineSource'), desc: t('node.onlineDesc'), action: t('node.add'), tags: ds.online ?? [] },
    ];
    return (
      <div className="px-[18px] pb-4">
        <div className="mb-2 text-xs font-semibold text-foreground/80">{t('node.datasourceLabel')}</div>
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <button
              key={row.mode}
              type="button"
              onClick={(e) => onDataSourceAction(row.mode, e)}
              className={cn(
                'rounded-[10px] border border-border p-3 text-left transition-colors duration-fast hover:border-primary/30',
                row.tags.length > 0 && 'border-primary/30 bg-primary/[0.02]',
              )}
            >
              <div className="flex items-center gap-2">
                <b className="text-[13px] font-semibold text-foreground">{row.title}</b>
                <span className="ml-auto text-[11.5px] font-semibold text-primary">{row.action}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{row.desc}</p>
              {row.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-[18px] pb-4">
      <div className="mb-2 text-xs font-semibold text-foreground/80">{field.label}</div>
      {field.type === 'textarea' ? (
        <Textarea
          value={field.value ?? ''}
          onChange={(e) => onChange({ value: e.target.value })}
          rows={3}
          className="text-[13px]"
        />
      ) : field.type === 'multi' ? (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? [...NOTIFY_CHANNEL_OPTIONS]).map((opt) => {
            const selected = (field.value ?? '').split(',').map((s) => s.trim()).includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onMultiToggle(opt)}
                className={cn(
                  'rounded-md border border-transparent px-2.5 py-1.5 text-[11.5px] text-foreground/80 transition-colors duration-fast hover:bg-muted',
                  selected && 'border-primary/30 bg-primary/10 font-semibold text-primary',
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : field.type === 'freqtime' ? (
        <div className="flex gap-2">
          <select
            value={field.freq ?? '每天'}
            onChange={(e) => onChange({ freq: e.target.value })}
            className="min-w-[100px] rounded-md border border-border bg-card px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FREQ_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={field.value ?? '09:00'}
            onChange={(e) => onChange({ value: e.target.value })}
            className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {TIME_OPTIONS.map((tm) => (
              <option key={tm} value={tm}>
                {tm}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <Input value={field.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} className="text-[13px]" />
      )}
    </div>
  );
}
