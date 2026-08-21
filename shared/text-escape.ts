/**
 * 把字面 `\n` / `\r` / `\t`（反斜杠 + 字符）还原成真换行 / 制表。
 *
 * 模型在工具 JSON 参数里常把 JSON.stringify 的 `\n` 当字面字符塞进文本，导致：
 * - 执行气泡 `whitespace-pre-wrap` 原样显示字面 `\n`（反斜杠可见）
 * - 编辑回填 `appendTextWithLineBreaks` 只切真换行，字面 `\n` 不转 `<br>`
 * - 清洗正则 `\n{3,}` 只匹配真换行，字面 `\n` 逃逸所有清洗
 *
 * **仅用于 NL 入口 / NL 创建标记的任务**：UI 输入的字面 `\n` 可能是用户故意输入
 * （正则 / 代码示例），不能误转。幂等：真换行（0x0A）不会被再次匹配。
 */
export function unescapeLiteralNewlines(text: string): string {
  if (!text || !/[\\][nrt]/.test(text)) return text;
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}
