/**
 * ParameterFormCard - Inline wizard form card for chat messages
 *
 * Embeds a multi-step parameter confirmation form directly in the chat thread.
 * Used for workflow startup, tool confirmation, and other scenarios requiring
 * user parameter input.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react';
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


  // Compute default hint for current step
  const defaultHint = useMemo(() => {
    if (!step || !step.fields) return null;
    const defaults: string[] = [];
    for (const field of step.fields) {
      if (field.defaultValue !== undefined && field.defaultValue !== '') {
        const label = String(field.label);
        let valueText: string;
        if (Array.isArray(field.defaultValue)) {
          valueText = field.defaultValue.join('、');
        } else {
          valueText = String(field.defaultValue);
        }
        defaults.push(`${label}：${valueText}`);
      }
    }
    return defaults.length > 0 ? `工作流默认：${defaults.join('、')}` : null;
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
    <div className="w-full rounded-2xl border border-border bg-background shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">
              {step?.title ?? '参数确认'}
            </h3>
            {step?.description && (
              <p className="text-[12.5px] text-muted-foreground mt-0.5">{step.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={handlePrev}
              disabled={isFirst}
              className="p-1 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">
              {currentStep + 1} / {steps.length}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={isLast}
              className="p-1 rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Step indicator dots */}
      {steps.length > 1 && (
        <div className="px-5 pt-3 flex items-center gap-1.5">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                idx === currentStep ? 'w-6 bg-primary' : idx < currentStep ? 'w-3 bg-primary/40' : 'w-3 bg-muted'
              )}
            />
          ))}
        </div>
      )}

      {/* Fields */}
      <div className="px-5 py-4 space-y-4">
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
      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        <div className="text-[12px] text-muted-foreground">
          {/* {defaultHint} */}
        </div>
        <div className="flex items-center gap-2">
          {config.allowCancel !== false && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {}}
              className="text-muted-foreground"
            >
              {config.cancelLabel ?? '取消'}
            </Button>
          )}
          {isLast ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              {config.confirmLabel ?? '确认并执行'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {config.confirmLabel ?? '继续'}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
