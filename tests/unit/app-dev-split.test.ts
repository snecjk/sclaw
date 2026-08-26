import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_DEV_CHAT_SPLIT_DEFAULT,
  APP_DEV_CHAT_SPLIT_MAX,
  APP_DEV_CHAT_SPLIT_MIN,
  APP_DEV_CHAT_SPLIT_STORAGE_KEY,
  appDevSplitRowClass,
  clampAppDevChatSplitFromPx,
  clampAppDevChatSplitPercent,
  clampAppDevChatWidthPx,
  readStoredAppDevChatSplitPercent,
  writeStoredAppDevChatSplitPercent,
} from '@/lib/app-dev-split';

describe('app-dev split metrics', () => {
  it('uses a two-column grid driven by --app-dev-chat-col', () => {
    expect(appDevSplitRowClass).toContain('grid-cols-[minmax(0,1fr)_minmax(280px,var(--app-dev-chat-col,28%))]');
  });

  it('clamps percent to 22–55', () => {
    expect(clampAppDevChatSplitPercent(Number.NaN)).toBe(APP_DEV_CHAT_SPLIT_DEFAULT);
    expect(clampAppDevChatSplitPercent(10)).toBe(APP_DEV_CHAT_SPLIT_MIN);
    expect(clampAppDevChatSplitPercent(80)).toBe(APP_DEV_CHAT_SPLIT_MAX);
    expect(clampAppDevChatSplitPercent(40)).toBe(40);
  });

  it('keeps chat at least 280px when the window is wide enough', () => {
    expect(clampAppDevChatWidthPx(1000, 100)).toBe(280);
    expect(clampAppDevChatWidthPx(1000, 400)).toBe(400);
    expect(clampAppDevChatWidthPx(1000, 900)).toBe(550);
  });

  it('converts px to percent after clamping', () => {
    expect(clampAppDevChatSplitFromPx(1000, 100)).toBe(28);
    expect(clampAppDevChatSplitFromPx(1000, 400)).toBe(40);
    expect(clampAppDevChatSplitFromPx(1000, 900)).toBe(55);
    expect(clampAppDevChatSplitFromPx(0, 400)).toBe(APP_DEV_CHAT_SPLIT_DEFAULT);
  });

  it('reads and writes the split percent in localStorage', () => {
    localStorage.removeItem(APP_DEV_CHAT_SPLIT_STORAGE_KEY);
    expect(readStoredAppDevChatSplitPercent()).toBe(APP_DEV_CHAT_SPLIT_DEFAULT);

    writeStoredAppDevChatSplitPercent(41);
    expect(readStoredAppDevChatSplitPercent()).toBe(41);

    writeStoredAppDevChatSplitPercent(99);
    expect(readStoredAppDevChatSplitPercent()).toBe(APP_DEV_CHAT_SPLIT_MAX);

    localStorage.setItem(APP_DEV_CHAT_SPLIT_STORAGE_KEY, 'not-a-number');
    expect(readStoredAppDevChatSplitPercent()).toBe(APP_DEV_CHAT_SPLIT_DEFAULT);
  });
});

describe('app-dev workbench split wiring', () => {
  it('uses a dedicated template publish confirmation component', () => {
    const plazaSrc = readFileSync(
      resolve(process.cwd(), 'src/components/more-apps/AppPlazaDevAppPane.tsx'),
      'utf8',
    );

    expect(plazaSrc).toContain("import { TemplatePublishConfirmDialog } from './TemplatePublishConfirmDialog';");
    expect(plazaSrc).toContain('<TemplatePublishConfirmDialog');
    expect(plazaSrc).not.toMatch(/<ConfirmDialog\s+open=\{templatePublishConfirm\}/);
  });

  it('mounts AppDevSplitBody in both workbench shells', () => {
    const plazaSrc = readFileSync(
      resolve(process.cwd(), 'src/components/more-apps/AppPlazaDevAppPane.tsx'),
      'utf8',
    );
    const workbenchSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/AppDev/AppDevWorkbench.tsx'),
      'utf8',
    );
    expect(plazaSrc).toContain('AppDevSplitBody');
    expect(plazaSrc).toContain('chatOpen={chatOpen}');
    expect(workbenchSrc).toContain('AppDevSplitBody');
    expect(plazaSrc).not.toContain('w-[400px] min-w-[340px]');
    expect(workbenchSrc).not.toContain('w-[400px] min-w-[340px]');
  });

  it('does not re-render the workbench shell on every status poll or stream delta', () => {
    const plazaSrc = readFileSync(
      resolve(process.cwd(), 'src/components/more-apps/AppPlazaDevAppPane.tsx'),
      'utf8',
    );
    const workbenchSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/AppDev/AppDevWorkbench.tsx'),
      'utf8',
    );
    const stageSrc = readFileSync(
      resolve(process.cwd(), 'src/components/app-dev/AppDevWorkbenchStage.tsx'),
      'utf8',
    );

    expect(workbenchSrc).toContain('useAppDevStatusPoll');
    expect(plazaSrc).toContain('useAppDevStatusPoll');
    expect(workbenchSrc).toContain('useChatSessionSending');
    expect(plazaSrc).toContain('useChatSessionSending');
    expect(workbenchSrc).not.toContain('setInterval(() => void tick(), 1500)');
    expect(plazaSrc).not.toContain('setInterval(() => void tick(), 1500)');
    expect(stageSrc).toContain('frame.reload()');
    expect(stageSrc).toMatch(
      /removeEventListener\('keydown', onKeyDown, true\);\s*\n\s*\}, \[\]\);/,
    );
  });
});
