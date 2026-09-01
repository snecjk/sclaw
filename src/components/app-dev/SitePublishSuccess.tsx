import { Button } from '@/components/ui/button';

export function SitePublishSuccess({
  fixedUrl,
  onCopy,
  onOpen,
}: {
  fixedUrl?: string;
  onCopy: (value: string) => void;
  onOpen: (value: string) => void;
}) {
  if (!fixedUrl) {
    return <p className="text-xs text-muted-foreground">发布成功，访问地址暂未返回</p>;
  }

  return (
    <dl className="space-y-2 text-xs">
      <div className="space-y-1">
        <dt className="text-muted-foreground">固定域名</dt>
        <dd className="break-all font-mono">{fixedUrl}</dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onCopy(fixedUrl)}>
          复制地址
        </Button>
        <Button type="button" size="sm" onClick={() => onOpen(fixedUrl)}>
          访问站点
        </Button>
      </div>
    </dl>
  );
}
