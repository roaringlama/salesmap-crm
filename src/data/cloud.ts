import type { CRMData } from '../types';
import { validateData } from './validate';

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';
export interface CloudUser { id: string; email: string; name: string }
export interface CloudWorkspace { id: string; name: string; role: WorkspaceRole }
export interface StorageInfo {
  mode: 'local' | 'cloud';
  user: CloudUser | null;
  workspaces: CloudWorkspace[];
  currentWorkspaceId: string;
  role: WorkspaceRole | null;
  requiresImport: boolean;
}

export class RevisionConflictError extends Error {
  constructor() { super('数据已被另一台电脑或标签页更新。当前修改尚未保存。请保留草稿并关闭编辑弹窗，再重新加载最新数据后修改。'); this.name = 'RevisionConflictError'; }
}
export class CloudAuthError extends Error {
  constructor(message = '登录已失效，请重新登录后重试；当前修改尚未保存。') { super(message); this.name = 'CloudAuthError'; }
}
export class CloudConnectionError extends Error {
  constructor(message = '无法连接云端。请检查网络后重试；当前修改尚未保存。') { super(message); this.name = 'CloudConnectionError'; }
}
export class CloudPermissionError extends Error {
  constructor(message = '没有访问或修改此工作空间的权限，请联系工作空间所有者。') { super(message); this.name = 'CloudPermissionError'; }
}
export class CloudScopeChangedError extends Error {
  constructor() { super('账户或工作空间已切换，请重新加载当前工作空间后再保存。'); this.name = 'CloudScopeChangedError'; }
}

type Meta = { cloud: true; user: CloudUser; workspaces: CloudWorkspace[]; currentWorkspaceId: string };
type Context = { userId: string; email: string; workspaceId: string; generation: number };
export type CloudScope = { userId: string; workspaceId: string; generation: number };
const LOCAL = Symbol('local-only');
let detectedMode: 'local' | 'cloud' | null = null;
let generation = 0;
let detection: Promise<StorageInfo> | undefined;
let loadedContext: Context | null = null;
const memoryPreferences = new Map<string, string>();

function canUseLocal(): boolean {
  // The Node branch is used by the local IndexedDB tests. Hosted browser origins
  // always require a working cloud API and never silently create a local copy.
  if (typeof window === 'undefined') return true;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}
function emptyInfo(): StorageInfo {
  return { mode: canUseLocal() ? 'local' : 'cloud', user: null, workspaces: [], currentWorkspaceId: '', role: canUseLocal() ? 'owner' : null, requiresImport: false };
}
let info: StorageInfo = emptyInfo();

export function getStorageInfo(): StorageInfo {
  return structuredClone(info);
}
export function captureCloudScope(): CloudScope | null {
  return loadedContext ? { userId: loadedContext.userId, workspaceId: loadedContext.workspaceId, generation: loadedContext.generation } : null;
}
function preferenceKey(user: CloudUser) { return `salesmap-workspace:${encodeURIComponent(user.id)}`; }
function readPreference(user: CloudUser): string {
  try { return window.localStorage.getItem(preferenceKey(user)) ?? memoryPreferences.get(user.id) ?? ''; }
  catch { return memoryPreferences.get(user.id) ?? ''; }
}
function writePreference(user: CloudUser, workspaceId: string): void {
  memoryPreferences.set(user.id, workspaceId);
  try { window.localStorage.setItem(preferenceKey(user), workspaceId); } catch { /* Preference persistence is optional; business data remains on the server. */ }
}

function meta(input: unknown): Meta {
  if (!input || typeof input !== 'object') throw new CloudConnectionError('云端配置响应无效，请稍后重试。');
  const value = input as Record<string, unknown>;
  if (value.cloud !== true || !value.user || typeof value.user !== 'object' || !Array.isArray(value.workspaces)) throw new CloudConnectionError('云端配置响应无效，请稍后重试。');
  const user = value.user as Record<string, unknown>;
  if (typeof user.id !== 'string' || !user.id || user.id.length > 200 || typeof user.email !== 'string' || !user.email || user.email.length > 500 || typeof user.name !== 'string' || user.name.length > 500) throw new CloudConnectionError('登录账户响应无效，请重新登录。');
  if (value.workspaces.length > 1000) throw new CloudConnectionError('云端工作空间列表超过限制。');
  const ids = new Set<string>();
  const workspaces = value.workspaces.map((entry: unknown): CloudWorkspace => {
    if (!entry || typeof entry !== 'object') throw new CloudConnectionError('云端工作空间响应无效。');
    const workspace = entry as Record<string, unknown>;
    if (typeof workspace.id !== 'string' || !workspace.id || workspace.id.length > 200 || ids.has(workspace.id) || typeof workspace.name !== 'string' || !workspace.name || workspace.name.length > 500 || !['owner', 'editor', 'viewer'].includes(String(workspace.role))) throw new CloudConnectionError('云端工作空间响应无效。');
    ids.add(workspace.id);
    return { id: workspace.id, name: workspace.name, role: workspace.role as WorkspaceRole };
  });
  if (typeof value.currentWorkspaceId !== 'string' || !ids.has(value.currentWorkspaceId)) throw new CloudConnectionError('云端没有返回可访问的当前工作空间。');
  return { cloud: true, user: { id: user.id, email: user.email, name: user.name }, workspaces, currentWorkspaceId: value.currentWorkspaceId };
}

