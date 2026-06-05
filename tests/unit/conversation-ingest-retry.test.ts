import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_SYNC_RETRY_SCHEDULE_MS,
  postConversationBatchWithRetries,
} from "../../sto-plugin/sto-agent-telemetry/conversation-ingest";

vi.mock("../../sto-plugin/sto-agent-telemetry/transcript-sync.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../sto-plugin/sto-agent-telemetry/transcript-sync.js")
  >();
  return {
    ...actual,
    readTranscriptContent: vi.fn(),
  };
});

vi.mock("../../sto-plugin/sto-agent-telemetry/transcript-parse.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../sto-plugin/sto-agent-telemetry/transcript-parse.js")
  >();
  return {
    ...actual,
    isTranscriptReadyForSync: vi.fn(),
    extractSyncableTurnsFromJsonl: vi.fn(),
  };
});

import { readTranscriptContent } from "../../sto-plugin/sto-agent-telemetry/transcript-sync.js";
import {
  extractSyncableTurnsFromJsonl,
  isTranscriptReadyForSync,
} from "../../sto-plugin/sto-agent-telemetry/transcript-parse.js";

const readTranscriptContentMock = vi.mocked(readTranscriptContent);
const isReadyMock = vi.mocked(isTranscriptReadyForSync);
const extractSyncableMock = vi.mocked(extractSyncableTurnsFromJsonl);

describe("postConversationBatchWithRetries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch;
    readTranscriptContentMock.mockResolvedValue("{}");
    isReadyMock.mockReturnValue(false);
    extractSyncableMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts once only after transcript becomes ready", async () => {
    const schedule = [100, 200, 300] as const;
    isReadyMock.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);
    extractSyncableMock.mockReturnValue([
      {
        message_id: "sess-1:turn:1:user",
        session_id: "sess-1",
        run_id: "run-1",
        sequence: 1,
        role: "user",
        content: "hi",
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        emitted_at: "2026-05-29T08:00:00.000Z",
        source_platform: "openclaw",
      },
    ]);

    const promise = postConversationBatchWithRetries({
      batchUrl: "http://127.0.0.1:8000/api/v1/agent-conversation/messages/batch",
      timeoutMs: 5000,
      ssoAuthPath: "/nonexistent/sso.json",
      sessionId: "sess-1",
      scheduleMs: schedule,
      resolveRunId: async () => "run-1",
      warn: vi.fn(),
      info: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(readTranscriptContentMock).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("exports default retry schedule 3s/10s/30s/60s", () => {
    expect(CONVERSATION_SYNC_RETRY_SCHEDULE_MS).toEqual([3000, 10000, 30000, 60000]);
  });
});
