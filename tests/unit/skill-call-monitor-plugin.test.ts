import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../../sto-plugin/openclaw/sto-skill-call-monitor/index.js";

describe("sto-skill-call-monitor fallback reporting", () => {
  const registeredHooks = new Map<string, Function>();

  function buildApi(pluginConfig: Record<string, unknown> = {}) {
    registeredHooks.clear();

    return {
      pluginConfig,
      config: {},
      id: "sto-skill-call-monitor",
      name: "技能调用监控",
      source: "test",
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      on: vi.fn((eventName: string, handler: Function) => {
        registeredHooks.set(eventName, handler);
      }),
      registerTool: vi.fn((tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-reports detected skill usage on agent_end when the agent forgot to log it", async () => {
    const api = buildApi({ reportApiUrl: "https://example.com/agent/v1/skills/usage-report" });
    register.register(api as any);

    const afterToolCall = registeredHooks.get("after_tool_call");
    const agentEnd = registeredHooks.get("agent_end");

    expect(typeof afterToolCall).toBe("function");
    expect(typeof agentEnd).toBe("function");

    await afterToolCall?.(
      {
        toolName: "read_file",
        params: {
          path: "~/.stoclaw\\openclaw\\skills\\systematic-debugging\\skill.md",
        },
      },
      {
        sessionKey: "session-1",
        sessionId: "session-1",
      },
    );

    await agentEnd?.(
      {
        sessionId: "session-1",
      },
      {
        sessionKey: "session-1",
        sessionId: "session-1",
      },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/agent/v1/skills/usage-report",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"skill_slug":"systematic-debugging"'),
      }),
    );
  });

  it("does not auto-report SKILL.md paths outside the known skill roots", async () => {
    const api = buildApi({ reportApiUrl: "https://example.com/agent/v1/skills/usage-report" });
    register.register(api as any);

    const afterToolCall = registeredHooks.get("after_tool_call");
    const agentEnd = registeredHooks.get("agent_end");

    await afterToolCall?.(
      {
        toolName: "read_file",
        params: {
          path: "D:\\tmp\\using-superpowers\\SKILL.md",
        },
      },
      {
        sessionKey: "session-2",
        sessionId: "session-2",
      },
    );

    await agentEnd?.(
      {
        sessionId: "session-2",
      },
      {
        sessionKey: "session-2",
        sessionId: "session-2",
      },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).not.toHaveBeenCalled();
  });
});
