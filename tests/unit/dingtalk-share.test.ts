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

  it('truncates very long content to fit url length budget', () => {
    const built = buildDingTalkShareAppLinkUrl(
      { text: 'x'.repeat(5000) },
      { maxUrlLength: 500 },
    );
    expect(built.url.length).toBeLessThanOrEqual(500);
    expect(built.truncated).toBe(true);
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
