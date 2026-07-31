// @vitest-environment jsdom
/**
 * AppShell scroll-ownership smoke — real Chromium layout engine via headless --dump-dom.
 *
 * Fixture mirrors Stage 1 provincial Grid contract with long Sidebar + Chat content.
 * Skips when Chrome/Chromium is unavailable (no new package deps).
 */
import { execFile } from 'node:child_process';
import { accessSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  stoAppShellGridProvincialClass,
  stoAppShellSidebarGapClass,
  stoWorkspaceWrapClass,
  sidebarScrollContainerClass,
} from '@/lib/surfaces';

const execFileAsync = promisify(execFile);

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

interface SmokeMetrics {
  gridClientHeight: number;
  gridScrollHeight: number;
  gridScrollTop: number;
  sidebarTop: number;
  headerTop: number;
  sidebarViewportClientHeight: number;
  sidebarViewportScrollHeight: number;
  sidebarViewportScrollTop: number;
  chatViewportClientHeight: number;
  chatViewportScrollHeight: number;
  chatViewportScrollTop: number;
  gridScrollTopAfterSidebarScroll: number;
  sidebarViewportScrollTopAfterSidebarScroll: number;
  chatViewportScrollTopAfterSidebarScroll: number;
  gridScrollTopAfterChatScroll: number;
  sidebarViewportScrollTopAfterChatScroll: number;
  chatViewportScrollTopAfterChatScroll: number;
}

