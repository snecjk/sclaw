/**
 * Backend process log lines worth draining into the agent repair loop.
 */

export function isBackendRepairWorthyLine(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  // tsx watch / benign noise
  if (/tsx watch|Restarting|'tsx'|listening on http:\/\/127\.0\.0\.1/i.test(text)) return false;
  if (/\[migrate\] ok|migrate ok/i.test(text)) return false;
  return (
    /error|exception|sqlite_error|econnrefused|failed|fatal|uncaught|unhandled/i.test(text)
    || /\b5\d{2}\b/.test(text)
    || /Error:/.test(text)
  );
}
