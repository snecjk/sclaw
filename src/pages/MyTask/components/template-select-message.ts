import type { RecommendItem } from '@/lib/recommend-api';

/** 由推荐条目生成写入任务描述的文案 */
export function buildRecommendTaskMessage(item: RecommendItem): string {
  switch (item.item_type) {
    case 'workflow_template':
      return `/${item.title}`.trim();
    case 'workflow_instance':
      return `帮我执行 id 为：${item.item_ref_id} 的工作流 【${item.title}】`;
    case 'prompt':
      return (item.content || item.title || '').trim();
    case 'skill':
      return (item.skill_default_prompt || item.title || '').trim();
    default:
      return (item.title || '').trim();
  }
}
