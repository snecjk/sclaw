import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetsPublishSuccess } from '../../src/components/app-dev/AssetsPublishSuccess';
import { SitePublishSuccess } from '../../src/components/app-dev/SitePublishSuccess';
import { StoAppDeployControl } from '../../src/components/app-dev/StoAppDeployControl';

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

describe('StoAppDeployControl typed success presentation', () => {
  const commonProps = {
    canDeploy: true,
    onOpenDialog: vi.fn(),
    onClearTerminalJob: vi.fn(),
  };

  it('shows only the fixed URL for a Site success', () => {
    render(<StoAppDeployControl
      {...commonProps}
      pageType="site"
      job={{
        phase: 'success',
        label: '发布成功',
        startedAt: 1,
        fields: {
          status: 'SUCCESS',
          resourcePages: [{
            url: 'https://site.example.cn',
            artifactUrl: 'https://oss.example.cn/site.zip',
          }],
        },
      }}
    />);
    fireEvent.click(screen.getByRole('button', { name: '发布成功' }));
    expect(screen.getByText('https://site.example.cn')).toBeInTheDocument();
    expect(screen.queryByText('https://oss.example.cn/site.zip')).not.toBeInTheDocument();
  });

  it('shows version and artifact URL for an Assets success', () => {
    render(<StoAppDeployControl
      {...commonProps}
      pageType="assets"
      job={{
        phase: 'success',
        label: '发布成功',
        startedAt: 1,
        fields: {
          status: 'SUCCESS',
          deploymentVersion: '1.4.0',
          resourcePages: [{ artifactUrl: 'https://oss.example.cn/assets/1.4.0/' }],
        },
      }}
    />);
    fireEvent.click(screen.getByRole('button', { name: '发布成功' }));
    expect(screen.getByText('1.4.0')).toBeInTheDocument();
    expect(screen.getByText('https://oss.example.cn/assets/1.4.0/')).toBeInTheDocument();
  });

  it.each(['site', 'assets'] as const)('keeps %s failure presentation shared', (pageType) => {
    render(<StoAppDeployControl
      {...commonProps}
      pageType={pageType}
      onFillComposer={vi.fn()}
      job={{
        phase: 'failed',
        label: '发布失败',
        startedAt: 1,
        fields: { status: 'FAILED', failureMessage: '构建失败' },
      }}
    />);
    fireEvent.click(screen.getByRole('button', { name: '发布失败' }));
    expect(screen.getByText('失败原因')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '填入 AI 会话' })).toBeInTheDocument();
  });

  it('opens a dropdown with 发布菜单', async () => {
    const onPublishMenu = vi.fn();
    render(<StoAppDeployControl
      {...commonProps}
      pageType="site"
      job={null}
      onPublishMenu={onPublishMenu}
    />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '更多发布操作' }), {
      button: 0,
      ctrlKey: false,
    });
    const item = await screen.findByRole('menuitem', { name: '发布菜单' });
    fireEvent.click(item);
    expect(onPublishMenu).toHaveBeenCalledTimes(1);
  });
});
