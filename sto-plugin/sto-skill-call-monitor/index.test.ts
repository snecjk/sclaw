import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import register from "./index.js";

describe("sto-skill-call-monitor plugin", () => {
  const registeredTools: Array<{ name: string; description: string; execute: Function }> = [];

  function buildApi(pluginConfig: Record<string, unknown> = {}) {
    registeredTools.length = 0;

    return {
      pluginConfig,
      config: {},
      id: "sto-skill-call-monitor",
      name: "技能调用监控",
      source: "test",
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      on: vi.fn(),
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

  it("registers the log_skill_usage tool", () => {
    const api = buildApi();
    register.register(api as any);

    expect(api.registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTools[0]?.name).toBe("log_skill_usage");
  });

  it("logs skill usage and returns confirmation", async () => {
    const api = buildApi();
    register.register(api as any);

    const tool = registeredTools[0];
    const result = await tool.execute("call-1", {
      skill_slug: "weather",
      skill_name: "天气查询",
      result: "success",
      notes: "查询了北京天气",
    });

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("skill_usage: slug=weather"),
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("result=success"),
    );
    expect(result.content[0].text).toContain("天气查询");
    expect(result.content[0].text).toContain("success");
  });

  it("handles missing notes gracefully", async () => {
    const api = buildApi();
    register.register(api as any);

    const tool = registeredTools[0];
    const result = await tool.execute("call-2", {
      skill_slug: "image-lab",
      skill_name: "图片生成",
      result: "failed",
    });

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("notes=-"),
    );
    expect(result.content[0].text).toContain("图片生成");
    expect(result.content[0].text).toContain("failed");
  });

  it("sends HTTP POST when reportApiUrl is configured", async () => {
    const api = buildApi({ reportApiUrl: "https://example.com/agent/v1/skills/usage-report" });
    register.register(api as any);

    const tool = registeredTools[0];
    await tool.execute("call-3", {
      skill_slug: "weather",
      skill_name: "天气查询",
      result: "success",
      notes: "测试上报",
    });

    // Give the fire-and-forget async IIFE a tick to run
    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/agent/v1/skills/usage-report",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"skill_slug":"weather"'),
      }),
    );
  });

  it("skips HTTP POST when reportApiUrl is not configured", async () => {
    const api = buildApi(); // no reportApiUrl
    register.register(api as any);

    const tool = registeredTools[0];
    await tool.execute("call-4", {
      skill_slug: "weather",
      skill_name: "天气查询",
      result: "success",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).not.toHaveBeenCalled();
  });
});
