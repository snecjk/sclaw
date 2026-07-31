import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_HEADER_CENTER_Y_PX,
  CONTENT_HEADER_HEIGHT_PX,
  MACOS_TRAFFIC_LIGHT_DIAMETER_PX,
  MACOS_TRAFFIC_LIGHT_POSITION,
  MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION,
  trafficLightCenterY,
  WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX,
  WORKBENCH_HEADER_TO_BODY_GAP_PX,
  WORKBENCH_HEADER_TO_CONTENT_TOTAL_PX,
  WORKSPACE_FRAME_TOP_PX,
} from '@/lib/content-header-metrics';
import {
  contentHeaderBarClass,
  contentHeaderSplitBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  stoChatScrollPaneClass,
  stoMainCardBodyHomeClass,
  stoPreviewExpandedBodyClass,
  stoSplitGridBodyChatClass,
  stoSplitGridBodyPreviewClass,
} from '@/lib/surfaces';

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

  it('renders three Header templates for conversation / split / preview-expanded', () => {
    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).toContain("layoutMode === 'split'");
    expect(headerSrc).toContain("layoutMode === 'preview-expanded'");
    expect(headerSrc).toContain('contentHeaderSplitBarClass');
    expect(headerSrc).toContain('contentHeaderBarClass');
    expect(headerSrc).toContain('previewActionsZone');
    expect(headerSrc).not.toMatch(/\bactionsZone\b/);
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
      expect(src).not.toMatch(/isSplitLayout:\s*canShowPreviewPanel/);
    }
  });
});

describe('ContentHeader vertical pixel contract', () => {
  it('owns a single Header height Token and centerline (8 + 52/2 = 34)', () => {
    expect(CONTENT_HEADER_HEIGHT_PX).toBe(52);
    expect(WORKSPACE_FRAME_TOP_PX).toBe(8);
    expect(CONTENT_HEADER_CENTER_Y_PX).toBe(34);
    expect(CONTENT_HEADER_CENTER_Y_PX).toBe(
      WORKSPACE_FRAME_TOP_PX + CONTENT_HEADER_HEIGHT_PX / 2,
    );

    for (const cls of [contentHeaderBarClass, contentHeaderSplitBarClass]) {
      expect(cls).toContain('h-[var(--sto-content-header-h,52px)]');
    }
    expect(contentHeaderBarClass).toContain('items-center');
    // Split bar 是嵌套 grid；中心线由子 zone items-center 承担（运行时 QA 已确认 Δ≤1px）
    expect(contentHeaderSplitChatZoneClass).toContain('items-center');
    expect(contentHeaderSplitPreviewZoneClass).toContain('items-center');

    const globals = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(globals).toMatch(/--sto-content-header-h:\s*52px/);
    expect(globals).toMatch(/--sto-workbench-header-to-body-gap:\s*8px/);
    expect(globals).toMatch(/--sto-workbench-body-content-inset-y:\s*8px/);
  });

  it('uses Header→Body 8px + Body→content 8px = 16px (forbids 8+16=24 stack)', () => {
    expect(WORKBENCH_HEADER_TO_BODY_GAP_PX).toBe(8);
    expect(WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX).toBe(8);
    expect(WORKBENCH_HEADER_TO_CONTENT_TOTAL_PX).toBe(16);

    expect(stoSplitGridBodyChatClass).toContain(
      'pt-[var(--sto-workbench-header-to-body-gap,8px)]',
    );
    expect(stoSplitGridBodyPreviewClass).toContain(
      'pt-[var(--sto-workbench-header-to-body-gap,8px)]',
    );
    expect(stoPreviewExpandedBodyClass).toContain(
      'pt-[var(--sto-workbench-header-to-body-gap,8px)]',
    );
    expect(stoMainCardBodyHomeClass).toContain(
      'pt-[var(--sto-workbench-header-to-body-gap,8px)]',
    );

    expect(stoChatScrollPaneClass).toContain(
      'pt-[var(--sto-workbench-body-content-inset-y,8px)]',
    );
    expect(stoChatScrollPaneClass).not.toMatch(/(?:^|\s)py-4(?:\s|$)/);
    expect(stoSplitGridBodyChatClass).not.toContain(
      'py-[var(--sto-split-preview-inset-y)]',
    );
  });

  it('calibrates macOS traffic lights to Header centerY within 2px', () => {
    expect(MACOS_TRAFFIC_LIGHT_DIAMETER_PX).toBe(12);
    expect(MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION).toEqual({ x: 16, y: 18 });

    const beforeCenter = trafficLightCenterY(MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION.y);
    expect(beforeCenter).toBe(24);
    expect(Math.abs(beforeCenter - CONTENT_HEADER_CENTER_Y_PX)).toBeGreaterThan(2);

    expect(MACOS_TRAFFIC_LIGHT_POSITION).toEqual({ x: 16, y: 28 });
    const afterCenter = trafficLightCenterY(MACOS_TRAFFIC_LIGHT_POSITION.y);
    expect(afterCenter).toBe(CONTENT_HEADER_CENTER_Y_PX);
    expect(Math.abs(afterCenter - CONTENT_HEADER_CENTER_Y_PX)).toBeLessThanOrEqual(2);

    const mainSrc = readFileSync(
      resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8',
    );
    expect(mainSrc).toMatch(/trafficLightPosition:[\s\S]*y:\s*28/);
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
});
