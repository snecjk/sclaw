import { findDingTalkConnectorId } from '../../shared/connectors/find-dingtalk-connector';
import { resolveEffectiveConnector } from '../../shared/connectors/resolve-effective-runtime';
import type { DwsInstallOptions } from '../utils/dws-cli';
import { getConnectorService } from './connector-service';
import { resolveDwsInstallOptionsFromDescriptor } from './connector-artifact-install';

/** Build dws install options from connector catalog (falls back to bundled manifest). */
export function resolveDwsInstallOptionsForLegacyInstall(): DwsInstallOptions | undefined {
  const catalog = getConnectorService().getCachedCatalog();
  const dingtalkId = findDingTalkConnectorId(catalog);
  let descriptor = dingtalkId
    ? catalog.find((item) => item.id === dingtalkId)
    : undefined;
  if (!descriptor) {
    descriptor = catalog.find((item) => {
      try {
        return resolveEffectiveConnector(item).binary === 'dws';
      } catch {
        return false;
      }
    });
  }
  const resolved = resolveDwsInstallOptionsFromDescriptor(descriptor);
  if (!resolved) return undefined;
  return {
    installSpec: resolved.installSpec,
    connectorId: resolved.connectorId,
    skillSlug: resolved.skillSlug,
  };
}
