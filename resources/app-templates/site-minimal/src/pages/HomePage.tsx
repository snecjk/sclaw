import { ContentSection } from '../components/ContentSection';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function HomePage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ title: '首页' }]}
        title="__APP_TITLE__"
        description="从这里开始构建你的业务页面。"
      />
      <ContentSection>
        <EmptyState
          title="应用骨架已就绪"
          description="你可以根据实际业务添加列表、表单、详情或数据看板。"
        />
      </ContentSection>
    </>
  );
}
