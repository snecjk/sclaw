/**
 * Settings shell — two-column layout: back + nav (left) and section content (right).
 */
import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft, Terminal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  SettingsAgentsIcon,
  SettingsChannelsIcon,
  SettingsGatewayIcon,
  SettingsModelsIcon,
  SettingsPreferencesIcon,
  SettingsUpdatesIcon,
  settingsNavIconClass,
} from '@/components/settings/settings-nav-icons';
import {
  stoSettingsContentPanelBodyClass,
  stoSettingsContentPanelClass,
  stoSettingsContentPanelWrapClass,
  stoSettingsContentInnerClass,
} from '@/lib/surfaces';

export type SettingsSectionId =
  | 'general'
  | 'agents'
  | 'models'
  | 'channels'
  | 'gateway'
  | 'updates'
  | 'developer';

interface SettingsShellProps {
  activeSection: SettingsSectionId;
  devModeUnlocked: boolean;
  children: ReactNode;
}

const SETTINGS_SIDEBAR_WIDTH_CLASS = 'w-[280px]';

type SettingsNavIcon = ComponentType<{ className?: string }>;

interface SettingsNavItem {
  id: SettingsSectionId;
  path: string;
  label: string;
  icon: SettingsNavIcon;
}

const navBtnClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-all',
    active
      ? 'bg-[#E8E8EA] text-[#1D2129] dark:bg-white/[0.08] dark:text-foreground'
      : 'text-[#86909C] hover:bg-[#E8E8EA]/60 hover:text-[#1D2129] dark:text-muted-foreground dark:hover:bg-white/[0.04] dark:hover:text-foreground',
  );

export function SettingsShell({ activeSection, devModeUnlocked, children }: SettingsShellProps) {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const isMac = window.electron?.platform === 'darwin';

  const workspaceItems: SettingsNavItem[] = [
    { id: 'agents', path: '/settings/agents', label: t('common:sidebar.agents'), icon: SettingsAgentsIcon },
    { id: 'models', path: '/settings/models', label: t('common:sidebar.models'), icon: SettingsModelsIcon },
    { id: 'channels', path: '/settings/channels', label: t('common:sidebar.channels'), icon: SettingsChannelsIcon },
  ];

  const systemItems: SettingsNavItem[] = [
    { id: 'gateway', path: '/settings/gateway', label: t('settings:gateway.title'), icon: SettingsGatewayIcon },
    { id: 'updates', path: '/settings/updates', label: t('common:sidebar.checkUpdates'), icon: SettingsUpdatesIcon },
  ];

  return (
    <div className="flex h-full min-h-0 w-full bg-[#F1F1F3] dark:bg-background">
      <nav
        className={cn(
          'flex h-full shrink-0 flex-col items-center bg-[#F1F1F3] p-0 dark:bg-muted/40',
          SETTINGS_SIDEBAR_WIDTH_CLASS,
        )}
      >
        {/* 左侧顶栏拖拽区：macOS 避让红绿灯；Windows 同样需要可拖空白带 */}
        <div
          className={cn(
            'drag-region w-full min-h-[var(--sto-chrome-h)] shrink-0',
            isMac && 'pl-20 pt-[var(--sto-chrome-toggle-inset-top)]',
          )}
          aria-hidden
        />

        <div className="flex w-full flex-col gap-6 px-6 pb-6 pt-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="no-drag flex w-full items-center gap-1.5 py-1.5 text-[14px] font-normal text-[#86909C] transition-colors hover:text-[#1D2129] dark:text-muted-foreground dark:hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
            {t('common:settings.backToHome')}
          </button>

          <div className="flex w-full flex-col gap-5">
            <div>
              <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/55">
                {t('common:settings.sectionGeneral')}
              </p>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className={navBtnClass(activeSection === 'general')}
                >
                  <SettingsPreferencesIcon className={settingsNavIconClass} />
                  {t('settings:appearance.title')}
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/55">
                {t('common:settings.sectionWorkspace')}
              </p>
              <div className="flex flex-col gap-0.5">
                {workspaceItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.path)}
                      className={navBtnClass(activeSection === item.id)}
                    >
                      <item.icon className={settingsNavIconClass} />
                      {item.label}
                    </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/55">
                {t('common:settings.sectionSystem')}
              </p>
              <div className="flex flex-col gap-0.5">
                {systemItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.path)}
                      className={navBtnClass(activeSection === item.id)}
                    >
                      <item.icon className={settingsNavIconClass} />
                      {item.label}
                    </button>
                ))}
              </div>
            </div>

            {devModeUnlocked ? (
              <div>
                <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/55">
                  {t('common:settings.sectionDeveloper')}
                </p>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => navigate('/settings/developer')}
                    className={navBtnClass(activeSection === 'developer')}
                  >
                    <Terminal className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {t('settings:developer.title')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </nav>

      <div className={stoSettingsContentPanelWrapClass}>
        <div className={stoSettingsContentPanelClass}>
          {/* 右侧内容卡顶栏拖拽区：与左侧 chrome 同高，补齐设置页无 TitleBar / ContentHeader 时的空白 */}
          <div
            className="drag-region w-full shrink-0 h-[var(--sto-chrome-h)]"
            aria-hidden
          />
          <div className={stoSettingsContentPanelBodyClass}>
            <div className={stoSettingsContentInnerClass}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
