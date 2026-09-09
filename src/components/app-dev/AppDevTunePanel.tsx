/**
 * 手动微调面板：选中元素（按类型）+ 全局 token + A2UI 组件库。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OklchColorField } from '@/components/app-dev/OklchColorField';
import {
  AppDevElementTuneForm,
  createElementTuneDraft,
} from '@/components/app-dev/AppDevElementTuneForm';
import { AppDevA2uiBindPanel } from '@/components/app-dev/AppDevA2uiBindPanel';
import { AppDevModuleGallery } from '@/components/app-dev/AppDevModuleGallery';
import {
  applyAppTheme,
  getAppDesignTokens,
  type AppDevDesignTokenDef,
} from '@/lib/app-dev-api';
import type { AppDevPickedElement } from '@/lib/app-dev-element-intent';
import {
  draftHasChanges,
  emptyElementTuneStyles,
  expandElementTunePaintStyles,
  persistAppDevElementTune,
  type AppDevElementTuneDraft,
} from '@/lib/app-dev-element-tune';
import {
  buildApplyTokenOverridesScript,
  buildClearTokenOverridesScript,
  buildReadTokensScript,
  buildApplyElementPatchScript,
} from '@/lib/app-dev-tune-scripts';
import { formatRem, parseRem } from '@/lib/app-dev-tune-tokens';

export type AppDevTuneExecuteJS = (code: string) => Promise<unknown>;

interface AppDevTunePanelProps {
  workspaceId: string;
  executeJS: AppDevTuneExecuteJS | null;
  pickedElements?: AppDevPickedElement[];
  onClose: () => void;
  onPersisted?: () => void;
}

export function AppDevTunePanel({
  workspaceId,
  executeJS,
  pickedElements = [],
  onClose,
  onPersisted,
}: AppDevTunePanelProps) {
  const [tab, setTab] = useState('element');
  const selected = pickedElements[0] ?? null;
  const isA2ui = Boolean(selected?.a2uiComponentId && selected?.a2uiPageId);

  useEffect(() => {
    if (pickedElements.length > 0) setTab('element');
  }, [pickedElements]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        <span className="text-xs font-medium text-foreground">手动微调</span>
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          返回对话
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 pt-2">
          <TabsList className="h-8 w-full" aria-label="微调范围">
            <TabsTrigger value="element" className="h-6 flex-1 px-2 text-xs">选中元素</TabsTrigger>
            <TabsTrigger value="theme" className="h-6 flex-1 px-2 text-xs">全局样式</TabsTrigger>
            <TabsTrigger value="library" className="h-6 flex-1 px-2 text-xs">组件库</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="element" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <ElementTuneSection
            workspaceId={workspaceId}
            executeJS={executeJS}
            selected={selected}
            extraCount={Math.max(0, pickedElements.length - 1)}
            isA2ui={isA2ui}
            onPersisted={onPersisted}
          />
        </TabsContent>
        <TabsContent value="theme" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <ThemeTuneSection workspaceId={workspaceId} executeJS={executeJS} />
        </TabsContent>
        <TabsContent value="library" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <AppDevModuleGallery
            workspaceId={workspaceId}
            selected={selected}
            onPersisted={onPersisted}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ElementTuneSection({
  workspaceId,
  executeJS,
  selected,
  extraCount,
  isA2ui,
  onPersisted,
}: {
  workspaceId: string;
  executeJS: AppDevTuneExecuteJS | null;
  selected: AppDevPickedElement | null;
  extraCount: number;
  isA2ui: boolean;
  onPersisted?: () => void;
}) {
  const [draft, setDraft] = useState<AppDevElementTuneDraft>({ styles: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selected ? createElementTuneDraft(selected) : { styles: {} });
    setHint(null);
    setError(null);
  }, [selected?.selector, selected?.a2uiComponentId]);

  const handleReset = useCallback(async () => {
    if (!selected) return;
    const next = createElementTuneDraft(selected);
    setDraft(next);
    setHint(null);
    if (!executeJS) return;
    try {
      await executeJS(buildApplyElementPatchScript(selected.selector, {
        text: selected.text,
        src: selected.src,
        alt: selected.alt,
        cascadeAlign: true,
        styles: emptyElementTuneStyles(),
      }));
    } catch {
      // ignore
    }
  }, [executeJS, selected]);

  const handleApply = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      if (!draftHasChanges(selected, draft)) {
        setHint('没有需要落盘的改动');
        return;
      }
      const result = await persistAppDevElementTune(workspaceId, selected, draft);
      if (executeJS) {
        await executeJS(buildApplyElementPatchScript(selected.selector, {
          text: draft.text,
          src: draft.src,
          alt: draft.alt,
          cascadeAlign: 'text-align' in draft.styles || 'justify-content' in draft.styles,
          styles: expandElementTunePaintStyles(draft.styles),
        }));
      }
      const parts = [
        result.cssPath ? `样式 ${result.cssPath}` : '',
        result.sourcePath ? `源码 ${result.sourcePath}` : '',
        ...result.notes,
      ].filter(Boolean);
      setHint(parts.join('；') || '已应用');
      if (result.sourcePath) onPersisted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, executeJS, onPersisted, selected, workspaceId]);

  if (!selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6">
          <p className="text-xs leading-relaxed text-muted-foreground" data-testid="app-dev-element-tune-empty">
            点击预览中的元素进行微调。文字、按钮、图片、容器和表格会显示不同的调整项。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {extraCount > 0 ? (
          <p className="mb-3 text-[11px] text-muted-foreground">
            已选 {extraCount + 1} 个，当前编辑第一个。批量说明请用对话修改。
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 text-xs text-[var(--sto-danger-primary,#FA3C3C)]">{error}</p>
        ) : null}
        <AppDevElementTuneForm
          element={selected}
          executeJS={executeJS}
          draft={draft}
          onDraftChange={setDraft}
        />
        {isA2ui ? (
          <div className="mt-5 border-t border-border pt-4">
            <AppDevA2uiBindPanel
              workspaceId={workspaceId}
              element={selected}
              onPersisted={onPersisted}
            />
          </div>
        ) : selected.a2uiComponentId ? (
          <p className="mt-4 text-[11px] text-muted-foreground">
            当前页不是完整 A2UI 资产，数据绑定请用对话修改或打开 A2UI 路由。
          </p>
        ) : (
          <p className="mt-4 text-[11px] text-muted-foreground">
            接口与字段映射只在 A2UI 组件上开放。当前是 JSX 节点，复杂数据改动请用对话修改。
          </p>
        )}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
        <div className="flex-1 truncate text-[11px] text-muted-foreground">{hint}</div>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => void handleReset()} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </Button>
        <Button type="button" size="sm" className="h-8 gap-1 text-xs" onClick={() => void handleApply()} disabled={busy}>
          <Check className="h-3.5 w-3.5" />
          应用
        </Button>
      </div>
    </div>
  );
}

function ThemeTuneSection({
  workspaceId,
  executeJS,
}: {
  workspaceId: string;
  executeJS: AppDevTuneExecuteJS | null;
}) {
  const [tokens, setTokens] = useState<AppDevDesignTokenDef[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [snapshot, setSnapshot] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedHint, setAppliedHint] = useState<string | null>(null);
  const names = useMemo(() => tokens.map((t) => t.name), [tokens]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const contract = await getAppDesignTokens(workspaceId);
      setTokens(contract.tokens);
      setDegraded(contract.degraded);
      const tokenNames = contract.tokens.map((t) => t.name);
      let live: Record<string, string> = {};
      if (executeJS) {
        const raw = await executeJS(buildReadTokensScript(tokenNames));
        if (raw && typeof raw === 'object') {
          live = Object.fromEntries(
            Object.entries(raw as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, (v as string).trim()]),
          );
        }
      }
      const next: Record<string, string> = {};
      for (const name of tokenNames) next[name] = live[name] || '';
      setValues(next);
      setSnapshot(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId, executeJS]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchValue = useCallback(async (name: string, next: string) => {
    setValues((prev) => ({ ...prev, [name]: next }));
    setAppliedHint(null);
    if (!executeJS) return;
    try {
      await executeJS(buildApplyTokenOverridesScript({ [name]: next }));
    } catch {
      // 预览不可用时仍保留草稿
    }
  }, [executeJS]);

  const handleReset = useCallback(async () => {
    setValues(snapshot);
    setAppliedHint(null);
    if (!executeJS) return;
    try {
      await executeJS(buildClearTokenOverridesScript(names));
      if (Object.keys(snapshot).length > 0) {
        await executeJS(buildApplyTokenOverridesScript(snapshot));
      }
    } catch {
      // ignore
    }
  }, [executeJS, names, snapshot]);

  const handleApply = useCallback(async () => {
    setBusy(true);
    setError(null);
    setAppliedHint(null);
    try {
      const dirty: Record<string, string> = {};
      for (const name of names) {
        const v = (values[name] ?? '').trim();
        if (v && v !== (snapshot[name] ?? '').trim()) dirty[name] = v;
      }
      if (Object.keys(dirty).length === 0) {
        setAppliedHint('没有需要落盘的改动');
        return;
      }
      const result = await applyAppTheme(workspaceId, dirty);
      setSnapshot(values);
      setAppliedHint(`已写入 ${result.themePath}（${result.updated.length} 项）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [names, snapshot, values, workspaceId]);

  const groups = useMemo(() => {
    const map = new Map<string, AppDevDesignTokenDef[]>();
    for (const token of tokens) {
      const list = map.get(token.group) ?? [];
      list.push(token);
      map.set(token.group, list);
    }
    return [...map.entries()];
  }, [tokens]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {degraded ? (
          <p className="mb-3 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground">
            当前应用无 design-tokens 契约，已使用内置默认项（仅新建模板完整支持）。
          </p>
        ) : null}
        {!executeJS ? (
          <p className="mb-3 text-[11px] text-muted-foreground">
            预览未就绪或当前为浏览器降级环境，无法实时覆写；仍可编辑并尝试落盘。
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 text-xs text-[var(--sto-danger-primary,#FA3C3C)]">{error}</p>
        ) : null}
        <div className="space-y-5">
          {groups.map(([group, list]) => (
            <section key={group} className="space-y-3">
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">{group}</h3>
              {list.map((token) => (
                <TokenEditor
                  key={token.name}
                  token={token}
                  value={values[token.name] ?? ''}
                  onChange={(next) => void patchValue(token.name, next)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
        <div className="flex-1 truncate text-[11px] text-muted-foreground">{appliedHint}</div>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => void handleReset()} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </Button>
        <Button type="button" size="sm" className="h-8 gap-1 text-xs" onClick={() => void handleApply()} disabled={busy}>
          <Check className="h-3.5 w-3.5" />
          应用
        </Button>
      </div>
    </div>
  );
}

function TokenEditor({
  token,
  value,
  onChange,
}: {
  token: AppDevDesignTokenDef;
  value: string;
  onChange: (next: string) => void;
}) {
  if (token.type === 'color') {
    return <OklchColorField label={token.label} value={value || 'oklch(0.70 0.15 50)'} onChange={onChange} />;
  }
  if (token.type === 'radius') {
    const rem = parseRem(value) ?? 0.5;
    const min = token.min ?? 0;
    const max = token.max ?? 1;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--sto-text-secondary)]">{token.label}</label>
          <span className="font-mono text-[11px] text-muted-foreground">{formatRem(rem)}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={rem}
          onChange={(e) => onChange(formatRem(Number(e.target.value)))}
          className="h-1.5 w-full accent-[var(--sto-brand-primary,#FF6F00)]"
        />
      </div>
    );
  }
  const options = token.options?.length
    ? token.options
    : ['"PingFang SC", "Microsoft YaHei", sans-serif'];
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-[var(--sto-text-secondary)]">{token.label}</label>
      <select
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        value={options.includes(value) ? value : options[0]}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.replace(/^"|"$/g, '').slice(0, 48)}
          </option>
        ))}
      </select>
    </div>
  );
}
