import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Resolve openclaw/plugin-sdk/* from Gateway's OPENCLAW_PACKAGE_ROOT (ASAR or
 * node_modules). Extensions under ~/.stoclaw are outside the openclaw tree, so
 * Node cannot resolve bare "openclaw/..." without NODE_PATH or this helper.
 */
export function requireOpenClawPluginSdk<T = unknown>(subpath: string): T {
	const root = process.env.OPENCLAW_PACKAGE_ROOT?.trim();
	const req = root
		? createRequire(join(root, "openclaw.mjs"))
		: createRequire(import.meta.url);
	return req(`openclaw/plugin-sdk/${subpath}`) as T;
}
