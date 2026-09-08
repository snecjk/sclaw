/**
 * 冒烟：health + 注册登录 + todos CRUD。需已启动后端。
 */
const base = (process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`).replace(/\/$/, '');

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({})) as T;
  return { status: res.status, body };
}

function cookieFrom(res: Response): string {
  // Node fetch may expose getSetCookie
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof anyHeaders.getSetCookie === 'function' ? anyHeaders.getSetCookie() : [];
  if (list.length > 0) return list.map((c) => c.split(';')[0]).join('; ');
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0]! : '';
}

async function main() {
  const health = await json<{ ok?: boolean }>('/api/health');
  if (health.status !== 200 || !health.body.ok) {
    throw new Error(`health fail ${health.status}`);
  }

  const username = `smoke_${Date.now().toString(36)}`;
  const password = 'smoke-pass-1';

  const reg = await json<{ success?: boolean; error?: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (reg.status >= 400 || reg.body.success === false) {
    throw new Error(`register fail: ${reg.body.error || reg.status}`);
  }

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginBody = await loginRes.json().catch(() => ({})) as { success?: boolean; error?: string };
  if (!loginRes.ok || loginBody.success === false) {
    throw new Error(`login fail: ${loginBody.error || loginRes.status}`);
  }
  const cookie = cookieFrom(loginRes);
  if (!cookie) throw new Error('login missing set-cookie');

  const create = await json<{ success?: boolean; item?: { id: string }; error?: string }>('/api/todos', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({ title: 'smoke-todo' }),
  });
  if (create.status >= 400 || !create.body.item?.id) {
    throw new Error(`todo create fail: ${create.body.error || create.status}`);
  }
  const id = create.body.item.id;

  const patch = await json<{ success?: boolean }>('/api/todos/' + id, {
    method: 'PATCH',
    headers: { Cookie: cookie },
    body: JSON.stringify({ done: true }),
  });
  if (patch.status >= 400) throw new Error(`todo patch fail ${patch.status}`);

  const list = await json<{ items?: unknown[] }>('/api/todos', {
    headers: { Cookie: cookie },
  });
  if (!Array.isArray(list.body.items) || list.body.items.length < 1) {
    throw new Error('todo list empty');
  }

  const del = await json<{ success?: boolean }>('/api/todos/' + id, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  if (del.status >= 400) throw new Error(`todo delete fail ${del.status}`);

  console.log('[smoke] ok', base, username);
}

main().catch((err) => {
  console.error('[smoke] fail', err instanceof Error ? err.message : err);
  process.exit(1);
});
