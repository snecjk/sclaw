import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Package, Plus, Search, Server, ShieldCheck, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  createMyExternalService,
  getVisibleExternalServiceVersion,
  getMyExternalServiceDraft,
  pageExternalServices,
  pageMyExternalServices,
  publishMyExternalService,
  saveMyExternalServiceDraft,
  setMyExternalServiceVisibility,
} from '@/lib/external-service-api';
import { cn } from '@/lib/utils';
import type {
  ExternalServiceAuthType,
  ExternalServiceDraftInput,
  ExternalServiceSummary,
  ExternalServiceVersionConfig,
} from '../../../shared/external-service-contract';

const EMPTY_DRAFT: ExternalServiceDraftInput = {
  name: '',
  description: '',
  owner: '',
  environments: { daily: '', stage: '', online: '' },
  auth: { type: 'stoToken' },
  integration: {},
};

const ENVIRONMENTS = [
  { key: 'daily', label: '测试环境地址', badge: '测试', tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  { key: 'stage', label: '预发环境地址', badge: '预发', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  { key: 'online', label: '生产环境地址', badge: '生产', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
] as const;

function fieldClass() {
  return 'mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:ring-2 focus:ring-ring/20 disabled:bg-muted/50 disabled:text-muted-foreground';
}

function FormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Server;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-background p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function ExternalServiceManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ExternalServiceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [marketDetail, setMarketDetail] = useState<ExternalServiceVersionConfig | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'mine' | 'market'>('mine');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<ExternalServiceDraftInput>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await (view === 'mine'
        ? pageMyExternalServices({ pageSize: 100 })
        : pageExternalServices({ pageSize: 100 }));
      setItems(page.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '外部服务列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => (
      item.name.toLowerCase().includes(normalized)
      || item.serviceId.toLowerCase().includes(normalized)
    ));
  }, [items, query]);

  if (!open) return null;

  const edit = async (serviceUid: string) => {
    setLoadingDraft(true);
    try {
      const value = await getMyExternalServiceDraft(serviceUid);
      setEditingId(value.serviceUid);
      setServiceId(value.serviceId);
      setVisibility(value.visibility);
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
      setLoadingDraft(false);
    }
  };

  const createNew = () => {
    setEditingId('');
    setServiceId('');
    setVisibility('PRIVATE');
    setIsNew(true);
    setDraft(EMPTY_DRAFT);
  };

  const switchView = (nextView: 'mine' | 'market') => {
    if (nextView === view) return;
    setView(nextView);
    setEditingId(null);
    setMarketDetail(null);
    setIsNew(false);
    setPublishConfirm(false);
  };

  const inspectMarketService = async (item: ExternalServiceSummary) => {
    if (!item.latestVersion) {
      toast.error('该服务尚未发布可查看的版本');
      return;
    }
    setLoadingDraft(true);
    try {
      setMarketDetail(await getVisibleExternalServiceVersion(item.serviceUid, item.latestVersion));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '外部服务详情加载失败');
    } finally {
      setLoadingDraft(false);
    }
  };

  const save = async () => {
    const normalizedServiceId = serviceId.trim();
    if (!normalizedServiceId || !draft.name.trim() || !draft.owner.trim()
      || Object.values(draft.environments).some((value) => !value.trim())) {
      throw new Error('请填写外部服务编码、名称、维护团队和三个环境地址');
    }
    const creating = isNew;
    const saved = creating
      ? await createMyExternalService(normalizedServiceId, draft)
      : await saveMyExternalServiceDraft(editingId!, draft);
    setEditingId(saved.serviceUid);
    setServiceId(saved.serviceId);
    if (!creating || visibility !== 'PRIVATE') {
      await setMyExternalServiceVisibility(saved.serviceUid, visibility);
    }
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
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px] sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-service-manager-title"
        className="flex h-[88vh] w-[90vw] flex-col overflow-hidden rounded-[20px] border border-border/70 bg-background shadow-2xl"
      >
        <header className="flex min-h-[76px] items-center gap-4 border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="external-service-manager-title" className="text-lg font-semibold text-foreground">外部服务管理</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">统一维护服务地址、身份认证与应用集成说明</p>
            </div>
            </div>
            <div className="flex items-center rounded-lg bg-muted p-1 text-xs">
              <button type="button" onClick={() => switchView('mine')} className={cn('rounded-md px-3 py-1.5 transition-colors', view === 'mine' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>我的服务</button>
              <button type="button" onClick={() => switchView('market')} className={cn('rounded-md px-3 py-1.5 transition-colors', view === 'market' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>服务广场</button>
            </div>
          <div className="flex-1" />
          {view === 'mine' ? <Button type="button" size="sm" onClick={createNew}>
            <Plus className="mr-1.5 h-4 w-4" />新建服务
          </Button> : null}
          <button
            type="button"
            aria-label="关闭外部服务管理"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-muted/20">
            <div className="border-b border-border p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索服务名称或外部服务编码"
                  className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{view === 'mine' ? '我创建的服务' : '当前可见服务'}</span><span>{visibleItems.length} / {items.length}</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading && items.length === 0 ? (
                <div className="space-y-2" aria-label="正在加载服务列表">
                  {[0, 1, 2].map((item) => <div key={item} className="h-[82px] animate-pulse rounded-xl bg-muted" />)}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center px-4 text-center">
                  <Search className="mb-2 h-5 w-5 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">{query ? '没有匹配的服务' : '暂无外部服务'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleItems.map((item) => {
                    const selected = editingId === item.serviceUid;
                    return (
                      <article
                        key={item.serviceUid}
                        className={cn(
                          'group rounded-xl border p-3 transition-all',
                          selected
                            ? 'border-violet-500/40 bg-violet-500/[0.07] shadow-sm'
                            : 'border-transparent bg-background hover:border-border hover:shadow-sm',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                            selected ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' : 'bg-muted text-muted-foreground',
                          )}>
                            <Server className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{item.serviceId}</p>
                            <div className="mt-2 flex items-center gap-1.5">
                              <span className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                item.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                              )}>{item.status === 'ACTIVE' ? '已启用' : '已停用'}</span>
                              <span className="text-[10px] text-muted-foreground">{item.latestVersion ? `v${item.latestVersion}` : '未发布'}</span>
                            </div>
                          </div>
                          {view === 'mine' ? (
                            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void edit(item.serviceUid)}>编辑</Button>
                          ) : (
                            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!item.latestVersion} onClick={() => void inspectMarketService(item)}>查看详情</Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <main className="relative flex min-h-0 flex-col bg-muted/10">
            {loadingDraft ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载服务配置…</div>
              </div>
            ) : null}

            {view === 'market' ? (
              marketDetail ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                  <div className="mx-auto max-w-[840px] space-y-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">{marketDetail.name}</h3>
                        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{marketDetail.serviceId}</span>
                        <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">v{marketDetail.version}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{marketDetail.description || '暂无服务说明'}</p>
                    </div>
                    <FormSection icon={FileText} title="服务信息" description="服务广场中的配置为只读不可变版本。">
                      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                        <div><dt className="text-xs text-muted-foreground">维护方</dt><dd className="mt-1">{marketDetail.owner}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">认证方式</dt><dd className="mt-1">{marketDetail.auth.type === 'stoToken' ? 'StoToken' : '无需认证'}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">服务范围</dt><dd className="mt-1">{marketDetail.scopeType === 'PLATFORM' ? '平台公共服务' : marketDetail.visibility === 'PUBLIC' ? '公司内公开' : '仅自己可见'}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">SDK</dt><dd className="mt-1 font-mono text-xs">{marketDetail.integration?.npmPackage ? `${marketDetail.integration.npmPackage}@${marketDetail.integration.packageVersion}` : '未提供'}</dd></div>
                      </dl>
                    </FormSection>
                    <FormSection icon={ShieldCheck} title="环境地址" description="应用安装后将按部署环境自动选择对应地址。">
                      <div className="space-y-3">
                        {ENVIRONMENTS.map((environment) => <div key={environment.key}>
                          <span className="text-xs text-muted-foreground">{environment.label}</span>
                          <p className="mt-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{marketDetail.environments[environment.key]}</p>
                        </div>)}
                      </div>
                    </FormSection>
                    <FormSection icon={Package} title="AI 对接说明" description="安装到应用前可先核对接口约束和调用方式。">
                      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-xs leading-5 text-foreground">{marketDetail.integration?.usageGuide || '该服务暂未提供 usageGuide。'}</pre>
                    </FormSection>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Server className="h-6 w-6" /></div>
                  <h3 className="text-sm font-medium text-foreground">选择一个服务查看详情</h3>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">可查看服务的固定版本、环境地址、认证方式、SDK 与 AI 对接说明。</p>
                </div>
              )
            ) : editingId === null ? (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Server className="h-6 w-6" /></div>
                <h3 className="text-sm font-medium text-foreground">选择一个服务开始编辑</h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">从左侧选择已有服务，或创建一个新的外部服务配置。</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" onClick={createNew}><Plus className="mr-1.5 h-4 w-4" />新建服务</Button>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                  <div className="mx-auto max-w-[840px] space-y-4">
                    <div className="mb-5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">{isNew ? '新建外部服务' : draft.name}</h3>
                        {!isNew && serviceId ? <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{serviceId}</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">修改内容会先保存为草稿，发布后才对应用可见。</p>
                    </div>

                    <FormSection icon={FileText} title="基本信息" description="用于识别服务及明确维护责任。">
                      <div className="grid grid-cols-2 gap-4">
                        <label className="text-xs font-medium text-foreground">外部服务编码
                          <input aria-label="外部服务编码" disabled={!isNew} value={serviceId} onChange={(event) => setServiceId(event.target.value)} className={fieldClass()} placeholder="lowercase-kebab-case" />
                        </label>
                        <label className="text-xs font-medium text-foreground">服务名称
                          <input aria-label="名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={fieldClass()} placeholder="例如：策略本体服务" />
                        </label>
                        <label className="text-xs font-medium text-foreground">维护团队
                          <input aria-label="维护团队" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} className={fieldClass()} placeholder="例如：policy-platform" />
                        </label>
                        <label className="text-xs font-medium text-foreground">认证方式
                          <select aria-label="认证方式" value={draft.auth.type} onChange={(event) => setDraft({ ...draft, auth: { type: event.target.value as ExternalServiceAuthType } })} className={fieldClass()}>
                            <option value="stoToken">StoToken（推荐）</option><option value="none">无需认证</option>
                          </select>
                        </label>
                        <label className="text-xs font-medium text-foreground">可见范围
                          <select aria-label="可见范围" value={visibility} onChange={(event) => setVisibility(event.target.value as 'PRIVATE' | 'PUBLIC')} className={fieldClass()}>
                            <option value="PRIVATE">仅自己可见</option><option value="PUBLIC">公司内公开</option>
                          </select>
                        </label>
                        <label className="col-span-2 text-xs font-medium text-foreground">服务描述
                          <textarea aria-label="描述" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={`${fieldClass()} min-h-20 resize-y py-2.5`} placeholder="简要说明服务能力和使用场景" />
                        </label>
                      </div>
                    </FormSection>

                    <FormSection icon={ShieldCheck} title="环境与认证" description="为测试、预发和生产环境分别配置基础地址。">
                      <div className="space-y-4">
                        {ENVIRONMENTS.map((environment) => (
                          <label key={environment.key} className="block text-xs font-medium text-foreground">
                            <span className="flex items-center gap-2">
                              {environment.label}
                              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', environment.tone)}>{environment.badge}</span>
                            </span>
                            <input
                              aria-label={environment.label}
                              value={draft.environments[environment.key]}
                              onChange={(event) => updateEnvironment(environment.key, event.target.value)}
                              className={`${fieldClass()} font-mono text-xs`}
                              placeholder="https://service.example.sto.cn/api"
                            />
                          </label>
                        ))}
                      </div>
                    </FormSection>

                    <FormSection icon={Package} title="应用集成" description="可选。帮助应用和 AI 正确安装并调用服务 SDK。">
                      <div className="grid grid-cols-2 gap-4">
                        <label className="text-xs font-medium text-foreground">npm 包
                          <input aria-label="npm 包" value={draft.integration?.npmPackage ?? ''} onChange={(event) => setDraft({ ...draft, integration: { ...draft.integration, npmPackage: event.target.value } })} className={fieldClass()} placeholder="@sto/example-sdk" />
                        </label>
                        <label className="text-xs font-medium text-foreground">包版本
                          <input aria-label="包版本" value={draft.integration?.packageVersion ?? ''} onChange={(event) => setDraft({ ...draft, integration: { ...draft.integration, packageVersion: event.target.value } })} className={fieldClass()} placeholder="1.0.0" />
                        </label>
                        <label className="col-span-2 text-xs font-medium text-foreground">AI 对接说明
                          <textarea aria-label="AI 对接说明" value={draft.integration?.usageGuide ?? ''} onChange={(event) => setDraft({ ...draft, integration: { ...draft.integration, usageGuide: event.target.value } })} className={`${fieldClass()} min-h-[250px] resize-y py-2.5 leading-5`} placeholder="说明安装方式、主要接口和调用示例" />
                        </label>
                      </div>
                    </FormSection>
                  </div>
                </div>

                <footer className="flex min-h-16 items-center justify-between gap-4 border-t border-border bg-background px-6 py-3">
                  <p className="text-xs text-muted-foreground">外部服务编码、名称、维护团队和三个环境地址需完整填写</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" disabled={saving} onClick={() => {
                      setSaving(true);
                      void save().then(() => toast.success('草稿已保存')).catch((error) => toast.error(error instanceof Error ? error.message : '保存失败')).finally(() => setSaving(false));
                    }}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}保存草稿</Button>
                    <Button type="button" disabled={saving} onClick={() => setPublishConfirm(true)}>发布新版本</Button>
                  </div>
                </footer>
              </>
            )}
          </main>
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
          const result = await publishMyExternalService(saved.serviceUid);
          toast.success(`已发布 v${result.version}`);
          setPublishConfirm(false);
          await load();
        }}
      />
    </div>,
    document.body,
  );
}
