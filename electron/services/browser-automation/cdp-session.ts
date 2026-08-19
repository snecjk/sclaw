import type { WebContents } from 'electron';
import { logger } from '../../utils/logger';

const CDP_VERSION = '1.3';

export class BrowserAutomationCdpSession {
  private attached = false;

  constructor(private readonly webContents: WebContents) {}

  get isDestroyed(): boolean {
    return this.webContents.isDestroyed();
  }

  get rawWebContents(): WebContents {
    return this.webContents;
  }

  async attach(): Promise<void> {
    if (this.isDestroyed) throw new Error('WebContents destroyed');
    if (this.attached) return;
    if (this.webContents.debugger.isAttached()) {
      this.attached = true;
      return;
    }
    await this.webContents.debugger.attach(CDP_VERSION);
    this.attached = true;
  }

  async detach(): Promise<void> {
    if (!this.attached || this.isDestroyed) return;
    if (this.webContents.debugger.isAttached()) {
      try {
        this.webContents.debugger.detach();
      } catch (error) {
        logger.warn('[browser-automation] CDP detach failed:', error);
      }
    }
    this.attached = false;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    await this.attach();
    const result = await this.webContents.debugger.sendCommand(method, params ?? {});
    return result as T;
  }

  async captureScreenshot(): Promise<Buffer> {
    const image = await this.webContents.capturePage();
    return image.toPNG();
  }
}
