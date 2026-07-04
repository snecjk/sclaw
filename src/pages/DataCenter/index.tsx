/**
 * Data Center Page
 * 数据中心页面，嵌入 STO 业务组织管理系统 iframe
 * 根据当前构建环境自动显示对应的数据中心
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { glassSectionSurface } from '@/lib/surfaces';
import { getAppEnv } from '../../../shared/env-config';

/** 各环境对应的数据中心 URL */
const DATA_CENTER_URLS: Record<string, string> = {
  production: 'https://wd-vip.sto.cn/claw-businessOrganization',
  staging: 'https://pre-wd-vip.sto.cn/claw-businessOrganization',
  test: 'https://wd-vip-test.sto.cn/claw-businessOrganization',
  development: 'https://wd-vip-test.sto.cn/claw-businessOrganization', // 开发环境默认用测试
};

export function DataCenter() {
  const authUser = useAuthStore((s) => s.user);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState<string | null>(null);

  const stoToken = authUser?.stoToken;

  const iframeUrl = useMemo(() => {
    const token = stoToken?.trim();
    if (!token) {
      return null;
    }
    const appEnv = getAppEnv();
    const baseUrl = DATA_CENTER_URLS[appEnv] ?? DATA_CENTER_URLS.production;
    return `${baseUrl}?token=${encodeURIComponent(token)}`;
  }, [stoToken]);

  // Reset state when token is unavailable
  useEffect(() => {
    if (!stoToken) {
      setIframeError('未获取到登录令牌，请重新登录');
    } else {
      setIframeError(null);
    }
  }, [stoToken]);

  const handleIframeLoad = () => {
    setIframeLoaded(true);
  };

  const handleIframeError = () => {
    setIframeError('页面加载失败，请检查网络连接');
  };

  if (!stoToken) {
    return (
      <div className={cn('flex h-full flex-col', glassSectionSurface)}>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-muted-foreground">
              {iframeError || '未获取到登录令牌，请重新登录'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', glassSectionSurface)}>
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">客户关系</h1>
      </div>

      {/* iframe 内容区 - 使用裁剪隐藏外部页面的顶部导航 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {iframeUrl ? (
          <iframe
            src={iframeUrl}
            style={{
              width: '100%',
              height: 'calc(100% + 50px)',
              border: 'none',
            }}
            title="客户关系"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">无法生成访问链接</p>
          </div>
        )}
      </div>
    </div>
  );
}
