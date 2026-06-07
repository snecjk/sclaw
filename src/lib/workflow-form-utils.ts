/**
 * Workflow Form Utilities
 *
 * Maps workflow schema.fields to UserFormConfig for dynamic form rendering.
 * Aligned with Agent Workflow Client API v1.
 */
import type { UserFormConfig, FormField } from '@/types/user-form';
import type { WorkflowSchemaField, WorkflowSchema, StartupPreset } from '@/types/workflow';

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
};

function mapComponentToType(component: string): FormField['type'] {
  return COMPONENT_MAPPING[component] ?? 'text';
}

function mapField(schemaField: WorkflowSchemaField): FormField {
  const name = schemaField.key;
  const label = schemaField.label;
  const description = schemaField.description;
  const defaultValue = schemaField.defaultValue;
  const validation = schemaField.required ? { required: true } : undefined;

  const type = mapComponentToType(schemaField.component);

  switch (type) {
    case 'select':
      return {
        name, label, description, defaultValue, validation,
        type: 'select',
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
    case 'text':
    case 'textarea':
    default:
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

  const fields = schema.fields
    .filter((f) => confirmStepIds.has(f.group))
    .sort((a, b) => a.order - b.order)
    .map((f) => {
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

  return {
    id: `workflow-${schema.nodeId}-${Date.now()}`,
    title: schema.steps.find((s) => confirmStepIds.has(s.id))?.title ?? '工作流参数',
    description: '请填写以下工作流参数',
    fields,
    confirmLabel: '确认并执行',
    cancelLabel: '取消',
  };
}

/**
 * Build startup preset from form response values and schema hash
 */
export function buildStartupPreset(
  formValues: Record<string, unknown>,
  schemaHash: string,
): StartupPreset {
  return {
    name: '默认启动配置',
    values: formValues,
    isDefault: true,
    schemaHash,
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
