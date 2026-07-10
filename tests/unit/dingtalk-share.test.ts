import { describe, expect, it } from 'vitest';
import {
  buildDingTalkShareAppLinkUrl,
  buildDingTalkShareDefaultMsg,
  DINGTALK_SHARE_APPLINK_HOST,
  DINGTALK_SHARE_APPLINK_PATH,
  DINGTALK_SHARE_DEEPLINK_ORIGIN,
} from '../../shared/dingtalk-share';
import {
  buildArtifactShareDialogDraft,
  buildArtifactShareDraft,
  buildConversationShareDialogDraft,
  buildConversationShareHttpFileLinks,
  isDingTalkShareContentTooLong,
  truncateConversationPreview,
} from '../../src/lib/dingtalk-share';

describe('buildDingTalkShareDefaultMsg', () => {
  it('builds text only', () => {
    const { defaultMsg, warnings } = buildDingTalkShareDefaultMsg({ text: '你好' });
    expect(defaultMsg).toBe('你好');
    expect(warnings).toEqual([]);
  });

  it('builds url as markdown link', () => {
    const { defaultMsg } = buildDingTalkShareDefaultMsg({
      url: 'https://example.com/doc',
    });
    expect(defaultMsg).toBe('[链接](https://example.com/doc)');
  });

  it('combines text, url, and images', () => {
    const { defaultMsg, warnings } = buildDingTalkShareDefaultMsg({
      text: '请查看',
      url: 'https://example.com/a',
      imageUrls: ['https://cdn.example.com/1.png', 'file:///tmp/x.png'],
    });
    expect(defaultMsg).toContain('请查看');
    expect(defaultMsg).toContain('[链接](https://example.com/a)');
    expect(defaultMsg).toContain('[图片](https://cdn.example.com/1.png)');
    expect(warnings.some((w) => w.includes('非 HTTP'))).toBe(true);
  });

  it('throws when empty', () => {
    expect(() => buildDingTalkShareDefaultMsg({})).toThrow(/分享内容为空/);
  });
});

describe('buildDingTalkShareAppLinkUrl', () => {
  it('produces deep link and applink with encoded url_param', () => {
    const built = buildDingTalkShareAppLinkUrl({
      text: '分享测试',
      title: '发给同事',
    });
    expect(built.url.startsWith(`${DINGTALK_SHARE_DEEPLINK_ORIGIN}/page/open_user_select`)).toBe(true);
    expect(built.appLinkUrl.startsWith(`${DINGTALK_SHARE_APPLINK_HOST}${DINGTALK_SHARE_APPLINK_PATH}`)).toBe(true);
    expect(built.url).toContain('wnd_caption=');
    expect(built.url).toContain('url_param=');
    expect(built.wndCaption).toBe('发给同事');
    expect(built.defaultMsg).toBe('分享测试');

    const parsed = new URL(built.url);
    const urlParam = parsed.searchParams.get('url_param');
    expect(urlParam).toBeTruthy();
    const payload = JSON.parse(decodeURIComponent(urlParam!)) as {
      sengMsgScene: boolean;
      defaultMsg: string;
    };
    expect(payload.sengMsgScene).toBe(true);
    expect(payload.defaultMsg).toBe('分享测试');
  });

  it('does not truncate share body within 2080 characters', () => {
    const body = '报告已生成并通过质量检查。\n\n'.repeat(40).trimEnd();
    expect(body.length).toBeLessThanOrEqual(2080);
    const built = buildDingTalkShareAppLinkUrl({ text: body, title: '分享对话' });
    expect(built.truncated).toBe(false);
    expect(built.defaultMsg).toBe(body);
  });

  it('truncates very long content to fit url length budget', () => {
    const built = buildDingTalkShareAppLinkUrl(
      { text: 'x'.repeat(5000) },
      { maxUrlLength: 500 },
    );
    expect(built.url.length).toBeLessThanOrEqual(500);
    expect(built.truncated).toBe(true);
  });

  it('preserves share url when truncating long text', () => {
    const shareUrl = 'https://oss.example.com/report.html?sig=abc123';
    const built = buildDingTalkShareAppLinkUrl(
      {
        text: '报告已生成并通过质量检查。\n\n'.repeat(80),
        url: shareUrl,
      },
      { maxUrlLength: 900 },
    );
    expect(built.truncated).toBe(true);
    expect(built.defaultMsg).toContain(`[链接](${shareUrl})`);
    expect(built.defaultMsg).toContain('…（内容已截断）');
  });
  it('detects share content over 2080 characters', () => {
    expect(isDingTalkShareContentTooLong({ text: 'a'.repeat(2081) })).toBe(true);
    expect(isDingTalkShareContentTooLong({ text: 'a'.repeat(2080) })).toBe(false);
  });
});