function resolveChromePath(): string | null {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function buildFixtureHtml(): string {
  const gridClass = stoAppShellGridProvincialClass;
  const gapClass = stoAppShellSidebarGapClass;
  const wrapClass = stoWorkspaceWrapClass;
  const sidebarViewportClass = sidebarScrollContainerClass;

  const longSidebarItems = Array.from({ length: 80 }, (_, i) => {
    return `<div class="row">Session history item ${i + 1} — ${'x'.repeat(24)}</div>`;
  }).join('\n');

  const longChatMessages = Array.from({ length: 60 }, (_, i) => {
    return `<div class="msg">Chat message ${i + 1}: ${'m'.repeat(120)}</div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>app-shell-scroll-ownership</title>
  <style>
    :root {
      --sto-sidebar-effective-w: 260px;
      --sto-shell-card-gap: 8px;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      height: 640px;
      width: 1280px;
      overflow: hidden;
      font: 13px/1.4 system-ui, sans-serif;
      background: #e8e8e8;
    }
    #shell {
      display: flex;
      flex-direction: column;
      height: 640px;
      width: 1280px;
      overflow: hidden;
      background: #f1f1f3;
    }
    #grid {
      display: grid;
      min-height: 0;
      min-width: 0;
      flex: 1 1 0%;
      overflow-x: hidden;
      overflow-y: hidden;
      grid-template-columns: var(--sto-sidebar-effective-w) var(--sto-shell-card-gap) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
    #sidebar {
      display: flex;
      height: 100%;
      min-height: 0;
      min-width: 0;
      width: 100%;
      flex-shrink: 0;
      flex-direction: column;
      overflow: hidden;
      background: #f3f4f6;
    }
    #workspace {
      display: flex;
      min-height: 0;
      min-width: 0;
      flex-direction: column;
      overflow: hidden;
      padding-top: var(--sto-shell-card-gap);
      padding-right: var(--sto-shell-card-gap);
      padding-bottom: var(--sto-shell-card-gap);
    }
    #sidebar-viewport,
    #chat-viewport {
      min-height: 0;
      flex: 1 1 0%;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior-y: contain;
    }
    #brand, #content-header {
      flex-shrink: 0;
      height: 52px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      background: #fff;
      border-bottom: 1px solid #e5e6eb;
    }
    #main-card {
      display: flex;
      min-height: 0;
      min-width: 0;
      flex: 1 1 0%;
      flex-direction: column;
      overflow: hidden;
      background: #fff;
      border-radius: 18px;
    }
    .row, .msg {
      padding: 8px 10px;
      border-bottom: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div id="shell">
    <div id="grid" class="${gridClass}" data-testid="app-shell-grid">
      <aside id="sidebar" class="flex h-full min-h-0 shrink-0 flex-col overflow-hidden w-full min-w-0">
        <div id="brand">Logo / Primary nav</div>
        <div id="sidebar-viewport" class="${sidebarViewportClass}" data-testid="sidebar-viewport">
          ${longSidebarItems}
        </div>
      </aside>
      <div class="${gapClass}" aria-hidden="true"></div>
      <div id="workspace" class="${wrapClass}" data-testid="workspace-wrap">
        <main id="main-card">
          <header id="content-header" data-testid="content-header">ContentHeader</header>
          <div id="chat-viewport" data-testid="chat-viewport">
            ${longChatMessages}
          </div>
        </main>
      </div>
    </div>
  </div>
  <script>
    function rectTop(el) {
      return el.getBoundingClientRect().top;
    }
    function metrics() {
      const grid = document.getElementById('grid');
      const sidebar = document.getElementById('sidebar');
      const header = document.getElementById('content-header');
      const sidebarViewport = document.getElementById('sidebar-viewport');
      const chatViewport = document.getElementById('chat-viewport');
      return {
        gridClientHeight: grid.clientHeight,
        gridScrollHeight: grid.scrollHeight,
        gridScrollTop: grid.scrollTop,
        sidebarTop: rectTop(sidebar),
        headerTop: rectTop(header),
        sidebarViewportClientHeight: sidebarViewport.clientHeight,
        sidebarViewportScrollHeight: sidebarViewport.scrollHeight,
        sidebarViewportScrollTop: sidebarViewport.scrollTop,
        chatViewportClientHeight: chatViewport.clientHeight,
        chatViewportScrollHeight: chatViewport.scrollHeight,
        chatViewportScrollTop: chatViewport.scrollTop,
      };
    }

    const sidebarViewport = document.getElementById('sidebar-viewport');
    const chatViewport = document.getElementById('chat-viewport');
    const base = metrics();

    sidebarViewport.scrollTop = 400;
    const afterSidebar = metrics();

    sidebarViewport.scrollTop = 0;
    chatViewport.scrollTop = 500;
    const afterChat = metrics();

    const smoke = Object.assign({}, base, {
      gridScrollTopAfterSidebarScroll: afterSidebar.gridScrollTop,
      sidebarViewportScrollTopAfterSidebarScroll: afterSidebar.sidebarViewportScrollTop,
      chatViewportScrollTopAfterSidebarScroll: afterSidebar.chatViewportScrollTop,
      gridScrollTopAfterChatScroll: afterChat.gridScrollTop,
      sidebarViewportScrollTopAfterChatScroll: afterChat.sidebarViewportScrollTop,
      chatViewportScrollTopAfterChatScroll: afterChat.chatViewportScrollTop,
    });
    document.documentElement.setAttribute('data-smoke', JSON.stringify(smoke));
    document.documentElement.setAttribute('data-smoke-ready', '1');
  </script>
</body>
</html>`;
}

async function runChromeSmoke(html: string): Promise<SmokeMetrics> {
  const chromePath = resolveChromePath();
  if (!chromePath) {
    throw new Error('SKIP_NO_CHROME');
  }

  const dir = await mkdtemp(join(tmpdir(), 'app-shell-smoke-'));
  const htmlPath = join(dir, 'index.html');
  await writeFile(htmlPath, html, 'utf8');

  try {
    const { stdout } = await execFileAsync(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-file-access-from-files',
        '--virtual-time-budget=5000',
        '--dump-dom',
        `file://${htmlPath}`,
      ],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      },
    );

    const match = stdout.match(/data-smoke="([^"]+)"/);
    if (!match) {
      throw new Error('Smoke metrics attribute missing from dump-dom output');
    }
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return JSON.parse(decoded) as SmokeMetrics;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const chromePath = resolveChromePath();

describe.skipIf(!chromePath)('app shell scroll ownership (chromium smoke)', () => {
  let metrics: SmokeMetrics;

  beforeAll(async () => {
    expect(stoAppShellGridProvincialClass).toContain('grid-rows-[minmax(0,1fr)]');
    expect(stoWorkspaceWrapClass).toContain('overflow-hidden');
    expect(stoWorkspaceWrapClass).toContain('min-h-0');
    metrics = await runChromeSmoke(buildFixtureHtml());
  }, 60_000);

  it('keeps Grid scrollHeight equal to clientHeight (no implicit auto-row growth)', () => {
    expect(metrics.gridScrollHeight).toBe(metrics.gridClientHeight);
    expect(metrics.gridClientHeight).toBe(640);
    expect(metrics.gridScrollTop).toBe(0);
  });

  it('keeps Sidebar and ContentHeader in the viewport', () => {
    expect(metrics.sidebarTop).toBe(0);
    expect(metrics.headerTop).toBeGreaterThanOrEqual(0);
  });

  it('gives Sidebar viewport independent overflow', () => {
    expect(metrics.sidebarViewportScrollHeight).toBeGreaterThan(metrics.sidebarViewportClientHeight);
    expect(metrics.chatViewportScrollHeight).toBeGreaterThan(metrics.chatViewportClientHeight);
  });

  it('scrolling Sidebar only changes Sidebar viewport scrollTop', () => {
    expect(metrics.sidebarViewportScrollTopAfterSidebarScroll).toBeGreaterThan(0);
    expect(metrics.gridScrollTopAfterSidebarScroll).toBe(0);
    expect(metrics.chatViewportScrollTopAfterSidebarScroll).toBe(0);
  });

  it('scrolling Chat only changes Chat viewport scrollTop', () => {
    expect(metrics.chatViewportScrollTopAfterChatScroll).toBeGreaterThan(0);
    expect(metrics.gridScrollTopAfterChatScroll).toBe(0);
    expect(metrics.sidebarViewportScrollTopAfterChatScroll).toBe(0);
  });
});
