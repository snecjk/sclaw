import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SplitPanelResizeHandle } from '@/components/layout/split-panel-resize-handle';
import {
  clampPreviewPanelPercent,
  contentHeaderPreviewArtifactTabBtnClass,
  contentHeaderSplitBarClass,
  contentHeaderSplitChatZoneClass,
  contentHeaderSplitPreviewZoneClass,
  contentHeaderTitleGroupClass,
  STO_PREVIEW_SPLIT_DEFAULT,
  STO_PREVIEW_EXPANDED_INSET_X,
  STO_PREVIEW_SPLIT_MAX,
  STO_PREVIEW_SPLIT_MIN,
  STO_SPLIT_PREVIEW_INSET_X,
  STO_SPLIT_RESIZE_EDGE_COLOR,
  STO_SPLIT_RESIZE_EDGE_WIDTH,
  STO_SPLIT_RESIZE_HIT_WIDTH,
  stoPreviewArtifactTabClass,
  stoPreviewExpandedBodyClass,
  stoSplitGridBodyChatClass,
  stoSplitGridBodyPreviewClass,
  stoSplitGridHeaderChatClass,
  stoSplitGridHeaderPreviewClass,
  stoSplitPanelResizeEdgeClass,
  stoSplitPanelResizeHandleClass,
  stoSplitUnifiedMainClass,
  WORKBENCH_SURFACE_BOTTOM_INSET,
} from '@/lib/surfaces';

