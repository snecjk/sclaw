import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiPromptAttachment, PiSessionConfig } from '../../shared/pi-runtime-protocol';
import {
  buildPiMixedPrompt,
  escapePiFileAttribute,
  preparePiPromptAttachments,
  type PiImageProcessingApi,
} from '../../electron/pi-runtime/prompt-attachments';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(files: Record<string, string | Uint8Array>): Promise<{
  root: string;
  attachment(name: string, mimeType?: string): PiPromptAttachment;
}> {
  const root = await mkdtemp(join(tmpdir(), 'sclaw-pi-attachments-'));
  temporaryRoots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content);
  }
  return {
    root,
    attachment: (name, mimeType = 'application/octet-stream') => ({
      filePath: join(root, name),
      fileName: name,
      mimeType,
    }),
  };
}

function imageApi(detectedByName: Record<string, string | null> = {}): PiImageProcessingApi {
  return {
    detectSupportedImageMimeTypeFromFile: vi.fn(async (filePath) => detectedByName[filePath.split(/[\\/]/).at(-1)!] ?? null),
    convertToPng: vi.fn(async () => ({ data: Buffer.from('png').toString('base64'), mimeType: 'image/png' })),
    resizeImage: vi.fn(async (data, mimeType) => ({
      data: Buffer.from(data).toString('base64'),
      mimeType,
      originalWidth: 2000,
      originalHeight: 1200,
      width: 1600,
      height: 960,
      wasResized: true,
    })),
    formatDimensionNote: vi.fn(() => '[Image dimensions: 1600x960.]'),
  };
}

