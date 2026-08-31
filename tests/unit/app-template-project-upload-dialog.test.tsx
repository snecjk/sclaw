import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemplateProjectUploadDialog } from '@/components/more-apps/TemplateProjectUploadDialog';
import { createTemplateImportPreview } from './helpers/app-template-import-fixtures';

describe('TemplateProjectUploadDialog', () => {
  it('shows add, modify, delete, ignored paths, packages, and blockers', () => {
    const onApply = vi.fn();
    render(
      <TemplateProjectUploadDialog
        open
        preview={createTemplateImportPreview({
          changes: [
            { path: 'src/New.tsx', kind: 'add' },
            { path: 'src/App.tsx', kind: 'modify' },
            { path: 'src/Old.tsx', kind: 'delete' },
          ],
          ignoredPaths: ['.env.daily'],
          packageChanges: [{
            name: 'react',
            section: 'dependencies',
            sourceValue: '^19.0.0',
            appliedValue: '^19.0.0',
            resolution: 'source',
          }],
          issues: [{
            code: 'PAGE_TYPE_MISMATCH',
            level: 'blocker',
            message: '类型不一致',
          }],
        })}
        applying={false}
        onApply={onApply}
        onCancel={vi.fn()}
        onPickAnother={vi.fn()}
      />,
    );

    expect(screen.getByText('新增 1')).toBeInTheDocument();
    expect(screen.getByText('修改 1')).toBeInTheDocument();
    expect(screen.getByText('删除 1')).toBeInTheDocument();
    expect(screen.getByText('.env.daily')).toBeInTheDocument();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('类型不一致')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认覆盖' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('allows reviewing files and choosing a different directory', () => {
    const onPickAnother = vi.fn();
    render(
      <TemplateProjectUploadDialog
        open
        preview={createTemplateImportPreview({
          changes: [{ path: 'src/App.tsx', kind: 'modify' }],
        })}
        applying={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        onPickAnother={onPickAnother}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择其他目录' }));
    expect(onPickAnother).toHaveBeenCalledOnce();
  });
});
