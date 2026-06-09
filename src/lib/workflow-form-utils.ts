/**
 * Workflow Form Utilities
 *
 * Maps workflow schema.fields to UserFormConfig for dynamic form rendering.
 * Aligned with Agent Workflow Client API v1.
 */
import type { UserFormConfig, FormField } from '@/types/user-form';
import type { WorkflowSchemaField, WorkflowSchema, WorkflowStartupPayload } from '@/types/workflow';
import type { WorkflowContextBlock } from '@/stores/chat/types';

const COMPONENT_MAPPING: Record<string, FormField['type']> = {
  single_select: 'select',
  multi_select: 'multiselect',
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  date: 'date',
  datetime: 'datetime',
  time: 'time',
  toggle: 'toggle',
  radio: 'radio',
  checkbox: 'checkbox',
  date_range: 'text',
  editable_list: 'editable_list',
};

function mapComponentToType(component: string): FormField['type'] {
  return COMPONENT_MAPPING[component] ?? 'text';
}

function mapField(schemaField: WorkflowSchemaField): FormField {
  const name = schemaField.key;
  const label = schemaField.label;
  const description = schemaField.description;
  // Serialize object defaultValues to string for display
  let defaultValue = schemaField.defaultValue;
  if (defaultValue !== undefined && defaultValue !== null && typeof defaultValue === 'object') {
    defaultValue = JSON.stringify(defaultValue);
  }
  const validation = schemaField.required ? { required: true } : undefined;

  const type = mapComponentToType(schemaField.component);
  const readOnlyHint = /仅展示|不可修改|系统预置/.test(description ?? '');

  switch (type) {
    case 'select':
      return {
        name, label, description, defaultValue, validation,
        type: 'select',
        disabled: readOnlyHint,
        options: schemaField.options?.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
        })) ?? [],
      };
    case 'multiselect':
      return {
        name, label, description, defaultValue, validation,
        type: 'multiselect',
        disabled: readOnlyHint,
        options: schemaField.options?.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
        })) ?? [],
      };
    case 'number':
      return { name, label, description, defaultValue, validation, type: 'number' };
    case 'date':
      return { name, label, description, defaultValue, validation, type: 'date' };
    case 'datetime':
      return { name, label, description, defaultValue, validation, type: 'datetime' };
    case 'time':
      return { name, label, description, defaultValue, validation, type: 'time' };
    case 'toggle':
      return { name, label, description, defaultValue, validation, type: 'toggle' };
    case 'radio':
      return {
        name, label, description, defaultValue, validation,
        type: 'radio',
        options: schemaField.options?.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
        })) ?? [],
      };
    case 'checkbox':
      return { name, label, description, defaultValue, validation, type: 'checkbox' };
    case 'hidden':
      return { name, label, description, defaultValue: defaultValue as string | number | boolean, validation, type: 'hidden' };
    case 'titled_group':
      // Titled group: expand each item in schemaField.items as a separate field
      const items = (schemaField as any).items as any[] | undefined;
      if (!items || items.length === 0) {
        return { name, label, description, defaultValue: JSON.stringify(defaultValue ?? {}), validation, type: 'textarea' as const };
      }
      return {
        name,
        label,
        description,
        defaultValue: JSON.stringify(defaultValue ?? {}),
        validation,
        type: 'titled_group' as const,
        _titledGroupItems: items.map((item: any) => ({
          fieldKey: item.fieldKey,
          label: item.label,
          description: item.description,
          defaultValue: item.defaultValue,
        })),
      } as any;
    case 'text':
    case 'textarea':
    default:
      // Handle titled_group as a special case in default fallback
      if (schemaField.component === 'titled_group') {
        const items = (schemaField as any).items as any[] | undefined;
        if (items && items.length > 0) {
          return {
            name,
            label,
            description,
            defaultValue: JSON.stringify(defaultValue ?? {}),
            validation,
            type: 'textarea' as const,
            _titledGroupItems: items.map((item: any) => ({
              fieldKey: item.fieldKey,
              label: item.label,
              description: item.description,
              defaultValue: item.defaultValue,
            })),
          } as any;
        }
      }
      return { name, label, description, defaultValue, validation, type: type === 'textarea' ? 'textarea' : 'text' };
  }
}

/**
 * Build UserFormConfig from startup schema and user input text
 */
