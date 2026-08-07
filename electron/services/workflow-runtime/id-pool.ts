type AllocateIds = (count: number) => Promise<number[]>;

const DEFAULT_BATCH_SIZE = 128;
const LOW_WATERMARK = 32;
let provider: AllocateIds | null = null;
let available: number[] = [];
let refill: Promise<void> | null = null;

export function configureWorkflowIdPool(nextProvider: AllocateIds): void {
  provider = nextProvider;
  available = [];
  refill = null;
}

export async function takeWorkflowDatabaseId(): Promise<number> {
  while (available.length === 0) await refillIds();
  const id = available.shift();
  if (!id) throw new Error('global workflow id pool returned no id');
  if (available.length < LOW_WATERMARK) void refillIds();
  return id;
}

async function refillIds(): Promise<void> {
  if (!provider) throw new Error('workflow global id provider is not configured');
  if (!refill) {
    refill = provider(DEFAULT_BATCH_SIZE).then((ids) => {
      if (ids.length !== DEFAULT_BATCH_SIZE) {
        throw new Error(`global workflow id service returned ${ids.length} ids, expected ${DEFAULT_BATCH_SIZE}`);
      }
      const valid = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
      if (valid.length !== ids.length || new Set(valid).size !== valid.length) {
        throw new Error('global workflow id service returned invalid or duplicate ids');
      }
      available.push(...valid);
    }).finally(() => { refill = null; });
  }
  await refill;
}

export function resetWorkflowIdPoolForTest(): void {
  provider = null;
  available = [];
  refill = null;
}
