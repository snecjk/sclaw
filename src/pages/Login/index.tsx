/**
 * SSO Login Page
 * 开发模式（pnpm dev）显示 SSO 环境选择；其他构建环境根据 env-config 固定 SSO 环境。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { useThemeAppearance } from '@/components/theme/appearance-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore, type SsoEnvironment } from '@/stores/auth';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import { hostApiFetch } from '@/lib/host-api';
import loginBeforeArtwork from '@/assets/auth/login-before.svg';
import loginBeforeDarkArtwork from '@/assets/auth/login-before-dark.svg';
import loginAfterArtwork from '@/assets/auth/login-after.svg';
import loginAfterDarkArtwork from '@/assets/auth/login-after-dark.svg';
import registrationPendingArtwork from '@/assets/auth/registration-pending.svg';
import registrationPendingDarkArtwork from '@/assets/auth/registration-pending-dark.svg';

const envConfig = getCurrentEnvConfig();
const isLocalDevelopment = import.meta.env.DEV && envConfig.isDevelopment;

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

const PAGE_STATUS_ITEMS = ['连接：正常', '服务：就绪', '登录：安全'];

const artworkButtonClass = [
  'no-drag absolute z-10 rounded-[12px] bg-transparent text-transparent',
  'border-0 p-0 outline-none shadow-none focus:outline-none focus-visible:outline-none',
  'disabled:cursor-wait',
].join(' ');

// 1440x900 设计稿按原始 8:5 比例 contain 在窗口内，始终保留完整内容。
const artworkStageStyle = {
  width: 'min(100vw, 160vh)',
  height: 'min(100vh, 62.5vw)',
  containerType: 'inline-size',
} satisfies CSSProperties;

export function Login() {
  const { t } = useTranslation(['auth']);
  const appearance = useThemeAppearance();
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn);
  const error = useAuthStore((s) => s.error);
  const accessDenied = useAuthStore((s) => s.accessDenied);
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const login = useAuthStore((s) => s.login);
  const setSsoEnvironment = useAuthStore((s) => s.setSsoEnvironment);
  const [openingStatus, setOpeningStatus] = useState<OpeningStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLocalDevelopment) {
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
    void login(isLocalDevelopment ? undefined : (envConfig.ssoEnvironment as SsoEnvironment));
  };

  const openingEnabled = accessDenied && openingStatus?.status === 'ENABLED';
  const openingPending = accessDenied && openingStatus?.status === 'REGISTERED';
  const showDeniedArtwork = accessDenied && !openingEnabled;
  const artwork = openingPending
    ? (appearance === 'dark' ? registrationPendingDarkArtwork : registrationPendingArtwork)
    : showDeniedArtwork
      ? (appearance === 'dark' ? loginAfterDarkArtwork : loginAfterArtwork)
      : (appearance === 'dark' ? loginBeforeDarkArtwork : loginBeforeArtwork);
  const artworkAlt = openingPending
    ? '报名成功，审核中'
    : showDeniedArtwork
      ? '访问受限，等待报名开通'
      : 'SClaw 登录';

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#F7F8FA] dark:bg-[#171A1F]">
      {/* 只延展设计稿的底色、点阵和光晕，避免背景副本重复渲染文字与控件。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
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

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={artworkStageStyle}
      >
        <img
          src={artwork}
          alt={artworkAlt}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
          draggable={false}
        />

        {showDeniedArtwork && !openingPending ? (
          <button
            type="button"
            aria-label="去报名开通"
            title="去报名开通"
            className={`${artworkButtonClass} left-[38.194%] top-[49.778%] h-[5.556%] w-[22.222%]`}
            disabled={statusLoading || registering}
            onClick={() => void registerOpening()}
          >
            去报名开通
          </button>
        ) : !showDeniedArtwork ? (
          <button
            type="button"
            aria-label="点击登录"
            title="点击登录"
            className={`${artworkButtonClass} left-[38.194%] top-[53.333%] h-[5.556%] w-[22.222%]`}
            disabled={isLoggingIn}
            onClick={handleLogin}
          >
            点击登录
          </button>
        ) : null}

        {(openingError || (error && error !== 'SSO_LOGIN_CANCELLED' && !accessDenied)) && (
          <p
            role="alert"
            className="absolute left-1/2 top-[63.6%] z-10 max-w-[44%] -translate-x-1/2 rounded bg-white/90 px-3 py-1 text-center text-xs text-red-600"
          >
            {openingError || error}
          </p>
        )}
      </div>

      {isLocalDevelopment && !showDeniedArtwork && (
        <div className="no-drag absolute bottom-[81px] left-1/2 z-30 h-9 w-[280px] max-w-[calc(100vw-32px)] -translate-x-1/2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={isLoggingIn}>
              <Button
                id="sto-sso-env"
                type="button"
                variant="ghost"
                size="sm"
                aria-label="SSO 环境"
                disabled={isLoggingIn}
                className="h-full w-full justify-between rounded-full border border-white/40 !bg-white/[0.14] px-4 text-[12px] font-medium !text-[#4E5969] shadow-[0_6px_20px_rgba(29,33,41,0.035),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-xl hover:border-white/60 hover:!bg-white/[0.24] focus-visible:!bg-white/[0.28] dark:border-white/10 dark:!bg-white/[0.06] dark:!text-[#C9CDD4] dark:shadow-[0_8px_24px_rgba(0,0,0,0.18)] dark:hover:border-white/20 dark:hover:!bg-white/[0.10]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#86909C]/70" aria-hidden />
                  <span className="shrink-0 text-[#86909C] dark:text-[#AEB8C4]">开发环境</span>
                  <span className="text-[#C9CDD4] dark:text-[#4E5969]" aria-hidden>·</span>
                  <span className="truncate text-[#4E5969] dark:text-[#C9CDD4]">
                    {t(`auth:environment.${ssoEnvironment}`)}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#86909C]" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            {!isLoggingIn ? (
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={6}
                avoidCollisions={false}
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                {DEV_SSO_ENV_OPTIONS.map((environment) => {
                  const selected = environment === ssoEnvironment;
                  return (
                    <DropdownMenuItem
                      key={environment}
                      className={selected ? 'font-medium' : undefined}
                      onSelect={() => void setSsoEnvironment(environment)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {t(`auth:environment.${environment}`)}
                      </span>
                      {selected ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            ) : null}
          </DropdownMenu>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-[43px] z-20 flex justify-center">
        <div className="flex items-center text-[13px] leading-4 text-[#4E5969] dark:text-[#AEB8C4]">
          {PAGE_STATUS_ITEMS.map((item, index) => (
            <span
              key={item}
              className={index === 0 ? 'px-[18px]' : 'border-l border-[#C9CDD4] px-[18px] dark:border-white/15'}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="absolute inset-x-0 top-0 z-20">
        <TitleBar transparent showBrand={false} />
      </div>

    </main>
  );
}
