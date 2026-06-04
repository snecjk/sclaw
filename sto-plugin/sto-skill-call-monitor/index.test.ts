import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import register from "./index.js";

describe("sto-skill-call-monitor plugin", () => {
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
      registerTool: vi.fn((tool: { name: string; description: string; execute: Function }) => {
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

  it("does not register a model-visible logging tool", () => {
    const api = buildApi();
    register.register(api as any);

    expect(api.registerTool).not.toHaveBeenCalled();
  });

  it("sends HTTP POST on agent_end when a whitelisted skill path was detected", async () => {
    const api = buildApi({ reportApiUrl: "https://example.com/agent/v1/skills/usage-report" });
    register.register(api as any);

    const afterToolCall = registeredHooks.get("after_tool_call");
    const agentEnd = registeredHooks.get("agent_end");

    await afterToolCall?.(
      {
        toolName: "read_file",
        params: {
          path: "~/.stoclaw\\openclaw\\skills\\weather\\skill.md",
        },
      },
      {
        sessionKey: "session-post",
        sessionId: "session-post",
      },
    );

    await agentEnd?.(
      {
        sessionId: "session-post",
      },
      {
        sessionKey: "session-post",
        sessionId: "session-post",
      },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/agent/v1/skills/usage-report",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"skill_slug":"weather"'),
      }),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("result=success"),
    );
  });

  it("skips HTTP POST when reportApiUrl is not configured", async () => {
    const api = buildApi();
    register.register(api as any);

    const afterToolCall = registeredHooks.get("after_tool_call");
    const agentEnd = registeredHooks.get("agent_end");

    await afterToolCall?.(
      {
        toolName: "read_file",
        params: {
          path: "~/.stoclaw\\openclaw\\skills\\weather\\SKILL.md",
        },
      },
      {
        sessionKey: "session-no-http",
        sessionId: "session-no-http",
      },
    );

    await agentEnd?.(
      {
        sessionId: "session-no-http",
      },
      {
        sessionKey: "session-no-http",
        sessionId: "session-no-http",
      },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).not.toHaveBeenCalled();
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
          path: "~/.stoclaw\\openclaw\\skills\\systematic-debugging\\SKILL.md",
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

  it("does not auto-report non-whitelisted SKILL.md paths", async () => {
    const api = buildApi({ reportApiUrl: "https://example.com/agent/v1/skills/usage-report" });
    register.register(api as any);

    const afterToolCall = registeredHooks.get("after_tool_call");
    const agentEnd = registeredHooks.get("agent_end");

    await afterToolCall?.(
      {
        toolName: "read_file",
        params: {
          path: "D:\\tmp\\docs\\using-superpowers\\SKILL.md",
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
