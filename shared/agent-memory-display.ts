import {
  AGENT_EXECUTION_MEMORY_CONTEXT_MARKER,
  AGENT_MEMORY_CONTEXT_MARKER,
} from './agent-memory-prompt';
import { CONNECTOR_AGENT_CONTEXT_MARKER } from './connectors/agent-context-marker';

export function stripAgentMemoryContextByMarker(message: string, marker: string): string {
  const startIndex = message.indexOf(marker);
  if (startIndex < 0) return message;
  const endIndex = message.lastIndexOf(marker);
  if (endIndex > startIndex) {
    return [
      message.slice(0, startIndex).trim(),
      message.slice(endIndex + marker.length).trim(),
    ].filter(Boolean).join('\n\n');
  }
  return message.slice(0, startIndex).trim();
}

export function stripAgentMemoryContexts(message: string): string {
  return stripAgentMemoryContextByMarker(
    stripAgentMemoryContextByMarker(
      stripAgentMemoryContextByMarker(message, CONNECTOR_AGENT_CONTEXT_MARKER),
      AGENT_EXECUTION_MEMORY_CONTEXT_MARKER,
    ),
    AGENT_MEMORY_CONTEXT_MARKER,
  );
}

export function sanitizeMemoryFromChatPayload<T>(value: T): T {
  if (typeof value === 'string') return stripAgentMemoryContexts(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeMemoryFromChatPayload(item)) as T;
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...source };
  for (const [key, item] of Object.entries(copy)) {
    if (key === 'content' || key === 'text' || key === 'message' || key === 'label' || key === 'title') {
      copy[key] = sanitizeMemoryFromChatPayload(item);
    } else if (item && typeof item === 'object') {
      copy[key] = sanitizeMemoryFromChatPayload(item);
    }
  }
  return copy as T;
}

