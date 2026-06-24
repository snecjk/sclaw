/** 编辑器弹窗/抽屉组件集：发布成功、未保存提醒、数据树、技能选择、版本历史、运行抽屉、运行报告占位 */
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { VersionItem } from '@/pages/WorkflowBuilder/types';

/** 发布成功弹窗：绿色勾图标 + 回到列表/继续编辑按钮 */
export function PublishModal({
  open,
  workflowName,
  onClose,
  onBackToList,
}: {
  open: boolean;
  workflowName: string;
  onClose: () => void;
  onBackToList: () => void;
}) {
  const { t } = useTranslation('workflow');
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/20 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] w-[360px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-[30px] text-center shadow-modal data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-2xl font-semibold text-success">
            ✓
          </div>
          <Dialog.Title className="text-[17px] font-semibold text-foreground">{t('publish.success')}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] leading-relaxed text-foreground/80">
            {t('publish.message', { name: workflowName })}
          </Dialog.Description>
          <div className="mt-5 flex gap-2.5">
            <Button type="button" variant="outline" className="flex-1" onClick={onBackToList}>
              {t('publish.backToList')}
            </Button>
            <Button type="button" className="flex-1" onClick={onClose}>
              {t('publish.continueEdit')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 未保存提醒弹窗：警告图标 + 继续编辑/保存并返回 */
export function UnsavedModal({
  open,
  onContinue,
  onSaveAndBack,
}: {
  open: boolean;
  onContinue: () => void;
  onSaveAndBack: () => void;
}) {
  const { t } = useTranslation('workflow');
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onContinue()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] w-[360px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-[30px] text-center shadow-modal">
          <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-2xl font-semibold text-warning">
            !
          </div>
          <Dialog.Title className="text-[17px] font-semibold text-foreground">{t('unsaved.title')}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] leading-relaxed text-foreground/80">{t('unsaved.message')}</Dialog.Description>
          <div className="mt-5 flex gap-2.5">
            <Button type="button" variant="outline" className="flex-1" onClick={onContinue}>
              {t('unsaved.continueEdit')}
            </Button>
            <Button type="button" className="flex-1" onClick={onSaveAndBack}>
              {t('unsaved.saveAndBack')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 数据源选择弹窗：分组列表 + checkbox 交互 + 确认/取消 */
export function DataTreeModal({
  open,
  title,
  groups,
  selected,
  onToggle,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  groups: Array<{ name: string; items: string[] }>;
  selected: Set<string>;
  onToggle: (name: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('workflow');
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-5 shadow-modal">
          <div className="mb-4 flex items-center">
            <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
            <button type="button" aria-label={t('skills.cancel')} onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="max-h-[300px] overflow-auto">
            {groups.map((g) => (
              <div key={g.name} className="mb-1">
                <div className="px-1.5 py-2 text-[12.5px] font-semibold text-foreground/80">{g.name}</div>
                <div className="flex flex-col pl-4">
                  {g.items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onToggle(item)}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] hover:bg-muted"
                    >
                      <span
                        className={cn(
                          'flex h-[17px] w-[17px] items-center justify-center rounded-sm border text-[11px]',
                          selected.has(item) ? 'border-primary bg-primary text-primary-foreground' : 'border-[#DDE0E5]',
                        )}
                      >
                        {selected.has(item) ? '✓' : ''}
                      </span>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {t('skills.cancel')}
            </Button>
            <Button type="button" className="flex-1" onClick={onConfirm}>
              {t('skills.confirm')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 技能选择浮窗：搜索过滤 + checkbox 列表 + 确认/取消 */
export function SkillPickerPopover({
  open,
  position,
  skills,
  selected,
  search,
  onSearch,
  onToggle,
  onClose,
  onConfirm,
}: {
  open: boolean;
  position: { x: number; y: number };
  skills: string[];
  selected: Set<string>;
  search: string;
  onSearch: (v: string) => void;
  onToggle: (name: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('workflow');
  if (!open) return null;
  const filtered = skills.filter((s) => !search || s.includes(search));
  return (
    <>
      <button type="button" className="fixed inset-0 z-[125] bg-transparent" aria-label={t('skills.cancel')} onClick={onClose} />
      <div
        className="fixed z-[126] flex w-[300px] flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-modal"
        style={{ left: position.x, top: position.y }}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('skills.search')}
            className="h-auto border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[236px] overflow-auto px-2">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-[12.5px] text-muted-foreground">{t('skills.empty')}</p>
          ) : (
            filtered.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => onToggle(skill)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] hover:bg-muted"
              >
                <span
                  className={cn(
                    'flex h-[17px] w-[17px] items-center justify-center rounded-sm border text-[11px]',
                    selected.has(skill) ? 'border-primary bg-primary text-primary-foreground' : 'border-[#DDE0E5]',
                  )}
                >
                  {selected.has(skill) ? '✓' : ''}
                </span>
                {skill}
              </button>
            ))
          )}
        </div>
        <div className="mt-2 flex gap-2 border-t border-border p-3">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {t('skills.cancel')}
          </Button>
          <Button type="button" className="flex-1" onClick={onConfirm}>
            {t('skills.confirm')}
          </Button>
        </div>
      </div>
    </>
  );
}

/** 版本历史侧抽屉：当前显示空态提示（待接入版本 API） */
export function VersionDrawer({
  open,
  onClose,
  onRestore: _onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: (item: VersionItem) => void;
}) {
  const { t } = useTranslation('workflow');
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[400px] max-w-[92vw] p-0 sm:max-w-[400px]">
        <div className="flex items-center border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{t('version.title')}</h2>
          <button type="button" aria-label={t('skills.cancel')} onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="overflow-auto px-[18px] py-2">
          <p className="py-8 text-center text-sm text-muted-foreground">{t('version.empty')}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 运行抽屉：Sheet 侧栏，支持 loading/report/node-report 三种模式 */
export function RunDrawer({
  open,
  mode,
  title,
  onClose,
  onCancel,
  onRerun,
  children,
}: {
  open: boolean;
  mode: 'loading' | 'report' | 'node-report';
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  onRerun?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation('workflow');
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[900px] max-w-[94vw] p-0 sm:max-w-[900px]">
        <div className="flex items-center border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <div className="ml-auto flex items-center gap-2">
            {mode === 'report' && onRerun ? (
              <Button type="button" size="sm" onClick={onRerun}>
                {t('run.rerun')}
              </Button>
            ) : null}
            <button type="button" aria-label={t('skills.cancel')} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-muted/30 p-6">
          {mode === 'loading' ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
              <Loader2 className="mb-4 h-11 w-11 animate-spin text-primary" aria-hidden />
              <b className="text-lg font-semibold text-foreground">{t('run.loadingTitle')}</b>
              <p className="mt-2 max-w-[300px] text-[13.5px] leading-relaxed text-muted-foreground">{t('run.loadingHint')}</p>
              {onCancel ? (
                <Button type="button" variant="outline" className="mt-5" onClick={onCancel}>
                  {t('run.cancel')}
                </Button>
              ) : null}
            </div>
          ) : (
            children
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 运行报告占位内容：当前显示「功能未就绪」文案（待接入试运行报告 API） */
export function RunReportContent() {
  const { t } = useTranslation('workflow');
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
      <p className="text-sm text-muted-foreground">{t('run.reportNotReady')}</p>
    </div>
  );
}
