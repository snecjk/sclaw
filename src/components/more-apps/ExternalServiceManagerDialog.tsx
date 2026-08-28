import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  getExternalServiceDraft,
  pageExternalServicesAdmin,
  publishExternalService,
  saveExternalServiceDraft,
} from '@/lib/external-service-api';
import type {
  ExternalServiceAuthType,
  ExternalServiceDraftInput,
  ExternalServiceSummary,
} from '../../../shared/external-service-contract';

const EMPTY_DRAFT: ExternalServiceDraftInput = {
  name: '',
  description: '',
  owner: '',
  environments: { daily: '', stage: '', online: '' },
  auth: { type: 'stoToken' },
  integration: {},
};

function fieldClass() {
  return 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';
}

export function ExternalServiceManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ExternalServiceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<ExternalServiceDraftInput>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await pageExternalServicesAdmin({ pageSize: 100 })).items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '外部服务列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  if (!open) return null;

  const edit = async (serviceId: string) => {
    setLoading(true);
    try {
      const value = await getExternalServiceDraft(serviceId);
      setEditingId(value.serviceId);
      setIsNew(false);
      setDraft({
        name: value.name,
        description: value.description,
        owner: value.owner,
        environments: value.environments,
        auth: value.auth,
        integration: value.integration ?? {},
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '外部服务草稿加载失败');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const serviceId = editingId?.trim() ?? '';
    if (!serviceId || !draft.name.trim() || !draft.owner.trim()
      || Object.values(draft.environments).some((value) => !value.trim())) {
      throw new Error('请填写 serviceId、名称、维护团队和三个环境地址');
    }
    const saved = await saveExternalServiceDraft(serviceId, draft);
    setEditingId(saved.serviceId);
    setIsNew(false);
    await load();
    return saved;
  };

  const updateEnvironment = (env: 'daily' | 'stage' | 'online', value: string) => {
    setDraft((current) => ({
      ...current,
      environments: { ...current.environments, [env]: value },
    }));
  };

  return createPortal(
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/45 p-6">
      <section className="flex h-[min(780px,92vh)] w-[min(1040px,95vw)] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">外部服务管理</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">维护各环境服务地址和认证方式，发布后应用才能选择绑定。</p>
          </div>
          <div className="flex-1" />
          <Button type="button" size="sm" variant="outline" onClick={() => {
            setEditingId('');
            setIsNew(true);
            setDraft(EMPTY_DRAFT);
          }}><Plus className="mr-1 h-4 w-4" />新建服务</Button>
          <button type="button" aria-label="关闭外部服务管理" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
          <div className="overflow-y-auto border-r border-border p-4">
            {loading && items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">加载中…</p> : null}
            <div className="space-y-2">
              {items.map((item) => (
                <article key={item.serviceId} className="rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{item.serviceId} · {item.latestVersion ? `v${item.latestVersion}` : '未发布'}</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => void edit(item.serviceId)}>编辑</Button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto p-5">
            {editingId === null ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个服务进行编辑，或新建服务。</div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs text-muted-foreground">serviceId
                  <input aria-label="serviceId" disabled={!isNew} value={editingId} onChange={(e) => setEditingId(e.target.value)} className={fieldClass()} placeholder="lowercase-kebab-case" />
                </label>
                <label className="text-xs text-muted-foreground">名称
                  <input aria-label="名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={fieldClass()} />
                </label>
                <label className="text-xs text-muted-foreground">维护团队
                  <input aria-label="维护团队" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} className={fieldClass()} />
                </label>
                <label className="text-xs text-muted-foreground">认证方式
                  <select aria-label="认证方式" value={draft.auth.type} onChange={(e) => setDraft({ ...draft, auth: { type: e.target.value as ExternalServiceAuthType } })} className={fieldClass()}>
                    <option value="stoToken">stoToken</option><option value="none">none</option>
                  </select>
                </label>
                {(['daily', 'stage', 'online'] as const).map((env) => (
                  <label key={env} className="col-span-2 text-xs text-muted-foreground">{env === 'daily' ? 'Daily' : env === 'stage' ? 'Stage' : 'Online'} 地址
                    <input aria-label={`${env === 'daily' ? 'Daily' : env === 'stage' ? 'Stage' : 'Online'} 地址`} value={draft.environments[env]} onChange={(e) => updateEnvironment(env, e.target.value)} className={fieldClass()} />
                  </label>
                ))}
                <label className="col-span-2 text-xs text-muted-foreground">描述
                  <textarea aria-label="描述" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${fieldClass()} min-h-20`} />
                </label>
                <label className="text-xs text-muted-foreground">npm 包
                  <input aria-label="npm 包" value={draft.integration?.npmPackage ?? ''} onChange={(e) => setDraft({ ...draft, integration: { ...draft.integration, npmPackage: e.target.value } })} className={fieldClass()} />
                </label>
                <label className="text-xs text-muted-foreground">包版本
                  <input aria-label="包版本" value={draft.integration?.packageVersion ?? ''} onChange={(e) => setDraft({ ...draft, integration: { ...draft.integration, packageVersion: e.target.value } })} className={fieldClass()} />
                </label>
                <label className="col-span-2 text-xs text-muted-foreground">AI 对接说明
                  <textarea aria-label="AI 对接说明" value={draft.integration?.usageGuide ?? ''} onChange={(e) => setDraft({ ...draft, integration: { ...draft.integration, usageGuide: e.target.value } })} className={`${fieldClass()} min-h-24`} />
                </label>
                <div className="col-span-2 flex justify-end gap-2">
                  <Button type="button" variant="outline" disabled={saving} onClick={() => {
                    setSaving(true);
                    void save().then(() => toast.success('草稿已保存')).catch((error) => toast.error(error instanceof Error ? error.message : '保存失败')).finally(() => setSaving(false));
                  }}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}保存草稿</Button>
                  <Button type="button" onClick={() => setPublishConfirm(true)}>发布新版本</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={publishConfirm}
        title="确认发布外部服务"
        message="将保存当前草稿并生成一个不可变的新版本，应用仍需主动选择升级。"
        confirmLabel="确认发布"
        confirmingLabel="发布中…"
        cancelLabel="取消"
        overlayClassName="z-[270]"
        onCancel={() => setPublishConfirm(false)}
        onError={(error) => toast.error(error instanceof Error ? error.message : '发布失败')}
        onConfirm={async () => {
          const saved = await save();
          const result = await publishExternalService(saved.serviceId);
          toast.success(`已发布 v${result.version}`);
          setPublishConfirm(false);
          await load();
        }}
      />
    </div>,
    document.body,
  );
}
