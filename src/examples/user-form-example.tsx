/**
 * User Form Example - Scheduled Task Creation
 * 
 * This example demonstrates how to use the dynamic form system
 * to collect user input for scheduled task creation.
 */

import type { UserFormConfig } from '@/types/user-form';

/**
 * Example: Create a scheduled task confirmation form
 * 
 * This form is shown when the AI agent detects the user wants to
 * create a scheduled task, and needs to confirm the details.
 */
export function createScheduledTaskForm(params: {
  taskName: string;
  taskDescription: string;
  suggestedFrequency: 'daily' | 'weekly' | 'monthly';
  suggestedTime?: string;
}): UserFormConfig {
  return {
    id: 'scheduled-task-create-' + Date.now(),
    title: '创建定时任务',
    description: '请确认任务详情，或修改后保存',
    confirmLabel: '保存任务',
    cancelLabel: '取消',
    allowCancel: true,
    width: 'lg',
    fields: [
      {
        name: 'taskName',
        type: 'text',
        label: '任务名称',
        placeholder: '例如：每日晨报发送',
        defaultValue: params.taskName,
        validation: {
          required: true,
          minLength: 2,
          maxLength: 50,
        },
      },
      {
        name: 'taskDescription',
        type: 'textarea',
        label: '任务描述',
        placeholder: '详细描述任务要执行的内容...',
        defaultValue: params.taskDescription,
        rows: 4,
        validation: {
          required: true,
          minLength: 5,
        },
      },
      {
        name: 'frequency',
        type: 'radio',
        label: '执行频率',
        layout: 'horizontal',
        options: [
          { value: 'daily', label: '每天' },
          { value: 'weekly', label: '每周' },
          { value: 'monthly', label: '每月' },
          { value: 'once', label: '仅一次' },
        ],
        defaultValue: params.suggestedFrequency,
        validation: {
          required: true,
        },
      },
      {
        name: 'time',
        type: 'time',
        label: '执行时间',
        defaultValue: params.suggestedTime || '09:00',
        validation: {
          required: true,
        },
      },
      {
        name: 'weekDays',
        type: 'checkbox',
        label: '重复日期',
        description: '选择每周哪几天执行',
        options: [
          { value: 1, label: '周一' },
          { value: 2, label: '周二' },
          { value: 3, label: '周三' },
          { value: 4, label: '周四' },
          { value: 5, label: '周五' },
          { value: 6, label: '周六' },
          { value: 0, label: '周日' },
        ],
        defaultValue: [1, 2, 3, 4, 5], // Default to weekdays
        hidden: params.suggestedFrequency !== 'weekly',
      },
      {
        name: 'monthDay',
        type: 'number',
        label: '每月日期',
        description: '选择每月哪一天执行',
        min: 1,
        max: 31,
        defaultValue: 1,
        hidden: params.suggestedFrequency !== 'monthly',
      },
      {
        name: 'enabled',
        type: 'toggle',
        label: '启用任务',
        trueLabel: '启用',
        falseLabel: '禁用',
        defaultValue: true,
      },
      {
        name: 'notifyOnComplete',
        type: 'toggle',
        label: '完成后通知',
        description: '任务执行完成后发送通知',
        defaultValue: false,
      },
    ],
  };
}

/**
 * Example: Create a multi-option selection form
 * 
 * This form is shown when the AI agent needs the user to
 * select from multiple options.
 */
export function createOptionSelectionForm(options: {
  title: string;
  description: string;
  selections: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  allowMultiple: boolean;
}): UserFormConfig {
  return {
    id: 'option-select-' + Date.now(),
    title: options.title,
    description: options.description,
    confirmLabel: '确认选择',
    cancelLabel: '取消',
    allowCancel: true,
    width: 'md',
    fields: [
      {
        name: 'selectedOptions',
        type: options.allowMultiple ? 'checkbox' : 'radio',
        label: '请选择',
        options: options.selections.map((s) => ({
          value: s.id,
          label: s.label,
          description: s.description,
        })),
        validation: {
          required: true,
        },
      },
    ],
  };
}

/**
 * Example: Create a data entry form
 * 
 * This form is shown when the AI agent needs the user to
 * enter structured data.
 */
export function createDataEntryForm(fields: Array<{
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}>): UserFormConfig {
  return {
    id: 'data-entry-' + Date.now(),
    title: '填写信息',
    description: '请填写以下信息',
    confirmLabel: '提交',
    cancelLabel: '取消',
    allowCancel: true,
    width: 'md',
    layout: {
      columns: 1,
      labelAlign: 'top',
    },
    fields: fields.map((f) => {
      const base = {
        name: f.name,
        label: f.label,
        placeholder: f.placeholder,
        validation: {
          required: f.required,
        },
      };

      if (f.type === 'select') {
        return {
          ...base,
          type: 'select' as const,
          options: f.options || [],
        };
      }

      if (f.type === 'number') {
        return {
          ...base,
          type: 'number' as const,
        };
      }

      if (f.type === 'date') {
        return {
          ...base,
          type: 'date' as const,
        };
      }

      return {
        ...base,
        type: 'text' as const,
      };
    }),
  };
}

/**
 * Example usage in a React component
 */
export function ExampleUsage() {
  // This is pseudo-code showing how to use the forms
  //
  // import { useUserForm } from '@/hooks/use-user-form';
  // import { createScheduledTaskForm } from './user-form-example';
  //
  // function MyComponent() {
  //   const { showForm } = useUserForm();
  //
  //   const handleCreateTask = async () => {
  //     const formConfig = createScheduledTaskForm({
  //       taskName: '每日晨报',
  //       taskDescription: '发送每日晨报到微信群',
  //       suggestedFrequency: 'daily',
  //       suggestedTime: '08:00',
  //     });
  //
  //     try {
  //       const result = await showForm(formConfig);
  //       if (result) {
  //         console.log('Form submitted:', result);
  //         // Create the scheduled task with result values
  //       }
  //     } catch (error) {
  //       console.log('Form cancelled');
  //     }
  //   };
  //
  //   return <button onClick={handleCreateTask}>创建任务</button>;
  // }
}
