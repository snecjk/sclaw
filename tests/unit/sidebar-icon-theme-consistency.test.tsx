import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemedMonochromeIcon } from '@/components/icons/themed-monochrome-icon';
import { contentHeaderActionBtnClass } from '@/lib/surfaces';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const sidebarSource = readSource('src/components/layout/Sidebar.tsx');
const projectsSource = readSource('src/components/layout/sidebar-projects-section.tsx');
const recentTrailingSource = readSource(
  'src/components/layout/sidebar-recent-session-row-trailing.tsx',
);
const projectTrailingSource = readSource(
  'src/components/layout/sidebar-project-session-row-trailing.tsx',
);
const projectRowTrailingSource = readSource(
  'src/components/layout/sidebar-project-row-trailing.tsx',
);
const composerIconSource = readSource('src/components/icons/composer-toolbar-icons.tsx');
const composerToolbarSource = readSource(
  'src/components/input-composer/input-composer-toolbar.tsx',
);
const dataCenterEntriesSource = readSource('src/pages/DataCenter/components/entries.tsx');
const dataCenterModalsSource = readSource('src/pages/DataCenter/components/modals.tsx');
const dataCenterSource = readSource('src/pages/DataCenter/index.tsx');
const skillPlazaHeaderSource = readSource('src/components/skill-plaza/SkillPlazaHeader.tsx');
const skillCardSource = readSource('src/components/skill-plaza/SkillCard.tsx');

describe('theme-aware operational icons', () => {
  it('does not render color-locked operational svg assets through img elements', () => {
    const cases = [
      [sidebarSource, ['sidebarCollapseAllGroupsIcon', 'sidebarExpandAllGroupsIcon']],
      [
        projectsSource,
        [
          'sidebarCollapseAllGroupsIcon',
          'sidebarExpandAllGroupsIcon',
          'sidebarNewProjectIcon',
        ],
      ],
      [recentTrailingSource, ['sidebarPinIcon', 'sidebarUnpinIcon']],
      [projectTrailingSource, ['sidebarPinIcon', 'sidebarUnpinIcon']],
      [projectRowTrailingSource, ['sidebarProjectNewChatIcon']],
      [dataCenterEntriesSource, ['downloadIcon', 'shareIcon', 'uploadIcon']],
      [dataCenterModalsSource, ['downloadIcon', 'shareIcon', 'uploadIcon']],
      [dataCenterSource, ['qrCodeIcon']],
      [skillPlazaHeaderSource, ['folderIcon']],
      [skillCardSource, ['messageIcon', 'moreIcon']],
    ] as const;

    for (const [source, iconNames] of cases) {
      expect(source).toContain('ThemedMonochromeIcon');
      for (const iconName of iconNames) {
        expect(source).not.toMatch(
          new RegExp(`<img[\\s\\S]{0,180}src=\\{[^}]*${iconName}[^}]*\\}`),
        );
      }
    }
  });

  it('maps locked monochrome fills to currentColor when rendered', () => {
    const source =
      '<svg><path fill="#1D2129"/><path fill="#4E5969"/><path fill="#86909C"/></svg>';
    const { container } = render(
      <ThemedMonochromeIcon source={source} className="h-4 w-4" />,
    );

    expect(container.innerHTML).toContain('fill="currentColor"');
    expect(container.innerHTML).not.toContain('#1D2129');
    expect(container.innerHTML).not.toContain('#4E5969');
    expect(container.innerHTML).not.toContain('#86909C');
  });

  it('uses the same neutral dark role for header and composer action icons', () => {
    expect(contentHeaderActionBtnClass).toContain('sto-icon--neutral');
    expect(composerIconSource).toContain(
      "const composerIconClass = 'h-[22px] w-[22px] shrink-0';",
    );
    expect(composerIconSource).not.toContain('dark:text-muted-foreground');
    expect(composerToolbarSource).toContain(
      'text-[var(--sto-icon-primary)] hover:bg-[#F0F2F5] dark:text-[var(--sto-icon-secondary)]',
    );
    expect(composerToolbarSource).toContain(
      'text-[var(--sto-icon-primary)] hover:bg-black/5 hover:text-foreground dark:text-[var(--sto-icon-secondary)]',
    );
  });
});
