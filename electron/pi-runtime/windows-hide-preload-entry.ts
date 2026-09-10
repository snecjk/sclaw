/**
 * Loaded via utilityProcess execArgv --require so it runs before Pi SDK imports
 * bind child_process.spawn. Packaged Electron blocks NODE_OPTIONS --require.
 */
import { installChildProcessWindowsHidePatch } from '../utils/child-process-windows-hide';

try {
  installChildProcessWindowsHidePatch();
} catch {
  // Never block worker/main startup if spawn patching fails.
}
