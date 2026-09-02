import type { CodeApplicationPageType } from './code-application-catalog';

export type TemplateImportChangeKind = 'add' | 'modify' | 'delete';
export type TemplateImportIssueLevel = 'warning' | 'blocker';

export interface TemplateImportFileChange {
  path: string;
  kind: TemplateImportChangeKind;
}

export interface TemplateImportIssue {
  code:
    | 'INVALID_PROJECT'
    | 'PAGE_TYPE_MISMATCH'
    | 'PAGE_TYPE_UNDECLARED'
    | 'PACKAGE_JSON_INVALID'
    | 'VITE_CONFIG_UNRECOGNIZED'
    | 'DEPENDENCY_CONFLICT'
    | 'SENSITIVE_FILE_IGNORED'
    | 'SOURCE_ENTRY_WRAPPED'
    | 'SOURCE_LIMIT_EXCEEDED'
    | 'GIT_UNAVAILABLE';
  level: TemplateImportIssueLevel;
  message: string;
  path?: string;
}

export interface TemplateImportPackageChange {
  name: string;
  section: 'scripts' | 'dependencies' | 'devDependencies' | 'resolutions' | 'overrides';
  sourceValue?: string;
  appliedValue?: string;
  resolution: 'source' | 'platform' | 'added';
}

export interface TemplateImportPreview {
  importToken: string;
  sourceName: string;
  detectedStack: 'react-vite';
  pageType: CodeApplicationPageType;
  changes: TemplateImportFileChange[];
  ignoredPaths: string[];
  packageChanges: TemplateImportPackageChange[];
  issues: TemplateImportIssue[];
  expiresAt: string;
}

export interface TemplateImportStatus {
  hasSource: boolean;
  sourceName?: string;
  sourceAvailable: boolean;
  lastImportedAt?: string;
}

export interface TemplateImportApplyResult {
  changedFiles: string[];
  checkpointCreated: boolean;
  importedAt: string;
  restartRequested: boolean;
}
