import { Breadcrumb, Typography } from 'antd';
import type { BreadcrumbProps } from 'antd';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  extra?: ReactNode;
  breadcrumbs?: BreadcrumbProps['items'];
}

export function PageHeader({ title, description, extra, breadcrumbs }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {breadcrumbs?.length ? <Breadcrumb items={breadcrumbs} /> : null}
        <Typography.Title level={2} className="page-header-title">{title}</Typography.Title>
        {description ? <Typography.Paragraph className="page-header-description">{description}</Typography.Paragraph> : null}
      </div>
      {extra ? <div className="page-header-extra">{extra}</div> : null}
    </header>
  );
}
