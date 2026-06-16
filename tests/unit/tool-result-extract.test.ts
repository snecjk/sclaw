import { describe, expect, it } from "vitest";
import { pickToolResult } from "../../sto-plugin/openclaw/sto-agent-telemetry/tool-result-extract.js";

describe("pickToolResult", () => {
  it("prefers result field", () => {
    expect(pickToolResult({ result: { code: 0 } })).toEqual({ code: 0 });
  });

  it("extracts stdout text", () => {
    expect(pickToolResult({ stdout: '{"code":0}' })).toBe('{"code":0}');
  });

  it("extracts aggregated from details", () => {
    expect(
      pickToolResult({
        details: { aggregated: "site list response" },
      }),
    ).toBe("site list response");
  });

  it("extracts text blocks from content array", () => {
    expect(
      pickToolResult({
        content: [{ type: "text", text: "hello" }, { text: "world" }],
      }),
    ).toBe("hello\nworld");
  });
});
