/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Puzzle,
  Lock,
  Package,
  X,
  AlertCircle,
  Plus,
  Key,
  Trash2,
  RefreshCw,
  FolderOpen,
  FileCode,
  Globe,
  Copy,
  ListChecks,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { glassNestedCard, glassSectionSurface } from '@/lib/surfaces';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { toast } from 'sonner';
import type { Skill } from '@/types/skill';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';



// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (slug: string, source?: string) => void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const source = (skill.source || '').trim().toLowerCase();
  if (!source) {
    if (skill.isBundled) return t('source.badge.bundled', { defaultValue: 'Bundled' });
    return t('source.badge.unknown', { defaultValue: 'Unknown source' });
  }
  if (source === 'openclaw-bundled') return t('source.badge.bundled', { defaultValue: 'Bundled' });
  if (source === 'openclaw-managed') return t('source.badge.managed', { defaultValue: 'Managed' });
  if (source === 'openclaw-workspace') return t('source.badge.workspace', { defaultValue: 'Workspace' });
  if (source === 'openclaw-extra') return t('source.badge.extra', { defaultValue: 'Extra dirs' });
  if (source === 'agents-skills-personal') return t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' });
  if (source === 'agents-skills-project') return t('source.badge.agentsProject', { defaultValue: 'Project .agents' });
  return source;
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Initialize config from skill
  useEffect(() => {
    if (!skill) return;

    // API Key
    if (skill.config?.apiKey) {
      setApiKey(String(skill.config.apiKey));
    } else {
      setApiKey('');
    }

    // Env Vars
    if (skill.config?.env) {
      const vars = Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(vars);
    } else {
      setEnvVars([]);
    }
  }, [skill]);

  const handleOpenClawhub = async () => {
    if (!skill?.slug) return;
    await invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
  };

  const handleOpenEditor = async () => {
    if (!skill?.id) return;
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-readme', {
        method: 'POST',
        body: JSON.stringify({ skillKey: skill.id, slug: skill.slug, baseDir: skill.baseDir }),
      });
      if (result.success) {
        toast.success(t('toast.openedEditor'));
      } else {
        toast.error(result.error || t('toast.failedEditor'));
      }
    } catch (err) {
      toast.error(t('toast.failedEditor') + ': ' + String(err));
    }
  };

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving || !skill) return;
    setIsSaving(true);
    try {
      // Build env object, filtering out empty keys
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

      // Use direct file access instead of Gateway RPC for reliability
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        'skill:updateConfig',
        {
          skillKey: skill.id,
          apiKey: apiKey || '', // Empty string will delete the key
          env: envObj // Empty object will clear all env vars
        }
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Refresh skills from gateway to get updated config
      await fetchSkills();

      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-glass-border glass-panel shadow-glass"
        side="right"
      >
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-white dark:bg-accent border border-black/5 dark:border-white/5 shrink-0 mb-4 relative shadow-sm">
              <span className="text-3xl">{skill.icon || '🔧'}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 bg-[hsl(var(--glass-bg)/var(--glass-opacity))] rounded-full p-1 shadow-sm border border-glass-border">
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
            <h2 className="text-[28px] font-serif text-foreground font-normal mb-3 text-center tracking-tight">
              {skill.name}
            </h2>
            <div className="flex items-center justify-center gap-2.5 mb-6 opacity-80">
              <Badge variant="secondary" className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors">
                v{skill.version}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors">
                {skill.isCore ? t('detail.coreSystem') : skill.isBundled ? t('detail.bundled') : t('detail.userInstalled')}
              </Badge>
            </div>

            {skill.description && (
              <p className="text-[14px] text-foreground/70 font-medium leading-[1.6] text-center px-4">
                {skill.description}
              </p>
            )}
          </div>

          <div className="space-y-7 px-1">
            <div className="space-y-2">
              <h3 className="text-[13px] font-bold text-foreground/80">{t('detail.source')}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                  {resolveSkillSourceLabel(skill, t)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={skill.baseDir || t('detail.pathUnavailable')}
                  readOnly
                  className="h-[38px] font-mono text-[12px] bg-[hsl(var(--glass-bg)/0.5)] border-black/10 dark:border-white/10 rounded-xl text-foreground/70"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={handleCopyPath}
                  title={t('detail.copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={() => onOpenFolder?.(skill)}
                  title={t('detail.openActualFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* API Key Section */}
            {!skill.isCore && (
              <div className="space-y-2">
                <h3 className="text-[13px] font-bold flex items-center gap-2 text-foreground/80">
                  <Key className="h-3.5 w-3.5 text-blue-500" />
                  {t('detail.apiKey')}
                </h3>
                <Input
                  placeholder={t('detail.apiKeyPlaceholder', 'Enter API Key (optional)')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  className="h-[44px] font-mono text-[13px] bg-[hsl(var(--glass-bg)/0.5)] border-black/10 dark:border-white/10 rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                />
                <p className="text-[12px] text-foreground/50 mt-2 font-medium">
                  {t('detail.apiKeyDesc', 'The primary API key for this skill. Leave blank if not required or configured elsewhere.')}
                </p>
              </div>
            )}

            {/* Environment Variables Section */}
            {!skill.isCore && (
              <div className="space-y-3">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-bold text-foreground/80">
                      {t('detail.envVars')}
                      {envVars.length > 0 && (
                        <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px] h-5 bg-black/10 dark:bg-white/10 text-foreground">
                          {envVars.length}
                        </Badge>
                      )}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[12px] font-semibold text-foreground/80 gap-1.5 px-2.5 hover:bg-black/5 dark:hover:bg-white/5"
                    onClick={handleAddEnv}
                  >
                    <Plus className="h-3 w-3" strokeWidth={3} />
                    {t('detail.addVariable', 'Add Variable')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {envVars.length === 0 && (
                    <div className="text-[13px] text-foreground/50 font-medium italic flex items-center bg-[hsl(var(--glass-bg)/0.5)] border border-black/5 dark:border-white/5 rounded-xl px-4 py-3 shadow-sm">
                      {t('detail.noEnvVars', 'No environment variables configured.')}
                    </div>
                  )}

                  {envVars.map((env, index) => (
                    <div className="flex items-center gap-3" key={index}>
                      <Input
                        value={env.key}
                        onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                        className="flex-1 h-[40px] font-mono text-[13px] bg-[hsl(var(--glass-bg)/0.5)] border-black/10 dark:border-white/10 rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm text-foreground"
                        placeholder={t('detail.keyPlaceholder', 'Key')}
                      />
                      <Input
                        value={env.value}
                        onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                        className="flex-1 h-[40px] font-mono text-[13px] bg-[hsl(var(--glass-bg)/0.5)] border-black/10 dark:border-white/10 rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm text-foreground"
                        placeholder={t('detail.valuePlaceholder', 'Value')}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-xl transition-colors"
                        onClick={() => handleRemoveEnv(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* External Links */}
            {skill.slug && !skill.isBundled && !skill.isCore && (
              <div className="flex gap-2 justify-center pt-8">
                <Button variant="outline" size="sm" className="h-[28px] text-[11px] font-medium px-3 gap-1.5 rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/70" onClick={handleOpenClawhub}>
                  <Globe className="h-[12px] w-[12px]" />
                  ClawHub
                </Button>
                <Button variant="outline" size="sm" className="h-[28px] text-[11px] font-medium px-3 gap-1.5 rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/70" onClick={handleOpenEditor}>
                  <FileCode className="h-[12px] w-[12px]" />
                  {t('detail.openManual')}
                </Button>
              </div>
            )}
          </div>

          {/* Centered Footer Buttons */}
          <div className="pt-8 pb-4 flex items-center justify-center gap-4 w-full px-2 max-w-[340px] mx-auto">
            {!skill.isCore && (
              <Button
                onClick={handleSaveConfig}
                className={cn(
                  "flex-1 h-[42px] text-[13px] rounded-full font-semibold shadow-sm border border-transparent transition-all",
                  "bg-[#0a84ff] hover:bg-[#007aff] text-white"
                )}
                disabled={isSaving}
              >
                {isSaving ? t('detail.saving') : t('detail.saveConfig')}
              </Button>
            )}\n

            {!skill.isCore && (
              <Button
                variant="outline"
                className="flex-1 h-[42px] text-[13px] rounded-full font-semibold shadow-sm bg-transparent border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-foreground/80 hover:text-foreground"
                onClick={() => {
                  if (!skill.isBundled && onUninstall && skill.slug) {
                    onUninstall(skill.slug, skill.source);
                    onClose();
                  } else {
                    onToggle(!skill.enabled);
                  }
                }}
              >
                {!skill.isBundled && onUninstall
                  ? t('detail.uninstall')
                  : (skill.enabled ? t('detail.disable') : t('detail.enable'))}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    searchError,
    installing,
    // STO
    stoSearchResults,
    stoSearching,
    stoSearchError,
    stoInstalling,
    searchStoSkills,
    installStoSkill,
    uninstallStoSkill,
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [installQuery, setInstallQuery] = useState('');
  const [installSheetOpen, setInstallSheetOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedSource, setSelectedSource] = useState<'all' | 'built-in' | 'marketplace'>('all');
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [activeInstallTab, setActiveInstallTab] = useState<'sto' | 'clawhub'>('sto');
  const [stoSearchQuery, setStoSearchQuery] = useState('');

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  useEffect(() => {
    if (isGatewayRunning) {
      fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  const safeSkills = Array.isArray(skills) ? skills : [];

  // Trigger STO search when tab is active and query changes (debounced)
  useEffect(() => {
    if (activeInstallTab !== 'sto' || !installSheetOpen) return;
    const timer = setTimeout(() => {
      searchStoSkills(stoSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [stoSearchQuery, activeInstallTab, installSheetOpen, searchStoSkills]);

  // Trigger initial STO load when sheet opens on STO tab
  useEffect(() => {
    if (installSheetOpen && activeInstallTab === 'sto') {
      searchStoSkills(stoSearchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installSheetOpen]);

  const filteredStoSkills = stoSearchResults;

  const filteredSkills = safeSkills.filter((skill) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      q.length === 0 ||
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.id.toLowerCase().includes(q) ||
      (skill.slug || '').toLowerCase().includes(q) ||
      (skill.author || '').toLowerCase().includes(q);

    let matchesSource = true;
    if (selectedSource === 'built-in') {
      matchesSource = !!skill.isBundled;
    } else if (selectedSource === 'marketplace') {
      matchesSource = !skill.isBundled;
    }

    return matchesSearch && matchesSource;
  }).sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    return a.name.localeCompare(b.name);
  });

  const sourceStats = {
    all: safeSkills.length,
    builtIn: safeSkills.filter(s => s.isBundled).length,
    marketplace: safeSkills.filter(s => !s.isBundled).length,
  };

  const toggleBatchSelect = useCallback((skillId: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  }, []);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setBatchSelected(new Set());
  }, []);

  const batchToggleSelected = useCallback(async (enable: boolean) => {
    const candidates = filteredSkills.filter(
      (skill) => batchSelected.has(skill.id) && !skill.isCore && skill.enabled !== enable
    );
    if (candidates.length === 0) {
      toast.info(enable ? t('toast.noBatchEnableTargets') : t('toast.noBatchDisableTargets'));
      return;
    }

    let succeeded = 0;
    for (const skill of candidates) {
      try {
        if (enable) {
          await enableSkill(skill.id);
        } else {
          await disableSkill(skill.id);
        }
        succeeded += 1;
      } catch {
        // Continue to next skill and report final summary.
      }
    }

    trackUiEvent('skills.batch_toggle', { enable, total: candidates.length, succeeded });
    if (succeeded === candidates.length) {
      toast.success(enable ? t('toast.batchEnabled', { count: succeeded }) : t('toast.batchDisabled', { count: succeeded }));
    } else {
      toast.warning(t('toast.batchPartial', { success: succeeded, total: candidates.length }));
    }
    exitBatchMode();
  }, [batchSelected, disableSkill, enableSkill, exitBatchMode, filteredSkills, t]);

  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success(t('toast.enabled'));
      } else {
        await disableSkill(skillId);
        toast.success(t('toast.disabled'));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [enableSkill, disableSkill, t]);

  const hasInstalledSkills = safeSkills.some(s => !s.isBundled);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await invokeIpc<string>('openclaw:getSkillsDir');
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await invokeIpc<string>('shell:openPath', skillsDir);
      if (result) {
        if (result.toLowerCase().includes('no such file') || result.toLowerCase().includes('not found') || result.toLowerCase().includes('failed to open')) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleOpenSkillFolder = useCallback(async (skill: Skill) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-path', {
        method: 'POST',
        body: JSON.stringify({
          skillKey: skill.id,
          slug: skill.slug,
          baseDir: skill.baseDir,
        }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to open folder');
      }
    } catch (err) {
      toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
    }
  }, [t]);

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    invokeIpc<string>('openclaw:getSkillsDir')
      .then((dir) => setSkillsDirPath(dir as string))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!installSheetOpen || activeInstallTab !== 'clawhub') {
      return;
    }

    const query = installQuery.trim();
    if (query.length === 0) {
      searchSkills('');
      return;
    }

    const timer = setTimeout(() => {
      searchSkills(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [installQuery, installSheetOpen, activeInstallTab, searchSkills]);

  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug);
      await enableSkill(slug);
      toast.success(t('toast.installed'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (['installTimeoutError', 'installRateLimitError'].includes(errorMessage)) {
        toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
      } else {
        toast.error(t('toast.failedInstall') + ': ' + errorMessage);
      }
    }
  }, [installSkill, enableSkill, t, skillsDirPath]);

  const handleUninstall = useCallback(async (slug: string, source?: string) => {
    try {
      // Use STO uninstall for sto-marketplace skills
      if (source === 'sto-marketplace') {
        await uninstallStoSkill(slug);
      } else {
        await uninstallSkill(slug);
      }
      toast.success(t('toast.uninstalled'));
    } catch (err) {
      toast.error(t('toast.failedUninstall') + ': ' + String(err));
    }
  }, [uninstallSkill, uninstallStoSkill, t]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col pb-10">
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 pb-10">
      <header className="shrink-0 border-b border-primary/10 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/[0.08] text-primary shadow-[0_8px_24px_rgba(56,189,248,0.12)]">
              <Puzzle className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.65rem]">
                {t('title')}
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">
            {hasInstalledSkills && (
              <Button
                type="button"
                variant="outline"
                onClick={handleOpenSkillsFolder}
                className="h-9 rounded-md border-glass-border bg-transparent px-4 text-[13px] font-medium shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)]"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                {t('openFolder')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {showGatewayWarning && (
          <div className="flex items-center gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        <section className={glassSectionSurface}>
        <div className="flex flex-col gap-4 border-b border-primary/10 pb-4 mb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center flex-wrap gap-4 text-[14px]">
            <div className="group relative mr-2 flex items-center rounded-md border border-transparent bg-black/5 px-3 py-1.5 transition-colors focus-within:border-primary/15 focus-within:bg-[hsl(var(--glass-bg)/0.25)] dark:bg-white/5 dark:focus-within:bg-white/10">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ml-2 bg-transparent outline-none w-28 md:w-40 font-normal placeholder:text-foreground/50 text-[13px] text-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-6">
              <button
                onClick={() => setSelectedSource('all')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'all' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.all', { count: sourceStats.all })}
              </button>
              <button
                onClick={() => setSelectedSource('built-in')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'built-in' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.builtIn', { count: sourceStats.builtIn })}
              </button>
              <button
                onClick={() => setSelectedSource('marketplace')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'marketplace' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.marketplace', { count: sourceStats.marketplace })}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setBatchMode(true); setBatchSelected(new Set()); }}
              className="h-8 rounded-md border-glass-border bg-transparent px-3 text-[13px] font-medium shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)]"
            >
              <ListChecks className="h-4 w-4 mr-1.5" />
              {t('actions.batchManage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setInstallQuery('');
                setInstallSheetOpen(true);
              }}
              className="h-8 rounded-md border-glass-border bg-transparent px-3 text-[13px] font-medium shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)]"
            >
              {t('actions.installSkill')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchSkills}
              disabled={!isGatewayRunning}
              className="ml-1 h-8 w-8 rounded-md border-glass-border bg-transparent text-muted-foreground shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)] hover:text-foreground"
              title={t('refresh')}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Batch mode toolbar */}
        {batchMode && (
          <div className="flex items-center gap-3 mb-4 shrink-0 px-1">
            <span className="text-[13px] text-foreground/70 font-medium">
              {t('actions.batchSelected', { count: batchSelected.size })}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const allSelectableIds = filteredSkills.filter(s => !s.isCore).map(s => s.id);
                  setBatchSelected((prev) => prev.size === allSelectableIds.length ? new Set() : new Set(allSelectableIds));
                }}
                className="h-8 rounded-md border-glass-border bg-transparent px-3 text-[13px] font-medium shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)]"
              >
                {batchSelected.size === filteredSkills.filter(s => !s.isCore).length && batchSelected.size > 0
                  ? t('actions.deselectAll')
                  : t('actions.selectAll')}
              </Button>
              <Button
                size="sm"
                disabled={batchSelected.size === 0}
                onClick={() => batchToggleSelected(true)}
                className="h-8 text-[13px] font-medium rounded-md px-3 shadow-none"
              >
                {t('actions.batchEnable')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={batchSelected.size === 0}
                onClick={() => batchToggleSelected(false)}
                className="h-8 rounded-md border-glass-border bg-transparent px-3 text-[13px] font-medium shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)]"
              >
                {t('actions.batchDisable')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={exitBatchMode}
                className="h-8 text-[13px] font-medium rounded-md px-3 hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-muted-foreground"
              >
                {t('actions.batchCancel')}
              </Button>
            </div>
          </div>
        )}

        <div className="pb-2">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm font-medium text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError'].includes(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
            {filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            ) : (
              filteredSkills.map((skill) => {
                const isSelected = batchSelected.has(skill.id);
                const isSelectable = batchMode && !skill.isCore;
                return (
                  <div
                    key={skill.id}
                    className={cn(
                      'group flex flex-col cursor-pointer rounded-md border border-primary/10 p-4 transition-all duration-200 hover:border-primary/18 hover:shadow-md',
                      glassNestedCard,
                      isSelected && 'ring-2 ring-primary/50',
                    )}
                    onClick={() => {
                      if (batchMode) {
                        if (isSelectable) toggleBatchSelect(skill.id);
                      } else {
                        setSelectedSkill(skill);
                      }
                    }}
                  >
                    {/* 顶部: 圆形图标 + 名称 + 标签 */}
                    <div className="flex items-start gap-3 mb-3">
                      {batchMode ? (
                        <div
                          className={cn(
                            'h-12 w-12 shrink-0 flex items-center justify-center rounded-full border transition-colors',
                            skill.isCore
                              ? 'bg-muted/50 border-black/5 dark:border-white/5 cursor-not-allowed'
                              : isSelected
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'glass border hover:border-primary/40'
                          )}
                        >
                          {isSelected ? (
                            <Check className="h-5 w-5" strokeWidth={2.5} />
                          ) : (
                            <span className="text-2xl">{skill.icon || '🧩'}</span>
                          )}
                        </div>
                      ) : (
                        <div className="h-12 w-12 shrink-0 flex items-center justify-center text-2xl rounded-full glass border shadow-sm">
                          {skill.icon || '🧩'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                          {skill.isCore && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                          {skill.isBundled && <Puzzle className="h-3 w-3 text-blue-500/70 shrink-0" />}
                        </div>
                        {skill.slug && skill.slug !== skill.name && (
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-black/10 dark:border-white/10 text-muted-foreground mt-1 inline-block">
                            {skill.slug}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 描述 */}
                    <p className="text-[13px] text-muted-foreground line-clamp-2 mb-3 flex-1 leading-relaxed">
                      {skill.description}
                    </p>

                    {/* 底部: 来源 + 版本 + 开关 */}
                    <div className="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/5" onClick={e => { if (!batchMode) e.stopPropagation(); }}>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-medium bg-black/5 dark:bg-white/10 border-0 shadow-none">
                          {resolveSkillSourceLabel(skill, t)}
                        </Badge>
                        {skill.version && (
                          <span className="text-[11px] font-mono text-muted-foreground">v{skill.version}</span>
                        )}
                      </div>
                      {!batchMode && (
                        <Switch
                          checked={skill.enabled}
                          onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                          disabled={skill.isCore}
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        </section>
      </div>

      <Sheet open={installSheetOpen} onOpenChange={(open) => {
        setInstallSheetOpen(open);
        if (!open) {
          setActiveInstallTab('sto');
          setStoSearchQuery('');
        }
      }}>
        <SheetContent
          className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-glass-border glass-panel shadow-glass"
          side="right"
        >
          {/* Title area */}
          <div className="px-8 pt-8 pb-4">
            <h2 className="text-[28px] font-serif text-foreground font-normal tracking-tight">{t('marketplace.installDialogTitle')}</h2>
            <p className="mt-2 text-[14px] text-foreground/70 font-medium">{t('marketplace.installDialogSubtitle')}</p>
          </div>

          {/* Tabs wrapper */}
          <Tabs
            value={activeInstallTab}
            onValueChange={(v) => setActiveInstallTab(v as 'sto' | 'clawhub')}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="px-8 pb-4">
              <TabsList className="w-full">
                <TabsTrigger value="sto" className="flex-1">{t('marketplace.installTabs.stoPlaza')}</TabsTrigger>
                <TabsTrigger value="clawhub" className="flex-1">{t('marketplace.installTabs.officialClawHub')}</TabsTrigger>
              </TabsList>
            </div>

            {/* === STO Tab === */}
            <TabsContent value="sto" className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=inactive]:hidden">
              <div className="px-8 py-4 border-b border-black/5 dark:border-white/5">
                <div className="relative flex items-center glass rounded-xl px-3 py-2 border">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    placeholder={t('marketplace.installTabs.stoSearchPlaceholder')}
                    value={stoSearchQuery}
                    onChange={(e) => setStoSearchQuery(e.target.value)}
                    className="ml-2 h-auto border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px]"
                  />
                  {stoSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setStoSearchQuery('')}
                      className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-8 py-6">
                {stoSearching ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <LoadingSpinner className="h-6 w-6 mb-4" />
                    <p>{t('marketplace.installTabs.stoSearching')}</p>
                  </div>
                ) : stoSearchError ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <AlertCircle className="h-10 w-10 mb-4 opacity-50 text-destructive" />
                    <p>{t('marketplace.installTabs.stoSearchError')}</p>
                  </div>
                ) : filteredStoSkills.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {filteredStoSkills.map((skill) => {
                      const isStoInstalling = stoInstalling[skill.slug];
                      // Use case-insensitive comparison because Gateway lowercases the skillKey
                      const isAlreadyInstalled = safeSkills.some(s =>
                        (s.slug && s.slug.toLowerCase() === skill.slug.toLowerCase())
                        || s.id.toLowerCase() === skill.slug.toLowerCase()
                      );
                      return (
                        <div
                          key={skill.slug}
                          className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-b border-black/5 dark:border-white/5 last:border-0"
                        >
                          <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                            <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl glass border rounded-xl overflow-hidden">
                              📦
                            </div>
                            <div className="flex flex-col overflow-hidden">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                                {skill.author && (
                                  <span className="text-xs text-muted-foreground">• {skill.author}</span>
                                )}
                              </div>
                              <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                                {skill.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            {skill.version && (
                              <span className="text-[13px] font-mono text-muted-foreground mr-2">
                                v{skill.version}
                              </span>
                            )}
                            {isAlreadyInstalled ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                              >
                                {t('marketplace.installed')}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isStoInstalling}
                                onClick={async () => {
                                  try {
                                    await installStoSkill(skill.slug, skill.version, {
                                      name: skill.name,
                                      description: skill.description,
                                      author: skill.author,
                                    });
                                    toast.success(t('marketplace.installSuccess', { name: skill.name }));
                                  } catch (err) {
                                    toast.error(t('marketplace.installError', { error: String(err) }));
                                  }
                                }}
                                className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                              >
                                {isStoInstalling ? (
                                  <LoadingSpinner className="h-3 w-3 mr-1" />
                                ) : null}
                                {isStoInstalling ? t('marketplace.installing') : t('marketplace.install')}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Package className="h-10 w-10 mb-4 opacity-50" />
                    <p>{stoSearchQuery.trim() ? t('marketplace.installTabs.stoNoResults') : t('marketplace.installTabs.stoEmptyPrompt')}</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* === ClawHub Tab === */}
            <TabsContent value="clawhub" className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=inactive]:hidden">
              <div className="px-8 py-4 border-b border-black/5 dark:border-white/5">
                <div className="flex flex-col md:flex-row gap-2">
                  <div className="relative flex items-center glass rounded-xl px-3 py-2 border flex-1">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Input
                      placeholder={t('searchMarketplace')}
                      value={installQuery}
                      onChange={(e) => setInstallQuery(e.target.value)}
                      className="ml-2 h-auto border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px]"
                    />
                    {installQuery && (
                      <button
                        type="button"
                        onClick={() => setInstallQuery('')}
                        className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    disabled
                    className="h-10 rounded-xl border-black/10 dark:border-white/10 bg-transparent text-muted-foreground"
                  >
                    {t('marketplace.sourceLabel')}: {t('marketplace.sourceClawHub')}
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-8 py-6">
                {searchError && (
                  <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <span>
                      {['searchTimeoutError', 'searchRateLimitError', 'timeoutError', 'rateLimitError'].includes(searchError.replace('Error: ', ''))
                        ? t(`toast.${searchError.replace('Error: ', '')}`, { path: skillsDirPath })
                        : t('marketplace.searchError')}
                    </span>
                  </div>
                )}

                {searching && (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <LoadingSpinner size="lg" />
                    <p className="mt-4 text-sm">{t('marketplace.searching')}</p>
                  </div>
                )}

                {!searching && searchResults.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {searchResults.map((skill) => {
                      // Use case-insensitive comparison for slug, and also match by name
                      const isInstalled = safeSkills.some(s =>
                        s.id.toLowerCase() === skill.slug.toLowerCase()
                        || (s.slug && s.slug.toLowerCase() === skill.slug.toLowerCase())
                        || s.name === skill.name
                      );
                      const isInstallLoading = !!installing[skill.slug];

                      return (
                        <div
                          key={skill.slug}
                          className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                          onClick={() => invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`)}
                        >
                          <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                            <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl glass border rounded-xl overflow-hidden">
                              📦
                            </div>
                            <div className="flex flex-col overflow-hidden">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                                {skill.author && (
                                  <span className="text-xs text-muted-foreground">• {skill.author}</span>
                                )}
                              </div>
                              <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                                {skill.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 shrink-0" onClick={e => e.stopPropagation()}>
                            {skill.version && (
                              <span className="text-[13px] font-mono text-muted-foreground mr-2">
                                v{skill.version}
                              </span>
                            )}
                            {isInstalled ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleUninstall(skill.slug)}
                                disabled={isInstallLoading}
                                className="h-8 shadow-none"
                              >
                                {isInstallLoading ? <LoadingSpinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            ) : (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleInstall(skill.slug)}
                                disabled={isInstallLoading}
                                className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                              >
                                {isInstallLoading ? <LoadingSpinner size="sm" /> : t('marketplace.install', 'Install')}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!searching && searchResults.length === 0 && !searchError && (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Package className="h-10 w-10 mb-4 opacity-50" />
                    <p>{installQuery.trim() ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={selectedSkill}
        isOpen={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled });
        }}
        onUninstall={handleUninstall}
        onOpenFolder={handleOpenSkillFolder}
      />
    </div>
  );
}

export default Skills;
