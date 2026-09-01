import { ContentSection } from '../components/ContentSection';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader breadcrumbs={[{ title: '首页' }, { title }]} title={title} />
      <ContentSection>
        <EmptyState description={description || '页面骨架已就绪，可在此接入业务内容。'} />
      </ContentSection>
    </>
  );
}
