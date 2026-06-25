import { createRequire } from 'node:module';
import { join } from 'node:path';

function loadTypebox(): typeof import('@sinclair/typebox') {
  const root = process.env.OPENCLAW_PACKAGE_ROOT?.trim();
  const req = root
    ? createRequire(join(root, 'openclaw.mjs'))
    : createRequire(import.meta.url);
  return req('@sinclair/typebox') as typeof import('@sinclair/typebox');
}

const typebox = loadTypebox();
export const Type = typebox.Type;
