import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Loader2,
  QrCode,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  CheckCircle,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useChannelsStore } from '@/stores/channels';

import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
  type ChannelMeta,
  type ChannelConfigField,
} from '@/types/channel';
import { buildQrChannelEventName, usesPluginManagedQrAccounts } from '@/lib/channel-alias';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';

interface ChannelConfigModalProps {
  initialSelectedType?: ChannelType | null;
  configuredTypes?: string[];
  showChannelName?: boolean;
  allowExistingConfig?: boolean;
  allowEditAccountId?: boolean;
  existingAccountIds?: string[];
  initialConfigValues?: Record<string, string>;
  agentId?: string;
  accountId?: string;
  onClose: () => void;
  onChannelSaved?: (channelType: ChannelType) => void | Promise<void>;
}

const inputClasses = cn(
  'h-10 rounded-md border-[#E5E6EB] bg-white text-[13px] text-[#1D2129] shadow-none',
  'placeholder:text-[#C9CDD4] focus-visible:ring-2 focus-visible:ring-ring/30',
  'dark:border-border dark:bg-transparent dark:text-foreground dark:placeholder:text-[var(--sto-text-tertiary)]',
);
const labelClasses = 'text-[13px] font-medium text-[#1D2129] dark:text-foreground';
const outlineButtonClasses = cn(
  'h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[13px] font-medium text-[#1D2129] shadow-none',
  'hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]',
);
const primaryButtonClasses = 'h-8 rounded-md px-4 text-[13px] font-medium shadow-none';
const panelClass = cn(
  'relative flex w-full max-w-[560px] max-h-[90vh] flex-col overflow-hidden rounded-[12px]',
  'border border-[#E5E6EB] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.12)]',
  'dark:border-border dark:bg-card',
);
const insetCardClass = cn(
  'rounded-[8px] border border-[#E5E6EB] bg-[#F7F8FA]',
  'dark:border-border dark:bg-muted/30',
);

function normalizeConfigValues(channelType: ChannelType | null, values: Record<string, string>): Record<string, string> {
  if (channelType !== 'dingtalk') return values;
  if (values.cardTemplateKey?.trim()) return values;
  return { ...values, cardTemplateKey: 'content' };
}

