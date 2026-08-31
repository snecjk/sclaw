import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokens = read('src/styles/theme/tokens.css');
const recipes = read('src/styles/theme/recipes.css');

const dialogSources = [
  'src/components/ui/dialog.tsx',
  'src/components/ui/confirm-dialog.tsx',
  'src/components/skill-plaza/SkillDetailModal.tsx',
  'src/components/skill-plaza/SkillUploadModal.tsx',
  'src/components/more-apps/AddExternalAppModal.tsx',
  'src/pages/MyTask/components/TaskCreateModal.tsx',
  'src/components/layout/sidebar-project-form-dialog.tsx',
] as const;

const sharedDialogRadiusSources = [
  ...dialogSources,
  'src/components/connectors/TokenConnectModal.tsx',
  'src/components/connectors/ConnectorCard.tsx',
  'src/components/layout/sidebar-recent-group-dialogs.tsx',
  'src/components/quick-input/QuickInputCreateModal.tsx',
  'src/components/quick-input/QuickInputManageModal.tsx',
  'src/components/user-form/UserFormModal.tsx',
  'src/pages/DataCenter/components/modals.tsx',
  'src/pages/Models/TokenQuotaDialog.tsx',
  'src/pages/MyTask/components/TemplateSelectModal.tsx',
  'src/lib/surfaces.ts',
] as const;

describe('dark dialog and neutral icon consistency', () => {
  it('defines one theme-mapped dialog surface and action recipe', () => {
    expect(tokens).toContain('--sto-dialog-background:');
    expect(tokens).toContain('--sto-dialog-action-background:');
    expect(tokens).toContain('--sto-dialog-action-hover-background:');
    expect(tokens).toContain('--sto-dialog-action-foreground:');
    expect(tokens).toContain('--sto-dialog-radius: 18px');
    expect(recipes).toContain('.sto-overlay--dialog');
    expect(recipes).toMatch(/\.sto-overlay(?:\.sto-overlay)?--dialog\s*\{[^}]*backdrop-filter:\s*none/s);
    expect(recipes).toMatch(/\.sto-control--dialog-primary\s*\{[^}]*var\(--sto-dialog-action-background\)/s);
  });

  it('keeps ordinary icons on neutral semantic roles', () => {
    expect(recipes).toContain('.sto-icon--neutral');
    expect(recipes).toContain('color: var(--sto-icon-secondary)');
    expect(recipes).toContain('.sto-dialog-close');
  });

  it('routes representative dialogs through shared surface, scrim and footer recipes', () => {
    for (const file of dialogSources) {
      const source = read(file);
      expect(source, file).toContain('sto-overlay--dialog');
      expect(source, file).toContain('sto-overlay-scrim--dialog');
    }

    for (const file of [
      'src/components/ui/dialog.tsx',
      'src/components/skill-plaza/SkillDetailModal.tsx',
      'src/components/skill-plaza/SkillUploadModal.tsx',
      'src/pages/MyTask/components/TaskCreateModal.tsx',
    ]) {
      expect(read(file), file).not.toContain('backdrop-blur-sm');
    }
  });

  it('does not use brand or warning fills for normal dark dialog actions', () => {
    const skillDetail = read('src/components/skill-plaza/SkillDetailModal.tsx');
    expect(skillDetail).not.toMatch(/bg-(?:primary|amber-)/);
    expect(skillDetail).toContain('sto-control--dialog-primary');

    const taskCreate = read('src/pages/MyTask/components/TaskCreateModal.tsx');
    expect(taskCreate).not.toContain('bg-[#FFFFFF]');
  });

  it('keeps the scheduled-task form on dialog surfaces and the generic data dialog on the standard radius', () => {
    const surfaces = read('src/lib/surfaces.ts');
    const taskComposer = read('src/pages/MyTask/components/TaskInstructionComposer.tsx');
    const dataCenterModals = read('src/pages/DataCenter/components/modals.tsx');

    expect(surfaces).toMatch(
      /taskCreateFormControlClass[\s\S]*?sto-control--dialog-field[\s\S]*?schedulePickerTriggerClass[\s\S]*?sto-control--dialog-field/,
    );
    expect(taskComposer).not.toContain('bg-[#FFFFFF]');
    expect(dataCenterModals).toMatch(
      /function DataCenterModal[\s\S]*?sto-overlay--dialog[\s\S]*?rounded-\[var\(--sto-dialog-radius\)\]/,
    );
  });

  it('routes shared dialog containers through one radius mapping', () => {
    for (const file of sharedDialogRadiusSources) {
      const declarations = read(file)
        .split('\n')
        .filter((line) => line.includes('sto-overlay sto-overlay--dialog'));

      expect(declarations.length, file).toBeGreaterThan(0);
      for (const declaration of declarations) {
        expect(declaration, file).toContain('rounded-[var(--sto-dialog-radius)]');
      }
    }

    const moreAppsStyles = read('src/components/more-apps/more-apps.css');
    expect(moreAppsStyles).toMatch(
      /\.more-apps-modal__panel\s*\{[^}]*border-radius:\s*var\(--sto-dialog-radius\)/s,
    );
  });
});
