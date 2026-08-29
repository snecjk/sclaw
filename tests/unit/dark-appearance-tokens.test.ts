import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chatProcessLoadingTextClass,
  chatProcessSecondaryTextClass,
  chatThinkingSummaryHeaderClass,
  chatToolCallHeaderBtnClass,
  chatToolCallInputPreClass,
  sidebarNavExpandedActiveClass,
  sidebarNavExpandedIdleClass,
  sidebarSubitemTextActiveClass,
  skillPickerShellClass,
} from '@/lib/surfaces';

const globalsCss = readFileSync(
  resolve(process.cwd(), 'src/styles/globals.css'),
  'utf8',
);
const themeTokensCss = readFileSync(
  resolve(process.cwd(), 'src/styles/theme/tokens.css'),
  'utf8',
);
const chatProcessBlockSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat/chat-process-block.tsx'),
  'utf8',
);
const chatToolCallCardSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat/chat-tool-call-card.tsx'),
  'utf8',
);
const thinkingTurnProcessSource = readFileSync(
  resolve(process.cwd(), 'src/pages/Chat/thinking/thinking-turn-process.tsx'),
  'utf8',
);
const sidebarHeaderToggleSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/sidebar-header-toggle.tsx'),
  'utf8',
);
const sidebarSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'),
  'utf8',
);
const accountSwitchMenuItemsSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/AccountSwitchMenuItems.tsx'),
  'utf8',
);
const sidebarProjectsSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/sidebar-projects-section.tsx'),
  'utf8',
);
const sidebarUpdateNoticeSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/sidebar-update-notice.tsx'),
  'utf8',
);
const updateContentModalSource = readFileSync(
  resolve(process.cwd(), 'src/components/layout/update-content-modal.tsx'),
  'utf8',
);
const chatMessageSource = readFileSync(
  resolve(process.cwd(), 'src/pages/Chat/ChatMessage.tsx'),
  'utf8',
);
const homeMainConversationSource = readFileSync(
  resolve(process.cwd(), 'src/pages/Home/HomeMainConversation.tsx'),
  'utf8',
);
const chatPageSource = readFileSync(
  resolve(process.cwd(), 'src/pages/Chat/index.tsx'),
  'utf8',
);
const artifactProductCardSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat/artifact-product-card.tsx'),
  'utf8',
);
const chatSearchBarSource = readFileSync(
  resolve(process.cwd(), 'src/pages/Chat/ChatSearchBar.tsx'),
  'utf8',
);
const chatEngineModelSelectorsSource = readFileSync(
  resolve(process.cwd(), 'src/pages/Chat/ChatEngineModelSelectors.tsx'),
  'utf8',
);
const workflowDesignerCanvasCss = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/workflow-designer-canvas.css'),
  'utf8',
);
const workflowDesignerSource = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/workflow-designer.tsx'),
  'utf8',
);
const workflowHistoryDrawerSource = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/components/history-versions-drawer.tsx'),
  'utf8',
);
const workflowStartupDialogSource = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/components/startup-run-dialog.tsx'),
  'utf8',
);
const workflowPickerSource = readFileSync(
  resolve(process.cwd(), 'src/components/workflow/WorkflowPicker.tsx'),
  'utf8',
);
const quickInputPickerSource = readFileSync(
  resolve(process.cwd(), 'src/components/quick-input/QuickInputPicker.tsx'),
  'utf8',
);
const channelConfigModalSource = readFileSync(
  resolve(process.cwd(), 'src/components/channels/ChannelConfigModal.tsx'),
  'utf8',
);
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const moreAppsCss = readFileSync(
  resolve(process.cwd(), 'src/components/more-apps/more-apps.css'),
  'utf8',
);
const trialRunViewSource = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/components/test-run-trial-view.tsx'),
  'utf8',
);
const localRunHistorySource = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/components/local-run-history-dialog.tsx'),
  'utf8',
);
const quickInputManageSource = readFileSync(
  resolve(process.cwd(), 'src/components/quick-input/QuickInputManageModal.tsx'),
  'utf8',
);
const quickInputManageItemSource = readFileSync(
  resolve(process.cwd(), 'src/components/quick-input/QuickInputManageListItem.tsx'),
  'utf8',
);
const browserOverlayCss = readFileSync(
  resolve(process.cwd(), 'src/components/sclaw-browser/sclaw-browser-overlay.css'),
  'utf8',
);
const parameterFormCardSource = readFileSync(
  resolve(process.cwd(), 'src/components/parameter-form/ParameterFormCard.tsx'),
  'utf8',
);
const parameterFormFieldSource = readFileSync(
  resolve(process.cwd(), 'src/components/parameter-form/FormFieldRenderer.tsx'),
  'utf8',
);
const parameterOptionCardSource = readFileSync(
  resolve(process.cwd(), 'src/components/parameter-form/OptionCardList.tsx'),
  'utf8',
);

function extractBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = source.slice(start);
  const end = slice.indexOf('\n  }', marker.length);
  expect(end).toBeGreaterThan(0);
  return slice.slice(0, end);
}

function extractThemeBlock(marker: ':root {' | '.dark {'): string {
  const tokenMarker = marker === ':root {' ? ':root,' : '.dark,';
  return `${extractBlock(themeTokensCss, tokenMarker)}\n${extractBlock(globalsCss, marker)}`;
}

describe('dark appearance semantic tokens', () => {
  it('serves renderer and adaptive preview from the same dark token selector', () => {
    expect(themeTokensCss).toContain('.dark,');
    expect(themeTokensCss).toContain("html[data-sto-theme='dark']");
  });

  it('keeps light surfaces unchanged and exposes semantic aliases', () => {
    const root = extractThemeBlock(':root {');

    expect(root).toContain('--sto-shell-bg: #ededed');
    expect(root).toContain('--sto-workspace-bg: #fafafa');
    expect(root).toContain('--sto-panel-bg: #ffffff');
    expect(root).toMatch(/--sto-surface-under:\s*var\(--sto-shell-bg\)/);
    expect(root).toMatch(/--sto-surface-primary:\s*var\(--sto-workspace-bg\)/);
    expect(root).toMatch(/--sto-surface-secondary:\s*var\(--sto-panel-bg\)/);
    expect(root).toContain('--glass-bg: 220 14% 98%');
    expect(root).toContain('--glass-border: 220 12% 78% / 0.4');
    expect(root).toContain('--canvas-from: #f7f8fa');
    expect(root).toContain('--canvas-via: #f5f6f7');
    expect(root).toContain('--canvas-to: #fafbfc');
    expect(root).toContain('--sto-sidebar-row-hover-bg: #e4e4e4');
    expect(root).toContain('--sto-sidebar-nav-active-bg: #dcdcdc');
    expect(root).toContain('--sto-sidebar-subitem-active-bg: #dcdcdc');
  });

  it('maps dark appearance to the approved neutral palette', () => {
    const dark = extractThemeBlock('.dark {');

    expect(dark).toContain('--sto-surface-under: #0d0d0d');
    expect(dark).toContain('--sto-surface-primary: #181818');
    expect(dark).toContain('--sto-surface-secondary: #212121');
    expect(dark).toContain('--sto-surface-elevated: #282828');
    expect(dark).toContain('--sto-text-primary: #dfdfdf');
    expect(dark).toContain('--sto-text-secondary: rgb(255 255 255 / 70%)');
    expect(dark).toContain('--sto-text-tertiary: rgb(255 255 255 / 50%)');
    expect(dark).toContain('--sto-icon-primary: rgba(255, 255, 255, 0.90)');
    expect(dark).toContain('--sto-icon-secondary: rgba(255, 255, 255, 0.70)');
    expect(dark).toContain('--sto-icon-tertiary: rgba(255, 255, 255, 0.50)');
    expect(dark).toContain('--sto-border-default: rgba(255, 255, 255, 0.08)');
    expect(dark).toContain('--glass-bg: 0 0% 12.9%');
    expect(dark).toContain('--glass-border: 0 0% 100% / 0.08');
    expect(dark).toContain('--canvas-from: #0d0d0d');
    expect(dark).toContain('--canvas-via: #181818');
    expect(dark).toContain('--canvas-to: #212121');
    expect(dark).toContain('--sto-sidebar-collapsed-nav-icon-idle: var(--sto-text-tertiary)');
    expect(dark).toContain('--sto-grey-10: var(--sto-text-primary)');
    expect(dark).toContain('--sto-grey-9: var(--sto-text-secondary)');
    expect(dark).toContain('--sto-grey-8: var(--sto-text-tertiary)');
    expect(dark).toContain('--sto-sidebar-row-hover-bg: var(--sto-control-hover-bg)');
    expect(dark).toContain('--sto-sidebar-nav-active-bg: var(--sto-surface-elevated)');
    expect(dark).toContain('--sto-sidebar-subitem-active-bg: var(--sto-surface-elevated)');
    expect(dark).toContain('--sto-sidebar-text-default: var(--sto-text-secondary)');
    expect(dark).toContain('--sto-sidebar-text-active: var(--sto-text-primary)');
    expect(dark).toContain('--sto-sidebar-icon-active: var(--sto-icon-primary)');
    expect(dark).toContain('--sto-sidebar-footer-name: var(--sto-text-primary)');
    expect(dark).toContain('--sto-sidebar-footer-meta: var(--sto-text-tertiary)');
  });

  it('keeps dark sidebar idle and active foreground roles visually distinct', () => {
    expect(sidebarNavExpandedIdleClass).toContain('text-[var(--sto-sidebar-text-default)]');
    expect(sidebarNavExpandedActiveClass).toContain('text-[var(--sto-sidebar-text-active)]');
    expect(sidebarNavExpandedActiveClass).toContain(
      '[&_svg]:stroke-[var(--sto-sidebar-icon-active)]',
    );
    expect(sidebarSubitemTextActiveClass).toContain('text-[var(--sto-sidebar-text-active)]');
  });

  it('maps dark thinking summaries and details to separate semantic text roles', () => {
    for (const titleClass of [chatToolCallHeaderBtnClass, chatThinkingSummaryHeaderClass]) {
      expect(titleClass).toContain('dark:text-[var(--sto-text-secondary)]');
    }

    for (const detailClass of [
      chatToolCallInputPreClass,
      chatProcessSecondaryTextClass,
      chatProcessLoadingTextClass,
    ]) {
      expect(detailClass).toContain('dark:text-[var(--sto-text-tertiary)]');
    }
  });

  it('pins dark assistant headings, body and shimmer to semantic text roles', () => {
    expect(globalsCss).toMatch(
      /\.dark \.prose-chat-reply\s*\{[^}]*color:\s*var\(--sto-text-primary\)/s,
    );
    expect(globalsCss).toMatch(
      /\.dark \.prose-chat-reply h1,[\s\S]*?\.dark \.prose-chat-reply h6\s*\{[^}]*color:\s*var\(--sto-text-primary\)/s,
    );
    expect(globalsCss).toMatch(
      /\.dark \.chat-interaction-shimmer-text\s*\{[^}]*color:\s*var\(--sto-text-tertiary\)/s,
    );
  });

  it('uses one explicit dark icon role instead of stacking gray and opacity', () => {
    for (const source of [chatProcessBlockSource, chatToolCallCardSource]) {
      expect(source).toContain('dark:text-[var(--sto-icon-secondary)]');
      expect(source).toContain('dark:opacity-100');
    }

    expect(thinkingTurnProcessSource).toContain('dark:text-[var(--sto-icon-secondary)]');
    expect(thinkingTurnProcessSource).toContain('dark:opacity-100');
  });

  it('maps dark shell chevrons, weak actions and tertiary copy to explicit roles', () => {
    expect(sidebarHeaderToggleSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(sidebarHeaderToggleSource).toContain('dark:hover:text-[var(--sto-icon-secondary)]');
    expect(sidebarSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(accountSwitchMenuItemsSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(sidebarProjectsSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(sidebarUpdateNoticeSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(updateContentModalSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(chatMessageSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(chatMessageSource).toContain('dark:hover:text-[var(--sto-icon-secondary)]');
  });

  it('keeps dark ambient fades neutral instead of introducing a cool hue', () => {
    const darkBody = extractBlock(globalsCss, '.dark body {');

    expect(homeMainConversationSource).toContain('hsl(0_0%_5.1%/0)');
    expect(homeMainConversationSource).not.toContain('hsl(220_22%_11%');
    expect(darkBody).toContain('rgba(255, 255, 255, 0.035)');
    expect(darkBody).not.toContain('hsl(220 ');
    expect(chatPageSource).toContain('dark:bg-white/[0.025]');
    expect(chatPageSource).toContain(
      'bg-cyan-300/10 blur-[90px] dark:bg-white/[0.025]',
    );
  });

  it('replaces blue-black light shadows with neutral black shadows in dark chat surfaces', () => {
    expect(artifactProductCardSource).toContain(
      'dark:shadow-[0_4px_16px_rgba(0,0,0,0.35)]',
    );
    expect(chatSearchBarSource).toContain(
      'dark:shadow-[0_12px_32px_rgba(0,0,0,0.35)]',
    );
    expect(chatEngineModelSelectorsSource).toContain(
      'dark:shadow-[0_4px_12px_rgba(0,0,0,0.28)]',
    );
    expect(chatMessageSource).toContain(
      'dark:shadow-[0_10px_24px_rgba(0,0,0,0.35)]',
    );
  });

  it('keeps workflow designer canvas, nodes and overlays neutral in dark appearance', () => {
    expect(workflowDesignerCanvasCss).toContain('.dark .workflow-designer-flow');
    expect(workflowDesignerCanvasCss).toContain('background: var(--sto-surface-under)');
    expect(workflowDesignerCanvasCss).toContain('background: var(--sto-surface-primary)');
    expect(workflowDesignerCanvasCss).toContain('color: var(--sto-text-primary)');
    expect(workflowDesignerSource).toContain('dark:border-border dark:bg-[var(--sto-surface-primary)]');
    expect(workflowHistoryDrawerSource).toContain('dark:bg-[var(--sto-surface-primary)]');
    expect(workflowStartupDialogSource).toContain('dark:bg-[var(--sto-surface-primary)]');
  });

  it('replaces remaining bright chat fallback surfaces in dark appearance', () => {
    expect(chatMessageSource).toContain(
      'dark:bg-[linear-gradient(180deg,var(--sto-surface-secondary),var(--sto-surface-primary))]',
    );
    expect(chatMessageSource).toContain(
      'dark:bg-[linear-gradient(135deg,hsl(var(--primary)/0.10),var(--sto-surface-primary))]',
    );
  });

  it('keeps neutral workflow and picker surfaces free of blue-black dark fills', () => {
    const dark = extractThemeBlock('.dark {');

    expect(dark).toContain('--sto-wf-hero-input-bg: var(--sto-surface-primary)');
    expect(dark).toContain('--sto-wf-detail-cover-bg: var(--sto-surface-elevated)');
    expect(dark).toContain('--sto-wf-flow-block-bg: var(--sto-surface-primary)');
    expect(dark).toContain('--sto-wf-flow-block-border: var(--sto-border-default)');
    expect(skillPickerShellClass).toContain('dark:bg-[var(--sto-surface-primary)]');
    expect(skillPickerShellClass).not.toContain('dark:bg-[#18181B]');
    expect(workflowPickerSource).toContain('dark:bg-[var(--sto-surface-primary)]');
    expect(workflowPickerSource).not.toContain('dark:bg-[#18181B]');
  });

  it('maps remaining picker and channel weak copy to dark semantic roles', () => {
    expect(workflowPickerSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(quickInputPickerSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(quickInputPickerSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(channelConfigModalSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(channelConfigModalSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
  });

  it('keeps the fatal error fallback on neutral dark surfaces', () => {
    expect(appSource).toContain("background: '#0d0d0d'");
    expect(appSource).toContain("background: '#212121'");
    expect(appSource).not.toContain("background: '#0f172a'");
    expect(appSource).not.toContain("background: '#1e293b'");
  });

  it('keeps workflow trial and local history status surfaces readable in dark appearance', () => {
    expect(trialRunViewSource).toContain('dark:bg-[var(--sto-surface-primary)]');
    expect(trialRunViewSource).toContain('dark:bg-[hsl(var(--primary)/0.10)]');
    expect(trialRunViewSource).toContain('dark:text-[var(--sto-text-primary)]');
    expect(localRunHistorySource).toContain(
      'dark:text-[var(--sto-text-tertiary)] dark:bg-[var(--sto-surface-elevated)]',
    );
  });

  it('maps quick input management weak copy and icons to dark semantic roles', () => {
    expect(quickInputManageSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(quickInputManageSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(quickInputManageItemSource).toContain('dark:text-[var(--sto-icon-tertiary)]');
    expect(quickInputManageItemSource).toContain('dark:hover:text-[var(--sto-icon-secondary)]');
  });

  it('uses neutral dark surfaces for the app plaza instead of blue-black fills', () => {
    const darkMoreApps = moreAppsCss.slice(
      moreAppsCss.indexOf(".dark [data-app-shell='provincial'] .page-more-apps"),
      moreAppsCss.indexOf('@media (max-width: 960px)'),
    );

    expect(darkMoreApps).toContain('--ma-white: var(--sto-surface-primary)');
    expect(darkMoreApps).toContain('--ma-surface-panel: var(--sto-surface-primary)');
    expect(darkMoreApps).toContain('--ma-surface-elevated: var(--sto-surface-elevated)');
    expect(darkMoreApps).toContain('--ma-hero-bg: linear-gradient(135deg, #181818 0%, #212121 100%)');
    expect(darkMoreApps).not.toContain('hsl(220');
  });

  it('maps the in-app browser chrome to neutral dark surfaces and text roles', () => {
    expect(browserOverlayCss).toContain('.dark .sclaw-browser-drawer-panel');
    expect(browserOverlayCss).toContain('background: var(--sto-surface-under)');
    expect(browserOverlayCss).toContain('.dark .sclaw-browser-toolbar');
    expect(browserOverlayCss).toContain('color: var(--sto-text-primary)');
    expect(browserOverlayCss).toContain('color: var(--sto-icon-secondary)');
  });

  it('keeps the legacy inline parameter form readable if its fallback path is enabled', () => {
    expect(parameterFormCardSource).toContain('dark:bg-[var(--sto-surface-primary)]');
    expect(parameterFormCardSource).toContain('dark:text-[var(--sto-text-primary)]');
    expect(parameterFormFieldSource).toContain('dark:bg-[var(--sto-surface-elevated)]');
    expect(parameterFormFieldSource).toContain('dark:text-[var(--sto-text-tertiary)]');
    expect(parameterOptionCardSource).toContain('dark:bg-[var(--sto-surface-elevated)]');
    expect(parameterOptionCardSource).toContain('dark:text-[var(--sto-text-secondary)]');
  });

  it('keeps the dark content canvas deeper than the sidebar and selection surfaces', () => {
    const dark = extractThemeBlock('.dark {');

    expect(dark).toContain('--background: 0 0% 5.1%');
    expect(dark).toContain('--sto-shell-bg: var(--sto-surface-secondary)');
    expect(dark).toContain('--sto-workspace-bg: var(--sto-surface-under)');
    expect(dark).toContain('--sto-page-bg: var(--sto-surface-under)');
    expect(dark).toContain('--sto-sidebar-bg: var(--sto-surface-secondary)');
    expect(dark).toContain('--sto-main-card-bg: var(--sto-surface-under)');
    expect(dark).toContain('--sto-sidebar-nav-active-bg: var(--sto-surface-elevated)');
    expect(dark).toContain('--sto-sidebar-subitem-active-bg: var(--sto-surface-elevated)');
  });

  it('replaces every light chat table surface in dark appearance', () => {
    expect(globalsCss).toMatch(
      /\.dark \.prose-chat-reply \.prose-table-wrap th,\s*\.dark \.prose-chat-reply \.prose-table-wrap td\s*\{[^}]*color:\s*var\(--sto-text-primary\)/s,
    );
    expect(globalsCss).toMatch(
      /\.dark \.prose-chat-reply \.prose-table-wrap th\s*\{[^}]*background:\s*var\(--sto-surface-secondary\)/s,
    );
    expect(globalsCss).toMatch(
      /\.dark \.prose-chat-reply \.prose-table-wrap tbody tr:nth-child\(odd\) td\s*\{[^}]*background-color:\s*var\(--sto-surface-primary\)/s,
    );
    expect(globalsCss).toMatch(
      /\.dark \.prose-chat-reply \.prose-table-wrap tbody tr:nth-child\(even\) td\s*\{[^}]*background-color:\s*var\(--sto-surface-secondary\)/s,
    );
  });
});
