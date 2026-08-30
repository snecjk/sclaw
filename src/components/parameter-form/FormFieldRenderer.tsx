/**
 * FormFieldRenderer - Reusable field rendering component
 *
 * Extracted from UserFormModal so that both modal and inline card
 * modes can share the same field rendering logic.
 */
import { cn } from '@/lib/utils';
import {
  parameterFormDockFieldRowClass,
  parameterFormDockIndexBadgeClass,
  parameterFormDockStepperButtonClass,
  parameterFormDockStepperInputClass,
  parameterFormDockStepperShellClass,
} from '@/lib/surfaces';
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
import { X, Plus, Minus } from 'lucide-react';
import { normalizeWorkflowFieldValue } from '@/lib/workflow-form-utils';
import { OptionCardList, splitRuleTags, type OptionCardVariant } from './OptionCardList';

export type FormFieldVariant = OptionCardVariant;

export interface FormFieldRendererProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  /** chat-dock：浮层选项卡专用样式，默认不变（UserFormModal 等复用处） */
  variant?: FormFieldVariant;
}

function isReadOnlyDisplayField(field: FormField): boolean {
  if (field.disabled) return true;
  if (field.type === 'text' || field.type === 'textarea') {
    const desc = field.description ?? '';
    return /仅展示|不可修改|系统预置/.test(desc);
  }
  return false;
}

export function FormFieldRenderer({ field, value, onChange, error, variant = 'default' }: FormFieldRendererProps) {
  if (field.hidden || field.type === 'hidden') return null;

  if (isReadOnlyDisplayField(field) && (field.type === 'text' || field.type === 'textarea')) {
    return renderDisplayField(field, value, error, variant);
  }

  const commonClasses = cn(
    'w-full px-3 py-2 text-[13px] rounded-lg border bg-background',
    'placeholder:text-muted-foreground focus:outline-none focus:ring-2',
    'focus:ring-primary/30 focus:border-primary transition-colors',
    error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : 'border-border'
  );

  switch (field.type) {
    case 'text':
      return renderTextField(field as TextField, value, onChange, commonClasses, error, variant);
    case 'textarea':
      // If textarea has _titledGroupItems, render as titled group instead
      if ((field as any)._titledGroupItems && (field as any)._titledGroupItems.length > 0) {
        return renderTitledGroupField(field as any, value, onChange, error, variant);
      }
      return renderTextArea(field as TextField, value, onChange, commonClasses, error, variant);
    case 'number':
      return renderNumberField(field as NumberField, value, onChange, commonClasses, error, variant);
    case 'select':
    case 'multiselect':
      return renderSelectField(field as SelectField, value, onChange, commonClasses, error, variant);
    case 'radio':
      return renderRadioField(field as RadioField, value, onChange, error, variant);
    case 'checkbox':
      return renderCheckboxField(field as CheckboxField, value, onChange, error, variant);
    case 'date':
    case 'datetime':
    case 'time':
      return renderDateTimeField(field as DateTimeField, value, onChange, commonClasses, error);
    case 'toggle':
      return renderToggleField(field as ToggleField, value, onChange, error);
    case 'editable_list':
      return renderEditableListField(field as EditableListField, value, onChange, error);
    case 'titled_group':
      return renderTitledGroupField(field as any, value, onChange, error, variant);
    default:
      return null;
  }
}

