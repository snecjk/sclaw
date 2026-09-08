import type {
  SclawCapabilityResolver,
  SclawCapabilityToken,
} from './types';

export function createSclawCapabilityToken<T>(id: string): SclawCapabilityToken<T> {
  const normalized = id.trim();
  if (!normalized) throw new Error('Capability id is required');
  return Object.freeze({ id: normalized });
}

export class SclawCapabilityRegistry implements SclawCapabilityResolver {
  private readonly values = new Map<string, unknown>();

  constructor(entries: ReadonlyArray<readonly [SclawCapabilityToken<unknown>, unknown]> = []) {
    for (const [token, value] of entries) this.values.set(token.id, value);
  }

  provide<T>(token: SclawCapabilityToken<T>, value: T): this {
    this.values.set(token.id, value);
    return this;
  }

  has<T>(token: SclawCapabilityToken<T>): boolean {
    return this.values.has(token.id);
  }

  get<T>(token: SclawCapabilityToken<T>): T | undefined {
    return this.values.get(token.id) as T | undefined;
  }

  require<T>(token: SclawCapabilityToken<T>): T {
    if (!this.values.has(token.id)) {
      throw new Error(`Required extension capability is unavailable: ${token.id}`);
    }
    return this.values.get(token.id) as T;
  }
}
