import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from '../../shared/markdown-to-plain-text';

describe('markdownToPlainText', () => {
  it('converts conversation share sample with bold, lists and link', () => {
    const md = [
      '报告已生成并通过质量检查。',
      '',
      '**📊 申通快递 (002468.SZ) 深度分析摘要**',
      '',
      '**核心结论：场景 C 横盘观望**',
      '- 收盘价 ¥13.42 站稳 MA5(¥13.28) 连续 3 日，短期支撑有效',
      '- MACD 绿柱缩短至 -0.08，空头动能边际减弱但死叉未改',
      '',
      '**报告文件**：[申通快递分析 -20260629.html](https://oss.example.com/report.html)',
      '',
      '---',
      '*数据来源：东方财富 Choice、同花顺 iFinD · 免责声明详见报告末尾*',
    ].join('\n');

    const plain = markdownToPlainText(md);

    expect(plain).toContain('报告已生成并通过质量检查。');
    expect(plain).toContain('📊 申通快递 (002468.SZ) 深度分析摘要');
    expect(plain).not.toContain('**');
    expect(plain).toContain('- 收盘价 ¥13.42');
    expect(plain).toContain('申通快递分析 -20260629.html: https://oss.example.com/report.html');
    expect(plain).toContain('数据来源：东方财富 Choice、同花顺 iFinD');
    expect(plain.split('\n').length).toBeGreaterThan(6);
  });

  it('preserves paragraph breaks', () => {
    const plain = markdownToPlainText('第一段\n\n第二段');
    expect(plain).toBe('第一段\n\n第二段');
  });

  it('strips inline code and headings', () => {
    const plain = markdownToPlainText('## 标题\n\n使用 `npm test` 运行');
    expect(plain).toBe('标题\n\n使用 npm test 运行');
  });

  it('converts fenced code blocks', () => {
    const plain = markdownToPlainText('```ts\nconst x = 1;\n```');
    expect(plain).toBe('const x = 1;');
  });

  it('does not corrupt OSS signed URLs with underscores', () => {
    const ossUrl =
      'https://ali-sto-wisdom-star-test.oss-cn-shanghai.aliyuncs.com/ai-memory-center/temp/files/1782871582202_shentong-analysis-20260629.html?x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-credential=LTAI5tKZku9MaQ4WCtzyMPbh%2F20260701%2Fcn-shanghai%2Foss%2Faliyun_v4_request&x-oss-signature=abc';
    const md = `**报告文件**：[申通快递分析 -20260629.html](${ossUrl})`;
    const plain = markdownToPlainText(md);
    expect(plain).toContain(ossUrl);
    expect(plain).not.toContain('1782871582202shentong');
    expect(plain).not.toContain('aliyunv4');
  });
});
