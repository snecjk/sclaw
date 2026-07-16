import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DingTalkMentionEditor,
  type DingTalkMentionEditorHandle,
} from '@/components/dingtalk/DingTalkMentionEditor';

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

  it('does not restore a deleted consumed skill in a fresh editor', () => {
    const editorRef = createRef<DingTalkMentionEditorHandle>();
    const { container, rerender, unmount } = render(
      <DingTalkMentionEditor
        ref={editorRef}
        seedSkillSlug="skill-a"
        onSnapshotChange={vi.fn()}
      />,
    );

    expect(container.querySelector('.skill-token')).not.toBeNull();

    rerender(
      <DingTalkMentionEditor
        ref={editorRef}
        seedSkillSlug={undefined}
        onSnapshotChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.skill-token')).not.toBeNull();

    act(() => editorRef.current?.removeSkill());
    expect(container.querySelector('.skill-token')).toBeNull();

    unmount();
    const fresh = render(
      <DingTalkMentionEditor
        seedSkillSlug={undefined}
        onSnapshotChange={vi.fn()}
      />,
    );
    expect(fresh.container.querySelector('.skill-token')).toBeNull();
  });

  it('replaces a consumed skill when a different seed arrives', () => {
    const { container, rerender } = render(
      <DingTalkMentionEditor
        seedSkillSlug="skill-a"
        onSnapshotChange={vi.fn()}
      />,
    );

    rerender(
      <DingTalkMentionEditor
        seedSkillSlug="skill-b"
        onSnapshotChange={vi.fn()}
      />,
    );

    expect(container.querySelector('.skill-token')?.getAttribute('data-skill-slug')).toBe('skill-b');
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
