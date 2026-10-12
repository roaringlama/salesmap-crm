import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { SQLInputValue } from 'node:sqlite';
import { acceptInvite, ensurePersonalWorkspace, getWorkspaces, manageWorkspace, readSnapshot, requireWorkspace, workspaceDetails, writeSnapshot } from '../lib/crm-service';
import type { Account } from '../lib/crm-service';
import type { CRMData } from '../types';

// Run the actual migration and service SQL against SQLite. The thin adapter
// mirrors D1's async prepared statements and atomic batch transaction contract.
function d1(sqlite: DatabaseSync): D1Database {
  function prepared(sql: string, values: SQLInputValue[] = []) {
    const item = {
      bind: (...next: SQLInputValue[]) => prepared(sql, next),
      first: async () => sqlite.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values), success: true }),
      run: async () => ({ ...sqlite.prepare(sql).run(...values), success: true }),
      execute: () => sqlite.prepare(sql).run(...values),
    };
    return item;
  }
  return {
    prepare: prepared,
    batch: async (statements: ReturnType<typeof prepared>[]) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
}

const owner: Account = { userId: 'owner-one', email: 'Owner@example.com', displayName: 'Owner', fullName: null };
const colleague: Account = { userId: 'colleague-one', email: 'colleague@example.com', displayName: 'Colleague', fullName: null };
const stranger: Account = { userId: 'stranger-one', email: 'stranger@example.com', displayName: 'Stranger', fullName: null };
const emptyData = (): CRMData => ({ schemaVersion: 1, revision: 0, updatedAt: new Date().toISOString(), customers: [], projects: [], cases: [], relationships: [] });
function payload(revision = 0) { return { data: emptyData(), expectedRevision: revision }; }

