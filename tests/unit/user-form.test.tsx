/**
 * User Form System Tests
 * 
 * Tests for the dynamic user form modal component.
 * Run with: pnpm test tests/unit/user-form.test.tsx
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserFormModal } from '../../src/components/user-form/UserFormModal';
import type { UserFormConfig, FormResult } from '../../src/types/user-form';

// Mock window.electron
beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserFormModal', () => {
  const mockConfig: UserFormConfig = {
    id: 'test-form',
    title: '测试表单',
    description: '这是一个测试表单',
    confirmLabel: '确认',
    cancelLabel: '取消',
    fields: [
      {
        name: 'username',
        type: 'text',
        label: '用户名',
        placeholder: '请输入用户名',
        validation: {
          required: true,
          minLength: 3,
        },
      },
    ],
  };

  it('renders form modal with title and description', () => {
    render(
      <UserFormModal
        config={mockConfig}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('测试表单')).toBeTruthy();
    expect(screen.getByText('这是一个测试表单')).toBeTruthy();
  });

  it('renders text input field', () => {
    render(
      <UserFormModal
        config={mockConfig}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('请输入用户名');
    expect(input).toBeTruthy();
    expect(input.getAttribute('type')).toBe('text');
  });

  it('renders number input field', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'age',
          type: 'number',
          label: '年龄',
          min: 0,
          max: 150,
          step: 1,
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByLabelText('年龄');
    expect(input).toBeTruthy();
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('150');
  });

  it('renders select dropdown', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'role',
          type: 'select',
          label: '角色',
          options: [
            { value: 'admin', label: '管理员' },
            { value: 'user', label: '普通用户' },
          ],
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const select = screen.getByLabelText('角色');
    expect(select).toBeTruthy();
    expect(screen.getByText('管理员')).toBeTruthy();
    expect(screen.getByText('普通用户')).toBeTruthy();
  });

  it('renders radio button group', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'frequency',
          type: 'radio',
          label: '频率',
          options: [
            { value: 'daily', label: '每天' },
            { value: 'weekly', label: '每周' },
          ],
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('每天')).toBeTruthy();
    expect(screen.getByLabelText('每周')).toBeTruthy();
  });

  it('renders checkbox group', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'weekDays',
          type: 'checkbox',
          label: '工作日',
          options: [
            { value: 1, label: '周一' },
            { value: 2, label: '周二' },
            { value: 3, label: '周三' },
          ],
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText('周一')).toBeTruthy();
    expect(screen.getByLabelText('周二')).toBeTruthy();
    expect(screen.getByLabelText('周三')).toBeTruthy();
  });

  it('renders toggle switch', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'enabled',
          type: 'toggle',
          label: '启用',
          defaultValue: true,
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeTruthy();
  });

  it('renders date picker', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'date',
          type: 'date',
          label: '日期',
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByLabelText('日期');
    expect(input).toBeTruthy();
    expect(input.getAttribute('type')).toBe('date');
  });

  it('renders textarea', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'description',
          type: 'textarea',
          label: '描述',
          rows: 4,
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText('描述');
    expect(textarea).toBeTruthy();
    expect(textarea.getAttribute('rows')).toBe('4');
  });

  it('validates required field', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <UserFormModal
        config={mockConfig}
        open={true}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );

    // Click confirm without filling required field
    fireEvent.click(screen.getByText('确认'));

    await waitFor(() => {
      expect(screen.getByText('用户名是必填项')).toBeTruthy();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validates minLength', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <UserFormModal
        config={mockConfig}
        open={true}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );

    // Enter too short value
    const input = screen.getByPlaceholderText('请输入用户名');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.click(screen.getByText('确认'));

    await waitFor(() => {
      expect(screen.getByText('用户名至少需要 3 个字符')).toBeTruthy();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    const onSubmit = vi.fn<(values: FormResult) => void | Promise<void>>();
    const onCancel = vi.fn();

    render(
      <UserFormModal
        config={mockConfig}
        open={true}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );

    // Enter valid value
    const input = screen.getByPlaceholderText('请输入用户名');
    fireEvent.change(input, { target: { value: 'testuser' } });
    fireEvent.click(screen.getByText('确认'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        username: 'testuser',
      });
    });
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <UserFormModal
        config={mockConfig}
        open={true}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('respects defaultValue', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'username',
          type: 'text',
          label: '用户名',
          defaultValue: 'defaultUser',
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('defaultUser');
    expect(input).toBeTruthy();
  });

  it('respects disabled field', () => {
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'username',
          type: 'text',
          label: '用户名',
          defaultValue: 'readonly',
          disabled: true,
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('readonly');
    expect(input).toBeTruthy();
    expect(input.hasAttribute('disabled')).toBe(true);
  });

  it('hides hidden fields from UI but includes in submission', async () => {
    const onSubmit = vi.fn<(values: FormResult) => void | Promise<void>>();
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'visible',
          type: 'text',
          label: '可见字段',
        },
        {
          name: 'hidden',
          type: 'hidden',
          label: '隐藏字段',
          defaultValue: 'hiddenValue',
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    // Hidden field should not be visible
    expect(screen.queryByLabelText('隐藏字段')).toBeFalsy();

    // Submit and check hidden field is included
    const input = screen.getByLabelText('可见字段');
    fireEvent.change(input, { target: { value: 'visibleValue' } });
    fireEvent.click(screen.getByText('确认'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        visible: 'visibleValue',
        hidden: 'hiddenValue',
      });
    });
  });

  it('applies custom validation', async () => {
    const onSubmit = vi.fn<(values: FormResult) => void | Promise<void>>();
    const config: UserFormConfig = {
      ...mockConfig,
      fields: [
        {
          name: 'email',
          type: 'text',
          label: '邮箱',
          validation: {
            required: true,
            custom: (value) => {
              if (String(value).includes('test')) {
                return '不能使用测试邮箱';
              }
              return null;
            },
          },
        },
      ],
    };

    render(
      <UserFormModal
        config={config}
        open={true}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByLabelText('邮箱');
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByText('确认'));

    await waitFor(() => {
      expect(screen.getByText('不能使用测试邮箱')).toBeTruthy();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
