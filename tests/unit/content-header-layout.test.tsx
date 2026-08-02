import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_HEADER_TO_SURFACE_GAP_PX,
  CONVERSATION_HEADER_TO_CONTENT_TOTAL_PX,
  CONTENT_HEADER_CENTER_Y_PX,
  CONTENT_HEADER_CONTROL_HEIGHT_PX,
  CONTENT_HEADER_HEIGHT_PX,
  MACOS_TRAFFIC_LIGHT_DIAMETER_PX,
  MACOS_TRAFFIC_LIGHT_POSITION,
  MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION,
  MACOS_SIDEBAR_TOGGLE_TOP_PX,
  PREVIEW_EXPANDED_HEADER_TO_SURFACE_GAP_PX,
  SPLIT_HEADER_TO_CONTENT_TOTAL_PX,
  SPLIT_HEADER_TO_SURFACE_GAP_PX,
  SIDEBAR_CHROME_TOGGLE_SIZE_PX,
  trafficLightCenterY,
  WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX,
  WORKBENCH_SURFACE_BOTTOM_INSET_PX,
  WORKSPACE_FRAME_TOP_PX,
} from '@/lib/content-header-metrics';
import {
  contentHeaderBarClass,
  contentHeaderActionBtnClass,
  contentHeaderPreviewExpandedStartClass,
  contentHeaderPreviewTabsWrapClass,
  contentHeaderSessionChipClass,
  contentHeaderSplitBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  contentHeaderTextActionBtnClass,
  stoChatScrollPaneClass,
  stoMainCardBodyHomeClass,
  stoPreviewExpandedBodyClass,
  stoPreviewArtifactTabClass,
  stoSplitGridBodyChatClass,
  stoSplitGridBodyPreviewClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';

describe('content header layoutMode contract', () => {
  it('exposes chatActions + previewActions + layoutMode with actions adapter', () => {
    const ctxSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/content-header-context.tsx'),
      'utf8',
    );
    expect(ctxSrc).toContain("export type ContentHeaderLayoutMode = 'conversation' | 'split' | 'preview-expanded'");
    expect(ctxSrc).toContain('previewActions');
    expect(ctxSrc).toContain('layoutMode');
    expect(ctxSrc).toContain('previewActions: input.previewActions ?? input.actions');
    expect(ctxSrc).toContain("input.isSplitLayout ? 'split' : 'conversation'");
  });

  it('uses one stable Header tree with mode-driven slots', () => {
    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).toContain("layoutMode === 'split'");
    expect(headerSrc).toContain("layoutMode === 'preview-expanded'");
    expect(headerSrc).toContain('contentHeaderSplitBarClass');
    expect(headerSrc).toContain('contentHeaderBarClass');
    expect(headerSrc).toContain('previewActionsZone');
    expect(headerSrc).toContain('data-slot="chat-header-zone"');
    expect(headerSrc).toContain('data-slot="preview-header-zone"');
    expect(headerSrc).toContain('data-slot="workspace-actions"');
    expect(headerSrc).toContain('data-slot="conversation-title"');
    expect(headerSrc).toContain("isPreviewExpanded && 'hidden'");
    expect(headerSrc).toContain('inert: true as const');
    expect(headerSrc).not.toContain('isPreviewExpanded ? chatActionsZone');
    expect(headerSrc).not.toContain('if (isSplitLayout) {');
    expect(headerSrc).not.toContain('if (isPreviewExpanded) {');
    expect(headerSrc).not.toMatch(/\bactionsZone\b/);
  });

  it('aligns visible-Sidebar Preview Expanded controls with the 12px Surface start', () => {
    expect(contentHeaderPreviewExpandedStartClass).toContain(
      'pl-[var(--sto-expanded-preview-inset-x,12px)]',
    );
    const expandedHeaderClass = cn(
      contentHeaderBarClass,
      contentHeaderPreviewExpandedStartClass,
      'gap-0',
    );
    expect(expandedHeaderClass).toContain(
      'pl-[var(--sto-expanded-preview-inset-x,12px)]',
    );
    expect(expandedHeaderClass).not.toContain(
      'pl-[var(--sto-content-header-pad-start)]',
    );

    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).toContain(
      'isPreviewExpanded && !sidebarCollapsed && contentHeaderPreviewExpandedStartClass',
    );
    expect(headerSrc).toContain("!canUserRestoreSidebar && 'w-0 gap-0'");
    expect(headerSrc).toContain("isPreviewExpanded && !canUserRestoreSidebar && 'gap-0'");
    expect(headerSrc).not.toMatch(/isPreviewExpanded[\s\S]*?-m[lr]-/);
  });

  it('keeps MainLayout Header/Body on the same split percent variable', () => {
    const mainSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/MainLayout.tsx'),
      'utf8',
    );
    expect(mainSrc).toContain("layoutMode === 'split'");
    expect(mainSrc).toContain("layoutMode === 'preview-expanded'");
    expect(mainSrc).toContain('stoSplitUnifiedMainClass');
    expect(mainSrc).toContain('stoPreviewExpandedMainClass');
  });

  it('Home/Chat register layoutMode and previewActions', () => {
    const homeSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Home/HomeMainConversation.tsx'),
      'utf8',
    );
    const chatSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Chat/index.tsx'),
      'utf8',
    );
    for (const src of [homeSrc, chatSrc]) {
      expect(src).toContain('previewActions:');
      expect(src).toContain('layoutMode:');
      expect(src).toContain("'preview-expanded'");
      expect(src).toContain('isPreviewExpanded');
      expect(src).toContain('ChatPreviewWorkspaceHeaderActions');
      expect(src).not.toMatch(/isSplitLayout:\s*canShowPreviewPanel/);
    }
  });
});

