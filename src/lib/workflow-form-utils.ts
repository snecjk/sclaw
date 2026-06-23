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

export interface BuildWorkflowFormConfigOptions {
  templateId?: string;
  schemaHash?: string;
}

/** Stable formId for workflow parameter forms (one per template). */
export function buildWorkflowFormId(templateId: string): string {
  return `workflow-form-${templateId}`;
}

const formConfigCache = new Map<string, UserFormConfig>();

function formConfigCacheKey(
  schema: WorkflowSchema,
  userInputText: string,
  defaultValues: Record<string, unknown> | undefined,
  options?: BuildWorkflowFormConfigOptions,
): string {
  const templateKey = options?.templateId ?? schema.nodeId;
  const hashKey = options?.schemaHash ?? '';
  const defaultsKey = defaultValues ? JSON.stringify(defaultValues) : '';
  return `${templateKey}:${hashKey}:${userInputText}:${defaultsKey}`;
}

/** Clear cached form configs (tests or schema refresh). */
export function clearWorkflowFormConfigCache(): void {
  formConfigCache.clear();
}

/**
 * Build UserFormConfig from startup schema and user input text
 */
export function buildWorkflowFormConfig(
  schema: WorkflowSchema,
  userInputText: string,
  defaultValues?: Record<string, unknown>,
  options?: BuildWorkflowFormConfigOptions,
): UserFormConfig {
  const cacheKey = formConfigCacheKey(schema, userInputText, defaultValues, options);
  const cached = formConfigCache.get(cacheKey);
  if (cached) return cached;
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

  const stableId = `workflow-${options?.templateId ?? schema.nodeId}-${options?.schemaHash ?? 'default'}`;
  const config: UserFormConfig = {
    id: stableId,
    title: schema.steps.find((s) => confirmStepIds.has(s.id))?.title ?? '工作流参数',
    description: '请填写以下工作流参数',
    fields,
    steps: steps.length > 0 ? steps : undefined,
    confirmLabel: '确认并执行',
    nextLabel: '继续',
    prevLabel: '上一步',
    allowCancel: false,
  };
  formConfigCache.set(cacheKey, config);
  return config;
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

/** Whether a form field value should be treated as empty for required validation. */
export function isEmptyFormValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;

  const normalized = normalizeWorkflowFieldValue(value);
  if (normalized === undefined || normalized === null) return true;
  if (typeof normalized === 'string' && normalized.trim() === '') return true;
  if (Array.isArray(normalized) && normalized.length === 0) return true;
  if (typeof normalized === 'object' && !Array.isArray(normalized)) {
    return Object.keys(normalized as Record<string, unknown>).length === 0;
  }
  return false;
}

