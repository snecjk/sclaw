import { Empty, Typography } from 'antd';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({
  title = '暂无内容',
  description = '请根据实际业务添加页面内容。',
  action,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={false}
      />
      <Typography.Title level={4} className="empty-state-title">{title}</Typography.Title>
      <Typography.Paragraph className="empty-state-description">{description}</Typography.Paragraph>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
