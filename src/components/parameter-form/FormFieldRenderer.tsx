/**
 * FormFieldRenderer - Reusable field rendering component
 *
 * Extracted from UserFormModal so that both modal and inline card
 * modes can share the same field rendering logic.
 */
import { cn } from '@/lib/utils';
import type {
  FormField,
  TextField,
  NumberField,
  SelectField,
  RadioField,
  CheckboxField,
  DateTimeField,
  ToggleField,
  EditableListField,
} from '@/types/user-form';
import { X, Plus } from 'lucide-react';
import { Minus } from 'lucide-react';

interface FormFieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

export function FormFieldRenderer({ field, value, onChange, error }: FormFieldRendererProps) {
  if (field.hidden || field.type === 'hidden') return null;

  const commonClasses = cn(
    'w-full px-3 py-2 text-[13px] rounded-lg border bg-background',
    'placeholder:text-muted-foreground focus:outline-none focus:ring-2',
    'focus:ring-primary/30 focus:border-primary transition-colors',
    error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : 'border-border'
  );

  switch (field.type) {
    case 'text':
      return renderTextField(field as TextField, value, onChange, commonClasses, error);
    case 'textarea':
      // If textarea has _titledGroupItems, render as titled group instead
      if ((field as any)._titledGroupItems && (field as any)._titledGroupItems.length > 0) {
        return renderTitledGroupField(field as any, value, onChange, error);
      }
      return renderTextArea(field as TextField, value, onChange, commonClasses, error);
    case 'number':
      return renderNumberField(field as NumberField, value, onChange, commonClasses, error);
    case 'select':
    case 'multiselect':
      return renderSelectField(field as SelectField, value, onChange, commonClasses, error);
    case 'radio':
      return renderRadioField(field as RadioField, value, onChange, error);
    case 'checkbox':
      return renderCheckboxField(field as CheckboxField, value, onChange, error);
    case 'date':
    case 'datetime':
    case 'time':
      return renderDateTimeField(field as DateTimeField, value, onChange, commonClasses, error);
    case 'toggle':
      return renderToggleField(field as ToggleField, value, onChange, error);
    case 'editable_list':
      return renderEditableListField(field as EditableListField, value, onChange, error);
    case 'titled_group':
      return renderTitledGroupField(field as any, value, onChange, error);
    default:
      return null;
  }
}

