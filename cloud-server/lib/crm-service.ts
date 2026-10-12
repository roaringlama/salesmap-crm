import { validateData } from './validate';
import type { CRMData } from '../types';

export type Account = { userId: string; email: string; displayName: string; fullName: string | null };
export type WorkspaceRole = 'owner' | 'editor' | 'viewer';
export type Workspace = { id: string; name: string; role: WorkspaceRole };
type SnapshotRow = { data: string; revision: number; updated_at: string };
type InviteRow = { id: string; workspace_id: string; email: string; role: 'editor' | 'viewer'; expires_at: string; created_at: string; cancelled: number; accepted_by: string | null };
export const MAX_SNAPSHOT_BYTES = 1_900_000;
export const MAX_BODY_BYTES = 30 * 1024 * 1024;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}) { super(message); }
}
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
const accountName = (user: Account) => (user.fullName || user.displayName || user.email).slice(0, 200);

export async function ensurePersonalWorkspace(db: D1Database, user: Account): Promise<string> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO crm_workspaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), `${accountName(user)}的工作空间`.slice(0, 120), user.userId, now),
    db.prepare(`INSERT INTO crm_members (workspace_id,user_id,role,email,name)
      SELECT id,?,'owner',?,? FROM crm_workspaces WHERE owner_id=?
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET email=excluded.email,name=excluded.name`).bind(user.userId, normalizeEmail(user.email), accountName(user), user.userId),
    db.prepare('UPDATE crm_members SET email=?,name=? WHERE user_id=?').bind(normalizeEmail(user.email), accountName(user), user.userId),
  ]);
  const row = await db.prepare('SELECT id FROM crm_workspaces WHERE owner_id=?').bind(user.userId).first<{ id: string }>();
  if (!row) throw new ApiError(503, '无法初始化个人工作空间，请稍后重试。');
  return row.id;
}

export async function getWorkspaces(db: D1Database, user: Account): Promise<Workspace[]> {
  const rows = await db.prepare(`SELECT w.id,w.name,m.role FROM crm_workspaces w
    JOIN crm_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,w.created_at`).bind(user.userId).all<Workspace>();
  return rows.results;
}

export async function requireWorkspace(db: D1Database, user: Account, requestedId?: string | null): Promise<Workspace> {
  const workspaceId = requestedId || await ensurePersonalWorkspace(db, user);
  const row = await db.prepare(`SELECT w.id,w.name,m.role FROM crm_workspaces w
    JOIN crm_members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?`).bind(workspaceId, user.userId).first<Workspace>();
  if (!row) throw new ApiError(403, '当前账号没有该工作空间的访问权限。');
  return row;
}

export async function readSnapshot(db: D1Database, user: Account, workspaceId?: string | null): Promise<{ data: CRMData | null }> {
  const workspace = await requireWorkspace(db, user, workspaceId);
  const row = await db.prepare(`SELECT s.data,s.revision,s.updated_at FROM crm_snapshots s
    WHERE s.workspace_id=? AND EXISTS (SELECT 1 FROM crm_members m WHERE m.workspace_id=s.workspace_id AND m.user_id=?)`).bind(workspace.id, user.userId).first<SnapshotRow>();
  return { data: row ? { ...validateData(JSON.parse(row.data)), revision: row.revision, updatedAt: row.updated_at } : null };
}

