// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  normalizeModelMessage,
} from '../../electron/services/model-message-normalizer';

const tempDirs: string[] = [];

async function tempFile(name: string, bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sclaw-model-message-'));
  tempDirs.push(directory);
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('normalizeModelMessage', () => {
  it('auto-wraps pure-text callers while keeping baked legacy requests on fallback', async () => {
    const pureText = await normalizeModelMessage({ message: '你好' });
    expect(pureText.legacy).toBe(false);
    expect(pureText.composition.segments).toEqual([{ type: 'text', text: '你好' }]);

    const legacy = await normalizeModelMessage({ message: '[文件: old.xlsx]请查看' });
    expect(legacy.legacy).toBe(true);
  });

  it('preserves mixed segment order and detects images from content', async () => {
    const spreadsheet = await tempFile('报价 & 明细.xlsx', Buffer.from('not-an-image'));
    const image = await tempFile('截图.png', Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]));
    const turn = await normalizeModelMessage({
      message: '比较 和  后执行',
      media: [
        { filePath: spreadsheet, fileName: '报价 & 明细.xlsx', mimeType: 'image/png' },
        { filePath: image, fileName: '截图.png', mimeType: 'application/octet-stream' },
      ],
      composition: {
        version: 1,
        segments: [
          { type: 'text', text: '比较' },
          { type: 'attachment', mediaIndex: 0, displayName: '报价 & 明细.xlsx' },
          { type: 'text', text: '和' },
          { type: 'attachment', mediaIndex: 1, displayName: '截图.png' },
          { type: 'skill', slug: 'quote-assistant', title: '报价助手' },
          { type: 'mention', displayName: '张三' },
          { type: 'workflow', id: 'wf_1', name: '报价审批' },
        ],
      },
    });

    expect(turn.attachments.map((item) => item.kind)).toEqual(['file', 'image']);
    expect(turn.attachments[0]?.detectedMimeType).toBeNull();
    expect(turn.attachments[1]?.mimeType).toBe('image/png');
    expect(turn.selectedSkillSlugs).toEqual(['quote-assistant']);
    expect(turn.modelText).toBe(
      `比较<file name="${spreadsheet.replaceAll('&', '&amp;')}" display_name="报价 &amp; 明细.xlsx"></file>和<file name="${image}" display_name="截图.png"></file><skill slug="quote-assistant" name="报价助手"></skill>@张三帮我执行 id 为：wf_1 的工作流 【报价审批】`,
    );
    expect(turn.modelContent.map((part) => part.type)).toEqual([
      'text', 'attachment', 'text', 'attachment', 'text',
    ]);
    expect(turn.modelText).toContain(
      '<skill slug="quote-assistant" name="报价助手"></skill>',
    );
    expect(turn.modelText).not.toContain('[技能:');
    expect(turn.modelText).not.toContain('SClaw-Skill');
  });

  it('rejects missing media indexes before adapter dispatch', async () => {
    await expect(normalizeModelMessage({
      message: '',
      composition: {
        version: 1,
        segments: [{ type: 'attachment', mediaIndex: 2, displayName: 'missing.xlsx' }],
      },
      media: [],
    })).rejects.toThrow('MODEL_COMPOSITION_INVALID');
  });

  it('requires every structured media item to be referenced exactly once', async () => {
    const first = await tempFile('a.txt', Buffer.from('a'));
    const second = await tempFile('b.txt', Buffer.from('b'));
    const media = [
      { filePath: first, fileName: 'a.txt', mimeType: 'text/plain' },
      { filePath: second, fileName: 'b.txt', mimeType: 'text/plain' },
    ];
    await expect(normalizeModelMessage({
      message: '',
      composition: { version: 1, segments: [{ type: 'attachment', mediaIndex: 0, displayName: 'a.txt' }] },
      media,
    })).rejects.toThrow('not referenced exactly once');
    await expect(normalizeModelMessage({
      message: '',
      composition: {
        version: 1,
        segments: [
          { type: 'attachment', mediaIndex: 0, displayName: 'a.txt' },
          { type: 'attachment', mediaIndex: 0, displayName: 'a.txt' },
        ],
      },
      media: media.slice(0, 1),
    })).rejects.toThrow('referenced more than once');
  });

  it('rejects unavailable and empty attachments', async () => {
    const empty = await tempFile('empty.txt', new Uint8Array());
    await expect(normalizeModelMessage({
      message: '',
      composition: { version: 1, segments: [{ type: 'attachment', mediaIndex: 0, displayName: 'empty.txt' }] },
      media: [{ filePath: empty, fileName: 'empty.txt', mimeType: 'text/plain' }],
    })).rejects.toThrow('MODEL_ATTACHMENT_UNAVAILABLE');
  });

  it('keeps a skill-only send meaningful without baking legacy markers or default prompts', async () => {
    const turn = await normalizeModelMessage({
      message: '',
      composition: {
        version: 1,
        segments: [{ type: 'skill', slug: 'quote-assistant', title: '报价助手' }],
      },
    });
    expect(turn.modelText).toBe(
      '<skill slug="quote-assistant" name="报价助手"></skill>',
    );
    expect(turn.selectedSkillSlugs).toEqual(['quote-assistant']);
  });

  it('escapes the shared Skill reference and preserves its exact mixed position', async () => {
    const turn = await normalizeModelMessage({
      message: '然后使用，列一下',
      composition: {
        version: 1,
        segments: [
          { type: 'text', text: '然后使用' },
          { type: 'skill', slug: 'html&style', title: '样式"设计' },
          { type: 'text', text: '，列一下' },
        ],
      },
    });
    const expected = '然后使用<skill slug="html&amp;style" name="样式&quot;设计"></skill>，列一下';
    expect(turn.modelText).toBe(expected);
    expect(turn.modelContent).toEqual([{ type: 'text', text: expected }]);
  });

  it('keeps DingTalk recipient context without duplicating its wrapped user body', async () => {
    const body = '最后分享到钉钉@客户端测试群';
    const context = '[STOCLAW:DINGTALK_RECIPIENTS:v1]\n```json\n{"recipients":[]}\n```';
    const turn = await normalizeModelMessage({
      message: `${context}\n---\n\n用户消息：\n${body}`,
      composition: {
        version: 1,
        segments: [
          { type: 'text', text: '最后分享到钉钉' },
          { type: 'mention', displayName: '客户端测试群' },
        ],
      },
    });

    expect(turn.modelText).toBe(`${body}\n\n${context}`);
    expect(turn.modelText.match(/最后分享到钉钉/g)).toHaveLength(1);
    expect(turn.modelText).not.toContain('用户消息：');
  });
});
