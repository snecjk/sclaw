export type QuickInputItem = {
  id: string;
  title: string;
  /** 完整内容（hover tooltip / 选中填入） */
  content: string;
};

/** 列表最多展示条数，超出时截断并展示底部提示 */
export const QUICK_INPUT_LIST_CAP = 99;