export async function writeSnapshot(db: D1Database, user: Account, workspaceId: string | null | undefined, body: Record<string, unknown>): Promise<{ data: CRMData }> {
  assertKeys(body, ['data', 'expectedRevision', 'expectedUserEmail', 'expectedWorkspaceId']);
  const workspace = await requireWorkspace(db, user, workspaceId);
  if (workspace.role === 'viewer') throw new ApiError(403, '当前账号为只读成员，不能修改此工作空间的数据。');
  guardIdentity(body, user, workspace.id);
  const revision = body.expectedRevision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new ApiError(400, 'expectedRevision 必须是非负安全整数。');
  let data: CRMData;
  try { data = validateData(body.data); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : '数据格式不正确。'); }
  const updatedAt = new Date().toISOString();
  const saved = { ...data, revision: revision + 1, updatedAt };
  const serialized = JSON.stringify(saved);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) throw new ApiError(413, '当前云端工作空间数据超过 1.9 MB 存储上限。请先备份数据并联系管理员扩容；此次修改未覆盖云端数据。');
  const statement = revision === 0
    ? db.prepare(`INSERT OR IGNORE INTO crm_snapshots (workspace_id,revision,data,updated_at)
        SELECT ?,1,?,? WHERE EXISTS (SELECT 1 FROM crm_members WHERE workspace_id=? AND user_id=? AND role IN ('owner','editor'))
        RETURNING data,revision,updated_at`).bind(workspace.id, serialized, updatedAt, workspace.id, user.userId)
    : db.prepare(`UPDATE crm_snapshots SET data=?,revision=revision+1,updated_at=?
        WHERE workspace_id=? AND revision=? AND EXISTS (SELECT 1 FROM crm_members WHERE workspace_id=? AND user_id=? AND role IN ('owner','editor'))
        RETURNING data,revision,updated_at`).bind(serialized, updatedAt, workspace.id, revision, workspace.id, user.userId);
  const result = await statement.first<SnapshotRow>();
  if (!result) {
    const currentMembership = await requireWorkspace(db, user, workspace.id);
    if (currentMembership.role === 'viewer') throw new ApiError(403, '修改权限已变更，请刷新工作空间。');
    const latest = await db.prepare('SELECT revision FROM crm_snapshots WHERE workspace_id=?').bind(workspace.id).first<{ revision: number }>();
    throw new ApiError(409, '另一台电脑或协作成员已更新数据，请获取最新版本后重新修改。', { currentRevision: latest?.revision ?? 0 });
  }
  return { data: saved };
}

export async function workspaceDetails(db: D1Database, user: Account, workspaceId?: string | null) {
  const workspace = await requireWorkspace(db, user, workspaceId);
  const members = await db.prepare('SELECT user_id AS userId,email,name,role FROM crm_members WHERE workspace_id=? ORDER BY CASE role WHEN \'owner\' THEN 0 ELSE 1 END,email').bind(workspace.id).all<{ userId: string; email: string; name: string; role: WorkspaceRole }>();
  const invites = workspace.role === 'owner' ? (await db.prepare(`SELECT id,email,role,expires_at AS expiresAt,created_at AS createdAt FROM crm_invites
    WHERE workspace_id=? AND cancelled=0 AND accepted_by IS NULL AND expires_at>? ORDER BY created_at DESC`).bind(workspace.id, new Date().toISOString()).all<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>()).results : [];
  return { workspace, members: members.results, invites };
}

async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function inviteToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function manageWorkspace(db: D1Database, user: Account, workspaceId: string | null | undefined, body: Record<string, unknown>, origin: string) {
  const workspace = await requireWorkspace(db, user, workspaceId);
  if (workspace.role !== 'owner') throw new ApiError(403, '仅工作空间所有者可以管理成员与邀请。');
  switch (body.action) {
    case 'invite': {
      assertKeys(body, ['action', 'email', 'role']);
      if (typeof body.email !== 'string' || body.email.length > 320) throw new ApiError(400, '请填写有效的受邀邮箱。');
      const email = normalizeEmail(body.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, '请填写有效的受邀邮箱。');
      if (body.role !== 'editor' && body.role !== 'viewer') throw new ApiError(400, '邀请角色必须为 editor 或 viewer。');
      const existing = await db.prepare('SELECT user_id FROM crm_members WHERE workspace_id=? AND lower(email)=?').bind(workspace.id, email).first();
      if (existing) throw new ApiError(409, '该邮箱已是工作空间成员。');
      const token = inviteToken();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await db.prepare(`INSERT INTO crm_invites (id,workspace_id,token_hash,email,role,expires_at,created_at,created_by,cancelled)
        VALUES (?,?,?,?,?,?,?,?,0)`).bind(id, workspace.id, await tokenHash(token), email, body.role, expiresAt, createdAt, user.userId).run();
      return { invite: { id, email, role: body.role, expiresAt, createdAt }, inviteURL: `${origin}/?invite=${encodeURIComponent(token)}` };
    }
    case 'revoke': {
      assertKeys(body, ['action', 'inviteId']);
      const inviteId = requiredString(body.inviteId, 'inviteId', 200);
      await db.prepare('UPDATE crm_invites SET cancelled=1 WHERE id=? AND workspace_id=? AND accepted_by IS NULL').bind(inviteId, workspace.id).run();
      return { ok: true };
    }
    case 'removeMember': {
      assertKeys(body, ['action', 'userId']);
      const userId = requiredString(body.userId, 'userId', 200);
      if (userId === user.userId) throw new ApiError(400, '不能移除工作空间所有者。');
      await db.batch([
        db.prepare(`UPDATE crm_invites SET cancelled=1 WHERE workspace_id=? AND
          (accepted_by=? OR email IN (SELECT lower(email) FROM crm_members WHERE workspace_id=? AND user_id=?))`).bind(workspace.id, userId, workspace.id, userId),
        db.prepare('DELETE FROM crm_members WHERE workspace_id=? AND user_id=? AND role<>\'owner\'').bind(workspace.id, userId),
      ]);
      return { ok: true };
    }
    case 'rename': {
      assertKeys(body, ['action', 'name']);
      const name = requiredString(body.name, 'name', 120).trim();
      await db.prepare('UPDATE crm_workspaces SET name=? WHERE id=? AND owner_id=?').bind(name, workspace.id, user.userId).run();
      return { workspace: { ...workspace, name } };
    }
    default: throw new ApiError(400, '不支持的工作空间操作。');
  }
}

