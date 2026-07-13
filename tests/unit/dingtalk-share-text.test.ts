import { describe, expect, it } from 'vitest';
import {
  buildSharePathToUrlMap,
  collectConversationFileRefsFromText,
  normalizeSharePathKey,
  replaceConversationFileRefsWithShareUrls,
} from '../../shared/dingtalk-share-text';

const OSS_URL =
  'https://ali-sto-wisdom-star-test.oss-cn-shanghai.aliyuncs.com/ai-memory-center/temp/files/1782869580970_shentong-analysis-20260629.html?x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-date=20260701T013301Z&x-oss-expires=86399&x-oss-credential=LTAI5tKZku9MaQ4WCtzyMPbh%2F20260701%2Fcn-shanghai%2Foss%2Faliyun_v4_request&x-oss-signature=a46ca895d99c218e147b6eea94d1830ff20afc3ba955e9a4b2ab009b971b530f';

const LOCAL_PATH =
  '/Users/sto/.stoclaw/openclaw/workspace/.claw-output/shentong-analysis-20260629.html';

describe('replaceConversationFileRefsWithShareUrls', () => {
  it('replaces markdown file:// link target with oss url, preserving label and body', () => {
    const before = [
      '报告已生成并通过质量检查。',
      '',
      '**报告文件**：[申通快递分析 -20260629.html](file:///Users/sto/.stoclaw/openclaw/workspace/.claw-output/shentong-analysis-20260629.html)',
      '',
      '---',
      '*数据来源：东方财富 Choice、同花顺 iFinD · 免责声明详见报告末尾*',
    ].join('\n');

    const pathToUrl = buildSharePathToUrlMap([{ localPath: LOCAL_PATH, shareUrl: OSS_URL }]);
    const after = replaceConversationFileRefsWithShareUrls(before, pathToUrl);

    expect(after).toContain(
      '**报告文件**：[申通快递分析 -20260629.html](',
    );
    expect(after).toContain(OSS_URL);
    expect(after).not.toContain('file:///Users/sto/.stoclaw');
    expect(after.startsWith('报告已生成并通过质量检查。')).toBe(true);
    expect(after.endsWith('*数据来源：东方财富 Choice、同花顺 iFinD · 免责声明详见报告末尾*')).toBe(true);
  });

  it('matches legacy .openclaw workspace path in file url', () => {
    const legacyPath = '/Users/sto/.openclaw/workspace/.claw-output/shentong-analysis-20260629.html';
    const text = `[申通快递分析 -20260629.html](file://${legacyPath})`;
    const pathToUrl = buildSharePathToUrlMap([{ localPath: LOCAL_PATH, shareUrl: OSS_URL }]);
    const replaced = replaceConversationFileRefsWithShareUrls(text, pathToUrl);
    expect(replaced).toContain(OSS_URL);
    expect(replaced).not.toContain('file:///Users/sto/.openclaw');
  });
});

describe('collectConversationFileRefsFromText', () => {
  it('collects inline file urls from conversation text', () => {
    const refs = collectConversationFileRefsFromText(
      '报告文件：demo.html: file:///Users/sto/.stoclaw/openclaw/workspace/.claw-output/demo.html',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.fileName).toBe('demo.html');
    expect(refs[0]?.filePath).toContain('demo.html');
  });
});

describe('normalizeSharePathKey', () => {
  it('strips file scheme and normalizes slashes', () => {
    expect(normalizeSharePathKey(`file://${LOCAL_PATH}`)).toBe(LOCAL_PATH);
  });
});
