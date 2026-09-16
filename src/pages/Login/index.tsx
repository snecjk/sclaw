/**
 * SSO Login Page
 * 开发模式（pnpm dev）显示 SSO 环境选择；其他构建环境根据 env-config 固定 SSO 环境。
 * 卡片内容按状态切换（对照设计稿三个容器）：
 *   登录前 - 默认登录卡片；登录后 - 组织未开通，引导报名；报名后 - 已登记审核中。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, TriangleAlert } from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select } from '@/components/ui/select';
import { invertedPrimarySurfaceClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { useAuthStore, type SsoEnvironment } from '@/stores/auth';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import { hostApiFetch } from '@/lib/host-api';
import clawxIcon from '@/assets/rectangle_icon.png';

const envConfig = getCurrentEnvConfig();

type OpeningStatus = 'NOT_REGISTERED' | 'REGISTERED' | 'ENABLED';

interface OpeningStatusData {
  status: OpeningStatus;
  statusName: string;
  applicationNo?: string | null;
}

const DEV_SSO_ENV_OPTIONS: SsoEnvironment[] = [
  'local',
  'daily-external',
  'pre-release',
  'production-internal',
  'production-external',
];

const pageStatusItems = ['连接：正常', '服务：就绪', '登录：安全'];

export function Login() {
  const { t } = useTranslation(['auth']);
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn);
  const error = useAuthStore((s) => s.error);
  const accessDenied = useAuthStore((s) => s.accessDenied);
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const login = useAuthStore((s) => s.login);
  const setSsoEnvironment = useAuthStore((s) => s.setSsoEnvironment);
  const clearAccessDenied = useAuthStore((s) => s.clearAccessDenied);
  const [openingStatus, setOpeningStatus] = useState<OpeningStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);

  useEffect(() => {
    if (!envConfig.isDevelopment) {
      void setSsoEnvironment(envConfig.ssoEnvironment as SsoEnvironment);
    }
  }, [setSsoEnvironment]);

  useEffect(() => {
    if (!accessDenied) return;
    let cancelled = false;
    const loadOpeningStatus = async () => {
      setOpeningStatus(null);
      setOpeningError(null);
      setStatusLoading(true);
      try {
        const result = await hostApiFetch<{
          success: boolean;
          data?: OpeningStatusData;
          error?: string;
        }>('/api/auth/site-opening/status');
        if (!result.success || !result.data) throw new Error(result.error || '状态查询失败');
        if (!cancelled) setOpeningStatus(result.data);
      } catch (statusError) {
        if (!cancelled) {
          setOpeningError(statusError instanceof Error ? statusError.message : String(statusError));
        }
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };
    void loadOpeningStatus();
    return () => { cancelled = true; };
  }, [accessDenied]);

  const registerOpening = async () => {
    setRegistering(true);
    setOpeningError(null);
    try {
      const result = await hostApiFetch<{ success: boolean; data?: OpeningStatusData; error?: string }>(
        '/api/auth/site-opening/register',
        { method: 'POST' },
      );
      if (!result.success || !result.data) throw new Error(result.error || '登记失败');
      setOpeningStatus(result.data);
    } catch (registerError) {
      setOpeningError(registerError instanceof Error ? registerError.message : String(registerError));
    } finally {
      setRegistering(false);
    }
  };

  const handleLogin = () => {
    void login(envConfig.isDevelopment ? undefined : (envConfig.ssoEnvironment as SsoEnvironment));
  };

  // 已开通：回到登录卡片并提示重新登录；其余拦截状态走"登录后/报名后"卡片
  const openingEnabled = accessDenied && openingStatus?.status === 'ENABLED';
  const openingPending = accessDenied && openingStatus?.status === 'REGISTERED';
  const showDeniedCard = accessDenied && !openingEnabled;

  const deniedHint = (() => {
    if (openingError) return openingError;
    if (openingPending) return '工作人员将在1个工作日内钉钉联系您';
    if (statusLoading) return '正在查询开通状态…';
    return '点击报名按钮开通客户端权限';
  })();

  // 深底白字主操作钮：复用全局反色主钮 token（亮色深底/暗色浅底），尺寸按设计稿 320x58
  const darkActionClass = cn(
    'h-[58px] w-full rounded-xl text-lg font-medium leading-[26px]',
    'shadow-[14px_14px_45px_4px_rgba(191,193,212,0.2)]',
    invertedPrimarySurfaceClass,
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[var(--sto-surface-canvas)]">
      {/* 背景对齐设计稿：规则点阵（约 1.7px / 间距 13.93px）+ 四角径向光晕压淡点阵；
          颜色消费主题 token（--sto-login-dot / --sto-login-glow），暗色映射见 tokens.css */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              'radial-gradient(600px 600px at 78.5% 11.4%, rgb(var(--sto-login-glow) / 1) 0%, rgb(var(--sto-login-glow) / 0.55) 52%, rgb(var(--sto-login-glow) / 0) 90%)',
              'radial-gradient(500px 500px at 5.3% 67.6%, rgb(var(--sto-login-glow) / 1) 0%, rgb(var(--sto-login-glow) / 0.55) 52%, rgb(var(--sto-login-glow) / 0) 90%)',
              'radial-gradient(400px 400px at 29.9% 6%, rgb(var(--sto-login-glow) / 1) 0%, rgb(var(--sto-login-glow) / 0.92) 16%, rgb(var(--sto-login-glow) / 0.5) 46%, rgb(var(--sto-login-glow) / 0.18) 68%, rgb(var(--sto-login-glow) / 0.06) 84%, rgb(var(--sto-login-glow) / 0) 96%)',
              'radial-gradient(500px 500px at 61.5% 87.1%, rgb(var(--sto-login-glow) / 1) 0%, rgb(var(--sto-login-glow) / 0.92) 16%, rgb(var(--sto-login-glow) / 0.5) 46%, rgb(var(--sto-login-glow) / 0.18) 68%, rgb(var(--sto-login-glow) / 0.06) 84%, rgb(var(--sto-login-glow) / 0) 96%)',
              'radial-gradient(circle, var(--sto-login-dot) 0.84px, transparent 0.92px)',
            ].join(','),
            backgroundSize: '100% 100%, 100% 100%, 100% 100%, 100% 100%, 13.93px 13.93px',
          }}
        />
      </div>

      <TitleBar />

      {/* 设计稿卡片顶部约 186px：用底部留白把居中位置整体抬高 */}
      <div className="relative z-10 flex flex-1 items-center justify-center p-4 pb-20">
        <Card className="flex w-[436px] flex-col items-center gap-10 rounded-[24px] border-0 bg-card px-[58px] py-20 shadow-[0_4px_30px_rgba(0,0,0,0.1)] dark:border dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-primary)] dark:shadow-none">
          {showDeniedCard ? (
            <>
              <div className="flex flex-col items-center gap-5">
                <TriangleAlert className="h-16 w-16 text-white" fill="#FAAD14" strokeWidth={1.5} />
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <h1 className="text-2xl font-semibold leading-9 text-[#1D2129] dark:text-foreground">
                    访问受限无法登录
                  </h1>
                  <p className="text-[13px] leading-[18px] text-[#86909C] dark:text-muted-foreground">
                    所属组织不在客户端白名单内
                  </p>
                </div>
              </div>

              <div className="flex w-80 flex-col items-center gap-[18px]">
                {openingPending ? (
                  <div className="flex h-[58px] w-full items-center justify-center rounded-xl bg-warning text-lg font-medium leading-[26px] text-white shadow-[14px_14px_45px_4px_rgba(191,193,212,0.2)]">
                    报名成功，审核中...
                  </div>
                ) : (
                  <Button
                    className={darkActionClass}
                    disabled={statusLoading || registering}
                    onClick={() => void registerOpening()}
                  >
                    {registering && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    去报名开通
                  </Button>
                )}
                <p
                  className={`text-center text-[13px] leading-4 ${
                    openingError ? 'text-red-500' : 'text-[#4E5969] dark:text-muted-foreground'
                  }`}
                >
                  {deniedHint}
                </p>
                <Button
                  type="button"
                  variant="link"
                  onClick={clearAccessDenied}
                  className="h-auto p-0 text-[13px] font-normal leading-4 text-[#86909C] underline-offset-4 transition-colors hover:text-[#4E5969] hover:underline dark:text-muted-foreground dark:hover:text-foreground"
                >
                  返回登录
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-5">
                <img
                  src={clawxIcon}
                  alt="SClaw"
                  className="h-16 w-16 rounded-2xl object-cover shadow-[inset_0_0_9px_rgba(255,255,255,0.15)]"
                />
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <h1 className="text-2xl font-semibold leading-9 text-[#1D2129] dark:text-foreground">
                    {t('auth:login.title')}
                  </h1>
                  <p className="text-[13px] leading-[18px] text-[#86909C] dark:text-muted-foreground">
                    {t('auth:login.subtitle')}
                  </p>
                </div>
              </div>

              <div className="flex w-80 flex-col items-center gap-[18px]">
                {envConfig.isDevelopment && (
                  <div className="w-full space-y-2">
                    <Label
                      htmlFor="sto-sso-env"
                      className="text-xs font-medium text-[#86909C] dark:text-muted-foreground"
                    >
                      {t('auth:environment.label')}
                    </Label>
                    <Select
                      id="sto-sso-env"
                      value={ssoEnvironment}
                      onChange={(e) => void setSsoEnvironment(e.target.value as SsoEnvironment)}
                      disabled={isLoggingIn}
                      className="h-11 w-full rounded-xl"
                    >
                      {DEV_SSO_ENV_OPTIONS.map((env) => (
                        <option key={env} value={env}>
                          {t(`auth:environment.${env}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {error && error !== 'SSO_LOGIN_CANCELLED' && !accessDenied && (
                  <p className="text-center text-[13px] leading-4 text-red-500">
                    {t('auth:login.error', { error })}
                  </p>
                )}
                <Button className={darkActionClass} onClick={handleLogin} disabled={isLoggingIn}>
                  {isLoggingIn && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                  {isLoggingIn ? t('auth:login.loggingIn') : t('auth:login.button')}
                </Button>
                <p
                  className={`text-center text-[13px] leading-4 ${
                    openingEnabled
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-[#4E5969] dark:text-muted-foreground'
                  }`}
                >
                  {openingEnabled ? '权限已开通，请重新登录' : t('auth:login.hint')}
                </p>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="relative z-10 flex justify-center pb-[54px]">
        <div className="flex items-center text-[13px] leading-4 text-[#4E5969] dark:text-muted-foreground">
          {pageStatusItems.map((item, index) => (
            <span key={item} className="flex items-center">
              {index > 0 && (
                <Separator orientation="vertical" className="h-3 w-[1px] bg-[#C9CDD4] dark:bg-white/15" />
              )}
              <span className="px-[18px]">{item}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