export function buildWorkflowFormConfig(
  schema: WorkflowSchema,
  userInputText: string,
  defaultValues?: Record<string, unknown>,
): UserFormConfig {
  // Only include fields from confirm-mode steps
  const confirmStepIds = new Set(
    schema.steps.filter((s) => s.mode === 'confirm').map((s) => s.id),
  );

  const confirmFields = schema.fields
    .filter((f) => confirmStepIds.has(f.group))
    .sort((a, b) => a.order - b.order);

  const fields = confirmFields.map((f) => {
    const mapped = mapField(f);

    // Override defaultValue with preset/default values if available
    if (defaultValues && f.key in defaultValues) {
      mapped.defaultValue = defaultValues[f.key];
    }

    // Attempt to extract value from user input text if extractable
    if (f.extractable && f.extractPattern && userInputText) {
      try {
        const match = userInputText.match(new RegExp(f.extractPattern));
        if (match) {
          mapped.defaultValue = match[1] ?? match[0];
        }
      } catch {
        // Invalid regex, ignore extraction
      }
    }

    // Add pattern validation for date_range mapped to text
    if (f.component === 'date_range' && mapped.type === 'text') {
      mapped.validation = {
        ...mapped.validation,
        pattern: '^\\d{4}-\\d{2}-\\d{2}~\\d{4}-\\d{2}-\\d{2}$',
      };
      if (!mapped.description?.includes('格式')) {
        mapped.description = [mapped.description, '格式：YYYY-MM-DD~YYYY-MM-DD'].filter(Boolean).join('，');
      }
    }

    return mapped;
  });

  // Build wizard steps from confirm-mode step groups
  const steps: import('@/types/user-form').FormStep[] = [];
  const stepMap = new Map<string, import('@/types/user-form').FormStep>();
  for (const f of confirmFields) {
    if (!stepMap.has(f.group)) {
      const stepInfo = schema.steps.find((s) => s.id === f.group);
      stepMap.set(f.group, {
        id: f.group,
        title: f.groupTitle ?? stepInfo?.title ?? f.label,
        description: stepInfo ? `请确认${stepInfo.title}` : undefined,
        fieldNames: [],
      });
    }
    stepMap.get(f.group)!.fieldNames!.push(f.key);
  }
  for (const step of schema.steps) {
    if (confirmStepIds.has(step.id) && stepMap.has(step.id)) {
      steps.push(stepMap.get(step.id)!);
    }
  }

  return {
    id: `workflow-${schema.nodeId}-${Date.now()}`,
    title: schema.steps.find((s) => confirmStepIds.has(s.id))?.title ?? '工作流参数',
    description: '请填写以下工作流参数',
    fields,
    steps: steps.length > 0 ? steps : undefined,
    confirmLabel: '确认并执行',
    nextLabel: '继续',
    prevLabel: '上一步',
    allowCancel: false,
  };
}

/** Detect objects accidentally created by spreading a string (`{..."abc"}` → {0:"a",1:"b"}). */
function isCharIndexObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length < 2) return false;
  return keys.every((k, i) => k === String(i));
}

/** Normalize form values that may be JSON strings or corrupted char-index objects. */
export function normalizeWorkflowFieldValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return value;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        if (!Array.isArray(parsed) && isCharIndexObject(parsed as Record<string, unknown>)) {
          const reconstructed = Object.keys(parsed)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => String((parsed as Record<string, unknown>)[k]))
            .join('');
          try {
            return JSON.parse(reconstructed);
          } catch {
            return reconstructed;
          }
        }
        return parsed;
      }
    } catch {
      // plain text
    }
    return value;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (isCharIndexObject(obj)) {
      const reconstructed = Object.keys(obj)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => String(obj[k]))
        .join('');
      try {
        return JSON.parse(reconstructed);
      } catch {
        return reconstructed;
      }
    }
  }
  return value;
}

function parseWorkflowObjectValue(value: unknown): Record<string, unknown> | null {
  const normalized = normalizeWorkflowFieldValue(value);
  if (typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)) {
    return normalized as Record<string, unknown>;
  }
  if (typeof normalized === 'string') {
    const trimmed = normalized.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // keep as plain string
      }
    }
  }
  return null;
}

