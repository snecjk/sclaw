/** 建站冲突：交给 AI 时写入对话的提示文案。 */

export function buildStoAppConflictAiPrompt(paths: string[]): string {
  const list = paths
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => `- ${path}`);
  if (list.length === 0) {
    return '本地与远端有合并冲突，请帮我处理冲突标记并给出可继续合并的最终文件内容。';
  }
  return [
    '拉取远端后，以下文件出现了合并冲突。',
    '文件里已有 `<<<<<<< Local` / `=======` / `>>>>>>> Remote` 标记。',
    '请结合本地与远端改动，保留合理逻辑，去掉冲突标记，把每个文件改成可继续合并的最终版本：',
    '',
    ...list,
    '',
    '处理完后不要提交；我会在冲突面板点「继续合并」。',
  ].join('\n');
}
