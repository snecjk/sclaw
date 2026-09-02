import type { CodeApplicationPageType } from './code-application-catalog';

export type PublishSuccessPresentation =
  | { pageType: 'site'; fixedUrl?: string }
  | {
      pageType: 'assets';
      version?: string;
      artifactUrl?: string;
      customDomain?: string;
    };

type ResourceRecord = Record<string, unknown>;

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asHttpUrl(value: unknown): string | undefined {
  const trimmed = asTrimmedString(value);
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function resourceRecords(value: unknown): ResourceRecord[] {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.flatMap((row) => {
    if (typeof row === 'string') return [{ url: row }];
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return [row as ResourceRecord];
    }
    return [];
  });
}

function pickRecordValue(
  records: ResourceRecord[],
  keys: readonly string[],
  normalize: (value: unknown) => string | undefined,
): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const resolved = normalize(record[key]);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

export function resolvePublishSuccessPresentation(input: {
  pageType: CodeApplicationPageType;
  deploymentVersion?: string;
  revisionId?: string;
  resourcePages?: unknown;
}): PublishSuccessPresentation {
  const records = resourceRecords(input.resourcePages);
  if (input.pageType === 'site') {
    return {
      pageType: 'site',
      fixedUrl: pickRecordValue(
        records,
        ['fixedUrl', 'pageUrl', 'previewUrl', 'url', 'domain'],
        asHttpUrl,
      ),
    };
  }

  const version = asTrimmedString(input.deploymentVersion)
    ?? pickRecordValue(records, ['version', 'deploymentVersion'], asTrimmedString)
    ?? asTrimmedString(input.revisionId);
  const artifactUrl = pickRecordValue(
    records,
    ['artifactUrl', 'ossUrl', 'resourceUrl', 'downloadUrl', 'url'],
    asHttpUrl,
  );
  const customDomain = pickRecordValue(
    records,
    ['customDomain', 'domain'],
    asTrimmedString,
  );

  return {
    pageType: 'assets',
    ...(version ? { version } : {}),
    ...(artifactUrl ? { artifactUrl } : {}),
    ...(customDomain ? { customDomain } : {}),
  };
}
