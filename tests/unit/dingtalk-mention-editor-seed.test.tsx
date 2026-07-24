import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DingTalkMentionEditor,
  type DingTalkMentionEditorHandle,
} from '@/components/dingtalk/DingTalkMentionEditor';

function expectNoInlineHeight(editor: HTMLElement): void {
  expect(editor.style.height).toBe('');
  expect(editor.getAttribute('style') ?? '').not.toMatch(/height\s*:/);
}

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

describe('DingTalkMentionEditor CSS auto-height (no JS inline height)', () => {
  it('does not write inline height on empty mount', () => {
    render(<DingTalkMentionEditor onSnapshotChange={vi.fn()} />);
    const editor = screen.getByRole('textbox');
    expectNoInlineHeight(editor);
    expect(editor.className).toMatch(/min-h-\[42px]/);
    expect(editor.className).toMatch(/max-h-\[200px]/);
    expect(editor.className).toMatch(/overflow-y-auto/);
  });

  it('does not write inline height after input', () => {
    render(<DingTalkMentionEditor onSnapshotChange={vi.fn()} />);
    const editor = screen.getByRole('textbox');
    editor.textContent = 'hello';
    fireEvent.input(editor);
    expectNoInlineHeight(editor);
  });

  it('does not write inline height after seedText / setPlainText / clear', () => {
    const editorRef = createRef<DingTalkMentionEditorHandle>();
    const { rerender } = render(
      <DingTalkMentionEditor
        ref={editorRef}
        seedText="预填文案"
        onSnapshotChange={vi.fn()}
      />,
    );

    expectNoInlineHeight(screen.getByRole('textbox'));

    act(() => editorRef.current?.setPlainText('手动设置'));
    expectNoInlineHeight(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox')).toHaveTextContent('手动设置');

    act(() => editorRef.current?.clear());
    expectNoInlineHeight(screen.getByRole('textbox'));

    rerender(
      <DingTalkMentionEditor
        ref={editorRef}
        seedText="再预填"
        onSnapshotChange={vi.fn()}
      />,
    );
    expectNoInlineHeight(screen.getByRole('textbox'));
  });

  it('keeps mention / skill / workflow insert and serialize behavior without inline height', () => {
    const editorRef = createRef<DingTalkMentionEditorHandle>();
    render(
      <DingTalkMentionEditor
        ref={editorRef}
        onSnapshotChange={vi.fn()}
      />,
    );

    act(() => {
      editorRef.current?.setMentions([
        { type: 'user', displayName: '张三', userId: 'u1' },
      ]);
    });
    expectNoInlineHeight(screen.getByRole('textbox'));
    expect(editorRef.current?.getSnapshot().mentions.some(
      (m) => m.type === 'user' && m.userId === 'u1',
    )).toBe(true);

    act(() => {
      editorRef.current?.insertSkill('skill-demo', '演示技能');
    });
    expectNoInlineHeight(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox').querySelector('.skill-token')?.getAttribute('data-skill-slug'))
      .toBe('skill-demo');

    act(() => {
      editorRef.current?.insertWorkflow('wf_demo', '演示工作流');
    });
    const editor = screen.getByRole('textbox');
    expectNoInlineHeight(editor);
    expect(editor.querySelector('.workflow-token')).not.toBeNull();
    // skill/workflow are mutually exclusive in the composer
    expect(editor.querySelector('.skill-token')).toBeNull();

    const snapshot = editorRef.current?.getSnapshot();
    expect(snapshot?.isEmpty).toBe(false);
    expect(snapshot?.plainText.length).toBeGreaterThan(0);
  });
});
