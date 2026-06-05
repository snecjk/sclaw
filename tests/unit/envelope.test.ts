import { describe, expect, it } from "vitest";
import { toCanonicalHook } from "../../sto-plugin/sto-agent-telemetry/envelope.js";

describe("toCanonicalHook", () => {
  it("maps 0322 llm_output to model_call_ended", () => {
    expect(toCanonicalHook("llm_output", false)).toBe("model_call_ended");
  });

  it("maps before_prompt_build to model_call_started", () => {
    expect(toCanonicalHook("before_prompt_build", false)).toBe("model_call_started");
  });

  it("maps agent_end to agent_run_end", () => {
    expect(toCanonicalHook("agent_end", false)).toBe("agent_run_end");
  });
});
