/**
 * Re-export zod for sto-plugin Claude MCP tools.
 *
 * Must use a static import so Vite bundles zod into the Electron main chunk.
 * Packaged app.asar does not ship zod in node_modules; runtime require.resolve
 * (including via @anthropic-ai/claude-agent-sdk paths) fails after install.
 */
export { z } from 'zod';
