/**
 * UserFormModal - Dynamic form modal component
 * 
 * Renders a modal with dynamic form fields based on the provided configuration.
 * Supports various field types: text, number, select, radio, checkbox, date, toggle, etc.
 */
import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FormFieldRenderer } from '@/components/parameter-form/FormFieldRenderer';
import { isEmptyFormValue } from '@/lib/workflow-form-utils';
import type {
  UserFormConfig,
  FormField,
  FormResult,
} from '@/types/user-form';

interface UserFormModalProps {
  config: UserFormConfig | null;
  open: boolean;
  onSubmit: (values: FormResult) => void | Promise<void>;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}

export function UserFormModal({
  config,
  open,
  onSubmit,
  onCancel,
  onError,
}: UserFormModalProps) {
  const [values, setValues] = useState<FormResult>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Initialize values when config changes
  useEffect(() => {
    if (config) {
      const initialValues: FormResult = {};
      for (const field of config.fields) {
        if (field.defaultValue !== undefined) {
          initialValues[field.name] = field.defaultValue;
        } else if (field.type === 'checkbox' && !field.options) {
          initialValues[field.name] = false;
        } else if (field.type === 'multiselect') {
          initialValues[field.name] = [];
        }
      }
      setValues(initialValues);
      setErrors({});
      setSubmitting(false);
    }
  }, [config]);

  // Focus trap
  useEffect(() => {
    if (open && modalRef.current) {
      const focusable = modalRef.current.querySelector<HTMLElement>(
        'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }
  }, [open]);

  if (!open || !config) return null;

  const {
    title,
    description,
    fields,
    layout,
    confirmLabel = '确认',
    cancelLabel = '取消',
    allowCancel = true,
    width = 'md',
  } = config;

  const widthClass = typeof width === 'number' 
    ? { width: `${width}px` }
    : {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
      }[width] || 'max-w-lg';

  const validateField = (field: FormField, value: unknown): string | null => {
    const validation = field.validation;
    if (!validation) return null;

    if (validation.required) {
      if (isEmptyFormValue(value)) {
        if (
          field.type === 'multiselect'
          || field.type === 'checkbox'
          || (field.type === 'select' && 'options' in field && (field.options?.length ?? 0) > 1)
          || field.type === 'radio'
        ) {
          return `${field.label}至少选择一个选项`;
        }
        return `${field.label}是必填项`;
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
  };

  const validateAll = (): boolean => {
    const newErrors: Record<string, string> = {};
    let isValid = true;

    for (const field of fields) {
      if (field.hidden) continue;
      const error = validateField(field, values[field.name]);
      if (error) {
        newErrors[field.name] = error;
        isValid = false;
      }
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async () => {
    if (!validateAll()) return;

    setSubmitting(true);
    try {
      const result = onSubmit(values);
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      if (onError) {
        onError(error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (!allowCancel) return;
    onCancel();
  };

  const updateValue = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const renderField = (field: FormField) => {
    const error = errors[field.name];
    return (
      <FormFieldRenderer
        key={field.name}
        field={field}
        value={values[field.name]}
        onChange={(v) => updateValue(field.name, v)}
        error={error}
      />
    );
  };



  // Grid layout for fields
  const gridClass = layout?.columns
    ? { 1: 'grid-cols-1', 2: 'grid-cols-1 md:grid-cols-2', 3: 'grid-cols-1 md:grid-cols-3' }[layout.columns]
    : 'grid-cols-1';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4 overflow-y-auto"
      onClick={handleCancel}
    >
      <div
        ref={modalRef}
        className={cn('w-full bg-background rounded-2xl border border-border shadow-2xl overflow-hidden my-8', widthClass)}
        onClick={(e) => e.stopPropagation()}
        style={typeof width === 'number' ? { maxWidth: width } : undefined}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-2 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            {description && (
              <p className="text-[13px] text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={!allowCancel}
            className={cn(
              'p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors -mr-1 -mt-1',
              !allowCancel && 'opacity-30 cursor-not-allowed'
            )}
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Fields */}
        <div className={cn('px-6 py-4 space-y-5', gridClass)}>
          {fields.map(renderField)}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
          {allowCancel && (
            <Button variant="outline" onClick={handleCancel} className="rounded-lg px-5 h-9 text-[13px]">
              {cancelLabel}
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg px-5 h-9 text-[13px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                提交中…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
