import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { fetchDictionaryItemsByTypeCode } from '@/lib/dictionary-api';
import {
  createWorkflowStudio,
  getWorkflowStudioTemplate,
  listWorkflowStudioTemplates,
  type WorkflowStudioTemplate,
} from '@/lib/workflow-studio-api';
import { buildTemplatePreview, buildWizardTemplateSeed } from '@/lib/workflow-template-seed';
import {
  BLANK_TEMPLATE_LABEL,
  buildFallbackWorkflowCategoryOptions,
  categoryLabel,
  type CreateWorkflowWizardData,
  type CreateWorkflowWizardStep,
  type WorkflowCategoryOption,
} from '@/pages/Workflow/components/create-workflow-wizard-types';
import { nodeTypeLabel } from '@/pages/WorkflowDesigner/utils';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { workflowPageContentClass, workflowPageRootClass } from '@/lib/surfaces';

const STEP_LABELS = ['基本信息', '确认创建'] as const;

function WizardStepIndicator({
  currentStep,
  maxVisitedStep,
  onStepClick,
}: {
  currentStep: CreateWorkflowWizardStep;
  maxVisitedStep: CreateWorkflowWizardStep;
  onStepClick: (step: CreateWorkflowWizardStep) => void;
}) {
  return (
    <div className="mb-8 flex items-center justify-center gap-0 border-b border-border">
      {STEP_LABELS.map((label, index) => {
        const step = (index + 1) as CreateWorkflowWizardStep;
        const isActive = step === currentStep;
        const isClickable = step <= maxVisitedStep;
        return (
          <button
            key={step}
            type="button"
            disabled={!isClickable}
            onClick={() => isClickable && onStepClick(step)}
            className={cn(
              'relative flex items-center gap-2 px-6 pb-3 text-sm font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
              !isClickable && 'cursor-not-allowed opacity-50',
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {step}
            </span>
            {label}
            {isActive ? (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function StepBasicInfo({
  data,
  categoryOptions,
  onChange,
}: {
  data: CreateWorkflowWizardData;
  categoryOptions: WorkflowCategoryOption[];
  onChange: (patch: Partial<CreateWorkflowWizardData>) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">基本信息</h2>
        <p className="mt-1 text-sm text-muted-foreground">为你的新流程起个名字，描述业务场景。</p>
        {data.templateId !== 'blank' ? (
          <p className="mt-2 text-sm text-muted-foreground">
            模板来源：<span className="font-medium text-foreground">{data.templateLabel}</span>
            {data.nodes.length > 0 ? `（预置 ${data.nodes.length} 个节点）` : null}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="wizard-name" className="text-sm font-medium">
          流程名称 <span className="text-destructive">*</span>
        </label>
        <Input
          id="wizard-name"
          value={data.name}
          placeholder="例如：合同审核流程"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="wizard-description" className="text-sm font-medium">
          流程描述
        </label>
        <Textarea
          id="wizard-description"
          value={data.description}
          placeholder="描述业务场景、触发条件和产出。"
          rows={3}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="wizard-category" className="text-sm font-medium">
          流程分类
        </label>
        <Select
          id="wizard-category"
          value={data.category}
          onChange={(e) => onChange({ category: e.target.value })}
        >
          <option value="">请选择分类</option>
          {categoryOptions.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function StepConfirmCreate({
  data,
  categoryOptions,
}: {
  data: CreateWorkflowWizardData;
  categoryOptions: WorkflowCategoryOption[];
}) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">确认并创建</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          检查以下配置，确认无误后点击「创建」。创建后进入编辑器继续编排节点。
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <ConfirmField label="流程名称" value={data.name || '(未命名)'} />
        <ConfirmField label="流程描述" value={data.description || '—'} />
        <ConfirmField label="流程分类" value={categoryLabel(data.category, categoryOptions)} />
        <ConfirmField label="模板来源" value={data.templateLabel} />
        <ConfirmField label="节点数量" value={`${data.nodes.length} 个`} />
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-semibold">模板摘要</p>
        <p className="mt-1 text-sm text-muted-foreground">
          节点会在设计器画布中继续编辑，这里只做快速确认。
        </p>
        {data.nodes.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {data.nodes.map((node, index) => (
              <li
                key={node.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="text-xs text-muted-foreground">{index + 1}</span>
                <span className="text-xs text-primary">{nodeTypeLabel(node.type)}</span>
                <span className="font-medium">{node.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function ConfirmField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

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

/** 新建工作流两步向导 — API 对齐 MC `/workflows-workbench/new?templateId=` */
export function CreateWorkflowWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [wizardData, setWizardData] = useState<CreateWorkflowWizardData>(INITIAL_DATA);
  const [currentStep, setCurrentStep] = useState<CreateWorkflowWizardStep>(1);
  const [maxVisitedStep, setMaxVisitedStep] = useState<CreateWorkflowWizardStep>(1);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<WorkflowCategoryOption[]>(
    buildFallbackWorkflowCategoryOptions(),
  );

  const initialTemplateId = searchParams.get('templateId') ?? 'blank';
  const initialName = searchParams.get('name') ?? '';

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
    setIsLoadingTemplates(true);
    setErrorMessage(null);

    void listWorkflowStudioTemplates()
      .then(async (templates) => {
        if (cancelled) return;
        const seed = await loadWizardSeed(initialTemplateId, templates);
        if (cancelled) return;
        setWizardData((prev) => ({
          ...prev,
          ...seed,
          name: initialName || prev.name,
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '模板加载失败';
        setErrorMessage(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTemplates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialTemplateId, initialName]);

  const patchData = (patch: Partial<CreateWorkflowWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...patch }));
  };

  const goToStep = (step: CreateWorkflowWizardStep) => {
    if (step <= maxVisitedStep) setCurrentStep(step);
  };

  const nextStep = () => {
    if (currentStep < 2) {
      const next = 2 as CreateWorkflowWizardStep;
      setCurrentStep(next);
      if (next > maxVisitedStep) setMaxVisitedStep(next);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(1);
  };

  const canGoNext = currentStep === 1 ? wizardData.name.trim().length > 0 : true;

  const handleCreate = async () => {
    setIsCreating(true);
    setErrorMessage(null);
    try {
      const created = await createWorkflowStudio({
        templateId: wizardData.templateId,
        name: wizardData.name.trim(),
        description: wizardData.description.trim() || undefined,
        category: wizardData.category,
        nodes: wizardData.nodes,
        edges: wizardData.edges,
      });
      toast.success('工作流已创建');
      navigate(`/workflow/${encodeURIComponent(created.id)}`, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建失败，请重试。';
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className={workflowPageRootClass}>
      <WorkflowPageShading />
      <div className={cn(workflowPageContentClass, 'flex min-h-[calc(100vh-3rem)] flex-col px-4 py-6 md:px-8')}>
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('/workflow')}
              className="mb-2 text-sm text-primary hover:underline"
            >
              ← 返回列表
            </button>
            <h1 className="text-2xl font-semibold text-foreground">新建流程</h1>
          </div>
        </header>

        <div className="mx-auto w-full max-w-3xl flex-1">
          <WizardStepIndicator
            currentStep={currentStep}
            maxVisitedStep={maxVisitedStep}
            onStepClick={goToStep}
          />

          {errorMessage ? (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          {isLoadingTemplates ? (
            <p className="mb-4 text-center text-sm text-muted-foreground">正在加载模板…</p>
          ) : null}

          {!isLoadingTemplates && currentStep === 1 ? (
            <StepBasicInfo data={wizardData} categoryOptions={categoryOptions} onChange={patchData} />
          ) : null}
          {!isLoadingTemplates && currentStep === 2 ? (
            <StepConfirmCreate data={wizardData} categoryOptions={categoryOptions} />
          ) : null}

          <div className="mx-auto mt-10 flex w-full max-w-xl items-center gap-3">
            {currentStep > 1 ? (
              <Button type="button" variant="outline" onClick={prevStep}>
                上一步
              </Button>
            ) : null}
            <div className="flex-1" />
            {currentStep < 2 ? (
              <Button type="button" disabled={!canGoNext || isLoadingTemplates} onClick={nextStep}>
                下一步
              </Button>
            ) : (
              <Button type="button" disabled={isCreating || isLoadingTemplates} onClick={() => void handleCreate()}>
                <Plus className="mr-1 h-4 w-4" />
                {isCreating ? '创建中…' : '创建流程'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
