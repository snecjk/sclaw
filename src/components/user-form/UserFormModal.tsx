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
import type {
  UserFormConfig,
  FormField,
  FormResult,
  TextField,
  NumberField,
  SelectField,
  RadioField,
  CheckboxField,
  DateTimeField,
  ToggleField,
  HiddenField,
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
    if (field.hidden) return null;

    const error = errors[field.name];
    const commonClasses = cn(
      'w-full px-3 py-2 text-[13px] rounded-lg border bg-background',
      'placeholder:text-muted-foreground focus:outline-none focus:ring-2',
      'focus:ring-primary/30 focus:border-primary transition-colors',
      error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : 'border-border'
    );

    switch (field.type) {
      case 'text':
        return renderTextField(field as TextField, commonClasses, error);
      case 'textarea':
        return renderTextArea(field as TextField, commonClasses, error);
      case 'number':
        return renderNumberField(field as NumberField, commonClasses, error);
      case 'select':
      case 'multiselect':
        return renderSelectField(field as SelectField, commonClasses, error);
      case 'radio':
        return renderRadioField(field as RadioField, error);
      case 'checkbox':
        return renderCheckboxField(field as CheckboxField, error);
      case 'date':
      case 'datetime':
      case 'time':
        return renderDateTimeField(field as DateTimeField, commonClasses, error);
      case 'toggle':
        return renderToggleField(field as ToggleField, error);
      default:
        return null;
    }
  };

  const renderTextField = (field: TextField, className: string, error?: string) => (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <input
        type="text"
        value={String(values[field.name] ?? '')}
        onChange={(e) => updateValue(field.name, e.target.value)}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        disabled={field.disabled}
        className={className}
      />
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );

  const renderTextArea = (field: TextField, className: string, error?: string) => (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <textarea
        value={String(values[field.name] ?? '')}
        onChange={(e) => updateValue(field.name, e.target.value)}
        placeholder={field.placeholder}
        rows={field.rows ?? 4}
        maxLength={field.maxLength}
        disabled={field.disabled}
        className={cn(className, 'resize-none leading-relaxed')}
      />
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );

  const renderNumberField = (field: NumberField, className: string, error?: string) => (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <div className="relative">
        {field.prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">
            {field.prefix}
          </span>
        )}
        <input
          type="number"
          value={String(values[field.name] ?? '')}
          onChange={(e) => updateValue(field.name, e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={field.disabled}
          className={cn(
            className,
            field.prefix ? 'pl-8' : '',
            field.suffix ? 'pr-8' : ''
          )}
        />
        {field.suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">
            {field.suffix}
          </span>
        )}
      </div>
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );

  const renderSelectField = (field: SelectField, className: string, error?: string) => (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <select
        value={String(values[field.name] ?? '')}
        onChange={(e) => {
          const val = e.target.value;
          if (field.type === 'multiselect') {
            const current = Array.isArray(values[field.name]) ? (values[field.name] as unknown[]) : [];
            if (val) {
              try {
                const newValue = JSON.parse(val);
                if (!current.includes(newValue)) {
                  updateValue(field.name, [...current, newValue]);
                }
              } catch {
                // ignore parse error
              }
            }
          } else {
            // Find the actual value from options
            const option = field.options.find((o) => String(o.value) === val);
            updateValue(field.name, option?.value ?? val);
          }
        }}
        disabled={field.disabled}
        className={className}
        multiple={field.type === 'multiselect'}
      >
        {!field.validation?.required && (
          <option value="">{field.placeholder || '请选择'}</option>
        )}
        {field.options.map((option) => (
          <option
            key={String(option.value)}
            value={String(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );

  const renderRadioField = (field: RadioField, error?: string) => (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-2">
        {field.label}
      </label>
      <div className={cn(
        'space-y-2',
        field.layout === 'horizontal' ? 'flex flex-wrap gap-4' : ''
      )}>
        {field.options.map((option) => (
          <label
            key={String(option.value)}
            className={cn(
              'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
              values[field.name] === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/50',
              option.disabled ? 'opacity-50 cursor-not-allowed' : ''
            )}
          >
            <input
              type="radio"
              name={field.name}
              value={String(option.value)}
              checked={values[field.name] === option.value}
              onChange={() => updateValue(field.name, option.value)}
              disabled={option.disabled}
              className="h-4 w-4 text-primary focus:ring-primary"
            />
            <span className="text-[13px] text-foreground">{option.label}</span>
            {option.description && (
              <span className="text-[11px] text-muted-foreground">{option.description}</span>
            )}
          </label>
        ))}
      </div>
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );

  const renderCheckboxField = (field: CheckboxField, error?: string) => {
    // Single checkbox (boolean)
    if (!field.options || field.options.length === 0) {
      return (
        <div key={field.name}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(values[field.name])}
              onChange={(e) => updateValue(field.name, e.target.checked)}
              disabled={field.disabled}
              className="h-4 w-4 text-primary focus:ring-primary rounded"
            />
            <span className="text-[13.5px] font-medium text-foreground">
              {field.label}
            </span>
          </label>
          {field.description && !error && (
            <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
          )}
          {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
        </div>
      );
    }

    // Multiple checkboxes
    const currentValue = Array.isArray(values[field.name]) ? (values[field.name] as unknown[]) : [];
  return (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-2">
        {field.label}
      </label>
      <div className="space-y-2">
        {field.options.map((option) => (
          <label
            key={String(option.value)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={currentValue.includes(option.value)}
              onChange={(e) => {
                if (e.target.checked) {
                  updateValue(field.name, [...currentValue, option.value]);
                } else {
                  updateValue(
                    field.name,
                    currentValue.filter((v) => v !== option.value)
                  );
                }
              }}
              disabled={option.disabled}
              className="h-4 w-4 text-primary focus:ring-primary rounded"
            />
            <span className="text-[13px] text-foreground">{option.label}</span>
            {option.description && (
              <span className="text-[11px] text-muted-foreground">{option.description}</span>
            )}
          </label>
        ))}
      </div>
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
    );
  };

  const renderDateTimeField = (field: DateTimeField, className: string, error?: string) => {
    const inputType = field.type === 'time' ? 'time' : field.type === 'datetime' ? 'datetime-local' : 'date';
    return (
      <div key={field.name}>
        <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
          {field.label}
        </label>
        <input
          type={inputType}
          value={String(values[field.name] ?? '')}
          onChange={(e) => updateValue(field.name, e.target.value)}
          min={field.minDate}
          max={field.maxDate}
          disabled={field.disabled}
          className={className}
        />
        {field.description && !error && (
          <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
        )}
        {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
      </div>
    );
  };

  const renderToggleField = (field: ToggleField, error?: string) => (
    <div key={field.name}>
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <span className="text-[13.5px] font-medium text-foreground">{field.label}</span>
          {field.description && !error && (
            <p className="text-[11.5px] text-muted-foreground mt-0.5">{field.description}</p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(values[field.name])}
          onClick={() => updateValue(field.name, !values[field.name])}
          disabled={field.disabled}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            values[field.name] ? 'bg-primary' : 'bg-muted',
            field.disabled ? 'opacity-50 cursor-not-allowed' : ''
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-background transition-transform',
              values[field.name] ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </label>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );

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
