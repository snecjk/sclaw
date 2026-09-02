import { describe, expect, it } from 'vitest';
import {
  isDevServerRepairWorthyLine,
  isLocalViteModuleUrl,
  isSclawPreviewNetworkViteNoise,
  isViteHmrLogLine,
} from '../../shared/app-dev-preview-noise';

describe('isLocalViteModuleUrl', () => {
  it('matches guest Vite HMR / source module URLs', () => {
    expect(isLocalViteModuleUrl('http://127.0.0.1:5173/src/App.tsx')).toBe(true);
    expect(isLocalViteModuleUrl('http://localhost:5173/@vite/client')).toBe(true);
    expect(isLocalViteModuleUrl('/src/pages/List.tsx?t=1')).toBe(true);
    expect(isLocalViteModuleUrl('http://127.0.0.1:5173/node_modules/.vite/deps/react.js')).toBe(true);
  });

  it('keeps real app and company APIs actionable', () => {
    expect(isLocalViteModuleUrl('http://127.0.0.1:5173/proxy/baseinfo/api/robot/page')).toBe(false);
    expect(isLocalViteModuleUrl('https://baseinfo-chatbotapi-test.sto.cn/api/robot/page')).toBe(false);
  });
});

describe('isSclawPreviewNetworkViteNoise', () => {
  it('parses the guest network hook payload', () => {
    expect(
      isSclawPreviewNetworkViteNoise(
        '[sclaw-preview-network] {"method":"GET","url":"http://127.0.0.1:5173/src/App.tsx","ok":false,"status":404}',
      ),
    ).toBe(true);
    expect(
      isSclawPreviewNetworkViteNoise(
        '[sclaw-preview-network] {"method":"POST","url":"https://x.sto.cn/api","ok":false,"error":"Failed to fetch"}',
      ),
    ).toBe(false);
  });
});

describe('isViteHmrLogLine / isDevServerRepairWorthyLine', () => {
  it('drops HMR chatter even when the line mentions error', () => {
    expect(isViteHmrLogLine('[vite] hmr update /src/App.tsx')).toBe(true);
    expect(isViteHmrLogLine('[vite] page reload /src/main.tsx')).toBe(true);
    expect(isDevServerRepairWorthyLine('[vite] hmr update /src/App.tsx')).toBe(false);
    expect(isDevServerRepairWorthyLine('12:00:00 [vite] hmr update /src/App.tsx (error overlay)')).toBe(false);
  });

  it('keeps real compile failures', () => {
    expect(isDevServerRepairWorthyLine('[vite] Internal server error: Failed to resolve import')).toBe(true);
    expect(isDevServerRepairWorthyLine('Failed to compile.')).toBe(true);
  });
});
