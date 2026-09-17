/**
 * SSO Login Page
 * 开发模式（pnpm dev）显示 SSO 环境选择；其他构建环境根据 env-config 固定 SSO 环境。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuthStore, type SsoEnvironment } from '@/stores/auth';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import { hostApiFetch } from '@/lib/host-api';
import loginBeforeArtwork from '@/assets/auth/login-before.svg';
import loginAfterArtwork from '@/assets/auth/login-after.svg';
import registrationPendingArtwork from '@/assets/auth/registration-pending.svg';

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

const artworkButtonClass = [
  'no-drag absolute z-10 rounded-[12px] bg-transparent text-transparent',
  'border-0 p-0 outline-none shadow-none focus:outline-none focus-visible:outline-none',
  'disabled:cursor-wait',
].join(' ');

const MAC_ARTWORK_CROP_TOP = 60;
const MAC_ARTWORK_CONTENT_HEIGHT = 900 - MAC_ARTWORK_CROP_TOP;
const macArtworkImageStyle = {
  top: `${-(MAC_ARTWORK_CROP_TOP / MAC_ARTWORK_CONTENT_HEIGHT) * 100}%`,
  height: `${(900 / MAC_ARTWORK_CONTENT_HEIGHT) * 100}%`,
} satisfies CSSProperties;

const ssoEnvironmentTriggerClass = cn(
  'flex h-full w-full items-center justify-between gap-2 rounded-xl border border-[#E5E6EB] bg-white/70 px-3 text-left text-[13px] text-[#1D2129]',
  'shadow-none outline-none backdrop-blur transition-colors hover:bg-white/90',
  'focus-visible:ring-2 focus-visible:ring-[#1D2129]/10',
  'disabled:cursor-not-allowed disabled:opacity-70',
);

const ssoEnvironmentMenuClass = cn(
  'z-50 rounded-xl border border-[#E5E6EB] bg-white/80 p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur',
);

function SsoEnvironmentDropdown({
  value,
  options,
  onChange,
  disabled,
  getLabel,
}: {
  value: SsoEnvironment;
  options: SsoEnvironment[];
  onChange: (value: SsoEnvironment) => void;
  disabled?: boolean;
  getLabel: (value: SsoEnvironment) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          id="sto-sso-env"
          type="button"
          className={ssoEnvironmentTriggerClass}
          disabled={disabled}
          aria-label="SSO 环境"
        >
          <span className="min-w-0 flex-1 truncate">{getLabel(value)}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[#86909C]" aria-hidden strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      {!disabled ? (
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={6}
          avoidCollisions={false}
          className={cn(ssoEnvironmentMenuClass, 'w-[var(--radix-dropdown-menu-trigger-width)]')}
        >
          {options.map((option) => {
            const selected = option === value;
            return (
              <DropdownMenuItem
                key={option}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[#1D2129]',
                  'focus:bg-[#F7F8FA]',
                  selected && 'bg-[#F7F8FA]',
                )}
                onSelect={() => onChange(option)}
              >
                <span className="min-w-0 truncate">{getLabel(option)}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-[#1D2129]" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

export function Login() {
  const { t } = useTranslation(['auth']);
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
    ? registrationPendingArtwork
    : showDeniedArtwork
      ? loginAfterArtwork
      : loginBeforeArtwork;
  const artworkAlt = openingPending
    ? '报名成功，审核中'
    : showDeniedArtwork
      ? '访问受限，等待报名开通'
      : 'SClaw 登录';

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={artwork}
          alt={artworkAlt}
          className="absolute left-0 w-full select-none object-fill"
          style={macArtworkImageStyle}
          draggable={false}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-20 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <TitleBar />
      </div>

      {isLocalDevelopment && !showDeniedArtwork && (
        <div className="no-drag absolute left-[38.194%] top-[45.8%] z-10 h-[4.167%] min-h-9 w-[22.222%]">
          <SsoEnvironmentDropdown
            value={ssoEnvironment}
            options={DEV_SSO_ENV_OPTIONS}
            onChange={(environment) => void setSsoEnvironment(environment)}
            disabled={isLoggingIn}
            getLabel={(environment) => t(`auth:environment.${environment}`)}
          />
        </div>
      )}

      {showDeniedArtwork && !openingPending ? (
        <button
          type="button"
          aria-label="去报名开通"
          title="去报名开通"
          className={`${artworkButtonClass} left-[38.194%] top-[46.190%] h-[5.952%] w-[22.222%]`}
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
          className={`${artworkButtonClass} left-[38.194%] top-[50%] h-[5.952%] w-[22.222%]`}
          disabled={isLoggingIn}
          onClick={handleLogin}
        >
          点击登录
        </button>
      ) : null}

      {(openingError || (error && error !== 'SSO_LOGIN_CANCELLED' && !accessDenied)) && (
        <p
          role="alert"
          className="absolute left-1/2 top-[61%] z-10 max-w-[44%] -translate-x-1/2 rounded bg-white/90 px-3 py-1 text-center text-xs text-red-600"
        >
          {openingError || error}
        </p>
      )}
    </main>
  );
}