/** Expand object / titled_group values into readable sub-lines. */
export function formatWorkflowObjectLines(
  value: unknown,
  field?: WorkflowSchemaField,
): string[] {
  const record = parseWorkflowObjectValue(value);
  if (!record) return [];

  const items = field?.items;
  if (items?.length) {
    return items
      .map((item) => {
        const v = record[item.fieldKey];
        if (v === undefined || v === null || v === '') return null;
        const unit = item.description ? `（${item.description}）` : '';
        return `${item.label}：${v}${unit}`;
      })
      .filter((line): line is string => Boolean(line));
  }

  return Object.entries(record)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}：${v}`);
}

/** Human-readable display for a single workflow field value in chat summaries. */
export function formatWorkflowValueForDisplay(
  value: unknown,
  field?: WorkflowSchemaField,
): string {
  if (value === undefined || value === null || value === '') return '';

  const objectLines = formatWorkflowObjectLines(value, field);
  if (objectLines.length > 0) {
    return objectLines.join('；');
  }

  const normalized = normalizeWorkflowFieldValue(value);

  if (Array.isArray(normalized)) {
    if (field?.options?.length) {
      return normalized
        .map((v) => {
          const opt = field.options!.find((o) => String(o.value) === String(v));
          return opt?.label ?? String(v);
        })
        .join('、');
    }
    return normalized.map(String).join('、');
  }

  if (field?.options?.length) {
    const opt = field.options.find((o) => String(o.value) === String(normalized));
    if (opt) return opt.label;
  }

  const text = String(normalized);
  if (text.startsWith('{') && text.includes(':')) return '';
  return text;
}

/** Build user-facing summary after parameter form submission. */
export function buildWorkflowValuesSummary(
  schema: WorkflowSchema,
  values: Record<string, unknown>,
): string {
  const confirmStepIds = new Set(
    schema.steps.filter((s) => s.mode === 'confirm').map((s) => s.id),
  );
  const fields = schema.fields
    .filter((f) => confirmStepIds.has(f.group))
    .sort((a, b) => a.order - b.order);

  const lines: string[] = [];
  for (const field of fields) {
    const val = values[field.key];
    if (val === undefined || val === null || val === '') continue;

    const objectLines = formatWorkflowObjectLines(val, field);
    if (objectLines.length > 1) {
      lines.push(`${field.label}：`);
      for (const sub of objectLines) {
        lines.push(`  · ${sub}`);
      }
      continue;
    }

    const display = formatWorkflowValueForDisplay(val, field);
    if (!display) continue;
    lines.push(`${field.label}：${display}`);
  }

  if (lines.length === 0) return '参数已确认';
  return `已确认以下参数：\n${lines.map((l) => (l.startsWith('  ·') ? l : `- ${l}`)).join('\n')}`;
}

/**
 * Build workflow startup payload from form response values and schema hash
 * Aligned with Agent Workflow Client API v1.
 */
export function buildStartupPreset(
  formValues: Record<string, unknown>,
  schemaHash: string,
): WorkflowStartupPayload {
  return {
    schemaHash,
    values: formValues,
  };
}

/**
 * Build workflow values from form response, handling special cases like custom date_range
 */
export function buildWorkflowValues(
  formValues: Record<string, unknown>,
  schemaFields: WorkflowSchemaField[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of schemaFields) {
    const value = formValues[field.key];
    if (value !== undefined) {
      result[field.key] = value;
    }
  }

  return result;
}

/**
 * Build natural language guidance text for AI from workflow schema.
 * This text is injected into the conversation context so the AI can guide
 * the user to confirm parameters naturally.
 */
export function buildWorkflowGuidanceText(
  templateName: string,
  schema: WorkflowSchema,
): string {
  const confirmStepIds = new Set(
    schema.steps.filter((s) => s.mode === 'confirm').map((s) => s.id),
  );

  const confirmFields = schema.fields
    .filter((f) => confirmStepIds.has(f.group))
    .sort((a, b) => a.order - b.order);

  const lines: string[] = [
    `接下来运行【${templateName}】工作流，执行前请先确认以下参数：`,
    '',
  ];

  for (let i = 0; i < confirmFields.length; i++) {
    const f = confirmFields[i];
    const required = f.required ? '（必填）' : '（可选）';
    lines.push(`${i + 1}. **${f.label}** ${required}`);
    if (f.description) {
      lines.push(`   ${f.description}`);
    }
    if (f.options && f.options.length > 0) {
      const opts = f.options.map((o) => `${o.label}(${o.value})`).join('、');
      lines.push(`   可选值：${opts}`);
    }
    if (f.defaultValue !== undefined) {
      lines.push(`   默认值：${JSON.stringify(f.defaultValue)}`);
    }
    lines.push('');
  }

  lines.push('请逐项确认或修改上述参数。');

  return lines.join('\n');
}

/**
 * Build a compact schema summary suitable for hidden context injection.
 */
export function buildWorkflowContextSummary(
  templateId: string,
  templateName: string,
  schemaHash: string,
  schema: WorkflowSchema,
): WorkflowContextBlock {
  const confirmStepIds = new Set(
    schema.steps.filter((s) => s.mode === 'confirm').map((s) => s.id),
  );

  const confirmFields = schema.fields
    .filter((f) => confirmStepIds.has(f.group))
    .sort((a, b) => a.order - b.order);

  const fieldsSummary = confirmFields.map((f) => ({
    key: f.key,
    label: f.label,
    component: f.component,
    required: f.required,
    options: f.options?.map((o) => ({ value: o.value, label: o.label })),
    defaultValue: f.defaultValue,
  }));

  return {
    type: 'workflow_context',
    templateId,
    templateName,
    schemaHash,
    fields: fieldsSummary,
  };
}