export function ChannelConfigModal({
  initialSelectedType = null,
  configuredTypes = [],
  showChannelName = true,
  allowExistingConfig = true,
  allowEditAccountId = false,
  existingAccountIds = [],
  initialConfigValues,
  agentId,
  accountId,
  onClose,
  onChannelSaved,
}: ChannelConfigModalProps) {
  const { t } = useTranslation('channels');
  const { channels, addChannel, fetchChannels } = useChannelsStore();
  const [selectedType, setSelectedType] = useState<ChannelType | null>(initialSelectedType);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [channelName, setChannelName] = useState('');
  const [accountIdInput, setAccountIdInput] = useState(accountId || '');
  const [connecting, setConnecting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isExistingConfig, setIsExistingConfig] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const qrConnectedRef = useRef(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const meta: ChannelMeta | null = selectedType ? CHANNEL_META[selectedType] : null;
  const shouldUseCredentialValidation = true;
  const usesManagedQrAccounts = usesPluginManagedQrAccounts(selectedType);
  const showAccountIdEditor = allowEditAccountId && !usesManagedQrAccounts;
  const resolvedAccountId = usesManagedQrAccounts
    ? (accountId ?? undefined)
    : showAccountIdEditor
      ? accountIdInput.trim()
      : (accountId ?? (agentId ? (agentId === 'main' ? 'default' : agentId) : undefined));

  useEffect(() => {
    setSelectedType(initialSelectedType);
  }, [initialSelectedType]);

  useEffect(() => {
    setAccountIdInput(accountId || '');
  }, [accountId]);

  useEffect(() => {
    if (!selectedType) {
      setConfigValues({});
      setChannelName('');
      setIsExistingConfig(false);
      setValidationResult(null);
      setQrCode(null);
      setConnecting(false);
      return;
    }

    const shouldLoadExistingConfig = allowExistingConfig && configuredTypes.includes(selectedType);
    if (!shouldLoadExistingConfig) {
      setConfigValues(normalizeConfigValues(selectedType, {}));
      setIsExistingConfig(false);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      return;
    }

    if (initialConfigValues) {
      setConfigValues(normalizeConfigValues(selectedType, initialConfigValues));
      setIsExistingConfig(Object.keys(initialConfigValues).length > 0);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);
    setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');

    (async () => {
      try {
        const accountParam = resolvedAccountId ? `?accountId=${encodeURIComponent(resolvedAccountId)}` : '';
        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
          `/api/channels/config/${encodeURIComponent(selectedType)}${accountParam}`
        );
        if (cancelled) return;

        if (result.success && result.values && Object.keys(result.values).length > 0) {
          setConfigValues(normalizeConfigValues(selectedType, result.values));
          setIsExistingConfig(true);
        } else {
          setConfigValues(normalizeConfigValues(selectedType, {}));
          setIsExistingConfig(false);
        }
      } catch {
        if (!cancelled) {
          setConfigValues(normalizeConfigValues(selectedType, {}));
          setIsExistingConfig(false);
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowExistingConfig, configuredTypes, initialConfigValues, resolvedAccountId, selectedType, showChannelName]);

  useEffect(() => {
    if (selectedType && !loadingConfig && showChannelName && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [selectedType, loadingConfig, showChannelName]);

  const finishSave = useCallback(async (channelType: ChannelType) => {
    const displayName = showChannelName && channelName.trim()
      ? channelName.trim()
      : CHANNEL_NAMES[channelType];
    const existingChannel = channels.find((channel) => channel.type === channelType);

    if (!existingChannel) {
      await addChannel({
        type: channelType,
        name: displayName,
        token: meta?.configFields[0]?.key ? configValues[meta.configFields[0].key] : undefined,
      });
    } else {
      await fetchChannels();
    }

    await onChannelSaved?.(channelType);
  }, [addChannel, channelName, channels, configValues, fetchChannels, meta?.configFields, onChannelSaved, showChannelName]);

  const finishSaveRef = useRef(finishSave);
  const onCloseRef = useRef(onClose);
  const onChannelSavedRef = useRef(onChannelSaved);
  const translateRef = useRef(t);

  useEffect(() => {
    finishSaveRef.current = finishSave;
  }, [finishSave]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onChannelSavedRef.current = onChannelSaved;
  }, [onChannelSaved]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  function normalizeQrImageSource(data: { qr?: string; raw?: string }): string | null {
    const qr = typeof data.qr === 'string' ? data.qr.trim() : '';
    if (qr) {
      if (qr.startsWith('data:image') || qr.startsWith('http://') || qr.startsWith('https://')) {
        return qr;
      }
      return `data:image/png;base64,${qr}`;
    }

    const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
    if (!raw) return null;
    if (raw.startsWith('data:image') || raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    return null;
  }

  useEffect(() => {
    if (!selectedType || meta?.connectionType !== 'qr') return;
    const channelType = selectedType;
    qrConnectedRef.current = false;

    const onQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string; raw?: string };
      const nextQr = normalizeQrImageSource(data);
      if (!nextQr) return;
      setQrCode(nextQr);
      setConnecting(false);
    };

    const onSuccess = async (...args: unknown[]) => {
      const data = args[0] as { accountId?: string } | undefined;
      void data?.accountId;
      qrConnectedRef.current = true;
      // 成功只提示一条：微信用「绑定成功」；其它扫码渠道用「{{name}} 连接成功」
      if (channelType === 'wechat') {
        toast.success(translateRef.current('toast.wechatAutoBoundMain'));
      } else {
        toast.success(translateRef.current('toast.qrConnected', { name: CHANNEL_NAMES[channelType] }));
      }
      try {
        try {
          await finishSaveRef.current(channelType);
        } catch (postSaveError) {
          toast.warning(translateRef.current('toast.savedButRefreshFailed'));
          console.warn('Channel saved but post-save refresh failed:', postSaveError);
        }

        if (onChannelSavedRef.current) {
          await onChannelSavedRef.current(channelType);
        } else {
          onCloseRef.current();
        }
      } catch (error) {
        toast.error(translateRef.current('toast.configFailed', { error: String(error) }));
        setConnecting(false);
      }
    };

    const onError = (...args: unknown[]) => {
      const err = typeof args[0] === 'string'
        ? args[0]
        : String((args[0] as { message?: string } | undefined)?.message || args[0]);
      toast.error(translateRef.current('toast.qrFailed', { name: CHANNEL_NAMES[channelType], error: err }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'qr'), onQr);
    const removeSuccessListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'success'), onSuccess);
    const removeErrorListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'error'), onError);

    return () => {
      removeQrListener();
      removeSuccessListener();
      removeErrorListener();
      if (qrConnectedRef.current) {
        return;
      }
      hostApiFetch(`/api/channels/${encodeURIComponent(channelType)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
      }).catch(() => { });
    };
  }, [meta?.connectionType, resolvedAccountId, selectedType]);

  const handleValidate = async () => {
    if (!selectedType || !shouldUseCredentialValidation) return;

    setValidating(true);
    setValidationResult(null);

    try {
      const result = await hostApiFetch<{
        success: boolean;
        valid?: boolean;
        errors?: string[];
        warnings?: string[];
        details?: Record<string, string>;
      }>('/api/channels/credentials/validate', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config: configValues }),
      });

      const warnings = result.warnings || [];
      if (result.valid && result.details) {
        const details = result.details;
        if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
      }

      setValidationResult({
        valid: result.valid || false,
        errors: result.errors || [],
        warnings,
      });
    } catch (error) {
      setValidationResult({
        valid: false,
        errors: [String(error)],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedType || !meta) return;

    setConnecting(true);
    setValidationResult(null);

    try {
      if (showAccountIdEditor) {
        const nextAccountId = accountIdInput.trim();
        if (!nextAccountId) {
          toast.error(t('account.invalidId'));
          setConnecting(false);
          return;
        }
        const duplicateExists = existingAccountIds.some((id) => id === nextAccountId && id !== (accountId || '').trim());
        if (duplicateExists) {
          toast.error(t('account.accountIdExists', { accountId: nextAccountId }));
          setConnecting(false);
          return;
        }
      }

      if (meta.connectionType === 'qr') {
        await hostApiFetch(`/api/channels/${encodeURIComponent(selectedType)}/start`, {
          method: 'POST',
          body: JSON.stringify(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
        });
        return;
      }

      if (meta.connectionType === 'token' && shouldUseCredentialValidation) {
        const validationResponse = await hostApiFetch<{
          success: boolean;
          valid?: boolean;
          errors?: string[];
          warnings?: string[];
          details?: Record<string, string>;
        }>('/api/channels/credentials/validate', {
          method: 'POST',
          body: JSON.stringify({ channelType: selectedType, config: configValues }),
        });

        if (!validationResponse.valid) {
          setValidationResult({
            valid: false,
            errors: validationResponse.errors || ['Validation failed'],
            warnings: validationResponse.warnings || [],
          });
          setConnecting(false);
          return;
        }

        const warnings = validationResponse.warnings || [];
        if (validationResponse.details) {
          const details = validationResponse.details;
          if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
        }

        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
      }

      const config: Record<string, unknown> = { ...configValues };
      const saveResult = await hostApiFetch<{
        success?: boolean;
        error?: string;
        warning?: string;
      }>('/api/channels/config', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config, accountId: resolvedAccountId }),
      });
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        toast.warning(saveResult.warning);
      }

      try {
        await finishSave(selectedType);
      } catch (postSaveError) {
        toast.warning(t('toast.savedButRefreshFailed'));
        console.warn('Channel saved but post-save refresh failed:', postSaveError);
      }

      toast.success(t('toast.channelSaved', { name: meta.name }));
      toast.success(t('toast.channelConnecting', { name: meta.name }));
      await new Promise((resolve) => setTimeout(resolve, 800));
      onClose();
    } catch (error) {
      toast.error(t('toast.configFailed', { error: String(error) }));
      setConnecting(false);
    }
  };

  const isFormValid = () => {
    if (!meta) return false;
    return meta.configFields
      .filter((field) => field.required)
      .every((field) => configValues[field.key]?.trim());
  };

  const updateConfigValue = (key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4 dark:bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={cn(panelClass, !selectedType && 'max-w-3xl')}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E5E6EB] px-5 py-4 dark:border-border">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-tight text-[#1D2129] dark:text-foreground">
              {selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
              {selectedType && isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0 text-[#86909C] hover:bg-[#F7F8FA] hover:text-[#1D2129] dark:text-[var(--sto-icon-tertiary)] dark:hover:bg-white/[0.04] dark:hover:text-[var(--sto-icon-secondary)]"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {!selectedType ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {getPrimaryChannels().map((type) => {
                const channelMeta = CHANNEL_META[type];
                const isConfigured = configuredTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
                    className={cn(
                      'group relative flex items-start gap-3 overflow-hidden rounded-[8px] border border-[#E5E6EB] bg-white p-4 text-left transition-colors',
                      'hover:border-[#C9CDD4] hover:bg-[#F7F8FA]',
                      'dark:border-border dark:bg-transparent dark:hover:bg-white/[0.04]',
                      isConfigured && 'border-green-500/30 bg-green-500/5 dark:bg-green-500/10',
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E6EB] bg-[#F7F8FA] dark:border-border dark:bg-muted/40">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-1 flex-col">
                      <div className="mb-1 flex items-center gap-2">
                        <p className="truncate text-[15px] font-semibold text-[#1D2129] dark:text-foreground">
                          {channelMeta.name}
                        </p>
                        {channelMeta.isPlugin && (
                          <Badge
                            variant="secondary"
                            className="rounded px-1.5 py-0 text-[10px] font-medium border-0 bg-[#F2F3F5] text-[#86909C] shadow-none dark:bg-white/[0.08] dark:text-muted-foreground"
                          >
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                        {t(channelMeta.description.replace('channels:', ''))}
                      </p>
                      <p className="mt-2 text-[12px] font-medium text-[#86909C]/80 dark:text-[var(--sto-text-tertiary)]">
                        {channelMeta.connectionType === 'qr' ? t('dialog.qrCode') : t('dialog.token')}
                      </p>
                    </div>
                    {isConfigured && (
                      <Badge className="absolute right-3 top-3 rounded px-1.5 py-0 text-[10px] font-medium bg-green-600 hover:bg-green-600">
                        {t('configuredBadge')}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ) : qrCode ? (
            <div className="flex flex-col items-center gap-4">
              <div className={cn(insetCardClass, 'inline-flex p-4')}>
                {qrCode.startsWith('data:image') || qrCode.startsWith('http://') || qrCode.startsWith('https://') ? (
                  <img
                    src={qrCode}
                    alt="Scan QR Code"
                    className="h-56 w-56 rounded-[8px] border border-[#E5E6EB] bg-white object-contain"
                  />
                ) : (
                  <div className="flex h-56 w-56 items-center justify-center rounded-[8px] border border-[#E5E6EB] bg-white dark:bg-background">
                    <QrCode className="h-28 w-28 text-[#C9CDD4] dark:text-[var(--sto-icon-tertiary)]" />
                  </div>
                )}
              </div>
              <p className="text-center text-[13px] text-[#86909C] dark:text-muted-foreground">
                {t('dialog.scanQR', { name: meta?.name })}
              </p>
              <Button
                variant="outline"
                className={outlineButtonClasses}
                onClick={() => {
                  setQrCode(null);
                  void handleConnect();
                }}
              >
                {t('dialog.refreshCode')}
              </Button>
            </div>
          ) : loadingConfig ? (
            <div className={cn(insetCardClass, 'flex items-center justify-center py-10')}>
              <Loader2 className="h-5 w-5 animate-spin text-[#86909C] dark:text-[var(--sto-icon-tertiary)]" />
              <span className="ml-2 text-[13px] text-[#86909C] dark:text-[var(--sto-text-tertiary)]">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            <div className="space-y-5">
              {isExistingConfig && (
                <div className="flex items-center gap-2 rounded-[8px] border border-[hsl(var(--link)/0.2)] bg-link-muted px-4 py-3 text-[13px] text-link dark:text-[hsl(var(--link))]">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{t('dialog.existingHint')}</span>
                </div>
              )}

              <div className={cn(insetCardClass, 'space-y-3 p-4')}>
                <div className="min-w-0">
                  <p className={labelClasses}>{t('dialog.howToConnect')}</p>
                  <p className="mt-1 text-[12px] text-[#86909C] dark:text-muted-foreground">
                    {meta ? t(meta.description.replace('channels:', '')) : ''}
                  </p>
                </div>
                <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
                  {meta?.instructions.map((instruction, index) => (
                    <li key={index}>{t(instruction)}</li>
                  ))}
                </ol>
              </div>

              {showChannelName && (
                <div className="space-y-1.5">
                  <Label htmlFor="name" className={labelClasses}>{t('dialog.channelName')}</Label>
                  <Input
                    ref={firstInputRef}
                    id="name"
                    placeholder={t('dialog.channelNamePlaceholder', { name: meta?.name })}
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              )}

              {showAccountIdEditor && (
                <div className="space-y-1.5">
                  <Label htmlFor="account-id" className={labelClasses}>{t('account.customIdLabel')}</Label>
                  <Input
                    id="account-id"
                    value={accountIdInput}
                    onChange={(event) => setAccountIdInput(event.target.value)}
                    placeholder={t('account.customIdPlaceholder')}
                    className={inputClasses}
                  />
                  <p className="text-[12px] text-[#86909C] dark:text-[var(--sto-text-tertiary)]">{t('account.customIdHint')}</p>
                </div>
              )}

              <div className="space-y-4">
                {meta?.configFields.map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    value={configValues[field.key] || ''}
                    onChange={(value) => updateConfigValue(field.key, value)}
                    showSecret={showSecrets[field.key] || false}
                    onToggleSecret={() => toggleSecretVisibility(field.key)}
                  />
                ))}
              </div>

              {validationResult && (
                <div
                  className={cn(
                    'rounded-[8px] border p-4 text-sm',
                    validationResult.valid
                      ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                      : 'border-destructive/20 bg-destructive/10 text-destructive',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {validationResult.valid ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h4 className="mb-1 font-medium">
                        {validationResult.valid ? t('dialog.credentialsVerified') : t('dialog.validationFailed')}
                      </h4>
                      {validationResult.errors.length > 0 && (
                        <ul className="list-inside list-disc space-y-0.5">
                          {validationResult.errors.map((err, index) => (
                            <li key={index}>{err}</li>
                          ))}
                        </ul>
                      )}
                      {validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-1 space-y-0.5 text-green-600 dark:text-green-400">
                          {validationResult.warnings.map((info, index) => (
                            <p key={index} className="text-xs">{info}</p>
                          ))}
                        </div>
                      )}
                      {!validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-2 text-yellow-600 dark:text-yellow-500">
                          <p className="mb-1 text-xs font-medium uppercase">{t('dialog.warnings')}</p>
                          <ul className="list-inside list-disc space-y-0.5">
                            {validationResult.warnings.map((warn, index) => (
                              <li key={index}>{warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator className="bg-[#E5E6EB] dark:bg-border" />

              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-end">
                <div className="flex flex-col gap-2 sm:flex-row">
                  {meta?.connectionType === 'token' && shouldUseCredentialValidation && (
                    <Button
                      variant="outline"
                      onClick={handleValidate}
                      disabled={validating}
                      className={outlineButtonClasses}
                    >
                      {validating ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          {t('dialog.validating')}
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                          {t('dialog.validateConfig')}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      void handleConnect();
                    }}
                    disabled={connecting || !isFormValid() || (showAccountIdEditor && !accountIdInput.trim())}
                    className={primaryButtonClasses}
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        {meta?.connectionType === 'qr' ? t('dialog.generatingQR') : t('dialog.validatingAndSaving')}
                      </>
                    ) : meta?.connectionType === 'qr' ? (
                      t('dialog.generateQRCode')
                    ) : (
                      <>
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        {isExistingConfig ? t('dialog.updateAndReconnect') : t('dialog.saveAndConnect')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function ConfigField({ field, value, onChange, showSecret, onToggleSecret }: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.key} className={labelClasses}>
        {t(field.label)}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder) : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClasses}
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            className="h-10 w-10 shrink-0 rounded-md border-[#E5E6EB] bg-white text-[#86909C] shadow-none hover:bg-[#F7F8FA] hover:text-[#1D2129] dark:border-border dark:bg-transparent dark:text-[var(--sto-icon-tertiary)] dark:hover:bg-white/[0.04] dark:hover:text-[var(--sto-icon-secondary)]"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {field.description && (
        <p className="text-[12px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
          {t(field.description)}
        </p>
      )}
      {field.envVar && (
        <p className="font-mono text-[12px] text-[#86909C]/70 dark:text-[var(--sto-text-tertiary)]">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}
