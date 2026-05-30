import { describe, expect, it } from "vitest";
import {
  countCompleteConversationTurns,
  countConversationTurns,
  extractAllTurnsFromJsonl,
  extractSyncableTurnsFromJsonl,
  hasPendingUserTurn,
  isTranscriptReadyForSync,
} from "../../sto-plugin/sto-agent-telemetry/transcript-parse";

describe("extractAllTurnsFromJsonl", () => {
  const sampleJsonl = [
    '{"type":"message","timestamp":"2026-05-29T08:00:00.000Z","message":{"role":"user","content":"第一轮问题"}}',
    '{"type":"message","timestamp":"2026-05-29T08:00:05.000Z","message":{"role":"assistant","model":"qwen3.7-max","usage":{"input":10,"output":20,"total":30},"content":"第一轮回答"}}',
    '{"type":"message","timestamp":"2026-05-29T08:01:00.000Z","message":{"role":"user","content":"第二轮问题"}}',
    '{"type":"message","timestamp":"2026-05-29T08:01:10.000Z","message":{"role":"assistant","usage":{"input":5,"output":8,"total":13},"content":"第二轮回答"}}',
  ].join("\n");

  it("extracts all user/assistant turns in session", () => {
    const messages = extractAllTurnsFromJsonl(sampleJsonl, {
      sessionId: "sess-1",
      runId: "run-final",
      agentId: "main",
    });

    expect(messages).toHaveLength(4);
    expect(messages[0].run_id).toBe("sess-1:turn:1");
    expect(messages[1].run_id).toBe("sess-1:turn:1");
    expect(messages[2].run_id).toBe("run-final");
    expect(messages[3].run_id).toBe("run-final");
    expect(messages[3].prompt_tokens).toBe(5);
    expect(messages[2].content).toBe("第二轮问题");
  });

  it("counts conversation turns for agent_end runId fallback", () => {
    expect(countConversationTurns(sampleJsonl)).toBe(2);
  });

  it("skips user-only tail when extracting syncable turns", () => {
    const jsonl = [
      '{"type":"message","timestamp":"2026-05-29T08:00:00.000Z","message":{"role":"user","content":"问题"}}',
      '{"type":"message","timestamp":"2026-05-29T08:00:05.000Z","message":{"role":"assistant","usage":{"input":1,"output":2,"total":3},"content":"回答"}}',
      '{"type":"message","timestamp":"2026-05-29T08:02:00.000Z","message":{"role":"user","content":"未完成提问"}}',
    ].join("\n");

    expect(countCompleteConversationTurns(jsonl)).toBe(1);
    expect(hasPendingUserTurn(jsonl)).toBe(true);
    expect(isTranscriptReadyForSync(jsonl)).toBe(false);

    const messages = extractSyncableTurnsFromJsonl(jsonl, {
      sessionId: "sess-1",
      runId: "run-final",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("问题");
    expect(messages[1].content).toBe("回答");
  });

  it("returns no syncable messages when only user exists", () => {
    const jsonl =
      '{"type":"message","timestamp":"2026-05-29T08:00:00.000Z","message":{"role":"user","content":"仅提问"}}';
    expect(countCompleteConversationTurns(jsonl)).toBe(0);
    expect(
      extractSyncableTurnsFromJsonl(jsonl, { sessionId: "sess-1", runId: "run-1" }),
    ).toHaveLength(0);
    expect(isTranscriptReadyForSync(jsonl)).toBe(false);
  });

  it("is ready when last turn is complete Q&A", () => {
    expect(isTranscriptReadyForSync(sampleJsonl)).toBe(true);
  });
});
