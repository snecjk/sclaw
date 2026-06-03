import { describe, expect, it, beforeEach } from "vitest";
import {
  clearSessionRunCache,
  getCachedRunId,
  queuePendingAgentRunEnd,
  queuePendingModelCall,
  queuePendingModelEnded,
  rememberRunId,
  resetRunIdCacheForTest,
  shiftPendingModelCall,
  takePendingAgentRunEnd,
  takePendingModelCalls,
  takePendingModelEnded,
} from "../../sto-plugin/sto-agent-telemetry/run-id-cache";

describe("run-id-cache", () => {
  beforeEach(() => {
    resetRunIdCacheForTest();
  });

  it("remembers and resolves runId by sessionKey", () => {
    rememberRunId("agent:main:web", "run-abc");
    expect(getCachedRunId("agent:main:web")).toBe("run-abc");
  });

  it("queues model calls until runId is known", () => {
    queuePendingModelCall("agent:main:web", {
      sessionId: "sess-1",
      sessionKey: "agent:main:web",
      event: { prompt: "hi" },
      ctx: { sessionId: "sess-1", sessionKey: "agent:main:web" },
    });
    expect(takePendingModelCalls("agent:main:web")).toHaveLength(1);
    expect(takePendingModelCalls("agent:main:web")).toHaveLength(0);
  });

  it("shiftPendingModelCall returns one item at a time", () => {
    queuePendingModelCall("agent:main:web", {
      sessionId: "sess-1",
      sessionKey: "agent:main:web",
      event: { prompt: "first" },
      ctx: { sessionId: "sess-1", sessionKey: "agent:main:web" },
    });
    queuePendingModelCall("agent:main:web", {
      sessionId: "sess-1",
      sessionKey: "agent:main:web",
      event: { prompt: "second" },
      ctx: { sessionId: "sess-1", sessionKey: "agent:main:web" },
    });
    expect(shiftPendingModelCall("agent:main:web")?.event).toEqual({ prompt: "first" });
    expect(shiftPendingModelCall("agent:main:web")?.event).toEqual({ prompt: "second" });
    expect(shiftPendingModelCall("agent:main:web")).toBeUndefined();
  });

  it("queues model ended until runId is known", () => {
    queuePendingModelEnded("agent:main:web", {
      sessionId: "sess-1",
      sessionKey: "agent:main:web",
      event: { durationMs: 1200 },
      ctx: { sessionId: "sess-1", sessionKey: "agent:main:web" },
      durationMs: 1200,
    });
    expect(takePendingModelEnded("agent:main:web")).toHaveLength(1);
    expect(takePendingModelEnded("agent:main:web")).toHaveLength(0);
  });

  it("queues agent_run_end until real runId is known", () => {
    queuePendingAgentRunEnd("agent:main:web", {
      sessionId: "sess-1",
      sessionKey: "agent:main:web",
      event: { success: true },
      ctx: { sessionId: "sess-1", sessionKey: "agent:main:web" },
    });
    expect(takePendingAgentRunEnd("agent:main:web")?.sessionId).toBe("sess-1");
    expect(takePendingAgentRunEnd("agent:main:web")).toBeUndefined();
  });

  it("clears session cache on run end", () => {
    rememberRunId("agent:main:web", "run-abc");
    queuePendingModelCall("agent:main:web", {
      sessionId: "sess-1",
      sessionKey: "agent:main:web",
      event: {},
      ctx: {},
    });
    clearSessionRunCache("agent:main:web");
    expect(getCachedRunId("agent:main:web")).toBeUndefined();
    expect(takePendingModelCalls("agent:main:web")).toHaveLength(0);
    expect(takePendingModelEnded("agent:main:web")).toHaveLength(0);
  });
});
