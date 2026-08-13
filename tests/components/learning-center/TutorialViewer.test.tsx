import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';

describe('TutorialViewer', () => {
  it('renders supported content, indentation and complete signed URL query', () => {
    const url = 'https://oss.example.com/tutorial.png?Expires=123&Signature=a%2Bb%3D';
    render(<TutorialViewer html={`<h2 data-indent="2">标题</h2><ol><li>步骤</li></ol><blockquote>提示</blockquote><pre><code>const a = 1</code></pre><img src="${url}" alt="教程图">`} />);
    expect(screen.getByRole('heading', { name: '标题' }).getAttribute('data-indent')).toBe('2');
    expect(screen.getByRole('img', { name: '教程图' }).getAttribute('src')).toBe(url);
    expect(screen.getByText('步骤')).toBeTruthy();
  });

  it('defensively prevents dangerous content from executing', () => {
    render(<TutorialViewer html={'<script>window.__attacked=1</script><img alt="x" src="javascript:alert(1)" onerror="alert(2)"><p onclick="alert(3)">安全正文</p>'} />);
    expect(screen.getByTestId('tutorial-viewer').querySelector('script')).toBeNull();
    expect(screen.getByRole('img', { name: 'x' }).hasAttribute('src')).toBe(false);
    expect(screen.getByText('安全正文').hasAttribute('onclick')).toBe(false);
  });
});
