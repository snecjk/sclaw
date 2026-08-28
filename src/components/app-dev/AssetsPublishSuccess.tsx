import { Button } from '@/components/ui/button';

export function AssetsPublishSuccess({
  version,
  artifactUrl,
  customDomain,
  onCopy,
}: {
  version?: string;
  artifactUrl?: string;
  customDomain?: string;
  onCopy: (value: string) => void;
}) {
  const hasPublishInfo = Boolean(version || artifactUrl || customDomain);

  return (
    <div className="space-y-3 text-xs">
      {hasPublishInfo ? (
        <dl className="space-y-2">
          <div>
            <dt className="text-muted-foreground">发布版本</dt>
            <dd className="font-mono">{version ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">OSS 产物</dt>
            <dd className="break-all font-mono">{artifactUrl ?? '-'}</dd>
          </div>
          {customDomain ? (
            <div>
              <dt className="text-muted-foreground">自定义域名</dt>
              <dd className="break-all font-mono">{customDomain}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-muted-foreground">发布成功，产物信息暂未返回</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!artifactUrl}
          onClick={() => artifactUrl && onCopy(artifactUrl)}
        >
          复制产物地址
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title="自定义域名申请即将开放"
        >
          申请自定义域名
        </Button>
      </div>
    </div>
  );
}
