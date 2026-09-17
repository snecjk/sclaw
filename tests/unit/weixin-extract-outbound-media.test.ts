import { describe, expect, it } from 'vitest';
import { extractOutboundMediaFromAnswer } from '../../electron/message-channel/weixin/extract-outbound-media';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('extractOutboundMediaFromAnswer', () => {
  const dir = join(tmpdir(), `weixin-media-extract-${Date.now()}`);

  it('extracts file:// markdown links and leaves remaining text', () => {
    mkdirSync(dir, { recursive: true });
    const png = join(dir, 'wanxia.png');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const answer = `晚霞如下：\n\n[wanxia.png](file://${png})\n\n好看吗？`;
      const result = extractOutboundMediaFromAnswer(answer);
      expect(result.filePaths).toEqual([png]);
      expect(result.text).toContain('晚霞如下');
      expect(result.text).toContain('好看吗');
      expect(result.text).not.toContain('file://');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts backtick-wrapped absolute paths after Chinese colon', () => {
    const mp3 = '/Users/yaolei/.stoclaw/workspace/.claw-output/birdsong.mp3';
    const answer = `✅ 已生成\n📁 路径：\`${mp3}\`\n⏱️ 时长：10秒`;
    const result = extractOutboundMediaFromAnswer(answer);
    expect(result.filePaths).toEqual([mp3]);
    expect(result.text).not.toContain('birdsong.mp3');
  });

  it('extracts plain absolute path after Chinese colon', () => {
    const mp3 = '/Users/yaolei/.stoclaw/workspace/.claw-output/birdsong.mp3';
    const result = extractOutboundMediaFromAnswer(`路径：${mp3}`);
    expect(result.filePaths).toEqual([mp3]);
  });

  it('extracts html and mp3 file:// links', () => {
    mkdirSync(dir, { recursive: true });
    const html = join(dir, 'report.html');
    const mp3 = join(dir, 'clip.mp3');
    writeFileSync(html, '<html></html>');
    writeFileSync(mp3, Buffer.from([0xff, 0xfb]));
    try {
      const answer = `[报告](file://${html})\n[音频](file://${mp3})`;
      const result = extractOutboundMediaFromAnswer(answer);
      expect(result.filePaths).toEqual([html, mp3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns text-only when no media paths exist', () => {
    const result = extractOutboundMediaFromAnswer('你好，今天天气不错');
    expect(result.filePaths).toEqual([]);
    expect(result.text).toBe('你好，今天天气不错');
  });
});