describe('split panel layout surfaces', () => {
  it('uses a 0px middle track without a layout-width resizer column', () => {
    expect(stoSplitUnifiedMainClass).toContain(
      'grid-cols-[minmax(0,1fr)_0px_var(--sto-split-preview-col,50%)]',
    );
    expect(stoSplitUnifiedMainClass).not.toContain('_4px_');
    expect(stoSplitUnifiedMainClass).toContain('[--sto-split-preview-inset-x:0px]');
    expect(stoSplitUnifiedMainClass).not.toContain('sto-split-preview-inset-y');
  });

  it('makes the chat header zone fill the first grid column', () => {
    expect(contentHeaderSplitChatZoneClass).toContain('w-full');
    expect(contentHeaderSplitChatZoneClass).toContain('flex-1');
  });

  it('uses a real continuous 44px split header bar with drag-region', () => {
    expect(contentHeaderSplitBarClass).toContain('drag-region');
    expect(contentHeaderSplitBarClass).toContain('col-start-1');
    expect(contentHeaderSplitBarClass).toContain('col-end-4');
    expect(contentHeaderSplitBarClass).toContain('row-start-1');
    expect(contentHeaderSplitBarClass).toContain('grid');
    expect(contentHeaderSplitBarClass).toContain('h-[var(--sto-content-header-h,44px)]');
    expect(contentHeaderSplitBarClass).toContain('select-none');
    expect(contentHeaderSplitBarClass).toContain(
      '[grid-template-columns:minmax(0,1fr)_0px_var(--sto-split-preview-col,50%)]',
    );
    expect(contentHeaderSplitBarClass).not.toContain('contents');
    expect(contentHeaderSplitBarClass).not.toContain('no-drag');
  });

  it('keeps no-drag only on interactive controls, not split header layout cells', () => {
    expect(stoSplitGridHeaderChatClass).not.toContain('drag-region');
    expect(stoSplitGridHeaderChatClass).not.toContain('no-drag');
    expect(stoSplitGridHeaderChatClass).toContain('col-start-1');
    expect(stoSplitGridHeaderPreviewClass).not.toContain('drag-region');
    expect(stoSplitGridHeaderPreviewClass).not.toContain('no-drag');
    expect(stoSplitGridHeaderPreviewClass).toContain('col-start-3');
    expect(contentHeaderSplitChatZoneClass).not.toContain('no-drag');
    expect(contentHeaderSplitPreviewZoneClass).not.toContain('no-drag');
    expect(contentHeaderPreviewArtifactTabBtnClass).toContain('no-drag');
    expect(stoPreviewArtifactTabClass(true)).toContain('no-drag');
    expect(stoSplitPanelResizeHandleClass).toContain('no-drag');
  });

  it('wires ContentHeader split branch to contentHeaderSplitBarClass', () => {
    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).toContain('contentHeaderSplitBarClass');
    expect(headerSrc).not.toMatch(/isSplitLayout[\s\S]*stoSplitGridContentsClass/);
    expect(headerSrc).not.toContain('stoSplitGridContentsClass');
  });

  it('keeps the same title max width for two-column and three-column headers', () => {
    expect(contentHeaderTitleGroupClass).toContain('max-w-[min(34vw,280px)]');
    const headerSrc = readFileSync(
      resolve(process.cwd(), 'src/components/layout/ContentHeader.tsx'),
      'utf8',
    );
    expect(headerSrc).toMatch(/isSplitLayout && 'min-w-0 shrink'/);
    expect(headerSrc).not.toMatch(/isSplitLayout && 'max-w-none/);
  });

  it('removes bilateral 10px structural seam (Stage 3 zero seam)', () => {
    expect(STO_SPLIT_PREVIEW_INSET_X).toBe('0px');
    expect(WORKBENCH_SURFACE_BOTTOM_INSET).toBe('8px');
    expect(stoSplitGridHeaderChatClass).not.toContain('pr-[var(--sto-split-preview-inset-x)]');
    expect(stoSplitGridHeaderPreviewClass).not.toContain('pl-[var(--sto-split-preview-inset-x)]');
    expect(stoSplitGridBodyChatClass).not.toContain('pr-[var(--sto-split-preview-inset-x)]');
    expect(stoSplitGridBodyPreviewClass).not.toContain('pl-[var(--sto-split-preview-inset-x)]');
    expect(stoSplitGridBodyPreviewClass).toContain(
      'pr-[var(--sto-split-preview-surface-inset-end,12px)]',
    );
    expect(stoSplitGridBodyChatClass).not.toContain('sto-split-preview-surface-inset-end');
    expect(stoPreviewExpandedBodyClass).not.toContain('sto-split-preview-surface-inset-end');
    expect(stoSplitGridBodyChatClass).toContain('pt-[var(--sto-split-header-to-surface-gap,0px)]');
    expect(stoSplitGridBodyPreviewClass).toContain('pt-[var(--sto-split-header-to-surface-gap,0px)]');
    expect(stoSplitGridBodyChatClass).not.toContain('sto-conversation-header-to-surface-gap');
    expect(stoSplitGridBodyPreviewClass).not.toContain('sto-conversation-header-to-surface-gap');
    for (const cls of [
      stoSplitGridBodyChatClass,
      stoSplitGridBodyPreviewClass,
      stoPreviewExpandedBodyClass,
    ]) {
      expect(cls).toContain('pb-[var(--sto-workbench-surface-bottom-inset,8px)]');
      expect(cls).not.toContain('sto-split-preview-inset-y');
    }
    expect(stoSplitPanelResizeHandleClass).not.toContain('translate-x');
    expect(stoSplitPanelResizeHandleClass).not.toContain('row-span-2');
  });

  it('keeps Preview Expanded Surface at a Body-owned bilateral 12px inset', () => {
    expect(STO_PREVIEW_EXPANDED_INSET_X).toBe('12px');
    expect(stoPreviewExpandedBodyClass).toContain(
      'px-[var(--sto-expanded-preview-inset-x,12px)]',
    );
    expect(stoPreviewExpandedBodyClass).not.toContain(
      'pl-[var(--sto-expanded-preview-inset-x',
    );

    const globals = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(globals.match(/--sto-expanded-preview-inset-x:\s*12px/g)).toHaveLength(2);
  });

  it('places Body-row Preview-side overlay handle with 8px hit and hint edge', () => {
    expect(STO_SPLIT_RESIZE_HIT_WIDTH).toBe('8px');
    expect(stoSplitPanelResizeHandleClass).toContain('absolute');
    expect(stoSplitPanelResizeHandleClass).toContain('inset-y-0');
    expect(stoSplitPanelResizeHandleClass).toContain('left-0');
    expect(stoSplitPanelResizeHandleClass).toContain('w-[8px]');
    expect(stoSplitPanelResizeHandleClass).toContain('bg-transparent');
    expect(stoSplitPanelResizeHandleClass).toContain('no-drag');
    expect(stoSplitPanelResizeHandleClass).toContain('group');
    expect(stoSplitPanelResizeHandleClass).not.toContain('col-start-2');
    expect(stoSplitPanelResizeHandleClass).not.toContain('row-span-2');
    expect(stoSplitPanelResizeHandleClass).not.toContain('w-3');

    expect(stoSplitPanelResizeEdgeClass).toContain('pointer-events-none');
    expect(stoSplitPanelResizeEdgeClass).toContain(`bg-[${STO_SPLIT_RESIZE_EDGE_COLOR}]`);
    expect(stoSplitPanelResizeEdgeClass).toContain(`w-[${STO_SPLIT_RESIZE_EDGE_WIDTH}]`);
    expect(stoSplitPanelResizeEdgeClass).toContain('opacity-0');
    expect(stoSplitPanelResizeEdgeClass).toContain('group-hover:opacity-100');
    expect(stoSplitPanelResizeEdgeClass).toContain('group-data-[resizing=true]:opacity-100');
    expect(stoSplitPanelResizeEdgeClass).toContain('group-focus-visible:opacity-100');
    expect(stoSplitPanelResizeEdgeClass).not.toContain('bg-primary');
    expect(stoSplitPanelResizeEdgeClass).not.toContain('w-px');
    expect(stoSplitPanelResizeEdgeClass).not.toContain('bg-muted-foreground');
  });
});

