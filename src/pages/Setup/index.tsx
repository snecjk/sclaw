/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  FileText,
  Monitor,
  MemoryStick,
  HardDrive,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
// import { SUPPORTED_LANGUAGES } from '@/i18n';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
interface SetupStep {
  id: string;
  title: string;
  description: string;
}

const STEP = {
  WELCOME: 0,
  RUNTIME: 1,
  COMPLETE: 2,
} as const;

const getSteps = (t: TFunction): SetupStep[] => [
  {
    id: 'welcome',
    title: t('steps.welcome.title'),
    description: t('steps.welcome.description'),
  },
  {
    id: 'runtime',
    title: t('steps.runtime.title'),
    description: t('steps.runtime.description'),
  },
  {
    id: 'complete',
    title: t('steps.complete.title'),
    description: t('steps.complete.description'),
  },
];

import clawxIcon from '@/assets/logo.svg';

// NOTE: Channel types moved to Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const { t } = useTranslation(['setup', 'channels']);
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<number>(STEP.WELCOME);

  const [installationState, setInstallationState] = useState<'idle' | 'installing' | 'complete' | 'error' | 'skipped'>('idle');
  const [installationProgress, setInstallationProgress] = useState(0);
  const [installationError, setInstallationError] = useState<string | null>(null);
  const installationAttemptRef = useRef(0);
  const steps = getSteps(t);
  const safeStepIndex = Number.isInteger(currentStep)
    ? Math.min(Math.max(currentStep, STEP.WELCOME), steps.length - 1)
    : STEP.WELCOME;
  const step = steps[safeStepIndex] ?? steps[STEP.WELCOME];
  const isFirstStep = safeStepIndex === STEP.WELCOME;
  const isLastStep = safeStepIndex === steps.length - 1;

  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);

  // Derive canProceed based on current step - computed directly to avoid useEffect
  const canProceed = useMemo(() => {
    switch (safeStepIndex) {
      case STEP.WELCOME:
        return true;
      case STEP.RUNTIME:
        return true;
      case STEP.COMPLETE:
        return installationState === 'complete' || installationState === 'skipped';
      default:
        return true;
    }
  }, [installationState, safeStepIndex]);

  const runInstallation = useCallback(async () => {
    const attempt = installationAttemptRef.current + 1;
    installationAttemptRef.current = attempt;
    setInstallationState('installing');
    setInstallationProgress(10);
    setInstallationError(null);

    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>('uv:install-all');
      if (installationAttemptRef.current !== attempt) return;

      if (!result.success) {
        setInstallationState('error');
        setInstallationError(result.error || t('installing.unknownError'));
        toast.error(t('installing.failedToast'));
        return;
      }

      setInstallationProgress(100);
      setInstallationState('complete');
    } catch (error) {
      if (installationAttemptRef.current !== attempt) return;
      setInstallationState('error');
      setInstallationError(String(error));
      toast.error(t('installing.failedToast'));
    }
  }, [t]);

  const handleNext = async () => {
    if (isLastStep) {
      // Complete setup
      markSetupComplete();
      toast.success(t('complete.title'));
      navigate('/');
    } else {
      setCurrentStep((i) => i + 1);
      if (safeStepIndex === STEP.RUNTIME && installationState === 'idle') {
        void runInstallation();
      }
    }
  };

  const handleBack = () => {
    setCurrentStep((i) => Math.max(i - 1, 0));
  };

  const handleSkip = () => {
    markSetupComplete();
    navigate('/');
  };

  const handleSkipInstallation = () => {
    installationAttemptRef.current += 1;
    setInstallationState('skipped');
    setInstallationError(null);
  };


  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--canvas-from), var(--canvas-via), var(--canvas-to))' }}>
      <TitleBar />
      <div className="flex-1 overflow-auto">
        {/* Progress Indicator */}
        <div className="flex justify-center pt-8">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                    i < safeStepIndex
                      ? 'border-primary bg-primary text-primary-foreground'
                      : i === safeStepIndex
                        ? 'border-primary text-primary'
                        : 'border-muted-foreground/40 text-muted-foreground/60'
                  )}
                >
                  {i < safeStepIndex ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm">{i + 1}</span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={cn(
                      'h-0.5 w-8 transition-colors',
                      i < safeStepIndex ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mx-auto max-w-2xl p-8"
          >
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold mb-2">{t(`steps.${step.id}.title`)}</h1>
              <p className="text-muted-foreground">{t(`steps.${step.id}.description`)}</p>
            </div>

            {/* Step-specific content */}
            <div className="glass-panel border border-glass-border rounded-2xl p-8 mb-8">
              {safeStepIndex === STEP.WELCOME && <WelcomeContent />}
              {safeStepIndex === STEP.RUNTIME && <RuntimeContent />}
              {safeStepIndex === STEP.COMPLETE && (
                <CompleteContent
                  state={installationState}
                  progress={installationProgress}
                  errorMessage={installationError}
                  onRetry={runInstallation}
                  onSkip={handleSkipInstallation}
                />
              )}
            </div>

            <div className="flex justify-between">
              <div>
                {!isFirstStep && (
                  <Button
                    variant="ghost"
                    onClick={handleBack}
                    disabled={isLastStep && installationState === 'installing'}
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    {t('nav.back')}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {!isLastStep && safeStepIndex !== STEP.RUNTIME && (
                  <Button variant="ghost" onClick={handleSkip}>
                    {t('nav.skipSetup')}
                  </Button>
                )}
                <Button onClick={handleNext} disabled={!canProceed}>
                  {isLastStep ? (
                    t('nav.getStarted')
                  ) : (
                    <>
                      {t('nav.next')}
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  const { t } = useTranslation(['setup', 'settings']);
  // const { language, setLanguage } = useSettingsStore();

  return (
    <div className="text-center space-y-4">
      <div className="mb-4 flex justify-center">
        <div className="glass-subtle border border-glass-border rounded-2xl p-4">
          <img src={clawxIcon} alt="StoClaw" className="h-16 w-16" />
        </div>
      </div>
      <h2 className="text-xl font-semibold">{t('welcome.title')}</h2>
      <p className="text-muted-foreground">
        {t('welcome.description')}
      </p>

      {/* Language Selector */}
      {/*<div className="flex justify-center gap-2 py-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Button
            key={lang.code}
            variant={language === lang.code ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setLanguage(lang.code)}
            className="h-7 text-xs"
          >
            {lang.label}
          </Button>
        ))}
      </div>*/}

      <ul className="text-left space-y-3 pt-2">
        <li className="flex items-center gap-3 p-2.5 rounded-lg glass-subtle border border-glass-border">
          <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400 shrink-0" />
          <span className="text-foreground/80">{t('welcome.features.noCommand')}</span>
        </li>
        <li className="flex items-center gap-3 p-2.5 rounded-lg glass-subtle border border-glass-border">
          <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400 shrink-0" />
          <span className="text-foreground/80">{t('welcome.features.modernUI')}</span>
        </li>
        <li className="flex items-center gap-3 p-2.5 rounded-lg glass-subtle border border-glass-border">
          <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400 shrink-0" />
          <span className="text-foreground/80">{t('welcome.features.bundles')}</span>
        </li>
        <li className="flex items-center gap-3 p-2.5 rounded-lg glass-subtle border border-glass-border">
          <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400 shrink-0" />
          <span className="text-foreground/80">{t('welcome.features.crossPlatform')}</span>
        </li>
      </ul>
    </div>
  );
}

interface SystemSummary {
  operatingSystem: string;
  architecture: string;
  cpuModel: string | null;
  logicalCores: number;
  nodeVersion: string;
  memory: {
    availableBytes: number;
    totalBytes: number;
  };
  disk: {
    availableBytes: number;
    totalBytes: number;
  } | null;
}

function formatCapacity(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 GB';
  const gigabytes = bytes / 1024 ** 3;
  return `${gigabytes >= 100 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`;
}

function availablePercentage(availableBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((availableBytes / totalBytes) * 100)));
}

function RuntimeContent() {
  const { t } = useTranslation('setup');
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const nextSummary = await invokeIpc<SystemSummary>('system:summary');
      setSummary(nextSummary);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;
    void invokeIpc<SystemSummary>('system:summary')
      .then((nextSummary) => {
        if (isActive) setSummary(nextSummary);
      })
      .catch(() => {
        if (isActive) setLoadFailed(true);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const memoryPercent = summary
    ? availablePercentage(summary.memory.availableBytes, summary.memory.totalBytes)
    : 0;
  const diskPercent = summary?.disk
    ? availablePercentage(summary.disk.availableBytes, summary.disk.totalBytes)
    : 0;

  const handleShowLogs = async () => {
    if (showLogs) {
      setShowLogs(false);
      return;
    }

    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
    } catch {
      setLogContent(t('runtime.logs.loadFailed'));
    }
    setShowLogs(true);
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (logDir) await invokeIpc('shell:showItemInFolder', logDir);
    } catch {
      // The inline log viewer remains available if the folder cannot be opened.
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">{t('runtime.title')}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleShowLogs} aria-expanded={showLogs}>
            <FileText className="mr-2 h-4 w-4" />
            {t('runtime.viewLogs')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadSummary}
            disabled={isLoading}
            aria-label={t('runtime.refresh')}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'motion-safe:animate-spin')} />
            {t('runtime.refresh')}
          </Button>
        </div>
      </div>

      <section
        className="overflow-hidden rounded-xl border border-glass-border bg-[hsl(var(--glass-bg)/0.28)]"
        aria-busy={isLoading}
        aria-label={t('runtime.title')}
      >
        <div className="flex items-center justify-between gap-4 border-b border-glass-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('runtime.nodejs')}</p>
              <p className="truncate text-xs text-muted-foreground">
                {summary?.nodeVersion ? `v${summary.nodeVersion}` : t('runtime.bundledRuntime')}
              </p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium text-[var(--sto-success-primary)]">
            {t('runtime.nodeReady')}
          </span>
        </div>

        <div className="flex min-h-28 items-center gap-4 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Monitor className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{t('runtime.system')}</p>
            {isLoading && !summary ? (
              <div className="mt-2 space-y-2" aria-label={t('runtime.loading')}>
                <div className="h-5 w-48 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-3.5 w-64 max-w-full rounded bg-muted/70 motion-safe:animate-pulse" />
              </div>
            ) : (
              <>
                <p className="mt-1 truncate text-lg font-semibold tracking-tight">
                  {summary ? `${summary.operatingSystem} · ${summary.architecture}` : t('runtime.unavailable')}
                </p>
                {summary && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {summary.cpuModel || t('runtime.processor', { count: summary.logicalCores })}
                    {summary.cpuModel && ` · ${t('runtime.processor', { count: summary.logicalCores })}`}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid border-t border-glass-border sm:grid-cols-2 sm:divide-x sm:divide-glass-border">
          <DeviceCapacity
            icon={MemoryStick}
            label={t('runtime.memory')}
            availableBytes={summary?.memory.availableBytes}
            totalBytes={summary?.memory.totalBytes}
            percentage={memoryPercent}
            isLoading={isLoading && !summary}
          />
          <DeviceCapacity
            icon={HardDrive}
            label={t('runtime.disk')}
            availableBytes={summary?.disk?.availableBytes}
            totalBytes={summary?.disk?.totalBytes}
            percentage={diskPercent}
            isLoading={isLoading && !summary}
            className="border-t border-glass-border sm:border-t-0"
          />
        </div>
      </section>

      <p className={cn(
        'flex items-center gap-2 text-xs text-muted-foreground',
        loadFailed && 'text-amber-600 dark:text-amber-400',
      )}>
        {loadFailed && <AlertCircle className="h-4 w-4 shrink-0" />}
        {loadFailed ? t('runtime.loadError') : t('runtime.hint')}
      </p>

      {showLogs && (
        <div className="rounded-xl border border-glass-border bg-[hsl(var(--glass-bg)/0.28)] p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{t('runtime.logs.title')}</p>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleOpenLogDir}>
              <ExternalLink className="mr-1 h-3 w-3" />
              {t('runtime.logs.openFolder')}
            </Button>
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[hsl(var(--glass-bg)/0.5)] p-3 font-mono text-xs text-muted-foreground">
            {logContent || t('runtime.logs.noLogs')}
          </pre>
        </div>
      )}
    </div>
  );
}

interface DeviceCapacityProps {
  icon: typeof MemoryStick;
  label: string;
  availableBytes?: number;
  totalBytes?: number;
  percentage: number;
  isLoading: boolean;
  className?: string;
}

function DeviceCapacity({
  icon: Icon,
  label,
  availableBytes,
  totalBytes,
  percentage,
  isLoading,
  className,
}: DeviceCapacityProps) {
  const { t } = useTranslation('setup');
  const hasCapacity = availableBytes !== undefined && totalBytes !== undefined;

  return (
    <div className={cn('min-w-0 p-5', className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        <span>{label}</span>
      </div>
      {isLoading ? (
        <div className="mt-3 space-y-3">
          <div className="h-6 w-24 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-1.5 w-full rounded-full bg-muted motion-safe:animate-pulse" />
        </div>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
            {hasCapacity ? formatCapacity(availableBytes) : t('runtime.unavailable')}
          </p>
          {hasCapacity && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('runtime.capacityMeta', {
                  total: formatCapacity(totalBytes),
                  percentage,
                })}
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

interface CompleteContentProps {
  state: 'idle' | 'installing' | 'complete' | 'error' | 'skipped';
  progress: number;
  errorMessage: string | null;
  onRetry: () => void;
  onSkip: () => void;
}

function CompleteContent({ state, progress, errorMessage, onRetry, onSkip }: CompleteContentProps) {
  const { t } = useTranslation('setup');
  const isReady = state === 'complete' || state === 'skipped';

  if (!isReady) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-2xl">
            ⚙️
          </div>
          <h2 className="mb-2 text-xl font-semibold">{t('installing.title')}</h2>
          <p className="text-muted-foreground">{t('installing.subtitle')}</p>
        </div>

        {state !== 'error' && (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('installing.progress')}</span>
              <span className="font-medium tabular-nums text-primary">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-glass-border bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <p className="pt-1 text-center text-sm text-muted-foreground">{t('installing.wait')}</p>
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-xl border border-destructive/30 bg-[hsl(var(--glass-bg)/0.28)] p-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-red-500 dark:text-red-400">{t('installing.error')}</p>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[hsl(var(--glass-bg)/0.5)] p-3 font-mono text-xs text-muted-foreground">
                  {errorMessage}
                </pre>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="text-muted-foreground" onClick={onSkip}>
            {t('installing.skip')}
          </Button>
          {state === 'error' && (
            <Button onClick={onRetry}>{t('installing.retry')}</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="text-center space-y-6">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-xl font-semibold">{t('complete.title')}</h2>
      <p className="text-muted-foreground">
        {state === 'skipped' ? t('complete.skippedSubtitle') : t('complete.subtitle')}
      </p>

      <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-glass-border bg-[hsl(var(--glass-bg)/0.28)] text-left">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <span>{t('complete.components')}</span>
          <span className={cn(
            'font-medium',
            state === 'complete'
              ? 'text-[var(--sto-success-primary)]'
              : 'text-muted-foreground',
          )}>
            {state === 'complete' ? t('complete.envReady') : t('complete.skipped')}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t('complete.footer')}
      </p>
    </div>
  );
}

export default Setup;
