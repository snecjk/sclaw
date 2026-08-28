export type ExternalServiceAuthType = 'none' | 'stoToken';
export type ExternalServiceDeployEnv = 'daily' | 'stage' | 'online';
export type ExternalServiceStatus = 'ACTIVE' | 'DISABLED';

export interface ExternalServiceIntegration {
  npmPackage?: string;
  packageVersion?: string;
  usageGuide?: string;
}

export interface ExternalServiceDraftInput {
  name: string;
  description: string;
  owner: string;
  environments: Record<ExternalServiceDeployEnv, string>;
  auth: { type: ExternalServiceAuthType };
  integration?: ExternalServiceIntegration;
}

export interface ExternalServiceVersionConfig extends ExternalServiceDraftInput {
  schemaVersion: 'external-service/v1';
  serviceId: string;
  version: string;
}

export interface ExternalServiceDraft extends ExternalServiceDraftInput {
  schemaVersion: 'external-service/v1';
  serviceId: string;
  latestVersion: string | null;
  status: ExternalServiceStatus;
}

export interface ExternalServiceBindingSnapshot extends ExternalServiceVersionConfig {
  alias: string;
}

export interface ExternalServicesManifest {
  schemaVersion: 'external-services/v1';
  services: ExternalServiceBindingSnapshot[];
}

export interface ExternalServiceSummary {
  serviceId: string;
  name: string;
  description: string;
  owner: string;
  status: ExternalServiceStatus;
  latestVersion: string | null;
  authType: ExternalServiceAuthType;
  hasSdk: boolean;
  updatedAt: string;
}

export interface ExternalServicePageResult {
  items: ExternalServiceSummary[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface ExternalServiceVersionSummary {
  serviceId: string;
  version: string;
  publishedAt: string;
  publishedBy: string | null;
}
