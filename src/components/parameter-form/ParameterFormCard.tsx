/**
 * ParameterFormCard - Inline wizard form card for chat messages
 *
 * Embeds a multi-step parameter confirmation form directly in the chat thread.
 * Used for workflow startup, tool confirmation, and other scenarios requiring
 * user parameter input.
 */
import { useState, useMemo, useCallback } from 'react';
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

export function ParameterFormCard({ config, context, onSubmit }: ParameterFormCardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<FormResult>(() => buildInitialValues(config));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const steps = useMemo(() => buildWizardSteps(config), [config]);

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

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
      // Jump to first step with error
      const firstErrorStep = steps.findIndex((s) => s.fields.some((f) => allErrors[f.name]));
      if (firstErrorStep >= 0) setCurrentStep(firstErrorStep);
      return;
    }

    setSubmitting(true);
    try {
      const result = onSubmit(values, context);
      if (result instanceof Promise) {
        await result;
      }
    } finally {
      setSubmitting(false);
    }
  }, [validateStep, steps, values, context, onSubmit]);

  const handleSkip = useCallback(() => {
    // Use all default values and submit
    const defaultValues: FormResult = {};
    for (const field of config.fields) {
      if (field.defaultValue !== undefined) {
        defaultValues[field.name] = field.defaultValue;
      }
    }
    setValues(defaultValues);
    onSubmit(defaultValues, context);
  }, [config.fields, context, onSubmit]);

  // Compute default hint for current step
  const defaultHint = useMemo(() => {
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

  return (
    <div className="w-full rounded-2xl border border-border bg-background shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">
              {step.title}
            </h3>
            {step.description && (
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
        {step.fields.map((field) => (
          <FormFieldRenderer
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(v) => updateValue(field.name, v)}
            error={errors[field.name]}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
        <div className="min-w-0">
          {defaultHint && (
            <p className="text-[11.5px] text-muted-foreground truncate">{defaultHint}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {config.allowCancel !== false && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              disabled={submitting}
              className="text-[13px] h-8 px-3 text-muted-foreground hover:text-foreground"
            >
              跳过
            </Button>
          )}
          {isLast ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting}
              className="text-[13px] h-8 px-4 rounded-lg"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  提交中…
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  {config.confirmLabel || '确认'}
                </>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              className="text-[13px] h-8 px-4 rounded-lg"
            >
              继续
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Build wizard steps from config */
function buildWizardSteps(config: UserFormConfig): WizardStep[] {
  // If explicit steps are provided, use them
  if (config.steps && config.steps.length > 0) {
    const fieldMap = new Map(config.fields.map((f) => [f.name, f]));
    return config.steps.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      fields:
        s.fieldNames?.map((name) => fieldMap.get(name)).filter(Boolean) as FormField[] ??
        config.fields.filter((f) => f.name.startsWith(s.id)),
    }));
  }

  // Auto-group by field group property if available
  const groups = new Map<string, FormField[]>();
  const ungrouped: FormField[] = [];

  for (const field of config.fields) {
    // @ts-expect-error - group is not in base type but may exist on runtime fields
    const group = field.group as string | undefined;
    if (group) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(field);
    } else {
      ungrouped.push(field);
    }
  }

  const steps: WizardStep[] = [];
  for (const [id, fields] of groups) {
    steps.push({
      id,
      title: fields[0]?.label ?? id,
      description: fields[0]?.description,
      fields,
    });
  }
  if (ungrouped.length > 0) {
    steps.push({
      id: 'other',
      title: '其他参数',
      fields: ungrouped,
    });
  }

  // If no groups at all, put everything in one step
  if (steps.length === 0 && config.fields.length > 0) {
    steps.push({
      id: 'all',
      title: config.title,
      description: config.description,
      fields: config.fields,
    });
  }

  return steps;
}

/** Build initial values from config defaults */
function buildInitialValues(config: UserFormConfig): FormResult {
  const initial: FormResult = {};
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

  if (typeof value === 'string' && value) {
    if (validation.minLength && value.length < validation.minLength) {
      return `${field.label}至少需要${validation.minLength}个字符`;
    }
    if (validation.maxLength && value.length > validation.maxLength) {
      return `${field.label}最多${validation.maxLength}个字符`;
    }
    if (validation.pattern) {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        return `${field.label}格式不正确`;
      }
    }
  }

  if (typeof value === 'number') {
    if (validation.min !== undefined && value < validation.min) {
      return `${field.label}最小值为${validation.min}`;
    }
    if (validation.max !== undefined && value > validation.max) {
      return `${field.label}最大值为${validation.max}`;
    }
  }

  if (validation.custom) {
    return validation.custom(value);
  }

  return null;
}