export async function acceptInvite(db: D1Database, user: Account, body: Record<string, unknown>) {
  assertKeys(body, ['token']);
  const token = requiredString(body.token, 'token', 128);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, '邀请链接无效。');
  const hash = await tokenHash(token);
  const invite = await db.prepare('SELECT id,workspace_id,email,role,expires_at,created_at,cancelled,accepted_by FROM crm_invites WHERE token_hash=?').bind(hash).first<InviteRow>();
  if (!invite) throw new ApiError(404, '邀请链接不存在。');
  if (normalizeEmail(user.email) !== invite.email) throw new ApiError(403, '当前登录邮箱与受邀邮箱不一致，请切换为受邀账号后打开此链接。');
  if (invite.cancelled) throw new ApiError(410, '此邀请已撤销。');
  if (invite.accepted_by && invite.accepted_by !== user.userId) throw new ApiError(409, '此邀请已被其他账号使用。');
  if (invite.accepted_by === user.userId) {
    await requireWorkspace(db, user, invite.workspace_id);
    return { workspaceId: invite.workspace_id };
  }
  const now = new Date().toISOString();
  if (invite.expires_at <= now) throw new ApiError(410, '此邀请已过期，请联系所有者重新邀请。');
  // Conditions are repeated inside this atomic transaction, so a revocation or
  // simultaneous acceptance between the initial read and the write cannot win.
  await db.batch([
    db.prepare(`INSERT INTO crm_members (workspace_id,user_id,role,email,name)
      SELECT workspace_id,?,role,?,? FROM crm_invites WHERE token_hash=? AND email=? AND cancelled=0
      AND expires_at>? AND (accepted_by IS NULL OR accepted_by=?)
      ON CONFLICT(workspace_id,user_id) DO NOTHING`).bind(user.userId, normalizeEmail(user.email), accountName(user), hash, normalizeEmail(user.email), now, user.userId),
    db.prepare(`UPDATE crm_invites SET accepted_by=? WHERE token_hash=? AND email=? AND cancelled=0
      AND expires_at>? AND (accepted_by IS NULL OR accepted_by=?)
      AND EXISTS (SELECT 1 FROM crm_members WHERE workspace_id=crm_invites.workspace_id AND user_id=?)`).bind(user.userId, hash, normalizeEmail(user.email), now, user.userId, user.userId),
  ]);
  const accepted = await db.prepare('SELECT accepted_by,cancelled FROM crm_invites WHERE token_hash=?').bind(hash).first<{ accepted_by: string | null; cancelled: number }>();
  if (accepted?.cancelled || accepted?.accepted_by !== user.userId) throw new ApiError(409, '邀请状态已变更，请联系工作空间所有者。');
  await requireWorkspace(db, user, invite.workspace_id);
  return { workspaceId: invite.workspace_id };
}

function guardIdentity(body: Record<string, unknown>, user: Account, workspaceId: string) {
  if ('expectedUserEmail' in body && (typeof body.expectedUserEmail !== 'string' || normalizeEmail(body.expectedUserEmail) !== normalizeEmail(user.email))) throw new ApiError(409, '登录账号已变更，请刷新页面后再保存。');
  if ('expectedWorkspaceId' in body && body.expectedWorkspaceId !== workspaceId) throw new ApiError(409, '工作空间已变更，请刷新页面后再保存。');
}
export function assertKeys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, '请求包含不支持的字段。');
}
function requiredString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new ApiError(400, `${label} 无效。`);
  return value;
}
