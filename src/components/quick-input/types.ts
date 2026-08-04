export type QuickInputItem = {
  id: string;
  title: string;
  /** 完整内容（hover tooltip / 选中填入） */
  content: string;
};

/** 内容在快捷输入列表中的存在状态（trim 后精确匹配） */
export type QuickInputPresence = 'empty' | 'exists' | 'absent';

/** 列表最多展示条数，超出时截断并展示底部提示 */
export const QUICK_INPUT_LIST_CAP = 99;
