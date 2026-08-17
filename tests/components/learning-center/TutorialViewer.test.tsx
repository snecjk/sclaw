import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';

describe('TutorialViewer', () => {
  it('renders supported content, indentation and complete signed URL query', () => {
    const url = 'https://oss.example.com/tutorial.png?Expires=123&Signature=a%2Bb%3D';
    render(<TutorialViewer html={`<h2 data-indent="2">标题</h2><p><span style="font-size: 20px; color: #ff6500; background-color: #ffedd5; font-family: SimHei">重点</span></p><ol><li>步骤</li></ol><blockquote>提示</blockquote><pre><code>const a = 1</code></pre><img src="${url}" alt="教程图" data-width="65" style="width: 65%">`} />);
    expect(screen.getByRole('heading', { name: '标题' }).getAttribute('data-indent')).toBe('2');
    const image = screen.getByRole('img', { name: '教程图' });
    expect(image.getAttribute('src')).toBe(url);
    expect(image.getAttribute('data-width')).toBe('65');
    expect(image.style.width).toBe('65%');
    expect(screen.getByText('重点').getAttribute('style')).toContain('font-size: 20px');
    expect(screen.getByText('步骤')).toBeTruthy();
  });

  it('defensively prevents dangerous content from executing', () => {
    render(<TutorialViewer html={'<script>window.__attacked=1</script><iframe src="https://bad.example"></iframe><img alt="x" src="javascript:alert(1)" onerror="alert(2)"><p onclick="alert(3)">安全正文</p><a href="javascript:alert(4)">危险链接</a>'} />);
    expect(screen.getByTestId('tutorial-viewer').querySelector('script')).toBeNull();
    expect(screen.getByTestId('tutorial-viewer').querySelector('iframe')).toBeNull();
    expect(screen.getByRole('img', { name: /x.*图片加载失败/ }).hasAttribute('src')).toBe(false);
    expect(screen.getByText('安全正文').hasAttribute('onclick')).toBe(false);
    expect(screen.getByText('危险链接').closest('a')).toBeNull();
  });

  it('replaces a failed managed image with an accessible fallback', () => {
    const url = 'https://oss.example.com/tutorial.png?Expires=123&Signature=signed';
    render(<TutorialViewer html={`<img src="${url}" alt="流程截图" data-width="50">`} imageErrorLabel="图片暂不可用" />);
    const image = screen.getByRole('img', { name: '流程截图' });
    expect(image.getAttribute('src')).toBe(url);
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: /流程截图.*图片暂不可用/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '流程截图' })).not.toBeInTheDocument();
  });
});
