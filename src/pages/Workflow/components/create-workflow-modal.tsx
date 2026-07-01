import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { fetchDictionaryItemsByTypeCode } from '@/lib/dictionary-api';
import {
  createWorkflowStudio,
  getWorkflowStudioTemplate,
  listWorkflowStudioTemplates,
  type WorkflowStudioTemplate,
} from '@/lib/workflow-studio-api';
import { buildTemplatePreview, buildWizardTemplateSeed } from '@/lib/workflow-template-seed';
import {
  createWorkflowModalBodyClass,
  createWorkflowModalCategorySelectClass,
  createWorkflowModalCloseClass,
  createWorkflowModalConfirmButtonClass,
  createWorkflowModalContentClass,
  createWorkflowModalDescriptionCounterClass,
  createWorkflowModalDescriptionInputClass,
  createWorkflowModalDescriptionWrapClass,
  createWorkflowModalFieldLabelClass,
  createWorkflowModalFooterClass,
  createWorkflowModalHeaderClass,
  createWorkflowModalNameInputClass,
  createWorkflowModalOverlayClass,
  createWorkflowModalSubtitleClass,
  createWorkflowModalTitleClass,
  createWorkflowModalTitleRowClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import {
  BLANK_TEMPLATE_LABEL,
  buildFallbackWorkflowCategoryOptions,
  type CreateWorkflowWizardData,
  type WorkflowCategoryOption,
} from '@/pages/Workflow/components/create-workflow-wizard-types';

/** 设计稿描述字段上限（MasterGo 8:79172） */
const DESCRIPTION_MAX_LENGTH = 50;

const INITIAL_DATA: CreateWorkflowWizardData = {
  name: '',
  description: '',
  category: '',
  templateId: 'blank',
  templateLabel: BLANK_TEMPLATE_LABEL,
  nodes: [],
  edges: [],
};

async function loadWizardSeed(
  templateId: string,
  templates: WorkflowStudioTemplate[],
): Promise<Pick<CreateWorkflowWizardData, 'templateId' | 'templateLabel' | 'nodes' | 'edges' | 'description'>> {
  if (templateId === 'blank') {
    const summary = templates.find((t) => t.id === 'blank') ?? {
      id: 'blank',
      label: BLANK_TEMPLATE_LABEL,
      nodes: [],
      edges: [],
    };
    const seed = buildTemplatePreview(summary);
    return {
      templateId: 'blank',
      templateLabel: summary.label ?? BLANK_TEMPLATE_LABEL,
      ...seed,
      description: summary.description ?? '',
    };
  }

  const listed = templates.find((t) => t.id === templateId);
  try {
    const detail = await getWorkflowStudioTemplate(templateId);
    const seed = buildWizardTemplateSeed(detail);
    return {
      templateId: detail.id,
      templateLabel: detail.label,
      ...seed,
      description: detail.description ?? '',
    };
  } catch {
    if (listed) {
      const seed = buildTemplatePreview(listed);
      return {
        templateId: listed.id,
        templateLabel: listed.label,
        ...seed,
        description: listed.description ?? '',
      };
    }
    throw new Error(`模板 ${templateId} 不存在或无法加载`);
  }
}

export interface CreateWorkflowModalInitialValues {
  /** 预填模板 id（深链 `/workflow/new?templateId=`） */
  templateId?: string;
  /** 预填流程名称 */
  name?: string;
}

export interface CreateWorkflowModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗（不创建） */
  onClose: () => void;
  /** 打开时的初始值（模板 / 名称） */
  initialValues?: CreateWorkflowModalInitialValues;
}

interface CreateWorkflowModalContentProps {
  initialTemplateId: string;
  initialName: string;
  onClose: () => void;
}

/**
 * 弹窗内表单 — 独立挂载实例，打开时 remount 避免在 effect 里同步 reset state。
 */