describe('truncateConversationPreview', () => {
  it('keeps up to two lines and appends ellipsis', () => {
    const preview = truncateConversationPreview('第一行\n第二行\n第三行');
    expect(preview).toBe('第一行\n第二行...');
  });

  it('wraps a long single paragraph into two lines', () => {
    const preview = truncateConversationPreview(
      '申通快递（002468.SZ）深度分析摘要：公司基本面稳健增长，盈利能力持续改善，估值处于合理区间。报告已生成并通过质量检查。更多详细内容请查看附件产物。',
    );
    expect(preview.split('\n').length).toBe(2);
    expect(preview.length).toBeGreaterThan(52);
  });

  it('truncates very long single line', () => {
    const preview = truncateConversationPreview('a'.repeat(200));
    expect(preview.endsWith('...')).toBe(true);
    expect(preview.split('\n').length).toBe(2);
    expect(preview.length).toBeLessThan(120);
  });

  it('keeps up to nine lines for conversation share preview', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `第${i + 1}行`).join('\n');
    const preview = truncateConversationPreview(lines, 9);
    expect(preview).toBe('第1行\n第2行\n第3行\n第4行\n第5行\n第6行\n第7行\n第8行\n第9行...');
  });
});

describe('buildConversationShareDialogDraft', () => {
  it('uses plain text preview without injecting share urls', () => {
    const draft = buildConversationShareDialogDraft(
      '请查看 [产物](https://oss.example.com/report.html)\n第二行',
      [],
    );
    expect(draft.kind).toBe('conversation');
    if (draft.kind === 'conversation') {
      expect(draft.textPreview).not.toContain('[链接]');
      expect(draft.textPreview).toContain('产物');
    }
  });

  it('keeps conversation preview as summary text only while retaining files for share', () => {
    const draft = buildConversationShareDialogDraft(
      '报告已生成。',
      [{
        fileName: '客户异常监控报告_20260707.html',
        filePath: 'https://baseinfo-chatbotapi.sto.cn/api/agentrun/artifact/preview?filePath=demo.html',
        mimeType: 'text/html',
        fileSize: 0,
        preview: null,
      }],
    );
    expect(draft.kind).toBe('conversation');
    if (draft.kind === 'conversation') {
      expect(draft.textPreview).toBe('报告已生成。');
      expect(draft.textPreview).not.toContain('客户异常监控报告_20260707');
      expect(draft.files).toHaveLength(1);
    }
  });
});

describe('buildConversationShareHttpFileLinks', () => {
  it('builds markdown links for http artifact files', () => {
    const links = buildConversationShareHttpFileLinks([{
      fileName: '客户异常监控报告_20260707',
      filePath: 'https://baseinfo-chatbotapi.sto.cn/api/agentrun/artifact/preview?filePath=demo.html',
    }]);
    expect(links).toBe(
      '[客户异常监控报告_20260707](https://baseinfo-chatbotapi.sto.cn/api/agentrun/artifact/preview?filePath=demo.html)',
    );
  });
});

describe('buildArtifactShareDraft', () => {
  it('uses public url as-is', () => {
    const draft = buildArtifactShareDraft({
      fileName: 'report.html',
      filePath: 'https://cdn.example.com/report.html',
    });
    expect(draft.title).toBe('report');
    expect(draft.text).toContain('report.html');
    expect(draft.url).toBe('https://cdn.example.com/report.html');
    expect(draft.isLocalServeUrl).toBe(false);
  });

  it('marks local files without serve url', () => {
    const draft = buildArtifactShareDraft({
      fileName: 'demo-dashboard.html',
      filePath: '/tmp/demo-dashboard.html',
    });
    expect(draft.url).toBe('');
    expect(draft.isLocalServeUrl).toBe(true);
  });
});

describe('buildArtifactShareDialogDraft', () => {
  it('builds artifact card draft', () => {
    const draft = buildArtifactShareDialogDraft({
      fileName: '每周总部对账单.html',
      filePath: 'https://cdn.example.com/report.html',
      mimeType: 'text/html',
    }, (key) => key);
    expect(draft.kind).toBe('artifact');
    if (draft.kind === 'artifact') {
      expect(draft.title).toBe('每周总部对账单');
      expect(draft.filePath).toBe('https://cdn.example.com/report.html');
    }
  });
});
