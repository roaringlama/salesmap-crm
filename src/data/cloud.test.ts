import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureData } from '../test/fixtures';
import type { CRMData } from '../types';
import { closeDatabase, loadData, saveData, getStorageInfo, switchWorkspace, RevisionConflictError, CloudAuthError, CloudConnectionError, CloudPermissionError, CloudScopeChangedError } from './store';
import { resetStorageDetection, type CloudUser, type CloudWorkspace } from './cloud';

const user: CloudUser = { id: 'user-a', email: 'sales@example.test', name: '示例销售员' };
const workspaces: CloudWorkspace[] = [
  { id: 'workspace-a', name: '个人工作空间', role: 'owner' },
  { id: 'workspace-b', name: '协作工作空间', role: 'editor' },
];
const localPreferences = new Map<string, string>();
function browser(hostname = 'crm.example.test') {
  vi.stubGlobal('window', {
    location: { hostname },
    localStorage: {
      getItem: (key: string) => localPreferences.get(key) ?? null,
      setItem: (key: string, value: string) => localPreferences.set(key, value),
    },
  });
  resetStorageDetection();
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function metadata(account = user, spaces = workspaces, selected = 'workspace-a') { return { cloud: true, user: account, workspaces: spaces, currentWorkspaceId: selected }; }
function routeMeta(path: string, account = user, spaces = workspaces): Response {
  const selected = new URL(path, 'https://crm.example.test').searchParams.get('workspaceId') ?? 'workspace-a';
  return json(metadata(account, spaces, selected));
}
function urlOf(input: RequestInfo | URL) { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; }

beforeEach(async () => {
  await closeDatabase();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localPreferences.clear();
  browser();
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetStorageDetection(); await closeDatabase(); });

describe('cloud persistence boundaries', () => {
  it('returns an empty, unsaved migration state instead of seeding business data', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = urlOf(input);
      return path.startsWith('/api/crm/meta') ? routeMeta(path) : json({ data: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const data = await loadData();
    expect(data.customers).toEqual([]); expect(data.projects).toEqual([]); expect(data.cases).toEqual([]); expect(data.relationships).toEqual([]); expect(data.revision).toBe(0);
    expect(getStorageInfo()).toMatchObject({ mode: 'cloud', user, currentWorkspaceId: 'workspace-a', role: 'owner', requiresImport: true });
    expect(open).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'PUT')).toBe(true);
  });

  it('reads remote data and saves with the server revision and bound account/workspace', async () => {
    let remote = fixtureData(); remote.revision = 4;
    let received: Record<string, unknown> | undefined;
    const open = vi.spyOn(indexedDB, 'open');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      expect(init?.credentials).toBe('same-origin'); expect(init?.cache).toBe('no-store');
      if (path.startsWith('/api/crm/meta')) return routeMeta(path);
      expect(path).toBe('/api/crm?workspaceId=workspace-a');
      if (init?.method === 'PUT') {
        received = JSON.parse(String(init.body));
        remote = { ...(received!.data as CRMData), revision: Number(received!.expectedRevision) + 1, updatedAt: new Date().toISOString() };
      }
      return json({ data: remote });
    }));
    const loaded = await loadData(); expect(loaded).toEqual(remote);
    loaded.customers[0].notes = '同步修改';
    const saved = await saveData(loaded, 4);
    expect(saved.revision).toBe(5); expect(saved.customers[0].notes).toBe('同步修改');
    expect(received).toMatchObject({ expectedRevision: 4, expectedUserEmail: user.email, expectedWorkspaceId: 'workspace-a' });
    expect(getStorageInfo().requiresImport).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects stale cloud writes without saving a local fallback', async () => {
    const remote = fixtureData(), open = vi.spyOn(indexedDB, 'open');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path);
      return init?.method === 'PUT' ? json({ error: 'conflict' }, 409) : json({ data: remote });
    }));
    const loaded = await loadData(); loaded.customers[0].notes = '保留的未保存草稿';
    await expect(saveData(loaded, loaded.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    expect(loaded.customers[0].notes).toBe('保留的未保存草稿');
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['missing endpoint', () => json({ error: 'not found' }, 404)],
    ['HTML fallback', () => new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' } })],
    ['invalid JSON schema', () => json({ unexpected: true })],
    ['network failure', () => { throw new Error('offline'); }],
  ])('never opens IndexedDB on a hosted %s', async (_name, response) => {
    const open = vi.spyOn(indexedDB, 'open');
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await expect(loadData()).rejects.toBeInstanceOf(CloudConnectionError);
    expect(open).not.toHaveBeenCalled();
  });

  it('reports an expired login instead of starting a local dataset', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'unauthenticated' }, 401)));
    await expect(loadData()).rejects.toBeInstanceOf(CloudAuthError);
    expect(open).not.toHaveBeenCalled();
  });

  it('supports the original local app when localhost has no cloud route', async () => {
    browser('127.0.0.1');
    const fetcher = vi.fn(async () => new Response('<html>Vite app</html>', { headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetcher);
    const loaded = await loadData();
    expect(getStorageInfo().mode).toBe('local');
    expect(loaded.schemaVersion).toBe(1);
    await loadData(); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never falls back on localhost after detecting a cloud endpoint', async () => {
    browser('localhost');
    const open = vi.spyOn(indexedDB, 'open');
    let online = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!online) throw new Error('offline');
      const path = urlOf(input); return path.startsWith('/api/crm/meta') ? routeMeta(path) : json({ data: fixtureData() });
    }));
    await loadData(); online = false;
    await expect(loadData()).rejects.toBeInstanceOf(CloudConnectionError);
    expect(getStorageInfo().mode).toBe('cloud'); expect(open).not.toHaveBeenCalled();
  });

  it('remains cloud after a malformed cloud configuration on localhost', async () => {
    browser('localhost');
    const open = vi.spyOn(indexedDB, 'open');
    vi.stubGlobal('fetch', vi.fn(async () => json({ cloud: true, user: {}, workspaces: [] })));
    await expect(loadData()).rejects.toBeInstanceOf(CloudConnectionError);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } })));
    await expect(loadData()).rejects.toBeInstanceOf(CloudConnectionError);
    expect(getStorageInfo().mode).toBe('cloud'); expect(open).not.toHaveBeenCalled();
  });

  it('rejects invalid remote records and does not seed or overwrite local records', async () => {
    const remote = fixtureData(); remote.projects[0].customerId = 'missing-customer';
    const open = vi.spyOn(indexedDB, 'open');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = urlOf(input); return path.startsWith('/api/crm/meta') ? routeMeta(path) : json({ data: remote });
    }));
    await expect(loadData()).rejects.toBeInstanceOf(CloudConnectionError); expect(open).not.toHaveBeenCalled();
  });

  it('preserves the draft and reports the server capacity rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path);
      return init?.method === 'PUT' ? json({ error: 'too large' }, 413) : json({ data: fixtureData() });
    }));
    const loaded = await loadData(); loaded.customers[0].notes = '尚未保存的修改';
    await expect(saveData(loaded, 0)).rejects.toThrow('容量限制');
    expect(loaded.customers[0].notes).toBe('尚未保存的修改');
  });

  it('does not claim a network-interrupted save definitely failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path);
      if (init?.method === 'PUT') throw new Error('connection lost after request');
      return json({ data: fixtureData() });
    }));
    const loaded = await loadData();
    await expect(saveData(loaded, 0)).rejects.toThrow('保存结果未确认');
  });
});