describe('ContentHeader vertical pixel contract', () => {
  it('owns a single compact Header height and control Token (8 + 44/2 = 30)', () => {
    expect(CONTENT_HEADER_HEIGHT_PX).toBe(44);
    expect(CONTENT_HEADER_CONTROL_HEIGHT_PX).toBe(28);
    expect(WORKSPACE_FRAME_TOP_PX).toBe(8);
    expect(CONTENT_HEADER_CENTER_Y_PX).toBe(30);
    expect(CONTENT_HEADER_CENTER_Y_PX).toBe(
      WORKSPACE_FRAME_TOP_PX + CONTENT_HEADER_HEIGHT_PX / 2,
    );

    for (const cls of [contentHeaderBarClass, contentHeaderSplitBarClass]) {
      expect(cls).toContain('h-[var(--sto-content-header-h,44px)]');
    }
    for (const cls of [
      contentHeaderActionBtnClass,
      contentHeaderTextActionBtnClass,
      contentHeaderSessionChipClass,
      stoPreviewArtifactTabClass(true),
    ]) {
      expect(cls).toContain('h-[var(--sto-content-header-control-h,28px)]');
    }
    expect(contentHeaderBarClass).toContain('items-center');
    // Split bar 是嵌套 grid；中心线由子 zone items-center 承担（运行时 QA 已确认 Δ≤1px）
    expect(contentHeaderSplitChatZoneClass).toContain('items-center');
    expect(contentHeaderSplitPreviewZoneClass).toContain('items-center');

    const globals = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(globals).toMatch(/--sto-content-header-h:\s*44px/);
    expect(globals).toMatch(/--sto-content-header-control-h:\s*28px/);
    expect(globals).toMatch(/--sto-conversation-header-to-surface-gap:\s*0px/);
    expect(globals).toMatch(/--sto-split-header-to-surface-gap:\s*0px/);
    expect(globals).toMatch(/--sto-workbench-body-content-inset-y:\s*8px/);
    expect(globals).toMatch(/--sto-workbench-surface-bottom-inset:\s*8px/);
    expect(globals).toMatch(/--sto-preview-expanded-header-to-surface-gap:\s*0px/);
    expect(globals).toMatch(/--sto-sidebar-chrome-toggle-inset-top:\s*16px/);
    expect(globals).toMatch(/--sto-sidebar-chrome-toggle-size:\s*28px/);
  });

  it('keeps mode-owned Header-to-Surface gaps without stacking Split padding', () => {
    expect(CONVERSATION_HEADER_TO_SURFACE_GAP_PX).toBe(0);
    expect(SPLIT_HEADER_TO_SURFACE_GAP_PX).toBe(0);
    expect(WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX).toBe(8);
    expect(WORKBENCH_SURFACE_BOTTOM_INSET_PX).toBe(8);
    expect(CONVERSATION_HEADER_TO_CONTENT_TOTAL_PX).toBe(8);
    expect(SPLIT_HEADER_TO_CONTENT_TOTAL_PX).toBe(8);
    expect(PREVIEW_EXPANDED_HEADER_TO_SURFACE_GAP_PX).toBe(0);

    expect(stoSplitGridBodyChatClass).toContain(
      'pt-[var(--sto-split-header-to-surface-gap,0px)]',
    );
    expect(stoSplitGridBodyPreviewClass).toContain(
      'pt-[var(--sto-split-header-to-surface-gap,0px)]',
    );
    expect(stoSplitGridBodyChatClass).not.toContain(
      'pt-[var(--sto-conversation-header-to-surface-gap,0px)]',
    );
    expect(stoSplitGridBodyPreviewClass).not.toContain(
      'pt-[var(--sto-conversation-header-to-surface-gap,0px)]',
    );
    expect(stoPreviewExpandedBodyClass).toContain(
      'pt-[var(--sto-preview-expanded-header-to-surface-gap,0px)]',
    );
    expect(stoPreviewExpandedBodyClass).not.toContain(
      'pt-[var(--sto-conversation-header-to-surface-gap,0px)]',
    );
    for (const cls of [
      stoSplitGridBodyChatClass,
      stoSplitGridBodyPreviewClass,
      stoPreviewExpandedBodyClass,
    ]) {
      expect(cls).toContain('pb-[var(--sto-workbench-surface-bottom-inset,8px)]');
      expect(cls).not.toContain('sto-split-preview-inset-y');
    }
    expect(stoMainCardBodyHomeClass).toContain(
      'pt-[var(--sto-conversation-header-to-surface-gap,0px)]',
    );

    expect(stoChatScrollPaneClass).toContain(
      'pt-[var(--sto-workbench-body-content-inset-y,8px)]',
    );
    expect(stoChatScrollPaneClass).not.toMatch(/(?:^|\s)py-4(?:\s|$)/);
  });

  it('keeps macOS traffic lights and Sidebar toggle on independent optical baselines', () => {
    expect(MACOS_TRAFFIC_LIGHT_DIAMETER_PX).toBe(12);
    expect(MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION).toEqual({ x: 16, y: 28 });

    const beforeCenter = trafficLightCenterY(MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION.y);
    expect(beforeCenter).toBe(34);
    expect(beforeCenter).not.toBe(CONTENT_HEADER_CENTER_Y_PX);

    expect(MACOS_TRAFFIC_LIGHT_POSITION).toEqual({ x: 16, y: 20 });
    const afterCenter = trafficLightCenterY(MACOS_TRAFFIC_LIGHT_POSITION.y);
    expect(afterCenter).toBe(26);
    expect(MACOS_SIDEBAR_TOGGLE_TOP_PX).toBe(16);
    expect(SIDEBAR_CHROME_TOGGLE_SIZE_PX).toBe(28);

    const sidebarToggleSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/sidebar-header-toggle.tsx'),
      'utf8',
    );
    expect(sidebarToggleSrc).toContain('var(--sto-sidebar-chrome-toggle-size,28px)');
    expect(sidebarToggleSrc).not.toContain("'h-8 w-8'");

    const mainSrc = readFileSync(
      resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8',
    );
    expect(mainSrc).toMatch(/trafficLightPosition:[\s\S]*y:\s*20/);
    expect(mainSrc).not.toMatch(/trafficLightPosition:\s*isMac\s*\?\s*\{\s*x:\s*16,\s*y:\s*18\s*\}/);
  });

  it('keeps Header items-center without per-control translate-y', () => {
    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).not.toMatch(/translate-y-/);
    expect(headerSrc).not.toMatch(/\btop-\[1px\]/);
  });

  it('does not expose a native horizontal scrollbar in Header zones', () => {
    expect(contentHeaderSplitChatZoneClass).toContain('overflow-hidden');
    expect(contentHeaderSplitChatZoneClass).not.toContain('overflow-x-auto');

    expect(contentHeaderPreviewTabsWrapClass).toContain('overflow-hidden');
    expect(contentHeaderPreviewTabsWrapClass).not.toContain('overflow-x-auto');
  });

  it('keeps search surface at the 28px compact Token and opens it as a Header overlay', () => {
    const searchSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Chat/ChatSearchBar.tsx'),
      'utf8',
    );
    expect(searchSrc).toContain(
      'h-[var(--sto-content-header-control-h,28px)] w-[16.5rem]',
    );
    expect(searchSrc).toContain(
      'no-drag pointer-events-none absolute right-[calc(var(--sto-content-header-control-h,28px)+4px)] top-0',
    );
    expect(searchSrc).toContain('const inputRef = useRef<HTMLInputElement>(null)');
    expect(searchSrc).toContain('inputRef.current?.focus()');
    expect(searchSrc).toContain('ref={inputRef}');
    expect(searchSrc).not.toContain('autoFocus={isOpen}');
    expect(searchSrc).not.toContain('px-2 py-1.5');

    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).toContain('isContentHeaderCompact');
  });

  it('keeps route-injected workflow Header controls on the shared compact Token', () => {
    const sources = [
      'src/hooks/use-workflow-editor-content-header.tsx',
      'src/pages/WorkflowDesigner/workflow-designer.tsx',
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'));

    for (const source of sources) {
      expect(source).toContain('contentHeaderActionBtnClass');
      expect(source).toContain('contentHeaderTextActionBtnClass');
      expect(source).not.toContain('className="flex h-8 w-8 shrink-0');
    }
  });
});
