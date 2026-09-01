import { ContentSection } from '../components/ContentSection';
import { EmptyState } from '../components/EmptyState';

export function HomePage() {
  return (
    <ContentSection>
      <EmptyState
        title="应用骨架已就绪"
        description="你可以根据实际业务添加列表、表单、详情或数据看板。"
      />
    </ContentSection>
  );
}