describe('account and workspace isolation', () => {
  it('rejects a changed account before submitting an open draft', async () => {
    let account = user, puts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path, account);
      if (init?.method === 'PUT') puts++;
      return json({ data: fixtureData() });
    }));
    const loaded = await loadData();
    account = { id: 'user-b', email: 'another@example.test', name: '另一位销售员' };
    await expect(saveData(loaded, 0)).rejects.toBeInstanceOf(CloudAuthError);
    expect(puts).toBe(0);
  });

  it('prevents viewer edits locally even before a server permission check', async () => {
    const spaces: CloudWorkspace[] = [{ id: 'workspace-a', name: '只读工作空间', role: 'viewer' }];
    let puts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path, user, spaces);
      if (init?.method === 'PUT') puts++;
      return json({ data: fixtureData() });
    }));
    const loaded = await loadData();
    expect(getStorageInfo().role).toBe('viewer');
    await expect(saveData(loaded, 0)).rejects.toBeInstanceOf(CloudPermissionError); expect(puts).toBe(0);
  });

  it('selects workspaces without copying data and persists the preference per user', async () => {
    let account = user;
    const a = fixtureData(), b = fixtureData(); a.customers[0].name = '工作空间 A 记录'; b.customers[0].name = '工作空间 B 记录';
    let puts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path, account);
      if (init?.method === 'PUT') puts++;
      const selected = new URL(path, 'https://crm.example.test').searchParams.get('workspaceId');
      return json({ data: selected === 'workspace-b' ? b : a });
    }));
    const first = await loadData(); expect(first.customers[0].name).toBe('工作空间 A 记录');
    switchWorkspace('workspace-b');
    await expect(saveData(first, 0)).rejects.toBeInstanceOf(CloudScopeChangedError);
    expect((await loadData()).customers[0].name).toBe('工作空间 B 记录');
    expect(getStorageInfo().role).toBe('editor'); expect(puts).toBe(0);
    resetStorageDetection();
    expect((await loadData()).customers[0].name).toBe('工作空间 B 记录');
    account = { id: 'user-b', email: 'other@example.test', name: '其他销售员' };
    resetStorageDetection();
    expect((await loadData()).customers[0].name).toBe('工作空间 A 记录');
    expect(localPreferences.get('salesmap-workspace:user-a')).toBe('workspace-b');
    expect(localPreferences.get('salesmap-workspace:user-b')).toBe('workspace-a');
  });

  it('rejects forged workspace selections', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = urlOf(input); return path.startsWith('/api/crm/meta') ? routeMeta(path) : json({ data: null });
    }));
    await loadData(); expect(() => switchWorkspace('foreign-workspace')).toThrow(CloudPermissionError);
    expect(getStorageInfo().currentWorkspaceId).toBe('workspace-a');
  });

  it('rejects an old workspace response that arrives after switching', async () => {
    let delay = false, release: ((value: Response) => void) | undefined, started: (() => void) | undefined;
    const pendingStarted = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) return routeMeta(path);
      if (delay) { delay = false; started!(); return new Promise<Response>(resolve => { release = resolve; }); }
      return json({ data: fixtureData() });
    }));
    await loadData(); delay = true;
    const oldRead = loadData(); await pendingStarted;
    switchWorkspace('workspace-b'); release!(json({ data: fixtureData() }));
    await expect(oldRead).rejects.toBeInstanceOf(CloudScopeChangedError);
    await loadData(); expect(getStorageInfo().currentWorkspaceId).toBe('workspace-b');
  });

  it('does not redirect an already-started save when scope changes during metadata lookup', async () => {
    let delay = false, release: ((value: Response) => void) | undefined, started: (() => void) | undefined, puts = 0;
    const pendingStarted = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = urlOf(input);
      if (path.startsWith('/api/crm/meta')) {
        if (delay) { delay = false; started!(); return new Promise<Response>(resolve => { release = resolve; }); }
        return routeMeta(path);
      }
      if (init?.method === 'PUT') puts++;
      return json({ data: fixtureData() });
    }));
    const loaded = await loadData(); delay = true;
    const oldSave = saveData(loaded, 0); await pendingStarted;
    switchWorkspace('workspace-b'); release!(routeMeta('/api/crm/meta'));
    await expect(oldSave).rejects.toBeInstanceOf(CloudScopeChangedError); expect(puts).toBe(0);
  });
});
