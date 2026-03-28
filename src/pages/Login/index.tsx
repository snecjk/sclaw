/**
 * SSO Login Page
 * Full-screen login page with SSO environment selector and login button.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, LogIn } from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth';
import type { SsoEnvironment } from '@/stores/auth';
import clawxIcon from '@/assets/logo.svg';

const SSO_ENVIRONMENTS: { value: SsoEnvironment; labelKey: string }[] = [
  { value: 'production-external', labelKey: 'auth:environment.production-external' },
  { value: 'daily-external', labelKey: 'auth:environment.daily-external' },
  { value: 'pre-release', labelKey: 'auth:environment.pre-release' },
];

export function Login() {
  const { t } = useTranslation(['auth']);
  const ssoEnvironment = useAuthStore((s) => s.ssoEnvironment);
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const setSsoEnvironment = useAuthStore((s) => s.setSsoEnvironment);

  const [selectedEnv, setSelectedEnv] = useState<SsoEnvironment>(ssoEnvironment);

  const handleEnvChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const env = e.target.value as SsoEnvironment;
    setSelectedEnv(env);
    void setSsoEnvironment(env);
  };

  const handleLogin = () => {
    void login(selectedEnv);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--canvas-from), var(--canvas-via), var(--canvas-to))' }}>
      <TitleBar />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="glass-panel border border-glass-border rounded-2xl w-[420px] p-10 space-y-8">
          {/* Logo & Title */}
          <div className="flex flex-col items-center gap-4">
            <div className="glass-subtle border border-glass-border rounded-2xl p-4">
              <img src={clawxIcon} alt="StoClaw" className="h-12 w-12" />
            </div>
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{t('auth:login.title')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('auth:login.subtitle')}
              </p>
            </div>
          </div>

          {/* Environment Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('auth:environment.label')}
            </label>
            <Select
              value={selectedEnv}
              onChange={handleEnvChange}
              disabled={isLoggingIn}
            >
              {SSO_ENVIRONMENTS.map((env) => (
                <option key={env.value} value={env.value}>
                  {t(env.labelKey)}
                </option>
              ))}
            </Select>
          </div>

          {/* Error Message */}
          {error && error !== 'SSO_LOGIN_CANCELLED' && (
            <div className="rounded-lg glass-subtle border border-destructive/30 px-4 py-3 text-sm text-destructive">
              {t('auth:login.error', { error })}
            </div>
          )}

          {/* Login Button */}
          <Button
            className="w-full"
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
        </div>
      </div>
    </div>
  );
}