describe('clampPreviewPanelPercent', () => {
  it('returns default when container width is invalid', () => {
    expect(clampPreviewPanelPercent(0, 400)).toBe(STO_PREVIEW_SPLIT_DEFAULT);
  });

  it('clamps to 30–70', () => {
    expect(clampPreviewPanelPercent(1000, 100)).toBe(STO_PREVIEW_SPLIT_MIN);
    expect(clampPreviewPanelPercent(1000, 900)).toBe(STO_PREVIEW_SPLIT_MAX);
    expect(clampPreviewPanelPercent(1000, 500)).toBe(50);
  });
});

describe('SplitPanelResizeHandle', () => {
  it('exposes separator semantics with a hidden default edge', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SplitPanelResizeHandle
          valuePercent={50}
          onResizeStart={() => {}}
          onKeyboardAdjust={() => {}}
        />
      </I18nextProvider>,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemin="30"');
    expect(html).toContain('aria-valuemax="70"');
    expect(html).toContain(STO_SPLIT_RESIZE_EDGE_COLOR);
    expect(html).toContain('w-[2px]');
    expect(html).toContain('opacity-0');
    expect(html).toContain('pointer-events-none');
    expect(html).not.toContain('data-resizing');
    expect(html).not.toContain('bg-primary');
    expect(html).not.toContain('bg-muted-foreground');
  });

  it('sets data-resizing while dragging so the edge stays visible under overlay', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SplitPanelResizeHandle
          valuePercent={50}
          isResizing
          onResizeStart={() => {}}
          onKeyboardAdjust={() => {}}
        />
      </I18nextProvider>,
    );
    expect(html).toContain('data-resizing="true"');
    expect(html).toContain('group-data-[resizing=true]:opacity-100');
  });
});

describe('Chat and Home resize wiring', () => {
  it('passes isResizing from useSplitPanelResize into SplitPanelResizeHandle', () => {
    const chatSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Chat/index.tsx'),
      'utf8',
    );
    const homeSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Home/HomeMainConversation.tsx'),
      'utf8',
    );
    expect(chatSrc).toMatch(/isResizing\s*\}/);
    expect(chatSrc).toContain('isResizing={isResizing}');
    expect(homeSrc).toMatch(/isResizing\s*\}/);
    expect(homeSrc).toContain('isResizing={isResizing}');
  });

  it('mounts resize handle inside Preview body only for split mode', () => {
    const chatSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Chat/index.tsx'),
      'utf8',
    );
    const homeSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/Home/HomeMainConversation.tsx'),
      'utf8',
    );
    expect(chatSrc).toContain('isSplitChatLayout ? (');
    expect(chatSrc).toContain('SplitPanelResizeHandle');
    expect(homeSrc).toContain('isSplitChatLayout ? (');
    expect(homeSrc).toContain('SplitPanelResizeHandle');
  });
});
