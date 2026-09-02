import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildViteProxyFromFile,
  ensureDevProxyForAbsoluteUrl,
  proxyKeyFromHostname,
} from '../../resources/app-templates/site-minimal/scripts/dev-proxy.mjs';

describe('dev-proxy helpers', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives stable proxy keys from hostnames', () => {
    expect(proxyKeyFromHostname('baseinfo-chatbotapi-test.sto.cn')).toBe(
      'baseinfo-chatbotapi-test-sto-cn',
    );
  });

  it('registers a new absolute URL and returns relative proxy path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-proxy-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'dev-proxy.v1.json');
    writeFileSync(filePath, `${JSON.stringify({ version: 'v1', proxies: [] }, null, 2)}\n`);

    const first = ensureDevProxyForAbsoluteUrl(
      'https://baseinfo-chatbotapi-test.sto.cn/api/robot/page',
      filePath,
    );
    expect(first.added).toBe(true);
    expect(first.relativeUrl).toBe(
      '/proxy/baseinfo-chatbotapi-test-sto-cn/api/robot/page',
    );
    expect(first.absoluteUrl).toBe(
      'https://baseinfo-chatbotapi-test.sto.cn/api/robot/page',
    );

    const second = ensureDevProxyForAbsoluteUrl(
      'https://baseinfo-chatbotapi-test.sto.cn/api/robot/page?x=1',
      filePath,
    );
    expect(second.added).toBe(false);
    expect(second.relativeUrl).toBe(
      '/proxy/baseinfo-chatbotapi-test-sto-cn/api/robot/page?x=1',
    );

    const saved = JSON.parse(readFileSync(filePath, 'utf8')) as {
      proxies: Array<{ key: string; target: string }>;
    };
    expect(saved.proxies).toHaveLength(1);
    expect(saved.proxies[0]?.target).toBe('https://baseinfo-chatbotapi-test.sto.cn');

    const viteProxy = buildViteProxyFromFile(filePath);
    expect(Object.keys(viteProxy)).toEqual(['/proxy/baseinfo-chatbotapi-test-sto-cn']);
  });
});
