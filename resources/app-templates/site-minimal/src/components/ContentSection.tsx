import { Typography } from 'antd';
import type { ReactNode } from 'react';

interface ContentSectionProps {
  children: ReactNode;
  title?: string;
  extra?: ReactNode;
}

export function ContentSection({ children, title, extra }: ContentSectionProps) {
  return (
    <section className="content-section">
      {title || extra ? (
        <div className="content-section-header">
          {title ? <Typography.Title level={4} className="content-section-title">{title}</Typography.Title> : <span />}
          {extra ? <div>{extra}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