function renderTextField(
  field: TextField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string
) {
  return (
    <div key={field.name}>
      <label htmlFor={field.name} className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <input
        id={field.name}
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
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
}

function renderTextArea(
  field: TextField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string
) {
  return (
    <div key={field.name}>
      <label htmlFor={field.name} className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <textarea
        id={field.name}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
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
}

function renderNumberField(
  field: NumberField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string
) {
  return (
    <div key={field.name}>
      <label htmlFor={field.name} className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <div className="relative">
        {field.prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[13px]">
            {field.prefix}
          </span>
        )}
        <input
          id={field.name}
          type="number"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={field.disabled}
          className={cn(className, field.prefix ? 'pl-8' : '', field.suffix ? 'pr-8' : '')}
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
}

function renderSelectField(
  field: SelectField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string
) {
  const isMulti = field.type === 'multiselect';
  const currentMulti = isMulti && Array.isArray(value) ? (value as unknown[]) : [];

  return (
    <div key={field.name}>
      <label htmlFor={field.name} className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      {isMulti ? (
        <div className="space-y-2">
          {/* Selected tags */}
          {currentMulti.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currentMulti.map((v, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[12px]"
                >
                  {String(v)}
                  <button
                    type="button"
                    onClick={() => onChange(currentMulti.filter((item) => item !== v))}
                    className="hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Add select */}
          <select
            id={field.name}
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              const option = field.options.find((o) => String(o.value) === val);
              const newValue = option?.value ?? val;
              if (!currentMulti.includes(newValue)) {
                onChange([...currentMulti, newValue]);
              }
              e.target.value = '';
            }}
            disabled={field.disabled}
            className={className}
          >
            <option value="">{field.placeholder || '请选择'}…</option>
            {field.options
              .filter((o) => !currentMulti.includes(o.value))
              .map((option) => (
                <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
          </select>
        </div>
      ) : (
        <select
          id={field.name}
          value={String(value ?? '')}
          onChange={(e) => {
            const val = e.target.value;
            const option = field.options.find((o) => String(o.value) === val);
            onChange(option?.value ?? val);
          }}
          disabled={field.disabled}
          className={className}
        >
          {!field.validation?.required && (
            <option value="">{field.placeholder || '请选择'}</option>
          )}
          {field.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

function renderRadioField(
  field: RadioField,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string
) {
  return (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-2">
        {field.label}
      </label>
      <div className={cn('space-y-2', field.layout === 'horizontal' ? 'flex flex-wrap gap-4' : '')}>
        {field.options.map((option) => (
          <label
            key={String(option.value)}
            className={cn(
              'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
              value === option.value
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/50',
              option.disabled ? 'opacity-50 cursor-not-allowed' : ''
            )}
          >
            <input
              type="radio"
              name={field.name}
              value={String(option.value)}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
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
}

function renderCheckboxField(
  field: CheckboxField,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string
) {
  // Single checkbox (boolean)
  if (!field.options || field.options.length === 0) {
    return (
      <div key={field.name}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={field.disabled}
            className="h-4 w-4 text-primary focus:ring-primary rounded"
          />
          <span className="text-[13.5px] font-medium text-foreground">{field.label}</span>
        </label>
        {field.description && !error && (
          <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
        )}
        {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  // Multiple checkboxes
  const currentValue = Array.isArray(value) ? (value as unknown[]) : [];
  return (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-2">
        {field.label}
      </label>
      <div className="space-y-2">
        {field.options.map((option) => (
          <label key={String(option.value)} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={currentValue.includes(option.value)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...currentValue, option.value]);
                } else {
                  onChange(currentValue.filter((v) => v !== option.value));
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
}

function renderDateTimeField(
  field: DateTimeField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string
) {
  const inputType = field.type === 'time' ? 'time' : field.type === 'datetime' ? 'datetime-local' : 'date';
  return (
    <div key={field.name}>
      <label htmlFor={field.name} className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <input
        id={field.name}
        type={inputType}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
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
}

function renderToggleField(
  field: ToggleField,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string
) {
  return (
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
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          disabled={field.disabled}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            value ? 'bg-primary' : 'bg-muted',
            field.disabled ? 'opacity-50 cursor-not-allowed' : ''
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-background transition-transform',
              value ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </label>
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

function renderEditableListField(
  field: EditableListField,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string
) {
  const items = Array.isArray(value) ? (value as string[]) : field.defaultValue ?? [];

  const updateItem = (index: number, newValue: string) => {
    const next = [...items];
    next[index] = newValue;
    onChange(next);
  };

  const removeItem = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    onChange(next);
  };

  const addItem = () => {
    onChange([...items, '']);
  };

  return (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
        {field.label}
      </label>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={field.placeholder || '请输入'}
              disabled={field.disabled}
              className={cn(
                'flex-1 px-3 py-2 text-[13px] rounded-lg border bg-background',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2',
                'focus:ring-primary/30 focus:border-primary transition-colors',
                error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : 'border-border'
              )}
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              disabled={field.disabled}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          disabled={field.disabled}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-border text-[13px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
      </div>
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-1">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

function renderTitledGroupField(
  field: any,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string
) {
  const items = field._titledGroupItems as Array<{
    fieldKey: string;
    label: string;
    description?: string;
    defaultValue: string;
  }> | undefined;

  if (!items || items.length === 0) return null;

  // Parse current value as object
  const parsedValue: Record<string, unknown> = typeof value === 'string' ? JSON.parse(value) : (value as Record<string, unknown>);

  const updateField = (fieldKey: string, newValue: unknown) => {
    const next = { ...parsedValue, [fieldKey]: newValue };
    onChange(JSON.stringify(next));
  };

  return (
    <div key={field.name}>
      <label className="block text-[13.5px] font-medium text-foreground mb-3">
        {field.label}
      </label>
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        {items.map((item, index) => {
          const itemValue = parsedValue[item.fieldKey] ?? item.defaultValue ?? '';
          return (
            <div key={item.fieldKey} className="flex items-center gap-3">
              <span className="w-5 h-5 shrink-0 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">
                {index + 1}
              </span>
              <div className="flex-1">
                <label className="text-[13px] font-medium text-foreground">{item.label}</label>
                {item.description && (
                  <p className="text-[11px] text-muted-foreground">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const num = parseFloat(String(itemValue)) || 0;
                    updateField(item.fieldKey, String(num - 1));
                  }}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="text"
                  value={String(itemValue)}
                  onChange={(e) => updateField(item.fieldKey, e.target.value)}
                  className="w-16 px-2 py-1.5 text-[13px] text-center rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    const num = parseFloat(String(itemValue)) || 0;
                    updateField(item.fieldKey, String(num + 1));
                  }}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {/* Extract unit from label (e.g., "天停发" → "天", "降量区间" → "") */}
                {item.label && (
                  <span className="text-[12px] text-muted-foreground ml-1">
                    {extractUnit(item.label)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {field.description && !error && (
        <p className="text-[11.5px] text-muted-foreground mt-2">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
    </div>
  );
}

function extractUnit(label: string): string {
  // Try to extract unit from label like "天停发" → "天", "连续降量" → "", "降量区间" → ""
  const unitMatch = label.match(/^([天次件%日周月])|天$/);
  return unitMatch ? unitMatch[1] || '天' : '';
}