function renderTextField(
  field: TextField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string,
  variant: FormFieldVariant = 'default',
) {
  const isDock = variant === 'chat-dock';
  return (
    <div key={field.name}>
      {!isDock ? (
        <label htmlFor={field.name} className="mb-1.5 block text-[13.5px] font-medium text-foreground">
          {field.label}
        </label>
      ) : null}
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
  error?: string,
  variant: FormFieldVariant = 'default',
) {
  const isDock = variant === 'chat-dock';
  return (
    <div key={field.name}>
      {!isDock ? (
        <label htmlFor={field.name} className="mb-1.5 block text-[13.5px] font-medium text-foreground">
          {field.label}
        </label>
      ) : null}
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

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (min != null && next < min) next = min;
  if (max != null && next > max) next = max;
  return next;
}

function parseNumberInput(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function NumberStepperControl({
  field,
  value,
  onChange,
  error,
}: {
  field: NumberField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const step = field.step ?? 1;
  const numeric = parseNumberInput(value);

  const applyDelta = (delta: number) => {
    if (field.disabled) return;
    const next = clampNumber(numeric + delta, field.min, field.max);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1">
      <div className={parameterFormDockStepperShellClass}>
        <button
          type="button"
          aria-label="减少"
          disabled={field.disabled}
          onClick={() => applyDelta(-step)}
          className={cn('w-[26px] text-sm', parameterFormDockStepperButtonClass)}
        >
          −
        </button>
        <input
          id={field.name}
          type="number"
          value={value === '' || value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={field.disabled}
          className={cn(
            'h-[26px] w-10 border-x',
            parameterFormDockStepperInputClass,
          )}
        />
        <button
          type="button"
          aria-label="增加"
          disabled={field.disabled}
          onClick={() => applyDelta(step)}
          className={cn('w-[26px] border-l border-border text-sm', parameterFormDockStepperButtonClass)}
        >
          +
        </button>
      </div>
      {field.suffix ? (
        <span className="text-xs text-muted-foreground">{field.suffix}</span>
      ) : null}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

function renderNumberField(
  field: NumberField,
  value: unknown,
  onChange: (v: unknown) => void,
  className: string,
  error?: string,
  variant: FormFieldVariant = 'default',
) {
  if (variant === 'chat-dock') {
    return (
      <div key={field.name} className={cn('flex items-center gap-2.5', parameterFormDockFieldRowClass)}>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-[18px] text-foreground">{field.label}</div>
          {field.description ? (
            <p className="text-xs leading-[14px] text-muted-foreground">{field.description}</p>
          ) : null}
        </div>
        <NumberStepperControl field={field} value={value} onChange={onChange} error={error} />
      </div>
    );
  }

  return (
    <div key={field.name}>
      <label htmlFor={field.name} className="mb-1.5 block text-[13.5px] font-medium text-foreground">
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
  _className: string,
  error?: string,
  variant: FormFieldVariant = 'default',
) {
  const isDock = variant === 'chat-dock';
  const isMulti = field.type === 'multiselect';
  const useCards = field.options.length > 0;

  if (useCards) {
    const isDisplay = Boolean(field.disabled) || /仅展示|不可修改|系统预置/.test(field.description ?? '');
    return (
      <div key={field.name}>
        {!isDock ? (
          <FieldLabel label={field.label} description={isDisplay ? undefined : field.description} />
        ) : null}
        <OptionCardList
          options={field.options}
          mode={isDisplay ? 'display' : isMulti ? 'multi' : 'single'}
          value={value}
          onChange={onChange}
          disabled={field.disabled}
          selectionLabel={isMulti ? '已选类型' : '已选'}
          variant={variant}
        />
        {isDisplay && field.description && (
          <p className="mt-2.5 text-[12px] text-[var(--sto-text-tertiary)]">{field.description}</p>
        )}
        {error && <p className="text-[12px] text-destructive mt-1.5">{error}</p>}
      </div>
    );
  }

  return (
    <div key={field.name}>
      <FieldLabel label={field.label} description={field.description} />
      <select
        id={field.name}
        value={String(value ?? '')}
        onChange={(e) => {
          const val = e.target.value;
          const option = field.options.find((o) => String(o.value) === val);
          onChange(option?.value ?? val);
        }}
        disabled={field.disabled}
        className={_className}
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
      {error && <p className="text-[12px] text-destructive mt-1.5">{error}</p>}
    </div>
  );
}

function renderRadioField(
  field: RadioField,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string,
  variant: FormFieldVariant = 'default',
) {
  const isDock = variant === 'chat-dock';
  return (
    <div key={field.name}>
      {!isDock ? <FieldLabel label={field.label} description={field.description} /> : null}
      <OptionCardList
        options={field.options}
        mode="single"
        value={value}
        onChange={onChange}
        disabled={field.disabled}
        variant={variant}
      />
      {error && <p className="text-[12px] text-destructive mt-1.5">{error}</p>}
    </div>
  );
}

function renderCheckboxField(
  field: CheckboxField,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string,
  variant: FormFieldVariant = 'default',
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

  return (
    <div key={field.name}>
      <FieldLabel label={field.label} description={field.description} />
      <OptionCardList
        options={field.options}
        mode="multi"
        value={value}
        onChange={onChange}
        disabled={field.disabled}
        selectionLabel="已选类型"
        variant={variant}
      />
      {error && <p className="text-[12px] text-destructive mt-1.5">{error}</p>}
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

function isNumericTitledGroupItem(value: unknown): boolean {
  const str = String(value ?? '').trim();
  if (!str) return true;
  if (/[；;%≥≤<>]/.test(str)) return false;
  return !Number.isNaN(Number(str));
}

function renderTitledGroupField(
  field: any,
  value: unknown,
  onChange: (v: unknown) => void,
  error?: string,
  variant: FormFieldVariant = 'default',
) {
  const isDock = variant === 'chat-dock';
  const items = field._titledGroupItems as Array<{
    fieldKey: string;
    label: string;
    description?: string;
    defaultValue: string;
  }> | undefined;

  if (!items || items.length === 0) return null;

  const parsedValue = normalizeWorkflowFieldValue(value);
  const groupRecord =
    typeof parsedValue === 'object' && parsedValue !== null && !Array.isArray(parsedValue)
      ? (parsedValue as Record<string, unknown>)
      : {};

  const readOnly =
    field.disabled ||
    /仅展示|不可修改|系统预置/.test(field.description ?? '') ||
    items.every((item) => !isNumericTitledGroupItem(item.defaultValue));

  if (readOnly) {
    return (
      <div key={field.name} className="space-y-3">
        {field.label && (
          <FieldLabel label={field.label} description={field.description} />
        )}
        {items.map((item) => {
          const itemValue = groupRecord[item.fieldKey] ?? item.defaultValue ?? '';
          const tags = splitRuleTags(itemValue);
          return (
            <div
              key={item.fieldKey}
              className="rounded-xl border border-[var(--sto-border-default)] bg-[var(--sto-form-inset-background)] px-4 py-3.5"
            >
              <h4 className="text-[14px] font-semibold text-[var(--sto-text-primary)]">{item.label}</h4>
              {item.description && (
                <p className="mt-0.5 text-[12px] text-[var(--sto-text-tertiary)]">{item.description}</p>
              )}
              {tags.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex rounded-lg border border-[var(--sto-border-default)] bg-[var(--sto-card-panel-bg)] px-2.5 py-1 text-[12px] leading-snug text-[var(--sto-text-secondary)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[13px] text-[var(--sto-text-secondary)]">{String(itemValue)}</p>
              )}
            </div>
          );
        })}
        {error && <p className="text-[12px] text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  const updateField = (fieldKey: string, newValue: unknown) => {
    const next = { ...groupRecord, [fieldKey]: newValue };
    onChange(JSON.stringify(next));
  };

  return (
    <div key={field.name}>
      {!isDock ? <FieldLabel label={field.label} description={field.description} /> : null}
      <div
        className={cn(
          isDock
            ? 'flex flex-wrap gap-3'
            : 'space-y-3 rounded-xl border border-[var(--sto-border-default)] bg-[var(--sto-card-panel-bg)] p-4',
        )}
      >
        {items.map((item, index) => {
          const itemValue = groupRecord[item.fieldKey] ?? item.defaultValue ?? '';
          const isRangePair = /区间|range/i.test(item.label) || /[~～]/.test(String(itemValue));
          return (
            <div
              key={item.fieldKey}
              className={cn(
                isDock
                  ? cn(
                      'flex min-w-[calc(50%-6px)] flex-1 basis-[calc(50%-6px)] items-center gap-2.5',
                      parameterFormDockFieldRowClass,
                    )
                  : 'flex items-center gap-3',
              )}
            >
              <span
                className={cn(
                  isDock
                    ? parameterFormDockIndexBadgeClass
                    : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--sto-brand-6)] text-[11px] font-bold text-white',
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <label className={cn('font-medium text-foreground', isDock ? 'text-sm leading-[18px]' : 'text-[13px] font-semibold text-[var(--sto-text-primary)]')}>
                  {item.label}
                </label>
                {item.description && (
                  <p className={cn(isDock ? 'text-xs leading-[14px] text-muted-foreground' : 'text-[12px] text-[var(--sto-text-tertiary)]')}>
                    {item.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {isRangePair ? (
                  <RangeInlineInputs
                    value={String(itemValue)}
                    onChange={(next) => updateField(item.fieldKey, next)}
                    suffix={extractUnit(item.label)}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label="减少"
                      onClick={() => {
                        const num = parseFloat(String(itemValue)) || 0;
                        updateField(item.fieldKey, String(num - 1));
                      }}
                      className={cn(
                        parameterFormDockStepperButtonClass,
                        isDock ? 'h-[26px] w-[26px] rounded-md border border-border' : 'h-8 w-8 rounded-lg border border-[var(--sto-form-control-border)] bg-[var(--sto-form-control-background)]',
                      )}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="text"
                      value={String(itemValue)}
                      onChange={(e) => updateField(item.fieldKey, e.target.value)}
                      className={cn(
                        parameterFormDockStepperInputClass,
                        isDock ? 'h-[26px] w-10 rounded-md border' : 'w-16 rounded-lg border border-[var(--sto-form-control-border)] px-2 py-1.5',
                      )}
                    />
                    <button
                      type="button"
                      aria-label="增加"
                      onClick={() => {
                        const num = parseFloat(String(itemValue)) || 0;
                        updateField(item.fieldKey, String(num + 1));
                      }}
                      className={cn(
                        parameterFormDockStepperButtonClass,
                        isDock ? 'h-[26px] w-[26px] rounded-md border border-border' : 'h-8 w-8 rounded-lg border border-[var(--sto-form-control-border)] bg-[var(--sto-form-control-background)]',
                      )}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </>
                )}
                {item.label && !isRangePair ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {extractUnit(item.label)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

/** 区间输入：20 ~ 50 %（MasterGo 8:08579） */
function RangeInlineInputs({
  value,
  onChange,
  suffix = '%',
}: {
  value: string;
  onChange: (next: string) => void;
  suffix?: string;
}) {
  const parts = value.split(/[~～]/).map((s) => s.trim());
  const low = parts[0] ?? '';
  const high = parts[1] ?? '';

  const update = (nextLow: string, nextHigh: string) => {
    onChange(`${nextLow} ~ ${nextHigh}`.trim());
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={low}
        onChange={(e) => update(e.target.value, high)}
        className={cn('h-[26px] w-10 rounded-md border px-1', parameterFormDockStepperInputClass)}
      />
      <span className="text-xs text-muted-foreground">~</span>
      <input
        type="text"
        value={high}
        onChange={(e) => update(low, e.target.value)}
        className={cn('h-[26px] w-10 rounded-md border px-1', parameterFormDockStepperInputClass)}
      />
      {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function FieldLabel({ label, description }: { label: string; description?: string }) {
  return (
    <div className="mb-2.5">
      <label className="block text-[14px] font-semibold text-[var(--sto-text-primary)]">{label}</label>
      {description && (
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--sto-text-tertiary)]">{description}</p>
      )}
    </div>
  );
}

function renderDisplayField(field: FormField, value: unknown, error?: string, variant: FormFieldVariant = 'default') {
  const isDock = variant === 'chat-dock';
  const displayValue =
    value !== undefined && value !== null && value !== ''
      ? String(value)
      : field.defaultValue !== undefined
        ? String(field.defaultValue)
        : '—';

  return (
    <div key={field.name}>
      <div
        className={cn(
          isDock
            ? cn('rounded-[10px] border border-border bg-muted/30 px-3 py-2')
            : 'rounded-xl border border-[var(--sto-border-default)] bg-[var(--sto-form-inset-background)] px-4 py-3.5',
        )}
      >
        <div className={cn('text-[14px] font-semibold', isDock ? 'text-foreground' : 'text-[var(--sto-text-primary)]')}>{field.label}</div>
        <div className={cn('mt-1 text-[13px]', isDock ? 'text-muted-foreground' : 'text-[var(--sto-text-secondary)]')}>{displayValue}</div>
      </div>
      {field.description && (
        <p className="mt-2 text-[12px] text-[var(--sto-text-tertiary)]">{field.description}</p>
      )}
      {error && <p className="text-[12px] text-destructive mt-1.5">{error}</p>}
    </div>
  );
}

function extractUnit(label: string): string {
  // Try to extract unit from label like "天停发" → "天", "连续降量" → "", "降量区间" → ""
  const unitMatch = label.match(/^([天次件%日周月])|天$/);
  return unitMatch ? unitMatch[1] || '天' : '';
}
