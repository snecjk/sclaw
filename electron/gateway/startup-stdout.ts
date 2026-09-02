export type GatewayStdoutClassification = {
  level: 'drop' | 'debug' | 'info';
  normalized: string;
};

/** Known noisy Gateway stdout that should not flood the host logger. */
export function classifyGatewayStdoutMessage(message: string): GatewayStdoutClassification {
  const msg = message.trim();
  if (!msg) {
    return { level: 'drop', normalized: msg };
  }

  // Plugin registration is repeated on every gateway reload/restart.
  if (/\[plugins?\].*plugin (register|registered)/i.test(msg)) {
    return { level: 'drop', normalized: msg };
  }
  if (/\[plugins?\].*\[(sto-|gateway)/i.test(msg) && /register/i.test(msg)) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('loaded without install/load-path provenance')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('unknown typed hook') && msg.includes('ignored')) {
    return { level: 'drop', normalized: msg };
  }

  // Routine lifecycle noise.
  if (msg.includes('[heartbeat]')) return { level: 'drop', normalized: msg };
  if (msg.includes('[health-monitor]')) return { level: 'drop', normalized: msg };
  if (msg.includes('⇄ res ✓')) return { level: 'drop', normalized: msg };
  if (msg.includes('[gateway/channels] skipping channel start')) {
    return { level: 'drop', normalized: msg };
  }

  return { level: 'debug', normalized: msg };
}