function CreateWorkflowModalContent({
  initialTemplateId,
  initialName,
  onClose,
}: CreateWorkflowModalContentProps) {
  const { t } = useTranslation('workflow');
  const navigate = useNavigate();
  const [formData, setFormData] = useState<CreateWorkflowWizardData>(INITIAL_DATA);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<WorkflowCategoryOption[]>(
    buildFallbackWorkflowCategoryOptions(),
  );

  useEffect(() => {
    let cancelled = false;

    void fetchDictionaryItemsByTypeCode('workflow_category', 0)
      .then((items) => {
        if (cancelled || items.length === 0) return;
        setCategoryOptions(items.map((item) => ({ value: item.value, label: item.name })));
      })
      .catch(() => {
        // 字典加载失败时保留硬编码兜底
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void listWorkflowStudioTemplates()
      .then(async (templates) => {
        if (cancelled) return;
        const seed = await loadWizardSeed(initialTemplateId, templates);
        if (cancelled) return;
        const seededDescription = (seed.description ?? '').slice(0, DESCRIPTION_MAX_LENGTH);
        setFormData({
          ...INITIAL_DATA,
          ...seed,
          description: seededDescription,
          name: initialName,
        });
        setIsLoadingTemplates(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t('createModal.templateLoadFailed');
        setErrorMessage(message);
        setIsLoadingTemplates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialTemplateId, initialName, t]);

  const patchData = (patch: Partial<CreateWorkflowWizardData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  };

  const canConfirm = formData.name.trim().length > 0 && !isCreating && !isLoadingTemplates;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const created = await createWorkflowStudio({
        templateId: formData.templateId,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        category: formData.category,
        nodes: formData.nodes,
        edges: formData.edges,
      });
      toast.success(t('createModal.created'));
      onClose();
      navigate(`/workflow/${encodeURIComponent(created.id)}`, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('createModal.createFailed');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const descriptionLength = formData.description.length;

  return (
    <>
      <header className={createWorkflowModalHeaderClass}>
        <div className={createWorkflowModalTitleRowClass}>
          <Dialog.Title className={createWorkflowModalTitleClass}>
            {t('createModal.title')}
          </Dialog.Title>
          <Dialog.Close asChild>
            <button
              type="button"
              className={createWorkflowModalCloseClass}
              aria-label={t('createModal.close')}
              disabled={isCreating}
            >
              <X className="h-[14px] w-[14px]" aria-hidden />
            </button>
          </Dialog.Close>
        </div>
        <Dialog.Description
          id="create-workflow-modal-subtitle"
          className={createWorkflowModalSubtitleClass}
        >
          {t('createModal.subtitle')}
        </Dialog.Description>
      </header>

      <div className={createWorkflowModalBodyClass}>
        {errorMessage ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {isLoadingTemplates ? (
          <div className="flex justify-center py-6">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-wf-name" className={createWorkflowModalFieldLabelClass}>
                <span className="text-destructive">*</span>
                {t('createModal.nameLabel')}
              </label>
              <Input
                id="create-wf-name"
                className={createWorkflowModalNameInputClass}
                value={formData.name}
                placeholder={t('createModal.namePlaceholder')}
                disabled={isCreating}
                onChange={(e) => patchData({ name: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-wf-description" className={createWorkflowModalFieldLabelClass}>
                {t('createModal.descriptionLabel')}
              </label>
              <div className={createWorkflowModalDescriptionWrapClass}>
                <Textarea
                  id="create-wf-description"
                  className={createWorkflowModalDescriptionInputClass}
                  value={formData.description}
                  placeholder={t('createModal.descriptionPlaceholder')}
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  disabled={isCreating}
                  onChange={(e) => patchData({ description: e.target.value })}
                />
                <span className={createWorkflowModalDescriptionCounterClass} aria-hidden>
                  {t('createModal.descriptionCounter', {
                    count: descriptionLength,
                    max: DESCRIPTION_MAX_LENGTH,
                  })}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-wf-category" className={createWorkflowModalFieldLabelClass}>
                {t('createModal.categoryLabel')}
              </label>
              <Select
                id="create-wf-category"
                className={createWorkflowModalCategorySelectClass}
                value={formData.category}
                disabled={isCreating}
                onChange={(e) => patchData({ category: e.target.value })}
              >
                <option value="">{t('createModal.categoryPlaceholder')}</option>
                {categoryOptions.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
      </div>

      <footer className={createWorkflowModalFooterClass}>
        <Button
          type="button"
          className={createWorkflowModalConfirmButtonClass}
          disabled={!canConfirm}
          onClick={() => void handleConfirm()}
        >
          {isCreating ? t('createModal.confirming') : t('createModal.confirm')}
        </Button>
      </footer>
    </>
  );
}

/**
 * CreateWorkflowModal — 手动新建工作流弹窗（MasterGo 8:79172）
 *
 * 单步表单：名称 + 描述 + 分类 → 确认后直接 createWorkflowStudio 并跳转编辑器。
 * 使用位置：工作流列表 `workflow-routes.tsx`（含 `/workflow/new` 深链兼容）。
 */
export function CreateWorkflowModal({
  open,
  onClose,
  initialValues,
}: CreateWorkflowModalProps) {
  const initialTemplateId = initialValues?.templateId ?? 'blank';
  const initialName = initialValues?.name ?? '';
  const contentKey = `${initialTemplateId}:${initialName}`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('fixed inset-0 z-[120]', createWorkflowModalOverlayClass)}
        />
        {open ? (
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-[121] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2',
              createWorkflowModalContentClass,
            )}
            aria-describedby="create-workflow-modal-subtitle"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <CreateWorkflowModalContent
              key={contentKey}
              initialTemplateId={initialTemplateId}
              initialName={initialName}
              onClose={onClose}
            />
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
