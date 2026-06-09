/**
 * ParameterFormCard - Inline wizard form card for chat messages
 *
 * Embeds a multi-step parameter confirmation form directly in the chat thread.
 * Used for workflow startup, tool confirmation, and other scenarios requiring
 * user parameter input.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FormFieldRenderer } from './FormFieldRenderer';
import type { UserFormConfig, FormResult, FormField } from '@/types/user-form';

export interface ParameterFormContext {
  source: 'workflow' | 'tool' | 'skill';
  sourceId: string;
  schemaHash?: string;
}

export interface ParameterFormCardProps {
  config: UserFormConfig;
  context: ParameterFormContext;
  onSubmit: (values: FormResult, context: ParameterFormContext) => void | Promise<void>;
}

interface WizardStep {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
}

/** Build wizard steps from config */
function buildWizardSteps(config: UserFormConfig): WizardStep[] {
  if (config.steps && config.steps.length > 0) {
    return config.steps.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      fields: (s.fieldNames ?? config.fields.map((f) => f.name)).map((name) => {
        const field = config.fields.find((f) => f.name === name);
        return field!;
      }).filter(Boolean),
    }));
  }
  return [{
    id: 'default',
    title: config.title ?? '参数确认',
    description: config.description,
    fields: config.fields,
  }];
}

/** Build initial values from config defaults */
function buildInitialValues(config: UserFormConfig): FormResult {
  const initial: FormResult = {};
  if (!config.fields) return initial;
  for (const field of config.fields) {
    if (field.defaultValue !== undefined) {
      initial[field.name] = field.defaultValue;
    } else if (field.type === 'checkbox' && !('options' in field && (field as { options?: unknown }).options)) {
      initial[field.name] = false;
    } else if (field.type === 'multiselect') {
      initial[field.name] = [];
    } else if (field.type === 'editable_list') {
      initial[field.name] = (field as { defaultValue?: string[] }).defaultValue ?? [];
    }
  }
  return initial;
}

/** Validate a single field */
function validateField(field: FormField, value: unknown): string | null {
  const validation = field.validation;
  if (!validation) return null;

  if (validation.required) {
    if (value === undefined || value === null || value === '') {
      return `${field.label}是必填项`;
    }
    if (Array.isArray(value) && value.length === 0) {
      return `${field.label}至少选择一个选项`;
    }
  }

  if (validation.pattern) {
    const str = String(value ?? '');
    if (!new RegExp(validation.pattern).test(str)) {
      return `${field.label}格式不正确`;
    }
  }

  if (validation.minLength != null && String(value ?? '').length < validation.minLength) {
    return `${field.label}长度不能少于${validation.minLength}个字符`;
  }

  if (validation.maxLength != null && String(value ?? '').length > validation.maxLength) {
    return `${field.label}长度不能超过${validation.maxLength}个字符`;
  }

  if (validation.min != null && typeof value === 'number' && value < validation.min) {
    return `${field.label}不能小于${validation.min}`;
  }

  if (validation.max != null && typeof value === 'number' && value > validation.max) {
    return `${field.label}不能大于${validation.max}`;
  }

  return null;
}

