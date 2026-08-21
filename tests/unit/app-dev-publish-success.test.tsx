import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetsPublishSuccess } from '../../src/components/app-dev/AssetsPublishSuccess';
import { SitePublishSuccess } from '../../src/components/app-dev/SitePublishSuccess';

describe('typed publish success views', () => {
  it('shows a Site fixed domain without exposing an OSS URL', () => {
    render(<SitePublishSuccess
      fixedUrl="https://demo.example.cn"
      onCopy={vi.fn()}
      onOpen={vi.fn()}
    />);
    expect(screen.getByText('https://demo.example.cn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '访问站点' })).toBeInTheDocument();
    expect(screen.queryByText(/OSS 产物/)).not.toBeInTheDocument();
  });

  it('shows the Site missing-data message', () => {
    render(<SitePublishSuccess onCopy={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('发布成功，访问地址暂未返回')).toBeInTheDocument();
  });

  it('shows an Assets version and artifact URL', () => {
    render(<AssetsPublishSuccess
      version="1.4.0"
      artifactUrl="https://oss.example.cn/assets/1.4.0/index.js"
      onCopy={vi.fn()}
    />);
    expect(screen.getByText('1.4.0')).toBeInTheDocument();
    expect(screen.getByText('https://oss.example.cn/assets/1.4.0/index.js')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制产物地址' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '申请自定义域名' })).toBeDisabled();
  });

  it('shows the Assets missing-data message', () => {
    render(<AssetsPublishSuccess onCopy={vi.fn()} />);
    expect(screen.getByText('发布成功，产物信息暂未返回')).toBeInTheDocument();
  });
});
