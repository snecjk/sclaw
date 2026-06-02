import { describe, expect, it } from "vitest";
import {
  countCompleteConversationTurns,
  countConversationTurns,
  extractAllTurnsFromJsonl,
  extractSyncableTurnsFromJsonl,
  hasPendingUserTurn,
  getLastAssistantStopReason,
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
    expect(isTranscriptReadyForSync(jsonl)).toBe(true);

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

  it("is not ready while last assistant is still in toolUse", () => {
    const jsonl = [
      '{"type":"message","timestamp":"2026-06-01T00:51:19.349Z","message":{"role":"user","content":"问"}}',
      '{"type":"message","timestamp":"2026-06-01T00:51:22.161Z","message":{"role":"assistant","usage":{"input":10,"output":1,"total":11},"content":[{"type":"thinking","thinking":"调用工具中"},{"type":"toolCall","name":"session_status"}],"stopReason":"toolUse"}}',
    ].join("\n");
    expect(getLastAssistantStopReason(jsonl)).toBe("toolUse");
    expect(countCompleteConversationTurns(jsonl)).toBe(1);
    expect(isTranscriptReadyForSync(jsonl)).toBe(false);
  });

  it("is ready when last assistant finishes with stop", () => {
    const jsonl = [
      '{"type":"message","timestamp":"2026-06-01T00:51:19.349Z","message":{"role":"user","content":"问"}}',
      '{"type":"message","timestamp":"2026-06-01T00:51:22.161Z","message":{"role":"assistant","usage":{"input":10,"output":1,"total":11},"content":[{"type":"toolCall","name":"session_status"}],"stopReason":"toolUse"}}',
      '{"type":"message","timestamp":"2026-06-01T00:51:24.667Z","message":{"role":"assistant","model":"qwen3.5-plus","usage":{"input":100,"output":50,"total":150},"content":[{"type":"text","text":"答"}],"stopReason":"stop"}}',
    ].join("\n");
    expect(isTranscriptReadyForSync(jsonl)).toBe(true);
  });

  it("merges consecutive assistant lines and uses last usage for tokens", () => {
    const jsonl = [
      '{"type":"message","timestamp":"2026-05-29T08:00:00.000Z","message":{"role":"user","content":"你好"}}',
      '{"type":"message","timestamp":"2026-05-29T08:00:01.000Z","message":{"role":"assistant","model":"qwen3.5-plus","usage":{"input":10,"output":5,"total":15},"content":[{"type":"thinking","thinking":"思考中"},{"type":"text","text":"第一段"}]}}',
      '{"type":"message","timestamp":"2026-05-29T08:00:02.000Z","message":{"role":"assistant","model":"qwen3.5-plus","usage":{"input":100,"output":50,"total":150},"content":[{"type":"text","text":"最终回答"}]}}',
    ].join("\n");

    const messages = extractSyncableTurnsFromJsonl(jsonl, {
      sessionId: "sess-merge",
      runId: "sess-merge:turn:1",
    });

    expect(messages).toHaveLength(2);
    expect(messages[1].prompt_tokens).toBe(100);
    expect(messages[1].completion_tokens).toBe(50);
    expect(messages[1].content).toContain("第一段");
    expect(messages[1].content).toContain("最终回答");
    expect(messages[1].content).toContain("思考中");
  });
});