export function ParameterFormCard({ config, context, onSubmit }: ParameterFormCardProps) {
  // If config is empty (from text marker), try to load from workflow memory
  const [schema, setSchema] = useState<import('@/types/workflow').WorkflowSchema | null>(null);
  const [loadedConfig, setLoadedConfig] = useState<UserFormConfig | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);

  useEffect(() => {
    if (Object.keys(config).length === 0 && context.source === 'workflow' && context.sourceId) {
      setLoadingSchema(true);
      import('@/stores/workflow-memory').then(({ getLatestWorkflow }) => {
        import('@/stores/chat').then(({ useChatStore }) => {
          const currentSessionKey = useChatStore.getState().currentSessionKey;
          const latest = getLatestWorkflow(currentSessionKey);
          if (latest && latest.templateId === context.sourceId) {
            import('@/lib/workflow-api').then(({ getStartupSchema }) => {
              getStartupSchema(context.sourceId).then(({ schema }) => {
                setSchema(schema);
              }).catch(() => {
                setSchema(null);
                setLoadingSchema(false);
              });
            });
          } else {
            setSchema(null);
            setLoadingSchema(false);
          }
        });
      }).catch(() => {
        setSchema(null);
        setLoadingSchema(false);
      });
    }
  }, [config, context.source, context.sourceId]);

  useEffect(() => {
    if (schema && !loadedConfig) {
      import('@/lib/workflow-form-utils').then(({ buildWorkflowFormConfig }) => {
        const builtConfig = buildWorkflowFormConfig(schema, '');
        setLoadedConfig(builtConfig);
        setLoadingSchema(false);
      });
    }
  }, [schema, loadedConfig]);

  // Only use effectiveConfig if it has fields, otherwise we're still loading
  const hasValidConfig = Object.keys(config).length > 0 || loadedConfig !== null;
  const effectiveConfig = hasValidConfig ? (loadedConfig || config) : null;

  // ALL hooks must be called unconditionally before any early returns
  const [currentStep, setCurrentStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [values, setValues] = useState<FormResult>(() => effectiveConfig ? buildInitialValues(effectiveConfig) : {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Compute steps even if effectiveConfig is null (will be empty array)
  const steps = useMemo(() => effectiveConfig ? buildWizardSteps(effectiveConfig) : [], [effectiveConfig]);

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep >= steps.length - 1;

  const updateValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const validateStep = useCallback((): boolean => {
    if (!step || !step.fields) return false;
    const newErrors: Record<string, string> = {};
    let isValid = true;
    for (const field of step.fields) {
      if (field.hidden || field.type === 'hidden') continue;
      const error = validateField(field, values[field.name]);
      if (error) {
        newErrors[field.name] = error;
        isValid = false;
      }
    }
    setErrors(newErrors);
    return isValid;
  }, [step, values]);

  const handleNext = useCallback(() => {
    if (!validateStep()) return;
    if (!isLast) {
      setCurrentStep((s) => s + 1);
    }
  }, [validateStep, isLast]);

  const handlePrev = useCallback(() => {
    if (!isFirst) {
      setCurrentStep((s) => s - 1);
    }
  }, [isFirst]);

  const handleSubmit = useCallback(async () => {
    if (!validateStep()) return;
    // Validate all steps for final submission
    const allErrors: Record<string, string> = {};
    for (const s of steps) {
      for (const field of s.fields) {
        if (field.hidden || field.type === 'hidden') continue;
        const error = validateField(field, values[field.name]);
        if (error) {
          allErrors[field.name] = error;
        }
      }
    }

    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      const firstErrorStep = steps.findIndex((s) => s.fields.some((f) => allErrors[f.name]));
      if (firstErrorStep >= 0) setCurrentStep(firstErrorStep);
      return;
    }
    setSubmitting(true);
    try {
      console.log('context', context, values);
      const result = onSubmit(values, context);
      if (result instanceof Promise) {
        await result;
      }
    } finally {
      setSubmitting(false);
    }
  }, [validateStep, steps, values, context, onSubmit]);


  const stepFooterHint = useMemo(() => {
    if (!step?.fields?.length) return null;
    for (const field of step.fields) {
      if (field.description && /仅展示|不可修改|系统预置/.test(field.description)) {
        return field.description;
      }
    }
    return null;
  }, [step]);

  // Loading state while fetching schema from memory
  if (!hasValidConfig && loadingSchema) {
    return (
      <div className="w-full rounded-2xl border border-border bg-background shadow-sm overflow-hidden p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading form configuration...</span>
        </div>
      </div>
    );
  }

  // Guard: if effectiveConfig is null (still loading or failed), render nothing
  if (!effectiveConfig) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#E5E6EB] bg-[#FAFBFC] shadow-[0_2px_8px_rgba(29,33,41,0.04)]">
      {/* Header */}
      <div className="border-b border-[#E5E6EB] bg-white px-5 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-[#1D2129]">
              {step?.title ?? '参数确认'}
            </h3>
            {step?.description && (
              <p className="mt-0.5 truncate text-[12.5px] text-[#86909C]">{step.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-[#E5E6EB] bg-[#FAFBFC] px-1 py-0.5 text-[12px] text-[#4E5969]">
              <button
                type="button"
                onClick={handlePrev}
                disabled={isFirst}
                className="rounded p-1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[2.5rem] text-center tabular-nums">
                {currentStep + 1}/{steps.length}
              </span>
              <button
                type="button"
                onClick={handleNext}
                disabled={isLast}
                className="rounded p-1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-[#86909C] transition-colors hover:bg-[#F5F6F7] hover:text-[#4E5969]"
            >
              {collapsed ? '展开' : '收起'}
              <ChevronUp className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
            </button>
          </div>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Step indicator */}
          {steps.length > 1 && (
            <div className="flex items-center gap-1.5 bg-white px-5 pb-3 pt-2">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'h-1 rounded-full transition-all duration-300',
                    idx === currentStep
                      ? 'w-6 bg-[var(--sto-brand-6)]'
                      : idx < currentStep
                        ? 'w-3 bg-[#FFD7A3]'
                        : 'w-3 bg-[#E5E6EB]',
                  )}
                />
              ))}
            </div>
          )}

          {/* Fields */}
          <div className="space-y-5 px-5 py-4">
            <div className="text-[14px] font-semibold text-[#1D2129]">
              {currentStep + 1}. {step?.title ?? '参数确认'}
            </div>
            {step?.fields.map((field) => (
              <FormFieldRenderer
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(v) => updateValue(field.name, v)}
                error={errors[field.name]}
              />
            ))}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-3 border-t border-[#E5E6EB] bg-white px-5 py-3.5">
            <div className="min-w-0 text-[12px] text-[#86909C]">
              {stepFooterHint}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isFirst && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  className="text-[#86909C] hover:text-[#4E5969]"
                >
                  {config.prevLabel ?? '上一步'}
                </Button>
              )}
              {isLast ? (
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-lg bg-[#1D2129] px-5 text-white hover:bg-[#4E5969]"
                >
                  {submitting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  {config.confirmLabel ?? '确认并执行'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="rounded-lg bg-[#1D2129] px-5 text-white hover:bg-[#4E5969]"
                >
                  {config.nextLabel ?? '继续'}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
