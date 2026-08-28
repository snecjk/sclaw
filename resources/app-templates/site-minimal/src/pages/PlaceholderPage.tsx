import { Card, Empty, Typography } from 'antd';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      <Empty
        description={description || '页面骨架已就绪，可在此接入业务表格、表单或图表。'}
      />
    </Card>
  );
}
