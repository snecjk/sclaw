import { describe, expect, it, vi } from "vitest";
import register from "../../sto-plugin/sto-media-understanding/index.js";

describe("sto-media-understanding bundled plugin", () => {
	it("registers sto as media-understanding provider", () => {
		const registerMediaUnderstandingProvider = vi.fn();
		register.register({
			logger: { info: vi.fn() },
			registerMediaUnderstandingProvider,
		} as never);

		expect(registerMediaUnderstandingProvider).toHaveBeenCalledWith(
			expect.objectContaining({ id: "sto", capabilities: ["image"] }),
		);
	});

	it("resolves plugin-sdk via OPENCLAW_PACKAGE_ROOT when set", async () => {
		const { requireOpenClawPluginSdk } = await import(
			"../../sto-plugin/sto-media-understanding/openclaw-sdk.js"
		);
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const openclawRoot = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/openclaw");
		process.env.OPENCLAW_PACKAGE_ROOT = openclawRoot;
		const sdk = requireOpenClawPluginSdk<{ describeImageWithModel: unknown }>("media-understanding");
		expect(typeof sdk.describeImageWithModel).toBe("function");
	});
});
