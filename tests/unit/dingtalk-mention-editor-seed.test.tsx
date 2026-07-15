import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DingTalkMentionEditor } from '@/components/dingtalk/DingTalkMentionEditor';

describe('DingTalkMentionEditor seedText', () => {
  it('keeps the seeded draft when parent clears seedText after URL cleanup', () => {
    const onSnapshotChange = vi.fn();
    const { rerender } = render(
      <DingTalkMentionEditor
        seedText="技能命令"
        onSnapshotChange={onSnapshotChange}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveTextContent('技能命令');

    rerender(
      <DingTalkMentionEditor
        seedText={undefined}
        onSnapshotChange={onSnapshotChange}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveTextContent('技能命令');
  });

  it('focuses the seeded draft at the end after a separator space', () => {
    render(
      <DingTalkMentionEditor
        seedText="技能命令"
        onSnapshotChange={vi.fn()}
      />,
    );

    const editor = screen.getByRole('textbox');
    const selection = window.getSelection();

    expect(editor.textContent).toBe('技能命令 ');
    expect(document.activeElement).toBe(editor);
    expect(selection?.rangeCount).toBe(1);

    const range = selection!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(editor.firstChild);
    expect(range.startOffset).toBe('技能命令 '.length);
  });
});