/** Preview row for workflow detail panel (supports titled_group sub-fields). */
export interface WorkflowFieldPreviewRow {
  key: string;
  label: string;
  display: string;
  description?: string;
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

/** Expand a schema field + preset value into zero or more preview rows (dynamic, API-driven). */
export function buildWorkflowFieldPreviewRows(
  field: WorkflowSchemaField,
  values: Record<string, unknown>,
): WorkflowFieldPreviewRow[] {
  const value = values[field.key];
  const headerLabel = field.groupTitle?.trim() || field.label;

  if (value === undefined || value === null || value === '') {
    if (field.description?.trim()) {
      return [{
        key: field.key,
        label: headerLabel,
        display: '',
        description: field.description,
      }];
    }
    return [];
  }

  const record = parseWorkflowObjectValue(value);
  if (record && field.items?.length) {
    const rows: WorkflowFieldPreviewRow[] = [];
    for (const item of field.items) {
      const itemValue = record[item.fieldKey];
      if (itemValue === undefined || itemValue === null || itemValue === '') continue;
      rows.push({
        key: `${field.key}.${item.fieldKey}`,
        label: item.label,
        display: String(itemValue),
        description: item.description,
      });
    }
    return rows;
  }

  const display = formatWorkflowValueForDisplay(value, field);
  if (!display && !field.description?.trim()) return [];

  return [{
    key: field.key,
    label: headerLabel,
    display,
    description: field.description,
  }];
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
  let fields = schema.fields
    .filter((f) => confirmStepIds.has(f.group))
    .sort((a, b) => a.order - b.order);

  // Some templates put fields under nodeId groups — fall back to all fields with values.
  if (fields.length === 0) {
    fields = [...schema.fields].sort((a, b) => a.order - b.order);
  }

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

/** Fetch schema and build Chinese parameter summary for display / restore. */
export async function buildWorkflowParamsSummary(
  templateId: string,
  values: Record<string, unknown>,
): Promise<string> {
  if (!templateId) return buildWorkflowValuesSummaryFallback(values);
  try {
    const { getStartupSchema } = await import('@/lib/workflow-api');
    const startup = await getStartupSchema(templateId);
    return buildWorkflowValuesSummary(startup.schema, values);
  } catch {
    return buildWorkflowValuesSummaryFallback(values);
  }
}

/** Last-resort summary when schema is unavailable — prefer field keys only as labels. */
export function buildWorkflowValuesSummaryFallback(
  values: Record<string, unknown>,
): string {
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      if (Array.isArray(value)) return `- ${key}：${value.join('、')}`;
      if (typeof value === 'object') return `- ${key}：${JSON.stringify(value)}`;
      return `- ${key}：${String(value)}`;
    });
  if (lines.length === 0) return '参数已确认';
  return `已确认以下参数：\n${lines.join('\n')}`;
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
 * Collect user-facing confirm step titles from workflow schema (API-driven).
 */
export function collectWorkflowConfirmStepTitles(schema: WorkflowSchema): string[] {
  const confirmStepIds = new Set(
    schema.steps.filter((s) => s.mode === 'confirm').map((s) => s.id),
  );

  const fromSteps = schema.steps
    .filter((s) => confirmStepIds.has(s.id))
    .sort((a, b) => a.order - b.order)
    .map((s) => s.title.trim())
    .filter(Boolean);

  if (fromSteps.length > 0) return fromSteps;

  const seen = new Set<string>();
  const fromGroups: string[] = [];
  for (const field of [...schema.fields].sort((a, b) => a.order - b.order)) {
    const title = field.groupTitle?.trim() || field.label.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    fromGroups.push(title);
  }
  return fromGroups;
}

/** Short intro shown above the inline parameter form card. */
export function buildWorkflowParameterIntroText(
  templateName: string,
  schema: WorkflowSchema,
): string {
  const steps = collectWorkflowConfirmStepTitles(schema);
  if (steps.length === 0) {
    return `请在下方的分步表单中确认「${templateName}」的运行参数：`;
  }
  const stepLines = steps.map((title, index) => `${index + 1}. ${title}`).join('\n');
  return [
    `即将运行工作流「${templateName}」，请在下方表单中逐步确认以下环节：`,
    '',
    stepLines,
    '',
    '点击「继续」逐项确认；无需在对话中重复填写参数。',
  ].join('\n');
}

/** Hidden model guidance from confirm step titles only. */
export function buildWorkflowParameterModelGuidanceFromSteps(
  templateName: string,
  confirmSteps: string[],
): string {
  const stepLines = confirmSteps.length
    ? confirmSteps.map((title, index) => `${index + 1}. ${title}`).join('\n')
    : '（客户端分步表单将展示具体参数）';

  return [
    `工作流「${templateName}」：参数由客户端分步表单展示。`,
    '需确认的业务环节：',
    stepLines,
    '',
    '回复要求（必须遵守）：',
    '- 正文最多 3～5 句业务说明，概括上述环节',
    '- 禁止输出字段 key/常量名、参数对照表、Markdown 表格、默认值列表',
    '- 引导用户「在下方表单中逐步确认」',
    '- 末尾可单独一行输出 <ParameterForm templateId="..." schemaHash="..." />（客户端也可能已自动注入表单）',
  ].join('\n');
}

/** Hidden model guidance — business steps only, no field keys / default tables. */
export function buildWorkflowParameterModelGuidance(
  templateName: string,
  schema: WorkflowSchema,
): string {
  return buildWorkflowParameterModelGuidanceFromSteps(
    templateName,
    collectWorkflowConfirmStepTitles(schema),
  );
}

/**
 * Build natural language guidance text for AI from workflow schema.
 * @deprecated Prefer buildWorkflowParameterModelGuidance — avoids listing raw field keys.
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
    confirmSteps: collectWorkflowConfirmStepTitles(schema),
    fields: fieldsSummary,
  };
}
