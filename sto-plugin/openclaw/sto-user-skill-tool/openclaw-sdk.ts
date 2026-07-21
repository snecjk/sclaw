import { createRequire } from "node:module";
import { join } from "node:path";

export function requireOpenClawPluginSdk<T = unknown>(subpath: string): T {
	const root = process.env.OPENCLAW_PACKAGE_ROOT?.trim();
	const req = root
		? createRequire(join(root, "openclaw.mjs"))
		: createRequire(import.meta.url);
	return req(`openclaw/plugin-sdk/${subpath}`) as T;
}
