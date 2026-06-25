/**
 * SSO Login Page
 * 开发模式（pnpm dev）显示 SSO 环境选择；其他构建环境根据 env-config 固定 SSO 环境。
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  Loader2,
  LogIn,
  MapPin,
  Orbit,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ParticleConstellation } from '@/components/common/ParticleConstellation';
import { useAuthStore, type SsoEnvironment } from '@/stores/auth';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import clawxIcon from '@/assets/rectangle_icon.png';

const envConfig = getCurrentEnvConfig();

const DEV_SSO_ENV_OPTIONS: SsoEnvironment[] = [
  'local',
  'daily-external',
  'pre-release',
  'production-internal',
  'production-external',
];

export function Login() {
  const { t } = useTranslation(['auth']);
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn);
  const error = useAuthStore((s) => s.error);
  const accessDenied = useAuthStore((s) => s.accessDenied);
  const accessCheck = useAuthStore((s) => s.accessCheck);
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const login = useAuthStore((s) => s.login);
  const setSsoEnvironment = useAuthStore((s) => s.setSsoEnvironment);
  const clearAccessDenied = useAuthStore((s) => s.clearAccessDenied);

  useEffect(() => {
    if (!envConfig.isDevelopment) {
      void setSsoEnvironment(envConfig.ssoEnvironment as SsoEnvironment);
    }
  }, [setSsoEnvironment]);

  const handleLogin = () => {
    void login(envConfig.isDevelopment ? undefined : (envConfig.ssoEnvironment as SsoEnvironment));
  };

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      style={{ background: 'linear-gradient(135deg, var(--canvas-from), var(--canvas-via), var(--canvas-to))' }}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 neural-grid opacity-40" />
        <div className="absolute -top-24 left-[12%] h-72 w-72 rounded-full bg-cyan-400/18 blur-[110px]" />
        <div className="absolute right-[10%] top-[18%] h-80 w-80 rounded-full bg-[rgba(255,140,0,0.08)] blur-[120px]" />
        <div className="absolute bottom-[-10%] left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-[rgba(255,111,0,0.05)] blur-[120px]" />
        <ParticleConstellation particleCount={34} connectionDistance={140} speed={0.24} />
      </div>

      <TitleBar />

      <div className="relative z-10 flex flex-1 items-center justify-center p-4">
        <div className="glass-panel relative w-[460px] overflow-hidden rounded-[28px] border border-glass-border p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(103,232,249,0.14),_transparent_34%),radial-gradient(circle_at_80%_18%,_rgba(191,219,254,0.16),_transparent_24%)]" />
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />

          <div className="relative space-y-8">
            <div className="flex items-center justify-center gap-2">
              <span className="glow-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]">
                <ShieldCheck className="h-3.5 w-3.5" />
                智能工作台
              </span>
              <span className="glow-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]">
                <Orbit className="h-3.5 w-3.5" />
                安全登录
              </span>
            </div>

            <div className="flex flex-col items-center gap-5">
              <div className="relative">
                <div className="absolute inset-0 rounded-[26px] bg-cyan-400/20 blur-2xl" />
                <div className="relative overflow-hidden rounded-[16px] border border-cyan-300/20 shadow-[0_0_0_1px_rgba(103,232,249,0.12),0_24px_50px_rgba(8,47,73,0.26)]">
                  <img src={clawxIcon} alt="StoClaw" className="h-16 w-16 object-cover" />
                </div>
              </div>

              <div className="space-y-2 text-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-foreground/65">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                  SClaw 智能助手
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
                  {t('auth:login.title')}
                </h1>
                <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                  {t('auth:login.subtitle')}
                </p>
              </div>
            </div>

            {error && error !== 'SSO_LOGIN_CANCELLED' && !accessDenied && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-[0_10px_30px_rgba(127,29,29,0.12)]">
                {t('auth:login.error', { error })}
              </div>
            )}

            {envConfig.isDevelopment && (
              <div className="space-y-2">
                <label htmlFor="sto-sso-env" className="text-xs font-medium uppercase tracking-[0.18em] text-foreground/55">
                  {t('auth:environment.label')}
                </label>
                <Select
                  id="sto-sso-env"
                  value={ssoEnvironment}
                  onChange={(e) => void setSsoEnvironment(e.target.value as SsoEnvironment)}
                  disabled={isLoggingIn}
                  className="h-11 rounded-xl border-white/12"
                >
                  {DEV_SSO_ENV_OPTIONS.map((env) => (
                    <option key={env} value={env}>
                      {t(`auth:environment.${env}`)}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <Button
              className="h-12 w-full rounded-2xl border border-cyan-200/30 bg-[linear-gradient(135deg,rgba(125,211,252,0.98),rgba(56,189,248,0.92))] text-[15px] font-semibold text-slate-950 shadow-[0_18px_44px_rgba(56,189,248,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_56px_rgba(56,189,248,0.32)]"
              size="lg"
              onClick={handleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('auth:login.loggingIn')}
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  {t('auth:login.button')}
                </>
              )}
            </Button>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-foreground/45">连接</div>
                <div className="mt-1 text-sm font-medium text-cyan-200">正常</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-foreground/45">服务</div>
                <div className="mt-1 text-sm font-medium text-white/90">就绪</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-foreground/45">登录</div>
                <div className="mt-1 text-sm font-medium text-emerald-200">安全</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {accessDenied && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-site-access-denied-title"
            className="glass-panel relative w-full max-w-[420px] overflow-hidden rounded-[28px] border border-amber-200/25 p-8 shadow-[0_24px_80px_rgba(120,53,15,0.28)]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_42%),radial-gradient(circle_at_80%_20%,_rgba(248,113,113,0.12),_transparent_28%)]" />
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/70 to-transparent" />

            <button
              type="button"
              onClick={clearAccessDenied}
              className="absolute right-4 top-4 z-10 rounded-xl border border-white/10 bg-white/5 p-2 text-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative space-y-6">
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-50/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-950 shadow-sm">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-800" />
                  访问受限
                </span>
              </div>

              <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-amber-400/25 blur-2xl" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-300/50 bg-[linear-gradient(135deg,rgba(254,243,199,0.95),rgba(253,230,138,0.75))] shadow-[0_0_0_1px_rgba(217,119,6,0.12),0_16px_40px_rgba(120,53,15,0.15)]">
                    <ShieldAlert className="h-8 w-8 text-amber-800" />
                  </div>
                </div>

                <div className="space-y-2">
                  <h2
                    id="client-site-access-denied-title"
                    className="text-2xl font-semibold tracking-[-0.03em] text-foreground"
                  >
                    无法登录
                  </h2>
                  <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                    {error || '您的所属组织无权使用 StoClaw，请联系管理员开通网点访问权限。'}
                  </p>
                </div>
              </div>

              {(accessCheck?.categoryCode || accessCheck?.companyCode) && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-foreground/45">
                      <Building2 className="h-3.5 w-3.5" />
                      组织类型
                    </div>
                    <div className="mt-1.5 text-sm font-semibold text-foreground">
                      {accessCheck.categoryCode || '—'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-foreground/45">
                      <MapPin className="h-3.5 w-3.5" />
                      组织编码
                    </div>
                    <div className="mt-1.5 truncate text-sm font-semibold text-foreground">
                      {accessCheck.companyCode || '—'}
                    </div>
                  </div>
                </div>
              )}

              <p className="rounded-2xl border border-amber-200/40 bg-amber-50/80 px-4 py-3 text-center text-xs leading-5 text-amber-950/80">
                如需开通权限，请联系系统管理员在「客户端网点配置」中将您的组织加入白名单。
              </p>

              <Button
                className="h-12 w-full rounded-2xl border border-amber-200/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.95),rgba(245,158,11,0.9))] text-[15px] font-semibold text-slate-950 shadow-[0_16px_40px_rgba(245,158,11,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_48px_rgba(245,158,11,0.3)]"
                size="lg"
                onClick={clearAccessDenied}
              >
                我知道了
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
