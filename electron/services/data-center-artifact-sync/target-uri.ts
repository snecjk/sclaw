import type { DataCenterArtifactTarget } from './types';

const SCHEME = 'data-center://';

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function parseDataCenterTargetUri(uri: string, label?: string | null): DataCenterArtifactTarget | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith(SCHEME)) return null;
  const rest = trimmed.slice(SCHEME.length);
  const parts = rest.split('/').filter((part) => part.length > 0).map(decodePart);
  if (parts.length < 2) return null;

  const spaceType = parts[0];
  if (!spaceType) return null;

  if (parts.length === 2) {
    return {
      uri: buildDataCenterTargetUri({
        spaceType,
        parentEntryId: parts[1] || 'root',
      }),
      spaceType,
      parentEntryId: parts[1] || 'root',
      label: label ?? null,
    };
  }

  return {
    uri: buildDataCenterTargetUri({
      spaceType,
      spaceId: parts[1] || null,
      parentEntryId: parts.slice(2).join('/') || 'root',
    }),
    spaceType,
    spaceId: parts[1] || null,
    parentEntryId: parts.slice(2).join('/') || 'root',
    label: label ?? null,
  };
}

export function buildDataCenterTargetUri(target: {
  spaceType: string;
  spaceId?: string | null;
  parentEntryId?: string | null;
}): string {
  const spaceType = encodePart(target.spaceType);
  const parentEntryId = encodePart(target.parentEntryId?.trim() || 'root');
  const spaceId = target.spaceId?.trim();
  if (spaceId) {
    return `${SCHEME}${spaceType}/${encodePart(spaceId)}/${parentEntryId}`;
  }
  return `${SCHEME}${spaceType}/${parentEntryId}`;
}

export function targetLabel(target: DataCenterArtifactTarget): string {
  if (target.label?.trim()) return target.label.trim();
  if (target.spaceType === 'qa_artifact') return '我的产物';
  if (target.spaceType === 'site_shared_artifact') return '网点共享产物';
  return target.spaceType;
}
