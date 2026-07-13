/**
 * Public compatibility entry for the chat store.
 *
 * The implementation lives in chat so callers can retain the established
 * `@/stores/chat` import path throughout the migration.
 */
export * from './chat/store';
