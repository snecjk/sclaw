import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppDevTunePanel } from '@/components/app-dev/AppDevTunePanel';
import { AppDevElementTuneForm, createElementTuneDraft } from '@/components/app-dev/AppDevElementTuneForm';

describe('AppDevTunePanel element inspector', () => {
  it('shows empty hint when nothing is selected', () => {
    render(
      <AppDevTunePanel
        workspaceId="ws-1"
        executeJS={null}
        pickedElements={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('app-dev-element-tune-empty')).toHaveTextContent('点击预览中的元素进行微调');
  });

  it('shows text editors for a heading', () => {
    const element = { selector: 'h1.hero', tag: 'h1', text: '山丘咖啡', styles: { fontSize: '28px', color: 'rgb(29, 33, 41)' } };
    render(
      <AppDevElementTuneForm
        element={element}
        executeJS={null}
        draft={createElementTuneDraft(element)}
        onDraftChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('app-dev-element-tune-form')).toHaveTextContent('文字');
    expect(screen.getByDisplayValue('山丘咖啡')).toBeInTheDocument();
  });

  it('shows image editors for img', () => {
    const element = { selector: 'img.hero', tag: 'img', src: '/cover.png', alt: '封面' };
    render(
      <AppDevElementTuneForm
        element={element}
        executeJS={null}
        draft={createElementTuneDraft(element)}
        onDraftChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('app-dev-element-tune-form')).toHaveTextContent('图片');
    expect(screen.getByDisplayValue('/cover.png')).toBeInTheDocument();
  });

  it('tells the user JSX nodes cannot bind APIs', () => {
    render(
      <AppDevTunePanel
        workspaceId="ws-1"
        executeJS={null}
        pickedElements={[{ selector: 'h1.hero', tag: 'h1', text: '山丘咖啡' }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/接口与字段映射只在 A2UI 组件上开放/)).toBeInTheDocument();
  });
});
