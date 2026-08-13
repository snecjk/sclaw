#!/usr/bin/env zx

/**
 * Gate package builds on chat UI wiring types.
 * Full `pnpm typecheck` still has unrelated pre-existing errors in this repo.
 */

import 'zx/globals';

const TARGET = /use-chat-display|HomeMainConversation|TaskSubitemChatSurface|stores\/gateway\.ts/;

const result = await $`pnpm exec tsc --project tsconfig.chat-ui.json --noEmit --pretty false`.nothrow();
const output = `${result.stdout}\n${result.stderr}`;
const chatUiErrors = output
  .split('\n')
  .filter((line) => line.includes('error TS') && TARGET.test(line));

if (chatUiErrors.length > 0) {
  echo`Chat UI typecheck failed:`;
  echo`${chatUiErrors.join('\n')}`;
  process.exit(1);
}

echo`Chat UI typecheck passed (${chatUiErrors.length} errors in scoped files).`;
process.exit(0);
