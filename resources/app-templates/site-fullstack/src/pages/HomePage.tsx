import { Button, Checkbox, Input, Space, Typography, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';

const API = '/proxy/appBackend';

type User = { id: string; username: string; role: string };
type Todo = { id: string; title: string; done: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({})) as T & { error?: string; success?: boolean };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<string>('…');

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{ success: boolean; user?: User }>('/api/auth/me');
      setUser(me.user ?? null);
    } catch {
      setUser(null);
    }
  }, []);

  const refreshTodos = useCallback(async () => {
    if (!user) {
      setTodos([]);
      return;
    }
    const data = await api<{ items: Todo[] }>('/api/todos');
    setTodos(data.items ?? []);
  }, [user]);

  useEffect(() => {
    void fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((b: { ok?: boolean }) => setHealth(b.ok ? '后端已连接' : '后端异常'))
      .catch(() => setHealth('后端未启动（可在工作台「运行时」启动）'));
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    void refreshTodos().catch(() => setTodos([]));
  }, [refreshTodos]);

  const onRegister = async () => {
    setBusy(true);
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      message.success('注册成功，请登录');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '注册失败');
    } finally {
      setBusy(false);
    }
  };

  const onLogin = async () => {
    setBusy(true);
    try {
      const data = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setUser(data.user);
      message.success('登录成功');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setTodos([]);
  };

  const onAdd = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api('/api/todos', { method: 'POST', body: JSON.stringify({ title }) });
      setTitle('');
      await refreshTodos();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home-baseline">
      <section className="home-baseline-hero">
        <h1>本地全栈应用骨架</h1>
        <p>
          Vite 前端 + Hono/Drizzle/SQLite 后端。下方可体验注册登录与 Todos CRUD。
          状态：
          {' '}
          <Typography.Text type="secondary">{health}</Typography.Text>
        </p>
      </section>

      <section className="home-baseline-features" aria-label="登录与待办" style={{ display: 'block' }}>
        {!user ? (
          <article className="home-baseline-card" style={{ maxWidth: 420 }}>
            <h3>注册 / 登录</h3>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
              <Input.Password placeholder="密码（≥6 位）" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Space>
                <Button type="primary" loading={busy} onClick={() => void onLogin()}>登录</Button>
                <Button loading={busy} onClick={() => void onRegister()}>注册</Button>
              </Space>
            </Space>
          </article>
        ) : (
          <article className="home-baseline-card" style={{ maxWidth: 520 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>
                Todos ·
                {' '}
                {user.username}
              </h3>
              <Button size="small" onClick={() => void onLogout()}>退出</Button>
            </Space>
            <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
              <Input placeholder="新待办" value={title} onChange={(e) => setTitle(e.target.value)} onPressEnter={() => void onAdd()} />
              <Button type="primary" loading={busy} onClick={() => void onAdd()}>添加</Button>
            </Space.Compact>
            <Space direction="vertical" style={{ width: '100%' }}>
              {todos.map((item) => (
                <Space key={item.id} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Checkbox
                    checked={item.done}
                    onChange={() => {
                      void api(`/api/todos/${item.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ done: !item.done }),
                      }).then(() => refreshTodos());
                    }}
                  >
                    <span style={{ textDecoration: item.done ? 'line-through' : undefined }}>{item.title}</span>
                  </Checkbox>
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => {
                      void api(`/api/todos/${item.id}`, { method: 'DELETE' }).then(() => refreshTodos());
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ))}
              {todos.length === 0 ? <Typography.Text type="secondary">暂无待办</Typography.Text> : null}
            </Space>
          </article>
        )}
      </section>
    </div>
  );
}