async function request(path: string, init: RequestInit = {}, allowLocalMissing = false): Promise<unknown | typeof LOCAL> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const saving = ['PUT', 'POST', 'PATCH', 'DELETE'].includes(init.method?.toUpperCase() ?? 'GET');
  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (response.status === 401 || response.redirected) throw new CloudAuthError();
    if (response.status === 403) throw new CloudPermissionError();
    if (response.status === 409) throw new RevisionConflictError();
    if (response.status === 413) throw new CloudConnectionError('数据超过云端单个工作空间容量限制，尚未保存。请先导出 JSON 备份，再减少附件式长文本或拆分工作空间。');
    if (allowLocalMissing && detectedMode !== 'cloud' && canUseLocal() && [404, 405].includes(response.status)) return LOCAL;
    if (!response.ok) throw new CloudConnectionError(saving ? `云端请求失败（${response.status}），保存结果未确认。请刷新核实后再继续修改。` : `云端请求失败（${response.status}），请稍后重试。`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      if (allowLocalMissing && detectedMode !== 'cloud' && canUseLocal()) return LOCAL;
      throw new CloudConnectionError('云端返回了无效响应，请重新登录或稍后重试。');
    }
    try { return await response.json(); }
    catch { throw new CloudConnectionError('云端返回的数据无法读取，请稍后重试。'); }
  } catch (error) {
    if (error instanceof CloudAuthError || error instanceof CloudConnectionError || error instanceof CloudPermissionError || error instanceof RevisionConflictError) throw error;
    if (allowLocalMissing && detectedMode !== 'cloud' && canUseLocal()) return LOCAL;
    if (saving) throw new CloudConnectionError('连接云端中断，保存结果未确认。请恢复网络并刷新核实后再继续修改。');
    throw new CloudConnectionError(controller.signal.aborted ? '连接云端超时，请检查网络后重试。' : undefined);
  } finally { clearTimeout(timer); }
}

async function discover(purpose: 'load' | 'save' = 'load'): Promise<StorageInfo> {
  if (detectedMode === 'local') return getStorageInfo();
  if (typeof window === 'undefined') {
    detectedMode = 'local'; info = emptyInfo(); return getStorageInfo();
  }
  const startingGeneration = generation;
  const initial = await request('/api/crm/meta', {}, true);
  if (startingGeneration !== generation) throw new CloudScopeChangedError();
  if (initial === LOCAL || (initial && typeof initial === 'object' && (initial as Record<string, unknown>).cloud === false && canUseLocal() && detectedMode !== 'cloud')) {
    detectedMode = 'local'; info = emptyInfo(); return getStorageInfo();
  }
  // Once a cloud endpoint has answered, even later errors on localhost must not
  // fall back to IndexedDB and split one workspace into separate data copies.
  detectedMode = 'cloud';
  info = { ...info, mode: 'cloud', role: info.user ? info.role : null };
  let current = meta(initial);
  if (purpose === 'save' && loadedContext && (current.user.id !== loadedContext.userId || current.user.email.toLowerCase() !== loadedContext.email.toLowerCase())) throw new CloudAuthError('登录账户已变更。请刷新页面后再修改，避免把当前记录保存到另一个账户。');
  const sameUser = info.user?.id === current.user.id;
  let preferred = sameUser ? info.currentWorkspaceId || readPreference(current.user) : readPreference(current.user);
  if (preferred && !current.workspaces.some(workspace => workspace.id === preferred)) {
    if (sameUser && info.currentWorkspaceId) throw new CloudPermissionError('当前工作空间已不可访问，请重新登录或联系所有者。');
    preferred = '';
  }
  const selected = preferred || current.currentWorkspaceId;
  if (selected !== current.currentWorkspaceId) {
    current = meta(await request(`/api/crm/meta?workspaceId=${encodeURIComponent(selected)}`));
    if (current.currentWorkspaceId !== selected) throw new CloudConnectionError('云端工作空间与请求不一致，请重新加载。');
  }
  if (startingGeneration !== generation) throw new CloudScopeChangedError();
  const changed = Boolean(info.user && (!sameUser || info.currentWorkspaceId !== selected));
  if (changed) { generation++; loadedContext = null; }
  const role = current.workspaces.find(workspace => workspace.id === selected)!.role;
  info = {
    mode: 'cloud', user: current.user, workspaces: current.workspaces, currentWorkspaceId: selected, role,
    requiresImport: changed ? false : info.requiresImport,
  };
  writePreference(current.user, selected);
  return getStorageInfo();
}

