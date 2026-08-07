/**
 * Unified connect-time install: dispatch by server install.strategy (not product binary name).
 */
import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';
import { resolveManagedCliInstallStrategy } from '../../shared/connectors/resolve-install-strategy';
import { unwrapConnectorRuntime, resolveManagedCliBinary } from '../../shared/connectors/normalize-runtime';
import { connectorSkillSlug } from '../../shared/connectors/resolve-agent-skill';
import type { ConnectorDescriptor, ManagedCliInstallSpec } from '../../shared/connectors/types';
import { ConnectorError, ConnectorErrorCode } from './errors';
import { installConnectorSkillPackage } from './install-connector-skill';
import { installViaManifestAssets } from './installers/manifest-assets-installer';
import { installViaReleaseAsset } from './installers/release-asset-installer';
import { installViaShellScript } from './installers/shell-script-installer';

import {
  QPATH_CONNECTOR_RUNTIME,
} from '../../shared/connectors/qpath-connector-config';

/** Legacy defaults when catalogs omit URLs (compat until server configs are complete). */
const LEGACY_SHELL_DEFAULTS: Record<string, { unix: string; windows: string; binDir: string }> = {
  qpath: {
    unix: QPATH_CONNECTOR_RUNTIME.install.unix,
    windows: QPATH_CONNECTOR_RUNTIME.install.windows,
    binDir: QPATH_CONNECTOR_RUNTIME.install.binDir,
  },
};

const LEGACY_RELEASE_DEFAULTS: Record<string, { releaseApiUrl: string }> = {
  glab: {
    releaseApiUrl: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases?per_page=1',
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function resolveBinary(descriptor: ConnectorDescriptor): string {
  const runtime = unwrapConnectorRuntime(asRecord(descriptor.runtime));
  return resolveManagedCliBinary(runtime, {
    connectorId: descriptor.id,
    kind: descriptor.kind,
  });
}

async function installByManifestAssets(ctx: {
  descriptor: ConnectorDescriptor;
  installSpec: ManagedCliInstallSpec;
  binary: string;
  skillSlug?: string;
  onProgress?: (message: string) => void;
}): Promise<{ installedVersion?: string | null }> {
  ctx.onProgress?.('正在安装 CLI…');
  const result = await installViaManifestAssets({
    installSpec: ctx.installSpec,
    connectorId: ctx.descriptor.id,
    binary: ctx.binary,
    skillSlug: ctx.skillSlug,
    onProgress: ctx.onProgress,
  });
  if (!result.success) {
    throw new ConnectorError(
      ConnectorErrorCode.INSTALL_FAILED,
      result.error || 'CLI 安装失败（manifest_assets）',
    );
  }
  return { installedVersion: result.version ?? null };
}

async function installByShellScript(ctx: {
  binary: string;
  installSpec: ManagedCliInstallSpec;
  onProgress?: (message: string) => void;
}): Promise<{ installedVersion?: string | null }> {
  ctx.onProgress?.('正在通过安装脚本安装 CLI…');
  const legacy = LEGACY_SHELL_DEFAULTS[ctx.binary];
  const result = await installViaShellScript({
    binary: ctx.binary,
    unix: ctx.installSpec.unix || legacy?.unix,
    windows: ctx.installSpec.windows || legacy?.windows,
    binDir: ctx.installSpec.binDir || legacy?.binDir,
  });
  if (!result.success) {
    throw new ConnectorError(
      ConnectorErrorCode.INSTALL_FAILED,
      result.error || 'CLI 安装失败（shell_script）',
    );
  }
  return { installedVersion: result.version ?? null };
}

async function installByReleaseAsset(ctx: {
  binary: string;
  installSpec: ManagedCliInstallSpec;
  onProgress?: (message: string) => void;
}): Promise<{ installedVersion?: string | null }> {
  ctx.onProgress?.('正在从 Release 安装 CLI…');
  const legacy = LEGACY_RELEASE_DEFAULTS[ctx.binary];
  const releaseApiUrl = ctx.installSpec.releaseApiUrl || legacy?.releaseApiUrl;
  if (!releaseApiUrl) {
    throw new ConnectorError(
      ConnectorErrorCode.INSTALL_FAILED,
      '缺少 install.releaseApiUrl，请在服务端配置',
    );
  }
  const result = await installViaReleaseAsset({
    binary: ctx.binary,
    releaseApiUrl,
    assetNameHint: ctx.installSpec.assetNameHint,
    binDir: ctx.installSpec.binDir,
  });
  if (!result.success) {
    throw new ConnectorError(
      ConnectorErrorCode.INSTALL_FAILED,
      result.error || 'CLI 安装失败（release_asset）',
    );
  }
  return { installedVersion: result.version ?? null };
}

export async function installConnectorArtifacts(ctx: {
  descriptor: ConnectorDescriptor;
  onProgress?: (message: string) => void;
}): Promise<{ installedVersion?: string | null }> {
  const binary = resolveBinary(ctx.descriptor);
  const installSpec = parseManagedCliInstallSpec(ctx.descriptor.runtime);
  const skillSlug = connectorSkillSlug(ctx.descriptor) ?? undefined;
  const strategy = resolveManagedCliInstallStrategy(installSpec, { binary });

  let installed: { installedVersion?: string | null };
  if (strategy === 'shell_script') {
    installed = await installByShellScript({
      binary,
      installSpec,
      onProgress: ctx.onProgress,
    });
    await installConnectorSkillPackage({
      descriptor: ctx.descriptor,
      onProgress: ctx.onProgress,
    });
  } else if (strategy === 'release_asset') {
    installed = await installByReleaseAsset({
      binary,
      installSpec,
      onProgress: ctx.onProgress,
    });
  } else {
    installed = await installByManifestAssets({
      descriptor: ctx.descriptor,
      installSpec,
      binary,
      skillSlug,
      onProgress: ctx.onProgress,
    });
  }

  return installed;
}

/** Resolve dws install options from cached connector catalog (legacy install entry points). */
export function resolveDwsInstallOptionsFromDescriptor(
  descriptor: ConnectorDescriptor | undefined,
): {
  installSpec: ReturnType<typeof parseManagedCliInstallSpec>;
  connectorId: string;
  skillSlug: string;
} | undefined {
  if (!descriptor) return undefined;
  const installSpec = parseManagedCliInstallSpec(descriptor.runtime);
  return {
    installSpec,
    connectorId: descriptor.id,
    skillSlug: connectorSkillSlug(descriptor) ?? 'dws',
  };
}
