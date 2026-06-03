import { describe, expect, it } from "vitest";
import {
  buildToolCommandPayload,
  extractCommandText,
  fromCommandPath,
} from "../../sto-plugin/sto-agent-telemetry/command-extract";

describe("fromCommandPath", () => {
  it("maps sai-cli commandPath to product module action", () => {
    expect(fromCommandPath("finance/bill/query")).toBe("finance bill query");
  });
});

describe("extractCommandText", () => {
  it("reads commandPath from sai tool params", () => {
    expect(
      extractCommandText({
        commandPath: "sto/order/track",
        params: { orderNo: "123" },
      }),
    ).toBe("sto order track");
  });

  it("reads product/module/action triple", () => {
    expect(
      extractCommandText({
        product: "finance",
        module: "bill",
        action: "query",
      }),
    ).toBe("finance bill query");
  });

  it("strips sai-cli prefix from shell command", () => {
    expect(
      extractCommandText({
        command: "sai-cli finance bill query --params '{\"billNo\":\"A001\"}'",
      }),
    ).toBe("finance bill query");
  });
});

describe("buildToolCommandPayload", () => {
  it("emits toolHint for registry correlation", () => {
    const payload = buildToolCommandPayload({
      params: {
        commandPath: "finance/bill/query",
        params: { billNo: "A001" },
      },
    });
    expect(payload?.toolHint?.command).toBe("finance bill query");
    expect(payload?.toolHint?.product).toBe("finance");
    expect(payload?.toolHint?.module).toBe("bill");
    expect(payload?.toolHint?.action).toBe("query");
    expect(payload?.eventParams?.params).toEqual({ billNo: "A001" });
  });

  it("normalizes bash sai-cli command into product segments", () => {
    const payload = buildToolCommandPayload({
      params: {
        command: "sai-cli finance bill query",
      },
    });
    expect(payload?.toolHint?.command).toBe("finance bill query");
    expect(payload?.toolHint?.product).toBe("finance");
    expect(payload?.toolHint?.module).toBe("bill");
    expect(payload?.toolHint?.action).toBe("query");
  });
});