describe('cloud workspace authorization and atomic writes', () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  let workspaceId: string;
  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    sqlite.exec(readFileSync(new URL('../drizzle/0000_colossal_switch.sql', import.meta.url), 'utf8'));
    db = d1(sqlite);
    workspaceId = await ensurePersonalWorkspace(db, owner);
  });
  afterEach(() => sqlite.close());

  it('creates exactly one empty personal workspace under simultaneous initialization', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => ensurePersonalWorkspace(db, owner)));
    expect(new Set(ids)).toEqual(new Set([workspaceId]));
    expect(await getWorkspaces(db, owner)).toHaveLength(1);
    expect(await readSnapshot(db, owner, workspaceId)).toEqual({ data: null });
    expect(sqlite.prepare('SELECT count(*) AS n FROM crm_workspaces').get()?.n).toBe(1);
  });

  it('isolates personal accounts, including reads, writes and member lists', async () => {
    const otherId = await ensurePersonalWorkspace(db, stranger);
    await writeSnapshot(db, owner, workspaceId, payload());
    await expect(readSnapshot(db, stranger, workspaceId)).rejects.toMatchObject({ status: 403 });
    await expect(writeSnapshot(db, stranger, workspaceId, payload(1))).rejects.toMatchObject({ status: 403 });
    await expect(workspaceDetails(db, stranger, workspaceId)).rejects.toMatchObject({ status: 403 });
    expect(await readSnapshot(db, stranger, otherId)).toEqual({ data: null });
    expect((await getWorkspaces(db, stranger)).map(workspace => workspace.id)).toEqual([otherId]);
  });

  it('allows only one write for the same revision and ignores uploaded revision numbers', async () => {
    const data = { ...emptyData(), revision: 500 };
    const first = await writeSnapshot(db, owner, workspaceId, { data, expectedRevision: 0 });
    expect(first.data.revision).toBe(1);
    const concurrent = await Promise.allSettled([
      writeSnapshot(db, owner, workspaceId, payload(1)),
      writeSnapshot(db, owner, workspaceId, payload(1)),
    ]);
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = concurrent.find(result => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toMatchObject({ status: 409, details: { currentRevision: 2 } });
    expect((await readSnapshot(db, owner, workspaceId)).data?.revision).toBe(2);
    await expect(writeSnapshot(db, owner, workspaceId, payload(0))).rejects.toMatchObject({ status: 409 });
  });

  it('blocks a save when the UI account or workspace context has changed', async () => {
    await expect(writeSnapshot(db, owner, workspaceId, { ...payload(), expectedUserEmail: colleague.email })).rejects.toMatchObject({ status: 409 });
    await expect(writeSnapshot(db, owner, workspaceId, { ...payload(), expectedWorkspaceId: 'other-space' })).rejects.toMatchObject({ status: 409 });
    await expect(writeSnapshot(db, owner, workspaceId, { ...payload(), ownerId: stranger.userId })).rejects.toMatchObject({ status: 400 });
    expect(await readSnapshot(db, owner, workspaceId)).toEqual({ data: null });
  });

  it('binds invite acceptance to the intended email and stores only token hashes', async () => {
    const invite = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: ' COLLEAGUE@EXAMPLE.COM ', role: 'editor' }, 'https://crm.example.com');
    if (!('inviteURL' in invite)) throw new Error('Missing invite');
    const token = new URL(invite.inviteURL!).searchParams.get('invite')!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const row = sqlite.prepare('SELECT token_hash FROM crm_invites').get();
    expect(row?.token_hash).not.toBe(token);
    await expect(acceptInvite(db, stranger, { token })).rejects.toMatchObject({ status: 403 });
    expect(await acceptInvite(db, colleague, { token })).toEqual({ workspaceId });
    expect(await acceptInvite(db, colleague, { token })).toEqual({ workspaceId });
    expect((await requireWorkspace(db, colleague, workspaceId)).role).toBe('editor');
    expect(sqlite.prepare('SELECT count(*) AS n FROM crm_members WHERE workspace_id=? AND user_id=?').get(workspaceId, colleague.userId)?.n).toBe(1);
    await writeSnapshot(db, colleague, workspaceId, payload());
    await expect(manageWorkspace(db, colleague, workspaceId, { action: 'invite', email: stranger.email, role: 'viewer' }, 'https://crm.example.com')).rejects.toMatchObject({ status: 403 });
  });

  it('lets viewers read while preventing all writes and member administration', async () => {
    const invite = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'viewer' }, 'https://crm.example.com');
    if (!('inviteURL' in invite)) throw new Error('Missing invite');
    await acceptInvite(db, colleague, { token: new URL(invite.inviteURL!).searchParams.get('invite') });
    await writeSnapshot(db, owner, workspaceId, payload());
    expect((await readSnapshot(db, colleague, workspaceId)).data?.revision).toBe(1);
    await expect(writeSnapshot(db, colleague, workspaceId, payload(1))).rejects.toMatchObject({ status: 403 });
    await expect(manageWorkspace(db, colleague, workspaceId, { action: 'removeMember', userId: owner.userId }, 'https://crm.example.com')).rejects.toMatchObject({ status: 403 });
    expect((await workspaceDetails(db, colleague, workspaceId)).invites).toEqual([]);
  });

  it('rejects expired and revoked invites and prevents removed members rejoining via an accepted token', async () => {
    const first = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'editor' }, 'https://crm.example.com');
    if (!('inviteURL' in first)) throw new Error('Missing invite');
    const token = new URL(first.inviteURL!).searchParams.get('invite')!;
    sqlite.prepare('UPDATE crm_invites SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', first.invite!.id);
    await expect(acceptInvite(db, colleague, { token })).rejects.toMatchObject({ status: 410 });
    const second = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'editor' }, 'https://crm.example.com');
    if (!('inviteURL' in second)) throw new Error('Missing invite');
    const acceptedToken = new URL(second.inviteURL!).searchParams.get('invite')!;
    await acceptInvite(db, colleague, { token: acceptedToken });
    await manageWorkspace(db, owner, workspaceId, { action: 'removeMember', userId: colleague.userId }, 'https://crm.example.com');
    await expect(readSnapshot(db, colleague, workspaceId)).rejects.toMatchObject({ status: 403 });
    await expect(acceptInvite(db, colleague, { token: acceptedToken })).rejects.toMatchObject({ status: 410 });
    const third = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'viewer' }, 'https://crm.example.com');
    if (!('inviteURL' in third)) throw new Error('Missing invite');
    await manageWorkspace(db, owner, workspaceId, { action: 'revoke', inviteId: third.invite!.id }, 'https://crm.example.com');
    await expect(acceptInvite(db, colleague, { token: new URL(third.inviteURL!).searchParams.get('invite') })).rejects.toMatchObject({ status: 410 });
  });

  it('revokes every pending invitation for a removed member so a second token cannot rejoin', async () => {
    const first = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'editor' }, 'https://crm.example.com');
    const second = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'viewer' }, 'https://crm.example.com');
    if (!('inviteURL' in first) || !('inviteURL' in second)) throw new Error('Missing invites');
    const tokenA = new URL(first.inviteURL!).searchParams.get('invite')!;
    const tokenB = new URL(second.inviteURL!).searchParams.get('invite')!;
    await acceptInvite(db, colleague, { token: tokenA });
    await manageWorkspace(db, owner, workspaceId, { action: 'removeMember', userId: colleague.userId }, 'https://crm.example.com');
    await expect(acceptInvite(db, colleague, { token: tokenB })).rejects.toMatchObject({ status: 410 });
    await expect(readSnapshot(db, colleague, workspaceId)).rejects.toMatchObject({ status: 403 });
  });

  it('enforces token hash uniqueness and prevents owner removal or role escalation', async () => {
    const invite = await manageWorkspace(db, owner, workspaceId, { action: 'invite', email: colleague.email, role: 'viewer' }, 'https://crm.example.com');
    if (!('inviteURL' in invite)) throw new Error('Missing invite');
    const row = sqlite.prepare('SELECT * FROM crm_invites WHERE id=?').get(invite.invite!.id)!;
    expect(() => sqlite.prepare('INSERT INTO crm_invites(id,workspace_id,token_hash,email,role,expires_at,created_at,created_by,cancelled) VALUES(?,?,?,?,?,?,?,?,0)').run('duplicate-token', row.workspace_id as string, row.token_hash as string, stranger.email, 'editor', row.expires_at as string, row.created_at as string, owner.userId)).toThrow();
    await expect(manageWorkspace(db, owner, workspaceId, { action: 'removeMember', userId: owner.userId }, 'https://crm.example.com')).rejects.toMatchObject({ status: 400 });
    await expect(manageWorkspace(db, owner, workspaceId, { action: 'invite', email: stranger.email, role: 'owner' }, 'https://crm.example.com')).rejects.toMatchObject({ status: 400 });
  });
});

