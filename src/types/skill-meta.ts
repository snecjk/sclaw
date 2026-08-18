/** Local-only skill context for composer tokens and user message bubbles. */
export interface SkillMeta {
  slug: string;
  title: string;
  /**
   * 技能标签在气泡正文中的插入位置（字符下标）。
   * 仅当前会话有效：Gateway transcript marker 不持久化该字段，
   * history 回写后为 undefined，气泡退回「标签在正文最前」。
   */
  tagOffset?: number;
}