export async function refreshStorageInfo(): Promise<StorageInfo> {
  return discover('load');
}
export async function detectStorage(): Promise<StorageInfo> {
  if (detectedMode) return getStorageInfo();
  if (!detection) detection = discover('load').finally(() => { detection = undefined; });
  return detection;
}

export function switchWorkspace(workspaceId: string): void {
  const user = info.user;
  if (info.mode !== 'cloud' || !user) throw new CloudPermissionError('只有登录后的云端模式可以切换工作空间。');
  const workspace = info.workspaces.find(value => value.id === workspaceId);
  if (!workspace) throw new CloudPermissionError('该工作空间不在当前账户的可访问列表中。');
  if (workspaceId === info.currentWorkspaceId) return;
  generation++;
  loadedContext = null;
  detection = undefined;
  info = { ...info, currentWorkspaceId: workspaceId, role: workspace.role, requiresImport: false };
  writePreference(user, workspaceId);
}

function context(): Context {
  if (info.mode !== 'cloud' || !info.user || !info.currentWorkspaceId) throw new CloudAuthError();
  return { userId: info.user.id, email: info.user.email, workspaceId: info.currentWorkspaceId, generation };
}
function assertContext(value: Context): void {
  if (value.generation !== generation || value.userId !== info.user?.id || value.workspaceId !== info.currentWorkspaceId) throw new CloudScopeChangedError();
}
function responseData(response: unknown): unknown {
  if (!response || typeof response !== 'object' || !Object.prototype.hasOwnProperty.call(response, 'data')) throw new CloudConnectionError('云端数据响应无效，请稍后重试。');
  return (response as Record<string, unknown>).data;
}

export async function loadCloudData(): Promise<CRMData> {
  await discover('load');
  const scope = context();
  const response = await request(`/api/crm?workspaceId=${encodeURIComponent(scope.workspaceId)}`);
  assertContext(scope);
  const value = responseData(response);
  let data: CRMData;
  try { data = value === null ? { schemaVersion: 1, revision: 0, updatedAt: new Date().toISOString(), customers: [], projects: [], cases: [], relationships: [] } : validateData(value); }
  catch { throw new CloudConnectionError('云端记录格式无效，请先联系管理员；没有创建或覆盖任何本地记录。'); }
  info = { ...info, requiresImport: value === null };
  loadedContext = scope;
  return data;
}

export async function saveCloudData(data: CRMData, expectedRevision: number, expectedScope: CloudScope | null): Promise<CRMData> {
  const loaded = loadedContext;
  if (!loaded) throw new CloudScopeChangedError();
  if (!expectedScope || expectedScope.userId !== loaded.userId || expectedScope.workspaceId !== loaded.workspaceId || expectedScope.generation !== loaded.generation) throw new CloudScopeChangedError();
  assertContext(loaded);
  await discover('save');
  assertContext(loaded);
  if (info.role === 'viewer') throw new CloudPermissionError('此工作空间为只读权限，无法新增、修改或恢复数据。');
  const response = await request(`/api/crm?workspaceId=${encodeURIComponent(loaded.workspaceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, expectedRevision, expectedUserEmail: loaded.email, expectedWorkspaceId: loaded.workspaceId }),
  });
  assertContext(loaded);
  let saved: CRMData;
  try { saved = validateData(responseData(response)); }
  catch (error) { if (error instanceof CloudConnectionError) throw error; throw new CloudConnectionError('云端保存响应无效。请刷新页面核实保存结果后再继续修改。'); }
  if (saved.revision !== expectedRevision + 1) throw new CloudConnectionError('云端数据版本响应异常。请刷新页面核实保存结果。');
  info = { ...info, requiresImport: false };
  return saved;
}

/** Resets adapter detection for tests; it never deletes business data. */
export function resetStorageDetection(): void {
  generation++;
  detectedMode = null; detection = undefined; loadedContext = null; info = emptyInfo(); memoryPreferences.clear();
}
