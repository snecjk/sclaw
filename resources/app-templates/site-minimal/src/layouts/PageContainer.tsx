import { Layout } from 'antd';
import type { ReactNode } from 'react';

const { Content } = Layout;

interface PageContainerProps {
  children: ReactNode;
}

export function PageContainer({ children }: PageContainerProps) {
  return <Content className="app-content">{children}</Content>;
}