describe('Pi prompt attachments', () => {
  it('keeps mixed file anchors in placeholder order and sends only real images', async () => {
    const fixture = await createFixture({
      '数据 表.xlsx': 'sheet',
      '截图.png': 'png-bytes',
      '说明.pdf': 'pdf',
    });
    const api = imageApi({ '截图.png': 'image/png' });
    const prepared = await preparePiPromptAttachments({
      message: '第一段 [文件: 数据 表.xlsx] 第二段 [文件: 截图.png] 第三段 [文件: 说明.pdf] 结束',
      media: [
        fixture.attachment('数据 表.xlsx', 'application/vnd.ms-excel'),
        fixture.attachment('截图.png', 'application/pdf'),
        fixture.attachment('说明.pdf', 'application/pdf'),
      ],
      modelSupportsImages: true,
      imageApi: api,
    });

    const excelPath = resolve(fixture.root, '数据 表.xlsx');
    const imagePath = resolve(fixture.root, '截图.png');
    const pdfPath = resolve(fixture.root, '说明.pdf');
    expect(prepared.message).toBe(
      `第一段 <file name="${excelPath}" display_name="数据 表.xlsx"></file> 第二段 <file name="${imagePath}" display_name="截图.png">[Image dimensions: 1600x960.]</file> 第三段 <file name="${pdfPath}" display_name="说明.pdf"></file> 结束`,
    );
    expect(prepared.images).toEqual([{
      type: 'image',
      data: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
    }]);
    expect(prepared.imageCount).toBe(1);
    expect(prepared.fileReferenceCount).toBe(3);
  });

  it('uses content detection instead of the frontend MIME type', async () => {
    const fixture = await createFixture({ 'photo.bin': 'real-image', 'fake.png': 'plain-file' });
    const prepared = await preparePiPromptAttachments({
      message: '[文件: photo.bin]\n[文件: fake.png]',
      media: [
        fixture.attachment('photo.bin', 'text/plain'),
        fixture.attachment('fake.png', 'image/png'),
      ],
      modelSupportsImages: true,
      imageApi: imageApi({ 'photo.bin': 'image/jpeg', 'fake.png': null }),
    });

    expect(prepared.images).toHaveLength(1);
    expect(prepared.images[0].mimeType).toBe('image/jpeg');
    expect(prepared.attachments.map((item) => item.kind)).toEqual(['image', 'file']);
  });

  it('converts BMP through Pi before resizing', async () => {
    const fixture = await createFixture({ 'legacy.bmp': 'bmp-bytes' });
    const api = imageApi({ 'legacy.bmp': 'image/bmp' });
    const prepared = await preparePiPromptAttachments({
      message: '[文件: legacy.bmp]',
      media: [fixture.attachment('legacy.bmp', 'image/bmp')],
      modelSupportsImages: true,
      imageApi: api,
    });

    expect(api.convertToPng).toHaveBeenCalledWith(Buffer.from('bmp-bytes').toString('base64'), 'image/bmp');
    expect(vi.mocked(api.resizeImage).mock.calls[0][1]).toBe('image/png');
    expect(Buffer.from(vi.mocked(api.resizeImage).mock.calls[0][0])).toEqual(Buffer.from('png'));
    expect(prepared.images[0].mimeType).toBe('image/png');
  });

  it('appends attachments without placeholders and preserves extra placeholders', () => {
    expect(buildPiMixedPrompt('正文 [文件: same] [文件: same] [文件: extra]', [
      '<file name="A"></file>',
      '<file name="B"></file>',
    ])).toBe(
      '正文 <file name="A"></file> <file name="B"></file> [文件: extra]',
    );
    expect(buildPiMixedPrompt('正文', ['<file name="A"></file>', '<file name="B"></file>'])).toBe(
      '正文\n<file name="A"></file>\n<file name="B"></file>',
    );
  });

  it('escapes XML characters without using display names for path identity', () => {
    expect(escapePiFileAttribute('C:\\中文 路径\\same "name" & <draft>.xlsx')).toBe(
      'C:\\中文 路径\\same &quot;name&quot; &amp; &lt;draft&gt;.xlsx',
    );
  });

  it('keeps the original display name separately from the staged path and escapes it', async () => {
    const fixture = await createFixture({ 'staged-uuid.xlsx': 'sheet' });
    const prepared = await preparePiPromptAttachments({
      message: '[文件: 执行结果&"3.xlsx]',
      media: [{
        ...fixture.attachment('staged-uuid.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        fileName: '执行结果&"3.xlsx',
      }],
      modelSupportsImages: false,
      imageApi: imageApi(),
    });

    expect(prepared.message).toBe(
      `<file name="${resolve(fixture.root, 'staged-uuid.xlsx')}" display_name="执行结果&amp;&quot;3.xlsx"></file>`,
    );
  });

  it('rejects image input before processing when the model lacks vision support', async () => {
    const fixture = await createFixture({ 'photo.png': 'image' });
    const api = imageApi({ 'photo.png': 'image/png' });
    await expect(preparePiPromptAttachments({
      message: '[文件: photo.png]',
      media: [fixture.attachment('photo.png', 'image/png')],
      modelSupportsImages: false,
      imageApi: api,
    })).rejects.toMatchObject({ code: 'PI_IMAGE_INPUT_UNSUPPORTED' });
    expect(api.resizeImage).not.toHaveBeenCalled();
  });

  it.each([
    ['missing file', 'missing.txt'],
    ['empty file', 'empty.txt'],
  ])('returns PI_ATTACHMENT_UNAVAILABLE for a %s', async (_caseName, name) => {
    const fixture = await createFixture(name === 'empty.txt' ? { [name]: '' } : { 'other.txt': 'x' });
    await expect(preparePiPromptAttachments({
      message: 'read it',
      media: [fixture.attachment(name)],
      modelSupportsImages: true,
      imageApi: imageApi(),
    })).rejects.toMatchObject({ code: 'PI_ATTACHMENT_UNAVAILABLE' });
  });

  it('rejects directories and image processing failures with stable codes', async () => {
    const fixture = await createFixture({ 'bad.png': 'bad-image' });
    const folder = join(fixture.root, 'folder');
    await mkdir(folder);
    await expect(preparePiPromptAttachments({
      message: 'folder',
      media: [{ filePath: folder, fileName: 'folder', mimeType: 'application/octet-stream' }],
      modelSupportsImages: true,
      imageApi: imageApi(),
    })).rejects.toMatchObject({ code: 'PI_ATTACHMENT_UNAVAILABLE' });

    const api = imageApi({ 'bad.png': 'image/png' });
    vi.mocked(api.resizeImage).mockResolvedValueOnce(null);
    await expect(preparePiPromptAttachments({
      message: '[文件: bad.png]',
      media: [fixture.attachment('bad.png', 'image/png')],
      modelSupportsImages: true,
      imageApi: api,
    })).rejects.toMatchObject({ code: 'PI_IMAGE_PROCESSING_FAILED' });
  });

  it('keeps pure text prompts unchanged and reports unreadable inspection', async () => {
    const pureText = await preparePiPromptAttachments({
      message: 'plain prompt',
      media: [],
      modelSupportsImages: false,
      imageApi: imageApi(),
    });
    expect(pureText).toMatchObject({ message: 'plain prompt', images: [], imageCount: 0, fileReferenceCount: 0 });

    const fixture = await createFixture({ 'locked.dat': 'data' });
    const api = imageApi();
    vi.mocked(api.detectSupportedImageMimeTypeFromFile).mockRejectedValueOnce(new Error('EACCES'));
    await expect(preparePiPromptAttachments({
      message: 'read it',
      media: [fixture.attachment('locked.dat')],
      modelSupportsImages: true,
      imageApi: api,
    })).rejects.toMatchObject({ code: 'PI_ATTACHMENT_UNAVAILABLE' });
  });

  it('keeps per-turn media in the prompt payload rather than session configuration', () => {
    const config: PiSessionConfig = {
      sessionKey: 'pi:main:test',
      cwd: 'D:/workspace',
      agentDir: 'D:/pi',
      sessionDir: 'D:/pi/sessions',
      model: { provider: 'sto', model: 'vision' },
    };
    const media = [{ filePath: 'D:/files/a.png', fileName: 'a.png', mimeType: 'image/png' }];
    expect({ config, message: 'hello', runId: 'run-1', media }).toMatchObject({ media });
    expect(config).not.toHaveProperty('media');
  });
});
